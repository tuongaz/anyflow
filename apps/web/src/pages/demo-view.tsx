import { DemoCanvas } from '@/components/demo-canvas';
import { DetailPanel } from '@/components/detail-panel';
import type { NodeEventLog } from '@/hooks/use-node-events';
import type { NodeRuns } from '@/hooks/use-node-runs';
import { usePendingOverrides } from '@/hooks/use-pending-overrides';
import {
  type Connector,
  type DemoDetail,
  type DemoNode,
  type DemoSummary,
  updateNode,
  updateNodePosition,
} from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';

type Position = { x: number; y: number };

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
  // time, even though the same Sheet hosts both).
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

  const demo = detail?.demo;
  const selectedNode = demo?.nodes.find((n) => n.id === selectedId) ?? null;
  const selectedConnector = demo?.connectors.find((c) => c.id === selectedConnectorId) ?? null;
  const selectedRun = selectedId ? runs[selectedId] : undefined;
  const selectedEvents = selectedId ? (nodeEvents[selectedId] ?? []) : [];

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
          nodeOverrides={nodePending.overrides}
          onNodePositionChange={onNodePositionChange}
          onNodeResize={onNodeResize}
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
        node={selectedNode}
        connector={selectedConnector}
        filePath={detail?.filePath}
        run={selectedRun}
        recentEvents={selectedEvents}
        onClose={() => {
          setSelectedId(null);
          setSelectedConnectorId(null);
        }}
      />
    </div>
  );
}
