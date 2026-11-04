import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const root=new URL('../',import.meta.url);
test('static build never interpolates server credentials and publishes only browser assets',async()=>{
  const sentinel='SERVER_CREDENTIAL_SENTINEL_ONLY';
  await promisify(execFile)(process.execPath,['build.mjs'],{cwd:fileURLToPath(root),env:{...process.env,
    SUPABASE_SECRET_KEY:sentinel,GEMINI_API_KEY:sentinel,STAGING_SUPABASE_SECRET_KEY:sentinel}});
  assert.deepEqual((await readdir(new URL('public/',root))).sort(),['app.js','index.html']);
  for(const name of ['app.js','index.html']){
    const text=await readFile(new URL('public/'+name,root),'utf8');
    assert.ok(!text.includes(sentinel));
    assert.ok(!/SUPABASE_SECRET_KEY|GEMINI_API_KEY|sb_secret_|AIza/.test(text));
  }
});
test('source/config templates contain no credential-shaped values or filled key assignments',async()=>{
  async function scan(directory){
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(['public','node_modules','.git'].includes(entry.name))continue;
      // Real ignored .env files are deliberately never read by this scan.
      if(entry.name.startsWith('.env')&&!entry.name.endsWith('.example'))continue;
      const file=new URL(entry.name+(entry.isDirectory()?'/':''),directory);
      if(entry.isDirectory()){await scan(file);continue}
      const text=await readFile(file,'utf8');
      assert.ok(!/sb_secret_[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text),'Credential-shaped value found in source');
      if(entry.name.endsWith('.example'))assert.ok(!/^\w*(?:SECRET_KEY|API_KEY|PUBLISHABLE_KEY)=.+$/m.test(text),'Filled credential assignment in template');
    }
  }
  await scan(root);
});
