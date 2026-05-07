import type { ShapeKind, ShapeNodeData } from '@/lib/api';
import { colorTokenStyle } from '@/lib/color-tokens';
import { cn } from '@/lib/utils';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import type { CSSProperties } from 'react';

export type ShapeNodeType = Node<ShapeNodeData & Record<string, unknown>, 'shapeNode'>;

const DEFAULT_SIZE: Record<ShapeKind, { width: number; height: number }> = {
  rectangle: { width: 200, height: 120 },
  ellipse: { width: 200, height: 120 },
  sticky: { width: 180, height: 180 },
};

const SHAPE_CLASS: Record<ShapeKind, string> = {
  rectangle: 'rounded-lg border-2 bg-transparent',
  ellipse: 'rounded-full border-2 bg-transparent',
  sticky: 'rounded-md border shadow-md -rotate-1',
};

const HANDLE_CLASS = '!h-2 !w-2 !bg-muted-foreground';

export function ShapeNode({ data, selected }: NodeProps<ShapeNodeType>) {
  const shape = data.shape;
  const size = DEFAULT_SIZE[shape];
  const width = data.width ?? size.width;
  const height = data.height ?? size.height;

  // borderColor: always pick from token (defaults to theme border).
  // backgroundColor: sticky defaults to amber; rect/ellipse stay transparent
  // (border-only) unless the author sets a background token explicitly.
  const effectiveBg = data.backgroundColor ?? (shape === 'sticky' ? 'amber' : undefined);
  const style: CSSProperties = {
    width,
    height,
    borderColor: colorTokenStyle(data.borderColor, 'node').borderColor,
    backgroundColor: effectiveBg ? colorTokenStyle(effectiveBg, 'node').backgroundColor : undefined,
  };

  return (
    <div
      className={cn(
        'group relative flex items-center justify-center p-3 text-center text-sm',
        SHAPE_CLASS[shape],
        selected ? 'ring-2 ring-ring ring-offset-2' : '',
      )}
      style={style}
      data-testid="shape-node"
      data-shape={shape}
    >
      <Handle type="target" position={Position.Top} id="t" className={HANDLE_CLASS} />
      <Handle type="target" position={Position.Left} id="l" className={HANDLE_CLASS} />
      {data.label ? (
        <span className="break-words font-medium leading-tight">{data.label}</span>
      ) : null}
      <Handle type="source" position={Position.Right} id="r" className={HANDLE_CLASS} />
      <Handle type="source" position={Position.Bottom} id="b" className={HANDLE_CLASS} />
    </div>
  );
}
