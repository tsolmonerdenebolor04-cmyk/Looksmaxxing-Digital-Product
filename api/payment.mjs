import { createStore } from '../lib/store.mjs';
import { authorizeReport, privateHeaders } from '../lib/paywall.mjs';
import { checkoutUrl, disabledByl } from '../lib/byl.mjs';

export function createHandler(getStore = createStore, getProvider = disabledByl) {
  return async function handler(req, res) {
    privateHeaders(res);
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    try {
      if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({error:'Forbidden'});
      const store = getStore();
      const row = await authorizeReport(store, req, req.body?.reportId);
      if (!row) return res.status(404).json({ error: 'Report unavailable' });
      const provider = getProvider();
      if (row.status === 'paid') return res.status(409).json({error:'Report already paid'});
      const reservation = await store.reserveByl(row.id, row.hash, provider.projectId);
      let order = reservation.order;
      if (reservation.created) {
        // Reservation survives failures. An ambiguous POST is never retried automatically.
        const invoice = await provider.createInvoice(row.id);
        order = await store.bindByl(row.id, String(invoice.id), provider.projectId, invoice.url);
      }
      if (!order?.checkout_url || order.status !== 'open') return res.status(409).json({error:'Invoice pending reconciliation'});
      return res.status(200).json({ checkoutUrl:checkoutUrl(order.checkout_url, Number(order.provider_invoice_id)) });
    } catch {
      return res.status(503).json({ error: 'Төлбөрийн үйлчилгээ түр боломжгүй байна.' });
    }
  };
}
export default createHandler();
