# Star Growth Hub — WhatsApp Automation Platform

Private WhatsApp lead-capture and automation platform built on the **official Meta WhatsApp Cloud API**.
Customers always message first; the bot only replies inside Meta's 24-hour customer-service window.

- **Workflows**: keep as many as you like, one is live (plus one for test numbers). Build them in the visual
  editor, or with ChatGPT: copy the generated prompt, describe the workflow, paste the JSON back.
- **20 step types**: messages (with link buttons), media, location, templates, questions with answer types
  (number, email, phone, date, link, photo/file, location), single and multiple choice, booking with reminders,
  WhatsApp Forms, conditions (incl. business hours), API requests, tags, team alerts, handoff.
- **Same number in the WhatsApp Business app** (coexistence): replying from the phone pauses the bot in that
  chat; hand it back from the dashboard or Telegram buttons. Chat history and contact names are imported.
- **Fast replies**: "typing…" within about a second, short waits inside the reply, one database round trip
  to start each turn. A **Usage** page shows what was actually used.
- **Leads and CRM**: partial answers are kept as incomplete enquiries, CSV export, and signed CRM webhooks with
  stable event IDs, retries and SSRF protection.
- **Security**: admin-only accounts, mandatory TOTP MFA (aal2) for every page, action and row (RLS),
  rate limits (Upstash Redis), an audit log, `noindex` everywhere, and private media.
- **Reliability**: idempotent webhooks and jobs, per-conversation locks, durable recording before
  acknowledgement, and a daily recovery sweep.

## Stack

Next.js 16 (App Router, TypeScript) · Tailwind CSS 4 + shadcn/ui · @xyflow/react · Supabase (Postgres, Auth + TOTP,
Storage) · Upstash QStash · Upstash Redis + @upstash/ratelimit · Zod · Vercel.

## Quick start

```bash
pnpm install
cp .env.example .env            # fill in every value (see docs/SETUP.md)
pnpm db:migrate                 # apply supabase/migrations to your project
pnpm bootstrap:owner            # create the first owner (login ID or email)
pnpm db:seed                    # optional: register a Cloud-API-only number from .env
pnpm dev                        # http://localhost:3000
```

Sign in, then scan the QR code with an authenticator app. This happens once; later sign-ins only ask for the 6-digit code.

## Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm verify` | typecheck + lint + tests + production build |
| `pnpm test` | Vitest: acceptance, engine, security and DB/RLS tests (PGlite) |
| `pnpm db:migrate [--status]` | Apply SQL migrations (direct DB URL or Supabase Management API) |
| `pnpm db:seed` | Register the WhatsApp number from `.env` (`META_WABA_ID` / `META_PHONE_NUMBER_ID`) |
| `pnpm bootstrap:owner [--reset-password]` | Create the first owner account |
| `pnpm mfa:reset <login>` | Break-glass MFA reset (service key required, audited) |

## Documentation

- [docs/SETUP.md](docs/SETUP.md): Supabase, Meta, Upstash and Vercel setup, local development, live testing
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): architecture, message flow, ER diagram, design decisions
- [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md): how each of the 24 acceptance criteria is verified
- [docs/COEXISTENCE.md](docs/COEXISTENCE.md): connecting a WhatsApp Business app number (same number in the app and the bot)

## Project layout

```
app/(auth)          login, MFA enroll/verify, invite + password pages
app/(dashboard)     overview, workflows + editor, leads, conversations, bookings, media, crm, usage, logs, whatsapp, settings
app/api             webhooks/whatsapp, webhooks/telegram, jobs/qstash, cron/sweep, leads/export, media, inbound-media
lib/engine          flow schema, registry, runner, validation, templating (pure TS, shared with the browser)
lib/core            webhook ingest, conversation processing, chat control, jobs, Telegram updates, in-memory store
lib/flows           ChatGPT prompt, JSON import/export, step docs
lib/server          Supabase store, pipeline wiring, sweep, metrics
lib/whatsapp        Cloud API client, payloads, signature verification
lib/crm             dispatcher, HMAC signing, SSRF guard
supabase/migrations schema, functions, RLS, storage + seed data
tests               acceptance, unit and DB tests
```
