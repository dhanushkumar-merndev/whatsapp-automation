# Setup guide

Follow these sections in order. Every secret goes in `.env` (local) or Vercel environment variables. None go in source code.

## 1. Prerequisites

- Node.js 20+ and pnpm 10+
- A Supabase project, a Meta developer app with the WhatsApp product, an Upstash account (QStash and Redis), and a Vercel account
- Optional: the Supabase CLI (`npx supabase`) and the Vercel CLI (`npx vercel`)

## 2. Environment variables

Copy `.env.example` to `.env`. Each variable is documented in that file. Generate the random values with:

```bash
openssl rand -base64 32   # APP_ENCRYPTION_KEY
openssl rand -hex 32      # CRON_SECRET
openssl rand -hex 24      # META_WEBHOOK_VERIFY_TOKEN
```

The app checks the variables when it starts and reports any missing variable by name. `META_ACCESS_TOKEN` is the only one that may be empty at first: incoming messages are still recorded, and sending fails with a clear error until you add it.

## 3. Supabase

1. **Keys**: Project Settings → API. Copy the Project URL, the *publishable* key and the *secret* key into
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`.
2. **Migrations**: run `pnpm db:migrate`. The command uses `SUPABASE_DB_URL` (Connect → Session pooler URI). If that is empty, it falls back to the Supabase Management API with your `npx supabase login` token. Each migration runs once, inside a transaction, and is tracked in `sgh_private.schema_migrations`.
3. **Disable public sign-ups**: Authentication → Sign In / Providers → Email → turn **off** "Allow new users to sign up". This step has to be done in the dashboard. Even if you skip it, self-registered users still see nothing, because the app requires a profile row and MFA, and RLS does the same.
4. **MFA**: Authentication → Multi-Factor → make sure **TOTP** is enabled (it is by default).
5. **URL configuration**: Authentication → URL Configuration → set the Site URL to your app URL and add `https://<your-app>/auth/confirm` to the Redirect URLs.
6. **Invite email** (only if you invite users by email): Authentication → Emails → Invite user. Point the link at
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite`
7. **First owner**: set `BOOTSTRAP_OWNER_LOGIN` (an email or a login ID such as `Gayathri@2026`) and `BOOTSTRAP_OWNER_PASSWORD`, then run `pnpm bootstrap:owner`. Remove `BOOTSTRAP_OWNER_PASSWORD` from `.env` afterwards.
8. **Seed**: run `pnpm db:seed`. It registers `META_PHONE_NUMBER_ID` and `META_WABA_ID`, then creates and publishes the default *Star Growth Hub — Enquiry* flow.

Storage: the migrations create a **private** `media` bucket (50 MB per file, PDF/JPG/PNG/MP4/3GP only). Files are never public. The server uploads them to Meta's media endpoint when it sends them.

## 4. Meta WhatsApp Cloud API

1. Go to developers.facebook.com → your app → **WhatsApp → API Setup** and copy the **Phone number ID** and the **WhatsApp Business Account ID**.
2. **Permanent token**: in Business Settings → Users → System users, create a system user. Assign it the app and the WhatsApp account, then generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`. Put it in `META_ACCESS_TOKEN`.
3. **App secret**: App settings → Basic → App secret goes in `META_APP_SECRET`. Every webhook is verified with HMAC-SHA256 against it.
4. **Webhook**: in WhatsApp → Configuration, set:
   - Callback URL: `https://<your-app>/api/webhooks/whatsapp`
   - Verify token: the value of `META_WEBHOOK_VERIFY_TOKEN`
   - Subscribe to the **messages** field. This one subscription delivers both incoming messages and delivery-status updates.
5. In the app, open **WhatsApp Accounts → Test connection**. It confirms the token and phone number ID and shows the quality rating.
6. **Pricing**: open **Usage & Limits** and check the Meta rate card. The seed assumes free-form service replies cost 0. That figure is manually configured, so confirm it for your account and country.

The bot only replies to customers who message first. It never sends templates or campaigns. Replies are blocked once 24 hours have passed since the customer's last message, minus a configurable safety margin.

## 5. Upstash

- **QStash** (console → QStash): copy the endpoint URL, `QSTASH_TOKEN`, and both signing keys.
  Delayed flow steps are published to `{NEXT_PUBLIC_APP_URL}/api/jobs/qstash`, so the URL must be publicly reachable.
  Each job ID doubles as its QStash deduplication ID.
- **Redis** (console → Redis → REST API): copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. These power the per-customer, login, MFA and admin rate limits.
- **Optional**: set `UPSTASH_MANAGEMENT_EMAIL`, `UPSTASH_MANAGEMENT_API_KEY` and `UPSTASH_REDIS_DATABASE_ID`. The daily sweep then stores Redis command counts reported by Upstash. Without them, Redis usage is shown as an estimate.

## 6. Vercel

1. Link the project with `npx vercel link`. Then add every variable from `.env` under Project → Settings → Environment Variables, or with `npx vercel env add`.
2. Deploy with `npx vercel --prod`. `vercel.json` registers the daily cron (`/api/cron/sweep`, 03:30 UTC). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.
3. **Plan**: Hobby is for personal, non-commercial use, and its cron jobs run at most once a day. For commercial production, use **Pro**. Set the plan under Settings → General → Hosting and the app will warn when the two don't match.

## 7. Local development

```bash
pnpm dev
```

Meta and QStash need a public HTTPS URL to reach your machine. For local testing, use a tunnel such as `cloudflared tunnel --url http://localhost:3000` and set `NEXT_PUBLIC_APP_URL` to the tunnel URL. You can also use a Vercel preview deployment. The QStash signature check uses the exact URL in `NEXT_PUBLIC_APP_URL`.

You don't need any of this to try flows: the **Test** tab in the Flow Builder runs the real engine in your browser.

## 8. Live end-to-end test

1. In Settings → General → Live testing, add your phone number, e.g. `919876543210`.
2. Publish a flow in **Test numbers only** mode, or use the active default flow.
3. From that phone, send "Hi" to your business number. You should then see:
   - the welcome message and brochure arrive straight away (upload the PDF in **Media Library** first and select it in the flow's "Company brochure" step)
   - the name question about 5 seconds later, sent through QStash
   - invalid service numbers re-asked, and a handoff offered after three attempts
   - the lead appear in **Leads**, marked as a test, with the CRM delivery shown in **CRM Integrations**
4. **Conversations** shows the full thread and **Execution Logs** shows every step.

## 9. Operations

- **Daily sweep**: replays stranded messages and late jobs, retries deferred CRM deliveries, marks abandoned enquiries, applies retention, and takes storage/usage snapshots.
- **Lost authenticator**: another owner or admin resets it in Settings → Users, confirming with their own code. If no one else can, run `pnpm mfa:reset <login>`. Every reset is audited.
- **Rotating `APP_ENCRYPTION_KEY`**: re-enter your CRM credentials afterwards, because stored secrets can't be decrypted with the new key.

## Troubleshooting

| Symptom | Check |
|---|---|
| Webhook verify fails | `META_WEBHOOK_VERIFY_TOKEN` matches the Meta dashboard value; the URL ends in `/api/webhooks/whatsapp` |
| Events return 401 | `META_APP_SECRET` is the secret of the same Meta app that sends the webhooks |
| Messages recorded but no replies | Look in Execution Logs. A missing `META_ACCESS_TOKEN`, or error 131047 (24h window closed), shows there |
| Delayed steps never arrive | The QStash dashboard logs; `NEXT_PUBLIC_APP_URL` must be the public URL; signing keys must be current |
| Events "ignored" | The number must be registered in WhatsApp Accounts with the same WABA ID as `META_WABA_ID` |
