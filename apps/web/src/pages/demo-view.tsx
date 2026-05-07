import { DemoCanvas } from '@/components/demo-canvas';
import { DetailPanel } from '@/components/detail-panel';
import type { NodeRuns } from '@/hooks/use-node-runs';
import type { DemoDetail, DemoSummary } from '@/lib/api';
import { useEffect, useState } from 'react';

export interface DemoViewProps {
  slug: string;
  demos: DemoSummary[];
  detail: DemoDetail | null;
  loading: boolean;
  runs: NodeRuns;
  onPlayNode: (nodeId: string) => void;
}

export function DemoView({ slug, demos, detail, loading, runs, onPlayNode }: DemoViewProps) {
  const summary = demos.find((d) => d.slug === slug);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset selection when the demo id changes.
  useEffect(() => {
    setSelectedId(null);
  }, [detail?.id]);

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
          edges={demo.edges}
          selectedNodeId={selectedId}
          onSelectNode={setSelectedId}
          runs={runs}
          onPlayNode={onPlayNode}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
          No demo data yet.
        </div>
      )}

      <DetailPanel
        demoId={detail?.id ?? null}
        node={selectedNode}
        filePath={detail?.filePath}
        run={selectedRun}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
