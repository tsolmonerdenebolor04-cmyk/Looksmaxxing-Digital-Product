# Staging migration and synthetic test plan — approval pending

Read-only compatibility review is complete. Detailed catalog evidence, access-control metadata and the full operator runbook remain **local and private**; they are deliberately not included in this public repository. No migration was applied, including in a local harness, during this review.

## Draft changes

- Store payment-ledger invoice identifiers as `byl:<project>:<invoice>`, keeping the raw ID in the Byl order for provider retrieval. This avoids provider/project identifier collisions while preserving existing uniqueness rules and legacy rows.
- Keep a report explicitly marked expired inaccessible after settlement.
- Treat a refund already recorded on the bound ledger as terminal, so delayed paid confirmations cannot restore access.
- Keep the existing transaction locks, event replay checks, exact order/payment authorization join, RLS and service-only RPC/table access. Revoke unintended default grants in the same transaction; do not change global database defaults or add browser policies.

Canonical candidate: [byl-payments.sql](sql/byl-payments.sql). SHA-256 over LF-normalized UTF-8:

`3f3e5a683c9702eb82422fcebbe7c7acbfed5458fe2a0cb9f4eb922d7a1b2c87`

The candidate remains **unexecuted**. It creates two tables and six RPCs without rewriting legacy payments, changing existing constraints, enabling a provider transport or registering a webhook. Formal migration recording must wait for approval.

## What has and has not passed

This revision passed **44/44 mock/browser tests**, JavaScript syntax checks and diff checks. **27 database cases are prepared but have not been run for this revision.** The earlier 23/23 native PostgreSQL/PostgREST result belongs to commit 59652f2 and does not validate this revised candidate.

The public test fixture is synthetic. A private metadata-derived fixture can be selected for the isolated replay without publishing hosted metadata. Hosted PostgREST behavior and the candidate's revised SQL execution remain pending.

## Conditional execution plan after approval

1. Confirm the staging target and candidate hash against the private runbook. Repeat read-only drift/name/namespace checks. Abort on unexpected objects, occupied identifiers, incompatible schema drift or any unapproved target.
2. Run the 27 cases in the **loopback-only disposable PostgreSQL/PostgREST harness**, selecting the private reviewed fixture locally. Also require the 44 existing tests to pass. Capture fresh logs. Any failure stops the plan before staging application; revise and report instead of retrying blindly.
3. Only if isolated replay passes, apply the exact approved candidate once to **glowup-ai-staging only**, through the migration tool/admin role. No production target, deployment, credential change, main merge, global privilege alteration or live provider action is included.
4. Verify the new constraints, RLS, fixed function search paths and service-only access. Confirm old objects/security remain unchanged. Validate actual hosted RPC JSON object/boolean/null/report results using staging-only credentials held locally. Record any staging-only schema-cache refresh required by the approved migration verification.
5. Run synthetic staging tests through real application handlers with **mocked Byl responses** and a guarded staging store. Use a per-run manifest recorded before every uncertain write. Allocate positive numeric mock invoice/event IDs; ledger IDs receive the Byl/project namespace. Never enable the default provider, create real invoices, contact Byl/QPay/Gemini or register a webhook.
6. Clean only manifest-owned fixtures, verify cleanup independently and report results. Runtime stays disabled and PR #1 stays unmerged.

## Required test matrix

| Area | Pass criteria |
| --- | --- |
| Authorization | Unpaid denied; missing/forged/cross-report owner denied; valid paid owner succeeds; time-expired and explicitly expired reports denied. Legacy, unrelated, wrong-amount/invoice, unverified and refunded payments cannot substitute for the exact bound order. Final read repeats the check. |
| Concurrency | Twenty reservations yield one creation claim. Twelve handler calls consume one mocked creation response. Invoice binding cannot cross reports. Raw invoice IDs may safely overlap across providers/projects because ledger IDs are namespaced. |
| Replay/webhooks | Twenty deliveries persist one event/payment. Cross-invoice replay fails atomically. Invalid signatures/projects never reach verification. Callback status and pending responses alone never unlock. |
| Refund/revocation | Paid -> void updates all authorization state atomically. Duplicate/delayed paid cannot reopen a void order or a refunded ledger. Real refund processing and unsupported provider reversal events are outside this approval. |
| Rollback/recovery | Wrong binding/amount/project and ledger conflicts roll back. Ambiguous mocked creation stays reserved; GET-only recovery binds an existing synthetic response without another POST. Injected triggers and deliberate migration failures run **only in the disposable harness**, never by altering hosted base tables. |
| Polling | Twenty simultaneous claims permit one verification per report per ten seconds. Throttled calls return 429/Retry-After without contacting the mock provider. |
| RLS/grants | Browser roles cannot read/write private tables or execute the six RPCs; the server role can perform required operations. Verify privilege revocation despite automatic grants. Exercise anonymous HTTP denial with the staging publishable key. Use an existing approved test identity for authenticated HTTP, or explicitly report it pending; do not create users or retrieve signing keys implicitly. |
| Cleanup | Exact manifest IDs only: Byl events -> Byl orders -> legacy events -> payments -> reports. No TRUNCATE/broad prefix/status deletion. An unrelated sentinel must survive and no manifest/orphan fixtures may remain. |

## Rollback rules

The migration is one transaction. If application fails, verify object/history consistency and stop; never blindly retry an uncertain write. After a successful application, test failure authorizes only exact-ID fixture cleanup. It does not authorize dropping tables, deleting migration history, resetting projects or discarding non-fixture data. Any corrective/down migration requires separate review; keep runtime disabled meanwhile.

## Exact next action

Review and explicitly approve the candidate hash and **the conditional staging-only plan**: isolated replay first, then staging application and synthetic tests only if it passes. Detailed target identification and operator steps are in the private runbook. No migration is to run before approval; live API testing, real invoices/payments, production, deployments and merge remain excluded.
