import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { colorTokenStyle } from '../../lib/color-tokens';
import { ICON_FALLBACK_NAME, ICON_REGISTRY } from '../../lib/icon-registry';
import type { IconNodeData } from '../../types';

export type ViewIconNodeType = Node<IconNodeData & Record<string, unknown>, 'iconNode'>;

const HANDLE_STYLE: CSSProperties = { opacity: 0, pointerEvents: 'none' };
const DEFAULT_W = 48;
const DEFAULT_H = 48;

const WARNED = new Set<string>();

export function ViewIconNode({ data }: NodeProps<ViewIconNodeType>) {
  const sized = data.width !== undefined || data.height !== undefined;

  const requested = ICON_REGISTRY[data.icon];
  if (!requested && !WARNED.has(data.icon)) {
    WARNED.add(data.icon);
    console.warn(
      `[viewIconNode] Unknown icon "${data.icon}"; falling back to "${ICON_FALLBACK_NAME}".`,
    );
  }
  const IconComponent = requested ?? ICON_REGISTRY[ICON_FALLBACK_NAME];

  const iconColor = colorTokenStyle(data.color, 'text').color ?? 'currentColor';
  const strokeWidth = data.strokeWidth ?? 2;

  const containerStyle: CSSProperties = {
    position: 'relative',
    ...(sized
      ? { width: '100%', height: '100%' }
      : { width: data.width ?? DEFAULT_W, height: data.height ?? DEFAULT_H }),
  };

  return (
    <div style={containerStyle} data-testid="icon-node">
      <Handle type="target" position={Position.Top} id="t" style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Left} id="l" style={HANDLE_STYLE} />
      {IconComponent && (
        <IconComponent
          color={iconColor}
          strokeWidth={strokeWidth}
          absoluteStrokeWidth
          aria-label={data.alt}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        />
      )}
      {data.name && (
        <span
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '100%',
            marginTop: 4,
            textAlign: 'center',
            fontSize: 12,
            color: '#64748b',
            pointerEvents: 'none',
            userSelect: 'none',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {data.name}
        </span>
      )}
      <Handle type="source" position={Position.Right} id="r" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id="b" style={HANDLE_STYLE} />
    </div>
  );
}
