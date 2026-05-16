# SeeFlow

> Architecture diagrams that actually run.

Turn your static system architecture into a live control panel wired directly to your running application. Click a node, fire a real request, watch downstream services light up as your app emits events back.

## Why

- **Diagram drift** — Confluence pages go stale. SeeFlow breaks loudly when your actual system changes.
- **Onboarding friction** — New engineers click through a live flow instead of reading six-month-old docs.
- **Demo tedium** — Script it once, replay it flawlessly. No more manually clicking through microservices for stakeholders.

## Quickstart

```bash
npx tuongaz/seeflow start
```

Opens the studio at <http://localhost:4321>. Then register a demo from any repo that has a `.seeflow/seeflow.json`:

```bash
npx tuongaz/seeflow register --path /path/to/your/repo
```

**Or clone and run the bundled example:**

```bash
git clone https://github.com/tuongaz/seeflow.git
cd seeflow && bun install
make demo
```

`make demo` starts the studio, registers the **Todo Demo**, and opens it at <http://localhost:4321/d/todo-demo>. Click **Play** on any node — a real script runs, the node animates, and the detail panel renders the response. Run `make stop` when done.

## Generate a demo in one prompt

The SeeFlow plugin reads your codebase, understands your architecture, and generates the full diagram and request scripts automatically. Works with Claude Code, Codex, Cursor, and Windsurf.

**Install the plugin:**

```bash
/plugin marketplace add tuongaz/seeflow
/plugin install create-seeflow@seeflow
```

**Then just ask:**

```
/create-seeflow show me the shopping cart feature
```

The plugin scans your routes and database connections, generates `seeflow.json`, wires up demo scripts, and opens the canvas at localhost:4321.

## MCP server

SeeFlow ships an MCP server so any MCP-aware editor can list, register, and edit demos directly. The studio must be running first.

**Claude Code:**

```bash
claude mcp add seeflow -- npx -y -p @tuongaz/seeflow seeflow-mcp
```

**Via `.mcp.json`** (Cursor, Windsurf, etc.):

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

The MCP server talks to `http://127.0.0.1:4321/mcp` by default. Override with `SEEFLOW_STUDIO_URL` if needed.

## Develop

```bash
git clone https://github.com/tuongaz/seeflow.git
cd seeflow && bun install
make dev   # Vite (5173) + Hono studio (4321), both hot-reloading
```

`make help` lists every target. Toolchain: Bun ≥ 1.3, Hono, React Flow, Zod, Biome.

## Status

Early-stage. The schema is stable enough to author against, but expect changes. Issues, ideas, and PRs welcome.

## License

MIT — see [`LICENSE`](./LICENSE).
