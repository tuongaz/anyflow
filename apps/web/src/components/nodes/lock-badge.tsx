import { cn } from '@/lib/utils';
import { Lock } from 'lucide-react';

/**
 * US-019: small lock indicator rendered on a node's top-right corner when
 * the node is locked. Absolutely positioned outside the node's content flow
 * so it never affects the node's bounding box; offset above the top edge so
 * it doesn't overlap the top-middle connection handle. Every node renderer
 * (play, state, shape, image, icon, group) reads `data.locked` and renders
 * this badge directly — there is no shared wrapper layer in xyflow we can
 * inject chrome through.
 */
export function LockBadge({ className }: { className?: string }) {
  return (
    <span
      data-testid="node-lock-badge"
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute -top-2 -right-2 z-10 inline-flex h-4 w-4 items-center justify-center rounded-sm bg-background/90 text-muted-foreground shadow-sm ring-1 ring-border',
        className,
      )}
    >
      <Lock className="h-2.5 w-2.5" strokeWidth={2.5} />
    </span>
  );
}
