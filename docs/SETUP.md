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
8. **Seed (optional)**: `pnpm db:seed` registers a Cloud-API-only number from `META_PHONE_NUMBER_ID` and `META_WABA_ID`. For a number on the WhatsApp Business app, skip it and use **WhatsApp Accounts → Connect WhatsApp Business app number** instead ([COEXISTENCE.md](COEXISTENCE.md)). Workflows are created in **Workflows** (empty, or imported from ChatGPT JSON).

Storage: the migrations create a **private** `media` bucket (50 MB per file, PDF/JPG/PNG/MP4/3GP only). Files are never public. The server uploads them to Meta's media endpoint when it sends them.

## 4. Meta WhatsApp Cloud API

1. Go to developers.facebook.com → your app → **WhatsApp → API Setup** and copy the **Phone number ID** and the **WhatsApp Business Account ID**.
2. **Permanent token**: in Business Settings → Users → System users, create a system user. Assign it the app and the WhatsApp account, then generate a token with `whatsapp_business_messaging` and `whatsapp_business_management`. Put it in `META_ACCESS_TOKEN`.
3. **App secret**: App settings → Basic → App secret goes in `META_APP_SECRET`. Every webhook is verified with HMAC-SHA256 against it.
4. **Webhook**: in WhatsApp → Configuration, set:
   - Callback URL: `https://<your-app>/api/webhooks/whatsapp`
   - Verify token: the value of `META_WEBHOOK_VERIFY_TOKEN`
   - Subscribe to the **messages** field (incoming messages and delivery statuses). For a WhatsApp Business app number also subscribe **smb_message_echoes**, **history** and **smb_app_state_sync**.
5. In the app, open **WhatsApp Accounts → Test connection**. It confirms the token and phone number ID and shows the quality rating.
6. **Usage**: the **Usage** page shows messages, billable messages (as reported by Meta), QStash, Redis, database and storage use.

Workflows start only when a customer messages first. Free-form replies are blocked once 24 hours have passed since the customer's last message (minus a safety margin). After that only approved **templates** can be sent: the *Send template* step and booking reminders use them.

## 5. Upstash

- **QStash** (console → QStash): copy the endpoint URL, `QSTASH_TOKEN`, and both signing keys.
  Delayed flow steps are published to `{NEXT_PUBLIC_APP_URL}/api/jobs/qstash`, so the URL must be publicly reachable.
  Each job ID doubles as its QStash deduplication ID.
- **Redis** (console → Redis → REST API): copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. These power the per-customer, login, MFA and admin rate limits.
- **Optional**: set `UPSTASH_MANAGEMENT_EMAIL`, `UPSTASH_MANAGEMENT_API_KEY` and `UPSTASH_REDIS_DATABASE_ID`. The daily sweep then stores Redis command counts reported by Upstash. Without them, Redis usage is shown as an estimate.

## 6. Vercel

1. Link the project with `npx vercel link`. Then add every variable from `.env` under Project → Settings → Environment Variables, or with `npx vercel env add`.
2. Deploy with `npx vercel --prod`. `vercel.json` registers the daily cron (`/api/cron/sweep`, 03:30 UTC). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.
3. **Plan**: Hobby is for personal, non-commercial use, and its cron jobs run at most once a day. For commercial production, use **Pro**.
4. **Keep it warm (faster first reply)**: a function that has been idle starts cold and the first reply takes a few seconds longer. Add a free monitor (e.g. cron-job.org or UptimeRobot) that requests `https://<your-app>/api/webhooks/whatsapp` every 5 minutes. That request is answered with 403 straight away and only keeps the function warm.

## 7. Local development

```bash
pnpm dev
```

Meta and QStash need a public HTTPS URL to reach your machine. For local testing, use a tunnel such as `cloudflared tunnel --url http://localhost:3000` and set `NEXT_PUBLIC_APP_URL` to the tunnel URL. You can also use a Vercel preview deployment. The QStash signature check uses the exact URL in `NEXT_PUBLIC_APP_URL`.

You don't need any of this to try workflows: the **Test** tab in the workflow editor runs the real engine in your browser.

## 8. Live end-to-end test

1. In Settings → General → Live testing, add your phone number, e.g. `919876543210`.
2. Publish a workflow for **Test numbers only**, or use the live one.
3. From that phone, send "Hi" to your business number. You should then see:
   - "typing…" within about a second, then the first messages
   - short waits (up to 20 s) happen inside the reply; longer ones are scheduled through QStash
   - wrong answers re-asked, and the lead in **Leads**, marked as a test
4. **Conversations** shows the full thread and **Execution Logs** shows every step.

## 9. Operations

- **Daily sweep**: replays stranded messages and late jobs, retries deferred CRM deliveries, marks abandoned enquiries, applies retention, and refreshes media uploaded to Meta (Meta keeps them 30 days).
- **Telegram buttons**: Settings → Telegram alerts → *Action buttons on alerts* sets the bot's webhook to `/api/webhooks/telegram` (must be the deployed https site). Use a bot only for this app.
- **Lost authenticator**: another owner or admin resets it in Settings → Users, confirming with their own code. If no one else can, run `pnpm mfa:reset <login>`. Every reset is audited.
- **Rotating `APP_ENCRYPTION_KEY`**: re-enter your CRM credentials afterwards, because stored secrets can't be decrypted with the new key.

## Troubleshooting

| Symptom | Check |
|---|---|
| Webhook verify fails | `META_WEBHOOK_VERIFY_TOKEN` matches the Meta dashboard value; the URL ends in `/api/webhooks/whatsapp` |
| Events return 401 | `META_APP_SECRET` is the secret of the same Meta app that sends the webhooks |
| Messages recorded but no replies | Look in Execution Logs. A missing `META_ACCESS_TOKEN`, or error 131047 (24h window closed), shows there |
| Delayed steps never arrive | The QStash dashboard logs; `NEXT_PUBLIC_APP_URL` must be the public URL; signing keys must be current |
| Events "ignored" | The number must be registered and enabled in WhatsApp Accounts, with the WABA ID the webhook comes from |
| Phone-app replies don't pause the bot | Subscribe **smb_message_echoes** in Meta → WhatsApp → Configuration; Settings → "When I reply from the phone app" = Pause |
