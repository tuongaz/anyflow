import { fetchDemoDetail } from '@/lib/api';
import { strToU8, zipSync } from 'fflate';
import { useCallback } from 'react';

const CLOUD_API_BASE = 'https://seeflow.dev/api';

export async function exportToCloud(
  projectId: string,
  email: string,
): Promise<{ shareUrl: string }> {
  const detail = await fetchDemoDetail(projectId);
  if (!detail.demo) {
    throw new Error('Demo has no data');
  }
  const demo = detail.demo;

  // Deduplicate paths across imageNode and htmlNode references
  const seen = new Set<string>();
  const filePaths: string[] = [];
  for (const node of demo.nodes) {
    if (node.type === 'imageNode' && node.data.path && !seen.has(node.data.path)) {
      seen.add(node.data.path);
      filePaths.push(node.data.path);
    } else if (node.type === 'htmlNode' && node.data.htmlPath && !seen.has(node.data.htmlPath)) {
      seen.add(node.data.htmlPath);
      filePaths.push(node.data.htmlPath);
    }
  }

  const zipEntries: Record<string, Uint8Array> = {
    'seeflow.json': strToU8(JSON.stringify(demo)),
  };

  for (const path of filePaths) {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/files/${path}`);
    if (res.ok) {
      zipEntries[`files/${path}`] = new Uint8Array(await res.arrayBuffer());
    }
  }

  const zipped = zipSync(zipEntries);

  const cloudRes = await fetch(`${CLOUD_API_BASE}/flows?email=${encodeURIComponent(email)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: zipped.buffer as ArrayBuffer,
  });

  if (!cloudRes.ok) {
    throw new Error(`Export failed with status ${cloudRes.status}`);
  }

  const body = (await cloudRes.json()) as { url?: string };
  if (typeof body.url !== 'string') {
    throw new Error('Invalid response from cloud API: missing url');
  }

  return { shareUrl: body.url };
}

export function useExportToCloud(
  projectId: string,
): (email: string) => Promise<{ shareUrl: string }> {
  return useCallback((email: string) => exportToCloud(projectId, email), [projectId]);
}
