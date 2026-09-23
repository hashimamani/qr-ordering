# QR Table Ordering Platform

Multi-tenant SaaS: restaurants put a QR code on each table, customers order
from their phone with no login, staff run kitchen/bar/waiter dashboards.
Payment is collected manually by the waiter — no in-app payment in v1.

## Status: all 9 build steps done, deployed live to AWS (eu-west-1), real separate frontend

The application (steps 1–7) is fully built and verified both locally and
against the live deployment. AWS infrastructure (step 8) is deployed for
real — all 9 CDK stacks are up in `eu-west-1` (including a dedicated
`FrontendStack`), migrated, seeded, and verified end-to-end: a real order
placed against the live API triggers a real SMS via Africa's Talking,
shows up live on the staff dashboards over the deployed WebSocket API,
and updates the customer's tracking page in real time. Load testing
(step 9) has only been run against the local server so far — worth
re-running against the live deployment before calling this properly
load-tested.

The frontend was rebuilt from a Lambda-bundled test harness into a real,
separate production app: a React + Vite SPA hosted on S3 + CloudFront
(its own CDK stack, its own origin, talking to the API purely over CORS),
with role-gated routing for all four staff roles plus a new admin
dashboard (menu, tables/QR, staff management) that was previously
explicitly deferred. See "Frontend" below.

Three real bugs were only caught by actually deploying and testing live,
not by local development or `cdk synth`:
- RDS's default parameter group rejects unencrypted connections; the app
  and `node-pg-migrate` both needed SSL configured (`src/db/pool.ts`,
  `src/lib/awsSecrets.ts`) — local Docker Postgres has no SSL at all, so
  this was invisible locally.
- Africa's Talking's SMS API returns `statusCode: 100` ("Processed") for
  a successful send, not `101` as the original code checked for — every
  real send would have been logged as `failed` and retried needlessly
  despite actually delivering. Fixed to check the `status: "Success"`
  string field instead (`src/modules/notifications/notifications.providers.ts`).
- Africa's Talking's SDK rejects an explicitly-empty `from` field outright
  (not just an absent one) — when no sender ID is configured, the call was
  passing `from: ''`, so every real SMS failed with `"from" is not allowed
  to be empty`. Fixed by only including `from` in the request when a
  sender ID is actually configured (`notifications.providers.ts`).

See "Deploying for real" for how to reproduce this deployment and what it
actually took (including the NAT Gateway vs NAT instance saga and the
frontend's own deploy quirk).

## Live deployment

| | |
|---|---|
| Frontend | `https://d30j37oth3tsgq.cloudfront.net` |
| API | `https://gmejeftua9.execute-api.eu-west-1.amazonaws.com` |
| WebSocket | `wss://mlpy8jz5yb.execute-api.eu-west-1.amazonaws.com/prod` |
| Region | `eu-west-1` |
| Order (table 1) | `{Frontend}/order?slug=amani-grill&t=<table 1's qr_token>` |
| Staff login | `{Frontend}/staff/login` (password `password123`) |

Table `qr_token`s change every time the seed Lambda runs — query RDS or
re-invoke the seed Lambda to get current ones rather than assuming the
values are still live.

## Stack

- **Language**: TypeScript / Node 22 (Lambdas upgraded off Node 20.x after
  AWS's deprecation notice — see "Node 22 runtime" below)
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
- **QR codes**: `qrcode`, rendered server-side (admin API) and client-side
  (frontend, for tables created before a QR image existed) as PNG
- **Logging**: `pino` / `pino-http`, structured JSON
- **Tests**: `vitest`
- **Frontend**: React + React Router v7 + Vite, its own npm project under
  `frontend/`, hosted on S3 + CloudFront — see "Frontend" below
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
what forces something to exist at all for internet egress; it isn't
needed for RDS access itself, which is free within the VPC. The
alternative (take that one Lambda out of the VPC, give RDS a public
endpoint instead) was considered and rejected: `publicly_accessible` is
all-or-nothing on the RDS resource, so "just for one Lambda" isn't
actually possible — it would mean the production database, not just one
function, becomes reachable from the public internet, and Lambda's lack
of a fixed outbound IP means no security-group rule could narrow that
back down to "just this caller." Switching the whole data layer to
DynamoDB (which needs no VPC at all, the same reason a sibling project's
Lambdas never needed one) was also considered and explicitly declined, to
keep the relational joins and transactions the dashboards and
billing-adjacent order data lean on.

The remaining choice was managed NAT Gateway (~$32-38/month, AWS-managed,
no server to patch) vs. a self-managed NAT instance (~$3-4/month, one EC2
box you own patching, no AWS-managed failover). **This deployment actually
tried the NAT instance first** (`ec2.NatProvider.instanceV2`, a `t4g.nano`)
to get the cheaper cost, and it was a real lesson in why "managed" is
worth paying for: the library's default NAT setup script assumes an
`iptables-services` package that doesn't exist on the Amazon Linux 2023
AMI it resolves to, so the install silently failed and the instance ran
fine while forwarding zero traffic. Three separate fixes and instance
replacements later (confirmed via VPC Reachability Analyzer that
routing/security groups were never the problem — something at the OS
level inside the instance kept black-holing traffic, and it couldn't be
reached via SSH or SSM to debug further), the pragmatic call was to
revert to the managed Gateway and treat the NAT instance as a follow-up
worth revisiting with SSM access wired up first, not something to keep
blocking a working deployment on. The code for the NAT instance attempt
is preserved in git history (see the "Frontend test harness, seed
Lambda, NAT instance, eu-west-1" and later commits) if picking this back
up later.

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

## Frontend

`frontend/` is a genuinely separate app — its own `package.json`, its own
build, its own deployed origin (S3 + CloudFront) — not bundled into the
API Lambda the way the first working version was. It talks to the API
only over HTTP/WebSocket across origins, via CORS (`corsPreflight` on the
HTTP API in `api-stack.ts`; a small dev-only CORS middleware in
`src/app.ts` for local use since `vite dev` and `npm run dev` run on
different ports).

Routes:
- `/order?slug=..&t=..`, `/track/:token` — customer flow, no auth
- `/staff/login` — redirects by role after login: `admin` → `/admin`,
  `kitchen` → `/staff/kitchen`, `bar` → `/staff/bar`, `waiter` →
  `/staff/waiter`
- `/staff/kitchen`, `/staff/bar`, `/staff/waiter` — role-gated dashboards
- `/admin` — tabs for menu (category/item CRUD), tables (create + QR,
  server-generated PNG for new tables, client-side `qrcode` render for
  existing ones), and staff (create + list; no edit/delete, matching what
  the API supports)

Auth: the staff JWT issued by `POST /auth/login` is decoded client-side
(`AuthContext.tsx`) purely to drive which nav links and routes render —
**this is explicitly a UX convenience, not a security boundary.** Every
API request still carries the JWT as a bearer token, and every backend
route independently re-derives `restaurant_id` + `role` from it and
re-checks tenant/role scope server-side; a user editing `localStorage` to
fake a role gets past the frontend's `ProtectedRoute` but every request
still 401s/403s at the API.

Local dev: `npm install && npm run dev` inside `frontend/` (port 5173,
`.env.local` points it at the local API on 3010). Build for deploy:
`npm run build` (reads `.env.production`, gitignored — holds the real
deployed API/WS URLs, not secrets) emits static assets to `frontend/dist`.

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

**Currently deployed** to AWS account `304442552123`, region `eu-west-1`
(chosen for latency to Kenya/Africa's Talking over the account's default
`us-east-1`). All 9 stacks are up, migrated, and seeded with the same
demo restaurant (`amani-grill`) the local seed script creates.

```bash
cd infra
npm install
npx cdk bootstrap   # once per AWS account/region
npx cdk deploy --all
```

After deploying:
1. Populate the two AT/SES + platform-admin-key fields CDK leaves as
   empty placeholders in the `AppSecret` (see its `CfnOutput` for the
   ARN) — CDK creates secrets, it never invents real credential values:
   `aws secretsmanager put-secret-value --secret-id <arn> --secret-string '{"jwtSecret":"<keep the auto-generated one>","platformAdminKey":"...","africastalkingApiKey":"...","africastalkingUsername":"...","africastalkingSenderId":"","sesFromAddress":""}'`
2. Invoke the migration Lambda once, then the seed Lambda (see
   `QrOrderingMigration`'s `CfnOutput`s for both function names):
   `aws lambda invoke --function-name <name> --payload '{}' out.json`
3. Set `FRONTEND_URL` in the shell CDK runs in to the real
   `QrOrderingFrontend.FrontendUrl` output (its CloudFront domain) and
   redeploy `QrOrderingApi` — this feeds both `corsOrigins` (so the API
   accepts requests from the real frontend origin) and
   `PUBLIC_BASE_URL`/`PUBLIC_ORDERING_BASE_URL` (so tracking links and
   generated QR codes point at it). It defaults to `localhost:5173` on
   first deploy, since the CloudFront URL doesn't exist until after that
   first deploy creates it.
4. Build and publish the frontend itself — **not** done by `cdk deploy`,
   see below:
   ```bash
   cd frontend
   npm install
   # .env.production holds the real deployed API/WS URLs (gitignored, not secret)
   npm run build
   aws s3 sync dist s3://<QrOrderingFrontend.FrontendBucketName> --delete
   aws cloudfront create-invalidation \
     --distribution-id <QrOrderingFrontend.FrontendDistributionId> \
     --paths '/*'
   ```

**Things that only surfaced deploying for real, not from `cdk synth`:**
RDS needs SSL (`?sslmode=no-verify` appended to `DATABASE_URL` in
`awsSecrets.ts`, plus `ssl` config in `db/pool.ts`) — local Docker
Postgres has none configured, so nothing local would have caught this.
The migration/seed Lambdas take a `Requested update requires the
creation of a new physical resource` style replacement badly the first
time you touch `NetworkStack` after they've already been granted access —
not actually a problem in practice, just worth knowing `cdk deploy
QrOrderingNetwork` alone is the right scope for network-only changes
rather than `--all`. And `aws-s3-deployment`'s `BucketDeployment`
construct — the obvious way to have CDK upload `frontend/dist` itself —
fails on this CDK version (2.155.0): its custom-resource Lambda bundles
an awscli/urllib3 build that uses Python 3.10+ union syntax (`bytes |
str`) but runs on a Python 3.9 runtime, so every deploy attempt failed
immediately with `TypeError: unsupported operand type(s) for |: 'type'
and 'type'`. `FrontendStack` deliberately doesn't use it — the manual
`aws s3 sync` + `create-invalidation` step above is the workaround, the
same "CDK provisions infra, a scripted AWS CLI step handles content"
pattern already used for migrations and seeding.

### Node 22 runtime

All Lambda functions were upgraded from `nodejs20.x` to `nodejs22.x`
(`infra/lib/runtime.ts`, referenced from every stack that defines a
function) after AWS's Node 20 deprecation notice. Each stack's shared
`logRetention` option was also replaced with an explicit `logs.LogGroup`
construct per function — `logRetention` is deprecated in this CDK
version and was emitting a synth-time warning independent of the runtime
change.

`.github/workflows/deploy.yml` automates this on merge to `master`, but only
once an `AWS_DEPLOY_ROLE_ARN` repository secret exists (an IAM role the
workflow assumes via OIDC, no long-lived keys) — until then it fails
immediately at the credentials step and touches nothing. Read the NAT
Gateway cost note above before configuring that secret: creating
`QrOrderingNetwork` starts a ~$32-38/month charge that runs continuously,
independent of order volume, until the stack is destroyed.

**Tearing down between demos:** `cdk destroy --all` removes everything
*except* the RDS instance and `AppSecret` — both are `RemovalPolicy.RETAIN`
on purpose (never lose real order data to an accidental destroy). RDS
free tier likely makes leaving it running between sessions genuinely
free for the first 12 months; if you want a truly zero-cost teardown,
delete those two by hand afterward (you'll need to re-seed next time).

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
- `cd infra && npx cdk synth` — all 9 stacks synthesize with no errors;
  one NAT Gateway, RDS confirmed `PubliclyAccessible: false`

## Verified against the live AWS deployment

- `GET /r/amani-grill/t/{qrToken}` on the real `HttpApiUrl` returns the
  real seeded menu from RDS
- A real order placed against the live API returned a `tracking_url`
  pointing at the live domain, and the tracking endpoint reflects it
- A real Africa's Talking SMS was sent and accepted (`status: "Success"`,
  a real KES 0.80 charge) for both the `order_received` and
  `order_ready` triggers, via the deployed notification-worker Lambda —
  not a dry run
- Live staff login → bar dashboard → status transitions
  (`received → preparing → ready → served`) all worked against the
  deployed API and RDS
- A `ws` client connected to the deployed API Gateway WebSocket
  (`wss://.../prod`), joined an `order:{token}` room, and received a
  live `status_changed` push when a staff status update happened via the
  REST API — confirms the DynamoDB-backed broadcast path
  (`dynamoBroadcaster.ts`) works end-to-end, not just the local `ws` path
- The real React frontend on CloudFront, verified live via the Browser
  pane against the deployed stack, not just `cdk synth`/unit tests:
  placing a customer order from `/order` through to the tracking page
  with live WebSocket status updates; admin login → menu/table/staff CRUD
  across all three admin tabs, including generating a new table's QR
  code server-side and rendering an existing table's QR client-side;
  kitchen-role login redirecting to `/staff/kitchen` with only
  kitchen-relevant nav links shown, confirming the client-side role gate
  matches the JWT the API actually issued
- Confirmed CORS works cross-origin in production: the frontend on
  `https://d30j37oth3tsgq.cloudfront.net` successfully calls the API on
  a different `execute-api.eu-west-1.amazonaws.com` origin with no CORS
  errors, via the HTTP API's `corsPreflight` config

## Known gaps to close before this counts as "production"

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
- Frontend deploys are a manual `aws s3 sync` + CloudFront invalidation
  after `npm run build` (see "Deploying for real"), not part of
  `cdk deploy` — `deploy.yml` doesn't build/publish the frontend on merge
  yet, so a `master` merge that only touches `frontend/` won't actually
  update the live site until that step is added or run by hand
- No automated tests for the frontend yet (no component/e2e test runner
  wired into `frontend/`'s `package.json`) — the "Verified against the
  live AWS deployment" section above is manual browser verification, not
  a repeatable test suite

## Build order (from the original spec)

1. ~~Postgres schema + migrations, seed script~~ — done
2. ~~Core order-submission API~~ — done
3. ~~`/track/{public_token}` endpoint~~ — done
4. ~~Notification service (SQS-backed), wired into order submission~~ — done
5. ~~Staff auth + kitchen/bar/waiter dashboards~~ — done
6. ~~Real-time layer~~ — done
7. ~~Admin onboarding~~ — done
8. ~~AWS infra as code, CI/CD~~ — deployed live to eu-west-1, verified end-to-end with real SMS
9. ~~Load test order-submission and tracking~~ — done locally; re-run against the live deployment next
