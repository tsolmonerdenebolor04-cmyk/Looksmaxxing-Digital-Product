import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { report } from './fixtures.mjs';
import { publicPreview } from '../lib/report.mjs';

const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const id='00000000-0000-4000-8000-000000000001';
const key='glowup-report-id';
function node(){
  const classes=new Set(['hidden']);
  return {textContent:'',disabled:false,children:[],classList:{add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x)},
    append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},scrollIntoView(){}};
}
async function browser(storage,fetcher){
  const elements=new Map(),calls=[];
  const context=vm.createContext({
    document:{body:node(),getElementById(name){if(!elements.has(name))elements.set(name,node());return elements.get(name)},querySelectorAll:()=>[],createElement:node},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    window:{scrollTo(){}},fetch:async(url,options)=>{calls.push({url,options});return fetcher(url,options)},
    navigator:{},console
  });
  vm.runInContext(source,context);await vm.runInContext('recoveryReady',context);
  return {elements,calls,context};
}
test('refresh and reopened page recover an unpaid preview without storing report contents',async()=>{
  const storage=new Map([[key,id]]);
  for(let refresh=0;refresh<2;refresh++){
    const {elements,calls}=await browser(storage,async()=>Response.json({reportId:id,preview:publicPreview(report),paid:false}));
    assert.equal(calls.length,1);assert.equal(calls[0].options.credentials,'same-origin');
    assert.equal(calls[0].options.cache,'no-store');
    assert.equal(elements.get('headline').textContent,report.headline);
    assert.equal(elements.get('fullReport').classList.contains('hidden'),true);
    assert.equal(elements.get('sections').children.length,0);
    assert.deepEqual([...storage],[[key,id]]);
  }
});
test('paid recovery fetches full report through the separately authorized report endpoint',async()=>{
  const {elements,calls}=await browser(new Map([[key,id]]),async url=>Response.json(url.startsWith('/api/recover')?
    {reportId:id,preview:publicPreview(report),paid:true}:{report}));
  assert.equal(calls.length,2);assert.ok(calls[1].url.startsWith('/api/report?id='));
  assert.equal(elements.get('fullReport').classList.contains('hidden'),false);
  assert.equal(elements.get('sections').children.length,10);
});
test('expired or unauthorized recovery clears only the saved ID and displays no report',async()=>{
  const storage=new Map([[key,id],['glowup-theme','light']]);
  const {elements}=await browser(storage,async()=>Response.json({error:'Report unavailable'},{status:404}));
  assert.equal(storage.has(key),false);assert.equal(storage.get('glowup-theme'),'light');
  assert.equal(elements.has('sections'),false);
});
test('transient recovery errors preserve the ID for retry; malformed IDs never make requests',async()=>{
  const storage=new Map([[key,id]]);
  let result=await browser(storage,async()=>Response.json({error:'Unavailable'},{status:503}));
  assert.equal(storage.get(key),id);assert.equal(result.elements.has('sections'),false);
  storage.set(key,'invalid');result=await browser(storage,()=>{throw Error('must not fetch')});
  assert.equal(result.calls.length,0);assert.equal(storage.has(key),false);
});
test('payment revocation between recovery and retrieval keeps the full report hidden',async()=>{
  const {elements}=await browser(new Map([[key,id]]),async url=>url.startsWith('/api/recover')?
    Response.json({reportId:id,preview:publicPreview(report),paid:true}):Response.json({error:'Unpaid'},{status:402}));
  assert.equal(elements.get('fullReport').classList.contains('hidden'),true);
  assert.equal(elements.get('sections').children.length,0);
});

test('a newly created report remembers only its ID for the next refresh; restart forgets it',async()=>{
  const storage=new Map();const {context,elements}=await browser(storage,async()=>Response.json({reportId:id,preview:publicPreview(report)}));
  // Exercise the real submission handler while replacing only image compression.
  vm.runInContext("state.photos=[{},{},{}];compress=async()=>({mimeType:'image/jpeg',data:'test'});",context);
  await elements.get('form').onsubmit({preventDefault(){}});
  assert.deepEqual([...storage],[[key,id]]);
  elements.get('restart').onclick();assert.equal(storage.has(key),false);
});
