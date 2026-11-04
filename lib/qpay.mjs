/**
 * Server-only provider contract for a future, reviewed QPay adapter.
 * createInvoice({reportId, amountMnt, currency, idempotencyKey}) ->
 *   {invoiceId, qrImage, urls}
 * verifyInvoice({invoiceId}) ->
 *   {invoiceId, status, amountMnt, currency, merchantId, paymentId}
 *
 * Verification MUST query QPay with merchant credentials. Callback payloads,
 * redirects, query parameters and browser requests are never payment evidence.
 * Validate invoice/report binding, merchant, exact 6900 MNT, currency, final
 * settlement and replay/idempotency before atomically updating payments.paid,
 * verified_at and reports.paid/paid_at. Refunds must revoke report access.
 * No adapter or payment status writer is enabled in this implementation.
 */
export const qpay = Object.freeze({
  async createInvoice() { throw new Error('QPay integration unavailable'); },
  async verifyInvoice() { throw new Error('QPay integration unavailable'); }
});
