import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getStored, setStored, startResizeGesture } from '../lib/view-detail-panel-width';
import type { DemoNode } from '../types';

interface ViewDetailPanelProps {
  node: DemoNode;
  onClose: () => void;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

const HEADER_HEIGHT = 52;

const panelBaseStyle: React.CSSProperties = {
  position: 'fixed',
  top: HEADER_HEIGHT,
  right: 0,
  height: `calc(100% - ${HEADER_HEIGHT}px)`,
  background: '#fff',
  borderLeft: '1px solid #e2e8f0',
  display: 'flex',
  flexDirection: 'column',
  zIndex: 10,
  boxShadow: '-4px 0 16px rgba(0,0,0,0.06)',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  padding: '16px 16px 12px',
  borderBottom: '1px solid #e2e8f0',
  gap: 8,
};

const closeStyle: React.CSSProperties = {
  flexShrink: 0,
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: 4,
  color: '#94a3b8',
  borderRadius: 4,
  display: 'flex',
  alignItems: 'center',
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '16px',
};

export function ViewDetailPanel({ node, onClose }: ViewDetailPanelProps) {
  const isMobile = useIsMobile();
  const data = node.data as unknown as Record<string, string | undefined>;
  const name = data.name ?? '';
  const description = data.description ?? '';
  const detail = data.detail ?? '';

  const [width, setWidth] = useState<number>(() => getStored());

  const panelStyle: React.CSSProperties = isMobile
    ? { ...panelBaseStyle, top: 0, height: '100%', width: '100%', zIndex: 30 }
    : { ...panelBaseStyle, width };

  const dragHandleStyle: React.CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    height: '100%',
    width: 6,
    cursor: 'col-resize',
    zIndex: 11,
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    startResizeGesture(width, e.clientX, {
      onWidth: setWidth,
      onCommit: setStored,
    });
  };

  return (
    <div style={panelStyle}>
      {!isMobile && (
        <div
          style={dragHandleStyle}
          onPointerDown={handlePointerDown}
          aria-label="Resize detail panel"
        />
      )}
      <div style={headerStyle}>
        <div>
          {name && (
            <div style={{ fontWeight: 600, fontSize: 15, color: '#0f172a', marginBottom: 2 }}>
              {name}
            </div>
          )}
          {description && <div style={{ fontSize: 13, color: '#64748b' }}>{description}</div>}
        </div>
        <button type="button" style={closeStyle} onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div style={bodyStyle}>
        {detail ? (
          <div className="prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail}</ReactMarkdown>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: '#94a3b8', fontStyle: 'italic' }}>
            No details available.
          </p>
        )}
      </div>
    </div>
  );
}
