import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  getSmoothStepPath,
} from '@xyflow/react';
import type { CSSProperties } from 'react';

export type ViewEdgeData = {
  path?: 'curve' | 'step';
  fontSize?: number;
};

export function ViewEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  label,
  markerStart,
  markerEnd,
  style,
}: EdgeProps) {
  const edgeData = data as ViewEdgeData | undefined;
  const [edgePath, labelX, labelY] =
    edgeData?.path === 'step'
      ? getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: 8,
        })
      : getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });

  const labelStyle: CSSProperties = {
    position: 'absolute',
    transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
    fontSize: edgeData?.fontSize ?? 11,
    background: 'white',
    padding: '2px 4px',
    borderRadius: 3,
    border: '1px solid hsl(214.3, 31.8%, 91.4%)',
    pointerEvents: 'none',
    userSelect: 'none',
    color: '#374151',
    whiteSpace: 'nowrap',
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={style as CSSProperties | undefined}
      />
      {label && (
        <EdgeLabelRenderer>
          <div style={labelStyle} className="nodrag nopan">
            {String(label)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
