import {openingGaps} from './openingWorkflow.js';
export const PROJECT_SECTIONS=['overview','measurements','quote','delivery'];
export const isTestQuote=q=>/^test\b/i.test(String(q.title || '').trim());
export const isDraftQuote=q=>String(q.status).toLowerCase()==='draft';
export function quoteRevision(q){return q.lineItems?.find(l=>l.quoteWorkflow)?.quoteWorkflow || {familyId:q.id,revision:1};}
export function quoteRevisionOverrides(source,newId,nextRevision){
 const old=quoteRevision(source),revision=nextRevision || Number(old.revision || 1)+1;
 const ids=new Map((source.lineItems || []).map(line=>[line.id,newId()]));
 return {
  title:`${String(source.title || '').replace(/\s*\[Revision \d+[^\]]*\]$/,'')} [Revision ${revision} of ${source.quoteNumber}]`,version:revision,
  lineItems:(source.lineItems || []).map(line=>({...line,id:ids.get(line.id),quoteWorkflow:{familyId:old.familyId,parentQuoteId:source.id,revision}})),
  selectedLineItemIds:Array.isArray(source.selectedLineItemIds)?source.selectedLineItemIds.map(id=>ids.get(id)).filter(Boolean):source.selectedLineItemIds,
 };
}
export function quoteGroups(quotes){
 const groups={drafts:[],sent:[],accepted:[],previous:[],tests:[]};
 const valid=quotes.filter(q=>!q.deletedAt).sort((a,b)=>Date.parse(b.updatedAt || b.createdAt || 0)-Date.parse(a.updatedAt || a.createdAt || 0));
 const latest=new Map();for(const q of valid.filter(q=>!isTestQuote(q))){const rev=quoteRevision(q);const old=latest.get(rev.familyId);if(!old || quoteRevision(old).revision<rev.revision)latest.set(rev.familyId,q);}
 for(const q of valid){const rev=quoteRevision(q);if(isTestQuote(q))groups.tests.push(q);else if(latest.get(rev.familyId)?.id!==q.id)groups.previous.push(q);else if(isDraftQuote(q))groups.drafts.push(q);else if(String(q.status).toLowerCase()==='accepted')groups.accepted.push(q);else if(['sent','viewed'].includes(String(q.status).toLowerCase()))groups.sent.push(q);else groups.previous.push(q);}
 return groups;
}
export function projectNextAction(job,sheets,quotes){
 const real=quotes.filter(q=>!q.deletedAt && !isTestQuote(q));
 if(job.status==='Completed')return {label:'Review completed project',section:'delivery',reason:'Installation and project history'};
 if(['Cancelled','Lost'].includes(job.status))return {label:'Review project',section:'overview',reason:job.status};
 if(['Approved','Ordered','Received','Installation Booked','Installed','Rework'].includes(job.status))return {label:'Manage orders & installation',section:'delivery',reason:job.status};
 if(real.some(q=>q.status==='Accepted'))return {label:'Manage orders & installation',section:'delivery',reason:'Quote accepted'};
 const drafts=real.filter(isDraftQuote);
 if(drafts.length){const draft=drafts.sort((a,b)=>Date.parse(b.updatedAt || b.createdAt)-Date.parse(a.updatedAt || a.createdAt))[0];return Number(draft.grandTotal)>0?{label:'Review draft quote',section:'quote',reason:'Draft ready for review',quoteId:draft.id}:{label:'Get supplier prices',section:'quote',reason:'Draft needs pricing',quoteId:draft.id,ai:true};}
 const sent=real.filter(q=>['Sent','Viewed'].includes(q.status)).sort((a,b)=>Date.parse(b.updatedAt || b.createdAt)-Date.parse(a.updatedAt || a.createdAt))[0];
 if(sent)return {label:'Review sent quote',section:'quote',reason:'Waiting for the customer',quoteId:sent.id};
 if(!sheets.length)return {label:'Add measurements',section:'measurements',reason:'No measure sheet yet'};
 const current=[...sheets].sort((a,b)=>Date.parse(b.updatedAt || b.createdAt)-Date.parse(a.updatedAt || a.createdAt))[0];
 const missing=(current.lineItems || []).filter(l=>openingGaps(l).pricing.length);
 if(!current.lineItems?.length || missing.length)return {label:'Finish missing details',section:'measurements',reason:`${missing.length || 1} opening${missing.length===1?' needs':'s need'} details`,sheetId:current.id};
 return {label:'Prepare quote',section:'quote',quoteId:'new',reason:'Measurements recorded'};
}
export function projectWorkspaceUrl(jobId,patch={}){const p=new URLSearchParams();for(const [k,v] of Object.entries(patch))if(v!==undefined && v!==null && v!=='')p.set(k,String(v));return `/jobs/${jobId}${p.size?'?'+p:''}`;}
export function mapProjectDestination(jobId,to){
 if(typeof to!=='string')return to;
 const u=new URL(to,'https://app.lusso.com.au'),p=u.pathname;let match;
 if(p===`/jobs/${jobId}`)return projectWorkspaceUrl(jobId,{section:'overview'});
 if(p===`/jobs/${jobId}/takeoff`)return projectWorkspaceUrl(jobId,{section:'measurements',view:'plan',...Object.fromEntries(u.searchParams)});
 if(p===`/jobs/${jobId}/quote-assistant`)return projectWorkspaceUrl(jobId,{section:'quote',ai:'1'});
 if(p===`/jobs/${jobId}/install`)return projectWorkspaceUrl(jobId,{section:'delivery',delivery:'install'});
 if(p===`/quotes/new-from-job/${jobId}`)return projectWorkspaceUrl(jobId,{section:'quote',quote:'new'});
 if(p==='/quotes/new')return projectWorkspaceUrl(jobId,{section:'quote',quote:'blank',...Object.fromEntries(u.searchParams)});
 if((match=p.match(/^\/quotes\/([^/]+)(\/edit)?$/)))return projectWorkspaceUrl(jobId,{section:'quote',quote:match[1],mode:match[2]?'edit':'review'});
 if(p==='/measure-sheets/import')return projectWorkspaceUrl(jobId,{section:'measurements',view:'import'});
 if(p==='/measure-sheets/new')return projectWorkspaceUrl(jobId,{section:'measurements',sheet:'new',view:'cards'});
 if((match=p.match(/^\/measure-sheets\/([^/]+)(?:\/(edit|openings|purchase-order))?$/))){if(['new','import','recover'].includes(match[1]))return to;return projectWorkspaceUrl(jobId,match[2]==='purchase-order'?{section:'delivery',order:'new',sheet:match[1]}:{section:'measurements',sheet:match[1],view:'cards'});}
 if((match=p.match(/^\/purchase-orders\/([^/]+)$/)))return projectWorkspaceUrl(jobId,{section:'delivery',order:match[1]});
 return to;
}
