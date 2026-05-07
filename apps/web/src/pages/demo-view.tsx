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
  type ShapeKind,
  createConnector,
  createNode,
  deleteConnector,
  deleteNode,
  updateConnector,
  updateNode,
  updateNodePosition,
} from '@/lib/api';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Position = { x: number; y: number };

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when the element is a form control or contentEditable surface. */
const isEditableElement = (el: Element | null): boolean => {
  if (!el) return false;
  if (EDITABLE_TAGS.has(el.tagName)) return true;
  return el instanceof HTMLElement && el.isContentEditable;
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
    setEditError(null);
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
    (source: string, target: string) => {
      if (!demoId) return;
      const id = `conn-${crypto.randomUUID()}`;
      const optimistic: DefaultConnector = { id, source, target, kind: 'default' };
      const payload = { id, source, target, kind: 'default' as const };
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

  // Drag an edge endpoint onto another node's handle to retarget it. The
  // patch only includes the field that changed (source/target). Optimistic:
  // the override snaps the edge immediately; SSE echo of the rewrite reconciles.
  const onReconnectConnector = useCallback(
    (connId: string, patch: { source?: string; target?: string }) => {
      if (!demoId) return;
      const conn = demoConnectors?.find((c) => c.id === connId);
      // Capture both endpoints so undo can reset whichever side moved (and
      // leave the other side untouched at its original value).
      const prev = conn ? { source: conn.source, target: conn.target } : null;
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
          nodes={demo.nodes}
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
        onStyleConnector={onStyleConnector}
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
