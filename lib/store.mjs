// Server-only Supabase Data API access. Never import this module in app.js.
export function createStore(env = process.env, fetcher = fetch) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (!url || !key || !/^https:\/\/[^/]+\.supabase\.co$/.test(url)) {
    throw new Error('Report storage is not configured');
  }
  async function request(table, query, options = {}) {
    const { result, ...fetchOptions } = options;
    const response = await fetcher(`${url}/rest/v1/${table}?${query}`, {
      ...fetchOptions,
      headers: {
        apikey: key,
        ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }),
        'Content-Type': 'application/json',
        Prefer: result ? 'return=representation' : 'return=minimal'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error('Report storage unavailable');
    return response.status === 204 || (options.method && !options.result) ? null : response.json();
  }
  const rpc = (name, body) => request(`rpc/${name}`, '', {method:'POST',result:true,body:JSON.stringify(body)});
  return {
    reserveByl: (id, hash, project) => rpc('reserve_byl_invoice', {p_report:id,p_hash:hash,p_project:project}),
    bindByl: (id, invoice, project, url) => rpc('bind_byl_invoice', {p_report:id,p_invoice:invoice,p_project:project,p_url:url}),
    settleByl: v => rpc('settle_byl_invoice', {p_report:v.reportId,p_invoice:v.invoiceId,p_project:v.projectId,p_status:v.status,p_amount:v.amount,p_event:v.eventId}),
    claimBylVerification: id => rpc('claim_byl_verification',{p_report:id}),
    async findBylOrder(id) {
      const rows=await request('byl_orders',new URLSearchParams({select:'*',report_id:`eq.${id}`,limit:'1'}));
      return rows[0] || null;
    },
    async findBylInvoice(invoice, project) {
      const rows=await request('byl_orders',new URLSearchParams({select:'*',provider_invoice_id:`eq.${invoice}`,project_id:`eq.${project}`,limit:'1'}));
      return rows[0] || null;
    },
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
    hasVerifiedPayment: async id => (await rpc('has_verified_byl_payment',{p_report:id})) === true,
    readPaidReport: (id, hash) => rpc('read_byl_report',{p_report:id,p_hash:hash})
  };
}
