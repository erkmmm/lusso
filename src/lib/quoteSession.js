const unfinished=new Set(['running','starting','needs_input']);
const runFields=['id','jobId','sheetId','userId','status','summary','questions','warnings','draftQuoteUrl','supplierReference','totalIncGst','startedAt','updatedAt','events'];
export const quoteSessionKey=(userId,jobId)=>userId && jobId?`ui.quote-session.v1:${encodeURIComponent(userId)}:${encodeURIComponent(jobId)}`:null;
export function chooseQuoteRun(runs,userId,jobId){
  return [...runs].filter(r=>r.userId===userId && r.jobId===jobId).sort((a,b)=>Number(unfinished.has(b.status))-Number(unfinished.has(a.status)) || String(b.startedAt).localeCompare(String(a.startedAt)))[0] || null;
}
export function readQuoteSession(storage,userId,jobId){
  try{
    const key=quoteSessionKey(userId,jobId),value=key?JSON.parse(storage.getItem(key)):null;
    if(!value || value.userId!==userId || value.jobId!==jobId)return {};
    if(value.currentRun && (value.currentRun.userId!==userId || value.currentRun.jobId!==jobId))return {};
    return value;
  }catch{return {};}
}
export function writeQuoteSession(storage,userId,jobId,value){
  try{
    const key=quoteSessionKey(userId,jobId);if(!key)return false;
    const current=chooseQuoteRun(value.currentRun?[value.currentRun]:[],userId,jobId);
    const currentRun=current?Object.fromEntries(runFields.filter(k=>current[k]!==undefined).map(k=>[k,current[k]])):null;
    storage.setItem(key,JSON.stringify({...value,userId,jobId,currentRun}));return true;
  }catch{return false;}
}
