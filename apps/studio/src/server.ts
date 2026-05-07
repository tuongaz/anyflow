import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { createApi } from './api.ts';
import { type EventBus, createEventBus } from './events.ts';
import { type Registry, createRegistry } from './registry.ts';
import { type DemoWatcher, createWatcher } from './watcher.ts';

export type AppMode = 'dev' | 'prod';

export interface CreateAppOptions {
  mode?: AppMode;
  /** Where the Vite dev server is reachable in dev mode. */
  viteDevUrl?: string;
  /** Filesystem root for the built web bundle in prod mode. */
  staticRoot?: string;
  /** Inject a registry; defaults to one persisted at ~/.anydemo/registry.json. */
  registry?: Registry;
  /** Inject an event bus; defaults to a fresh in-memory bus. */
  events?: EventBus;
  /** Inject a watcher; defaults to one wired to the registry + event bus. */
  watcher?: DemoWatcher;
  /** Skip starting fs.watch on registered demos. Useful for tests. */
  watchAllOnBoot?: boolean;
  /** Disable file watching entirely (no fs handles leaked). Useful for tests. */
  disableWatcher?: boolean;
}

const DEFAULT_VITE_DEV_URL = 'http://localhost:5173';
const DEFAULT_STATIC_ROOT = './dist/web';

const inferMode = (): AppMode => (process.env.NODE_ENV === 'production' ? 'prod' : 'dev');

export function createApp(options: CreateAppOptions = {}): Hono {
  const mode = options.mode ?? inferMode();
  const viteDevUrl = options.viteDevUrl ?? DEFAULT_VITE_DEV_URL;
  const staticRoot = options.staticRoot ?? DEFAULT_STATIC_ROOT;
  const registry = options.registry ?? createRegistry();
  const events = options.events ?? createEventBus();
  const watcher = options.disableWatcher
    ? undefined
    : (options.watcher ?? createWatcher({ registry, events }));

  if (watcher && (options.watchAllOnBoot ?? true)) {
    watcher.watchAll();
  }

  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true }));
  app.route('/api', createApi({ registry, events, watcher }));

  if (mode === 'dev') {
    app.all('*', async (c) => {
      const url = new URL(c.req.url);
      if (url.pathname.startsWith('/api/')) return c.notFound();

      const target = `${viteDevUrl}${url.pathname}${url.search}`;
      try {
        const upstream = await fetch(target, {
          method: c.req.method,
          headers: c.req.raw.headers,
          body: c.req.method === 'GET' || c.req.method === 'HEAD' ? undefined : c.req.raw.body,
          redirect: 'manual',
        });
        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: upstream.headers,
        });
      } catch (_err) {
        return c.text(
          `AnyDemo dev proxy could not reach Vite at ${viteDevUrl}.\nMake sure \`bun run dev\` is running so Vite is up.\n`,
          502,
        );
      }
    });
  } else {
    app.use('/*', serveStatic({ root: staticRoot }));
    app.get('*', serveStatic({ path: `${staticRoot}/index.html` }));
  }

  return app;
}

export interface ServeOptions extends CreateAppOptions {
  port?: number;
  hostname?: string;
}

export function serve(options: ServeOptions = {}) {
  const port = options.port ?? 4321;
  const hostname = options.hostname ?? 'localhost';
  const app = createApp(options);
  return Bun.serve({ port, hostname, fetch: app.fetch });
}

if (import.meta.main) {
  const server = serve();
  console.log(`AnyDemo Studio listening on http://${server.hostname}:${server.port}`);
}
