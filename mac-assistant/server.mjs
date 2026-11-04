import { runStructuredReview, stopStructuredReviews } from './review.mjs';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ORIGINS, RUN_SCHEMA, validId, validateResult, publicRun, sameSheetVersion } from './protocol.mjs';
import { makeQuotingPrompt, QUOTE_SYSTEM } from './prompt.mjs';
import { loadProjectPlans } from './plans.mjs';
const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = process.env.LUSSO_QUOTE_STATE_DIR || resolve(homedir(), 'Library/Application Support/Lusso Quote Assistant');
const workDir = resolve(stateDir, 'workspace');
await mkdir(workDir, { recursive: true, mode: 0o700 });
let env = {};
try { for (const line of (await readFile(resolve(root, '.env.local'), 'utf8')).split('\n')) { const m=line.match(/^([A-Z_]+)=(.*)$/); if(m) env[m[1]]=m[2].trim().replace(/^['"]|['"]$/g,''); } } catch {}
const sbUrl = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const sbKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!sbUrl || !sbKey) throw new Error('Lusso connection settings are missing. Start from the installed Lusso project.');
const claude = process.env.LUSSO_CLAUDE_BIN || resolve(homedir(), 'homebrew/bin/claude');
const runs = new Map();
let active = null;
let reviewing = false;
const guides = await Promise.all(['buz-roller-blinds.md','fha-curtains.md'].map(n=>readFile(resolve(homedir(),'.codex/skills/lusso-quote-from-measure-sheet/references',n),'utf8').catch(()=>'')));
async function persist(run) { run.updatedAt=new Date().toISOString(); await writeFile(resolve(stateDir,`${run.id}.json`),JSON.stringify({...run,process:undefined}),{mode:0o600}); }
for (const name of await readdir(stateDir)) if (/^[\w-]+\.json$/.test(name)) { try { const r=JSON.parse(await readFile(resolve(stateDir,name),'utf8')); if(['running','starting'].includes(r.status)){r.status='needs_input';r.summary='The Mac assistant restarted. Check existing supplier and CRM drafts before continuing.';} runs.set(r.id,r); } catch {} }
async function sb(path,token) { const res=await fetch(`${sbUrl}${path}`,{headers:{apikey:sbKey,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)}); if(!res.ok){const detail=await res.json().catch(()=>({}));throw new Error(res.status===401||res.status===403?'Lusso could not confirm access. Refresh the app and sign in again.':`Lusso could not load the quote data: ${detail.message||res.status}`);}return res.json(); }
async function authorize(req) { const token=(req.headers.authorization||'').replace(/^Bearer /,''); if(!token)throw Object.assign(new Error('Sign in to Lusso first.'),{status:401});const user=await sb('/auth/v1/user',token);const profiles=await sb(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=status`,token); if(profiles[0]?.status!=='active')throw Object.assign(new Error('An active Lusso staff account is required.'),{status:403});return {token,user}; }
async function authStatus(){try{const {stdout}=await exec(claude,['auth','status','--json'],{timeout:15000});return Boolean(JSON.parse(stdout).loggedIn);}catch{return false;}}
async function body(req,limit=48000){let text='';for await(const chunk of req){text+=chunk;if(text.length>limit)throw Object.assign(new Error('This request is too large.'),{status:413});}return text?JSON.parse(text):{};}
function addEvent(run,text){run.events=[...(run.events||[]),{at:new Date().toISOString(),text:String(text).slice(0,1200)}].slice(-40);}
async function start(run, token, answer='', approvedSheetUpdatedAt=null) {
  if(active)throw Object.assign(new Error('Another quote is using Chrome. Finish or stop it first.'),{status:409});
  if(!await authStatus())throw Object.assign(new Error('Sign in to Claude Code on this Mac, then connect Chrome with /chrome. The app has not started supplier work.'),{status:428});
  active=run.id;
  try {
    const [jobs,sheets,quotes,takeoffs]=await Promise.all([
      sb(`/rest/v1/jobs?id=eq.${run.jobId}&select=*`,token),
      sb(`/rest/v1/measure_sheets?id=eq.${run.sheetId}&job_id=eq.${run.jobId}&select=*`,token),
      sb(`/rest/v1/quotes?job_id=eq.${run.jobId}&deleted_at=is.null&select=id,quote_number,status,grand_total`,token),
      sb(`/rest/v1/takeoffs?job_id=eq.${run.jobId}&select=*`,token),
    ]);
    const job=jobs[0],sheet=sheets[0];
    if(!job||job.deleted_at||!sheet||sheet.deleted_at||!(sheet.line_items||[]).length)throw new Error('This job or measure sheet is unavailable or empty. Reload the job.');
    const customers=await sb(`/rest/v1/customers?id=eq.${job.customer_id}&select=name,address`,token);
    if(!customers[0])throw new Error('The customer could not be read.');
    if(answer && !sameSheetVersion(approvedSheetUpdatedAt || run.sheetUpdatedAt,sheet.updated_at))throw new Error('The measure sheet changed while the assistant was waiting. Review and save the current sheet before continuing.');
    run.sheetUpdatedAt=sheet.updated_at;run.status='running';run.summary='Working through the measure sheet and supplier draft.';
    run.questions=[];run.warnings=[];
    addEvent(run,answer?'Continuing with your answers.':'Reading the current job and measure sheet.');
    await persist(run);
    addEvent(run,'Reading uploaded project plans for heights, sections and window schedules.');
    const plans=await loadProjectPlans(takeoffs,{jobId:run.jobId,download:async(path)=>{
      const response=await fetch(`${sbUrl}/storage/v1/object/authenticated/takeoff-plans/${path.split('/').map(encodeURIComponent).join('/')}`,{headers:{apikey:sbKey,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error('The plan could not be downloaded. Inspect it through the project plan viewer.');
      return response.arrayBuffer();
    }});
    await persist(run);
    const args=['--append-system-prompt',QUOTE_SYSTEM,'--chrome','--print','--verbose','--output-format','stream-json','--json-schema',JSON.stringify(RUN_SCHEMA),'--tools','','--allowedTools','mcp__claude-in-chrome__*','--permission-mode','dontAsk','--setting-sources',''];
    if(run.sessionId)args.push('--resume',run.sessionId);
    const child=spawn(claude,args,{cwd:workDir,env:{...process.env,CLAUDECODE:undefined},stdio:['pipe','pipe','pipe']});
    run.process=child;
    let pending='',result=null,stderr='',parseFailed=false;
    child.stderr.on('data',c=>{stderr=(stderr+c).slice(-3000);});
    child.stdout.on('data',chunk=>{pending+=chunk;let cut;while((cut=pending.indexOf('\n'))>=0){const line=pending.slice(0,cut);pending=pending.slice(cut+1);try{const event=JSON.parse(line);if(event.session_id)run.sessionId=event.session_id;
      if(event.type==='assistant')for(const content of event.message?.content||[]){if(content.type==='text')addEvent(run,content.text);if(content.type==='tool_use')addEvent(run,'Working in the supplier or Lusso browser.');}
      if(event.type==='result'){result=event;}
    }catch{parseFailed=true;}}});
    const timer=setTimeout(()=>{if(run.status==='running'){run.status='needs_input';run.summary='The browser task reached its time limit. Check supplier drafts before continuing.';child.kill('SIGTERM');}},45*60*1000);
    const finish=async(code,error)=>{clearTimeout(timer);delete run.process;if(active===run.id)active=null;
      if(run.status==='running'){
        try {if(error||code!==0||result?.is_error)throw new Error('The browser task stopped before a verified draft was returned.');
          const structured=result?.structured_output || (result?.result && JSON.parse(result.result));
          const outcome=validateResult(structured);
          if(outcome.status==='completed'){
            const id=new URL(outcome.draftQuoteUrl).pathname.split('/')[2];
            const actual=await sb(`/rest/v1/quotes?id=eq.${id}&select=id,job_id,status,grand_total,deleted_at`,token);
            if(!actual[0] || actual[0].job_id!==run.jobId || actual[0].deleted_at || String(actual[0].status).toLowerCase()!=='draft'
              || Math.abs(Number(actual[0].grand_total)-outcome.totalIncGst)>0.01)throw new Error('The saved Lusso draft could not be verified against this job and total.');
          }
          Object.assign(run,outcome);
        }catch(e){run.status='needs_input';run.summary=e.message;run.questions=['Check Claude Code sign-in, Chrome connection and supplier permissions, then continue.'];if(stderr||parseFailed)run.warnings=['Browser access may need attention in Claude Code. No completed quote has been verified.'];}
      }
      try{await persist(run);}catch(e){console.error('Could not persist quote status',e.message);}
    };
    let finished=false;const once=(code,error)=>{if(finished)return;finished=true;void finish(code,error);};
    child.on('error',e=>once(null,e));child.on('close',code=>once(code));
    child.stdin.on('error',()=>{});
    child.stdin.end(makeQuotingPrompt({job,customer:customers[0],sheet,quotes,instructions:run.instructions,supplierGuides:guides.join('\n\n'),plans,answer}));
    return run;
  }catch(e){if(active===run.id)active=null;throw e;}
}
const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin;
  if(!ORIGINS.has(origin)){res.writeHead(403);res.end('Only the Lusso app can use this assistant.');return;}
  const cors={'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Private-Network':'true','Cache-Control':'no-store'};
  const send=(status,data)=>{res.writeHead(status,{...cors,'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(req.method==='OPTIONS'){send(204,{});return;}
  try{
    const {token,user}=await authorize(req);const path=new URL(req.url,'http://127.0.0.1').pathname;
    if(req.method==='GET'&&path==='/status'){send(200,{connected:true,signedIn:await authStatus(),busy:Boolean(active)});return;}
    if(req.method==='GET'&&path==='/runs'){const jobId=new URL(req.url,'http://127.0.0.1').searchParams.get('jobId');if(jobId && !validId(jobId))throw new Error('Select a valid project.');send(200,{runs:[...runs.values()].filter(r=>r.userId===user.id && (!jobId || r.jobId===jobId)).map(publicRun).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,30)});return;}
    if(req.method==='POST'&&path==='/runs'){
      const data=await body(req);if(!validId(data.jobId)||!validId(data.sheetId))throw new Error('Select a job and measure sheet.');
      const existing=[...runs.values()].find(r=>r.jobId===data.jobId&&['running','starting','needs_input'].includes(r.status));
      if(existing)throw Object.assign(new Error('This job already has a quote request. Continue or stop that request first.'),{status:409});
      const run={id:randomUUID(),userId:user.id,jobId:data.jobId,sheetId:data.sheetId,instructions:String(data.instructions||'').slice(0,12000),status:'starting',startedAt:new Date().toISOString(),events:[],questions:[],warnings:[]};
      runs.set(run.id,run);try{await start(run,token);}catch(e){runs.delete(run.id);throw e;}send(202,publicRun(run));return;
    }
    if(req.method==='POST' && path==='/reviews') {
      if(reviewing) throw Object.assign(new Error('Another opening review is running. Wait for it to finish.'),{status:409});
      reviewing=true;
      try {
        const data=await body(req,180000);
        if(!validId(data.jobId) || !['specifications','heights'].includes(data.mode) || typeof data.prompt!=='string' || !data.prompt.trim() || data.prompt.length>170000) throw new Error('A current project and a bounded review source are required.');
        const jobs=await sb(`/rest/v1/jobs?id=eq.${data.jobId}&select=id,deleted_at`,token);
        if(!jobs[0] || jobs[0].id!==data.jobId || jobs[0].deleted_at) throw new Error('This project is unavailable.');
        if(!await authStatus()) throw new Error('Sign in to Claude Code on this Mac before reviewing opening specifications.');
        send(200,{result:await runStructuredReview({claude,cwd:workDir,mode:data.mode,prompt:data.prompt})});
      } finally {reviewing=false;}
      return;
    }
    const match=path.match(/^\/runs\/([\w-]+)\/(continue|stop)$/);
    if(req.method==='POST'&&match){const run=runs.get(match[1]);if(!run||run.userId!==user.id)throw Object.assign(new Error('Quote request not found.'),{status:404});
      if(match[2]==='stop'){run.status='cancelled';run.summary='Stopped. Any supplier or CRM draft already saved remains available; nothing has been ordered or sent by this action.';run.process?.kill('SIGTERM');await persist(run);send(200,publicRun(run));return;}
      const data=await body(req);if(run.status!=='needs_input')throw new Error('This request is not waiting for an answer.');
      if(!String(data.answer||'').trim())throw new Error('Enter your answers or instructions before continuing.');
      await start(run,token,String(data.answer).slice(0,12000),data.approvedSheetUpdatedAt);send(202,publicRun(run));return;
    }
    send(404,{error:'Not found'});
  }catch(e){send(e.status||400,{error:e.message||'The Mac assistant could not complete the request.'});}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'The quote assistant is already running on this Mac.':error.message);process.exit(1);});
server.listen(Number(process.env.LUSSO_ASSISTANT_PORT||53146),'127.0.0.1',()=>console.log('Lusso Quote Assistant is running on this Mac. Open a job in Lusso and choose Quote with AI.'));
process.on('SIGTERM',()=>{stopStructuredReviews();for(const r of runs.values())r.process?.kill('SIGTERM');server.close(()=>process.exit());});
