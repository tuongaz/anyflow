import type { Demo } from '../types';

interface ViewCanvasProps {
  demo: Demo;
  uuid: string;
}

export function ViewCanvas({ demo }: ViewCanvasProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <p>{demo.name}</p>
    </div>
  );
}
