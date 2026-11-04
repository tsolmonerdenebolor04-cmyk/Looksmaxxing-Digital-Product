import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createByl, disabledByl, checkoutUrl, referenceFor } from '../lib/byl.mjs';
import { createHandler as paymentHandler } from '../api/payment.mjs';
import { createHandler as statusHandler } from '../api/payment-status.mjs';
import { createHandler as webhookHandler } from '../api/byl-webhook.mjs';
import { createHandler as reportHandler } from '../api/report.mjs';
import { createStore } from '../lib/store.mjs';
import { saveReport } from '../lib/paywall.mjs';
import { report } from './fixtures.mjs';

const secret='local-fixture-signing-secret';
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},json(v){this.body=v;return this;}});
async function fixture() {
  let row,order,payment;
  const events=new Set(), calls=[];
  const store={
    async insertReport(v){row=v;},
    async findReport(id,hash){return row.id===id&&row.access_token_hash===hash?row:null;},
    async reserveByl(id,hash,project){
      assert.equal(hash,row.access_token_hash);
      const created=!order;
      if(created)order={report_id:id,project_id:project,status:'creating'};
      return {created,order:{...order}};
    },
    async bindByl(id,invoice,project,url){order={...order,provider_invoice_id:invoice,checkout_url:url,status:'open'};return {...order};},
    async findBylOrder(id){return order?.report_id===id?{...order}:null;},
    async claimBylVerification(){return true;},
    async findBylInvoice(id,project){return order?.provider_invoice_id===id&&order.project_id===project?{...order}:null;},
    async settleByl(v){
      assert.equal(v.amount,6900);assert.equal(v.invoiceId,order.provider_invoice_id);assert.equal(v.projectId,order.project_id);
      if(v.eventId&&events.has(v.eventId))return {status:order.status};
      if(v.eventId)events.add(v.eventId);
      order.status=order.status==='void'?'void':v.status;
      payment={status:order.status,amount:6900,verified:true};row.status=order.status==='paid'?'paid':'unpaid';
      return {status:order.status};
    },
    async hasVerifiedPayment(){return payment?.status==='paid'&&payment.verified&&payment.amount===6900;},
    async readPaidReport(id,hash){return row.id===id&&row.access_token_hash===hash&&row.status==='paid'?row.report:null;}
  };
  const res=response(), saved=await saveReport(store,report,res,{});
  const req={method:'POST',headers:{cookie:res.headers['Set-Cookie'].split(';')[0]},body:{reportId:saved.reportId}};
  let invoice={id:71,project_id:1,amount:6900,status:'open',description:referenceFor(saved.reportId),client_reference_id:referenceFor(saved.reportId),url:'https://byl.mn/h/invoice/71/MockSecret'};
  let failure=false;
  const provider=createByl({projectId:1,signingSecret:secret,transport:async call=>{
    calls.push(call);if(failure)throw Error('private-upstream-secret');return {data:{...invoice}};
  }});
  const invoke=async(handler,r=req)=>{const s=response();await handler(r,s);return s;};
  const create=paymentHandler(()=>store,()=>provider),check=statusHandler(()=>store,()=>provider),webhook=webhookHandler(()=>store,()=>provider);
  const eventReq=(changes={})=>{
    const rawBody=Buffer.from(JSON.stringify({id:3,project_id:1,type:'invoice.paid',object:'invoice',data:{object:{id:71}},...changes}));
    return {method:'POST',headers:{'byl-signature':createHmac('sha256',secret).update(rawBody).digest('hex')},rawBody};
  };
  return {store,req,calls,events,invoke,create,check,webhook,eventReq,get row(){return row;},get order(){return order;},
    get invoice(){return invoice;},set invoice(v){invoice=v;},set failure(v){failure=v;}};
}

test('default Byl handlers fail closed without an injected provider',async()=>{
  assert.throws(disabledByl,/reviewed activation/);
  const f=await fixture();const r=await f.invoke(paymentHandler(()=>f.store));
  assert.equal(r.code,503);assert.equal(f.calls.length,0);assert.equal(f.order,undefined);
  assert.equal((await f.invoke(statusHandler(()=>f.store))).code,503);
  assert.equal((await f.invoke(webhookHandler(()=>f.store),f.eventReq())).code,503);
});
test('invoice creation fixes price and reference server-side; concurrent clicks reuse one hosted invoice',async()=>{
  const f=await fixture();f.req.body={...f.req.body,amount:1,project_id:999,status:'paid',url:'https://evil.example'};
  const results=await Promise.all(Array.from({length:12},()=>f.invoke(f.create)));
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].body,{amount:6900,description:referenceFor(f.row.id),client_reference_id:referenceFor(f.row.id),auto_advance:true});
  assert.ok(results.some(r=>r.code===200));
  const r=await f.invoke(f.create);assert.equal(r.body.checkoutUrl,f.invoice.url);
  assert.equal(f.row.status,'unpaid');assert.deepEqual(Object.keys(r.body),['checkoutUrl']);
  assert.equal(r.headers['Cache-Control'],'private, no-store');
});
test('missing owner, cross-site requests and expired reports cannot create or check invoices',async()=>{
  const f=await fixture();
  for(const handler of [f.create,f.check]){
    assert.equal((await f.invoke(handler,{...f.req,headers:{}})).code,404);
    assert.equal((await f.invoke(handler,{...f.req,headers:{...f.req.headers,'sec-fetch-site':'cross-site'}})).code,403);
    assert.equal((await f.invoke(handler,{...f.req,method:'GET'})).code,405);
  }
  f.row.expires_at='2000-01-01';assert.equal((await f.invoke(f.create)).code,404);assert.equal(f.calls.length,0);
});
test('ambiguous create failure is not retried; no fake checkout or private upstream error is returned',async()=>{
  const f=await fixture();f.failure=true;
  const first=await f.invoke(f.create);assert.equal(first.code,503);assert.ok(!JSON.stringify(first.body).includes('private-upstream'));
  f.failure=false;assert.equal((await f.invoke(f.create)).code,409);assert.equal(f.calls.length,1);
});
test('retrieved paid invoice unlocks report only for its owner; client success never unlocks',async()=>{
  const f=await fixture();await f.invoke(f.create);
  f.req.body.status='paid';let r=await f.invoke(f.check);assert.equal(r.body.paid,false);
  const get=reportHandler(()=>f.store),getReq={...f.req,method:'GET',url:`/api/report?id=${f.row.id}`};
  assert.equal((await f.invoke(get,getReq)).code,402);
  f.invoice={...f.invoice,status:'paid'};r=await f.invoke(f.check);assert.equal(r.body.paid,true);
  assert.deepEqual((await f.invoke(get,getReq)).body.report,report);
  assert.equal((await f.invoke(get,{...getReq,headers:{}})).code,404);
  assert.equal(f.calls.at(-1).method,'GET');
});
test('wrong amount, project, reference, invoice, currency or malformed provider response never unlocks',async()=>{
  for(const change of [{amount:1},{project_id:2},{description:'other-report'},{client_reference_id:'other-report'},{client_reference_id:undefined},{id:72},{currency:'USD'},{status:'pending'},{url:'https://evil.example'}]){
    const f=await fixture();await f.invoke(f.create);f.invoice={...f.invoice,status:'paid',...change};
    assert.equal((await f.invoke(f.check)).code,503);assert.equal(f.row.status,'unpaid');
  }
});
test('checkout allowlist rejects credential URLs, foreign hosts, query strings and wrong invoice paths',()=>{
  for(const url of ['http://byl.mn/h/invoice/71/a','https://byl.mn.evil/h/invoice/71/a','https://x@byl.mn/h/invoice/71/a',
    'https://byl.mn/h/invoice/72/a','https://byl.mn/h/invoice/71/a?redirect=evil','javascript:alert(1)']) assert.throws(()=>checkoutUrl(url,71));
});
test('webhook requires exact raw-body HMAC and expected project; unsigned payloads cannot query provider',async()=>{
  const f=await fixture();await f.invoke(f.create);
  const r=f.eventReq();r.rawBody=Buffer.concat([r.rawBody,Buffer.from(' ')]);
  assert.equal((await f.invoke(f.webhook,r)).code,401);
  assert.equal((await f.invoke(f.webhook,{...f.eventReq(),headers:{}})).code,401);
  assert.equal((await f.invoke(f.webhook,f.eventReq({project_id:2}))).code,400);
  assert.equal(f.calls.length,1);
});
test('signed callback is only a hint; pending bank transfers do not grant access',async()=>{
  const f=await fixture();await f.invoke(f.create);
  assert.equal((await f.invoke(f.webhook,f.eventReq())).code,503);assert.equal(f.row.status,'unpaid');
  const before=f.calls.length;
  assert.equal((await f.invoke(f.webhook,f.eventReq({type:'payment.awaiting_verification'}))).code,200);
  assert.equal(f.calls.length,before);assert.equal(f.events.size,0);
});
test('concurrent duplicate webhook deliveries settle once; void revokes and stale paid cannot reopen',async()=>{
  const f=await fixture();await f.invoke(f.create);f.invoice={...f.invoice,status:'paid'};
  const results=await Promise.all(Array.from({length:10},()=>f.invoke(f.webhook,f.eventReq())));
  assert.ok(results.every(r=>r.code===200));assert.equal(f.events.size,1);assert.equal(f.row.status,'paid');
  f.invoice={...f.invoice,status:'void'};await f.invoke(f.webhook,f.eventReq({id:4,type:'invoice.void'}));
  assert.equal(f.row.status,'unpaid');
  f.invoice={...f.invoice,status:'paid'};await f.invoke(f.webhook,f.eventReq({id:5}));assert.equal(f.row.status,'unpaid');
});
test('unknown invoices and failed verification return retryable errors without consuming an event',async()=>{
  const f=await fixture();assert.equal((await f.invoke(f.webhook,f.eventReq())).code,503);
  await f.invoke(f.create);f.failure=true;
  assert.equal((await f.invoke(f.webhook,f.eventReq())).code,503);assert.equal(f.events.size,0);
  f.failure=false;f.invoice={...f.invoice,status:'paid'};assert.equal((await f.invoke(f.webhook,f.eventReq())).code,200);
  assert.equal(f.events.size,1);
});
test('store adapter uses server-only RPCs and binds lookups to project and invoice',async()=>{
  const calls=[];
  const store=createStore({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture'},async(url,options)=>{
    calls.push({url:new URL(url),options});return Response.json(url.includes('/rpc/')?{status:'paid'}:[]);
  });
  await store.reserveByl('r','hash',1);await store.bindByl('r','71',1,'https://byl.mn/h/invoice/71/a');
  await store.settleByl({reportId:'r',invoiceId:'71',projectId:1,status:'paid',amount:6900,eventId:'3'});
  await store.findBylInvoice('71',1);
  assert.equal(calls[0].url.pathname,'/rest/v1/rpc/reserve_byl_invoice');
  assert.deepEqual(JSON.parse(calls[2].options.body),{p_report:'r',p_invoice:'71',p_project:1,p_status:'paid',p_amount:6900,p_event:'3'});
  assert.equal(calls[3].url.searchParams.get('project_id'),'eq.1');assert.equal(calls[3].url.searchParams.get('provider_invoice_id'),'eq.71');
});

test('malformed truthy verification RPC results fail closed',async()=>{
  for(const value of ['true',{paid:true},[true],null,false]){
    const store=createStore({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture'},async()=>Response.json(value));
    assert.equal(await store.hasVerifiedPayment('fixture'),false);
  }
});
