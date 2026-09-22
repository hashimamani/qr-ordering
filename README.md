# QR Table Ordering Platform

Multi-tenant SaaS: restaurants put a QR code on each table, customers order
from their phone with no login, staff run kitchen/bar/waiter dashboards.
Payment is collected manually by the waiter — no in-app payment in v1.

## Status: all 9 build steps done; infra written but never deployed

The application (steps 1–7) is fully built and verified locally end-to-end.
AWS infrastructure as code and CI/CD (step 8) is written in CDK and
`cdk synth` succeeds for all 8 stacks — but **nothing has been deployed**.
Load testing (step 9) has been run against the local server; real
AWS-hosted numbers still need a real deployment to measure. See "Deploying
for real" before running `cdk deploy`.

## Stack

- **Language**: TypeScript / Node 20
- **HTTP**: Express (`src/app.ts`) — a thin adapter; route bodies are
  one-line calls into `modules/*/*.service.ts`. `src/server.ts` runs it
  locally; `src/lambda.ts` wraps the same `buildApp()` for API Gateway via
  `serverless-http`
- **DB**: PostgreSQL via `pg`, raw parameterized SQL (no ORM) so the tenant
  filter in every query is visible and auditable
- **Migrations**: `node-pg-migrate`
- **Validation**: `zod`
- **Auth**: `jsonwebtoken` (staff JWT, scoped to `restaurant_id` + `role`),
  `bcryptjs` for password hashing
- **Real-time**: `ws` locally; API Gateway WebSocket + DynamoDB connection
  tracking in production — same room/event contract either way (see
  "Real-time layer")
- **Notifications**: pluggable `NotificationProvider`/`NotificationQueue`
  abstractions — Africa's Talking (SMS) + AWS SES (email) providers, an
  in-process queue locally / SQS in production
- **QR codes**: `qrcode`, rendered server-side as base64 PNG
- **Logging**: `pino` / `pino-http`, structured JSON
- **Tests**: `vitest`
- **Infra**: AWS CDK (TypeScript), under `infra/` as its own npm project

## Design decisions carried over from the spec (do not "fix" these)

- Customer ordering is stateless — no login, no session cookie. A refresh
  mid-browse is a fresh start, by design.
- The order itself is the recovery mechanism: `contact_value` is required
  at submission, and `/track/{public_token}` is the *only* way a customer
  ever sees status again. There is no "my orders" list.
- `Order.id` is an internal bigserial and is never serialized in any API
  response — only `public_token` is exposed, anywhere, including staff
  dashboards.
- Every query for restaurant-scoped data takes `restaurant_id` as a
  mandatory parameter and filters on it inside the repository function —
  never trusted from a request body, URL, or the staff JWT's claims
  without re-deriving from the token.
- `Order.contact_value` is deliberately not yet used as a cross-order
  lookup key — that's the future "statement by phone number" feature,
  explicitly out of scope.
- Notification sending is decoupled from order submission via a queue and
  never blocks or fails the HTTP request; every delivery attempt writes
  its own `NotificationLog` row, success or failure.
- `order_ready` fires exactly once per order — on the *first* order_item
  to reach `ready`, not on every item transition.
- The data layer stayed on PostgreSQL, not DynamoDB, even though that
  would have sidestepped the NAT Gateway cost below — this was an explicit
  choice after weighing the trade-off (see "Two infra decisions" below),
  not an oversight.

## Deliberate additions beyond the literal spec (flagged, not silent)

1. **`MenuItem.destination`** (kitchen/bar) — the original schema draft
   has `OrderItem.destination` but no source field on `MenuItem` to derive
   it from. Added `MenuItem.destination` and copy it onto each
   `OrderItem` at order-creation time, so a later menu edit can't silently
   reroute an order already in the kitchen queue.
2. **`POST /admin/restaurants/signup`** — the spec's admin routes are all
   gated by a staff JWT, but nothing creates the *first* restaurant +
   admin user for a brand-new tenant (chicken-and-egg). Added this one
   bootstrap route, gated by a shared `PLATFORM_ADMIN_KEY` header instead
   of a staff JWT.
3. **A migration-runner Lambda** (`src/lambda-migrate.ts`,
   `infra/lib/migration-stack.ts`) — RDS sits in a private subnet with no
   bastion host, so CI/CD needs *some* way to run `node-pg-migrate`
   against it. Invoked by hand (`aws lambda invoke`) rather than on any
   automatic trigger.

## Two infra decisions worth understanding, not just accepting

**Why there's a NAT Gateway (~$32-38/month, the one non-pay-per-use line
item in this whole architecture).** RDS Postgres only knows how to live on
a private network address inside a VPC. The notification-worker Lambda
needs both private RDS access *and* to call Africa's Talking's public API
(no AWS VPC endpoint exists for third-party SaaS) — that combination is
what forces a NAT Gateway to exist at all; it isn't there for RDS access
itself, which is free within the VPC. The alternative (take that one
Lambda out of the VPC, give RDS a public endpoint instead) was considered
and rejected: `publicly_accessible` is all-or-nothing on the RDS resource,
so "just for one Lambda" isn't actually possible — it would mean the
production database, not just one function, becomes reachable from the
public internet, and Lambda's lack of a fixed outbound IP means no
security-group rule could narrow that back down to "just this caller."
Switching the whole data layer to DynamoDB (which needs no VPC at all, the
same reason a sibling project's Lambdas never needed one) was also
considered and explicitly declined, to keep the relational joins and
transactions the dashboards and billing-adjacent order data lean on. A
cheaper self-managed NAT instance (~$3-4/month, no AWS-managed
reliability) was the other option on the table; the managed Gateway was
chosen for simplicity.

**Why WebSocket connections are tracked in DynamoDB, not Postgres.** API
Gateway WebSocket Lambdas are stateless, so broadcasting to "everyone
subscribed to this room" needs some store mapping connectionId → room.
DynamoDB is reachable from Lambda without any VPC attachment, so using it
here keeps `lambda-websocket.ts` and the broadcast path (`broadcastEvent`
→ `dynamoBroadcaster.ts`) fast, NAT-independent, and pay-per-request. This
is the one place this app uses two storage technologies instead of one;
it was weighed against going all-DynamoDB (see above) and chosen as the
narrower, deliberate exception rather than the default.

## Real-time layer

Local dev: a single `ws` endpoint at `/realtime`
(`src/realtime/socketServer.ts`). Production: API Gateway WebSocket API +
three Lambdas (`src/lambda-websocket.ts`) backed by a DynamoDB connections
table. Both share the exact same room/event contract and the same
authorization logic (`src/realtime/roomAuth.ts`), so client code never
needs to know which one it's talking to. Application code calls one
function, `broadcastEvent()` (`src/realtime/broadcaster.ts`), which picks
the right transport based on whether it's running in Lambda
(`AWS_LAMBDA_FUNCTION_NAME` is set) or locally.

Rooms:
- `restaurant:{id}:kitchen`, `restaurant:{id}:bar`, `restaurant:{id}:waiter`
  — staff dashboards join these; joining requires a `token` field (the
  staff JWT) matching that `restaurant_id` and role (or `admin`)
- `order:{public_token}` — no auth needed to join, same bearer-token
  threat model as the HTTP tracking endpoint

Join protocol: send `{"type":"join","room":"...","token":"..."}` after
connecting. Events pushed: `new_order`, `order_placed`,
`item_status_changed`, `status_changed`, `session_closed`. HTTP polling
still works unchanged — the WebSocket layer is additive.

## Local setup

```bash
docker compose up -d          # Postgres on localhost:5434
cp .env.example .env
npm install
npm run migrate:up
npm run seed                  # demo restaurant "amani-grill", 2 tables, menu, 4 staff logins
npm run dev                   # http://localhost:3010
```

`npm run seed` prints per-table QR URLs and demo staff logins (password
`password123` for all four roles) to the console. Notifications default
to dry-run (`NOTIFICATIONS_DRY_RUN=true`) — they log instead of calling a
real provider.

## Deploying for real

**Not done as part of this build — this needs your explicit go-ahead and
your own AWS credentials.** `cdk synth` (no AWS credentials needed) has
been run and succeeds; `cdk deploy` has not been run at all.

```bash
cd infra
npm install
npx cdk bootstrap   # once per AWS account/region
npx cdk deploy --all
```

After deploying:
1. Populate the two AT/SES + platform-admin-key fields CDK leaves as
   empty placeholders in the `AppSecret` (see its `CfnOutput` for the
   ARN) — CDK creates secrets, it never invents real credential values.
2. Invoke the migration Lambda once (see `QrOrderingMigration`'s
   `CfnOutput` for its function name):
   `aws lambda invoke --function-name <name> --payload '{}' out.json`
3. Set `PUBLIC_BASE_URL`/`PUBLIC_ORDERING_BASE_URL` to your real domain
   and redeploy — they default to a placeholder.

`.github/workflows/deploy.yml` automates this on merge to `main`, but only
once an `AWS_DEPLOY_ROLE_ARN` repository secret exists (an IAM role the
workflow assumes via OIDC, no long-lived keys) — until then it fails
immediately at the credentials step and touches nothing. Read the NAT
Gateway cost note above before configuring that secret: creating
`QrOrderingNetwork` starts a ~$32-38/month charge that runs continuously
until the stack is destroyed, independent of order volume.

## Load testing (step 9)

Run against the local dev server: `npm run loadtest`
(`scripts/loadtest.ts`, using `autocannon`). Real numbers from this
machine, local Docker Postgres, 2026-09-22:

| Endpoint | req/s | p50 | p99 |
|---|---|---|---|
| `GET /r/{slug}/t/{qrToken}` (menu resolution) | 1860 | 10ms | 16ms |
| `POST /r/{slug}/t/{qrToken}/orders` (order submission) | 1320 | 7ms | 12ms |
| `GET /track/{public_token}` (below rate limit) | 20 | 0ms | 3ms |

The rate-limit burst test (60 requests against a 30/min/IP cap, with 20
already spent by the prior baseline test) returned exactly 10 more 2xx
and 50 429s — confirms the limiter engages precisely at the configured
threshold rather than being silently bypassed.

**These are local numbers, not production ones** — no network hop, no
Lambda cold start, no real RDS latency. Re-run this (or a proper
distributed load test) against a deployed staging environment before
calling v1 load-tested, per the original build order's own framing.

## Verified locally (steps 1–7)

- Full customer flow: resolve table → menu → place order → tracking page,
  including cross-tenant isolation (wrong-tenant `qr_token` 404s,
  wrong-tenant `menu_item_id` rejected)
- Staff login issues a `restaurant_id`+`role`-scoped JWT; wrong password
  and wrong restaurant both return the same 401 (no user enumeration)
- Kitchen/bar dashboards return only that tenant's items, grouped by
  table, filtered by destination; role gating enforced
- Order-item status transitions are forward-only; a backward transition
  is rejected with 409; touching another tenant's order item 404s
- Waiter view renders each `Order` as its own block per table, never
  flattened — verified with two simultaneous orders at one table
- Closing a table session is idempotency-guarded (409 on double-close);
  scanning the table again after close opens a fresh session
- `order_received` and `order_ready` notifications both fire exactly once
  and write `NotificationLog` rows
- WebSocket: a client joining `order:{token}` and an authorized
  `restaurant:{id}:kitchen` room received live pushes on a status change;
  joining a restaurant room with no/wrong token was rejected
- Admin: signup requires the platform key; menu/table CRUD rejects
  cross-tenant `category_id`; generated QR PNGs are valid images
- `npx vitest run` — 7 passing tests; `npx tsc --noEmit` — clean under
  `strict`, both in the app and in `infra/`
- `cd infra && npx cdk synth` — all 8 stacks synthesize with no errors;
  exactly 1 NAT Gateway, RDS confirmed `PubliclyAccessible: false`

## Known gaps to close before this counts as "production"

- **Nothing has been deployed to AWS.** `cdk synth` succeeding is not the
  same as a working deployment — Secrets Manager values, IAM policy
  edge cases, and cross-stack wiring are only really proven by a real
  `cdk deploy`.
- `npm audit` flags dev-only transitive vulnerabilities (vitest's
  `esbuild` dev server, `node-pg-migrate`'s `glob` CLI, `africastalking`'s
  `joi`) — none reachable at runtime, but revisit before this matters
- No automated integration tests against a real Postgres yet outside of
  CI (`ci.yml` does run migrations + tests against a real Postgres
  service container, but there's still just the one unit-test file)
- `PUBLIC_BASE_URL` / `PUBLIC_ORDERING_BASE_URL` must be set correctly per
  environment or tracking links and generated QR codes point at the wrong
  host
- Load numbers above are local-only (see "Load testing")
- The `WebSocketLambdaIntegration`/`WebSocketApi` construct in the CDK
  version this pins to (2.155.0, deliberately downgraded from the latest
  2.270.0 after that version's newer telemetry/metadata system caused a
  `SectionAlreadyContains` synth error unrelated to this app's own code)
  needed explicit `WebSocketRoute` construction with hand-chosen ids to
  avoid a duplicate-resource collision — worth re-testing against newer
  CDK releases periodically in case it's fixed upstream
- `cdk synth` triggers one live, read-only AWS API call
  (`DescribeAvailabilityZones`) if any AWS credentials happen to be
  configured in the ambient environment it runs in — harmless, but worth
  knowing before assuming `synth` is fully offline; `cdk.context.json`
  (which would cache the discovered account id) is gitignored so this
  never gets committed

## Build order (from the original spec)

1. ~~Postgres schema + migrations, seed script~~ — done
2. ~~Core order-submission API~~ — done
3. ~~`/track/{public_token}` endpoint~~ — done
4. ~~Notification service (SQS-backed), wired into order submission~~ — done
5. ~~Staff auth + kitchen/bar/waiter dashboards~~ — done
6. ~~Real-time layer~~ — done
7. ~~Admin onboarding~~ — done
8. ~~AWS infra as code, CI/CD~~ — written, `cdk synth` verified, never deployed
9. ~~Load test order-submission and tracking~~ — done locally; re-run against staging before v1
