import { DemoCanvas } from '@/components/demo-canvas';
import {
  type ConnectorStylePatch,
  DetailPanel,
  type NodeStylePatch,
} from '@/components/detail-panel';
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);
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
    setSelectedId(null);
    setSelectedConnectorId(null);
    resetNodeOverrides();
    resetConnectorOverrides();
    setNodeOrderOverride(null);
    setEditError(null);
    clipboardRef.current = null;
    setHasClipboard(false);
    undoStack.clear();
  }, [detail?.id]);

  // Selecting a node deselects any connector and vice versa — node + connector
  // selection are mutually exclusive (the inspector renders one entity at a
  // time, even though the same Sheet hosts both). Selecting a node also opens
  // the inspector; the panel stays open as long as the user keeps interacting
  // with the same node (or any node), and only closes when interaction lands
  // outside the canvas-node surfaces (handled by SheetContent.onInteractOutside).
  const onSelectNode = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id !== null) setSelectedConnectorId(null);
  }, []);
  const onSelectConnector = useCallback((id: string | null) => {
    setSelectedConnectorId(id);
    if (id !== null) setSelectedId(null);
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
    (nodeId: string, dims: { width: number; height: number }) => {
      if (!demoId) return;
      const node = demoNodes?.find((n) => n.id === nodeId);
      const prev = node ? { width: node.data.width, height: node.data.height } : undefined;
      // Optimistic: keep the resized footprint pinned through the PATCH
      // round-trip + SSE echo. Cast the data partial because TS can't see
      // through the discriminated union; the override is keyed by the same
      // node id so the variant always matches at runtime.
      setNodeOverride(nodeId, {
        data: { width: dims.width, height: dims.height },
      } as Partial<DemoNode>);
      setEditError(null);
      markMutation();
      if (prev) {
        pushUndo({
          do: async () => {
            await updateNode(demoId, nodeId, dims);
          },
          undo: async () => {
            await updateNode(demoId, nodeId, prev);
          },
          coalesceKey: `node:${nodeId}:resize`,
        });
      }
      updateNode(demoId, nodeId, dims).catch((err) => {
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
      // would need to put it back. Just clear the selection so the panel
      // closes immediately.
      setSelectedId((prev) => (prev === nodeId ? null : prev));
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
      setSelectedConnectorId((prev) => (prev === connId ? null : prev));
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

  // Delete/Backspace shortcut: removes the selected node or connector. Skipped
  // while focus is in any text-editing element so InlineEdit / form controls
  // keep their normal Backspace behavior. The InlineEdit also calls
  // e.stopPropagation(), but the activeElement guard is the durable line of
  // defense — it covers any future input that forgets to stop the bubble.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (isEditableElement(document.activeElement)) return;
      if (selectedConnectorId) {
        e.preventDefault();
        onDeleteConnector(selectedConnectorId);
        return;
      }
      if (selectedId) {
        e.preventDefault();
        onDeleteNode(selectedId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, selectedConnectorId, onDeleteNode, onDeleteConnector]);

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
    (
      source: string,
      target: string,
      handles?: { sourceHandle?: string; targetHandle?: string },
    ) => {
      if (!demoId) return;
      const id = `conn-${crypto.randomUUID()}`;
      const sourceHandle = handles?.sourceHandle;
      const targetHandle = handles?.targetHandle;
      const optimistic: DefaultConnector = {
        id,
        source,
        target,
        ...(sourceHandle ? { sourceHandle } : {}),
        ...(targetHandle ? { targetHandle } : {}),
        kind: 'default',
      };
      const payload = {
        id,
        source,
        target,
        ...(sourceHandle ? { sourceHandle } : {}),
        ...(targetHandle ? { targetHandle } : {}),
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
      // Single-select model: pin the first pasted node as the new selection
      // so the inspector reflects the freshly-pasted entity.
      const firstNode = newNodes[0];
      if (firstNode) {
        setSelectedId(firstNode.id);
        setSelectedConnectorId(null);
      }
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

  // Cmd/Ctrl+C copies the selected node; Cmd/Ctrl+V pastes (offset by +24,+24)
  // at the canvas. Skipped while focus is in any text-editing element so the
  // browser's native copy/paste keeps working inside InlineEdit / form
  // controls. Same focus guard as the Delete/Backspace + undo handlers above.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'c' && key !== 'v') return;
      if (isEditableElement(document.activeElement)) return;
      if (key === 'c') {
        if (!selectedId) return;
        e.preventDefault();
        onCopyNodes([selectedId]);
        return;
      }
      // 'v'
      if (!clipboardRef.current) return;
      e.preventDefault();
      onPasteNodes(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, onCopyNodes, onPasteNodes]);

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
        sourceHandle?: string;
        targetHandle?: string;
      },
    ) => {
      if (!demoId) return;
      const conn = demoConnectors?.find((c) => c.id === connId);
      // Capture all four endpoint fields so undo can reset whichever side(s)
      // moved (and leave the unchanged side at its original value).
      const prev = conn
        ? {
            source: conn.source,
            target: conn.target,
            sourceHandle: conn.sourceHandle,
            targetHandle: conn.targetHandle,
          }
        : null;
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
  // The inspector renders whatever is currently selected — clicking a node
  // both selects it and opens the panel. Same merge pattern as connectors below.
  const inspectedNode = useMemo<DemoNode | null>(() => {
    if (!selectedId) return null;
    const found = demo?.nodes.find((n) => n.id === selectedId);
    if (!found) return null;
    const ov = nodeOverrides[selectedId];
    if (!ov) return found;
    const data = ov.data ? { ...found.data, ...ov.data } : found.data;
    return { ...found, ...ov, data } as DemoNode;
  }, [demo, selectedId, nodeOverrides]);
  const selectedConnector = useMemo<Connector | null>(() => {
    if (!selectedConnectorId) return null;
    const found = demo?.connectors.find((c) => c.id === selectedConnectorId);
    if (!found) return null;
    const ov = connectorOverrides[selectedConnectorId];
    return ov ? ({ ...found, ...ov } as Connector) : found;
  }, [demo, selectedConnectorId, connectorOverrides]);

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

  const inspectedRun = selectedId ? runs[selectedId] : undefined;
  const inspectedEvents = selectedId ? (nodeEvents[selectedId] ?? []) : [];

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
          selectedNodeId={selectedId}
          onSelectNode={onSelectNode}
          selectedConnectorId={selectedConnectorId}
          onSelectConnector={onSelectConnector}
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
        connector={selectedConnector}
        filePath={detail?.filePath}
        run={inspectedRun}
        recentEvents={inspectedEvents}
        onStyleNode={onStyleNode}
        onStyleNodePreview={onStyleNodePreview}
        onStyleConnector={onStyleConnector}
        onStyleConnectorPreview={onStyleConnectorPreview}
        onDeleteNode={onDeleteNode}
        onDeleteConnector={onDeleteConnector}
        onClose={() => {
          // Closing the panel clears whatever was selected — the panel and
          // the selection ring track together (clicking outside the canvas-node
          // surfaces is the only path that lands here).
          setSelectedId(null);
          setSelectedConnectorId(null);
        }}
      />
    </div>
  );
}
