# Two flavors of runnable node — full criteria + phase breakdown

This file accompanies SKILL.md's "Two flavors of runnable node —
triggers and observers" section. The two-bullet definition and the
"Pair only across real seams" rule are summarized in SKILL.md; the
full when-to-pair / when-to-skip criteria and the per-phase mechanics
live here.

Read this when:

- Phase 4 (node-selector) needs to decide whether a `dynamic-play`
  candidate should also generate a matching `dynamic-event` observer.
- Phase 5 (wiring-builder) needs to pick the connector `kind` between
  a trigger and an observer.
- Phase 5b (harness-author, Tier 2) needs to drive observer state
  from inside a bridge handler.

## The two flavors

- **Trigger nodes (`playNode`)** — clickable boxes with a
  `playAction`. Fire an HTTP request when the user clicks. Studio
  renders a Play button.
- **Observer nodes (`stateNode` with `stateSource: { kind: 'event' }`)**
  — non-clickable. Studio animates: idle → spinner (`emit('running')`)
  → green tick (`emit('done')`) or red (`emit('error')`). Represent
  the *consequence* of a trigger — the DB row written, the S3 object
  arrived, the queue message consumed, the email sent.

A good diagram almost always contains BOTH paired together across
real seams. Apply the abstraction rule (`SKILL.md` "Pick the right
abstraction") FIRST to settle what counts as a node; then pair
triggers with observers across the seams that survived.

## Canonical pairing — upload → S3

A user clicks a trigger `playNode` labeled "Upload file"; the request
flows through the harness; the harness emits `running` then `done`
to a downstream observer `stateNode` labeled "S3 bucket". The reader
watches the S3 box flip from spinner to green tick — visible
confirmation the file arrived.

The same pattern applies to: "Create order" → "Orders DB", "Publish
event" → "Kafka topic", "Send email" → "SendGrid", "Enqueue job" →
"Queue depth", "Run job" → "Job output".

## Add an observer alongside a trigger when

- **The trigger lands in a store the reader cares about** — DB row,
  cache write, S3 object, blob, file system.
- **The trigger publishes an event or queue message** that another
  part of the system reacts to (Kafka topic, RabbitMQ queue, SNS,
  Pub/Sub).
- **The trigger kicks off async work** — a worker run, a scheduled
  job, a Temporal workflow start — and the reader wants to see
  completion.
- **The trigger has a side effect a reader would want to confirm
  visibly** — email sent, webhook fired, notification posted, SMS
  delivered, push notification dispatched.

## Skip the observer when

- **The trigger is purely synchronous** and returns the result
  inline — a math endpoint, a validation check, an idempotent
  lookup. The `playNode`'s own request-state animation
  (spinning → response) is enough; an extra observer adds noise.
- **The downstream resource is already drawn as a duplicated
  cross-cutting node** for visual clarity (see
  `references/visual-clarity.md`) and adds no new information at
  the observer position.
- **The downstream is an internal step of the same self-contained
  subsystem** (auth middleware, validation layer, DTO mapper). The
  abstraction rule already collapsed it — adding an observer back
  defeats the collapse.

## Per-phase mechanics

### Phase 4 — node-selector

Classifies each candidate into exactly one of `dynamic-play`,
`dynamic-event`, `static-state`, `static-shape`. For every
`dynamic-play` whose work has an observable consequence (DB write,
S3 upload, queue publish, event emission, job completion, webhook
fire), proposes a matching `dynamic-event` observer node as a
separate candidate. The observer carries the downstream resource's
label ("Orders DB", "Kafka orders.created", "S3 uploads/", "User
cache") and lives in its own lane on the diagram.

When the trigger is synchronous-only and the observer is being
skipped, the trigger's `rationale` field records why
(e.g. `"rationale": "Returns the computed total inline — no async
side effect"`).

### Phase 5 — wiring-builder

Wires the pair with a connector whose `kind` reflects the evidence:

- `event` if the trigger emits a named event from
  `boundary-surfaces.events[]` (e.g. `eventName: "orders.created"`).
- `queue` if the trigger publishes to a queue from
  `boundary-surfaces.queues[]` (e.g. `queueName: "shipment-jobs"`).
- `default` for plain reads/writes to a store, file system, or
  any seam without an event/queue identifier.

The connector's `source` is the trigger's node id and `target` is
the observer's node id. Direction is forward (default).

### Phase 5b — harness-author (Tier 2 only)

Drives observer state from inside each bridge handler. The pattern:

```ts
app.post('/play/upload-file', async (c) => {
  await emit(DEMO_ID, 's3-uploads', 'running');
  try {
    await bridgeToS3(/* CLI spawn, AWS SDK call, file drop, … */);
    await emit(DEMO_ID, 's3-uploads', 'done');
    return c.json({ ok: true });
  } catch (err) {
    await emit(DEMO_ID, 's3-uploads', 'error', { error: String(err) });
    return c.json({ ok: false, error: String(err) }, 500);
  }
});
```

Emit `running` synchronously inside the handler so the canvas shows
the spinner within ~100ms. Emit exactly one terminal state
(`done` OR `error`) when the bridge completes — never both.

For long-running bridges (Tier 2 file-drop into a watched
directory, Tier 2 CLI spawn that takes 30+ seconds), return the
HTTP response immediately with `202` and attach the terminal
`emit()` to the bridge's exit handler / poller. See
`references/trigger-bridges.md` for per-surface patterns.

### Tier 1 (real)

On Tier 1, the user's own app must call `emit()` for the observer
to animate. The skill does NOT inject `emit()` call-sites into user
code (wiring-builder explicitly forbids this). Document the
expected emit-site in the observer's `data.detail.description` so
the user knows where to wire it up.

## Anti-patterns

- **Observer-per-internal-step.** Don't add observers for every
  middleware layer, DTO mapping, or validation pass. Those are
  internal to a single subsystem (abstraction rule).
- **Trigger-without-observer for fire-and-forget async.** A
  `playNode` that enqueues a job and returns immediately, with no
  observer for the job's completion, leaves the reader staring at
  a `200 OK` with no sense of whether the work happened. Add the
  observer.
- **Double-emit on the same node.** Calling `emit('running')` then
  `emit('done')` then `emit('running')` again from a single click
  is flicker. The animation expects monotonic state per click.
- **Observer for state that never changes during the demo.** If
  the resource is read-only and the demo never writes to it,
  it's a `static-state` `stateNode` (no `stateSource: { kind:
  'event' }`), not an observer.
