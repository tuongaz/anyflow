import { DatabaseShape } from '@/components/nodes/shapes/database';
import { ServerShape } from '@/components/nodes/shapes/server';
import type { ShapePartProps } from '@/components/nodes/shapes/types';
import type { ShapeKind } from '@/lib/api';
import type { FC } from 'react';

// US-022: single source of truth for illustrative-shape dispatch. Both
// `shape-node.tsx` (the committed node) and `demo-canvas.tsx` (the drag-create
// ghost) look the renderer up here, so adding a new illustrative shape only
// requires touching this map + the per-shape SVG file. The
// `isIllustrativeShape` predicate in shape-node.tsx derives directly from
// `Object.keys(ILLUSTRATIVE_SHAPE_RENDERERS)`, keeping the chrome-suppression
// rule in lockstep with the dispatch set.
export const ILLUSTRATIVE_SHAPE_RENDERERS: Partial<Record<ShapeKind, FC<ShapePartProps>>> = {
  database: DatabaseShape,
  server: ServerShape,
};
