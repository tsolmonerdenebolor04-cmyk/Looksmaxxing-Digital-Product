# Byl integration: mocked implementation, activation disabled

Current status: [actual staging compatibility review and conditional migration plan](byl-staging-migration-plan.md) are ready. The revised migration/metadata-derived fixture have not been applied or replayed. Database results below describe the prior 59652f2 revision only; live activation remains disabled.

This change keeps the product price at **6,900 MNT**. The merchant's project being LIVE does not authorize requests. No Byl API calls, real invoices, payments, remote database writes, deployment changes or production changes were made for this work.

## Implemented flow

1. `POST /api/payment` requires the existing report owner cookie and an unexpired unpaid report. Browser-supplied price, project, URL and payment flags are ignored. An atomic server-side reservation permits one creation attempt per report. Concurrent/repeated requests reuse the bound hosted URL; requests racing an unfinished reservation return 409.
2. `lib/byl.mjs` creates the official invoice request shape with amount 6900 and a server-generated report reference in `description` and `client_reference_id`. Invoice creation has **no automatic retry**: a timeout or invalid response leaves the reservation in `creating` for operator reconciliation. Do not delete that reservation or retry creation without establishing whether Byl already created an invoice. No undocumented provider idempotency guarantee is assumed.
3. The adapter validates the returned invoice/project/reference/amount/status and permits only `https://byl.mn/h/invoice/<matching ID>/<secret>`. The browser repeats the URL allowlist before navigating. Hosted URLs are bearer links and are returned only to the authenticated owner; they are not stored in browser storage or logged. Returning from checkout never grants access. Reopening the app recovers the report using its owner cookie.
4. `POST /api/payment-status` requires ownership and retrieves the **stored** invoice through the server adapter. Only a retrieved `paid` invoice with the exact amount, project and report reference can settle. Byl's invoice amount is denominated in tugrik; conflicting optional currency metadata is rejected. Project scope is the documented Byl identity boundary; no invented merchant field is trusted.
5. `POST /api/byl-webhook` receives raw bytes (body parsing disabled), verifies the hex HMAC-SHA256 `Byl-Signature` using a constant-time comparison, checks the project and invoice identity, then independently retrieves the stored invoice. Callback status/amount data is never payment proof. Pending bank transfer events never unlock. Unknown invoice bindings and provider failures return retryable 503 responses.
6. The SQL draft locks the report/order, records the unique project/event ID, updates the payment ledger and changes report status in one transaction. Duplicates are harmless; failed transactions do not consume events. Invoice IDs cannot bind to multiple reports in the same project. `void` revokes access and is terminal, so a delayed paid verification cannot restore access. Refund events beyond Byl's documented `invoice.void` require a verified provider contract and additional review.
7. Full report delivery still separately requires owner cookie, report expiry, paid report status and a matching verified payment for 6900 MNT. The exact active Byl order and its bound payment must match. Legacy QPay or unrelated Byl rows cannot authorize access. The final read RPC rechecks ownership, expiry and that join.

## Deliberate activation boundary

All exported production/default handlers use `disabledByl()`. There is **no HTTP transport**, no automatic fetch, no live credentials consumed and no environment variable that enables live operation. `createByl({projectId, signingSecret, transport})` is a server-only dependency-injection contract; local tests supply a transport returning official-shaped mock responses. Tests exercise actual handlers and browser JavaScript without navigating to Byl or creating invoices. There is no public mock payment/unlock endpoint.

`docs/sql/byl-payments.sql` has now been executed and validated in a fresh local PostgreSQL 17.11 database through real PostgREST 16.5. It remains unapplied to hosted staging/production. The local fixture models reported columns and roles; exact hosted schema compatibility remains pending. See [database validation, fixes and logs](byl-database-validation.md).

## Verification executed

On 2026-11-04:

- Baseline: 29/29 existing tests passed after allowing the local HTTP fixture's loopback connection. The initial sandbox-only run blocked that connection; it was not an application failure.
- Updated suite: **44/44 passed**, using `node --test tests/*.test.mjs`. Gemini, Supabase and Byl calls are mocked. Coverage includes fixed price, owner authorization/expiry, concurrent creation, ambiguous POST failure, retrieved settlement, wrong project/amount/currency/reference/invoice, hosted URL validation, raw-body signatures, callback tampering, duplicate deliveries, pending bank transfers, retryable failures, void revocation, store RPC request shapes and browser checkout/check-payment flow.
- **23/23 isolated PostgreSQL/PostgREST tests passed**, including DB concurrency, paid/revoked authorization, transactional rollback and RLS/grants. [Run logs and limitations](byl-database-validation.md).
- `node build.mjs` passed. Browser output remains restricted to `index.html` and `app.js`; server modules, SQL, tests and environment files are excluded.
- No real Byl, QPay, Gemini, staging database or production integration test was run in this iteration. Existing staging verification documents describe earlier work, not this payment implementation.

## Approval required before live work

Before adding a live transport or running **any live Byl API test**, request explicit user approval with the exact project, endpoints, number/amount of invoices, real-payment implications and reconciliation plan. Before **any production change**, separately request explicit approval identifying schema, credentials, webhook registration, deployment and rollback changes. Do not merge or deploy this branch as part of the mocked implementation.

Prior to activation, validate the SQL against an approved exact staging schema clone, review hosted raw-body handling and separately scoped secrets, reconcile ambiguous reservations, complete global abuse controls, validate the live merchant/project contract and define refund reconciliation. Local database concurrency/rollback/RLS checks are now executed; they do not establish hosted compatibility. Configure credentials and register webhooks only after the relevant approval.

## Official contract references

- [Byl invoices](https://byl.mn/docs/en/api/invoices.html): fixed-price invoices return a hosted payment URL; retrieval returns current invoice status and amount.
- [Byl webhooks](https://byl.mn/docs/en/webhook): raw-body HMAC-SHA256, event IDs, unordered/duplicate delivery and pending bank transfers.
- [Supabase database functions](https://supabase.com/docs/guides/database/functions): RPC and function privileges.
