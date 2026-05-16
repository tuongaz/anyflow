import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { NODE_DEFAULT_BG_WHITE, colorTokenStyle } from '../../lib/color-tokens';
import type { NodeData } from '../../types';

export type ViewPlayNodeType = Node<NodeData & Record<string, unknown>, 'playNode'>;

const HANDLE_STYLE: CSSProperties = { opacity: 0, pointerEvents: 'none' };
const DEFAULT_W = 200;

export function ViewPlayNode({ data }: NodeProps<ViewPlayNodeType>) {
  const sized = data.width !== undefined || data.height !== undefined;
  const description = data.description ?? data.kind;
  const fontSize = data.fontSize ?? 18;
  const textColorStyle = colorTokenStyle(data.textColor, 'text');
  const nodeStyle = colorTokenStyle(data.borderColor, 'node');

  const containerStyle: CSSProperties = {
    borderColor: nodeStyle.borderColor,
    backgroundColor:
      data.backgroundColor !== undefined ? nodeStyle.backgroundColor : NODE_DEFAULT_BG_WHITE,
    ...(data.borderSize !== undefined ? { borderWidth: data.borderSize } : { borderWidth: 3 }),
    ...(data.borderStyle ? { borderStyle: data.borderStyle } : { borderStyle: 'solid' }),
    ...(data.cornerRadius !== undefined
      ? { borderRadius: data.cornerRadius }
      : { borderRadius: 8 }),
    ...(sized ? { width: '100%', height: '100%' } : { width: DEFAULT_W }),
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  };

  return (
    <div style={containerStyle} data-testid="play-node">
      <Handle type="target" position={Position.Left} id="l" style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Top} id="t" style={HANDLE_STYLE} />
      <div
        style={{
          padding: '8px',
          borderBottom: '1px solid rgba(0,0,0,0.08)',
          background: 'rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize, fontWeight: 600, lineHeight: 1.25, flex: 1, minWidth: 0, wordBreak: 'break-word', overflowWrap: 'break-word', ...textColorStyle }}>
          {data.name}
        </span>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '1px solid rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        </div>
      </div>
      <div style={{ padding: '4px 8px', flex: 1, display: 'flex', alignItems: 'center', minHeight: 0 }}>
        <span style={{ fontSize, color: '#64748b', lineHeight: 1.5, wordBreak: 'break-word', overflowWrap: 'break-word', width: '100%', ...textColorStyle }}>{description}</span>
      </div>
      <Handle type="source" position={Position.Right} id="r" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id="b" style={HANDLE_STYLE} />
    </div>
  );
}
