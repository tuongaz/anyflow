import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export interface JsonTreeProps {
  value: unknown;
  /** Depth at which collapsible nodes start collapsed. Defaults to 2. */
  collapseDepth?: number;
}

export function JsonTree({ value, collapseDepth = 2 }: JsonTreeProps) {
  return (
    <div
      className="font-mono text-[11px] leading-relaxed text-foreground/90"
      data-testid="json-tree"
    >
      <Node value={value} depth={0} collapseDepth={collapseDepth} />
    </div>
  );
}

function Node({
  value,
  depth,
  collapseDepth,
}: {
  value: unknown;
  depth: number;
  collapseDepth: number;
}) {
  if (value === null) return <span className="text-muted-foreground">null</span>;
  if (typeof value === 'boolean') return <span className="text-amber-700">{String(value)}</span>;
  if (typeof value === 'number') return <span className="text-blue-700">{value}</span>;
  if (typeof value === 'string') {
    return <span className="break-all text-emerald-700">"{value}"</span>;
  }
  if (Array.isArray(value)) {
    return <ArrayNode value={value} depth={depth} collapseDepth={collapseDepth} />;
  }
  if (typeof value === 'object') {
    return (
      <ObjectNode
        value={value as Record<string, unknown>}
        depth={depth}
        collapseDepth={collapseDepth}
      />
    );
  }
  return <span className="text-muted-foreground">{String(value)}</span>;
}

function ArrayNode({
  value,
  depth,
  collapseDepth,
}: {
  value: unknown[];
  depth: number;
  collapseDepth: number;
}) {
  const [open, setOpen] = useState(depth < collapseDepth);
  if (value.length === 0) return <span className="text-muted-foreground">[]</span>;
  return (
    <span>
      <ToggleCaret open={open} onClick={() => setOpen((o) => !o)} />
      <span className="text-muted-foreground">[{open ? '' : `${value.length} items`}]</span>
      {open ? (
        <div className="ml-3 border-l border-border/60 pl-2">
          {value.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stable index in immutable response render
            <div key={i} className="flex gap-2">
              <span className="shrink-0 text-muted-foreground">{i}:</span>
              <Node value={item} depth={depth + 1} collapseDepth={collapseDepth} />
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}

function ObjectNode({
  value,
  depth,
  collapseDepth,
}: {
  value: Record<string, unknown>;
  depth: number;
  collapseDepth: number;
}) {
  const [open, setOpen] = useState(depth < collapseDepth);
  const keys = Object.keys(value);
  if (keys.length === 0) return <span className="text-muted-foreground">{'{}'}</span>;
  return (
    <span>
      <ToggleCaret open={open} onClick={() => setOpen((o) => !o)} />
      <span className="text-muted-foreground">
        {'{'}
        {open ? '' : `${keys.length} keys`}
        {'}'}
      </span>
      {open ? (
        <div className="ml-3 border-l border-border/60 pl-2">
          {keys.map((key) => (
            <div key={key} className="flex gap-2">
              <span className="shrink-0 text-fuchsia-700">"{key}":</span>
              <Node value={value[key]} depth={depth + 1} collapseDepth={collapseDepth} />
            </div>
          ))}
        </div>
      ) : null}
    </span>
  );
}

function ToggleCaret({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mr-1 inline-flex h-3 w-3 align-middle text-muted-foreground hover:text-foreground"
      aria-label={open ? 'Collapse' : 'Expand'}
    >
      {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
    </button>
  );
}
