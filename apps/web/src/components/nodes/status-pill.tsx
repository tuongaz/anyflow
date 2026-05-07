import { cn } from '@/lib/utils';

export type NodeStatus = 'idle' | 'running' | 'done' | 'error';

const STYLES: Record<Exclude<NodeStatus, 'idle'>, string> = {
  running: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 animate-pulse',
  done: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100',
  error: 'bg-rose-100 text-rose-900 dark:bg-rose-950/40 dark:text-rose-100',
};

// Idle is intentionally invisible — the pill is meaningful state, not chrome.
// Once a node has run, the pill becomes visible (running/done/error).
export function StatusPill({
  status,
  'data-testid': dataTestId,
}: {
  status: NodeStatus;
  'data-testid'?: string;
}) {
  if (status === 'idle') return null;
  return (
    <span
      data-status={status}
      data-testid={dataTestId}
      className={cn(
        'inline-flex h-4 items-center rounded-full px-1.5 py-0 font-normal text-[9px] uppercase tracking-wide',
        STYLES[status],
      )}
    >
      {status}
    </span>
  );
}
