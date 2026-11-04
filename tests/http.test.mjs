import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../dev-server.mjs';

test('HTTP server serves only browser assets and routes all paywall endpoints', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/', '/app.js']) {
    const res = await fetch(base + path); assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!/SUPABASE_SECRET_KEY|GEMINI_API_KEY|demoUnlock/.test(text));
  }
  for (const path of ['/.env', '/lib/store.mjs', '/tests/fixtures.mjs', '/api/report.mjs']) {
    assert.equal((await fetch(base + path)).status, 404);
  }
  for (const [path,method] of [['/api/analyze','GET'],['/api/payment','GET'],['/api/report','POST'],['/api/recover','POST'],['/api/payment-status','GET'],['/api/byl-webhook','GET']]) {
    const res = await fetch(base + path, {method});assert.equal(res.status,405);
    assert.match(res.headers.get('cache-control'),/no-store/);
  }
  const malformed = await fetch(base + '/api/payment', {method:'POST',body:'{'});
  assert.equal(malformed.status,400);
});
