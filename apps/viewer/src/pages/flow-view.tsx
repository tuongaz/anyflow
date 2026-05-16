import { useParams } from 'react-router-dom';

export function FlowView() {
  const { uuid } = useParams<{ uuid: string }>();

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <p>Flow: {uuid}</p>
    </div>
  );
}
