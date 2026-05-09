import type { ShapeKind } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Circle,
  FileImage,
  LayoutDashboard,
  Loader2,
  Square,
  StickyNote,
  Type,
} from 'lucide-react';
import { useCallback, useState } from 'react';

export interface CanvasToolbarProps {
  /** Currently armed draw shape, or null when not in draw mode. */
  activeShape: ShapeKind | null;
  /** Toggles draw mode for the given shape; pass null to exit. */
  onSelectShape: (shape: ShapeKind | null) => void;
  /**
   * Run the auto-layout (Tidy) action. When omitted, the Tidy button still
   * renders but is disabled — used while no demo is loaded.
   */
  onTidy?: () => void;
  /**
   * US-013: capture the canvas viewport and download an SVG. When omitted,
   * the Export SVG button is hidden (no demo loaded). Returning a promise
   * lets the toolbar show an in-flight spinner until the export settles.
   */
  onExportSvg?: () => Promise<unknown> | unknown;
}

export interface ToolbarShapeEntry {
  shape: ShapeKind;
  label: string;
  Icon: typeof Square;
}

// Exported so US-015's drop-on-pane popover can list the same set of creatable
// node types (matching icons + labels) without duplicating the registry.
export const TOOLBAR_SHAPES: ToolbarShapeEntry[] = [
  { shape: 'rectangle', label: 'Rectangle', Icon: Square },
  { shape: 'ellipse', label: 'Ellipse', Icon: Circle },
  { shape: 'sticky', label: 'Sticky note', Icon: StickyNote },
  { shape: 'text', label: 'Text', Icon: Type },
];

const TIDY_LABEL = 'Tidy layout (⌘⇧L)';
const EXPORT_SVG_LABEL = 'Export SVG';

export function CanvasToolbar({
  activeShape,
  onSelectShape,
  onTidy,
  onExportSvg,
}: CanvasToolbarProps) {
  const [exporting, setExporting] = useState(false);
  const handleExportSvg = useCallback(() => {
    if (!onExportSvg || exporting) return;
    setExporting(true);
    Promise.resolve(onExportSvg()).finally(() => setExporting(false));
  }, [onExportSvg, exporting]);
  return (
    <div
      data-testid="canvas-toolbar"
      className="pointer-events-auto flex flex-col items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-md backdrop-blur"
    >
      {TOOLBAR_SHAPES.map(({ shape, label, Icon }) => {
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
      <div className="my-1 h-px w-6 bg-border" aria-hidden="true" />
      <button
        type="button"
        data-testid="toolbar-tidy"
        aria-label={TIDY_LABEL}
        title={TIDY_LABEL}
        disabled={!onTidy}
        onClick={() => onTidy?.()}
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground',
        )}
      >
        <LayoutDashboard className="h-4 w-4" />
      </button>
      {onExportSvg ? (
        <button
          type="button"
          data-testid="toolbar-export-svg"
          aria-label={EXPORT_SVG_LABEL}
          title={EXPORT_SVG_LABEL}
          disabled={exporting}
          onClick={handleExportSvg}
          className={cn(
            'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-accent-foreground',
            'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground',
          )}
        >
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <FileImage className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      ) : null}
    </div>
  );
}
