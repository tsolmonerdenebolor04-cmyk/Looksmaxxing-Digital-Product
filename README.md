# GLOWUP AI — secure report paywall

Three photos and the Mongolian questionnaire produce a Gemini report. Existing model selection, transient retries, fallback model, report validation/repair, Mongolian report sections, and light/dark design are preserved.

## Access flow

- POST /api/analyze validates input, generates and validates the report, then stores the full JSON and an explicit preview in Supabase. It returns only {reportId, preview}. Storage failure never falls back to returning the report.
- The preview contains headline, scores, score note, one observation and one roast punchline. Summary, recommendations, barber card and the plan stay server-side.
- A random 256-bit token is issued in a seven-day HttpOnly, SameSite=Strict cookie scoped to /api (Secure on Vercel/production). Only its SHA-256 hash is stored. The UUID alone does not authorize access. The cookie is a bearer credential; keep it private.
- GET /api/report?id=<UUID> verifies the cookie hash, report status and seven-day expiry, then queries a QPay payment for the same report with status paid, exact 6,900 MNT, an invoice ID and verified_at. The report must also be paid. Only then is the full report selected. Missing/invalid ownership or expiry returns 404; unpaid returns 402; storage errors fail closed.
- Responses are not cached. The browser constructs full-report sections only after successful authorized retrieval. The demo unlock is removed.
- POST /api/payment accepts only an owned report. It currently returns 503 explaining that QPay is unavailable; it creates no invoice and writes no payment status. Browser success flags are ignored.

The reports/payments/events tables already exist in project mteslmtbntnxbqzthjbj. Read-only inspection found RLS enabled and no policies on these tables. No production rows, schema, secrets or deployment settings were changed. No migration is necessary for this implementation. Events are not written.

## Required server environment

| Variable | Purpose |
| --- | --- |
| GEMINI_API_KEY | Required Google Gemini API key |
| SUPABASE_URL | Required HTTPS project origin, without trailing slash |
| SUPABASE_SECRET_KEY | Required server secret (sb_secret_ recommended) or legacy service_role JWT |
| GEMINI_MODEL | Optional; defaults to gemini-3.1-flash-lite |
| GEMINI_FALLBACK_MODEL | Optional fallback model |
| PORT | Optional local port, default 3000 |

The production project's origin is https://mteslmtbntnxbqzthjbj.supabase.co. Use a **separate staging project** for local/preview testing and provision the matching existing schema there. Do not point development writes at production. Do not prefix secrets with NEXT_PUBLIC_, VITE_, or other browser-export prefixes. Never paste keys into source files or the browser. The app uses native server-side fetch for the Supabase Data API; there are no additional packages.

## Local setup and tests

Use Node 22 or later. Copy .env.example to .env, fill in staging credentials locally, and start with:

    node --env-file=.env dev-server.mjs

Alternatively set the environment variables in your shell, then run npm run dev. The server does not automatically load .env. Open http://localhost:3000.

    npm test
    npm run build

Tests use mocked Gemini and Supabase HTTP responses, including full analysis-to-storage, preview isolation, ownership, wrong tokens, payment verification, expiry, unavailable services and HTTP/static routing. Paid rows exist only in test fixtures. No live Gemini requests or production database writes are performed by tests.

The report ID is held in the current page's memory and the cookie remains in the same browser. Reload recovery, account-based access and cross-device delivery are not implemented; do not collect payments until a recovery/delivery workflow is agreed.

## Deployment instructions (review/preview only)

1. Review this feature branch and run the tests and build.
2. Configure a separate Vercel preview project with Framework Preset Other and this repository root. Keep its Git integration away from production promotion. Configure only staging credentials in its Preview environment.
3. vercel.json runs node build.mjs and publishes public/, containing only index.html and app.js. API functions remain under api/. Never publish the repository root as static output. The build rejects unexpected files in public/.
4. Use a supported Node runtime (22+), HTTPS, private preview access and the existing 60-second analysis function timeout. Check function request-body/platform limits with three compressed photos.
5. Verify preview responses in browser Network tools: no full report, no secrets, an HttpOnly Secure cookie, 402 before payment and 404 without the cookie. Verify /lib/store.mjs, /.env and /tests/fixtures.mjs are inaccessible.
6. In staging only, seed a reviewed paid test fixture tied to a report and verify authorized retrieval, expiry and refund denial. Do not manually mark production reports paid.
7. Production release, database changes, environment changes and promotion require a separate reviewed release. This PR does not deploy or merge.

Preserve RLS and deny browser roles access to reports, payments and events. Never add a public read policy for previews: the server returns those. Verify grants, policies, views and RPCs on the staging copy using [Supabase API security guidance](https://supabase.com/docs/guides/api/securing-your-api). Server secrets bypass RLS, so authorization in these handlers is mandatory; see [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

## QPay integration boundary

lib/qpay.mjs defines createInvoice and verifyInvoice contracts; both throw until a real adapter is implemented. There is no callback route, fake confirmation, test unlock or payment status writer. No QPay environment variables are read yet.

Before enabling checkout, implement against the merchant's official QPay contract with staging credentials. Add server-only QPAY_BASE_URL, QPAY_USERNAME, QPAY_PASSWORD, QPAY_INVOICE_CODE and a canonical callback origin only when that adapter actually consumes them. Never let request data select provider URLs or merchant details.

A callback is a prompt to query QPay, never proof of payment. Verify the stored invoice-to-report binding, merchant account, final settlement, currency MNT, exact amount and unique provider payment ID. Add transactional/idempotent persistence of payments.status/verified_at and reports.status/paid_at, authenticated callback handling, concurrent invoice/replay tests, and refund revocation. Do not add a public endpoint that marks a report paid. Until this work passes review, checkout stays unavailable.

## Remaining launch considerations

The existing in-memory analysis rate limit is per instance; shared rate limiting, quotas and spend controls are still needed before public traffic. Photos are sent to Gemini but not persisted by this app; reports contain personal observations, so publish retention/deletion and privacy policies. Seven-day expiry denies access but does not delete stored data. AI schema checks do not establish observation accuracy; validate real consented adult outputs in staging before charging. The scores remain subjective presentation heuristics.

Live provider/database write integration and hosted browser verification have not been run as part of this change. Use staging for those checks, never the production project.
