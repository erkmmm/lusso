import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { ORIGINS, validateResult } from '../mac-assistant/protocol.mjs';
import { makeQuotingPrompt } from '../mac-assistant/prompt.mjs';
const valid={status:'completed',summary:'Draft saved',questions:[],warnings:[],draftQuoteUrl:'https://app.lusso.com.au/quotes/quote1/edit',supplierReference:'BUZ 123',totalIncGst:100};
test('completion requires a genuine Lusso draft URL, source reference and positive total',()=>{
 assert.equal(validateResult(valid),valid);
 for(const patch of [{draftQuoteUrl:null},{supplierReference:''},{totalIncGst:0},{draftQuoteUrl:'https://evil.example/quotes/123'}])assert.throws(()=>validateResult({...valid,...patch}));
 assert.equal(ORIGINS.has('https://evil.example'),false);
});
test('browser prompt keeps work on the exact job and asks before uncertain specifications',()=>{
 const p=makeQuotingPrompt({job:{id:'j',job_number:'LUS-1'},customer:{name:'Client'},sheet:{id:'s',line_items:[{id:'a',widthMm:1000}]},quotes:[],instructions:'Double brackets',supplierGuides:'Live supplier instructions'});
 for(const text of ['Never order','sent/accepted','needs_input','Double brackets','1000','Live supplier instructions','Do not fabricate'])assert.ok(p.includes(text),text);
});
test('Mac service authenticates staff, refuses unrelated origins and verifies actual draft results',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lusso-assistant-test-'));
 const fake=join(dir,'fake-claude');
 await writeFile(fake,`#!/usr/bin/env node\nif(process.argv.includes('auth')){console.log(JSON.stringify({loggedIn:true}));process.exit();}\nprocess.stdin.resume();process.stdin.on('end',()=>{console.log(JSON.stringify({type:'result',session_id:'test-session',structured_output:${JSON.stringify(valid)}}));});\n`,{mode:0o700});
 const sb=http.createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.headers.authorization!=='Bearer test'){res.writeHead(401);res.end('{}');return;}
  const u=new URL(req.url,'http://test');
  const out=u.pathname==='/auth/v1/user'?{id:'user'}:u.pathname.endsWith('/profiles')?[{status:'active'}]:u.pathname.endsWith('/jobs')?[{id:'job1',job_number:'LUS-1',customer_id:'customer1'}]:u.pathname.endsWith('/measure_sheets')?[{id:'sheet1',updated_at:'1',line_items:[{id:'a'}]}]:u.pathname.endsWith('/customers')?[{name:'Client',address:'Address'}]:u.searchParams.has('id')?[{id:'quote1',job_id:'job1',status:'Draft',grand_total:100}]:[];
  res.end(JSON.stringify(out));
 });
 sb.listen(0,'127.0.0.1');await once(sb,'listening');
 const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,['mac-assistant/server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,VITE_SUPABASE_URL:`http://127.0.0.1:${sb.address().port}`,VITE_SUPABASE_PUBLISHABLE_KEY:'public',LUSSO_CLAUDE_BIN:fake,LUSSO_QUOTE_STATE_DIR:dir,LUSSO_ASSISTANT_PORT:String(port)},stdio:['ignore','pipe','pipe']});
 try{
  await once(child.stdout,'data');
  const base=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+'/status',{headers:{Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(base+'/status',{headers:{Origin:'https://app.lusso.com.au'}})).status,401);
  const headers={Origin:'https://app.lusso.com.au',Authorization:'Bearer test','Content-Type':'application/json'};
  assert.equal((await fetch(base+'/status',{headers}).then(r=>r.json())).signedIn,true);
  const started=await fetch(base+'/runs',{method:'POST',headers,body:JSON.stringify({jobId:'job1',sheetId:'sheet1'})});assert.equal(started.status,202);
  let run;for(let i=0;i<30;i++){run=(await fetch(base+'/runs',{headers}).then(r=>r.json())).runs[0];if(run.status==='completed')break;await new Promise(r=>setTimeout(r,30));}
  assert.equal(run.status,'completed');assert.equal(run.totalIncGst,100);assert.equal(run.draftQuoteUrl,valid.draftQuoteUrl);
  assert.equal('sessionId' in run,false);assert.equal('instructions' in run,false);
 }finally{child.kill('SIGTERM');await once(child,'exit');await new Promise(r=>sb.close(r));await rm(dir,{recursive:true,force:true});}
});
