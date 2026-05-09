import { DemoCanvas } from '@/components/demo-canvas';
import { DetailPanel } from '@/components/detail-panel';
import type { ConnectorStylePatch, NodeStylePatch } from '@/components/style-strip';
import type { NodeEventLog } from '@/hooks/use-node-events';
import type { NodeRuns } from '@/hooks/use-node-runs';
import { usePendingOverrides } from '@/hooks/use-pending-overrides';
import { useUndoStack } from '@/hooks/use-undo-stack';
import {
  type Connector,
  type DefaultConnector,
  type DemoDetail,
  type DemoNode,
  type DemoSummary,
  type ReorderOp,
  type ShapeKind,
  createConnector,
  createNode,
  deleteConnector,
  deleteNode,
  reorderNode,
  updateConnector,
  updateNode,
  updateNodePosition,
} from '@/lib/api';
import { type AutoLayoutNode, applyLayout } from '@/lib/auto-layout';
import { applyNudge, getNudgeDelta, getZoomChord } from '@/lib/keyboard-shortcuts';
import type { ReactFlowInstance } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Position = { x: number; y: number };

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when the element is a form control or contentEditable surface. */
const isEditableElement = (el: Element | null): boolean => {
  if (!el) return false;
  if (EDITABLE_TAGS.has(el.tagName)) return true;
  return el instanceof HTMLElement && el.isContentEditable;
};

/**
 * Apply a z-order reorder op to a list of node ids. Mirrors the server's
 * `reorderNodes` in `apps/studio/src/api.ts` so the optimistic UI matches what
 * the file rewrite eventually produces. Returns null on a no-op (id missing,
 * forward at end, backward at start, etc.) so the caller can skip the PATCH.
 */
export const applyReorderOpToIds = (
  ids: readonly string[],
  id: string,
  op: ReorderOp,
): string[] | null => {
  const fromIdx = ids.indexOf(id);
  if (fromIdx < 0) return null;
  const len = ids.length;
  const next = [...ids];
  switch (op.op) {
    case 'forward': {
      if (fromIdx >= len - 1) return null;
      const a = next[fromIdx];
      const b = next[fromIdx + 1];
      if (a === undefined || b === undefined) return null;
      next[fromIdx] = b;
      next[fromIdx + 1] = a;
      return next;
    }
    case 'backward': {
      if (fromIdx <= 0) return null;
      const a = next[fromIdx];
      const b = next[fromIdx - 1];
      if (a === undefined || b === undefined) return null;
      next[fromIdx] = b;
      next[fromIdx - 1] = a;
      return next;
    }
    case 'toFront': {
      if (fromIdx === len - 1) return null;
      const [removed] = next.splice(fromIdx, 1);
      if (removed === undefined) return null;
      next.push(removed);
      return next;
    }
    case 'toBack': {
      if (fromIdx === 0) return null;
      const [removed] = next.splice(fromIdx, 1);
      if (removed === undefined) return null;
      next.unshift(removed);
      return next;
    }
    case 'toIndex': {
      const target = Math.min(Math.max(op.index, 0), len - 1);
      if (target === fromIdx) return null;
      const [removed] = next.splice(fromIdx, 1);
      if (removed === undefined) return null;
      next.splice(target, 0, removed);
      return next;
    }
  }
};

export interface DemoViewProps {
  slug: string;
  demos: DemoSummary[];
  detail: DemoDetail | null;
  loading: boolean;
  runs: NodeRuns;
  nodeEvents: NodeEventLog;
  onPlayNode: (nodeId: string) => void;
}

export function DemoView({
  slug,
  demos,
  detail,
  loading,
  runs,
  nodeEvents,
  onPlayNode,
}: DemoViewProps) {
  const summary = demos.find((d) => d.slug === slug);
  // US-019: multi-select. Selection is now an array; the inspector still
  // single-shots (1 node OR 1 connector — see derivations below) so its UX
  // doesn't change for the existing single-select paths. The style strip and
  // canvas selection rings honor the full arrays.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedConnectorIds, setSelectedConnectorIds] = useState<string[]>([]);
  // US-003: detail panel target is decoupled from selection so a node-drag
  // (which selects the dragged node) doesn't open the panel as a side effect.
  // Set on real click events from the canvas; cleared on pane click, panel
  // close, and demo switch. inspectedNode/inspectedConnector below derive
  // from these instead of from selectedIds/selectedConnectorIds.
  const [panelNodeId, setPanelNodeId] = useState<string | null>(null);
  const [panelConnectorId, setPanelConnectorId] = useState<string | null>(null);
  // Keep selection ids stable in a ref so keyboard handlers (Cmd+A / Cmd+C /
  // Cmd+D / Delete) read the latest set without re-binding the listener on
  // every render.
  const selectedIdsRef = useRef(selectedIds);
  const selectedConnectorIdsRef = useRef(selectedConnectorIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);
  useEffect(() => {
    selectedConnectorIdsRef.current = selectedConnectorIds;
  }, [selectedConnectorIds]);
  // Generalized optimistic overrides for nodes + connectors. Set on user
  // edits BEFORE firing the API call; pruned on the next demo:reload echo
  // (server caught up); dropped on API failure (revert to server state).
  const nodePending = usePendingOverrides<DemoNode>();
  const connectorPending = usePendingOverrides<Connector>();
  // Optimistic z-order override (US-006). Holds the displayed node-id order
  // while a `reorderNode` PATCH is in flight; cleared once the server's
  // demoNodes order matches it (SSE echo of the file rewrite). Per-id
  // overrides aren't a fit because the entire array order is what changes.
  const [nodeOrderOverride, setNodeOrderOverride] = useState<string[] | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  // React Flow instance handed up from `<DemoCanvas onRfInit>` (US-024). Used
  // by the zoom-chord handler below — only the page owns the keyboard
  // listener so the canvas stays free of page-level chord wiring.
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);
  const onRfInit = useCallback((instance: ReactFlowInstance) => {
    rfInstanceRef.current = instance;
  }, []);
  const undoStack = useUndoStack();
  // Stable handles for the mutation handlers below. push/dropTop/markMutation
  // are useCallback-stable so their identity doesn't churn dep arrays.
  const {
    push: pushUndo,
    dropTop: dropUndoTop,
    markMutation,
    clear: clearUndo,
    lastMutationAt: undoLastMutationAt,
  } = undoStack;

  const { reset: resetNodeOverrides } = nodePending;
  const { reset: resetConnectorOverrides } = connectorPending;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on demo id change.
  useEffect(() => {
    setSelectedIds([]);
    setSelectedConnectorIds([]);
    setPanelNodeId(null);
    setPanelConnectorId(null);
    resetNodeOverrides();
    resetConnectorOverrides();
    setNodeOrderOverride(null);
    setEditError(null);
    clipboardRef.current = null;
    setHasClipboard(false);
    undoStack.clear();
  }, [detail?.id]);

  // React Flow's onSelectionChange — fires for marquee, click, multi-key
  // toggle, pane-click clear. Mirror the arrays into our state; the canvas
  // re-applies them as `selected` on each node/edge so the loop closes
  // controllably.
  const onSelectionChange = useCallback((nodeIds: string[], connectorIds: string[]) => {
    setSelectedIds(nodeIds);
    setSelectedConnectorIds(connectorIds);
  }, []);

  // US-003: explicit click handlers drive the detail panel. xyflow fires
  // these only for click gestures (no drag), so a node-drag-start no longer
  // pops the inspector open. Clicking a node opens its panel; clicking an
  // edge opens the edge's panel; clicking the empty pane closes both.
  const onNodeClickOpenPanel = useCallback((nodeId: string) => {
    setPanelNodeId(nodeId);
    setPanelConnectorId(null);
  }, []);
  const onConnectorClickOpenPanel = useCallback((connectorId: string) => {
    setPanelConnectorId(connectorId);
    setPanelNodeId(null);
  }, []);
  const onPaneClickClosePanel = useCallback(() => {
    setPanelNodeId(null);
    setPanelConnectorId(null);
  }, []);

  const demoNodes = detail?.demo?.nodes;
  const demoConnectors = detail?.demo?.connectors;
  const { pruneAgainst: pruneNodeOverrides } = nodePending;
  const { pruneAgainst: pruneConnectorOverrides } = connectorPending;

  // After every demo reload, drop override fields whose values already match
  // the on-disk demo. Reconciling here (not skipping the broadcast on the
  // server) means an editor-driven change still lands cleanly: the matching
  // overrides clear, and the next render uses the server value.
  //
  // The stale-mutation check piggy-backs on the same effect: if the reload
  // arrives more than STALE_MUTATION_WINDOW_MS after the most recent UI
  // mutation, it's almost certainly external (text editor / git checkout) and
  // any queued undo entries point at a state the file no longer has — clear
  // them so undo never replays against stale state. `undoLastMutationAt` is a
  // ref-getter (not a value) so it doesn't churn this effect's deps.
  useEffect(() => {
    if (demoNodes) pruneNodeOverrides(demoNodes);
    if (Date.now() - undoLastMutationAt() > 2000) clearUndo();
  }, [demoNodes, pruneNodeOverrides, undoLastMutationAt, clearUndo]);

  useEffect(() => {
    if (demoConnectors) pruneConnectorOverrides(demoConnectors);
    if (Date.now() - undoLastMutationAt() > 2000) clearUndo();
  }, [demoConnectors, pruneConnectorOverrides, undoLastMutationAt, clearUndo]);

  // Drop the optimistic z-order override once the server's nodes array order
  // matches it (SSE echo of the file rewrite landed). If the server array
  // doesn't match (e.g. a second click is in flight, or an external editor
  // change reordered nodes), keep the override so the user's last pick stays
  // pinned on screen — until the next echo either matches or supersedes it.
  useEffect(() => {
    if (!demoNodes || !nodeOrderOverride) return;
    if (demoNodes.length !== nodeOrderOverride.length) return;
    for (let i = 0; i < demoNodes.length; i++) {
      const serverNode = demoNodes[i];
      const overrideId = nodeOrderOverride[i];
      if (!serverNode || serverNode.id !== overrideId) return;
    }
    setNodeOrderOverride(null);
  }, [demoNodes, nodeOrderOverride]);

  const demoId = detail?.id ?? null;
  const { setOverride: setNodeOverride, dropOverride: dropNodeOverride } = nodePending;
  const onNodePositionChange = useCallback(
    (nodeId: string, position: Position) => {
      if (!demoId) return;
      // Snapshot the on-disk pre-state BEFORE the optimistic override so the
      // undo entry can revert to where the node was before the drag started.
      const prev = demoNodes?.find((n) => n.id === nodeId)?.position;
      // Optimistic — the visual stays where the user dropped it without
      // waiting for the PATCH response.
      setNodeOverride(nodeId, { position });
      setEditError(null);
      markMutation();
      if (prev) {
        pushUndo({
          do: async () => {
            await updateNodePosition(demoId, nodeId, position);
          },
          undo: async () => {
            await updateNodePosition(demoId, nodeId, prev);
          },
          coalesceKey: `node:${nodeId}:position`,
        });
      }
      updateNodePosition(demoId, nodeId, position).catch((err) => {
        // Revert: drop the override so the canvas falls back to server data,
        // and drop the optimistic stack entry so the user isn't holding a
        // phantom undo step pointing at a state we never persisted.
        dropNodeOverride(nodeId);
        if (prev) dropUndoTop();
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNodePosition failed', err);
      });
    },
    [demoId, demoNodes, setNodeOverride, dropNodeOverride, pushUndo, dropUndoTop, markMutation],
  );

  const onNodeResize = useCallback(
    (nodeId: string, dims: { width: number; height: number; x: number; y: number }) => {
      if (!demoId) return;
      const node = demoNodes?.find((n) => n.id === nodeId);
      // US-012: capture both prior size AND prior position so a top/left
      // handle resize (which moves x/y) reverts cleanly on undo.
      const prev = node
        ? {
            width: node.data.width,
            height: node.data.height,
            position: { x: node.position.x, y: node.position.y },
          }
        : undefined;
      const next = {
        width: dims.width,
        height: dims.height,
        position: { x: dims.x, y: dims.y },
      };
      // Optimistic: keep the resized footprint AND new position pinned through
      // the PATCH round-trip + SSE echo. Without the position override, when
      // resizingRef clears and `setRfNodes(sourceNodes)` runs, the node would
      // snap back to its pre-drag position with the new size — visible as
      // the node "sliding across" the canvas after a top/left handle resize.
      setNodeOverride(nodeId, {
        position: next.position,
        data: { width: next.width, height: next.height },
      } as Partial<DemoNode>);
      setEditError(null);
      markMutation();
      if (prev) {
        pushUndo({
          do: async () => {
            await updateNode(demoId, nodeId, next);
          },
          undo: async () => {
            await updateNode(demoId, nodeId, prev);
          },
          coalesceKey: `node:${nodeId}:resize`,
        });
      }
      updateNode(demoId, nodeId, next).catch((err) => {
        dropNodeOverride(nodeId);
        if (prev) dropUndoTop();
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode resize failed', err);
      });
    },
    [demoId, demoNodes, setNodeOverride, dropNodeOverride, pushUndo, dropUndoTop, markMutation],
  );

  const { setOverride: setConnectorOverride, dropOverride: dropConnectorOverride } =
    connectorPending;

  // Live slider preview during drag — optimistic override only. The full
  // PATCH+undo path runs once on pointer release via onStyleNode/onStyleConnector.
  const onStyleNodePreview = useCallback(
    (nodeId: string, patch: NodeStylePatch) => {
      setNodeOverride(nodeId, { data: patch } as Partial<DemoNode>);
    },
    [setNodeOverride],
  );
  // US-008: live preview for a multi-node selection — fan out the override to
  // every selected node so they update together while the slider drags.
  const onStyleNodesPreview = useCallback(
    (nodeIds: string[], patch: NodeStylePatch) => {
      for (const id of nodeIds) {
        setNodeOverride(id, { data: patch } as Partial<DemoNode>);
      }
    },
    [setNodeOverride],
  );
  const onStyleConnectorPreview = useCallback(
    (connId: string, patch: ConnectorStylePatch) => {
      setConnectorOverride(connId, patch as Partial<Connector>);
    },
    [setConnectorOverride],
  );

  // Style-tab edit on a node: border + background tokens. Cast the partial
  // through Partial<DemoNode> because the discriminated union prevents TS from
  // seeing that 'data' on the override matches the variant of the keyed node.
  const onStyleNode = useCallback(
    (nodeId: string, patch: NodeStylePatch) => {
      if (!demoId) return;
      const node = demoNodes?.find((n) => n.id === nodeId);
      // Snapshot only the keys the caller is touching — we want undo to
      // restore those exact fields and leave anything else alone.
      let prev: NodeStylePatch | null = null;
      if (node) {
        prev = {};
        const data = node.data as unknown as Record<string, unknown>;
        for (const k of Object.keys(patch)) {
          (prev as Record<string, unknown>)[k] = data[k];
        }
      }
      setNodeOverride(nodeId, { data: patch } as Partial<DemoNode>);
      setEditError(null);
      markMutation();
      if (prev) {
        const prevPatch = prev;
        pushUndo({
          do: async () => {
            await updateNode(demoId, nodeId, patch);
          },
          undo: async () => {
            await updateNode(demoId, nodeId, prevPatch);
          },
          coalesceKey: `node:${nodeId}:style`,
        });
      }
      updateNode(demoId, nodeId, patch).catch((err) => {
        dropNodeOverride(nodeId);
        if (prev) dropUndoTop();
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode style failed', err);
      });
    },
    [demoId, demoNodes, setNodeOverride, dropNodeOverride, pushUndo, dropUndoTop, markMutation],
  );

  // US-008: atomic style-edit across a multi-node selection. Snapshots prev
  // for every targeted node, fans out optimistic overrides + PATCHes, and
  // pushes ONE undo entry so a single Cmd+Z reverts the whole group change.
  // Mirrors the onTidy batch pattern below.
  const onStyleNodes = useCallback(
    (nodeIds: string[], patch: NodeStylePatch) => {
      if (!demoId) return;
      if (nodeIds.length === 0) return;
      const targets = nodeIds
        .map((id) => {
          const node = demoNodes?.find((n) => n.id === id);
          if (!node) return null;
          const data = node.data as unknown as Record<string, unknown>;
          const prev: NodeStylePatch = {};
          for (const k of Object.keys(patch)) {
            (prev as Record<string, unknown>)[k] = data[k];
          }
          return { id, prev };
        })
        .filter((t): t is { id: string; prev: NodeStylePatch } => t !== null);
      if (targets.length === 0) return;
      for (const t of targets) {
        setNodeOverride(t.id, { data: patch } as Partial<DemoNode>);
      }
      setEditError(null);
      markMutation();
      pushUndo({
        do: async () => {
          await Promise.allSettled(targets.map((t) => updateNode(demoId, t.id, patch)));
        },
        undo: async () => {
          await Promise.allSettled(targets.map((t) => updateNode(demoId, t.id, t.prev)));
        },
      });
      // Fire-and-forget fan-out. On per-node failure, drop that node's
      // override so the canvas falls back to server state and surface a
      // single banner.
      Promise.all(
        targets.map(async (t) => {
          try {
            await updateNode(demoId, t.id, patch);
            return null;
          } catch (err) {
            dropNodeOverride(t.id);
            return err instanceof Error ? err.message : String(err);
          }
        }),
      ).then((errs) => {
        const first = errs.find((e): e is string => e !== null);
        if (first) setEditError(first);
      });
    },
    [demoId, demoNodes, setNodeOverride, dropNodeOverride, pushUndo, markMutation],
  );

  // Style-tab edit on a connector: color, edge style, direction. Cast through
  // Partial<Connector> because the discriminated union over `kind` rejects
  // bare partials at the type level (we never change kind here, so the cast
  // is safe at runtime).
  const onStyleConnector = useCallback(
    (connId: string, patch: ConnectorStylePatch) => {
      if (!demoId) return;
      const conn = demoConnectors?.find((c) => c.id === connId);
      // Snapshot only the keys the caller is touching so undo restores those
      // exact fields and leaves anything else alone.
      let prev: ConnectorStylePatch | null = null;
      if (conn) {
        prev = {};
        const data = conn as unknown as Record<string, unknown>;
        for (const k of Object.keys(patch)) {
          (prev as Record<string, unknown>)[k] = data[k];
        }
      }
      setConnectorOverride(connId, patch as Partial<Connector>);
      setEditError(null);
      markMutation();
      if (prev) {
        const prevPatch = prev;
        pushUndo({
          do: async () => {
            await updateConnector(demoId, connId, patch);
          },
          undo: async () => {
            await updateConnector(demoId, connId, prevPatch);
          },
          coalesceKey: `connector:${connId}:style`,
        });
      }
      updateConnector(demoId, connId, patch).catch((err) => {
        dropConnectorOverride(connId);
        if (prev) dropUndoTop();
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateConnector failed', err);
      });
    },
    [
      demoId,
      demoConnectors,
      setConnectorOverride,
      dropConnectorOverride,
      pushUndo,
      dropUndoTop,
      markMutation,
    ],
  );

  const onDeleteNode = useCallback(
    (nodeId: string) => {
      if (!demoId) return;
      // Snapshot the node + every cascaded connector BEFORE the delete API
      // call, so undo can recreate them all (preserving original ids and
      // adjacency order). The server cascades via the same source/target
      // filter; mirroring it here keeps the undo round-trip faithful.
      const node = demoNodes?.find((n) => n.id === nodeId);
      const cascaded = (demoConnectors ?? []).filter(
        (c) => c.source === nodeId || c.target === nodeId,
      );
      setEditError(null);
      // Don't optimistically remove from the canvas — the SSE echo of the
      // demo file rewrite will drop the node naturally, and a failure path
      // would need to put it back. Just drop the deleted id from the
      // selection set so the inspector closes (or the multi-selection
      // shrinks) immediately.
      setSelectedIds((prev) => prev.filter((id) => id !== nodeId));
      markMutation();
      if (node) {
        const nodeSnapshot = node;
        const connectorSnapshots = cascaded;
        pushUndo({
          do: async () => {
            await deleteNode(demoId, nodeId);
          },
          undo: async () => {
            await createNode(demoId, {
              id: nodeSnapshot.id,
              type: nodeSnapshot.type,
              position: nodeSnapshot.position,
              data: nodeSnapshot.data as unknown as Record<string, unknown>,
            });
            for (const c of connectorSnapshots) {
              await createConnector(demoId, { ...c, id: c.id });
            }
          },
        });
      }
      deleteNode(demoId, nodeId).catch((err) => {
        if (node) dropUndoTop();
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('deleteNode failed', err);
      });
    },
    [demoId, demoNodes, demoConnectors, pushUndo, dropUndoTop, markMutation],
  );

  // Right-click → "Bring to front" / "Send backward" / etc. Apply the reorder
  // optimistically (US-006) so the visual stack updates within the same React
  // tick — without waiting for the SSE echo of the file rewrite. The override
  // is the displayed id-order; the prune effect above drops it once the server
  // catches up. Snapshot the node's current displayed index for the `toIndex`
  // undo, so undo restores to where the user moved away from (faithful even
  // under concurrent edits where forward/backward couldn't symmetrically
  // invert from the middle of the array).
  const onReorderNode = useCallback(
    (nodeId: string, op: ReorderOp) => {
      if (!demoId || !demoNodes) return;
      const currentIds = nodeOrderOverride ?? demoNodes.map((n) => n.id);
      const newIds = applyReorderOpToIds(currentIds, nodeId, op);
      if (!newIds) return;
      const fromIdx = currentIds.indexOf(nodeId);
      setNodeOrderOverride(newIds);
      setEditError(null);
      markMutation();
      pushUndo({
        do: async () => {
          await reorderNode(demoId, nodeId, op);
        },
        undo: async () => {
          await reorderNode(demoId, nodeId, { op: 'toIndex', index: fromIdx });
        },
      });
      reorderNode(demoId, nodeId, op).catch((err) => {
        // Revert: drop the override entirely. The next render uses server
        // state. The optimistic stack entry is also dropped because the do()
        // it wraps was the just-failed call.
        setNodeOrderOverride(null);
        dropUndoTop();
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('reorderNode failed', err);
      });
    },
    [demoId, demoNodes, nodeOrderOverride, pushUndo, dropUndoTop, markMutation],
  );

  const onDeleteConnector = useCallback(
    (connId: string) => {
      if (!demoId) return;
      // Snapshot the full connector BEFORE the delete API call so undo can
      // recreate it with the original id and properties.
      const conn = demoConnectors?.find((c) => c.id === connId);
      setEditError(null);
      setSelectedConnectorIds((prev) => prev.filter((id) => id !== connId));
      markMutation();
      if (conn) {
        const connSnapshot = conn;
        pushUndo({
          do: async () => {
            await deleteConnector(demoId, connId);
          },
          undo: async () => {
            await createConnector(demoId, { ...connSnapshot, id: connSnapshot.id });
          },
        });
      }
      deleteConnector(demoId, connId).catch((err) => {
        if (conn) dropUndoTop();
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('deleteConnector failed', err);
      });
    },
    [demoId, demoConnectors, pushUndo, dropUndoTop, markMutation],
  );

  // Delete/Backspace shortcut: removes EVERY selected node and connector
  // (US-019). Skipped while focus is in any text-editing element so
  // InlineEdit / form controls keep their normal Backspace behavior. The
  // InlineEdit also calls e.stopPropagation(), but the activeElement guard is
  // the durable line of defense — it covers any future input that forgets to
  // stop the bubble. Removing a node also cascades any connectors attached to
  // it (the server's deleteNode handler does this, mirrored optimistically by
  // the SSE echo); we skip dispatching deletes for connectors that are
  // already going away via cascade.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (isEditableElement(document.activeElement)) return;
      const nodeIds = selectedIdsRef.current;
      const connIds = selectedConnectorIdsRef.current;
      if (nodeIds.length === 0 && connIds.length === 0) return;
      e.preventDefault();
      const cascadingNodeIdSet = new Set(nodeIds);
      // For connector deletes, skip any whose source/target is in the doomed
      // node set — the cascade handles them and a duplicate delete would
      // produce a server-side 404 for the connector that's already gone.
      const explicitConnIds = connIds.filter((id) => {
        const c = demoConnectors?.find((cc) => cc.id === id);
        if (!c) return false;
        return !cascadingNodeIdSet.has(c.source) && !cascadingNodeIdSet.has(c.target);
      });
      for (const id of nodeIds) onDeleteNode(id);
      for (const id of explicitConnIds) onDeleteConnector(id);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [demoConnectors, onDeleteNode, onDeleteConnector]);

  // Cmd/Ctrl+Z (undo) and Cmd/Ctrl+Shift+Z (redo). Skipped while focus is in
  // any editable element so native browser undo handles input/textarea/
  // contentEditable. We always preventDefault on the chord — even when the
  // stack is empty — so the browser doesn't navigate back on Cmd+Z with no
  // selected text.
  const { undo: undoFn, redo: redoFn, canUndo, canRedo } = undoStack;
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== 'z') return;
      if (isEditableElement(document.activeElement)) return;
      e.preventDefault();
      if (e.shiftKey) {
        if (!canRedo) return;
        try {
          const result = await redoFn();
          if (result?.entry) await result.entry.do();
        } catch (err) {
          setEditError(err instanceof Error ? err.message : String(err));
          console.error('redo failed', err);
        }
        return;
      }
      if (!canUndo) return;
      try {
        const result = await undoFn();
        if (result?.entry) await result.entry.undo();
      } catch (err) {
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('undo failed', err);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undoFn, redoFn, canUndo, canRedo]);

  // Inline label edit on a node (PlayNode/StateNode title or ShapeNode label).
  // Empty value is filtered out by the InlineEdit's `required` flag for
  // PlayNode/StateNode; ShapeNode labels are optional and pass through here.
  const onNodeLabelChange = useCallback(
    (nodeId: string, label: string) => {
      if (!demoId) return;
      const node = demoNodes?.find((n) => n.id === nodeId);
      const prevLabel = node?.data.label;
      setNodeOverride(nodeId, { data: { label } } as Partial<DemoNode>);
      setEditError(null);
      markMutation();
      if (node) {
        pushUndo({
          do: async () => {
            await updateNode(demoId, nodeId, { label });
          },
          undo: async () => {
            await updateNode(demoId, nodeId, { label: prevLabel });
          },
          coalesceKey: `node:${nodeId}:label`,
        });
      }
      updateNode(demoId, nodeId, { label }).catch((err) => {
        dropNodeOverride(nodeId);
        if (node) dropUndoTop();
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode label failed', err);
      });
    },
    [demoId, demoNodes, setNodeOverride, dropNodeOverride, pushUndo, dropUndoTop, markMutation],
  );

  // Inline description edit reuses detail.summary; we splice the new summary
  // into the existing detail object so unrelated fields (fields[],
  // dynamicSource, filePath) survive the round-trip.
  const onNodeDescriptionChange = useCallback(
    (nodeId: string, summary: string) => {
      if (!demoId) return;
      const node = demoNodes?.find((n) => n.id === nodeId);
      if (!node || node.type === 'shapeNode') return;
      const prevDetail = node.data.detail;
      const nextDetail = { ...(prevDetail ?? {}), summary };
      setNodeOverride(nodeId, { data: { detail: nextDetail } } as Partial<DemoNode>);
      setEditError(null);
      markMutation();
      pushUndo({
        do: async () => {
          await updateNode(demoId, nodeId, { detail: nextDetail });
        },
        undo: async () => {
          await updateNode(demoId, nodeId, { detail: prevDetail });
        },
        coalesceKey: `node:${nodeId}:description`,
      });
      updateNode(demoId, nodeId, { detail: nextDetail }).catch((err) => {
        dropNodeOverride(nodeId);
        dropUndoTop();
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode description failed', err);
      });
    },
    [demoId, demoNodes, setNodeOverride, dropNodeOverride, pushUndo, dropUndoTop, markMutation],
  );

  const onCreateShapeNode = useCallback(
    (shape: ShapeKind, position: Position, dims: { width: number; height: number }) => {
      if (!demoId) return;
      setEditError(null);
      // Generate the id client-side so the optimistic override and the
      // server echo share an id — the SSE-driven prune drops the override
      // cleanly once they match (mirrors `onCreateConnector`).
      const id = `node-${crypto.randomUUID()}`;
      const payload = {
        id,
        type: 'shapeNode' as const,
        position,
        data: { shape, width: dims.width, height: dims.height },
      };
      // Optimistic: render the new node at the dragged size BEFORE the SSE
      // echo arrives. Without this the node briefly shows at SHAPE_DEFAULT_SIZE
      // (the renderer's pre-`data.width` fallback) and snaps to the dragged
      // size on the next paint.
      const optimistic: DemoNode = {
        id,
        type: 'shapeNode',
        position,
        data: { shape, width: dims.width, height: dims.height },
      };
      setNodeOverride(id, optimistic as Partial<DemoNode>);
      markMutation();
      // Push from the .then so the undo entry binds to the server-issued id
      // (matches `onCreateConnector`). No dropTop is needed on .catch because
      // nothing was pushed before the API resolved.
      createNode(demoId, payload)
        .then(({ id: returnedId }) => {
          pushUndo({
            do: async () => {
              await createNode(demoId, { ...payload, id: returnedId });
            },
            undo: async () => {
              await deleteNode(demoId, returnedId);
            },
          });
        })
        .catch((err) => {
          dropNodeOverride(id);
          setEditError(err instanceof Error ? err.message : String(err));
          console.error('createNode failed', err);
        });
    },
    [demoId, setNodeOverride, dropNodeOverride, pushUndo, markMutation],
  );

  const onConnectorLabelChange = useCallback(
    (connId: string, label: string) => {
      if (!demoId) return;
      const conn = demoConnectors?.find((c) => c.id === connId);
      const prevLabel = conn?.label;
      setConnectorOverride(connId, { label } as Partial<Connector>);
      setEditError(null);
      markMutation();
      if (conn) {
        pushUndo({
          do: async () => {
            await updateConnector(demoId, connId, { label });
          },
          undo: async () => {
            await updateConnector(demoId, connId, { label: prevLabel });
          },
          coalesceKey: `connector:${connId}:label`,
        });
      }
      updateConnector(demoId, connId, { label }).catch((err) => {
        dropConnectorOverride(connId);
        if (conn) dropUndoTop();
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateConnector label failed', err);
      });
    },
    [
      demoId,
      demoConnectors,
      setConnectorOverride,
      dropConnectorOverride,
      pushUndo,
      dropUndoTop,
      markMutation,
    ],
  );

  // Create a default connector from a handle-drag gesture (US-029). We
  // generate the id client-side and send it in the POST body so the
  // optimistic override and the server echo share an id — the SSE-driven
  // prune then drops the override cleanly. On failure, drop the override and
  // surface the existing edit-error-banner.
  const onCreateConnector = useCallback(
    (source: string, target: string) => {
      if (!demoId) return;
      const id = `conn-${crypto.randomUUID()}`;
      // US-025: every new connector is floating — both endpoints carry
      // *HandleAutoPicked: true and no handle ids. The user pins a side
      // later by reconnecting it onto a specific handle dot.
      const optimistic: DefaultConnector = {
        id,
        source,
        target,
        sourceHandleAutoPicked: true,
        targetHandleAutoPicked: true,
        kind: 'default',
      };
      const payload = {
        id,
        source,
        target,
        sourceHandleAutoPicked: true,
        targetHandleAutoPicked: true,
        kind: 'default' as const,
      };
      setConnectorOverride(id, optimistic as Partial<Connector>);
      setEditError(null);
      markMutation();
      // Push from the .then so the undo entry binds to the server-issued id
      // (matches `onCreateShapeNode`). No dropTop is needed on .catch because
      // nothing was pushed before the API resolved.
      createConnector(demoId, payload)
        .then(({ id: returnedId }) => {
          pushUndo({
            do: async () => {
              await createConnector(demoId, { ...payload, id: returnedId });
            },
            undo: async () => {
              await deleteConnector(demoId, returnedId);
            },
          });
        })
        .catch((err) => {
          dropConnectorOverride(id);
          setEditError(err instanceof Error ? err.message : String(err));
          console.error('createConnector failed', err);
        });
    },
    [demoId, setConnectorOverride, dropConnectorOverride, pushUndo, markMutation],
  );

  // In-app clipboard for node copy/paste (US-011). Kept in a ref so we don't
  // leak demo internals into the OS clipboard and don't have to deal with
  // async ClipboardEvent permission prompts. The paired `hasClipboard` state
  // mirrors whether the ref is non-null so the right-click menu's Paste item
  // can subscribe to it (refs don't trigger re-renders). Both reset on
  // demo-id change via the same effect that clears selection state.
  const clipboardRef = useRef<{ nodes: DemoNode[]; connectors: Connector[] } | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);

  const onCopyNodes = useCallback(
    (nodeIds: string[]) => {
      if (!demoNodes) return;
      const idSet = new Set(nodeIds);
      const nodes = demoNodes.filter((n) => idSet.has(n.id));
      if (nodes.length === 0) return;
      // Connectors are copied only when BOTH endpoints are inside the copied
      // set — connectors that touch unselected nodes would dangle on paste.
      const connectors = (demoConnectors ?? []).filter(
        (c) => idSet.has(c.source) && idSet.has(c.target),
      );
      // Deep clone via JSON so a later server-side mutation can't bleed into
      // the clipboard payload (refs would alias the live data otherwise).
      clipboardRef.current = JSON.parse(JSON.stringify({ nodes, connectors }));
      setHasClipboard(true);
    },
    [demoNodes, demoConnectors],
  );

  // Paste the clipboard. `flowPos` (when set) anchors the paste at a specific
  // point — used by the right-click menu's "Paste" item which records the
  // cursor's flow-space position. When null (keyboard Ctrl/Cmd+V), every
  // pasted node is offset by +24,+24 from its original position.
  const onPasteNodes = useCallback(
    (flowPos: Position | null) => {
      if (!demoId) return;
      const payload = clipboardRef.current;
      if (!payload || payload.nodes.length === 0) return;
      // Anchor the paste so flowPos lands on the topmost-leftmost original;
      // every other pasted node maintains its relative offset to that anchor.
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      for (const n of payload.nodes) {
        if (n.position.x < minX) minX = n.position.x;
        if (n.position.y < minY) minY = n.position.y;
      }
      const offsetX = flowPos ? flowPos.x - minX : 24;
      const offsetY = flowPos ? flowPos.y - minY : 24;

      const idMap = new Map<string, string>();
      const newNodes: DemoNode[] = payload.nodes.map((n) => {
        const newId = `node-${crypto.randomUUID()}`;
        idMap.set(n.id, newId);
        return {
          ...n,
          id: newId,
          position: { x: n.position.x + offsetX, y: n.position.y + offsetY },
        } as DemoNode;
      });
      const newConnectors: Connector[] = payload.connectors.map((c) => {
        const newSource = idMap.get(c.source);
        const newTarget = idMap.get(c.target);
        return {
          ...c,
          id: `conn-${crypto.randomUUID()}`,
          source: newSource ?? c.source,
          target: newTarget ?? c.target,
        } as Connector;
      });

      // Optimistic overrides — render the pasted entities immediately while
      // the POSTs are in flight. The SSE echo of the rewrite drops the
      // overrides via pruneAgainst once server state matches.
      for (const n of newNodes) {
        setNodeOverride(n.id, n as Partial<DemoNode>);
      }
      for (const c of newConnectors) {
        setConnectorOverride(c.id, c as Partial<Connector>);
      }
      // The pasted clones become the new selection (US-019). Original ids
      // drop out; the user can immediately move/style/delete the pastes as a
      // unit. Pasted connectors are also part of the selection so a single
      // Delete keystroke removes the entire pasted batch.
      setSelectedIds(newNodes.map((n) => n.id));
      setSelectedConnectorIds(newConnectors.map((c) => c.id));
      setEditError(null);
      markMutation();

      // Fire creates: nodes first (referential integrity for connectors),
      // then connectors. On any failure, drop overrides and surface the
      // error banner; partial state on disk is fine since each POST is
      // schema-validated independently.
      (async () => {
        try {
          for (const n of newNodes) {
            await createNode(demoId, {
              id: n.id,
              type: n.type,
              position: n.position,
              data: n.data as unknown as Record<string, unknown>,
            });
          }
          for (const c of newConnectors) {
            await createConnector(demoId, c);
          }
        } catch (err) {
          for (const n of newNodes) dropNodeOverride(n.id);
          for (const c of newConnectors) dropConnectorOverride(c.id);
          setEditError(err instanceof Error ? err.message : String(err));
          console.error('paste failed', err);
        }
      })();
    },
    [
      demoId,
      setNodeOverride,
      dropNodeOverride,
      setConnectorOverride,
      dropConnectorOverride,
      markMutation,
    ],
  );

  // US-019 keyboard chords:
  //   • Cmd+A — select all nodes and connectors (skipped in contenteditable
  //     so InlineEdit's native text-select still works).
  //   • Cmd+C — copy every selected node (connectors copy implicitly when
  //     both endpoints are in the node set).
  //   • Cmd+V — paste at +24,+24 offset; pasted clones become the selection.
  //   • Cmd+D — duplicate (Cmd+C followed by Cmd+V at +24,+24); single
  //     keystroke equivalent to copy+paste.
  // All four are skipped while focus is in any editable element so the
  // browser's native chords keep working inside form controls / InlineEdit.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'a' && key !== 'c' && key !== 'v' && key !== 'd') return;
      if (isEditableElement(document.activeElement)) return;
      if (key === 'a') {
        // Suppress when there's nothing on the canvas — let the browser do its
        // default (which is a no-op outside an input). Otherwise pin all
        // node/connector ids and prevent the browser from selecting page text.
        if (!demoNodes && !demoConnectors) return;
        e.preventDefault();
        setSelectedIds((demoNodes ?? []).map((n) => n.id));
        setSelectedConnectorIds((demoConnectors ?? []).map((c) => c.id));
        return;
      }
      if (key === 'c') {
        const ids = selectedIdsRef.current;
        if (ids.length === 0) return;
        e.preventDefault();
        onCopyNodes(ids);
        return;
      }
      if (key === 'd') {
        // Duplicate = copy current selection then paste at +24,+24. Goes
        // through onCopyNodes/onPasteNodes so the in-app clipboard reflects
        // the duplicated payload (matches a manual Cmd+C → Cmd+V).
        const ids = selectedIdsRef.current;
        if (ids.length === 0) return;
        e.preventDefault();
        onCopyNodes(ids);
        onPasteNodes(null);
        return;
      }
      // 'v'
      if (!clipboardRef.current) return;
      e.preventDefault();
      onPasteNodes(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [demoNodes, demoConnectors, onCopyNodes, onPasteNodes]);

  // US-024: arrow-key nudge. Bare arrows shift every selected node by 1px on
  // the matched axis; Shift+arrow uses 10px. Each axis-step routes through the
  // existing onNodePositionChange path so the optimistic override + undo
  // coalescing (coalesceKey `node:${id}:position`) collapses a burst of taps
  // into one undo entry — same shape as a drag. Pure-connector selections
  // resolve to no updates (no node ids match) and the chord becomes a no-op.
  // Editable focus suppresses so InlineEdit / inputs keep the caret-move
  // native behavior.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const delta = getNudgeDelta(e);
      if (!delta) return;
      if (isEditableElement(document.activeElement)) return;
      const ids = selectedIdsRef.current;
      if (ids.length === 0) return;
      // Read the LIVE displayed position (override merged) so a tap-tap-tap
      // burst keeps stacking on the in-flight position rather than the stale
      // server snapshot. Coalescing on the undo entry preserves the original
      // pre-burst position so a single Cmd+Z reverts the whole sequence.
      const overrides = nodePending.overrides;
      const liveNodes = (demoNodes ?? []).map((n) => {
        const pos = overrides[n.id]?.position ?? n.position;
        return { id: n.id, position: pos };
      });
      const updates = applyNudge(delta, ids, liveNodes);
      if (updates.length === 0) return;
      e.preventDefault();
      for (const u of updates) onNodePositionChange(u.id, u.position);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [demoNodes, nodePending.overrides, onNodePositionChange]);

  // US-024: zoom chords. Cmd+0 → fitView, Cmd+= (and Cmd+Shift+=) → zoomIn,
  // Cmd+- → zoomOut. preventDefault fires even when the rfInstance isn't
  // ready yet so the browser's native reset-zoom never escapes (the user
  // doesn't have to click the canvas first). Editable focus suppresses for
  // consistency with the other chords.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const action = getZoomChord(e);
      if (!action) return;
      if (isEditableElement(document.activeElement)) return;
      e.preventDefault();
      const inst = rfInstanceRef.current;
      if (!inst) return;
      if (action === 'fit') inst.fitView({ padding: 0.2, duration: 200 });
      else if (action === 'in') inst.zoomIn({ duration: 150 });
      else inst.zoomOut({ duration: 150 });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // US-026: auto-layout (Tidy). Resolve scope, snapshot prev positions, run
  // dagre, optimistically override every moved node, fan-out PATCHes via
  // Promise.allSettled, and push ONE undo entry that reverts the whole batch.
  // Width/height feed dagre's spacing; we read measured dims from the live
  // React Flow internals when available so resized nodes get accurate gutters,
  // falling back to data.width/data.height (then 200×120) when the canvas
  // hasn't reported a size yet.
  const onTidy = useCallback(
    (scope: 'all' | 'selection') => {
      if (!demoId || !demoNodes) return;
      const overrides = nodePending.overrides;
      const inst = rfInstanceRef.current;
      const selectedSet = scope === 'selection' ? new Set(selectedIdsRef.current) : null;
      const includedNodes = selectedSet
        ? demoNodes.filter((n) => selectedSet.has(n.id))
        : demoNodes;
      if (includedNodes.length < 2) return;
      const includedIdSet = new Set(includedNodes.map((n) => n.id));
      const includedConnectors = (demoConnectors ?? []).filter(
        (c) => includedIdSet.has(c.source) && includedIdSet.has(c.target),
      );

      const layoutNodes: AutoLayoutNode[] = includedNodes.map((n) => {
        const livePos = overrides[n.id]?.position ?? n.position;
        const internal = inst?.getInternalNode(n.id);
        const measured = internal?.measured;
        const dataAny = n.data as { width?: number; height?: number };
        const width = measured?.width ?? dataAny.width ?? 200;
        const height = measured?.height ?? dataAny.height ?? 120;
        return { id: n.id, width, height, position: livePos };
      });
      const layoutEdges = includedConnectors.map((c) => ({
        source: c.source,
        target: c.target,
      }));
      const next = applyLayout(layoutNodes, layoutEdges);

      // Anchor the laid-out group to its current visual top-left so a
      // selection-scoped Tidy doesn't teleport the cluster across the canvas.
      let prevMinX = Number.POSITIVE_INFINITY;
      let prevMinY = Number.POSITIVE_INFINITY;
      let nextMinX = Number.POSITIVE_INFINITY;
      let nextMinY = Number.POSITIVE_INFINITY;
      for (const ln of layoutNodes) {
        if (ln.position.x < prevMinX) prevMinX = ln.position.x;
        if (ln.position.y < prevMinY) prevMinY = ln.position.y;
        const np = next.get(ln.id);
        if (!np) continue;
        if (np.x < nextMinX) nextMinX = np.x;
        if (np.y < nextMinY) nextMinY = np.y;
      }
      const offsetX =
        Number.isFinite(prevMinX) && Number.isFinite(nextMinX) ? prevMinX - nextMinX : 0;
      const offsetY =
        Number.isFinite(prevMinY) && Number.isFinite(nextMinY) ? prevMinY - nextMinY : 0;

      // Build the moves list (only changes ≥ 1px on either axis qualify) and
      // capture a per-id prev snapshot for the single batched undo entry.
      const moves: { id: string; prev: Position; next: Position }[] = [];
      for (const ln of layoutNodes) {
        const np = next.get(ln.id);
        if (!np) continue;
        const targetPos = { x: np.x + offsetX, y: np.y + offsetY };
        const dx = targetPos.x - ln.position.x;
        const dy = targetPos.y - ln.position.y;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        moves.push({ id: ln.id, prev: ln.position, next: targetPos });
      }
      if (moves.length === 0) return;

      setEditError(null);
      for (const m of moves) {
        setNodeOverride(m.id, { position: m.next });
      }
      markMutation();
      // ONE undo entry that re-applies the whole batch (do) or restores it
      // (undo). Cmd+Z reverts every node in a single keystroke.
      pushUndo({
        do: async () => {
          await Promise.allSettled(moves.map((m) => updateNodePosition(demoId, m.id, m.next)));
        },
        undo: async () => {
          await Promise.allSettled(moves.map((m) => updateNodePosition(demoId, m.id, m.prev)));
        },
      });
      // Fan-out PATCHes; surface a single banner if any leg failed. Successful
      // PATCHes still commit on disk — partial state isn't auto-rolled-back
      // (the user can Cmd+Z the whole batch). Per-failure: drop that node's
      // override so the canvas falls back to server state.
      Promise.all(
        moves.map(async (m) => {
          try {
            await updateNodePosition(demoId, m.id, m.next);
            return null;
          } catch (err) {
            dropNodeOverride(m.id);
            return err instanceof Error ? err.message : String(err);
          }
        }),
      ).then((failures) => {
        const errs = failures.filter((f): f is string => f !== null);
        const firstErr = errs[0];
        if (!firstErr) return;
        setEditError(
          errs.length === 1 ? firstErr : `${errs.length} node updates failed (first: ${firstErr})`,
        );
        console.error('Tidy: some updateNodePosition calls failed', errs);
      });
    },
    [
      demoId,
      demoNodes,
      demoConnectors,
      nodePending.overrides,
      setNodeOverride,
      dropNodeOverride,
      pushUndo,
      markMutation,
    ],
  );

  // US-026: Cmd+Shift+L (Mac) / Ctrl+Shift+L (other) → Tidy. Selection-empty
  // tidies the whole canvas; non-empty tidies just the selected nodes (and
  // connectors between them). Skipped in editable elements like every other
  // chord. preventDefault fires unconditionally so the browser's
  // history-clear-recent-on Cmd+Shift+L (Firefox) doesn't escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (!e.shiftKey) return;
      if (e.altKey) return;
      if (e.key.toLowerCase() !== 'l') return;
      if (isEditableElement(document.activeElement)) return;
      e.preventDefault();
      const scope = selectedIdsRef.current.length > 0 ? 'selection' : 'all';
      onTidy(scope);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onTidy]);

  // Toolbar button click: same scope rule as the chord (selection-empty →
  // 'all'). Handed to <DemoCanvas> below; CanvasToolbar disables the button
  // when no demo is loaded (onTidy unset).
  const onToolbarTidy = useCallback(() => {
    const scope = selectedIdsRef.current.length > 0 ? 'selection' : 'all';
    onTidy(scope);
  }, [onTidy]);

  // Drag an edge endpoint onto another node's handle to retarget it, OR drag
  // it onto a different handle on the same node (US-002). The patch only
  // includes the fields that changed (source/target/sourceHandle/targetHandle).
  // Optimistic: the override snaps the edge immediately; SSE echo of the
  // rewrite reconciles.
  const onReconnectConnector = useCallback(
    (
      connId: string,
      patch: {
        source?: string;
        target?: string;
        sourceHandle?: string | null;
        targetHandle?: string | null;
        sourceHandleAutoPicked?: boolean;
        targetHandleAutoPicked?: boolean;
      },
    ) => {
      if (!demoId) return;
      const conn = demoConnectors?.find((c) => c.id === connId);
      // Capture all four endpoint fields so undo can reset whichever side(s)
      // moved (and leave the unchanged side at its original value). The
      // auto-picked flags are also captured so an undone reroute restores
      // the prior auto/pinned state.
      const prev = conn
        ? {
            source: conn.source,
            target: conn.target,
            sourceHandle: conn.sourceHandle,
            targetHandle: conn.targetHandle,
            sourceHandleAutoPicked: conn.sourceHandleAutoPicked,
            targetHandleAutoPicked: conn.targetHandleAutoPicked,
          }
        : null;
      // Optimistic override: convert wire-format `null` (clear-on-disk
      // signal, US-025) to `undefined` so the merged Connector type stays
      // valid — the visual effect is the same (the field is gone).
      const optimistic: Partial<Connector> = {
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.target !== undefined ? { target: patch.target } : {}),
        ...(patch.sourceHandle !== undefined
          ? { sourceHandle: patch.sourceHandle === null ? undefined : patch.sourceHandle }
          : {}),
        ...(patch.targetHandle !== undefined
          ? { targetHandle: patch.targetHandle === null ? undefined : patch.targetHandle }
          : {}),
        ...(patch.sourceHandleAutoPicked !== undefined
          ? { sourceHandleAutoPicked: patch.sourceHandleAutoPicked }
          : {}),
        ...(patch.targetHandleAutoPicked !== undefined
          ? { targetHandleAutoPicked: patch.targetHandleAutoPicked }
          : {}),
      };
      setConnectorOverride(connId, optimistic);
      setEditError(null);
      markMutation();
      if (prev) {
        const prevPatch = prev;
        pushUndo({
          do: async () => {
            await updateConnector(demoId, connId, patch);
          },
          undo: async () => {
            await updateConnector(demoId, connId, prevPatch);
          },
          coalesceKey: `connector:${connId}:reconnect`,
        });
      }
      updateConnector(demoId, connId, patch).catch((err) => {
        dropConnectorOverride(connId);
        if (prev) dropUndoTop();
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateConnector reconnect failed', err);
      });
    },
    [
      demoId,
      demoConnectors,
      setConnectorOverride,
      dropConnectorOverride,
      pushUndo,
      dropUndoTop,
      markMutation,
    ],
  );

  // Merge pending overrides onto the selected entity so Style-tab controls
  // (active swatches, selected dropdown option) reflect the in-flight edit
  // immediately rather than waiting for the SSE echo. Defined here (above the
  // early returns below) so React's hook order is stable across renders.
  const demo = detail?.demo;
  const nodeOverrides = nodePending.overrides;
  const connectorOverrides = connectorPending.overrides;
  // Inspector single-shot: only opens when EXACTLY one entity is selected
  // (single node or single connector, not a mixed selection). Multi-select
  // US-003: panel target comes from explicit click events (panelNodeId /
  // panelConnectorId), NOT from selectedIds. Selection still drives the ring
  // and the style strip; opening the inspector is now a separate signal so
  // dragging a node doesn't pop the panel open. The lookup-returns-null
  // path also closes the panel automatically when the referenced entity is
  // removed (delete, undo, demo reload).
  const inspectedNode = useMemo<DemoNode | null>(() => {
    if (!panelNodeId) return null;
    const found = demo?.nodes.find((n) => n.id === panelNodeId);
    if (!found) return null;
    const ov = nodeOverrides[panelNodeId];
    if (!ov) return found;
    const data = ov.data ? { ...found.data, ...ov.data } : found.data;
    return { ...found, ...ov, data } as DemoNode;
  }, [demo, panelNodeId, nodeOverrides]);
  const inspectedConnector = useMemo<Connector | null>(() => {
    if (!panelConnectorId) return null;
    const found = demo?.connectors.find((c) => c.id === panelConnectorId);
    if (!found) return null;
    const ov = connectorOverrides[panelConnectorId];
    return ov ? ({ ...found, ...ov } as Connector) : found;
  }, [demo, panelConnectorId, connectorOverrides]);

  // Style-strip arrays: every selected entity (with optimistic overrides
  // merged) so the strip can fan out edits across the multi-selection.
  const selectedNodes = useMemo<DemoNode[]>(() => {
    if (!demo || selectedIds.length === 0) return [];
    const byId = new Map(demo.nodes.map((n) => [n.id, n]));
    const out: DemoNode[] = [];
    for (const id of selectedIds) {
      const found = byId.get(id);
      if (!found) continue;
      const ov = nodeOverrides[id];
      if (!ov) {
        out.push(found);
        continue;
      }
      const data = ov.data ? { ...found.data, ...ov.data } : found.data;
      out.push({ ...found, ...ov, data } as DemoNode);
    }
    return out;
  }, [demo, selectedIds, nodeOverrides]);
  const selectedConnectorsList = useMemo<Connector[]>(() => {
    if (!demo || selectedConnectorIds.length === 0) return [];
    const byId = new Map(demo.connectors.map((c) => [c.id, c]));
    const out: Connector[] = [];
    for (const id of selectedConnectorIds) {
      const found = byId.get(id);
      if (!found) continue;
      const ov = connectorOverrides[id];
      out.push(ov ? ({ ...found, ...ov } as Connector) : found);
    }
    return out;
  }, [demo, selectedConnectorIds, connectorOverrides]);

  // Reorder server nodes according to the optimistic z-order override
  // (US-006). Nodes not in the override (e.g. just-pasted ones whose echo
  // arrived after the reorder) are appended at the end so they render on top
  // until the next echo subsumes the override.
  const orderedNodes = useMemo<DemoNode[] | null>(() => {
    if (!demo) return null;
    if (!nodeOrderOverride) return demo.nodes;
    const byId = new Map(demo.nodes.map((n) => [n.id, n]));
    const ordered: DemoNode[] = [];
    const seen = new Set<string>();
    for (const id of nodeOrderOverride) {
      const n = byId.get(id);
      if (n) {
        ordered.push(n);
        seen.add(id);
      }
    }
    for (const n of demo.nodes) {
      if (!seen.has(n.id)) ordered.push(n);
    }
    return ordered;
  }, [demo, nodeOrderOverride]);

  if (!summary) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-background p-6 text-center">
        <p className="text-sm font-medium">Unknown demo: {slug}</p>
        <p className="text-xs text-muted-foreground">
          The slug may have been removed. Re-register from the project repo to bring it back.
        </p>
      </div>
    );
  }

  if (loading && !detail) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
        Loading demo…
      </div>
    );
  }

  const inspectedRun = panelNodeId ? runs[panelNodeId] : undefined;
  const inspectedEvents = panelNodeId ? (nodeEvents[panelNodeId] ?? []) : [];

  return (
    <div className="relative h-full w-full">
      {detail && !detail.valid ? (
        <div
          data-testid="demo-error-banner"
          className="absolute inset-x-0 top-0 z-10 border-b border-rose-500/40 bg-rose-50 px-4 py-2 text-xs text-rose-900 shadow-sm dark:bg-rose-950/40 dark:text-rose-100"
        >
          <span className="font-medium uppercase tracking-wide">Invalid demo: </span>
          <span className="font-mono">{detail.error}</span>
        </div>
      ) : null}

      {demo ? (
        <DemoCanvas
          nodes={orderedNodes ?? demo.nodes}
          connectors={demo.connectors}
          selectedNodeIds={selectedIds}
          selectedConnectorIds={selectedConnectorIds}
          onSelectionChange={onSelectionChange}
          runs={runs}
          onPlayNode={onPlayNode}
          nodeOverrides={nodeOverrides}
          connectorOverrides={connectorOverrides}
          onNodePositionChange={onNodePositionChange}
          onNodeResize={onNodeResize}
          onNodeLabelChange={onNodeLabelChange}
          onNodeDescriptionChange={onNodeDescriptionChange}
          onConnectorLabelChange={onConnectorLabelChange}
          onCreateShapeNode={onCreateShapeNode}
          onCreateConnector={onCreateConnector}
          onReconnectConnector={onReconnectConnector}
          onReorderNode={onReorderNode}
          onDeleteNode={onDeleteNode}
          onCopyNode={(nodeId) => onCopyNodes([nodeId])}
          onPasteAt={onPasteNodes}
          hasClipboard={hasClipboard}
          selectedNodes={selectedNodes}
          selectedConnectors={selectedConnectorsList}
          onStyleNode={onStyleNode}
          onStyleNodePreview={onStyleNodePreview}
          onStyleNodes={onStyleNodes}
          onStyleNodesPreview={onStyleNodesPreview}
          onStyleConnector={onStyleConnector}
          onStyleConnectorPreview={onStyleConnectorPreview}
          onRfInit={onRfInit}
          onTidy={demoNodes ? onToolbarTidy : undefined}
          onNodeClick={onNodeClickOpenPanel}
          onConnectorClick={onConnectorClickOpenPanel}
          onPaneClick={onPaneClickClosePanel}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
          No demo data yet.
        </div>
      )}

      {editError ? (
        <div
          data-testid="edit-error-banner"
          className="absolute inset-x-0 bottom-4 z-20 mx-auto w-fit max-w-[80%] rounded-md border border-rose-500/50 bg-rose-50 px-3 py-2 text-xs text-rose-900 shadow-md dark:bg-rose-950/60 dark:text-rose-100"
        >
          <span className="font-medium">Couldn't save change: </span>
          <span className="font-mono">{editError}</span>
          <button
            type="button"
            className="ml-3 underline underline-offset-2"
            onClick={() => setEditError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <DetailPanel
        demoId={detail?.id ?? null}
        node={inspectedNode}
        connector={inspectedConnector}
        filePath={detail?.filePath}
        run={inspectedRun}
        recentEvents={inspectedEvents}
        onClose={() => {
          // US-003: panel state is decoupled from selection — closing the
          // panel only clears the open-target. The user's selection ring
          // (and the style strip it drives) is preserved.
          setPanelNodeId(null);
          setPanelConnectorId(null);
        }}
      />
    </div>
  );
}
