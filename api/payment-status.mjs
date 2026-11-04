import { createStore } from '../lib/store.mjs';
import { authorizeReport, privateHeaders } from '../lib/paywall.mjs';
import { disabledByl, verifyAndSettle } from '../lib/byl.mjs';

export function createHandler(getStore = createStore, getProvider = disabledByl) {
  return async (req,res) => {
    privateHeaders(res);
    if (req.method !== 'POST') return res.status(405).json({error:'POST only'});
    try {
      if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({error:'Forbidden'});
      const store = getStore();
      const row = await authorizeReport(store, req, req.body?.reportId);
      if (!row) return res.status(404).json({error:'Report unavailable'});
      const provider = getProvider();
      const order = await store.findBylOrder(row.id);
      if (!order?.provider_invoice_id) return res.status(200).json({paid:false});
      const paid = await verifyAndSettle(store,provider,order);
      return res.status(200).json({paid:paid === true});
    } catch { return res.status(503).json({error:'Төлбөр шалгах боломжгүй байна.'}); }
  };
}
export default createHandler();
