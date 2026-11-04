import { createStore } from '../lib/store.mjs';
import { privateHeaders } from '../lib/paywall.mjs';
import { disabledByl, verifyAndSettle } from '../lib/byl.mjs';

export const config = { api:{ bodyParser:false } };
export function createHandler(getStore = createStore, getProvider = disabledByl) {
  return async (req,res) => {
    privateHeaders(res);
    if (req.method !== 'POST') return res.status(405).json({error:'POST only'});
    try {
      const provider = getProvider();
      let raw = req.rawBody;
      if (!Buffer.isBuffer(raw)) {
        const chunks=[]; let size=0;
        for await (const chunk of req) {
          size+=chunk.length;
          if (size>65536) return res.status(413).json({error:'Request too large'});
          chunks.push(Buffer.from(chunk));
        }
        raw=Buffer.concat(chunks);
      }
      if (!provider.authenticate(raw,req.headers['byl-signature'])) return res.status(401).json({error:'Invalid signature'});
      let event;
      try { event=JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({error:'Invalid JSON'}); }
      if (!Number.isSafeInteger(event.id) || event.id<=0 || event.project_id!==provider.projectId) return res.status(400).json({error:'Invalid event'});
      if (!['invoice.paid','invoice.void'].includes(event.type)) return res.status(200).json({received:true});
      if (event.object!=='invoice' || !Number.isSafeInteger(event.data?.object?.id) || event.data.object.id<=0) return res.status(400).json({error:'Invalid invoice'});
      const store=getStore();
      const order=await store.findBylInvoice(String(event.data.object.id),provider.projectId);
      // Retry unknown invoices: delivery can race the invoice binding transaction.
      if (!order) return res.status(503).json({error:'Invoice not ready'});
      const paid=await verifyAndSettle(store,provider,order,String(event.id));
      if (paid===null) return res.status(503).json({error:'Invoice not settled yet'});
      return res.status(200).json({received:true});
    } catch { return res.status(503).json({error:'Payment service unavailable'}); }
  };
}
export default createHandler();
