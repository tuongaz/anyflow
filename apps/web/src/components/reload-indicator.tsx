import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { StudioEvent } from '@/hooks/use-studio-events';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

export interface ReloadIndicatorProps {
  lastReload: StudioEvent | null;
}

const FLASH_MS = 700;

export function ReloadIndicator({ lastReload }: ReloadIndicatorProps) {
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (!lastReload) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(t);
  }, [lastReload]);

  const valid = lastReload ? lastReload.valid !== false : true;
  const tooltip = !lastReload
    ? 'Watching demo file…'
    : valid
      ? `Last reload at ${new Date(lastReload.ts).toLocaleTimeString()}`
      : `Invalid: ${lastReload.error ?? 'parse error'}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="reload-indicator"
          data-state={!valid ? 'error' : flash ? 'reloading' : 'idle'}
          className={cn(
            'inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[10px] font-medium uppercase tracking-wide transition-colors',
            valid
              ? 'border-emerald-500/30 bg-emerald-50/50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100'
              : 'border-rose-500/40 bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:text-rose-100',
          )}
        >
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              valid ? 'bg-emerald-500' : 'bg-rose-500',
              flash ? 'animate-ping-fast' : '',
            )}
          />
          {valid ? 'live' : 'invalid'}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}
