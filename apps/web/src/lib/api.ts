export interface DemoSummary {
  id: string;
  slug: string;
  name: string;
  repoPath: string;
  lastModified: number;
  valid: boolean;
}

export interface HttpAction {
  kind: 'http';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  bodySchema?: unknown;
}

export interface DetailField {
  label: string;
  value: string;
}

export interface NodeDetail {
  filePath?: string;
  summary?: string;
  fields?: DetailField[];
  dynamicSource?: HttpAction;
}

export interface NodeData {
  label: string;
  kind: string;
  stateSource: { kind: 'request' | 'event' };
  detail?: NodeDetail;
  playAction?: HttpAction;
  handlerModule?: string;
}

export interface DemoNode {
  id: string;
  type: 'playNode' | 'stateNode';
  position: { x: number; y: number };
  data: NodeData;
}

export interface DemoEdge {
  id: string;
  source: string;
  target: string;
  type?: string;
  animated?: boolean;
}

export interface Demo {
  version: 1;
  name: string;
  nodes: DemoNode[];
  edges: DemoEdge[];
}

export interface DemoDetail {
  id: string;
  slug: string;
  name: string;
  filePath: string;
  demo: Demo | null;
  valid: boolean;
  error: string | null;
}

export const fetchDemos = async (): Promise<DemoSummary[]> => {
  const res = await fetch('/api/demos');
  if (!res.ok) throw new Error(`GET /api/demos failed: ${res.status}`);
  return (await res.json()) as DemoSummary[];
};

export const fetchDemoDetail = async (id: string): Promise<DemoDetail> => {
  const res = await fetch(`/api/demos/${id}`);
  if (!res.ok) throw new Error(`GET /api/demos/${id} failed: ${res.status}`);
  return (await res.json()) as DemoDetail;
};
