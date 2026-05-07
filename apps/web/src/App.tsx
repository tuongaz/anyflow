import { Header } from '@/components/header';
import { ReloadIndicator } from '@/components/reload-indicator';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDemoData } from '@/hooks/use-demo-data';
import { useDemos } from '@/hooks/use-demos';
import { useNodeEvents } from '@/hooks/use-node-events';
import { useNodeRuns } from '@/hooks/use-node-runs';
import { useStudioEvents } from '@/hooks/use-studio-events';
import { playNode } from '@/lib/api';
import { usePathname } from '@/lib/router';
import { DemoView } from '@/pages/demo-view';
import { StudioHome } from '@/pages/studio-home';
import { useCallback } from 'react';

const matchDemoSlug = (pathname: string): string | null => {
  if (!pathname.startsWith('/d/')) return null;
  const slug = pathname.slice('/d/'.length);
  return slug.length > 0 ? decodeURIComponent(slug) : null;
};

export function App() {
  const pathname = usePathname();
  const { demos, refresh: refreshDemos } = useDemos();
  const slug = matchDemoSlug(pathname);

  const currentSummary = slug ? (demos ?? []).find((d) => d.slug === slug) : undefined;
  const demoId = currentSummary?.id ?? null;

  const { detail, loading, refresh: refreshDetail } = useDemoData(demoId);
  const { runs, apply: applyRun } = useNodeRuns(demoId);
  const { events: nodeEvents, apply: applyNodeEvent } = useNodeEvents(demoId);

  const onReload = useCallback(() => {
    refreshDetail();
    refreshDemos();
  }, [refreshDetail, refreshDemos]);

  const onEvent = useCallback(
    (event: Parameters<typeof applyRun>[0]) => {
      applyRun(event);
      applyNodeEvent(event);
    },
    [applyRun, applyNodeEvent],
  );

  const { lastReload } = useStudioEvents(demoId, { onReload, onEvent });

  const onPlayNode = useCallback(
    (nodeId: string) => {
      if (!demoId) return;
      // Fire and forget — the SSE node:* events drive the UI; the synchronous
      // response is currently surfaced through the same SSE stream.
      playNode(demoId, nodeId).catch((err) => {
        applyRun({
          type: 'node:error',
          nodeId,
          message: err instanceof Error ? err.message : String(err),
          ts: Date.now(),
        });
      });
    },
    [demoId, applyRun],
  );

  if (demos === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex h-full w-full flex-col bg-background text-foreground">
        <Header
          demos={demos}
          currentSlug={slug ?? undefined}
          trailing={demoId ? <ReloadIndicator lastReload={lastReload} /> : null}
        />
        <main className="min-h-0 flex-1">
          {slug ? (
            <DemoView
              slug={slug}
              demos={demos}
              detail={detail}
              loading={loading}
              runs={runs}
              nodeEvents={nodeEvents}
              onPlayNode={onPlayNode}
            />
          ) : (
            <StudioHome demos={demos} />
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
