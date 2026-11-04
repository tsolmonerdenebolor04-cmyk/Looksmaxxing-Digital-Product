import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { createStore } from '../../lib/store.mjs';
import { saveReport } from '../../lib/paywall.mjs';
import { createByl, referenceFor, reconcileByl } from '../../lib/byl.mjs';
import { createHandler as reportHandler } from '../../api/report.mjs';
import { createHandler as paymentHandler } from '../../api/payment.mjs';
import { createHandler as statusHandler } from '../../api/payment-status.mjs';
import { createHandler as webhookHandler } from '../../api/byl-webhook.mjs';
import { report } from '../fixtures.mjs';

// The launcher creates these values for its fresh cluster; arbitrary DB URLs/hosts
// are intentionally unsupported. This suite never loads staging/production env files.
if(process.env.BYL_TEST_LOCAL_RUN!=='1'||!/^byl_regression_[a-f0-9]{16}$/.test(process.env.BYL_TEST_DB||'')) throw Error('Use scripts/test-postgres.mjs');
const pgPort=Number(process.env.BYL_TEST_PG_PORT),restPort=Number(process.env.BYL_TEST_REST_PORT);
if(![pgPort,restPort].every(p=>Number.isInteger(p)&&p>1024&&p<65536))throw Error('Invalid local ports');
const db=postgres({host:'127.0.0.1',port:pgPort,database:process.env.BYL_TEST_DB,username:'postgres',max:20,onnotice:()=>{}});
const base=`http://127.0.0.1:${restPort}`;
const jwt=role=>{
  const parts=[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),
    Buffer.from(JSON.stringify({role,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')];
  return [...parts,createHmac('sha256',process.env.BYL_TEST_JWT_SECRET).update(parts.join('.')).digest('base64url')].join('.');
};
const serviceToken=jwt('service_role');
const rest=async(path,body,role='service_role',method=body===undefined?'GET':'POST')=>{
  const r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${role==='service_role'?serviceToken:jwt(role)}`,'Content-Type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const text=await r.text();return {status:r.status,body:text?JSON.parse(text):null};
};
const rpc=async(name,body)=>{const r=await rest('/rpc/'+name,body);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
const store=createStore({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_local_fixture'},async(input,options)=>{
  const url=new URL(input);assert.equal(url.origin,'https://test.supabase.co');assert.ok(url.pathname.startsWith('/rest/v1/'));
  return fetch(base+url.pathname.slice('/rest/v1'.length)+url.search,{...options,headers:{...options.headers,Authorization:`Bearer ${serviceToken}`}});
});
const response=()=>({code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(v){this.code=v;return this;},json(v){this.body=v;return this;}});
const invoke=async(handler,req)=>{const res=response();await handler(req,res);return res;};
let invoiceId=10000,eventId=20000;
async function fixture({bind=true}={}){
  const res=response(),saved=await saveReport(store,report,res,{});
  const [row]=await db`select * from reports where id=${saved.reportId}`;
  const id=String(++invoiceId),url=`https://byl.mn/h/invoice/${id}/LocalFixture`;
  const req={method:'POST',headers:{cookie:res.headers['Set-Cookie'].split(';')[0]},body:{reportId:row.id}};
  if(bind){await store.reserveByl(row.id,row.access_token_hash,1);await store.bindByl(row.id,id,1,url);}
  const value={reportId:row.id,invoiceId:id,projectId:1,status:'paid',amount:6900,eventId:String(++eventId)};
  const invoice={id:Number(id),project_id:1,amount:6900,status:'paid',description:referenceFor(row.id),client_reference_id:referenceFor(row.id),url};
  const provider=createByl({projectId:1,signingSecret:'local-only-signing-secret',transport:async call=>{
    assert.equal(call.method,'GET','No provider invoice creation during database tests');return {data:{...invoice}};
  }});
  return {row,id,url,req,value,invoice,provider};
}
async function snapshot(f){
  const [[r],[o],p,e]=await Promise.all([db`select status,paid_at from reports where id=${f.row.id}`,
    db`select status from byl_orders where report_id=${f.row.id}`,db`select * from payments where report_id=${f.row.id}`,
    db`select * from byl_events where report_id=${f.row.id}`]);return {report:r,order:o,payments:p,events:e};
}
before(async()=>{
  const connection=await db.reserve();
  try{await connection.unsafe(await readFile(new URL('../../docs/sql/byl-payments.sql',import.meta.url),'utf8'));}
  finally{connection.release();}
  await db`notify pgrst, 'reload schema'`;
  for(let i=0;i<100;i++){
    const result=await rest('/rpc/has_verified_byl_payment',{p_report:randomUUID()});
    if(result.status===200)return;
    await new Promise(r=>setTimeout(r,100));
  }
  throw Error('PostgREST schema cache did not load migration');
});
after(()=>db.end());

test('migration commits tables, security-invoker RPCs, fixed search paths and service-only privileges',async()=>{
  const tables=await db`select relname,relrowsecurity from pg_class where relname in ('byl_orders','byl_events')`;
  assert.equal(tables.length,2);assert.ok(tables.every(t=>t.relrowsecurity));
  const functions=await db`select proname,prosecdef,proconfig from pg_proc where proname in
    ('reserve_byl_invoice','bind_byl_invoice','settle_byl_invoice','has_verified_byl_payment','read_byl_report','claim_byl_verification')`;
  assert.equal(functions.length,6);assert.ok(functions.every(f=>!f.prosecdef&&f.proconfig.some(v=>v.startsWith('search_path='))));
});
test('a late migration failure rolls back all Byl tables and functions in a separate disposable database',async()=>{
  const name=process.env.BYL_TEST_DB+'_rollback';
  await db.unsafe(`create database ${name}`);
  const isolated=postgres({host:'127.0.0.1',port:pgPort,database:name,username:'postgres',max:1,onnotice:()=>{}});
  try{
    const schema=(await readFile(new URL('./schema.sql',import.meta.url),'utf8')).replace(/^create role .+;\r?$/gm,'');
    await isolated.unsafe(schema);
    const sql=(await readFile(new URL('../../docs/sql/byl-payments.sql',import.meta.url),'utf8')).replace('commit;','select 1/0;\ncommit;');
    await assert.rejects(isolated.unsafe(sql),error=>error.code==='22012');
    await isolated.unsafe('rollback');
    const [state]=await isolated`select to_regclass('public.byl_orders') as orders,to_regclass('public.byl_events') as events,
      to_regprocedure('public.settle_byl_invoice(uuid,text,bigint,text,integer,text)') as settle`;
    assert.deepEqual({...state},{orders:null,events:null,settle:null});
  }finally{await isolated.end();}
});
test('PostgREST RPC JSON objects, booleans and null/report scalars match the real store contract',async()=>{
  const f=await fixture({bind:false});
  const reservation=await store.reserveByl(f.row.id,f.row.access_token_hash,1);
  assert.equal(reservation.created,true);assert.equal(reservation.order.report_id,f.row.id);assert.equal(reservation.order.project_id,1);
  const bound=await store.bindByl(f.row.id,f.id,1,f.url);assert.equal(bound.provider_invoice_id,f.id);assert.equal(bound.status,'open');
  assert.equal(await store.hasVerifiedPayment(f.row.id),false);assert.equal(await store.readPaidReport(f.row.id,f.row.access_token_hash),null);
  assert.deepEqual(await store.settleByl(f.value),{status:'paid'});
  assert.equal(await store.hasVerifiedPayment(f.row.id),true);assert.deepEqual(await store.readPaidReport(f.row.id,f.row.access_token_hash),report);
});
test('sequential reservations preserve the original order and return created=false',async()=>{
  const f=await fixture({bind:false});const first=await store.reserveByl(f.row.id,f.row.access_token_hash,1);
  const again=await store.reserveByl(f.row.id,f.row.access_token_hash,1);
  assert.equal(first.created,true);assert.equal(again.created,false);assert.equal(first.order.payment_id,again.order.payment_id);
});
test('20 separate concurrent PostgREST transactions reserve exactly one invoice attempt',async()=>{
  const f=await fixture({bind:false});
  const results=await Promise.all(Array.from({length:20},()=>store.reserveByl(f.row.id,f.row.access_token_hash,1)));
  assert.equal(results.filter(r=>r.created).length,1);assert.equal(new Set(results.map(r=>r.order.payment_id)).size,1);
  const [{count}]=await db`select count(*)::int from byl_orders where report_id=${f.row.id}`;assert.equal(count,1);
});
test('12 concurrent checkout handlers use one mocked creation response with real reservation locking',async()=>{
  const f=await fixture({bind:false});let attempts=0;
  const provider=createByl({projectId:1,signingSecret:'local',transport:async call=>{
    assert.equal(call.method,'POST');attempts++;return {data:{...f.invoice,status:'open'}};
  }});
  const handler=paymentHandler(()=>store,()=>provider);
  const results=await Promise.all(Array.from({length:12},()=>invoke(handler,f.req)));
  assert.equal(attempts,1);assert.ok(results.some(r=>r.code===200));assert.ok(results.every(r=>[200,409].includes(r.code)));
  assert.equal((await invoke(handler,f.req)).body.checkoutUrl,f.url);assert.equal(attempts,1);
});
test('concurrent invoice bindings cannot reuse one project/invoice across reports',async()=>{
  const a=await fixture({bind:false}),b=await fixture({bind:false});
  for(const f of [a,b])await store.reserveByl(f.row.id,f.row.access_token_hash,1);
  const results=await Promise.allSettled([store.bindByl(a.row.id,a.id,1,a.url),store.bindByl(b.row.id,a.id,1,a.url)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const [{count}]=await db`select count(*)::int from byl_orders where provider_invoice_id=${a.id} and project_id=1`;assert.equal(count,1);
});
test('wrong owner, expired report, project and NULL binding arguments fail without changing state',async()=>{
  const f=await fixture({bind:false});
  await assert.rejects(store.reserveByl(f.row.id,'wrong',1));
  await db`update reports set expires_at=now()-interval '1 second' where id=${f.row.id}`;
  await assert.rejects(store.reserveByl(f.row.id,f.row.access_token_hash,1));
  await db`update reports set expires_at=now()+interval '1 day' where id=${f.row.id}`;
  await store.reserveByl(f.row.id,f.row.access_token_hash,1);
  await assert.rejects(store.reserveByl(f.row.id,f.row.access_token_hash,2));
  for(const [invoice,project,url] of [[null,1,f.url],[f.id,null,f.url],[f.id,1,null],[f.id,1,'https://evil.example']])
    await assert.rejects(store.bindByl(f.row.id,invoice,project,url));
  assert.equal((await store.findBylOrder(f.row.id)).status,'creating');
});
test('20 duplicate webhook RPCs produce one event and one verified payment',async()=>{
  const f=await fixture();const results=await Promise.all(Array.from({length:20},()=>store.settleByl(f.value)));
  assert.equal(results.filter(r=>r.duplicate).length,19);
  const state=await snapshot(f);assert.equal(state.events.length,1);assert.equal(state.payments.length,1);
  assert.equal(state.report.status,'paid');assert.equal(state.order.status,'paid');assert.ok(state.report.paid_at);
});
test('event replay against another invoice rolls back its order, ledger and report',async()=>{
  const a=await fixture(),b=await fixture();await store.settleByl(a.value);
  await assert.rejects(store.settleByl({...b.value,eventId:a.value.eventId}));
  const state=await snapshot(b);assert.equal(state.order.status,'open');assert.equal(state.report.status,'unpaid');assert.equal(state.payments.length,0);assert.equal(state.events.length,0);
});
test('signed duplicate webhook handlers verify mocked Byl but persist through actual PostgreSQL',async()=>{
  const f=await fixture();const handler=webhookHandler(()=>store,()=>f.provider);
  const rawBody=Buffer.from(JSON.stringify({id:Number(f.value.eventId),project_id:1,type:'invoice.paid',object:'invoice',data:{object:{id:Number(f.id)}}}));
  const req={method:'POST',rawBody,headers:{'byl-signature':createHmac('sha256','local-only-signing-secret').update(rawBody).digest('hex')}};
  const results=await Promise.all(Array.from({length:10},()=>invoke(handler,req)));
  assert.ok(results.every(r=>r.code===200));const state=await snapshot(f);assert.equal(state.events.length,1);assert.equal(state.payments.length,1);
});
test('actual paid report authorization requires owner and expiry; void revokes access',async()=>{
  const f=await fixture();await store.settleByl(f.value);
  const handler=reportHandler(()=>store),req={...f.req,method:'GET',url:`/api/report?id=${f.row.id}`};
  assert.deepEqual((await invoke(handler,req)).body.report,report);
  assert.equal((await invoke(handler,{...req,headers:{}})).code,404);
  await db`update reports set expires_at=now()-interval '1 second' where id=${f.row.id}`;
  assert.equal((await invoke(handler,req)).code,404);
  await db`update reports set expires_at=now()+interval '1 day' where id=${f.row.id}`;
  await store.settleByl({...f.value,status:'void',eventId:String(++eventId)});
  const state=await snapshot(f);assert.equal(state.report.status,'unpaid');assert.equal(state.report.paid_at,null);assert.equal(state.payments[0].status,'refunded');
  assert.equal((await invoke(handler,req)).code,402);
});
test('concurrent paid/void transactions and delayed paid confirmations cannot restore void access',async()=>{
  const f=await fixture();
  await Promise.all([store.settleByl(f.value),store.settleByl({...f.value,status:'void',eventId:String(++eventId)})]);
  assert.deepEqual(await store.settleByl({...f.value,eventId:String(++eventId)}),{status:'void'});
  assert.equal(await store.hasVerifiedPayment(f.row.id),false);assert.equal(await store.readPaidReport(f.row.id,f.row.access_token_hash),null);
});
test('legacy QPay and unrelated paid Byl rows cannot bypass a revoked Byl order',async()=>{
  const f=await fixture();await store.settleByl({...f.value,status:'void'});
  for(const provider of ['qpay','byl'])await db`insert into payments(id,report_id,provider,provider_invoice_id,amount_mnt,status,verified_at)
    values(${randomUUID()},${f.row.id},${provider},'unrelated',6900,'paid',now())`;
  await db`update reports set status='paid' where id=${f.row.id}`;
  assert.equal(await store.hasVerifiedPayment(f.row.id),false);assert.equal(await store.readPaidReport(f.row.id,f.row.access_token_hash),null);
  assert.equal((await invoke(reportHandler(()=>store),{...f.req,method:'GET',url:`/api/report?id=${f.row.id}`})).code,402);
});
test('ledger mismatches and post-preflight revocation cannot leak full JSON',async()=>{
  const f=await fixture();await store.settleByl(f.value);
  await db`update payments set provider_invoice_id='wrong' where report_id=${f.row.id}`;
  assert.equal(await store.hasVerifiedPayment(f.row.id),false);
  await db`update payments set provider_invoice_id=${f.id} where report_id=${f.row.id}`;
  assert.equal(await store.hasVerifiedPayment(f.row.id),true);
  await store.settleByl({...f.value,status:'void',eventId:String(++eventId)});
  // Even if a caller observed paid before revocation, final RPC rechecks the join.
  await db`update reports set status='paid' where id=${f.row.id}`;
  assert.equal(await store.readPaidReport(f.row.id,f.row.access_token_hash),null);
});
test('injected ledger write failure rolls back event/order/report and allows the same event to recover',async()=>{
  const f=await fixture();
  await db.unsafe(`create function public.byl_test_fail() returns trigger language plpgsql as $$ begin
    if new.report_id='${f.row.id}'::uuid then raise exception 'injected ledger failure'; end if; return new; end $$;
    create trigger byl_test_failure before insert or update on payments for each row execute function public.byl_test_fail();`);
  try{
    await assert.rejects(store.settleByl(f.value));const state=await snapshot(f);
    assert.equal(state.order.status,'open');assert.equal(state.report.status,'unpaid');assert.equal(state.events.length,0);assert.equal(state.payments.length,0);
  }finally{await db.unsafe('drop trigger byl_test_failure on payments; drop function public.byl_test_fail()');}
  assert.deepEqual(await store.settleByl(f.value),{status:'paid'});assert.equal((await snapshot(f)).events.length,1);
});
test('explicit transaction rollback leaves no event or payment and does not consume reservation',async()=>{
  const f=await fixture({bind:false});
  await assert.rejects(db.begin(async tx=>{
    await tx`select reserve_byl_invoice(${f.row.id},${f.row.access_token_hash},1)`;throw Error('rollback reservation');
  }),/rollback reservation/);
  assert.equal(await store.findBylOrder(f.row.id),null);
  assert.equal((await store.reserveByl(f.row.id,f.row.access_token_hash,1)).created,true);
  await store.bindByl(f.row.id,f.id,1,f.url);
  await assert.rejects(db.begin(async tx=>{
    await tx`select settle_byl_invoice(${f.row.id},${f.id},1,'paid',6900,${f.value.eventId})`;throw Error('rollback settlement');
  }),/rollback settlement/);
  const state=await snapshot(f);assert.equal(state.order.status,'open');assert.equal(state.events.length,0);assert.equal(state.payments.length,0);
});
test('failed revocation after ledger update rolls back every write and the same event can be retried',async()=>{
  const f=await fixture();await store.settleByl(f.value);
  const revoke={...f.value,status:'void',eventId:String(++eventId)};
  await db.unsafe(`create function public.byl_test_report_fail() returns trigger language plpgsql as $$ begin
    if new.id='${f.row.id}'::uuid and new.status='unpaid' then raise exception 'injected final report failure'; end if; return new; end $$;
    create trigger byl_test_report_failure before update on reports for each row execute function public.byl_test_report_fail();`);
  try{
    await assert.rejects(store.settleByl(revoke));const state=await snapshot(f);
    assert.equal(state.order.status,'paid');assert.equal(state.report.status,'paid');assert.equal(state.payments[0].status,'paid');
    assert.equal(state.events.length,1);assert.equal(state.events[0].event_id,f.value.eventId);
  }finally{await db.unsafe('drop trigger byl_test_report_failure on reports; drop function public.byl_test_report_fail()');}
  assert.deepEqual(await store.settleByl(revoke),{status:'void'});assert.equal(await store.hasVerifiedPayment(f.row.id),false);
});
test('conflicting payment primary key is rejected and transaction changes roll back',async()=>{
  const f=await fixture(),other=await fixture();const order=await store.findBylOrder(f.row.id);
  await db`insert into payments(id,report_id,provider,provider_invoice_id,amount_mnt,status) values(${order.payment_id},${other.row.id},'qpay','other',6900,'pending')`;
  await assert.rejects(store.settleByl(f.value));const state=await snapshot(f);
  assert.equal(state.order.status,'open');assert.equal(state.events.length,0);assert.equal(state.report.status,'unpaid');
});
test('browser roles cannot read or mutate payment tables, invoke RPCs or bypass enabled RLS',async()=>{
  const f=await fixture();
  for(const role of ['anon','authenticated']){
    for(const table of ['reports','payments','byl_orders','byl_events']){
      assert.ok([401,403].includes((await rest('/'+table,undefined,role)).status));
      const payload=table==='byl_events'?{event_id:'forged',project_id:1,report_id:f.row.id}:{status:'paid'};
      const mutation=await rest('/'+table,payload,role);
      assert.ok([401,403].includes(mutation.status),role+' '+table+' '+JSON.stringify(mutation));
    }
    for(const [name,body] of [
      ['reserve_byl_invoice',{p_report:f.row.id,p_hash:f.row.access_token_hash,p_project:1}],
      ['bind_byl_invoice',{p_report:f.row.id,p_invoice:f.id,p_project:1,p_url:f.url}],
      ['settle_byl_invoice',{p_report:f.row.id,p_invoice:f.id,p_project:1,p_status:'paid',p_amount:6900,p_event:null}],
      ['has_verified_byl_payment',{p_report:f.row.id}],['read_byl_report',{p_report:f.row.id,p_hash:f.row.access_token_hash}],
      ['claim_byl_verification',{p_report:f.row.id}]]){
      assert.ok([401,403,404].includes((await rest('/rpc/'+name,body,role)).status),role+' '+name);
    }
    // Separately prove RLS denies rows even if SELECT were accidentally granted.
    await db.unsafe(`grant select on public.byl_orders to ${role}`);
    try{assert.deepEqual((await rest('/byl_orders',undefined,role)).body,[]);}finally{await db.unsafe(`revoke select on public.byl_orders from ${role}`);}
  }
});
test('20 polling claims across database sessions permit one provider verification per cooldown',async()=>{
  const f=await fixture();const results=await Promise.all(Array.from({length:20},()=>store.claimBylVerification(f.row.id)));
  assert.equal(results.filter(Boolean).length,1);
  const denied=await invoke(statusHandler(()=>store,()=>f.provider),f.req);assert.equal(denied.code,429);assert.equal(denied.headers['Retry-After'],'10');
  await db`update byl_orders set next_verify_at=now()-interval '1 second' where report_id=${f.row.id}`;
  assert.equal((await invoke(statusHandler(()=>store,()=>f.provider),f.req)).body.paid,true);
});
test('ambiguous POST recovery retrieves by reference and binds the existing invoice without another POST',async()=>{
  const f=await fixture({bind:false});let posts=0;
  const ambiguous=createByl({projectId:1,signingSecret:'local-only-signing-secret',transport:async call=>{
    if(call.method==='POST'){posts++;throw Error('ambiguous timeout after provider accepted request');}
    assert.ok(call.path.includes('/by-client-reference-id/')||call.path.endsWith('/'+f.id));return {data:f.invoice};
  }});
  const handler=paymentHandler(()=>store,()=>ambiguous);
  assert.equal((await invoke(handler,f.req)).code,503);assert.equal((await invoke(handler,f.req)).code,409);assert.equal(posts,1);
  const recovered=await reconcileByl(store,ambiguous,f.row.id);assert.equal(recovered.provider_invoice_id,f.id);assert.equal(recovered.status,'paid');
  assert.equal(posts,1);assert.equal(await store.hasVerifiedPayment(f.row.id),true);
});
test('failed reconciliation never frees the reservation or retries creation',async()=>{
  const f=await fixture({bind:false});await store.reserveByl(f.row.id,f.row.access_token_hash,1);
  const provider=createByl({projectId:1,signingSecret:'local',transport:async call=>{assert.equal(call.method,'GET');throw Error('404 or unavailable');}});
  await assert.rejects(reconcileByl(store,provider,f.row.id));
  assert.equal((await store.findBylOrder(f.row.id)).status,'creating');assert.equal((await store.reserveByl(f.row.id,f.row.access_token_hash,1)).created,false);
});
