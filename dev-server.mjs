import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import analyze from './api/analyze.mjs';
import report from './api/report.mjs';
import payment from './api/payment.mjs';
import recover from './api/recover.mjs';

const routes = { '/api/analyze': analyze, '/api/report': report, '/api/payment': payment, '/api/recover': recover };
export function createServer() {
 return http.createServer(async (req,res) => {
  res.status=n=>{res.statusCode=n;return res;};
  res.json=obj=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(obj));};
  res.setHeader('Cache-Control','no-store');
  const pathname=new URL(req.url,'http://localhost').pathname;
  const handler=routes[pathname];
  if(handler){
   try {
    if(req.method==='POST'){
     let data='';
     for await(const chunk of req){data+=chunk;if(data.length>10_000_000)return res.status(413).json({error:'Request too large'});}
     req.body=JSON.parse(data||'{}');
    }
    return await handler(req,res);
   }catch{return res.status(400).json({error:'Invalid request'});}
  }
  const file=pathname==='/'?'index.html':pathname.slice(1);
  if(!['index.html','app.js'].includes(file))return res.status(404).json({error:'Not found'});
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
  res.end(await fs.readFile(new URL(file,import.meta.url)));
 });
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 createServer().listen(Number(process.env.PORT||3000),()=>console.log('GLOWUP at http://localhost:'+(process.env.PORT||3000)));
}
