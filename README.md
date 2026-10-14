# Star Growth Hub — WhatsApp Automation Platform

Private WhatsApp lead-capture and automation platform built on the **official Meta WhatsApp Cloud API**.
Customers always message first; the bot only replies inside Meta's 24-hour customer-service window.

- **Visual flow builder** (React Flow): 12 node types, drag-and-drop, undo/redo, copy/paste, auto-layout,
  validation, version history with rollback, and an in-browser simulator that never sends real messages.
- **Usage estimator**: typical and worst-case WhatsApp, QStash, Redis, database and storage usage against
  editable free-tier allowances. A server-checked usage report is shown before every publish.
- **Leads and CRM**: partial answers are kept as incomplete enquiries, CSV export, and signed CRM webhooks with
  stable event IDs, retries and SSRF protection.
- **Security**: admin-only accounts, mandatory TOTP MFA (aal2) for every page, action and row (RLS),
  rate limits (Upstash Redis), an audit log, `noindex` everywhere, and private media.
- **Reliability**: idempotent webhooks and jobs, per-conversation locks, durable recording before
  acknowledgement, a daily recovery sweep, and a hard usage cap that never drops leads.

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 + shadcn/ui · @xyflow/react · Supabase (Postgres, Auth + TOTP,
Storage) · Upstash QStash · Upstash Redis + @upstash/ratelimit · Zod · Vercel.

## Quick start

```bash
pnpm install
cp .env.example .env            # fill in every value (see docs/SETUP.md)
pnpm db:migrate                 # apply supabase/migrations to your project
pnpm bootstrap:owner            # create the first owner (login ID or email)
pnpm db:seed                    # register your WhatsApp number + publish the default flow
pnpm dev                        # http://localhost:3000
```

Sign in, then scan the QR code with an authenticator app. This happens once; later sign-ins only ask for the 6-digit code.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm verify` | typecheck + lint + tests + production build |
| `pnpm test` | Vitest: acceptance, engine, estimator, security and DB/RLS tests (PGlite) |
| `pnpm db:migrate [--status]` | Apply SQL migrations (direct DB URL or Supabase Management API) |
| `pnpm db:seed` | Register the WhatsApp number from `.env` and publish the default flow if none exists |
| `pnpm bootstrap:owner [--reset-password]` | Create the first owner account |
| `pnpm mfa:reset <login>` | Break-glass MFA reset (service key required, audited) |

## Documentation

- [docs/SETUP.md](docs/SETUP.md): Supabase, Meta, Upstash and Vercel setup, local development, live testing
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): architecture, message flow, ER diagram, design decisions
- [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md): how each of the 24 acceptance criteria is verified

## Project layout

```
app/(auth)          login, MFA enroll/verify, invite + password pages
app/(dashboard)     overview, flows + builder, leads, conversations, media, crm, usage, logs, whatsapp, settings
app/api             webhooks/whatsapp, jobs/qstash, cron/sweep, leads/export, media/[id]/preview
lib/engine          flow schema, registry, runner, validation, templating (pure TS, shared with the browser)
lib/core            webhook ingest, conversation processing, job handling, in-memory store (simulator/tests)
lib/estimator       graph analysis + usage forecasting
lib/server          Supabase store, pipeline wiring, sweep, metrics
lib/whatsapp        Cloud API client, payloads, signature verification
lib/crm             dispatcher, HMAC signing, SSRF guard
supabase/migrations schema, functions, RLS, storage + seed data
tests               acceptance, unit and DB tests
```
