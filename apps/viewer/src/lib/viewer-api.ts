import type { Demo, FlowListItem, FlowsResponse } from '../types';

const API_BASE = 'https://seeflow.dev/api';

export async function fetchFlow(uuid: string, signal?: AbortSignal): Promise<Demo> {
  const res = await fetch(`${API_BASE}/flows/${uuid}`, { signal });
  if (!res.ok) {
    const message = res.status === 404 ? 'Flow not found' : `Failed to load flow (${res.status})`;
    throw new Error(message);
  }
  return res.json() as Promise<Demo>;
}

export async function fetchFlows(page: number, limit: number): Promise<FlowsResponse> {
  const res = await fetch(`${API_BASE}/flows?page=${page}&limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Failed to load flows (${res.status})`);
  }
  return res.json() as Promise<FlowsResponse>;
}

export type { FlowListItem };
