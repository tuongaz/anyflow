import { IconPickerPopover } from '@/components/icon-picker-popover';
import type { ShapeKind } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Circle, Square, Sticker, StickyNote, Type } from 'lucide-react';

export interface CanvasToolbarProps {
  /** Currently armed draw shape, or null when not in draw mode. */
  activeShape: ShapeKind | null;
  /** Toggles draw mode for the given shape; pass null to exit. */
  onSelectShape: (shape: ShapeKind | null) => void;
  /**
   * US-013 (icon picker): controlled-open state for the insert-icon popover.
   * The Insert icon button anchors the IconPickerPopover; the toolbar's parent
   * (demo-canvas) owns the open/close lifecycle so the same slice can serve
   * insert and replace modes from different call sites.
   */
  iconPickerOpen?: boolean;
  /** Open the picker in insert mode. Wired to the toolbar button's click. */
  onOpenIconPicker?: () => void;
  /** Close the picker (outside-click / ESC / programmatic). */
  onCloseIconPicker?: () => void;
  /**
   * Receive the picked icon name. When all four icon-picker props are omitted
   * the Insert icon button is hidden.
   */
  onPickIcon?: (name: string) => void;
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

const INSERT_ICON_LABEL = 'Insert icon';

// US-020: the "Tidy layout" (Auto Align) button used to live here, between the
// shapes and the icon picker. It moved to the bottom-left Controls cluster in
// demo-canvas.tsx so all canvas-view actions (zoom, fit, auto align) live in
// one consistent place. The keyboard shortcut (⌘⇧L) is unchanged.
export function CanvasToolbar({
  activeShape,
  onSelectShape,
  iconPickerOpen,
  onOpenIconPicker,
  onCloseIconPicker,
  onPickIcon,
}: CanvasToolbarProps) {
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
      {onPickIcon ? (
        <>
          <div className="my-1 h-px w-6 bg-border" aria-hidden="true" />
          <IconPickerPopover
            open={iconPickerOpen ?? false}
            onOpenChange={(next) => {
              if (next) onOpenIconPicker?.();
              else onCloseIconPicker?.();
            }}
            anchor={
              <button
                type="button"
                data-testid="toolbar-insert-icon"
                aria-label={INSERT_ICON_LABEL}
                aria-pressed={iconPickerOpen ?? false}
                title={INSERT_ICON_LABEL}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors',
                  iconPickerOpen
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <Sticker className="h-4 w-4" aria-hidden="true" />
              </button>
            }
            onPick={onPickIcon}
          />
        </>
      ) : null}
    </div>
  );
}
