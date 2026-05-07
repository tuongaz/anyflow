import { DemoCanvas } from '@/components/demo-canvas';
import { DetailPanel } from '@/components/detail-panel';
import type { NodeEventLog } from '@/hooks/use-node-events';
import type { NodeRuns } from '@/hooks/use-node-runs';
import { type DemoDetail, type DemoSummary, updateNodePosition } from '@/lib/api';
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
  // Optimistic per-node position overrides. Set on drag-stop; cleared when
  // the next demo:reload echoes back the same coordinates (server caught up)
  // or when a PATCH fails (revert to server state).
  const [positionOverrides, setPositionOverrides] = useState<Record<string, Position>>({});
  const [positionError, setPositionError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when the demo id changes.
  useEffect(() => {
    setSelectedId(null);
    setPositionOverrides({});
    setPositionError(null);
  }, [detail?.id]);

  const demoNodes = detail?.demo?.nodes;
  // After every demo reload, drop overrides whose coordinates already match
  // the on-disk demo. Reconciling here (not skipping the broadcast on the
  // server) means an editor-driven position change still lands cleanly: the
  // override is cleared, and the next render uses the server value.
  useEffect(() => {
    if (!demoNodes) return;
    setPositionOverrides((prev) => {
      let mutated = false;
      const next: Record<string, Position> = { ...prev };
      for (const node of demoNodes) {
        const local = prev[node.id];
        if (local && local.x === node.position.x && local.y === node.position.y) {
          delete next[node.id];
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [demoNodes]);

  const demoId = detail?.id ?? null;
  const onNodePositionChange = useCallback(
    (nodeId: string, position: Position) => {
      if (!demoId) return;
      // Optimistic — the visual stays where the user dropped it without
      // waiting for the PATCH response.
      setPositionOverrides((prev) => ({ ...prev, [nodeId]: position }));
      setPositionError(null);
      updateNodePosition(demoId, nodeId, position).catch((err) => {
        // Revert: drop the override so the canvas falls back to server data.
        setPositionOverrides((prev) => {
          if (!(nodeId in prev)) return prev;
          const next = { ...prev };
          delete next[nodeId];
          return next;
        });
        setPositionError(err instanceof Error ? err.message : String(err));
      });
    },
    [demoId],
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
          onSelectNode={setSelectedId}
          runs={runs}
          onPlayNode={onPlayNode}
          positionOverrides={positionOverrides}
          onNodePositionChange={onNodePositionChange}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
          No demo data yet.
        </div>
      )}

      {positionError ? (
        <div
          data-testid="position-error-banner"
          className="absolute inset-x-0 bottom-4 z-20 mx-auto w-fit max-w-[80%] rounded-md border border-rose-500/50 bg-rose-50 px-3 py-2 text-xs text-rose-900 shadow-md dark:bg-rose-950/60 dark:text-rose-100"
        >
          <span className="font-medium">Couldn't save position: </span>
          <span className="font-mono">{positionError}</span>
          <button
            type="button"
            className="ml-3 underline underline-offset-2"
            onClick={() => setPositionError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <DetailPanel
        demoId={detail?.id ?? null}
        node={selectedNode}
        filePath={detail?.filePath}
        run={selectedRun}
        recentEvents={selectedEvents}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
