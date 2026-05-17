import type { FlowListItem } from '../types';
import { MiniCanvas } from './mini-canvas';

function relativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths}mo ago`;
  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears}y ago`;
}

export interface FlowCardProps {
  flow: FlowListItem;
  onClick: () => void;
}

export function FlowCard({ flow, onClick }: FlowCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'none',
        border: '1px solid #27272a',
        borderRadius: '8px',
        padding: 0,
        cursor: 'pointer',
        overflow: 'hidden',
        width: '100%',
        textAlign: 'left',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 9',
          background: '#09090b',
          overflow: 'hidden',
        }}
      >
        <MiniCanvas demo={flow.demo} />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          gap: '8px',
        }}
      >
        <span
          style={{
            fontSize: '0.875rem',
            color: '#e4e4e7',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {flow.name}
        </span>
        <span
          style={{
            fontSize: '0.75rem',
            color: '#71717a',
            flexShrink: 0,
          }}
        >
          {relativeDate(flow.createdAt)}
        </span>
      </div>
    </button>
  );
}
