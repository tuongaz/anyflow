/**
 * US-024: defaults injected at brand-new-node creation time so the canvas
 * reads more like a wireframe diagram than a poster. The defaults apply ONLY
 * to fresh nodes (toolbar drag-create, drop-popover create, programmatic
 * insert). Pasted clones preserve their source data verbatim — defaults are
 * never backfilled. Existing demos on disk that lack these fields keep
 * rendering via the renderer's CSS / className fallbacks (per the optional
 * schema fields in `apps/studio/src/schema.ts`).
 *
 * Per-variant scope (see PRD AC):
 *   - shape rectangle/ellipse/sticky → borderSize + fontSize
 *   - shape text                      → fontSize only (text stays chromeless)
 *   - image                           → borderWidth (image has no label text)
 *   - group                           → borderWidth (groups have no body text)
 *   - icon                            → none (schema has no borderSize/
 *                                       fontSize fields; the `text-xs`
 *                                       className already renders the icon
 *                                       caption at 12px)
 */
import type { ShapeKind } from '@/lib/api';

/** US-024 default border thickness for new nodes (1px = wireframe-style). */
export const NEW_NODE_BORDER_WIDTH = 1;
/** US-024 default label font size for new nodes (12px = compact). */
export const NEW_NODE_FONT_SIZE = 12;

export interface ShapeDataDefaults {
  // Index signature lets the result satisfy `CreateNodeBody.data`
  // (`Record<string, unknown>`) without a per-call-site cast. Every concrete
  // field below is assignable to `unknown`, so the broader type is sound.
  [key: string]: unknown;
  shape: ShapeKind;
  width: number;
  height: number;
  borderSize?: number;
  fontSize: number;
}

/** Build the `data` object for a freshly-created shape node. Text variant
 * skips `borderSize` so text shapes stay chromeless (US-003). */
export function buildNewShapeData(
  shape: ShapeKind,
  dims: { width: number; height: number },
): ShapeDataDefaults {
  if (shape === 'text') {
    return {
      shape,
      width: dims.width,
      height: dims.height,
      fontSize: NEW_NODE_FONT_SIZE,
    };
  }
  return {
    shape,
    width: dims.width,
    height: dims.height,
    borderSize: NEW_NODE_BORDER_WIDTH,
    fontSize: NEW_NODE_FONT_SIZE,
  };
}

export interface ImageDataDefaults {
  [key: string]: unknown;
  path: string;
  width: number;
  height: number;
  borderWidth: number;
}

/** Build the `data` object for a freshly-created image node. Image uses
 * `borderWidth` (US-014), not `borderSize`. No `fontSize` — image renders
 * no body text. `path` is a relative path under `<project>/.anydemo/`
 * (US-004 hard-cut from base64 data URLs). */
export function buildNewImageData(
  path: string,
  dims: { width: number; height: number },
): ImageDataDefaults {
  return {
    path,
    width: dims.width,
    height: dims.height,
    borderWidth: NEW_NODE_BORDER_WIDTH,
  };
}

export interface GroupDataDefaults {
  [key: string]: unknown;
  width: number;
  height: number;
  borderWidth: number;
}

/** Build the `data` object for a freshly-created group node. Groups use
 * `borderWidth` (US-001), not `borderSize`. No `fontSize` — groups render
 * a label slot but not body text. */
export function buildNewGroupData(dims: {
  width: number;
  height: number;
}): GroupDataDefaults {
  return {
    width: dims.width,
    height: dims.height,
    borderWidth: NEW_NODE_BORDER_WIDTH,
  };
}
