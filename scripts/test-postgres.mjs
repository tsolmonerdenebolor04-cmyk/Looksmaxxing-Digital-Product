// Starts ONLY a fresh local cluster. Never accepts a database URL or loads .env.
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';

const bin=process.env.BYL_TEST_PG_BIN, restBin=process.env.BYL_TEST_POSTGREST_BIN;
if (!bin || !restBin) throw Error('Set BYL_TEST_PG_BIN and BYL_TEST_POSTGREST_BIN to local portable test binaries');
const exec=promisify(execFile), suffix=process.platform==='win32'?'.exe':'';
const restEnv={...Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='path'&&!key.toUpperCase().startsWith('PGRST_'))),
  PATH:resolve(bin)+(process.platform==='win32'?';':':')+(process.env.PATH||process.env.Path||'')};
// pg_ctl starts a descendant server. Ignore inherited pipes so Windows does not
// keep execFile's close event pending until that server itself exits.
const control=args=>new Promise((resolve,reject)=>{
  const child=spawn(join(bin,'pg_ctl'+suffix),args,{windowsHide:true,stdio:'ignore'});
  child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('pg_ctl exit '+code)));
});
const port=async()=>{const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;};
const pgPort=await port(),restPort=await port();
const root=await mkdtemp(join(tmpdir(),'glowup-byl-pg-')),data=join(root,'cluster');
const dbName='byl_regression_'+randomBytes(8).toString('hex');
let started=false,rest,admin;
try {
  await exec(join(bin,'initdb'+suffix),['-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8'],{windowsHide:true});
  await control(['-D',data,'-l',join(root,'postgres.log'),'-w','start','-o',`-h 127.0.0.1 -p ${pgPort} -F`]);started=true;
  admin=postgres({host:'127.0.0.1',port:pgPort,database:'postgres',username:'postgres',max:1});
  await admin.unsafe(`create database ${dbName}`);await admin.end();
  admin=postgres({host:'127.0.0.1',port:pgPort,database:dbName,username:'postgres',max:1});
  await admin.unsafe(await readFile(new URL('../tests/db/schema.sql',import.meta.url),'utf8'));
  const [{version}]=await admin`select version()`;
  console.log(version);
  const jwtSecret=randomBytes(32).toString('hex');
  const config=join(root,'postgrest.conf');
  await writeFile(config,`db-uri = "postgres://authenticator@127.0.0.1:${pgPort}/${dbName}"\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = "${jwtSecret}"\nserver-host = "127.0.0.1"\nserver-port = ${restPort}\n`);
  rest=spawn(resolve(restBin),[config],{windowsHide:true,env:restEnv,stdio:['ignore','ignore','pipe']});
  let errors='';rest.stderr.on('data',chunk=>{errors+=chunk;});
  for(let i=0;i<100;i++){
    if(rest.exitCode!==null)throw Error('PostgREST exit '+rest.exitCode+': '+errors);
    try{await fetch(`http://127.0.0.1:${restPort}/`);break;}catch{await new Promise(r=>setTimeout(r,100));}
  }
  console.log((await exec(resolve(restBin),['--version'],{windowsHide:true,env:restEnv})).stdout.trim());
  const child=spawn(process.execPath,['--test','tests/db/postgres.test.mjs'],{windowsHide:true,stdio:'inherit',env:{...process.env,
    BYL_TEST_LOCAL_RUN:'1',BYL_TEST_DB:dbName,BYL_TEST_PG_PORT:String(pgPort),BYL_TEST_REST_PORT:String(restPort),BYL_TEST_JWT_SECRET:jwtSecret}});
  process.exitCode=await new Promise(r=>child.on('exit',code=>r(code??1)));
} finally {
  if(rest&&rest.exitCode===null){const stopped=new Promise(r=>rest.once('exit',r));rest.kill();await stopped;}
  if(admin)await admin.end().catch(()=>{});
  if(started)await control(['-D',data,'-m','immediate','-w','stop']);
  // Keep logs and disposable data for inspection; no recursive deletion of computed paths.
  console.log('Local-only cluster stopped; diagnostic directory: '+root);
}
