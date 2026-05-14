import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  COMMANDS,
  type CommandCategory,
  type CommandContext,
  type CommandDef,
  type CommandId,
} from '@/lib/keyboard-shortcuts';
import { cn } from '@/lib/utils';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runCommand: (id: CommandId) => void;
  ctx: CommandContext;
}

// Order categories render in. Anything outside this list falls back to source
// order at the bottom — but every CommandCategory in keyboard-shortcuts.ts is
// covered here so that branch is defensive only.
const CATEGORY_ORDER: readonly CommandCategory[] = [
  'Edit',
  'View',
  'Tools',
  'Layout',
  'Selection',
  'Help',
];

const isEnabled = (cmd: CommandDef, ctx: CommandContext): boolean =>
  cmd.enabled ? cmd.enabled(ctx) : true;

const matchesSearch = (cmd: CommandDef, query: string): boolean => {
  if (query.length === 0) return true;
  const haystack = `${cmd.label} ${cmd.description ?? ''}`.toLowerCase();
  return haystack.includes(query);
};

type GroupedCommand = { cmd: CommandDef; enabled: boolean };
type Group = { category: CommandCategory; rows: GroupedCommand[] };

export function CommandPalette({ open, onOpenChange, runCommand, ctx }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state every time the palette opens — stale query/highlight would be
  // surprising on the next invocation.
  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlightedIndex(0);
    }
  }, [open]);

  // Flat list of currently-visible rows (post-filter, post-disable-aware) plus
  // the groups for the rendered layout. The flat list backs keyboard navigation
  // so ArrowDown/ArrowUp can move past category headings without surprise.
  const { groups, flat } = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const byCategory = new Map<CommandCategory, GroupedCommand[]>();
    for (const cmd of COMMANDS) {
      if (!matchesSearch(cmd, normalized)) continue;
      const entry: GroupedCommand = { cmd, enabled: isEnabled(cmd, ctx) };
      const bucket = byCategory.get(cmd.category);
      if (bucket) bucket.push(entry);
      else byCategory.set(cmd.category, [entry]);
    }
    const orderedCategories: CommandCategory[] = [
      ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
      ...Array.from(byCategory.keys()).filter((c) => !CATEGORY_ORDER.includes(c)),
    ];
    const builtGroups: Group[] = orderedCategories.map((category) => ({
      category,
      rows: byCategory.get(category) ?? [],
    }));
    const flatList: GroupedCommand[] = builtGroups.flatMap((g) => g.rows);
    return { groups: builtGroups, flat: flatList };
  }, [query, ctx]);

  // Clamp the highlighted index any time the visible list shrinks. Skip
  // disabled rows when picking a fresh highlight so Enter never lands on one.
  useEffect(() => {
    if (flat.length === 0) {
      setHighlightedIndex(0);
      return;
    }
    setHighlightedIndex((prev) => {
      let idx = prev;
      if (idx >= flat.length) idx = 0;
      // If the current index lands on a disabled row, advance to the next
      // enabled one. If none exist, stay put.
      if (!flat[idx]?.enabled) {
        const nextEnabled = flat.findIndex((r) => r.enabled);
        if (nextEnabled !== -1) idx = nextEnabled;
      }
      return idx;
    });
  }, [flat]);

  const moveHighlight = useCallback(
    (direction: 1 | -1) => {
      if (flat.length === 0) return;
      setHighlightedIndex((prev) => {
        // Walk in `direction` until we land on an enabled row. Bail after one
        // full lap to avoid an infinite loop if every row is disabled.
        let next = prev;
        for (let i = 0; i < flat.length; i++) {
          next = (next + direction + flat.length) % flat.length;
          if (flat[next]?.enabled) return next;
        }
        return prev;
      });
    },
    [flat],
  );

  const executeAt = useCallback(
    (index: number) => {
      const row = flat[index];
      if (!row || !row.enabled) return;
      runCommand(row.cmd.id);
      onOpenChange(false);
    },
    [flat, onOpenChange, runCommand],
  );

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveHighlight(1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveHighlight(-1);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        executeAt(highlightedIndex);
      }
    },
    [executeAt, highlightedIndex, moveHighlight],
  );

  // Scroll the highlighted row into view as the user navigates. Without this,
  // ArrowDown past the visible window strands the highlight off-screen.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLButtonElement>(
      `[data-command-row-index="${highlightedIndex}"]`,
    );
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[20%] w-[480px] max-w-[90vw] translate-y-0 gap-0 p-0 sm:max-w-[480px]"
        data-testid="command-palette"
        onOpenAutoFocus={(e) => {
          // Let our search input grab focus instead of Radix's default close
          // button — the palette is search-first.
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="border-b">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a command…"
            data-testid="command-palette-input"
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div
          ref={listRef}
          data-testid="command-palette-list"
          className="max-h-[50vh] overflow-y-auto py-1"
        >
          {flat.length === 0 ? (
            <div
              data-testid="command-palette-empty"
              className="px-4 py-6 text-center text-sm text-muted-foreground"
            >
              No commands match "{query}"
            </div>
          ) : (
            (() => {
              let runningIndex = -1;
              return groups.map((group) => (
                <div key={group.category} className="py-1">
                  <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {group.category}
                  </div>
                  {group.rows.map((row) => {
                    runningIndex += 1;
                    const index = runningIndex;
                    const isHighlighted = index === highlightedIndex;
                    return (
                      <button
                        key={row.cmd.id}
                        type="button"
                        data-testid={`command-palette-row-${row.cmd.id}`}
                        data-command-row-index={index}
                        data-highlighted={isHighlighted ? 'true' : 'false'}
                        aria-disabled={row.enabled ? undefined : true}
                        disabled={!row.enabled}
                        onMouseEnter={() => {
                          if (row.enabled) setHighlightedIndex(index);
                        }}
                        onClick={() => executeAt(index)}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm outline-none',
                          row.enabled
                            ? 'cursor-pointer text-foreground hover:bg-accent'
                            : 'cursor-not-allowed text-muted-foreground/50',
                          isHighlighted && row.enabled ? 'bg-accent' : '',
                        )}
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate font-medium">{row.cmd.label}</span>
                          {row.cmd.description ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {row.cmd.description}
                            </span>
                          ) : null}
                        </div>
                        {row.cmd.shortcut ? (
                          <kbd
                            data-testid={`command-palette-shortcut-${row.cmd.id}`}
                            className="shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                          >
                            {row.cmd.shortcut}
                          </kbd>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ));
            })()
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
