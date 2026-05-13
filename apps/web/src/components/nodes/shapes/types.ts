// US-009: per-shape illustrative components live under
// `apps/web/src/components/nodes/shapes/` and all consume this single
// `ShapePartProps` shape so `shape-node.tsx` can dispatch to any of them with
// the same resolved chrome inputs.
//
// `borderColor` / `backgroundColor` are already-resolved CSS color values (the
// caller in shape-node.tsx pre-resolves them via `colorTokenStyle`), not
// `ColorToken` strings. When unset, the SVG falls through to the theme-aware
// CSS-var fallbacks documented in each shape file (`var(--anydemo-node-border)`
// / `var(--anydemo-node-bg)`).
export interface ShapePartProps {
  width: number;
  height: number;
  borderColor?: string;
  backgroundColor?: string;
  borderSize?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
}
