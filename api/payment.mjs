import { createStore } from '../lib/store.mjs';
import { authorizeReport, privateHeaders } from '../lib/paywall.mjs';

export function createHandler(getStore = createStore) {
  return async function handler(req, res) {
    privateHeaders(res);
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    try {
      const row = await authorizeReport(getStore(), req, req.body?.reportId);
      if (!row) return res.status(404).json({ error: 'Report unavailable' });
      // Intentionally fail closed: no invoice creation or payment mutation yet.
      return res.status(503).json({ error: 'QPay төлбөрийн холболт хараахан бэлэн болоогүй байна. Төлбөр авахгүй.' });
    } catch {
      return res.status(503).json({ error: 'Төлбөрийн үйлчилгээ түр боломжгүй байна.' });
    }
  };
}
export default createHandler();
