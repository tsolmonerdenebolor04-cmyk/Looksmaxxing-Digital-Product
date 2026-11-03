// Server-only Supabase Data API access. Never import this module in app.js.
export function createStore(env = process.env, fetcher = fetch) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key || !/^https:\/\/[^/]+\.supabase\.co$/.test(url)) {
    throw new Error('Report storage is not configured');
  }
  async function request(table, query, options = {}) {
    const response = await fetcher(`${url}/rest/v1/${table}?${query}`, {
      ...options,
      headers: {
        apikey: key,
        ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error('Report storage unavailable');
    return response.status === 204 || options.method ? null : response.json();
  }
  return {
    async health() {
      // Validate connectivity, select grants and required columns without reading customer rows.
      await request('reports', 'select=id,report,preview,status,access_token_hash,expires_at&limit=0');
      await request('payments', 'select=id,report_id,provider,provider_invoice_id,amount_mnt,status,verified_at&limit=0');
    },
    insertReport: row => request('reports', '', { method: 'POST', body: JSON.stringify(row) }),
    async findReport(id, hash) {
      const rows = await request('reports', new URLSearchParams({
        select: 'id,status,expires_at,preview', id: `eq.${id}`, access_token_hash: `eq.${hash}`, limit: '1'
      }));
      return rows[0] || null;
    },
    async hasVerifiedPayment(id) {
      const rows = await request('payments', new URLSearchParams({
        select: 'id', report_id: `eq.${id}`, provider: 'eq.qpay', status: 'eq.paid',
        amount_mnt: 'eq.6900', verified_at: 'not.is.null', provider_invoice_id: 'not.is.null', limit: '1'
      }));
      return rows.length > 0;
    },
    async readPaidReport(id, hash) {
      const rows = await request('reports', new URLSearchParams({
        select: 'report', id: `eq.${id}`, access_token_hash: `eq.${hash}`,
        status: 'eq.paid', expires_at: `gt.${new Date().toISOString()}`, limit: '1'
      }));
      return rows[0]?.report || null;
    }
  };
}
