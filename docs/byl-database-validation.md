# Review eff636b: isolated database validation

Addresses [review comment 6633586441](https://github.com/tsolmonerdenebolor04-cmyk/Looksmaxxing-Digital-Product/pull/1#issuecomment-6633586441). Executed on 2026-11-04. Price remains **6,900 MNT**. Runtime activation remains disabled.

## Scope and reproduction

The runner creates a fresh native PostgreSQL cluster bound to **127.0.0.1 only**, with a randomly named disposable database. Real PostgREST connects to it using locally generated test JWTs. The runner accepts no database URL, loads no `.env`, and removes inherited `PGRST_*` overrides from the PostgREST process. It stops both servers in `finally`; diagnostic data stays local rather than recursively deleting computed paths.

`tests/db/schema.sql` models the reported reports/payments columns, RLS and roles. It is **not a staging clone or complete hosted schema export**. The review confirms existing columns; hosted constraints/default privileges/extensions/version differences still need separately approved validation.

Tools used: Node 24.22.1; native PostgreSQL **17.11** from `@embedded-postgres/windows-x64@17.11.0-beta.19` (published SHA-512 checked); PostgREST **16.5** from the [official release](https://github.com/PostgREST/postgrest/releases/tag/v16.5), SHA-256 `17f595b0d8dd37473d0231417dea07c5ac9f791282ff5b017fae51ff29e5de2f`; pinned dev-only `postgres@3.4.7` with package-lock.json. Application runtime remains dependency-free.

```powershell
npm ci --ignore-scripts
$env:BYL_TEST_PG_BIN = '<local PostgreSQL bin directory>'
$env:BYL_TEST_POSTGREST_BIN = '<local postgrest executable>'
npm run test:db
npm test
npm run build
```

On Windows the runner adds PostgreSQL's DLL directory to only the PostgREST child's PATH. Tests do not download binaries or contact providers. Portable tools were prepared separately in an untracked directory outside the repository. No system service or binaries are committed.

## Fixes

- **Exact authorization:** `has_verified_byl_payment` joins the active Byl order to its exact payment ID, report ID and invoice ID. Both states must be paid, provider must be Byl, amount must be 6900 and verified_at must exist. QPay and unrelated paid Byl rows no longer authorize access. RPC booleans must be literal true.
- **Final read recheck:** `read_byl_report` checks that join, owner hash, expiry and report status in the final SQL statement returning the JSON. An earlier paid preflight cannot bypass later revocation using unrelated rows.
- **NULL-safe binding:** SQL rejects null project/invoice/URL arguments. SQL's three-valued comparisons can no longer let NULL arguments pass the guard.
- **Ledger conflict:** settlement refuses to update a conflicting payment primary key for another report/provider/invoice/amount; event/order/report changes roll back.
- **Shared polling control:** an atomic DB claim allows one verification per report per ten seconds across instances. Others receive 429/Retry-After before provider access. Failed verifications also retain the cooldown; webhooks remain independent. This is not a global spend/ingress limit.
- **Ambiguous recovery:** creation sends documented client_reference_id. Operator-only `reconcileByl` retrieves by that original reference, validates and binds the existing invoice. It has no public route and never retries POST. Missing/unavailable/mismatched results stay in creating; paid/void recovery is independently verified after binding.

The staging-only synthetic runner now uses Byl binding/settlement RPCs and removes only its own Byl event/order rows during cleanup. It was **not run** and requires separately approved schema application. It does not apply SQL or contact Byl.

## Results and precise logs

- **23/23 PostgreSQL/PostgREST tests passed**: [database log](test-results/byl-postgres-2026-11-04.txt).
- **44/44 mock/browser/security tests passed**: [local suite log](test-results/byl-local-2026-11-04.txt).
- `node build.mjs` and `git diff --check` passed.

Twenty simultaneous reservations produced one creation claim. Twelve concurrent checkout handlers consumed one mocked creation response. Twenty duplicate settlement transactions produced one event/payment. Cross-invoice replay failed without changes. Concurrent paid/void and later paid confirmations left access revoked. Twenty simultaneous polling claims permitted one verification.

Actual DB rows passed through the real store/PostgREST adapter and report handlers: paid owner access succeeded; wrong-owner, expired, revoked, legacy-QPay and unrelated-Byl cases failed. Both anon/authenticated roles were denied reads/writes and all six RPCs. Temporarily granting SELECT in the disposable DB still revealed zero order rows because RLS denied them.

Explicit rollbacks removed reservations/settlements. Injected ledger failure left no event/payment/unlock. A failure during the final report update undid earlier revocation event/order/ledger writes; retrying the same event then revoked successfully. A deliberate error immediately before migration COMMIT left no Byl tables/functions in a second disposable database.

Initial harness attempts exposed Windows inherited-pipe/DLL startup issues, the driver's dedicated-connection requirement for migrations, and a malformed privilege-test payload. These were fixed before the recorded successful runs. No failing check was skipped or converted to a pass.

## Provider contract verification: documentation only

Only public documentation was accessed. **No Byl API endpoint, including read-only/non-billable endpoints, was called.**

| Contract | Documentation and implementation |
| --- | --- |
| Invoice | [Official invoices documentation](https://byl.mn/docs/api/invoices.html) specifies tugrik amounts, numeric invoice/project IDs, data envelope, description, client_reference_id and statuses. Creation fixes amount 6900 and sends the 43-character report reference in description/client_reference_id; retrieval must match both. |
| Reconciliation | The same documentation specifies GET /projects/:project_id/invoices/by-client-reference-id/:client_reference_id, returning the invoice envelope or 404. References are **not unique at Byl** and lookup returns the newest match. This is recovery, not provider idempotency; externally duplicated references require operator audit. A missing lookup never permits another POST. |
| Hosted URL | Invoice URLs follow https://byl.mn/h/invoice/ID/secret. Server and browser allow only the exact HTTPS origin and matching invoice path, without credentials/query/fragment. |
| Webhook | [Official webhook documentation](https://byl.mn/docs/en/webhook) specifies Byl-Signature, hex HMAC-SHA256 over exact raw bytes, constant-time comparison, project/event IDs and data.object. Events can be duplicated/unordered. Pending bank transfer is not payment proof. |
| RPC | [PostgREST functions documentation](https://docs.postgrest.org/en/v13/references/api/functions.html) describes named JSON arguments/scalar returns. Actual local PostgREST tests verified reservation/bind/settlement objects, literal booleans and nullable report JSON. Hosted version behavior remains a staging check. |

## Callback secret plan

No actual callback secret was retrieved, added or changed. After approval, put the endpoint signing secret in a server-only secret (proposed name BYL_WEBHOOK_SIGNING_SECRET) in the explicitly approved environment and inject it into the adapter. Never use frontend prefixes or put it in source, client bundles, URLs, logs or browser storage. Keep project ID in server configuration and require every event to match it: Byl documents the signing secret as shared across the team's projects. Confirm provider rotation/retry behavior before deployment. Credential provisioning and webhook registration remain separate approved actions. Current code reads no live Byl environment variables.

## Remaining blockers

1. Validate SQL against an approved disposable clone/export of the **exact staging schema**, including its PostgREST version, constraints and default privileges. Then adopt it via the reviewed migration process. No hosted migration has been applied.
2. Review a concrete staging-only plan covering schema diff, rollback/reconciliation, synthetic fixtures/cleanup, separate Preview secrets and hosted API/raw-body/cookie/static-isolation checks. Historical staging/visual reports are not results for this change.
3. Live transport remains absent. Any Byl credential use, API request, real invoice/payment, webhook registration or production change still requires separate explicit approval. Docs establish the intended contract, not an observed response from the user's LIVE project.
4. Define refunds/reversals beyond invoice.void, operator handling of externally duplicated references, global abuse/spend limits and retention/deletion. Per-report polling cooldown does not complete those controls.

PR #1 remains unmerged. This report requests no approval for live testing or production changes.
