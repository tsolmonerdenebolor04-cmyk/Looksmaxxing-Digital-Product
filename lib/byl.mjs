import { createHmac, timingSafeEqual } from 'node:crypto';

export const PRICE_MNT = 6900;
export const referenceFor = id => `glowup:${id}`;
const numericId = value => Number.isSafeInteger(value) && value > 0;

export function checkoutUrl(value, invoiceId) {
  const url = new URL(value);
  if (url.origin !== 'https://byl.mn' || url.username || url.password || url.search || url.hash ||
      !new RegExp(`^/h/invoice/${invoiceId}/[A-Za-z0-9]+$`).test(url.pathname)) throw Error('Invalid checkout URL');
  return url.href;
}

// This release deliberately has NO network transport or environment switch to live mode.
// Tests inject a transport returning official-shaped {data: invoice} mock responses.
export function createByl({ projectId, signingSecret, transport } = {}) {
  if (!numericId(projectId) || typeof transport !== 'function' || !signingSecret) throw Error('Byl unavailable');
  const validate = (invoice, reportId) => {
    if (!numericId(invoice?.id) || invoice.project_id !== projectId || invoice.amount !== PRICE_MNT ||
        invoice.description !== referenceFor(reportId) || invoice.client_reference_id !== referenceFor(reportId) ||
        !['open','paid','void'].includes(invoice.status)) {
      throw Error('Invoice verification failed');
    }
    // Byl invoice amounts are denominated in MNT; reject conflicting optional metadata.
    if (invoice.currency !== undefined && invoice.currency !== 'MNT') throw Error('Wrong currency');
    return { ...invoice, url: checkoutUrl(invoice.url, invoice.id) };
  };
  return Object.freeze({
    projectId,
    async createInvoice(reportId) {
      // No automatic retries: Byl's documented contract does not promise POST idempotency.
      const result = await transport({ method:'POST', path:`/projects/${projectId}/invoices`,
        body:{ amount:PRICE_MNT, description:referenceFor(reportId), client_reference_id:referenceFor(reportId), auto_advance:true } });
      const invoice = validate(result?.data, reportId);
      if (invoice.status !== 'open') throw Error('Invoice is not open');
      return invoice;
    },
    async verifyInvoice(order) {
      if (Number(order.project_id) !== projectId) throw Error('Wrong project');
      const invoiceId = Number(order.provider_invoice_id);
      if (!numericId(invoiceId)) throw Error('Invalid invoice');
      const result = await transport({ method:'GET', path:`/projects/${projectId}/invoices/${invoiceId}` });
      const invoice = validate(result?.data, order.report_id);
      if (invoice.id !== invoiceId) throw Error('Wrong invoice');
      return invoice;
    },
    async recoverInvoice(order) {
      if (Number(order.project_id)!==projectId || order.status!=='creating') throw Error('Invalid recovery');
      const result=await transport({method:'GET',path:`/projects/${projectId}/invoices/by-client-reference-id/${encodeURIComponent(referenceFor(order.report_id))}`});
      return validate(result?.data,order.report_id);
    },
    authenticate(raw, signature) {
      if (!Buffer.isBuffer(raw) || raw.length > 65536 || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
      const expected = createHmac('sha256', signingSecret).update(raw).digest();
      return timingSafeEqual(expected, Buffer.from(signature,'hex'));
    }
  });
}

export function disabledByl() { throw Error('Byl integration requires reviewed activation'); }

// Operator-only module function, never an HTTP route. Recovery only retrieves an
// existing invoice by the original reference; even a 404 never retries creation.
export async function reconcileByl(store, provider, reportId) {
  const order=await store.findBylOrder(reportId);
  if (!order || order.status!=='creating') throw Error('No ambiguous reservation');
  const invoice=await provider.recoverInvoice(order);
  await store.bindByl(reportId,String(invoice.id),provider.projectId,invoice.url);
  if (invoice.status!=='open') await verifyAndSettle(store,provider,await store.findBylOrder(reportId));
  return store.findBylOrder(reportId);
}

export async function verifyAndSettle(store, provider, order, eventId = null) {
  const invoice = await provider.verifyInvoice(order);
  if (!['paid','void'].includes(invoice.status)) return null;
  // The RPC validates binding again and commits the ledger, event and report together.
  const settled = await store.settleByl({ reportId:order.report_id, invoiceId:String(invoice.id),
    projectId:provider.projectId, status:invoice.status, amount:invoice.amount, eventId });
  return settled?.status === 'paid';
}
