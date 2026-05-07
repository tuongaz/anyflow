import type { ShapeKind } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Circle, Square, StickyNote } from 'lucide-react';

export interface CanvasToolbarProps {
  /** Currently armed draw shape, or null when not in draw mode. */
  activeShape: ShapeKind | null;
  /** Toggles draw mode for the given shape; pass null to exit. */
  onSelectShape: (shape: ShapeKind | null) => void;
}

interface ShapeEntry {
  shape: ShapeKind;
  label: string;
  Icon: typeof Square;
}

const SHAPES: ShapeEntry[] = [
  { shape: 'rectangle', label: 'Rectangle', Icon: Square },
  { shape: 'ellipse', label: 'Ellipse', Icon: Circle },
  { shape: 'sticky', label: 'Sticky note', Icon: StickyNote },
];

export function CanvasToolbar({ activeShape, onSelectShape }: CanvasToolbarProps) {
  return (
    <div
      data-testid="canvas-toolbar"
      className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-md backdrop-blur"
    >
      {SHAPES.map(({ shape, label, Icon }) => {
        const active = activeShape === shape;
        return (
          <button
            key={shape}
            type="button"
            data-testid={`toolbar-shape-${shape}`}
            data-active={active ? 'true' : 'false'}
            aria-pressed={active}
            aria-label={label}
            title={label}
            onClick={() => onSelectShape(active ? null : shape)}
            className={cn(
              'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
              active
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
