import { DemoCanvas } from '@/components/demo-canvas';
import {
  type ConnectorStylePatch,
  DetailPanel,
  type NodeStylePatch,
} from '@/components/detail-panel';
import type { NodeEventLog } from '@/hooks/use-node-events';
import type { NodeRuns } from '@/hooks/use-node-runs';
import { usePendingOverrides } from '@/hooks/use-pending-overrides';
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

  const { reset: resetNodeOverrides } = nodePending;
  const { reset: resetConnectorOverrides } = connectorPending;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on demo id change.
  useEffect(() => {
    setSelectedId(null);
    setSelectedConnectorId(null);
    resetNodeOverrides();
    resetConnectorOverrides();
    setEditError(null);
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
  useEffect(() => {
    if (demoNodes) pruneNodeOverrides(demoNodes);
  }, [demoNodes, pruneNodeOverrides]);

  useEffect(() => {
    if (demoConnectors) pruneConnectorOverrides(demoConnectors);
  }, [demoConnectors, pruneConnectorOverrides]);

  const demoId = detail?.id ?? null;
  const { setOverride: setNodeOverride, dropOverride: dropNodeOverride } = nodePending;
  const onNodePositionChange = useCallback(
    (nodeId: string, position: Position) => {
      if (!demoId) return;
      // Optimistic — the visual stays where the user dropped it without
      // waiting for the PATCH response.
      setNodeOverride(nodeId, { position });
      setEditError(null);
      updateNodePosition(demoId, nodeId, position).catch((err) => {
        // Revert: drop the override so the canvas falls back to server data.
        dropNodeOverride(nodeId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNodePosition failed', err);
      });
    },
    [demoId, setNodeOverride, dropNodeOverride],
  );

  const onNodeResize = useCallback(
    (nodeId: string, dims: { width: number; height: number }) => {
      if (!demoId) return;
      // Optimistic: keep the resized footprint pinned through the PATCH
      // round-trip + SSE echo. Cast the data partial because TS can't see
      // through the discriminated union; the override is keyed by the same
      // node id so the variant always matches at runtime.
      setNodeOverride(nodeId, {
        data: { width: dims.width, height: dims.height },
      } as Partial<DemoNode>);
      setEditError(null);
      updateNode(demoId, nodeId, dims).catch((err) => {
        dropNodeOverride(nodeId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode resize failed', err);
      });
    },
    [demoId, setNodeOverride, dropNodeOverride],
  );

  const { setOverride: setConnectorOverride, dropOverride: dropConnectorOverride } =
    connectorPending;

  // Style-tab edit on a node: border + background tokens. Cast the partial
  // through Partial<DemoNode> because the discriminated union prevents TS from
  // seeing that 'data' on the override matches the variant of the keyed node.
  const onStyleNode = useCallback(
    (nodeId: string, patch: NodeStylePatch) => {
      if (!demoId) return;
      setNodeOverride(nodeId, { data: patch } as Partial<DemoNode>);
      setEditError(null);
      updateNode(demoId, nodeId, patch).catch((err) => {
        dropNodeOverride(nodeId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode style failed', err);
      });
    },
    [demoId, setNodeOverride, dropNodeOverride],
  );

  // Style-tab edit on a connector: color, edge style, direction. Cast through
  // Partial<Connector> because the discriminated union over `kind` rejects
  // bare partials at the type level (we never change kind here, so the cast
  // is safe at runtime).
  const onStyleConnector = useCallback(
    (connId: string, patch: ConnectorStylePatch) => {
      if (!demoId) return;
      setConnectorOverride(connId, patch as Partial<Connector>);
      setEditError(null);
      updateConnector(demoId, connId, patch).catch((err) => {
        dropConnectorOverride(connId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateConnector failed', err);
      });
    },
    [demoId, setConnectorOverride, dropConnectorOverride],
  );

  const onDeleteNode = useCallback(
    (nodeId: string) => {
      if (!demoId) return;
      setEditError(null);
      // Don't optimistically remove from the canvas — the SSE echo of the
      // demo file rewrite will drop the node naturally, and a failure path
      // would need to put it back. Just clear the selection so the panel
      // closes immediately.
      setSelectedId((prev) => (prev === nodeId ? null : prev));
      deleteNode(demoId, nodeId).catch((err) => {
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('deleteNode failed', err);
      });
    },
    [demoId],
  );

  const onDeleteConnector = useCallback(
    (connId: string) => {
      if (!demoId) return;
      setEditError(null);
      setSelectedConnectorId((prev) => (prev === connId ? null : prev));
      deleteConnector(demoId, connId).catch((err) => {
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('deleteConnector failed', err);
      });
    },
    [demoId],
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

  // Inline label edit on a node (PlayNode/StateNode title or ShapeNode label).
  // Empty value is filtered out by the InlineEdit's `required` flag for
  // PlayNode/StateNode; ShapeNode labels are optional and pass through here.
  const onNodeLabelChange = useCallback(
    (nodeId: string, label: string) => {
      if (!demoId) return;
      setNodeOverride(nodeId, { data: { label } } as Partial<DemoNode>);
      setEditError(null);
      updateNode(demoId, nodeId, { label }).catch((err) => {
        dropNodeOverride(nodeId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode label failed', err);
      });
    },
    [demoId, setNodeOverride, dropNodeOverride],
  );

  // Inline description edit reuses detail.summary; we splice the new summary
  // into the existing detail object so unrelated fields (fields[],
  // dynamicSource, filePath) survive the round-trip.
  const demoNodesForDesc = detail?.demo?.nodes;
  const onNodeDescriptionChange = useCallback(
    (nodeId: string, summary: string) => {
      if (!demoId) return;
      const node = demoNodesForDesc?.find((n) => n.id === nodeId);
      if (!node || node.type === 'shapeNode') return;
      const nextDetail = { ...(node.data.detail ?? {}), summary };
      setNodeOverride(nodeId, { data: { detail: nextDetail } } as Partial<DemoNode>);
      setEditError(null);
      updateNode(demoId, nodeId, { detail: nextDetail }).catch((err) => {
        dropNodeOverride(nodeId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateNode description failed', err);
      });
    },
    [demoId, demoNodesForDesc, setNodeOverride, dropNodeOverride],
  );

  const onCreateShapeNode = useCallback(
    (shape: ShapeKind, position: Position, dims: { width: number; height: number }) => {
      if (!demoId) return;
      setEditError(null);
      createNode(demoId, {
        type: 'shapeNode',
        position,
        data: { shape, width: dims.width, height: dims.height },
      }).catch((err) => {
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('createNode failed', err);
      });
    },
    [demoId],
  );

  const onConnectorLabelChange = useCallback(
    (connId: string, label: string) => {
      if (!demoId) return;
      setConnectorOverride(connId, { label } as Partial<Connector>);
      setEditError(null);
      updateConnector(demoId, connId, { label }).catch((err) => {
        dropConnectorOverride(connId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateConnector label failed', err);
      });
    },
    [demoId, setConnectorOverride, dropConnectorOverride],
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
      setConnectorOverride(id, optimistic as Partial<Connector>);
      setEditError(null);
      createConnector(demoId, { id, source, target, kind: 'default' }).catch((err) => {
        dropConnectorOverride(id);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('createConnector failed', err);
      });
    },
    [demoId, setConnectorOverride, dropConnectorOverride],
  );

  // Drag an edge endpoint onto another node's handle to retarget it. The
  // patch only includes the field that changed (source/target). Optimistic:
  // the override snaps the edge immediately; SSE echo of the rewrite reconciles.
  const onReconnectConnector = useCallback(
    (connId: string, patch: { source?: string; target?: string }) => {
      if (!demoId) return;
      setConnectorOverride(connId, patch as Partial<Connector>);
      setEditError(null);
      updateConnector(demoId, connId, patch).catch((err) => {
        dropConnectorOverride(connId);
        setEditError(err instanceof Error ? err.message : String(err));
        console.error('updateConnector reconnect failed', err);
      });
    },
    [demoId, setConnectorOverride, dropConnectorOverride],
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
