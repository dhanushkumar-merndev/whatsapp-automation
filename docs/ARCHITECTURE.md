# Architecture

## System overview

```mermaid
flowchart LR
  C[Customer on WhatsApp] -- "messages first" --> M[Meta Cloud API]
  M -- "signed webhook (X-Hub-Signature-256)" --> W["/api/webhooks/whatsapp"]
  W -- "record_inbound_message (atomic, deduplicated)" --> DB[(Supabase Postgres)]
  W -- "200 OK, then after()" --> P[Conversation processor]
  P -- "lease lock per conversation" --> DB
  P -- "rate limit per WhatsApp ID" --> R[(Upstash Redis)]
  P --> E[Flow engine]
  E -- "send (idempotency key, 24h window check)" --> M
  E -- "Wait node → publish with delay" --> Q[Upstash QStash]
  Q -- "signed callback" --> J["/api/jobs/qstash"]
  J --> E
  E -- "Save lead → CRM webhook (HMAC, SSRF-guarded)" --> CRM[External CRM]
  A[Admin browser] -- "MFA aal2 session" --> UI[Next.js dashboard]
  UI -- "RLS-scoped queries" --> DB
  UI -- "signed upload URL" --> S[(Supabase Storage — private)]
  E -- "media: download + upload to Meta" --> S
  V[Vercel Cron daily] --> SW["/api/cron/sweep"]
  SW --> DB
```

**Design principles**

- **Customer-initiated only.** The engine only ever starts from a stored inbound message (`startExecution`) or resumes an execution that a customer started. There is no outbound trigger, template sender or campaign code. Every send checks the 24-hour window right before it happens, including sends that resume from QStash.
- **Ports and adapters.** `lib/engine` and `lib/core` are pure TypeScript and talk to the outside world through `EngineStore`, `MessageSender`, `Scheduler` and `CrmDispatcher`. Production wires in Supabase, Meta, QStash and HTTP adapters. The editor's simulator and the tests use the `MemoryStore` and recording fakes, so the same engine code is exercised everywhere.
- **Durable first, fast acknowledgement.** The webhook verifies the signature, records the event in a single transaction (the unique `wa_message_id` deduplicates Meta retries), returns 200, and processes the conversation afterwards. If recording fails, the response is non-2xx so Meta retries.

## Message flow

```mermaid
sequenceDiagram
  autonumber
  participant Cu as Customer
  participant Me as Meta
  participant Wh as Webhook
  participant Db as Postgres
  participant En as Engine
  participant Qs as QStash
  Cu->>Me: "Hi"
  Me->>Wh: POST event (signed)
  Wh->>Wh: verify HMAC over raw body
  Wh->>Db: record_inbound_message (contact, conversation, last_inbound_at, message)
  Wh-->>Me: 200 OK
  Wh->>Db: acquire_conversation_lock
  Wh->>En: no active execution → select trigger → startExecution
  En->>Db: claim_outbound_message (idempotency key)
  En->>Me: Welcome text
  En->>Me: Brochure (media id; skipped within 24h cooldown)
  En->>Db: scheduled_jobs row
  En->>Qs: publish {jobId}, delay 5s, deduplicationId = jobId
  Wh->>Db: release lock (re-check for pending messages)
  Qs->>En: POST /api/jobs/qstash (signed) ~5s later
  En->>Db: claim_scheduled_job (once only)
  En->>En: flow active? window open? → resumeAfterDelay
  En->>Me: "May I know your name, please?"
  Cu->>Me: "Asha"
  Me->>Wh: event
  Wh->>En: resumeWithInput → validate → interactive list
  Note over En: invalid answer → error message and re-ask (max 3) → handoff
  En->>Db: Save lead (incomplete → qualified)
  En->>CRM: POST lead.submitted (event_id, HMAC); on failure QStash retry with backoff
  En->>Me: Confirmation
```

## Concurrency and idempotency

| Risk | Mechanism |
|---|---|
| Meta delivers the same webhook twice | `messages.wa_message_id` unique; the duplicate insert is a no-op |
| Two quick messages from one customer | Per-conversation lease lock (`acquire_conversation_lock`), plus processing pending messages in provider-timestamp order, plus a re-check after release |
| Two flows starting for one conversation | Partial unique index: one active execution per conversation |
| HTTP retry re-sends a reply | `messages.idempotency_key = execution:step:node` claimed before calling Meta |
| QStash delivers a job twice | `claim_scheduled_job` moves `scheduled → running` atomically; a second delivery skips |
| Customer replies during a delay | Recorded and marked `received_during_delay`; the flow doesn't advance until the job fires |
| Flow paused while jobs are pending | Jobs cancelled in the database and in QStash, executions parked as `paused`, and the status re-checked when the job runs |
| Usage budget exhausted | Non-essential waits continue immediately and CRM retries are deferred. Inbound messages are always recorded |
| Crashed function | Locks expire after 60 s, and the daily sweep replays stranded messages, late jobs and deferred CRM deliveries |

## Security model

- **Authentication**: login with an email or login ID, rate-limited per IP and per account. A TOTP QR code is shown once at enrollment; every later sign-in asks only for the 6-digit code. Attempts are rate-limited.
- **Authorisation**: `requireAdmin()` in every server action and route handler, and `requirePageSession()` in every page, both require an **aal2** session, an active profile and the right role (owner, admin or staff).
  **RLS**: every table has RLS with a *restrictive* `aal2` policy plus role helpers. Server-only RPCs are revoked from `anon` and `authenticated`. CRM secret columns can't be selected by the browser.
- **Secrets**: CRM credentials are encrypted with AES-256-GCM (`APP_ENCRYPTION_KEY`). The WhatsApp token is stored only as a server environment variable. Logs scrub keys that look like secrets.
- **Webhooks**: Meta requests are checked with HMAC-SHA256 over the raw body, compared in constant time. QStash requests are checked with JWT signatures (current and next key). The cron endpoint requires a bearer secret.
- **Outbound CRM**: HTTPS only in production. Private, loopback, link-local and metadata IPs are rejected, both at DNS lookup and again when the connection opens (which defeats DNS rebinding). Redirects aren't followed, requests time out after 10 s, and responses are size-capped.
- **Privacy**: `robots.txt` disallows everything, every page carries `noindex, nofollow` and `X-Robots-Tag`, frames are denied, and the referrer is withheld. Media storage is private, previews use 60-second signed URLs, and there are no AI or analytics services. Configurable retention redacts message text and deletes old logs.

## Usage estimator

`lib/estimator/analyze.ts` turns the flow graph into a DAG, dropping loop edges. It then walks it in two directions:

- **Typical case (forward pass)**: probability mass spreads through the graph. Condition branches split 50/50, each question loses `completionRate^(1/questions)` of customers, and validation retries are expected values based on the configured invalid-answer rate.
- **Worst case (backward pass)**: for each resource, the most expensive branch is followed, with every QStash retry and every CRM retry counted.

Only **Wait** steps (and CRM retries in the worst case) count as QStash deliveries. Immediate steps cost nothing. Each quota is compared over its own period (QStash per day, Redis per month, storage in total). Other active flows' published snapshots are subtracted from the shared allowance. Warning bands: <70% normal, 70–84 info, 85–94 high, 95–99 critical, ≥100 exceeded.

## Entity-relationship diagram

```mermaid
erDiagram
  profiles ||--o{ audit_logs : "acts"
  profiles ||--o{ leads : "assigned"
  whatsapp_accounts ||--o{ conversations : "receives"
  contacts ||--o{ conversations : "has"
  contacts ||--o{ messages : "sends/receives"
  conversations ||--o{ messages : "contains"
  conversations ||--o{ flow_executions : "runs"
  conversations ||--o{ leads : "produces"
  flows ||--o{ flow_versions : "publishes (immutable)"
  flows ||--o| flow_versions : "live version"
  flow_versions ||--o{ flow_executions : "pinned by"
  flow_executions ||--o{ node_executions : "logs"
  flow_executions ||--o{ scheduled_jobs : "delays"
  flow_executions ||--o| leads : "captures"
  media_assets ||--o{ messages : "attached"
  leads ||--o{ crm_deliveries : "delivered as"
  crm_integrations ||--o{ crm_deliveries : "targets"
  crm_deliveries ||--o{ scheduled_jobs : "retried by"
  flows ||--o{ usage_records : "consumes"
  contacts ||--o{ rate_limit_events : "throttled"

  profiles { uuid id PK "auth.users" text role "owner|admin|staff" text status "invited|active|disabled" text login_id }
  contacts { uuid id PK text wa_id UK bool opted_out timestamptz cooldown_until bool is_test }
  conversations { uuid id PK uuid contact_id FK uuid account_id FK text status "open|handoff|closed" timestamptz last_inbound_at uuid lock_token }
  messages { uuid id PK text wa_message_id UK text idempotency_key UK text direction text status text processing_status bool pricing_billable }
  flows { uuid id PK text status "draft|testing|active|paused|archived" jsonb draft_definition uuid published_version_id FK jsonb estimate_snapshot }
  flow_versions { uuid id PK uuid flow_id FK int version jsonb definition jsonb estimate_report }
  flow_executions { uuid id PK uuid flow_version_id FK text status int step jsonb context jsonb awaiting }
  node_executions { bigint id PK uuid execution_id FK text node_id text status jsonb detail }
  scheduled_jobs { uuid id PK text kind text status text idempotency_key UK text qstash_message_id }
  leads { uuid id PK uuid flow_execution_id UK text status text crm_sync_status text service }
  crm_integrations { uuid id PK text url text auth_type text credentials_encrypted jsonb field_mapping }
  crm_deliveries { uuid id PK text event_id "unique per integration" text status int attempts }
  media_assets { uuid id PK text storage_path UK text status text meta_media_id }
  usage_records { bigint id PK text service text metric date period_start text source numeric quantity }
  plan_limits { uuid id PK text service text metric text period numeric limit_value numeric unit_price date effective_from }
  whatsapp_accounts { uuid id PK text waba_id text phone_number_id UK bool enabled }
  rate_limit_events { bigint id PK text scope text identifier "hashed" }
  audit_logs { bigint id PK text action jsonb detail }
  notifications { uuid id PK text kind text severity timestamptz read_at }
  app_settings { smallint id PK "singleton" jsonb settings }
```
