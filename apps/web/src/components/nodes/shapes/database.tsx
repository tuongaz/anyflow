import type { ShapePartProps } from '@/components/nodes/shapes/types';

// US-009: theme-aware CSS-var fallbacks. The vars aren't defined globally
// (yet) — they're documented hooks for future theming. When the
// caller-resolved prop is undefined, the SVG inherits whatever value the
// surrounding CSS context provides, falling through to the host's currentColor
// when no var binding exists.
const BORDER_FALLBACK = 'var(--anydemo-node-border)';
const BG_FALLBACK = 'var(--anydemo-node-bg)';

const DEFAULT_STROKE_WIDTH = 2;

function dashFor(style: ShapePartProps['borderStyle']): string | undefined {
  if (style === 'dashed') return '6 4';
  if (style === 'dotted') return '2 4';
  return undefined;
}

// Standard database glyph (cylinder seen from front). Composition is the three
// pieces the PRD calls out:
//   1. Body rect — rectangular fill between the two ellipse rims; left + right
//      vertical sides drawn as separate lines so the rect's own top/bottom
//      edges (which would visually cut across the cylinder) stay invisible.
//   2. Top ellipse — full ellipse for the disc rim, drawn last so its fill
//      covers the body rect's top edge and its stroke renders both the back
//      (above) and the front (lip inside the cylinder) halves.
//   3. Bottom arc — front-only curve at the bottom of the cylinder. Back-arc
//      is intentionally omitted (the body occludes it from this angle).
export function DatabaseShape({
  width,
  height,
  borderColor,
  backgroundColor,
  borderSize,
  borderStyle,
}: ShapePartProps) {
  // Per PRD: `ellipseRy = clamp(height * 0.12, 6, 28)` — a proportional rim
  // height that stays in a readable band as the cylinder is resized.
  const ry = Math.max(6, Math.min(28, height * 0.12));
  const rx = width / 2;
  const cx = width / 2;

  const stroke = borderColor ?? BORDER_FALLBACK;
  const fill = backgroundColor ?? BG_FALLBACK;
  const strokeWidth = borderSize ?? DEFAULT_STROKE_WIDTH;
  const dash = dashFor(borderStyle);

  // Front-bottom arc: sweep-flag=1 traces the lower half of the bottom ellipse
  // (the visible front curve when looking at the cylinder from the front).
  const bottomArcPath = `M 0 ${height - ry} A ${rx} ${ry} 0 0 1 ${width} ${height - ry}`;

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Database"
      data-testid="database-shape"
    >
      <title>Database</title>
      <rect x={0} y={ry} width={width} height={Math.max(0, height - 2 * ry)} fill={fill} />
      <line
        x1={0}
        y1={ry}
        x2={0}
        y2={height - ry}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
      <line
        x1={width}
        y1={ry}
        x2={width}
        y2={height - ry}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
      <path
        d={bottomArcPath}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
      <ellipse
        cx={cx}
        cy={ry}
        rx={rx}
        ry={ry}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray={dash}
      />
    </svg>
  );
}
