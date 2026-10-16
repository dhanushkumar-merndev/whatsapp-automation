# Same number in the WhatsApp Business app and the bot (coexistence)

With coexistence you keep using the **WhatsApp Business app** on your phone, and the bot answers through the
**Cloud API** on the **same number**. Every message appears in both places.

## How it behaves

- A customer messages you → the bot answers (you see the whole chat in the phone app too).
- **You reply from the phone app** → that chat switches to **Human**: the bot stops there and Telegram (and the
  dashboard bell) shows "You're chatting with … — bot paused".
  Just *opening* or *reading* a chat does nothing; only *sending* a message counts.
- **Hand it back** with the buttons on that Telegram alert (🤖 Bot on · 🔁 Restart flow · ✖️ Close), or in the
  dashboard conversation page. Optional: Settings → *Hand back to the bot after N hours* does it automatically.
- Settings → *When I reply from the phone app* → *Keep the bot running* turns the pause off.

## Part A — one-time Meta setup (about 30 minutes, plus Meta's review time)

Meta only lets **Tech Providers** connect WhatsApp Business app numbers.

1. **Verify your business**: business.facebook.com → Settings → Security Center → *Start verification*.
2. **Become a Tech Provider**: developers.facebook.com → your app → WhatsApp → *Quickstart* → follow
   *Become a Tech Provider* (it asks for business verification and App Review of
   `whatsapp_business_messaging` and `whatsapp_business_management`). As an admin of the app you can usually
   connect your **own** business before App Review is finished.
3. **Add "Facebook Login for Business"** to the app (Add product).
   - *Settings*: turn on **Login with the JavaScript SDK**; add your site domain (e.g. `sgh-whatsapp.vercel.app`)
     under **Allowed domains**; add `https://<your-site>/whatsapp` under **Valid OAuth redirect URIs**.
   - *Configurations* → **Create configuration** → login variation **WhatsApp Embedded Signup** → product
     **WhatsApp** → access token expiration **Never** → permissions `whatsapp_business_management` and
     `whatsapp_business_messaging` → create, and copy the **Configuration ID**.
     A new configuration is Embedded Signup **v4** (v2 was retired on 15 Oct 2026). Don't use a template with a
     60-day token: the bot sends with this token and would stop when it expires.
4. **Webhook fields**: WhatsApp → Configuration → Webhook fields → subscribe **messages**,
   **smb_message_echoes**, **history** and **smb_app_state_sync**.
5. **Environment variables** (Vercel → Settings → Environment Variables), then redeploy:
   - `NEXT_PUBLIC_META_APP_ID` = App ID (App settings → Basic)
   - `NEXT_PUBLIC_META_CONFIG_ID` = the Configuration ID from step 3

## Part B — connect your number (10 minutes)

6. **Phone**: the number must be in the **WhatsApp Business app, version 2.24.17 or newer** (update it).
   A number that is currently *API-only* (it can't be opened in the app) must first be deleted from
   WhatsApp Manager → Phone numbers, then registered in the WhatsApp Business app. Its IDs change; the app handles that.
7. Dashboard → **WhatsApp Accounts** → **Connect WhatsApp Business app number** → **Start**.
8. Log in with Facebook → choose **Connect your existing WhatsApp Business app** → pick your business → a QR code
   appears → scan it with the WhatsApp Business app on your phone → **allow sharing chat history**.
9. Back on the page every step should be ✅. Old chats arrive over the next minutes (marked *earlier chat*;
   the bot never answers them). If *Contacts* or *History* failed, use the retry button — Meta allows it only
   within 24 hours.
10. If this replaced an older API-only number, **disable** the old one on the same page.

## Part C — settings (5 minutes)

11. In the **WhatsApp Business app**: Business tools → turn **off** *Greeting message* and *Away message*,
    otherwise customers get two replies.
12. Dashboard → **Settings** → *WhatsApp Business app on the same number*: keep **Pause the bot…**; optionally set
    *Hand back after* (e.g. 12 hours).
13. Settings → **Telegram alerts**: add your chat ID (send `/start` to the bot) → **Save** → turn on
    **Action buttons on alerts**.
14. **Test** from another phone: send "Hi" → you see "typing…" and the bot's reply. Reply from your phone app →
    Telegram shows "bot paused" with buttons → tap **🤖 Bot on** → message again → the bot answers.

## Good to know

- Open the WhatsApp Business app regularly (guides say at least once every **14 days**), or Meta may disconnect it.
- Sending speed on coexistence numbers is fixed at 20 messages per second.
- Not available through the API: groups, disappearing and view-once messages, live location; broadcast lists in
  the app are turned off.
- Messages you send from the phone app are free and do **not** open the 24-hour window for the bot; the
  customer's messages do.
