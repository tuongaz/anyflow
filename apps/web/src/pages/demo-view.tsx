import type { DemoSummary } from '@/lib/api';

export interface DemoViewProps {
  slug: string;
  demos: DemoSummary[];
}

export function DemoView({ slug, demos }: DemoViewProps) {
  const demo = demos.find((d) => d.slug === slug);
  return (
    <div
      data-testid="anydemo-demo-view"
      className="flex h-full w-full flex-col items-center justify-center gap-2 bg-background p-6 text-center"
    >
      <p className="text-sm font-medium">demo selected: {slug}</p>
      {demo ? (
        <p className="text-xs text-muted-foreground">{demo.name}</p>
      ) : (
        <p className="text-xs text-muted-foreground">Unknown slug — demo may have been removed.</p>
      )}
    </div>
  );
}
