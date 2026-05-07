import { Canvas } from '@/components/canvas';
import { EmptyState } from '@/components/empty-state';
import type { DemoSummary } from '@/lib/api';

export interface StudioHomeProps {
  demos: DemoSummary[];
}

export function StudioHome({ demos }: StudioHomeProps) {
  if (demos.length === 0) return <EmptyState />;
  return (
    <div className="relative h-full w-full">
      <Canvas />
      <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
        <div className="rounded-md border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
          Press <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">⌘K</kbd> to open
          a demo
        </div>
      </div>
    </div>
  );
}
