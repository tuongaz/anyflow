import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '../../lib/color-tokens';
import { useUuid } from '../../lib/uuid-context';
import type { ImageNodeData } from '../../types';

export type ViewImageNodeType = Node<ImageNodeData & Record<string, unknown>, 'imageNode'>;

const HANDLE_STYLE: CSSProperties = { opacity: 0, pointerEvents: 'none' };
const DEFAULT_W = 200;
const DEFAULT_H = 150;
const API_BASE = 'https://seeflow.dev/api/flows';

export function ViewImageNode({ data }: NodeProps<ViewImageNodeType>) {
  const uuid = useUuid();
  const sized = data.width !== undefined || data.height !== undefined;

  const containerStyle: CSSProperties = {
    backgroundColor:
      data.backgroundColor !== undefined
        ? colorTokenStyle(data.backgroundColor, 'node').backgroundColor
        : NODE_DEFAULT_BG_WHITE,
    ...(data.borderColor !== undefined
      ? { borderColor: colorTokenStyle(data.borderColor, 'node').borderColor }
      : {}),
    ...(data.borderWidth !== undefined ? { borderWidth: data.borderWidth } : {}),
    ...(data.borderStyle !== undefined ? { borderStyle: data.borderStyle } : {}),
    ...(data.cornerRadius !== undefined ? { borderRadius: data.cornerRadius } : {}),
    ...(sized ? { width: '100%', height: '100%' } : { width: DEFAULT_W, height: DEFAULT_H }),
    position: 'relative',
    overflow: 'hidden',
  };

  const src = uuid && data.path ? `${API_BASE}/${uuid}/files/${data.path}` : '';

  return (
    <div style={containerStyle} data-testid="image-node">
      <Handle type="target" position={Position.Top} id="t" style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Left} id="l" style={HANDLE_STYLE} />
      {src ? (
        <img
          src={src}
          alt={data.alt ?? ''}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
          draggable={false}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94a3b8',
            fontSize: 12,
          }}
        >
          Image
        </div>
      )}
      <Handle type="source" position={Position.Right} id="r" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id="b" style={HANDLE_STYLE} />
    </div>
  );
}
