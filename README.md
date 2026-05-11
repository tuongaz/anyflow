# AnyDemo

> Architecture diagrams that actually run.

Whiteboard diagrams and Confluence pages rot the moment they're drawn. They
can't tell you whether `order.created` still flows from the API to the
inventory worker — only running code can. AnyDemo turns your architecture
into a **playable canvas**: click a box, fire a real request, watch
downstream services light up as your app emits events back.

Use it to onboard a new teammate in an afternoon instead of a week, align a
product team on what actually happens during checkout, or keep a permanent
record of how your system behaves — one that breaks loudly when it drifts.

## How you'll use it

**1. Install the Claude Code skill** — one command, then `/diagram` works in
any repo.

```bash
npx skills add tuongaz/anydemo
```

**2. Generate a diagram from your codebase.** Inside your project:

```
/diagram show me how the order pipeline works
```

Claude walks your code, picks the right slice, and writes a `demo.json`. No
manual diagramming.

**3. Play it.**

```bash
npx @tuongaz/anydemo start             # one-time: starts the studio
npx @tuongaz/anydemo register --path . # register the demo, opens the canvas
```

Click a node → a real HTTP request hits your dev server. Workers downstream
animate from `running` → `done` as your app calls `emit()`. If the diagram
ever lies about your system, the play action will fail in front of you.

## What you get

- **A diagram that can't lie.** The boxes are real endpoints; the arrows
  fire real requests. Drift is visible immediately.
- **Living onboarding.** New engineers click around instead of reading
  six-month-old docs.
- **Generated, not drawn.** The skill produces the diagram from your code,
  so you don't pay a tax to keep it.
- **Hot reload.** Edit the demo file, the canvas updates. No rebuild.
- **Three playability tiers.** Wire it against your live dev server, against
  a generated mock harness, or keep it static-but-rich when running the real
  app isn't worth the setup.

## Authoring by hand

If you'd rather skip the skill, a demo is a single file at
`<your-repo>/.anydemo/demo.json`. See
[`examples/order-pipeline`](./examples/order-pipeline) for a complete
working example, and [`apps/studio/src/schema.ts`](./apps/studio/src/schema.ts)
for the Zod schema that validates it.

## Install the MCP server

AnyDemo ships an MCP server so any MCP-aware coding agent (Claude Code,
Cursor, Windsurf, etc.) can list, register, and edit demos directly —
adding nodes, moving them, wiring connectors, patching styles. The studio
must be running (`npx @tuongaz/anydemo start`); the MCP server is a thin
stdio shim that proxies to its `/mcp` endpoint.

**Claude Code** — one command:

```bash
claude mcp add anydemo -- npx -y -p @tuongaz/anydemo anydemo-mcp
```

**Anything that reads `.mcp.json`** (Claude Code project-scoped, Cursor,
etc.) — drop this into the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "anydemo": {
      "command": "npx",
      "args": ["-y", "-p", "@tuongaz/anydemo", "anydemo-mcp"]
    }
  }
}
```

The shim talks to `http://127.0.0.1:4321/mcp` by default. Override with
`ANYDEMO_STUDIO_URL` if the studio runs elsewhere. If the studio isn't
running, tool calls return a clear error instead of hanging.

## Develop on AnyDemo itself

```bash
git clone https://github.com/tuongaz/anydemo.git
cd anydemo
bun install
make dev   # Vite (5173) + Hono studio (4321)
```

See `make help` for the rest. Toolchain: Bun ≥ 1.3, Hono, React Flow, Zod,
Biome.

## Status

Early-stage. The schema is stable enough to author against, but expect
changes. Issues, ideas, and PRs welcome.

## License

Not yet licensed for external distribution. Treat the source as
"all rights reserved" until a `LICENSE` file lands. Reach out if you want
to use it.
