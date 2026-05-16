import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import type { CSSProperties, ReactNode } from 'react';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '../../lib/color-tokens';
import type { ShapeKind, ShapeNodeData } from '../../types';

export type ViewShapeNodeType = Node<ShapeNodeData & Record<string, unknown>, 'shapeNode'>;

const HANDLE_STYLE: CSSProperties = { opacity: 0, pointerEvents: 'none' };

const DEFAULT_SIZE: Record<ShapeKind, { width: number; height: number }> = {
  rectangle: { width: 200, height: 120 },
  ellipse: { width: 200, height: 120 },
  sticky: { width: 180, height: 180 },
  text: { width: 160, height: 40 },
  database: { width: 120, height: 140 },
  server: { width: 140, height: 120 },
  user: { width: 100, height: 140 },
  queue: { width: 220, height: 80 },
  cloud: { width: 180, height: 120 },
};

const ILLUSTRATIVE: ReadonlySet<ShapeKind> = new Set([
  'database',
  'server',
  'user',
  'queue',
  'cloud',
]);

function resolveIllustrativeColors(data: ShapeNodeData) {
  return {
    borderColor:
      colorTokenStyle(data.borderColor, 'node').borderColor ?? 'hsl(214.3, 31.8%, 91.4%)',
    backgroundColor:
      data.backgroundColor !== undefined
        ? (colorTokenStyle(data.backgroundColor, 'node').backgroundColor ?? NODE_DEFAULT_BG_WHITE)
        : NODE_DEFAULT_BG_WHITE,
  };
}

function DatabaseSvg({
  w,
  h,
  borderColor,
  backgroundColor,
  sw,
}: { w: number; h: number; borderColor: string; backgroundColor: string; sw: number }) {
  const rx = w / 2;
  const ry = Math.max(8, h * 0.12);
  return (
    <svg
      aria-hidden="true"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block' }}
    >
      <rect x={sw / 2} y={ry} width={w - sw} height={h - ry - sw / 2} fill={backgroundColor} />
      <ellipse
        cx={w / 2}
        cy={ry}
        rx={rx - sw / 2}
        ry={ry}
        fill={backgroundColor}
        stroke={borderColor}
        strokeWidth={sw}
      />
      <line x1={sw / 2} y1={ry} x2={sw / 2} y2={h - ry} stroke={borderColor} strokeWidth={sw} />
      <line
        x1={w - sw / 2}
        y1={ry}
        x2={w - sw / 2}
        y2={h - ry}
        stroke={borderColor}
        strokeWidth={sw}
      />
      <ellipse
        cx={w / 2}
        cy={h - ry}
        rx={rx - sw / 2}
        ry={ry}
        fill={backgroundColor}
        stroke={borderColor}
        strokeWidth={sw}
      />
    </svg>
  );
}

function ServerSvg({
  w,
  h,
  borderColor,
  backgroundColor,
  sw,
}: { w: number; h: number; borderColor: string; backgroundColor: string; sw: number }) {
  const rowH = (h - sw) / 3;
  return (
    <svg
      aria-hidden="true"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block' }}
    >
      {(['row0', 'row1', 'row2'] as const).map((key, i) => (
        <rect
          key={key}
          x={sw / 2}
          y={sw / 2 + i * rowH}
          width={w - sw}
          height={rowH}
          fill={backgroundColor}
          stroke={borderColor}
          strokeWidth={sw}
        />
      ))}
      {(['dot0', 'dot1', 'dot2'] as const).map((key, i) => (
        <circle key={key} cx={w - 16} cy={sw / 2 + i * rowH + rowH / 2} r={4} fill={borderColor} />
      ))}
    </svg>
  );
}

function UserSvg({
  w,
  h,
  borderColor,
  backgroundColor,
  sw,
}: { w: number; h: number; borderColor: string; backgroundColor: string; sw: number }) {
  const headR = w * 0.22;
  const headCy = headR + sw;
  const bodyTop = headCy + headR + 4;
  return (
    <svg
      aria-hidden="true"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block' }}
    >
      <circle
        cx={w / 2}
        cy={headCy}
        r={headR}
        fill={backgroundColor}
        stroke={borderColor}
        strokeWidth={sw}
      />
      <path
        d={`M ${sw} ${h - sw / 2} Q ${sw} ${bodyTop} ${w / 2} ${bodyTop} Q ${w - sw} ${bodyTop} ${w - sw} ${h - sw / 2}`}
        fill={backgroundColor}
        stroke={borderColor}
        strokeWidth={sw}
      />
    </svg>
  );
}

function QueueSvg({
  w,
  h,
  borderColor,
  backgroundColor,
  sw,
}: { w: number; h: number; borderColor: string; backgroundColor: string; sw: number }) {
  const cells = 4;
  const cellW = (w - sw) / cells;
  return (
    <svg
      aria-hidden="true"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block' }}
    >
      <rect
        x={sw / 2}
        y={sw / 2}
        width={w - sw}
        height={h - sw}
        rx={(h - sw) / 2}
        fill={backgroundColor}
        stroke={borderColor}
        strokeWidth={sw}
      />
      {(['d1', 'd2', 'd3'] as const).map((key, i) => (
        <line
          key={key}
          x1={sw / 2 + (i + 1) * cellW}
          y1={sw / 2}
          x2={sw / 2 + (i + 1) * cellW}
          y2={h - sw / 2}
          stroke={borderColor}
          strokeWidth={sw / 2}
        />
      ))}
    </svg>
  );
}

function CloudSvg({
  w,
  h,
  borderColor,
  backgroundColor,
  sw,
}: { w: number; h: number; borderColor: string; backgroundColor: string; sw: number }) {
  const cy = h * 0.55;
  const r1 = h * 0.22;
  return (
    <svg
      aria-hidden="true"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: 'block' }}
    >
      <ellipse cx={w * 0.28} cy={cy} rx={w * 0.22} ry={r1} fill={backgroundColor} />
      <ellipse
        cx={w * 0.55}
        cy={cy - r1 * 0.5}
        rx={w * 0.24}
        ry={r1 * 1.1}
        fill={backgroundColor}
      />
      <ellipse cx={w * 0.78} cy={cy} rx={w * 0.18} ry={r1 * 0.85} fill={backgroundColor} />
      <rect x={sw / 2} y={cy} width={w - sw} height={h * 0.35} fill={backgroundColor} />
      <path
        d={`M ${sw / 2} ${cy + h * 0.35}
            L ${sw / 2} ${cy}
            A ${w * 0.22} ${r1} 0 0 1 ${w * 0.06} ${cy - r1 * 0.3}
            A ${w * 0.22} ${r1} 0 0 1 ${w * 0.28} ${cy - r1}
            A ${w * 0.24} ${r1 * 1.1} 0 0 1 ${w * 0.31} ${cy - r1 * 1.4}
            A ${w * 0.24} ${r1 * 1.1} 0 0 1 ${w * 0.79} ${cy - r1 * 1.3}
            A ${w * 0.18} ${r1 * 0.85} 0 0 1 ${w * 0.96} ${cy - r1 * 0.2}
            A ${w * 0.18} ${r1 * 0.85} 0 0 1 ${w - sw / 2} ${cy}
            L ${w - sw / 2} ${cy + h * 0.35}
            Z`}
        fill={backgroundColor}
        stroke={borderColor}
        strokeWidth={sw}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ViewShapeNode({ data }: NodeProps<ViewShapeNodeType>) {
  const shape = data.shape;
  const defaultSize = DEFAULT_SIZE[shape];
  const sized = data.width !== undefined || data.height !== undefined;
  const w = data.width ?? defaultSize.width;
  const h = data.height ?? defaultSize.height;
  const fontSize = data.fontSize ?? 22;
  const isText = shape === 'text';
  const isIllustrative = ILLUSTRATIVE.has(shape);

  const textColorStyle =
    data.textColor !== undefined
      ? colorTokenStyle(data.textColor, 'text')
      : isText
        ? colorTokenStyle(data.borderColor, 'text')
        : {};

  const { borderColor, backgroundColor } = resolveIllustrativeColors(data);
  const sw = data.borderSize ?? 2;

  let illustrativeOverlay: ReactNode = null;
  if (isIllustrative) {
    const props = { w, h, borderColor, backgroundColor, sw };
    illustrativeOverlay = (
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {shape === 'database' && <DatabaseSvg {...props} />}
        {shape === 'server' && <ServerSvg {...props} />}
        {shape === 'user' && <UserSvg {...props} />}
        {shape === 'queue' && <QueueSvg {...props} />}
        {shape === 'cloud' && <CloudSvg {...props} />}
      </div>
    );
  }

  const isHeaderShape = shape === 'rectangle';
  const hasName = data.name !== undefined && data.name !== '';
  const useHeaderLayout = isHeaderShape && hasName;

  const description = data.description ?? '';

  let borderStyle: CSSProperties = {};
  if (!isText && !isIllustrative) {
    borderStyle = {
      border: `${sw}px ${data.borderStyle ?? 'solid'} ${borderColor}`,
      backgroundColor:
        shape === 'sticky'
          ? data.backgroundColor !== undefined
            ? colorTokenStyle(data.backgroundColor, 'node').backgroundColor
            : 'hsl(48, 100%, 96%)'
          : data.backgroundColor !== undefined
            ? colorTokenStyle(data.backgroundColor, 'node').backgroundColor
            : NODE_DEFAULT_BG_WHITE,
      ...(data.cornerRadius !== undefined && (shape === 'rectangle' || shape === 'sticky')
        ? { borderRadius: data.cornerRadius }
        : {}),
    };
  }

  const sizeStyle: CSSProperties = sized
    ? { width: '100%', height: '100%' }
    : { width: w, height: h };

  const labelFontStyle: CSSProperties = { fontSize, fontWeight: 500, ...textColorStyle };

  const containerStyle: CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    ...sizeStyle,
    ...(shape === 'ellipse' ? { borderRadius: '50%', ...borderStyle } : {}),
    ...(shape === 'sticky'
      ? {
          borderRadius: 6,
          transform: 'rotate(-1deg)',
          boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
          ...borderStyle,
        }
      : {}),
    ...(shape === 'rectangle' ? { borderRadius: 8, ...borderStyle } : {}),
    ...(shape === 'text' ? {} : {}),
    ...(isIllustrative ? {} : {}),
  };

  const nonTextNonIllustrative = !isText && !isIllustrative;

  const finalContainerStyle: CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    ...sizeStyle,
    ...(useHeaderLayout
      ? { flexDirection: 'column' }
      : { alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 8 }),
    ...(shape === 'ellipse' ? { borderRadius: '50%' } : {}),
    ...(shape === 'sticky'
      ? { borderRadius: 6, transform: 'rotate(-1deg)', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }
      : {}),
    ...(shape === 'rectangle' && data.cornerRadius !== undefined
      ? { borderRadius: data.cornerRadius }
      : shape === 'rectangle'
        ? { borderRadius: 8 }
        : {}),
    ...(nonTextNonIllustrative ? borderStyle : {}),
  };

  return (
    <div style={finalContainerStyle} data-testid="shape-node" data-shape={shape}>
      {illustrativeOverlay}
      {!isText && (
        <>
          <Handle type="target" position={Position.Top} id="t" style={HANDLE_STYLE} />
          <Handle type="target" position={Position.Left} id="l" style={HANDLE_STYLE} />
        </>
      )}
      {useHeaderLayout ? (
        <>
          <div
            style={{
              padding: '6px 8px',
              borderBottom: '1px solid rgba(0,0,0,0.08)',
              background: 'rgba(0,0,0,0.03)',
              flexShrink: 0,
            }}
          >
            <span style={{ ...labelFontStyle, fontSize: 18 }}>{data.name}</span>
          </div>
          {description && (
            <div style={{ padding: '6px 8px', flex: 1, display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 16, color: '#64748b', ...textColorStyle }}>
                {description}
              </span>
            </div>
          )}
        </>
      ) : (
        <span
          style={{
            position: 'relative',
            ...labelFontStyle,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {data.name ?? description}
        </span>
      )}
      {!isText && (
        <>
          <Handle type="source" position={Position.Right} id="r" style={HANDLE_STYLE} />
          <Handle type="source" position={Position.Bottom} id="b" style={HANDLE_STYLE} />
        </>
      )}
    </div>
  );
}
