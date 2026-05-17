import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams } from 'react-router-dom';

import { ViewCanvas } from '../components/view-canvas';
import { fetchFlow } from '../lib/viewer-api';
import type { Demo } from '../types';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; demo: Demo };

const centred: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
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

    fetchFlow(uuid, controller.signal)
      .then((demo) => {
        setState({ status: 'done', demo });
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Failed to load flow';
        setState({ status: 'error', message });
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

  const { name: flowName } = state.demo;
  const currentUrl = window.location.href;

  return (
    <>
      <Helmet>
        <title>{flowName} | SeeFlow</title>
        <meta property="og:title" content={`${flowName} | SeeFlow`} />
        <meta property="og:description" content="Interactive architecture diagram on SeeFlow" />
        <meta property="og:url" content={currentUrl} />
      </Helmet>
      <ViewCanvas demo={state.demo} uuid={uuid ?? ''} />
    </>
  );
}
