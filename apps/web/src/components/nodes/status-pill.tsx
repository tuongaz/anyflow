import { cn } from '@/lib/utils';

export type NodeStatus = 'idle' | 'running' | 'done' | 'error';

const STYLES: Record<NodeStatus, string> = {
  idle: 'bg-muted text-muted-foreground',
  running: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 animate-pulse',
  done: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100',
  error: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100',
};

export function StatusPill({
  status,
  'data-testid': dataTestId,
}: {
  status: NodeStatus;
  'data-testid'?: string;
}) {
  return (
    <span
      data-status={status}
      data-testid={dataTestId}
      className={cn(
        'inline-flex h-5 items-center rounded-full px-1.5 py-0 font-medium text-[10px] uppercase tracking-wide',
        STYLES[status],
      )}
    >
      {status}
    </span>
  );
}
