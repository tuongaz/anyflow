import { Header } from '@/components/header';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useDemoData } from '@/hooks/use-demo-data';
import { useDemos } from '@/hooks/use-demos';
import { useNodeEvents } from '@/hooks/use-node-events';
import { useNodeRuns } from '@/hooks/use-node-runs';
import { useStudioEvents } from '@/hooks/use-studio-events';
import { type CreateProjectResult, playNode, resetDemo } from '@/lib/api';
import { pickInitialDemo, readLastProjectId, writeLastProjectId } from '@/lib/last-project';
import { navigate, usePathname } from '@/lib/router';
import { DemoView } from '@/pages/demo-view';
import { StudioHome } from '@/pages/studio-home';
import { useCallback, useEffect } from 'react';

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

  useStudioEvents(demoId, { onReload, onEvent });

  const onResetDemo = useCallback(async (): Promise<void> => {
    if (!demoId) return;
    try {
      await resetDemo(demoId);
    } catch (err) {
      console.error('Failed to reset demo:', err);
    }
  }, [demoId]);

  const onProjectCreated = useCallback(
    (result: CreateProjectResult) => {
      writeLastProjectId(result.id);
      refreshDemos();
    },
    [refreshDemos],
  );

  // On '/', skip the picker when there's nothing to pick: jump straight in if
  // only one demo is registered, or if the stored last-used demo still
  // resolves. Otherwise (2+ demos, no recall) StudioHome renders the picker.
  useEffect(() => {
    if (pathname !== '/') return;
    if (demos === null) return;
    const target = pickInitialDemo(demos, readLastProjectId());
    if (target) navigate(`/d/${target.slug}`);
  }, [pathname, demos]);

  // US-001: persist whichever project is currently open so we can reopen it next visit.
  useEffect(() => {
    if (currentSummary) writeLastProjectId(currentSummary.id);
  }, [currentSummary]);

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
        <Header demos={demos} currentSlug={slug ?? undefined} onProjectCreated={onProjectCreated} />
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
              onResetDemo={demoId ? onResetDemo : undefined}
            />
          ) : (
            <StudioHome demos={demos} />
          )}
        </main>
      </div>
    </TooltipProvider>
  );
}
