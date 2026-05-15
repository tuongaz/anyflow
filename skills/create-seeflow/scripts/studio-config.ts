import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_STUDIO_URL = 'http://localhost:4321';

export function defaultConfigPath(): string {
  return join(homedir(), '.seeflow', 'config.json');
}

export function resolveStudioUrl(configPath: string = defaultConfigPath()): string {
  if (!existsSync(configPath)) return DEFAULT_STUDIO_URL;
  try {
    const raw = readFileSync(configPath, 'utf8');
    const cfg = JSON.parse(raw) as { host?: unknown; port?: unknown };
    const port = typeof cfg.port === 'number' && cfg.port > 0 ? cfg.port : 4321;
    const host = typeof cfg.host === 'string' && cfg.host.length > 0 ? cfg.host : 'localhost';
    return `http://${host}:${port}`.replace(/\/+$/, '');
  } catch {
    return DEFAULT_STUDIO_URL;
  }
}
