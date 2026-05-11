# Tier 2 trigger bridges — beyond HTTP routes

The `playAction` schema accepts only `kind: 'http'`. That looks like a
constraint, but it isn't: every `playAction.url` points at the **harness**,
not at the target. The harness is a Hono+Bun process we generate, and its
handlers can do anything Bun can do. So a click on a node always travels:

```
canvas → HTTP → harness handler → <bridge to the real trigger> → emit() → canvas
```

The "bridge" piece is what this document is about. Most real codebases
have no customer-facing HTTP — they're CLIs, batch jobs, queue consumers,
container stacks, or libraries. Tier 2 is still the right tier for all of
them; the harness handler just spawns, drops files, publishes, or imports
instead of stubbing JSON.

Pick the matching `triggerSurface` from the table below and read the
section. `tier-detector` writes the chosen surface to
`tier-evidence.json.triggerSurface`; `harness-author` reads it to pick
handler bodies.

| `triggerSurface` | Detect when… | Section |
|---|---|---|
| `http`        | Target binds a port and exposes routes | (default — see SKILL.md) |
| `container`   | `docker-compose.y{a,}ml`, Dockerfile with daemon `CMD`, k8s manifests | [1. Containers](#1-containers-docker-compose-kubernetes) |
| `file-watch`  | `chokidar`/`watchdog`/`fs.watch`, inbox dirs, file sensors | [2. File-driven & batch](#2-file-driven--batch) |
| `cli`         | `package.json#bin`, `[project.scripts]`, `cobra`, CLI argv parsing | [2. File-driven & batch](#2-file-driven--batch) (CLI subsection) and [4. Libraries / CLIs / MCP](#4-libraries-clis-mcp-servers-language-servers) |
| `queue`       | `kafkajs`, `amqplib`, `ioredis xreadgroup`, `@aws-sdk/client-sqs`, `nats` | [3. Queues, events, gRPC](#3-queues-events-grpc) |
| `library`     | `package.json#exports`, no listening framework, public function exports | [4. Libraries / CLIs / MCP](#4-libraries-clis-mcp-servers-language-servers) |
| `scheduled`   | `crontab`, `*.timer`, `node-cron`, scheduled DAGs | [2. File-driven & batch](#2-file-driven--batch) |
| `mixed`       | Project has multiple surfaces (web + worker + cron) | use the matching section per `bridgeTargets[].kind` |
| `none`        | Pure types, schema-only repos, design tokens, docs | force Tier 3 |

`none` is the **only** signal that forces Tier 3. Everything else is Tier 2.

When the bridge requires asynchronous activity in the target's own
language (manually triggering an event, uploading a file via the
target's SDK, signalling a daemon), the harness is allowed to ship
**polyglot helper scripts** under `.anydemo/<slug>/harness/runners/`
(each demo has its own folder; `<slug>` is the per-demo subdirectory
the orchestrator picked at Phase 0) that the Node handler spawns. See [§5 Polyglot helper scripts](#5-polyglot-helper-scripts--when-the-harness-needs-a-hand)
for the convention and a worked Python example.

---

## 1. Containers (Docker, Compose, Kubernetes)

### Scan signals

In priority order:

- `docker-compose.y{a,}ml` or `compose.y{a,}ml` at repo root → **Compose
  archetype**. Each `services.*` key is a candidate node.
- `Dockerfile` with no compose file and a single long-running
  `CMD`/`ENTRYPOINT` → **single-daemon archetype**.
- `k8s/`, `manifests/`, `*.yaml` containing `kind: Deployment|Job|
  CronJob|StatefulSet`, or `Chart.yaml` → **Kubernetes archetype**.
- Compose file where services form a DAG via `depends_on` with
  `condition: service_completed_successfully` → **pipeline archetype**.

If any match AND no HTTP routes are discoverable in the source, skip the
route-stub harness and use the container handler below.

### Trigger pattern

Always assume the stack is already running. The harness is a thin shim
over the local container runtime.

| Archetype | playNode wires to | Handler body |
|---|---|---|
| Compose worker | `POST /play/:service` | `docker compose -f <file> exec -T <service> <one-shot cmd>` — e.g. `node worker.js --once`, or `docker compose run --rm <service> <cmd>` if the service is not long-running |
| Single daemon | `POST /play/tick` | `docker kill -s USR1 <container>` (signal-driven tick) **or** `touch <bind-mount>/trigger` (sentinel-file trigger) |
| K8s Deployment | `POST /play/:deploy` | `kubectl exec deploy/<deploy> -- <cmd>` for one-shot, or `kubectl create job --from=cronjob/<name>` |
| K8s Job / pipeline stage | `POST /play/:job` | `kubectl create -f jobs/<job>.yaml` or `kubectl create job <name>-$(date +%s) --from=job/<name>` |

Wrap every shell call in `Bun.spawn` (or `execa`) with a 30s timeout and
return `{ ok, exitCode, stderr }` so the canvas can surface failures.

Map other node types as: `shapeNode` for the db/queue/volume (context
only, never clickable); `stateNode` for queue depth, replica count, or
last-exit-code (observability, no click).

### Observability hookup

Drive `emit()` from the runtime's native event stream, not by parsing
app logs:

```ts
// Compose / Docker: follow logs of the target container
const proc = Bun.spawn(['docker', 'logs', '-f', '--since', '0s', cid]);
emit(demoId, nodeId, 'running');
for await (const chunk of proc.stdout) {
  if (/done|processed|exit/i.test(new TextDecoder().decode(chunk))) {
    void emit(demoId, nodeId, 'done');
    proc.kill();
  }
}
// Safety net: terminal state from the runtime itself
Bun.spawn(['docker', 'events', '--filter', `container=${cid}`, '--filter', 'event=die']);
```

For Kubernetes use `kubectl wait --for=condition=complete job/<name>
--timeout=30s` then emit `done`. For `stateNode` replica counts, poll
`kubectl get deploy <n> -o jsonpath='{.status.readyReplicas}'` every 2s.

### Pitfalls

- **Don't `docker compose up` inside the handler.** Cold-starting on
  click breaks the < 2s click-to-feedback expectation. Startup is a setup
  step the README documents (`make demo-up`).
- **Don't shell out without `timeout`.** A hung `docker exec` will pin
  the harness; cap at 30s and emit `error`.
- **Don't parse `stdout` for state when an event stream exists.** Prefer
  `docker events` / `kubectl wait` over regex on logs.
- **Don't assume container names.** Resolve via
  `docker compose ps -q <service>` or `kubectl get pod -l app=<deploy>
  -o name` at request time — names change across `up` cycles.
- **Don't mutate cluster state irreversibly on a demo click.** No
  `kubectl delete`, no `docker compose down`. Clicks must be idempotent.
- **Don't require root or remote contexts.** Fail fast at harness boot
  if `DOCKER_HOST` or `KUBECONFIG` is unset.

---

## 2. File-driven & batch

### Scan signals

`tier-detector` should classify as file-driven when `scan-result.json`
shows any of:

- **CLI archetype** — `bin` in `package.json`, `[project.scripts]` in
  `pyproject.toml`, `setup.py` console_scripts, a `cmd/*/main.go`, or a
  Dockerfile `ENTRYPOINT` whose argv looks like a subcommand
  (`["myetl", "ingest"]`), not a server bind.
- **Watcher archetype** — imports of `chokidar`, `watchdog.observers`,
  `fs.watch`, `inotify`, `fsnotify`; comments mentioning `./inbox/`,
  `./incoming/`.
- **Orchestrator archetype** — `dags/*.py` with `airflow.DAG` /
  `prefect.flow` / `dagster.job`, file sensors (`FileSensor`,
  `S3KeySensor`), `dagster.yaml`.
- **Scheduler archetype** — `crontab` files, `*.timer` / `*.service`
  systemd units, `schedule.every(...)`, `node-cron`.
- **Distributed-batch archetype** — `spark-submit` / `beam` /
  `flink run` invocations in `Makefile`, `scripts/run.sh`, or CI YAML.
- **Make archetype** — Makefile targets named `ingest`, `etl`, `load`,
  `import`, `process`, `pipeline`.

### Trigger pattern

```ts
import { copyFile, mkdir } from 'node:fs/promises';

// CLI — spawn and watch exit
app.post('/play/ingest', async (c) => {
  await emit(DEMO_ID, 'ingest', 'running');
  const proc = Bun.spawn(['myetl', 'ingest', `${FIX}/orders.csv`], { cwd: TARGET });
  proc.exited.then((code) => emit(DEMO_ID, 'ingest', code === 0 ? 'done' : 'error'));
  return c.json({ ok: true, pid: proc.pid });
});

// Watcher — copy a curated file into the watched directory
app.post('/play/inbox-drop', async (c) => {
  await mkdir(`${TARGET}/inbox`, { recursive: true });
  await copyFile(`${FIX}/orders.csv`, `${TARGET}/inbox/orders-${Date.now()}.csv`);
  await emit(DEMO_ID, 'watcher', 'running');
  return c.json({ ok: true });
});

// Orchestrator — shell out to the framework CLI
// Bun.spawn(['dagster', 'job', 'execute', '-j', 'ingest']) — same exit-code pattern.

// Make — Bun.spawn(['make', 'ingest'], { cwd: TARGET }).
```

Where Phase 1 finds `kind: 'event'` connectors downstream, the handler
chains additional `emit()` calls for those state nodes. For long-running
spawns, fire `running` immediately and `done`/`error` from the exit
listener — never block the HTTP response on completion.

### Fixture management

Adopt **`<target>/.anydemo/<slug>/harness/fixtures/`** as the canonical
fixture directory — each demo owns its own fixtures, so sibling demos
never collide. `harness-author` creates it and writes one small realistic
input per play node:

```
<target>/.anydemo/<slug>/harness/
├── server.ts
├── package.json
├── README.md
└── fixtures/
    ├── orders.csv          # for CLI ingest, watcher drop, spark-submit
    ├── orders.json         # alt format if the watcher accepts JSON
    └── README.md           # one line per fixture
```

Rules:

- **Copy, don't generate.** Commit realistic sample files. Inline JSON
  literals are acceptable only for trivial single-record events; anything
  CSV/Parquet/Avro/JSON-Lines lives on disk so users can `head` it.
- **Read-only at runtime.** Handlers `copyFile` fixtures into the trigger
  location with a timestamp suffix; they never mutate `fixtures/`.
- **Isolated output.** Create `<target>/.anydemo/<slug>/harness/out/` for
  any artefact the pipeline produces. Wipe it on harness start so each
  click is reproducible.
- **Never write into user source dirs.** If the watched directory lives
  inside the repo (`./inbox/`), still scope it under the project root
  and remind the user to `.gitignore` it in the README.

### Observability hookup

| Archetype | Completion signal | Implementation |
|---|---|---|
| CLI / `make` / `spark-submit` | Process exit code | `proc.exited.then(c => emit(..., c === 0 ? 'done' : 'error'))` |
| Watcher | Output file appears | `fs.watch(outDir, () => emit(..., 'done'))` with one-shot debounce |
| Orchestrator (Airflow/Dagster/Prefect) | DAG run status API | poll `/api/dags/<id>/dagRuns/<run>` every 1s |
| Scheduled batch | Lockfile or marker | watch for `out/.done` mtime change |
| Log-only pipeline | Tail signature line | `tail -F log` and regex `/✓ ingest complete/` |

Pattern: emit `running` synchronously inside the handler (before the
HTTP response), then attach exactly **one** terminal `emit()` per
click — never both `done` and `error`. For pollers, store the active
handle on a `Map<nodeId, Timer>` so re-clicks cancel the previous watch.

### Pitfalls

- **Don't shell out with `shell: true`.** Use `Bun.spawn([cmd, ...args])`
  so a fixture path with spaces can't inject a command.
- **Don't block the response.** Long-running spawns must return 202
  immediately; the diagram needs `running` within ~100ms.
- **Don't leak processes.** Track spawned PIDs in a `Set` and `SIGTERM`
  them on harness shutdown so a re-run doesn't dogpile.
- **Don't accumulate output between clicks.** Clear `out/` at the start
  of each handler invocation, or namespace under `out/<timestamp>/`.
- **Don't pretend completion.** If no observable signal exists, label
  the node summary "(simulated completion — no exit signal observed)".
- **Don't inline 200-line JSON fixtures into `server.ts`.** Bloats the
  harness, defeats `git diff`, hides the input. Put it in `fixtures/`.

---

## 3. Queues, events, gRPC

### Scan signals

| Archetype | Package signals | Symbol patterns |
|---|---|---|
| Kafka | `kafkajs`, `@confluentinc/kafka-javascript`, `node-rdkafka` | `new Kafka(...)`, `consumer.subscribe({ topic })`, `eachMessage` |
| RabbitMQ / AMQP | `amqplib`, `amqp-connection-manager` | `channel.consume(queue, ...)`, `assertQueue` |
| Redis Streams | `ioredis`, `redis` | `xreadgroup`, `xadd`, `XGROUP CREATE` |
| SQS | `@aws-sdk/client-sqs`, `sqs-consumer` | `ReceiveMessageCommand`, `Consumer.create({ queueUrl })` |
| GCP Pub/Sub | `@google-cloud/pubsub` | `subscription.on('message', ...)` |
| NATS | `nats`, `@nats-io/transport-node` | `jetstream()`, `subscribe('subject')` |
| gRPC | `@grpc/grpc-js`, `@grpc/proto-loader`, `nice-grpc` | `server.addService(...)`, `.proto` files |
| Webhook receivers | `stripe`, `svix`, `@octokit/webhooks` | `constructEvent`, `verify(signature)` |
| Temporal | `@temporalio/client`, `@temporalio/worker` | `workflow.start`, `defineSignal` |
| Inngest | `inngest` | `inngest.createFunction({ event })` |

Record topics/queues/subjects/RPC names on each node's `data.detail.fields`.

### Trigger pattern

```ts
// Kafka — kafkajs
const kafka = new Kafka({ brokers: [process.env.ANYDEMO_KAFKA_BROKER!] });
const producer = kafka.producer(); await producer.connect();
await producer.send({ topic: 'orders.created', messages: [{ value: JSON.stringify(sample) }] });

// Redis Streams — ioredis
await redis.xadd('orders', '*', 'sku', 'abc', 'qty', '1');

// SQS — @aws-sdk/client-sqs (LocalStack endpoint)
await sqs.send(new SendMessageCommand({ QueueUrl, MessageBody: JSON.stringify(sample) }));

// gRPC — @grpc/grpc-js + proto-loader
const client = new pkg.OrderService(addr, credentials.createInsecure());
client.Create(sample, (err, _res) => emit(demoId, nodeId, err ? 'error' : 'done'));

// Temporal — @temporalio/client
await client.workflow.start('orderWorkflow', {
  taskQueue: 'demo',
  args: [sample],
  workflowId: `demo-${crypto.randomUUID()}`,
});
```

Webhook receivers are the easy case: the harness POSTs to the target's
own `/webhook` with a signature computed from `ANYDEMO_WEBHOOK_SECRET`
the receiver shares in dev mode.

### Connectivity assumption

**Assume a real broker reachable on localhost** (Kafka 9092, Redis 6379,
LocalStack 4566, NATS 4222, Temporal 7233). Emit a
`docker-compose.anydemo.yml` next to the harness with the minimum
services. Don't embed brokers in-process — `kafkajs-mock`,
`aws-sdk-mock`, etc. drift from real semantics and confuse demos. The
one exception: gRPC, where the harness can stand up an in-process
server stub if the user is demoing the *client* side.

Broker URLs come from `ANYDEMO_*` env vars with localhost defaults.
Harness fails fast with a readable message ("Kafka not reachable at
localhost:9092 — run `docker compose up`") instead of hanging.

### Observability hookup

Three options, in preference order:

1. **Consumer-side beacon** — wrap the target's handler (or document a
   one-liner the user adds) to call `emit(demoId, nodeId, 'done')` after
   processing. Cleanest, broker-agnostic.
2. **Shadow subscriber** — harness subscribes to the same topic/queue
   with a separate consumer group and watches for the just-produced
   message to be acked/committed. Works for Kafka (`__consumer_offsets`),
   Redis Streams (`XPENDING`), SQS (message disappears).
3. **State poll** — harness polls a project-provided `/healthz`-style
   endpoint or a DB row keyed by the message id.

Default to option 1.

### Pitfalls

- **MOCK BROKER ONLY guard.** Harness refuses to start unless
  `ANYDEMO_ENV=local` or the broker host resolves to a private/loopback
  address. Never let a click hit prod Kafka.
- Never bake AWS/GCP credentials into the handler — read from env, fail
  loud if missing.
- Don't produce to the project's real topic names without a `demo.`
  prefix override knob.
- For Temporal/Inngest, always set a `demo-` workflow-id prefix so
  accidental fires are easy to garbage-collect.
- gRPC: don't reuse a single client across handler invocations without
  `waitForReady` — first click after idle silently times out.
- Never call `producer.send` without `await` — the HTTP 200 will race
  the actual publish and `emit('done')` will fire before the consumer
  sees anything.

---

## 4. Libraries, CLIs, MCP servers, language servers

### Scan signals — "no HTTP, but has a public API"

| Archetype | Signal |
|---|---|
| **Library / SDK** | `package.json` has `main`/`exports` but no `start`/`dev` script binding a port; `src/index.ts` re-exports symbols; `*.d.ts` published; no listening framework imported. |
| **CLI** | `package.json#bin`, `pyproject.toml [tool.poetry.scripts]`, `setup.cfg console_scripts`, `cobra.Command`, `clap::Parser`, `commander`/`oclif`/`yargs`/`click`/`argparse` imports. |
| **MCP server** | imports `@modelcontextprotocol/sdk`, `mcp.server` (py), `Server.setRequestHandler`, manifest with `"transport": "stdio"`/`"sse"`. |
| **Compiler / interpreter** | `parse`/`tokenize`/`compile`/`emit` modules; fixtures dir under `tests/fixtures/`; reads from `argv[1]` then prints to stdout. |
| **Code generator** | templates dir (`templates/`, `_templates/`); writes to a target dir from `argv`. |
| **Build / bundler plugin** | exports a `plugin()` factory; peer-deps on `rollup`/`vite`/`esbuild`/`webpack`. |
| **Language server** | `vscode-languageserver` / `lsp` imports; `Connection.onRequest`. |

Stamp the archetype into `tier-evidence.json` as
`tier2Bridge: "library" | "cli" | "mcp" | "compiler" | "generator" | "lsp"`.

### Trigger patterns

Each clickable node is still a `playNode`; only the handler changes.

- **Library import shim** — handler does
  `const mod = await import('../../src/index.ts')` and calls the
  exported symbol with a curated arg, returning JSON. Bun's TS-native
  loader makes this work without a build step. For non-TS languages the
  harness spawns a per-language runner (`python -c`, `go run`,
  `cargo run --quiet`) — never try to FFI from Bun.
- **CLI spawn** — `Bun.spawn([resolveBin(), 'subcmd', ...args])`, pipe
  `stdout`/`stderr` to SSE, `emit('cli.stdout', { line })` per line,
  `emit('cli.exit', { code })` on close. Resolve the binary from
  `../../package.json#bin` (or `pyproject` scripts).
- **MCP bridge** — open one long-lived JSON-RPC client
  (`StdioClientTransport({ command: '../../bin/server' })` or an SSE
  client), cache it on first request, and route each `playNode` to a
  `tools/call` with curated args. Surface the tool response as the HTTP
  body and `emit('mcp.tool', { name, result })`.
- **Compiler / interpreter** — handler reads `fixtures/<name>.src`,
  calls `compile(src)` (import shim) or pipes it through stdin (spawn),
  returns the AST/IR/diagnostics.
- **Code generator** — handler creates a scratch dir under
  `.anydemo/<slug>/harness/.scratch/<click-id>/`, runs the generator
  against it, then walks the dir and returns the file tree.
- **LSP** — spin a `vscode-jsonrpc` client over child-process stdio,
  send `initialize` once, route clicks to `textDocument/*` requests
  against a fixture buffer.

### Fixture / arg management

All curated inputs live under `.anydemo/<slug>/harness/fixtures/`
(each demo has its own folder under `.anydemo/`):

```
.anydemo/<slug>/harness/
  server.ts
  fixtures/
    <node-id>.json     # { args: [...], stdin?: "...", env?: {...} }
    <node-id>.src      # raw source for compiler/interpreter nodes
    <node-id>.config.* # for generators
```

The handler for `playNode` `n_parse` reads `fixtures/n_parse.json`. The
node-selector embeds the fixture filename into `data.detail.fields` so
the user can see what's being sent. **One file per playNode** — keeps
diffs readable.

### Observability hookup

`emit()` is the only state channel. Wrap every trigger in the same
envelope so the canvas stays uniform:

- import-shim → `emit(nodeId + '.return', { value })` on resolve,
  `.throw` on reject.
- spawn → stream `stdout`/`stderr` lines as `.log`, exit code as `.exit`.
- mcp / lsp → emit the raw JSON-RPC response as `.response`.

The handler responds 200 with `{ ok, summary }` so the click visibly
completes even when the real work streams asynchronously.

### Pitfalls

- **Import vs spawn for TS libs** — prefer import: faster, shares the
  module graph, lets `emit()` hooks land inside the lib. Spawn only when
  the lib mutates `process.cwd`, calls `process.exit`, or pulls native
  deps that don't resolve from `.anydemo/<slug>/harness/node_modules/`.
- **Module resolution** — the harness `package.json` MUST set
  `"workspaces": [".."]` or list the target as a `file:..` dep, or
  `import '../../src'` fails on transitive deps.
- **Non-TS targets** — never try to import a Python/Go/Rust library
  from Bun. Spawn a runner:
  `python -c 'import target; print(json.dumps(target.fn(...)))'`. Keep
  one runner file per language under `harness/runners/`.
- **Long-lived processes** — MCP/LSP clients must be cached per-harness,
  not per-request; otherwise the spawn cost lands on every click. Tear
  down on `process.on('SIGTERM')`.
- **Stateful generators** — always scratch into a temp dir; never let a
  click write into the user's repo root.

---

## 5. Polyglot helper scripts — when the harness needs a hand

Bun is great at HTTP + spawn, but it's the wrong place to live-import a
Python pub-sub client, sign a Ruby S3 request with the project's own
credentials chain, or speak a Go daemon's private unix-socket
protocol. When the demo needs **asynchronous activity in the target's
own language** — manually triggering an event, uploading a file via
the target's SDK, signalling a daemon — write a small helper script
in that language under `<target>/.anydemo/<slug>/harness/runners/` and
have the Node handler `Bun.spawn` it.

### When to write a helper script

- The trigger requires the target's own client library (Kafka producer
  written for `confluent-kafka`-python; S3 uploader using the project's
  IAM helper; gRPC client generated from a `.proto` only the target has).
- The trigger is a process signal / unix-socket / shared-memory
  mechanism a Bun handler can't drive cleanly.
- The demo needs to "kick" an async pipeline at a specific stage that's
  easier expressed in 30 lines of the native language than in 80 lines
  of Bun spawning native binaries.
- The user explicitly asks for a manual-trigger button ("let me drop a
  fake order into the worker", "post a webhook from this node").

If a Bun-only handler can do the job in equivalent code, prefer Bun.
Helper scripts are extra surface area to maintain.

### Layout

```
<target>/.anydemo/<slug>/harness/
├── server.ts
├── package.json
├── fixtures/
│   ├── orders.json
│   └── photo.png
└── runners/
    ├── publish_event.py      # kafka-python producer; one event per invocation
    ├── upload_fixture.rb     # uses the target's S3 wrapper
    ├── signal_worker.go      # writes a trigger byte to the daemon's socket
    ├── trigger_etl.sh        # invokes `make ingest` with curated env
    └── README.md             # one line per runner: purpose, runtime, fired by which playNode
```

### Rules

- **Write in the target's language**, not Bun. The point is to reuse
  the target's own SDK/client code so the demo exercises the real path.
- **Tiny.** Aim for 20–40 lines. Glue, not logic.
- **Single-purpose.** One runner per asynchronous trigger; name it
  after the action (`publish_event.py`, not `helpers.py`).
- **Read inputs from argv / env.** No interactive prompts. The Node
  handler passes a fixture path or message id as an argument.
- **Print one JSON line on stdout** for success/failure so the Node
  handler can parse and `emit()` accordingly:
  `{"ok": true, "messageId": "..."}` or `{"ok": false, "error": "..."}`.
- **Document the runtime requirement** in `runners/README.md`. If the
  script needs Python ≥ 3.10 with `kafka-python`, say so — don't
  silently assume.
- **Never embed credentials.** Read from env (`KAFKA_BROKER`,
  `AWS_PROFILE`, …), fail loud if missing.
- **Record in `tier-evidence.json.helperScripts[]`** so a re-run
  regenerates them deterministically.

### Example — Node handler + Python runner

```ts
// .anydemo/<slug>/harness/server.ts
app.post('/play/publish-order', async (c) => {
  await emit(DEMO_ID, 'kafka-producer', 'running');
  const proc = Bun.spawn(
    ['python3', './runners/publish_event.py', 'orders.created', `${FIX}/orders.json`],
    { cwd: import.meta.dir, stdout: 'pipe' },
  );
  const out = await new Response(proc.stdout).text();
  const result = JSON.parse(out.trim().split('\n').pop() ?? '{}');
  await emit(DEMO_ID, 'kafka-producer', result.ok ? 'done' : 'error');
  return c.json(result);
});
```

```python
# .anydemo/<slug>/harness/runners/publish_event.py
# Requires: python>=3.10, kafka-python>=2.0
import json, os, sys
from kafka import KafkaProducer

topic, fixture = sys.argv[1], sys.argv[2]
producer = KafkaProducer(bootstrap_servers=os.environ.get('KAFKA_BROKER', 'localhost:9092'))
with open(fixture, 'rb') as f:
    fut = producer.send(topic, f.read())
try:
    meta = fut.get(timeout=5)
    print(json.dumps({'ok': True, 'partition': meta.partition, 'offset': meta.offset}))
except Exception as e:
    print(json.dumps({'ok': False, 'error': str(e)}))
finally:
    producer.flush()
    producer.close()
```

### Pitfalls

- **Don't hide the runtime requirement.** A demo that silently fails
  because `kafka-python` isn't installed is worse than a static diagram.
  The harness `/health` route should probe `python3 -c 'import kafka'`
  on boot and refuse to start with a clear error if missing.
- **Don't reach back into the target's source tree to import unstable
  internals.** Use the target's *public* SDK. If only an internal module
  works, that's a signal the demo should be Tier 3 for that surface.
- **Don't pipe binary data through stdout when also using stdout for
  JSON status.** Pick one channel; stream binary to a file under
  `out/` and reference the path in the JSON.
- **Don't let the runner outlive the request.** Bound it with a
  `timeout` arg or `signal.alarm()`; the harness should `proc.kill()`
  on request abort.
