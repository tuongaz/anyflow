// Stub emit() — full implementation arrives in US-010 (M1.D).
export async function emit(_args: {
  demoId: string;
  nodeId: string;
  status: string;
}): Promise<void> {
  throw new Error('emit() not implemented (US-010 / M1.D)');
}
