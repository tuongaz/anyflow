import { Background, Controls, ReactFlow } from '@xyflow/react';

import '@xyflow/react/dist/style.css';

export function Canvas() {
  return (
    <div data-testid="seeflow-canvas" className="h-full w-full">
      <ReactFlow nodes={[]} edges={[]} proOptions={{ hideAttribution: true }} fitView>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
