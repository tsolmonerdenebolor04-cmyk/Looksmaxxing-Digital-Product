import test from 'node:test';
import assert from 'node:assert/strict';
import { stagingConfig, stagingOrigin, stagingProject } from '../scripts/staging-config.mjs';

test('staging runner rejects production, arbitrary origins and absent explicit opt-in before credentials',()=>{
  for(const env of [
    {},{RUN_STAGING_INTEGRATION:stagingProject,STAGING_SUPABASE_URL:'https://mteslmtbntnxbqzthjbj.supabase.co'},
    {RUN_STAGING_INTEGRATION:stagingProject,STAGING_SUPABASE_URL:stagingOrigin+'.attacker.example'},
    {RUN_STAGING_INTEGRATION:'yes',STAGING_SUPABASE_URL:stagingOrigin}
  ]){
    Object.defineProperty(env,'STAGING_SUPABASE_SECRET_KEY',{get(){throw Error('credentials must not be read');}});
    assert.throws(()=>stagingConfig(env),/exact approved staging target/);
  }
});
test('staging runner uses only explicitly named staging keys',()=>{
  assert.throws(()=>stagingConfig({RUN_STAGING_INTEGRATION:stagingProject,STAGING_SUPABASE_URL:stagingOrigin,
    SUPABASE_SECRET_KEY:'generic-environment-key'}),/Configure staging keys locally/);
});
