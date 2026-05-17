import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FlowCard } from '../components/flow-card';
import { fetchFlows } from '../lib/viewer-api';
import type { FlowsResponse } from '../types';

const LIMIT = 12;

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; data: FlowsResponse };

function SkeletonCard() {
  return (
    <div style={{ border: '1px solid #27272a', borderRadius: '8px', overflow: 'hidden' }}>
      <div style={{ width: '100%', aspectRatio: '16 / 9', background: '#18181b' }} />
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <div style={{ width: '60%', height: '14px', background: '#27272a', borderRadius: '4px' }} />
        <div style={{ width: '20%', height: '14px', background: '#27272a', borderRadius: '4px' }} />
      </div>
    </div>
  );
}

const paginationBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '6px 16px',
  background: 'none',
  border: '1px solid #27272a',
  borderRadius: '6px',
  color: disabled ? '#52525b' : '#e4e4e7',
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: '0.875rem',
});

export function FlowsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    setState({ status: 'loading' });
    fetchFlows(page, LIMIT)
      .then((data) => setState({ status: 'done', data }))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : 'Failed to load flows';
        setState({ status: 'error', message });
      });
  }, [page]);

  function goToPage(next: number) {
    setSearchParams({ page: String(next) });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div
      style={{
        minHeight: '100%',
        backgroundColor: '#09090b',
        color: '#e4e4e7',
        padding: '24px',
      }}
    >
      <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '24px', color: '#f4f4f5' }}>
        Flows
      </h1>

      {state.status === 'loading' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: LIMIT }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no identity
            <SkeletonCard key={i} />
          ))}
        </div>
      )}

      {state.status === 'error' && (
        <p style={{ color: '#64748b', textAlign: 'center', marginTop: '48px' }}>{state.message}</p>
      )}

      {state.status === 'done' && state.data.flows.length === 0 && (
        <p style={{ color: '#64748b', textAlign: 'center', marginTop: '48px' }}>No flows yet.</p>
      )}

      {state.status === 'done' && state.data.flows.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {state.data.flows.map((flow) => (
              <FlowCard
                key={flow.uuid}
                flow={flow}
                onClick={() => navigate(`/flow/${flow.uuid}`)}
              />
            ))}
          </div>

          {state.data.totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '16px',
                marginTop: '32px',
              }}
            >
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                disabled={page <= 1}
                style={paginationBtn(page <= 1)}
              >
                Previous
              </button>
              <span style={{ fontSize: '0.875rem', color: '#71717a' }}>
                Page {page} of {state.data.totalPages}
              </span>
              <button
                type="button"
                onClick={() => goToPage(page + 1)}
                disabled={page >= state.data.totalPages}
                style={paginationBtn(page >= state.data.totalPages)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
