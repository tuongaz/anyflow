import {
  Controls,
  type Node,
  Panel,
  ReactFlow,
  type ReactFlowInstance,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { FileDown, Image as ImageIcon } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { convertConnector, convertNode } from '../lib/demo-to-flow';
import { UuidContext } from '../lib/uuid-context';
import type { Demo, DemoNode } from '../types';
import { ViewHtmlNode } from './nodes/view-html-node';
import { ViewIconNode } from './nodes/view-icon-node';
import { ViewImageNode } from './nodes/view-image-node';
import { ViewPlayNode } from './nodes/view-play-node';
import { ViewShapeNode } from './nodes/view-shape-node';
import { ViewStateNode } from './nodes/view-state-node';
import { ViewDetailPanel } from './view-detail-panel';
import { ViewEdge } from './view-edge';

const nodeTypes = {
  playNode: ViewPlayNode,
  stateNode: ViewStateNode,
  shapeNode: ViewShapeNode,
  imageNode: ViewImageNode,
  iconNode: ViewIconNode,
  htmlNode: ViewHtmlNode,
};

const edgeTypes = { viewEdge: ViewEdge };

const DEFAULT_EDGE_OPTIONS = { zIndex: 0 };

const exportBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 10px',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 12,
  color: '#374151',
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
};

const exportPanelStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
};

const attributionStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.85)',
  padding: '3px 8px',
  borderRadius: 4,
  fontSize: 11,
  color: '#555',
  textDecoration: 'none',
  backdropFilter: 'blur(2px)',
  border: '1px solid rgba(0,0,0,0.06)',
  lineHeight: 1.4,
};

export interface ViewCanvasProps {
  demo: Demo;
  uuid: string;
}

export function ViewCanvas({ demo, uuid }: ViewCanvasProps) {
  const initialNodes = useMemo(() => demo.nodes.map(convertNode), [demo.nodes]);
  const initialEdges = useMemo(() => demo.connectors.map(convertConnector), [demo.connectors]);
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<DemoNode | null>(null);
  const rfRef = useRef<ReactFlowInstance | null>(null);

  function handleNodeClick(_: React.MouseEvent, node: Node) {
    const demoNode = demo.nodes.find((n) => n.id === node.id) ?? null;
    setSelectedNode(demoNode);
  }

  async function captureViewport() {
    const rf = rfRef.current;
    const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!rf || !viewportEl) return null;
    const prev = rf.getViewport();
    try {
      await rf.fitView({ duration: 0, padding: 0.1 });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const dataUrl = await toPng(viewportEl, { cacheBust: true });
      const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error('Image decode failed'));
        img.src = dataUrl;
      });
      return { dataUrl, ...dims };
    } finally {
      rf.setViewport(prev, { duration: 0 });
    }
  }

  async function downloadPng() {
    const captured = await captureViewport();
    if (!captured) return;
    const a = document.createElement('a');
    a.href = captured.dataUrl;
    a.download = 'diagram.png';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadPdf() {
    const captured = await captureViewport();
    if (!captured) return;
    const orientation: 'landscape' | 'portrait' =
      captured.width > captured.height ? 'landscape' : 'portrait';
    const doc = new jsPDF({
      orientation,
      unit: 'px',
      format: [captured.width, captured.height],
      hotfixes: ['px_scaling'],
    });
    doc.addImage(captured.dataUrl, 'PNG', 0, 0, captured.width, captured.height);
    doc.save('diagram.pdf');
  }

  return (
    <UuidContext.Provider value={uuid}>
      <div style={{ width: '100%', height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={true}
          nodesConnectable={false}
          elementsSelectable={true}
          selectionOnDrag={false}
          panOnDrag={true}
          fitView
          defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
          proOptions={{ hideAttribution: true }}
          onNodeClick={handleNodeClick}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onPaneClick={() => setSelectedNode(null)}
          onInit={(rf) => {
            rfRef.current = rf;
          }}
        >
          <Controls />
          <Panel position="bottom-right">
            <a
              href="https://seeflow.dev"
              target="_blank"
              rel="noopener noreferrer"
              style={attributionStyle}
            >
              Powered by <strong>seeflow.dev</strong>
            </a>
          </Panel>
          <Panel position="top-right" style={exportPanelStyle}>
            <button type="button" style={exportBtnStyle} onClick={downloadPng} title="Download PNG">
              <ImageIcon size={13} />
              PNG
            </button>
            <button type="button" style={exportBtnStyle} onClick={downloadPdf} title="Download PDF">
              <FileDown size={13} />
              PDF
            </button>
          </Panel>
        </ReactFlow>
        {selectedNode && (
          <ViewDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
        )}
      </div>
    </UuidContext.Provider>
  );
}
