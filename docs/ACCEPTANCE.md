# Acceptance criteria → verification

`pnpm test` runs the automated checks: 86 tests across 8 files. The tests drive the real engine and pipeline with signed Meta payloads, in-memory adapters and a simulated clock. Migrations and RLS are tested against an in-process Postgres (PGlite) using the real SQL files.

| # | Criterion | Automated test | Manual check (live) |
|---|---|---|---|
| 1 | New admin sees MFA QR enrollment once | `tests/unit/auth-steps.test.ts` → "1. …" | First sign-in shows the QR code |
| 2 | Returning admin sees only the code prompt | `auth-steps.test.ts` → "2. …" | Second sign-in shows only the 6-digit input |
| 3 | No dashboard data without verified MFA | `auth-steps.test.ts` → "3. …"; `tests/db/migrations.test.ts` → "aal1 see nothing" | |
| 4 | Bot never initiates a conversation | `tests/acceptance/whatsapp-flow.test.ts` → "4. …" | |
| 5 | "Hi" → welcome + brochure | `whatsapp-flow.test.ts` → "5. …"; `routes.test.ts` (signed HTTP) | Send "Hi" from a test number |
| 6 | Next question ≈5 s later through QStash | `whatsapp-flow.test.ts` → "6. …" | QStash dashboard shows a 5 s delayed message |
| 7 | Valid name accepted | "7. …" and "7b. …" | |
| 8 | Invalid service number retries without advancing | "8. …" and "8b. …" (handoff after 3) | |
| 9 | Valid selection continues | "9. …" (number, tap, title) | |
| 10 | Duplicate webhooks never duplicate messages | "10. …" and "10b. …" (QStash duplicates); DB test "deduplicates" | |
| 11 | Existing conversation resumes appropriately | "11. …", "11b. …" (returning customer), "11c. …" (brochure cooldown) | |
| 12 | Expired 24h window blocks free-form sends | "12. …", "12b. …" (Meta 131047) | |
| 13 | Leads stored | "13 & 14. …" | Leads page |
| 14 | CRM receives the correct data | "13 & 14. …"; `tests/unit/crm.test.ts` (mapping, headers, HMAC) | CRM Integrations → Test connection |
| 15 | Failed CRM deliveries retried safely | "15. …" (stable event id, QStash retry) | |
| 16 | Editor can save, test and publish | Server actions + simulator use the same engine (all engine tests) | Flow Builder: Save draft → Test tab → Publish |
| 17 | Draft changes don't corrupt running flows | "17. …"; DB test "published versions are immutable" | |
| 18 | Estimator recalculates on node/volume changes | `tests/unit/estimator.test.ts` → "recalculates when …" | Usage tab updates live |
| 19 | Projected overage shows a clear warning | `estimator.test.ts` → "warns clearly …" | Publish dialog |
| 20 | Provider usage distinguished from estimates | `usage_records.source` (`provider` / `local_measured` / `estimate`), `SourceBadge` on every figure; estimator report `meta.rateSource` test | Usage & Limits badges |
| 21 | Paused workflows stop safely | "21. …" | Pause in builder → pending jobs cancelled |
| 22 | Unauthorized requests can't access leads or flows | `privacy.test.ts` (proxy 401), `routes.test.ts` (401s), DB RLS tests | `curl /api/leads/export` → 401 |
| 23 | Media private but usable for sending | `privacy.test.ts` → "23. …"; `whatsapp.test.ts` (media must be uploaded to Meta first) | Media preview needs sign-in |
| 24 | No crawler or anonymous visitor can read data | `privacy.test.ts` → "24. …" | `curl -I` shows `X-Robots-Tag` |

Live smoke test performed during the build against the project's Supabase: a signed webhook was recorded, a duplicate was ignored, and the published default flow started. The reply failed only because `META_ACCESS_TOKEN` was not set yet; that was logged and the admin was notified. The test rows were deleted afterwards.
