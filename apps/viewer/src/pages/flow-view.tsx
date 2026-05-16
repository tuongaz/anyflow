import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { ViewCanvas } from '../components/view-canvas';
import type { Demo } from '../types';

const API_BASE = 'https://seeflow.dev/api';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; demo: Demo };

const centred: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100vh',
};

export function FlowView() {
  const { uuid } = useParams<{ uuid: string }>();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (!uuid) {
      setState({ status: 'error', message: 'Missing flow ID' });
      return;
    }

    const controller = new AbortController();

    fetch(`${API_BASE}/flows/${uuid}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const message =
            res.status === 404 ? 'Flow not found' : `Failed to load flow (${res.status})`;
          setState({ status: 'error', message });
          return;
        }
        const demo = (await res.json()) as Demo;
        setState({ status: 'done', demo });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        setState({ status: 'error', message: 'Failed to load flow' });
      });

    return () => controller.abort();
  }, [uuid]);

  if (state.status === 'loading') {
    return (
      <div style={centred}>
        <div className="spinner" />
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div style={centred}>
        <p style={{ color: '#64748b', fontSize: '1rem' }}>{state.message}</p>
      </div>
    );
  }

  return <ViewCanvas demo={state.demo} uuid={uuid ?? ''} />;
}
