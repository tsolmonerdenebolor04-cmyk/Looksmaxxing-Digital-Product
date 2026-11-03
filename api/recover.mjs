import { createStore } from '../lib/store.mjs';
import { authorizeReport, privateHeaders } from '../lib/paywall.mjs';

export function createHandler(getStore = createStore) {
  return async function handler(req, res) {
    privateHeaders(res);
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
    try {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      const store = getStore();
      const row = await authorizeReport(store, req, id);
      if (!row) return res.status(404).json({ error: 'Report unavailable' });
      // Explicit projection protects the recovery response even if stored preview has extra fields.
      const preview = Object.fromEntries(['headline', 'score', 'potential', 'scoreNote', 'insight', 'roast']
        .map(key => [key, row.preview?.[key]]));
      const paid = row.status === 'paid' && await store.hasVerifiedPayment(id);
      return res.status(200).json({ reportId: id, preview, paid });
    } catch {
      return res.status(503).json({ error: 'Тайлан сэргээх үйлчилгээ түр боломжгүй байна.' });
    }
  };
}
export default createHandler();
