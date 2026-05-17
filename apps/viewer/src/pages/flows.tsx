import { useCallback, useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';
import { FlowCard } from '../components/flow-card';
import { fetchFlows } from '../lib/viewer-api';
import type { FlowListItem } from '../types';

const LIMIT = 20;

function SkeletonCard() {
  return (
    <div
      className="animate-pulse"
      style={{
        border: '1px solid #e4e4e7',
        borderRadius: '8px',
        overflow: 'hidden',
        background: '#fff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ width: '100%', aspectRatio: '16 / 9', background: '#f1f5f9' }} />
      <div
        style={{
          padding: '8px 12px',
          display: 'flex',
          justifyContent: 'space-between',
          gap: '8px',
        }}
      >
        <div style={{ width: '60%', height: '14px', background: '#e2e8f0', borderRadius: '4px' }} />
        <div style={{ width: '20%', height: '14px', background: '#e2e8f0', borderRadius: '4px' }} />
      </div>
    </div>
  );
}

export function FlowsPage() {
  const navigate = useNavigate();
  const [flows, setFlows] = useState<FlowListItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const pageRef = useRef(1);
  const totalPagesRef = useRef<number | null>(null);

  const loadPage = useCallback(async (pageToLoad: number) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadMoreError(null);

    if (pageToLoad === 1) {
      setInitialLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const data = await fetchFlows(pageToLoad, LIMIT);
      setFlows((prev) => (pageToLoad === 1 ? data.flows : [...prev, ...data.flows]));
      setTotalPages(data.totalPages);
      totalPagesRef.current = data.totalPages;
      setPage(pageToLoad);
      pageRef.current = pageToLoad;
    } catch (err) {
      if (pageToLoad > 1) {
        const message = err instanceof Error ? err.message : 'Failed to load more flows';
        setLoadMoreError(message);
      }
    } finally {
      setInitialLoading(false);
      setLoadingMore(false);
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    loadPage(1);
  }, [loadPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const tp = totalPagesRef.current;
        if (
          entries[0]?.isIntersecting &&
          tp !== null &&
          pageRef.current < tp &&
          !loadingRef.current
        ) {
          loadPage(pageRef.current + 1);
        }
      },
      { rootMargin: '300px' },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadPage]);

  const allLoaded = totalPages !== null && page >= totalPages && flows.length > 0;

  return (
    <div
      style={{
        minHeight: '100%',
        backgroundColor: '#f8fafc',
        color: '#18181b',
        padding: '24px',
      }}
    >
      <Helmet>
        <title>Flows | SeeFlow</title>
      </Helmet>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '24px', color: '#18181b' }}>
          Flows
        </h1>

        {initialLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: LIMIT }).map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no identity
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : flows.length === 0 ? (
          <p style={{ color: '#64748b', textAlign: 'center', marginTop: '48px' }}>No flows yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {flows.map((flow) => (
              <div key={flow.uuid} style={{ maxWidth: '600px', width: '100%' }}>
                <FlowCard flow={flow} onClick={() => navigate(`/flow/${flow.uuid}`)} />
              </div>
            ))}
          </div>
        )}

        {loadingMore && (
          <p
            style={{
              textAlign: 'center',
              marginTop: '24px',
              color: '#64748b',
              fontSize: '0.875rem',
            }}
          >
            Loading more…
          </p>
        )}

        {loadMoreError && (
          <div style={{ textAlign: 'center', marginTop: '24px' }}>
            <p style={{ color: '#ef4444', fontSize: '0.875rem', marginBottom: '8px' }}>
              Failed to load more
            </p>
            <button
              type="button"
              onClick={() => loadPage(page + 1)}
              style={{
                padding: '6px 16px',
                background: 'none',
                border: '1px solid #e4e4e7',
                borderRadius: '6px',
                color: '#18181b',
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              Retry
            </button>
          </div>
        )}

        <div ref={sentinelRef} style={{ height: '1px', marginTop: '24px' }}>
          {allLoaded && (
            <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
              All flows loaded
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
