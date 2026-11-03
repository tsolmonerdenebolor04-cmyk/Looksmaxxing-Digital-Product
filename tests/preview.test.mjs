import test from 'node:test';
import assert from 'node:assert/strict';
import { publicPreview } from '../lib/report.mjs';
import { report } from './fixtures.mjs';

test('substantial preview includes narrative, three photo observations, one action and at most one roast',()=>{
  const p=publicPreview(report);
  assert.equal(p.summary,report.summary);
  assert.deepEqual(p.observations,report.observations);
  assert.deepEqual(p.priority,report.priorities[0]);
  assert.deepEqual(p.roast,report.roasts[0]);
  assert.deepEqual(publicPreview(p),p,'creation and recovery must have identical contracts');
});
test('deep allowlist excludes every paid section and additional priorities/roasts even with nested extra data',()=>{
  const r=structuredClone(report);
  for(const key of ['haircuts','barberCard','skin','grooming','wardrobe','photoTips','budget','avoidSpending','weeks','limitations'])r[key]='PAID_ONLY_'+key;
  r.priorities[1]={title:'PAID_PRIORITY_TWO',why:'PAID_WHY',action:'PAID_ACTION'};
  r.priorities[2]={title:'PAID_PRIORITY_THREE'};
  r.roasts.push({joke:'PAID_SECOND_ROAST'});
  r.observations.push({photo:'PAID_EXTRA_OBSERVATION'});
  r.observations[0].privateReport=r;
  r.priorities[0].budget='NESTED_PRIVATE';r.roasts[0].barberCard='NESTED_PRIVATE';
  const p=publicPreview(r),json=JSON.stringify(p);
  assert.ok(!/PAID_|NESTED_PRIVATE/.test(json));
  assert.equal(p.observations.length,3);
  assert.deepEqual(Object.keys(p.priority),['title','why','action']);
  assert.deepEqual(Object.keys(p.roast),['joke','evidence','fix']);
  assert.deepEqual(Object.keys(p.observations[0]),['photo','detail','confidence']);
  assert.deepEqual(report.priorities[0],p.priority);
});
test('old previews recover safely without reading full reports or inventing personalized content',()=>{
  const p=publicPreview({headline:report.headline,score:62,potential:78,scoreNote:'note',insight:'Old observation',roast:'Old joke',report});
  assert.equal(p.summary,'');assert.equal(p.priority,null);
  assert.equal(p.observations[0].detail,'Old observation');assert.equal(p.roast.joke,'Old joke');
  assert.equal(p.barberCard,undefined);
});
test('no roast is invented and object-valued fields cannot smuggle paid content',()=>{
  const p=publicPreview({...report,roasts:[],summary:{weeks:'PRIVATE'},observations:[{photo:'FRONT',detail:{barberCard:'PRIVATE'}}]});
  assert.equal(p.roast,null);assert.equal(p.summary,'');assert.equal(p.observations[0].detail,'');
  assert.ok(!JSON.stringify(p).includes('PRIVATE'));
});
