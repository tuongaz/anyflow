# Pick the right abstraction — full example catalog

This file accompanies SKILL.md's "Pick the right abstraction — hide
internals, show seams" section. The principle is summarized there;
the full catalogue of traps and fixes lives here so the Phase 4
node-selector can scan a longer list when classifying candidates.

Read this when:

- The candidate list includes more than one node from inside a single
  workflow, transaction, handler chain, or other self-contained
  mechanism.
- The user's request names a subsystem ("the order pipeline", "the
  checkout flow") and the natural decomposition is ambiguous.
- The diagram is in danger of exceeding 30 nodes purely from internal
  decomposition rather than real cross-system seams.

## The rule

A node represents a system at the right zoom level for the **reader**,
not the implementer. The diagram exists for a teammate asking "what
happens when a user does X?" — not for someone refactoring the
implementation. Pick the boundary the reader cares about and hide
what's behind it. Decomposing a single self-contained subsystem into
its internal steps inflates the node count, drowns real seams, and
rewards the reader for clicking through implementation detail they
didn't ask about.

## Traps (DON'T) and fixes (DO)

### Workflow engines

- **Temporal / Step Functions / Inngest / Cadence workflow** — DON'T
  draw twelve nodes for `validateOrder`, `chargePayment`,
  `reserveInventory`, `sendEmail`, and their compensation activities.
  DO draw ONE node "Order workflow (Temporal)" with the activities
  listed in `data.detail.description`. Expose individual activities
  only when the user wants to play each one independently (rare).

### Serverless / functions-as-a-service

- **AWS Lambda / GCP Function / Azure Function** — DON'T draw API
  Gateway + authorizer + dispatcher + cold-start logic + handler as
  five nodes. DO draw ONE node "POST /orders (Lambda)" with the
  handler module in `filePath` and any non-default auth/runtime
  details in the description.
- **Cloudflare Workers / Vercel Edge Functions** — same principle:
  one node per route the user invokes, not one per middleware layer.

### Database operations

- **Transaction / saga** — DON'T draw
  `BEGIN → INSERT orders → INSERT line_items → UPDATE inventory →
  COMMIT` as five nodes. DO draw ONE node "Create order
  (transaction)" and list the writes in `data.detail.fields`.
- **Multi-statement query** — DON'T expose every CTE or subquery as
  its own node. DO draw ONE node for the query's logical purpose.
- **Stored procedure** — DON'T draw the procedure's internal
  branches. DO draw ONE node naming the procedure.

### Application code structure

- **Middleware chain** — DON'T draw `auth → rate-limit → CORS →
  logging → handler` as a five-node pipeline. DO draw ONE node
  "POST /orders" and list the middlewares in the description.
- **Controller → Service → Repository (DDD / Clean Architecture)** —
  DON'T draw the three layers as three nodes per route. DO draw
  ONE node per route at the controller boundary.
- **React / Vue / Svelte component tree** — DON'T draw `Page →
  Header → Layout → CheckoutForm → InputField` as a parent chain.
  DO draw ONE node "Checkout page" (or, for an SSR demo, the API
  route that hydrates it).
- **GraphQL resolvers** — DON'T draw every nested resolver as its
  own node. DO draw ONE node per top-level query/mutation the
  diagram exercises.

### Data pipelines

- **ETL step** — DON'T draw `read CSV → parse → validate →
  transform → write Parquet` as five nodes if all five live inside
  one `etl ingest` CLI invocation. DO draw ONE node "Ingest orders
  (CLI)" with the steps in the description.
- **Apache Beam / Spark / Flink DAG** — DON'T draw every PTransform
  / RDD operation. DO draw one node per logical job, two-to-three
  if the job has independent inputs/outputs.
- **Airflow / Prefect / Dagster DAG** — DON'T mirror the task graph
  one-for-one. DO collapse to ONE node per logical pipeline and
  expose individual tasks only when the user wants to retry them
  separately.

### State and caching

- **State machine / FSM** — DON'T draw every state of an order FSM
  (`pending → paid → shipped → delivered`) as separate nodes. DO
  draw ONE `stateNode` "Order state" whose `summary` lists the
  states and whose `description` notes the transitions.
- **Caching layer** — DON'T draw reader, writer, invalidator,
  warmer, and TTL refresher as five nodes. DO draw ONE `stateNode`
  "User cache" with cache-policy details in the description.
- **Distributed lock / coordination** — DON'T draw the lock
  acquisition flow. DO draw ONE node for the locked resource and
  mention the locking in the description.

### Service mesh / infrastructure

- **Service mesh sidecar** — DON'T draw envoy + ingress +
  circuit-breaker as separate nodes per service. DO draw ONE node
  per service; the mesh is invisible to the reader's mental model.
- **k8s Deployment + Service + Ingress + HPA** — DON'T draw the
  manifest topology. DO draw ONE node per logical service.
- **Database replicas / connection pool** — DON'T draw primary +
  replicas + connection pooler. DO draw ONE node "Orders DB" and
  mention the replication strategy in the description if relevant.

### Protocol surfaces

- **MCP server / gRPC service** — DON'T draw registry + dispatcher
  + per-tool handler as three nodes per tool. DO draw ONE node per
  *tool the diagram actually exercises*, skip the ones it doesn't.
- **REST API with 50 routes** — DON'T draw every route. DO draw
  only the routes the demo's user flow touches.
- **Event bus topics** — DON'T draw every topic the system uses.
  DO draw only the topics the demo's flow publishes to or consumes
  from.

### Message broker internals

- **Kafka consumer group** — DON'T draw broker + partition assigner
  + rebalance coordinator + per-partition consumer as four nodes.
  DO draw ONE node per logical consumer (e.g. "Orders consumer")
  and mention the consumer-group / partition strategy in the
  description.
- **SQS + SNS fan-out** — DON'T draw SNS topic + per-subscription
  filter + per-queue + per-consumer. DO draw ONE node per logical
  subscriber that the reader cares about; collapse the fan-out
  topology into the publisher's description.
- **Redis Streams consumer group** — DON'T draw `XADD` + `XREADGROUP`
  + claim handler + PEL inspector. DO draw ONE node per logical
  worker; note the group/PEL behavior in the description only when
  the reader cares about retry semantics.
- **Pub/Sub push vs pull subscriptions** — DON'T draw the
  push-endpoint + the retry-policy + the dead-letter as separate
  nodes. DO draw ONE subscriber node and mention DLQ/retry policy
  in the description.

### Auth / identity providers

- **OIDC / OAuth2 handshake** — DON'T draw redirect → authorize
  endpoint → callback → token exchange → JWKS lookup → refresh as
  six nodes. DO draw ONE node "Auth0" (or "Okta", "Cognito",
  "Clerk", …) with the protocol in the description.
- **JWT verification** — DON'T draw "extract token" + "fetch JWKS"
  + "verify signature" + "check claims" as four nodes inside an
  API request flow. DO collapse it into the API handler's
  description; the reader doesn't need to navigate the verification
  pipeline.
- **Session management** — DON'T draw session store + CSRF guard
  + cookie signer + session refresher. DO draw ONE `stateNode`
  "Session store" if it matters; otherwise omit.

## When TO expand internals

Expose internal structure ONLY when:

- **The internals ARE the subject** of THIS diagram. "Show me how
  our order saga handles compensation" makes the Temporal activities
  first-class; "diagram the checkout flow" does not.
- **Multiple internals are independently triggerable** and the
  reader wants to play them separately — each becomes its own
  `playNode`.
- **The internals span distinct owners** and the diagram exists to
  call out the ownership seam.
- **The reader is the implementer** — onboarding doc for someone
  taking over the subsystem, not a system-architecture overview.

When none of those apply, fold the subsystem into ONE node and push
the detail into `data.detail.description` and `data.detail.fields`.
The reader drills in by clicking, not by scanning a sprawl of boxes.

## The "next adjacent node" test

Before adding a node, ask: **does the next adjacent node belong to a
different owner, a different runtime, or a different network hop?**

- Yes → the seam is real; add the node.
- No → the candidate is an internal step of a single thing; fold it
  into the parent.

## Interaction with "Visual clarity — duplicate to declutter"

These two rules pull in opposite directions for different reasons:

- **Duplicate cross-cutting infrastructure** — databases, caches,
  auth services, primary queues. Same logical resource drawn many
  times next to its consumers so arrows stay local. See
  `references/visual-clarity.md`.
- **Collapse self-contained mechanisms** — workflows, transactions,
  middleware chains, ETL steps, state machines. Many internal pieces
  drawn as ONE node so the diagram stays at the right zoom.

Together: **draw shared infrastructure many times; draw private
internals not at all.** The test for which rule applies is the same
"next adjacent node" question — different owners/runtimes/hops mean
seam (add or duplicate); same owner/runtime/hop means internal
(collapse).
