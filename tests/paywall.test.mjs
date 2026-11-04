import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createHandler as analyzeHandler } from '../api/analyze.mjs';
import { createHandler as reportHandler } from '../api/report.mjs';
import { createHandler as paymentHandler } from '../api/payment.mjs';
import { createHandler as recoveryHandler } from '../api/recover.mjs';
import { createStore } from '../lib/store.mjs';
import { saveReport } from '../lib/paywall.mjs';
import { report } from './fixtures.mjs';
import { publicPreview } from '../lib/report.mjs';

function response() {
  return { headers: {}, code: 200, setHeader(k,v) { this.headers[k] = v; },
    status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } };
}
function fixture() {
  let saved;
  let payments = [];
  const reads = [];
  // Exercise the REST adapter and authorization filters without production writes.
  const store = createStore({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' }, async (url, options) => {
    assert.equal(options.headers.apikey, 'sb_secret_test');
    assert.equal(options.headers.Authorization, undefined);
    const u = new URL(url), q = u.searchParams;
    reads.push(u);
    if (options.method === 'POST') { saved = JSON.parse(options.body); return new Response(null, { status: 201 }); }
    const rows = u.pathname.endsWith('/payments') ? payments : saved ? [saved] : [];
    const filtered = rows.filter(row => [...q].every(([k,v]) => {
      if (k === 'select' || k === 'limit') return true;
      if (v === 'not.is.null') return row[k] != null;
      if (v.startsWith('in.(')) return v.slice(4,-1).split(',').includes(row[k]);
      if (v.startsWith('gt.')) return Date.parse(row[k]) > Date.parse(v.slice(3));
      return String(row[k]) === v.slice(3);
    })).map(row => Object.fromEntries(q.get('select').split(',').map(k => [k,row[k]])));
    return Response.json(filtered);
  });
  return { store, reads, get saved() { return saved; }, set payments(v) { payments = v; } };
}
async function setup() {
  const f = fixture(), res = response();
  const body = await saveReport(f.store, report, res, { NODE_ENV: 'production' });
  const cookie = res.headers['Set-Cookie'].split(';')[0];
  const req = { method:'GET', url: `/api/report?id=${body.reportId}`, headers: { cookie } };
  return { f, res, body, req, get: reportHandler(() => f.store) };
}
function paid(f) {
  f.saved.status = 'paid';
  f.payments = [{ id:'payment',report_id:f.saved.id,provider:'qpay',status:'paid',amount_mnt:6900,
    verified_at:new Date().toISOString(),provider_invoice_id:'provider-invoice' }];
}

test('creation stores full report and token hash; response is an explicit preview', async () => {
  const { f, res, body } = await setup();
  assert.deepEqual(f.saved.report, report);
  assert.deepEqual(Object.keys(body).sort(), ['preview','reportId']);
  assert.deepEqual(Object.keys(body.preview).sort(), ['headline','observations','potential','priority','roast','score','scoreNote','summary']);
  assert.equal(f.saved.status, 'unpaid');
  assert.match(f.saved.access_token_hash, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(body).includes(report.barberCard));
  for (const flag of ['HttpOnly','SameSite=Strict','Secure','Path=/api']) assert.ok(res.headers['Set-Cookie'].includes(flag));
  assert.ok(!res.headers['Set-Cookie'].includes(f.saved.access_token_hash));
});
test('missing, forged, cross-report cookies and malformed IDs cannot retrieve a paid report', async () => {
  const { f, req, get } = await setup(); paid(f);
  for (const request of [ { ...req, headers:{} }, { ...req, headers:{ cookie:req.headers.cookie.split('=')[0]+'='+randomBytes(32).toString('base64url') } },
    { ...req, url:'/api/report?id=00000000-0000-0000-0000-000000000000' }, { ...req,url:'/api/report?id=bad' } ]) {
    const res=response();await get(request,res);assert.equal(res.code,404);assert.equal(res.body.report,undefined);
  }
  assert.ok(!f.reads.some(u=>u.searchParams.get('select')==='report'));
});
test('unpaid, paid flag alone, mismatched amount, unverified and refunded payments stay locked', async () => {
  const { f, req, get } = await setup();
  const variants=[null,{}, {amount_mnt:1},{verified_at:null},{provider_invoice_id:null},{status:'refunded'},{provider:'demo'}];
  for (const variant of variants) {
    paid(f);
    if (variant === null) f.saved.status='unpaid';
    else if (!Object.keys(variant).length) f.payments=[];
    else f.payments=[{id:'payment',report_id:f.saved.id,provider:'qpay',status:'paid',amount_mnt:6900,verified_at:new Date().toISOString(),provider_invoice_id:'invoice',...variant}];
    const res=response();await get(req,res);assert.equal(res.code,402);assert.equal(res.body.report,undefined);
  }
  assert.ok(!f.reads.some(u=>u.searchParams.get('select')==='report'));
});
test('verified paid report requires owner cookie; expired reports remain unavailable', async () => {
  const { f, req, get } = await setup();paid(f);
  let res=response();await get(req,res);assert.equal(res.code,200);assert.deepEqual(res.body.report,report);
  assert.equal(res.headers['Cache-Control'],'private, no-store');
  f.saved.expires_at='2000-01-01T00:00:00Z';res=response();await get(req,res);assert.equal(res.code,404);
});
test('database errors fail closed and do not disclose upstream details', async () => {
  const handler=reportHandler(()=>({findReport:async()=>{throw Error('sensitive credential');}}));
  const {req}=await setup(),res=response();await handler(req,res);assert.equal(res.code,503);
  assert.ok(!JSON.stringify(res.body).includes('sensitive'));
  await assert.rejects(saveReport({insertReport:async()=>{throw Error('offline');}},report,response()),/offline/);
});
test('payment endpoint never accepts browser supplied success or creates a fake invoice', async () => {
  const {f,req}=await setup();
  const handler=paymentHandler(()=>f.store),res=response();
  await handler({...req,method:'POST',body:{reportId:f.saved.id,status:'paid',verified:true}},res);
  assert.equal(res.code,503);assert.equal(f.saved.status,'unpaid');
  const unauth=response();await handler({...req,method:'POST',headers:{},body:{reportId:f.saved.id}},unauth);assert.equal(unauth.code,404);
});
test('analysis validates Gemini output, persists it, and returns no full report', async t => {
  const original=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-only';
  t.after(()=>{if(original===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=original;});
  t.mock.method(globalThis,'fetch',async()=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify(report)}]}}]}));
  const bytes=Buffer.alloc(120);bytes[0]=0xff;bytes[1]=0xd8;
  const body={adult:true,consent:true,answers:{budget:70000,care:'x',hair:'y',roast:'z'},
    images:['FRONT','SIDE','FULL'].map(label=>({label,mimeType:'image/jpeg',data:bytes.toString('base64')}))};
  const f=fixture(),res=response();await analyzeHandler(()=>f.store)({method:'POST',headers:{},body},res);
  assert.equal(res.code,200);assert.deepEqual(f.saved.report,report);assert.equal(res.body.report,undefined);
  assert.deepEqual(res.body.preview,publicPreview(report));
  assert.deepEqual(Object.keys(res.body).sort(),['preview','reportId']);
});

test('analysis never delivers or persists an invalid report and never delivers on storage failure', async t => {
  const original=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-only';
  t.after(()=>{if(original===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=original;});
  const bytes=Buffer.alloc(120);bytes[0]=0xff;bytes[1]=0xd8;
  const body={adult:true,consent:true,answers:{budget:70000,care:'x',hair:'y',roast:'z'},
    images:['FRONT','SIDE','FULL'].map(label=>({label,mimeType:'image/jpeg',data:bytes.toString('base64')}))};
  const bad={...report,weeks:[]};let generated=bad, writes=0;
  t.mock.method(globalThis,'fetch',async()=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify(generated)}]}}]}));
  const handler=analyzeHandler(()=>({health:async()=>{},insertReport:async()=>{writes++;throw Error('database-secret-detail');}}));
  let res=response();await handler({method:'POST',headers:{},body},res);
  assert.equal(res.code,422);assert.equal(writes,0);assert.equal(res.body.report,undefined);
  generated=report;res=response();await handler({method:'POST',headers:{},body},res);
  assert.equal(res.code,502);assert.equal(writes,1);assert.equal(res.body.report,undefined);
  assert.equal(res.headers['Set-Cookie'],undefined);
  assert.ok(!JSON.stringify(res.body).includes('database-secret-detail'));
});

test('recovery reauthenticates every request and returns only an allowlisted preview', async () => {
  const {f,req}=await setup();
  const handler=recoveryHandler(()=>f.store);
  const request={...req,url:req.url.replace('/report?','/recover?')};
  f.saved.preview.report=report;f.saved.preview.access_token_hash=f.saved.access_token_hash;
  f.saved.preview.priority.barberCard='NESTED_PAID_SECRET';
  f.saved.preview.observations[0].weeks='NESTED_PAID_SECRET';
  f.saved.preview.roast.haircuts='NESTED_PAID_SECRET';
  let res=response();await handler(request,res);
  assert.equal(res.code,200);assert.equal(res.body.paid,false);
  assert.deepEqual(Object.keys(res.body).sort(),['paid','preview','reportId']);
  assert.equal(res.body.preview.report,undefined);assert.equal(res.body.preview.access_token_hash,undefined);
  assert.deepEqual(res.body.preview,publicPreview(report));
  assert.ok(!JSON.stringify(res.body).includes('NESTED_PAID_SECRET'));
  paid(f);res=response();await handler(request,res);
  assert.equal(res.body.paid,true);assert.equal(res.body.report,undefined);
  for(const headers of [{},{cookie:req.headers.cookie.replace(/=.+$/,'='+randomBytes(32).toString('base64url'))}]){
    res=response();await handler({...request,headers},res);assert.equal(res.code,404);
  }
  for(const expires_at of ['2000-01-01T00:00:00Z','invalid',null]){
    f.saved.expires_at=expires_at;res=response();await handler(request,res);assert.equal(res.code,404);
    assert.equal(res.body.preview,undefined);
  }
  assert.ok(!f.reads.some(u=>u.searchParams.get('select')==='report'));
});

test('storage preflight failure prevents Gemini spend', async t => {
  const original=process.env.GEMINI_API_KEY;process.env.GEMINI_API_KEY='test-only';
  t.after(()=>{if(original===undefined)delete process.env.GEMINI_API_KEY;else process.env.GEMINI_API_KEY=original;});
  const bytes=Buffer.alloc(120);bytes[0]=0xff;bytes[1]=0xd8;
  const body={adult:true,consent:true,answers:{budget:70000,care:'x',hair:'y',roast:'z'},
    images:['FRONT','SIDE','FULL'].map(label=>({label,mimeType:'image/jpeg',data:bytes.toString('base64')}))};
  const fetchMock=t.mock.method(globalThis,'fetch',()=>{throw Error('Gemini must not be called');});
  const res=response();await analyzeHandler(()=>({health:async()=>{throw Error('offline');}}))({method:'POST',headers:{'x-forwarded-for':'preflight-test'},body},res);
  assert.equal(res.code,503);assert.equal(fetchMock.mock.callCount(),0);
});
