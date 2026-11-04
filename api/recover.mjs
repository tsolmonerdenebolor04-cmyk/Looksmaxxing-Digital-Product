import { createStore } from '../lib/store.mjs';
import { authorizeReport, privateHeaders } from '../lib/paywall.mjs';
import { publicPreview } from '../lib/report.mjs';

export function createHandler(getStore = createStore) {
  return async function handler(req, res) {
    privateHeaders(res);
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
    try {
      const id = new URL(req.url, 'http://localhost').searchParams.get('id');
      const store = getStore();
      const row = await authorizeReport(store, req, id);
      if (!row) return res.status(404).json({ error: 'Report unavailable' });
      // Reproject stored previews through the same nested allowlist used at creation.
      // Older previews remain smaller; never fetch full reports to backfill unpaid recovery.
      const preview = publicPreview(row.preview || {});
      const paid = row.status === 'paid' && await store.hasVerifiedPayment(id);
      return res.status(200).json({ reportId: id, preview, paid });
    } catch {
      return res.status(503).json({ error: 'Тайлан сэргээх үйлчилгээ түр боломжгүй байна.' });
    }
  };
}
export default createHandler();
