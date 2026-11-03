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
      if (row.status !== 'paid' || !await store.hasVerifiedPayment(id)) {
        return res.status(402).json({ error: 'Төлбөр хараахан баталгаажаагүй байна.' });
      }
      // Fetch sensitive content only after checking ownership AND verified payment.
      const report = await store.readPaidReport(id, row.hash);
      if (!report) return res.status(404).json({ error: 'Report unavailable' });
      return res.status(200).json({ report });
    } catch {
      return res.status(503).json({ error: 'Тайлангийн үйлчилгээ түр боломжгүй байна.' });
    }
  };
}
export default createHandler();
