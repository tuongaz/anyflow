import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import type { CSSProperties } from 'react';
import { colorTokenStyle } from '../../lib/color-tokens';
import { useUuid } from '../../lib/uuid-context';
import type { HtmlNodeData } from '../../types';

export type ViewHtmlNodeType = Node<HtmlNodeData & Record<string, unknown>, 'htmlNode'>;

const HANDLE_STYLE: CSSProperties = { opacity: 0, pointerEvents: 'none' };
const DEFAULT_W = 320;
const DEFAULT_H = 200;
const API_BASE = 'https://seeflow.dev/api/flows';

export function ViewHtmlNode({ data }: NodeProps<ViewHtmlNodeType>) {
  const uuid = useUuid();
  const sized = data.width !== undefined || data.height !== undefined;

  const containerStyle: CSSProperties = {
    ...(data.backgroundColor !== undefined
      ? { backgroundColor: colorTokenStyle(data.backgroundColor, 'node').backgroundColor }
      : {}),
    ...(data.borderColor !== undefined
      ? { borderColor: colorTokenStyle(data.borderColor, 'node').borderColor }
      : {}),
    ...(data.borderSize !== undefined ? { borderWidth: data.borderSize } : {}),
    ...(data.borderStyle !== undefined ? { borderStyle: data.borderStyle } : {}),
    ...(data.cornerRadius !== undefined ? { borderRadius: data.cornerRadius } : {}),
    ...(sized ? { width: '100%', height: '100%' } : { width: DEFAULT_W, height: DEFAULT_H }),
    position: 'relative',
    overflow: 'hidden',
  };

  const cloudSrc = uuid && data.htmlPath ? `${API_BASE}/${uuid}/files/${data.htmlPath}` : '';

  return (
    <div style={containerStyle} data-testid="html-node">
      <Handle type="target" position={Position.Top} id="t" style={HANDLE_STYLE} />
      <Handle type="target" position={Position.Left} id="l" style={HANDLE_STYLE} />
      {cloudSrc ? (
        <iframe
          src={cloudSrc}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          sandbox="allow-scripts allow-same-origin"
          title={data.name ?? 'HTML content'}
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
          {data.name ?? 'HTML'}
        </div>
      )}
      <Handle type="source" position={Position.Right} id="r" style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} id="b" style={HANDLE_STYLE} />
    </div>
  );
}
