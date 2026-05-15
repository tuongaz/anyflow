# SeeFlow

> Architecture diagrams that actually run.

Whiteboard diagrams and Confluence pages rot the moment they're drawn. They
can't tell you whether `order.created` still flows from the API to the
inventory worker — only running code can. SeeFlow turns your architecture
into a **playable canvas**: click a box, fire a real request, watch
downstream services light up as your app emits events back.

Use it to onboard a new teammate in an afternoon instead of a week, align a
product team on what actually happens during checkout, or keep a permanent
record of how your system behaves — one that breaks loudly when it drifts.

## Why you'd use it

- **A diagram that can't lie.** The boxes are real endpoints; the arrows
  fire real requests. Drift is visible immediately.
- **Living onboarding.** New engineers click around instead of reading
  six-month-old docs.
- **Generated, not drawn.** The bundled Claude Code plugin produces the
  diagram from your code, so you don't pay a tax to keep it.
- **Hot reload.** Edit the demo file, the canvas updates. No rebuild.

## Quickstart (under a minute)

```bash
npx tuongaz/seeflow start
```

That starts the studio at <http://localhost:4321>. Then register a demo from
any repo that has a `.seeflow/demo.json`:

```bash
npx tuongaz/seeflow register --path /path/to/your/repo
```

**Alternative — check out the repo:**

```bash
git clone https://github.com/tuongaz/seeflow.git
cd seeflow && bun install
make demo
```

`make demo` starts the studio, registers the bundled **Todo Demo** example,
and opens it at <http://localhost:4321/d/todo-demo>. In the canvas, click
**Play** on the `POST /todos/:id/complete` node — a real `bun` script runs,
the node animates `running → done`, and the detail panel renders the response.
Edit `examples/todo-demo-target/.seeflow/demo.json` and save — the canvas
hot-reloads. When you're done, run `make stop`.

## Generate a demo from your own code (Claude Code plugin)

Inside the cloned repo there's a Claude Code plugin (`create-seeflow`) that
walks your codebase, picks a slice, and writes a `.seeflow/<slug>/demo.json`
for you — no manual diagramming. From Claude Code:

```
/plugin marketplace add tuongaz/seeflow
/plugin install create-seeflow@seeflow
```

Then in any project, just describe what you want:

> create a demo showing how the order pipeline works

Claude walks your code, drafts the nodes, asks you to confirm, then writes +
registers the demo against your running studio. The plugin handles schema
validation and end-to-end checks before opening the canvas.

For deeper authoring, browse [`skills/create-seeflow/`](./skills/create-seeflow/)
and [`apps/studio/src/schema.ts`](./apps/studio/src/schema.ts) (the Zod
source of truth).

## Author a demo by hand

A demo is a single file at `<your-repo>/.seeflow/demo.json` — no build
step, no DSL. See [`examples/todo-demo-target`](./examples/todo-demo-target)
for a working three-node demo plus its play/status scripts, and
[`apps/studio/src/schema.ts`](./apps/studio/src/schema.ts) for the schema.

Register your demo with:

```bash
npx -y @tuongaz/seeflow register --path /path/to/your/repo
```

## MCP server (Cursor, Windsurf, any MCP-aware agent)

SeeFlow ships an MCP server so any MCP-aware coding agent (Claude Code,
Cursor, Windsurf, etc.) can list, register, and edit demos directly —
adding nodes, moving them, wiring connectors, patching styles. The studio
must be running (`make demo` or `npx -y @tuongaz/seeflow start`); the MCP
server is a thin stdio shim that proxies to its `/mcp` endpoint.

**Claude Code** — one command:

```bash
claude mcp add seeflow -- npx -y -p @tuongaz/seeflow seeflow-mcp
```

**Anything that reads `.mcp.json`** (Claude Code project-scoped, Cursor,
etc.) — drop this into the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "seeflow": {
      "command": "npx",
      "args": ["-y", "-p", "@tuongaz/seeflow", "seeflow-mcp"]
    }
  }
}
```

The shim talks to `http://127.0.0.1:4321/mcp` by default. Override with
`SEEFLOW_STUDIO_URL` if the studio runs elsewhere. If the studio isn't
running, tool calls return a clear error instead of hanging.

## Develop on SeeFlow itself

```bash
git clone https://github.com/tuongaz/seeflow.git
cd seeflow
bun install
make dev   # Vite (5173) + Hono studio (4321), both hot-reloading
```

`make help` lists every target. Toolchain: Bun ≥ 1.3, Hono, React Flow,
Zod, Biome.

## Status

Early-stage. The schema is stable enough to author against, but expect
changes. Issues, ideas, and PRs welcome.

## License

MIT — see [`LICENSE`](./LICENSE).
