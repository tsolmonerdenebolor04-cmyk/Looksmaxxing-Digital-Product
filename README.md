# GLOWUP AI — secure report paywall

Three photos and the Mongolian questionnaire produce a Gemini report. Existing model selection, transient retries, fallback model, report validation/repair, Mongolian report sections, and light/dark design are preserved.

## Access flow

- POST /api/analyze validates input, generates and validates the report, then stores the full JSON and an explicit preview in Supabase. It returns only {reportId, preview}. Storage failure never falls back to returning the report.
- The explicit preview contains headline, scores and interpretation, the narrative summary, the first three photo-specific observations (photo/detail/confidence), ONE top priority (title/why/action), and at most one roast (joke/evidence/fix). Remaining priorities, haircuts/barber card, skincare/grooming, wardrobe, photo tips, budget and the 30-day plan stay server-side.
- A random 256-bit token is issued in a seven-day HttpOnly, SameSite=Strict cookie scoped to /api (Secure on Vercel/production). Only its SHA-256 hash is stored. The UUID alone does not authorize access. The cookie is a bearer credential; keep it private.
- GET /api/report?id=<UUID> verifies the cookie hash, report status and seven-day expiry, then checks the exact active Byl order and bound payment with paid status, 6,900 MNT, matching invoice/report/payment IDs and verified_at. Legacy QPay or unrelated paid Byl rows cannot substitute. The final read RPC repeats that check with ownership and expiry. The report must also be paid. Only then is the full report selected. Missing/invalid ownership or expiry returns 404; unpaid returns 402; storage errors fail closed.
- GET /api/recover?id=<UUID> authenticates the same cookie and expiry, returns only an allowlisted preview and a payment eligibility flag, and never selects the full report. A paid recovery then uses the separately authorized /api/report endpoint.
- Responses are not cached. The browser constructs full-report sections only after successful authorized retrieval. The demo unlock is removed.
- POST /api/payment implements owner-authorized Byl invoice creation through an injected adapter. Default runtime activation remains disabled (503). POST /api/payment-status independently verifies stored invoices; POST /api/byl-webhook authenticates raw-body signatures and verifies invoices server-side. See [Byl integration and test results](docs/byl-integration.md).

The reports/payments/events tables already exist in project mteslmtbntnxbqzthjbj. Read-only inspection found RLS enabled and no policies on these tables. No production rows, schema, secrets or deployment settings were changed. The Byl SQL in docs/sql/byl-payments.sql was validated on isolated local PostgreSQL/PostgREST and remains unapplied to remote projects. See [database tests and blockers](docs/byl-database-validation.md).

## Required server environment

| Variable | Purpose |
| --- | --- |
| GEMINI_API_KEY | Required Google Gemini API key |
| SUPABASE_URL | Required HTTPS project origin, without trailing slash |
| SUPABASE_SECRET_KEY | Required server secret (sb_secret_ recommended) or legacy service_role JWT |
| GEMINI_MODEL | Optional; defaults to gemini-3.1-flash-lite |
| GEMINI_FALLBACK_MODEL | Optional fallback model |
| PORT | Optional local port, default 3000 |

The production project's origin is https://mteslmtbntnxbqzthjbj.supabase.co. The separate staging project is glowup-ai-staging, hbhreogfcisufnajijqy (ap-northeast-2), at https://hbhreogfcisufnajijqy.supabase.co. Its matching schema is already provisioned. Use staging for local/preview testing. Do not point development writes at production. Do not prefix secrets with NEXT_PUBLIC_, VITE_, or other browser-export prefixes. Never paste keys into source files or the browser. The app uses native server-side fetch for the Supabase Data API; there are no additional runtime packages. The isolated database tests use a pinned dev-only PostgreSQL driver.

## Local setup and tests

Use Node 22 or later. Copy .env.example to .env, fill in staging credentials locally, and start with:

    node --env-file=.env dev-server.mjs

Alternatively set the environment variables in your shell, then run npm run dev. The server does not automatically load .env. Open http://localhost:3000.

    npm test
    npm run build

The default 44-test suite uses mocked Gemini and Supabase HTTP responses, including full analysis-to-storage, preview isolation, ownership, wrong tokens, payment verification, expiry, unavailable services and HTTP/static routing. Paid rows in this default suite exist only in mocked test fixtures. No live Gemini requests or production database writes are performed by tests.

A separate 23-test native PostgreSQL/PostgREST suite validates migration transactions, concurrency, revocation, RLS and real paid-report authorization. Run npm run test:db with local binary paths as documented in [database validation](docs/byl-database-validation.md). It creates a fresh loopback-only cluster and never uses hosted credentials.

The browser stores only the opaque report ID in localStorage (glowup-report-id), preserving it across refresh and reopening the same browser. The ID grants no access without the HttpOnly cookie. Creation and recovery share the same nested publicPreview() allowlist, including nested-field stripping. Older stored previews remain smaller; recovery never reads full reports to backfill them. Every recovery rechecks ownership and expiry server-side; paid access is rechecked by the full-report endpoint. Missing/invalid cookies and expired reports clear the saved ID. Transient service errors preserve it for retry. Restart forgets the saved ID. No report contents, access tokens or server credentials are stored in browser storage. Clearing cookies, changing browsers and cross-device recovery still require a future account/delivery design.

## Deployment instructions (review/preview only)

1. Review this feature branch and run the tests and build.
2. Configure a separate Vercel preview project with Framework Preset Other and this repository root. Keep its Git integration away from production promotion. Configure only staging credentials in its Preview environment.
3. vercel.json runs node build.mjs and publishes public/, containing only index.html and app.js. API functions remain under api/. Never publish the repository root as static output. The build rejects unexpected files in public/.
4. Use a supported Node runtime (22+), HTTPS, private preview access and the existing 60-second analysis function timeout. Check function request-body/platform limits with three compressed photos.
5. Verify preview responses in browser Network tools: no full report, no secrets, an HttpOnly Secure cookie, 402 before payment and 404 without the cookie. Verify /lib/store.mjs, /.env and /tests/fixtures.mjs are inaccessible.
6. In staging only, seed a reviewed paid test fixture tied to a report and verify authorized retrieval, expiry and refund denial. Do not manually mark production reports paid.
7. Production release, database changes, environment changes and promotion require a separate reviewed release. This PR does not deploy or merge.

Preserve RLS and deny browser roles access to reports, payments and events. Never add a public read policy for previews: the server returns those. Verify grants, policies, views and RPCs on the staging copy using [Supabase API security guidance](https://supabase.com/docs/guides/api/securing-your-api). Server secrets bypass RLS, so authorization in these handlers is mandatory; see [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

The analysis endpoint now performs zero-row Supabase schema/read preflight checks before calling Gemini. This avoids spend during known storage outages; it cannot guarantee a later insert or replace durable quota/abuse controls.

## Byl integration boundary

The latest [read-only staging compatibility review and migration/test plan](docs/byl-staging-migration-plan.md) identifies the actual global invoice constraint and prepares an unapplied correction. Approval is required before replaying or applying this candidate. Previous 23-test database results apply to commit 59652f2, not the revised 27-test fixture/candidate.

The Byl invoice, hosted checkout, server verification and idempotent webhook implementation is tested with mocked provider responses. All default runtime handlers remain disabled; no live transport or environment switch exists. See [Byl implementation, activation gate and verification](docs/byl-integration.md). lib/qpay.mjs remains an unused legacy contract stub.

## Remaining launch considerations

The existing in-memory analysis rate limit is per instance; shared rate limiting, quotas and spend controls are still needed before public traffic. Photos are sent to Gemini but not persisted by this app; reports contain personal observations, so publish retention/deletion and privacy policies. Seven-day expiry denies access but does not delete stored data. AI schema checks do not establish observation accuracy; validate real consented adult outputs in staging before charging. The scores remain subjective presentation heuristics.

See [staging verification](docs/staging-verification.md) for the opt-in real Supabase runner and exact test provenance. Hosted Vercel verification, real Gemini requests and real QPay settlement remain outstanding. Use staging for integration checks, never the production project.

## Progressive report presentation

The preview reads as the beginning of the personal report: narrative and scores, three photo observations, then one actionable priority and an optional roast with fix. A decorative blurred continuation leads into remaining-section labels and the 6,900₮ CTA. Blurred lines are static decoration, never paid JSON or private text hidden by CSS. Missing legacy content is omitted rather than invented. Checkout remains disabled until the Byl activation work is explicitly approved.

Local visual QA used representative synthetic Mongolian text at 320px and 390px mobile widths and desktop, in light/dark themes. This is layout validation, not a live AI-quality or conversion test.
