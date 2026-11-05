import {isCurtainLine} from '../../lib/poDocument';
import { deliveryOverview } from '../../lib/workflowOverview';
import { getInstallRequestsByJob, getCalendarEventsByJob } from '../../store/data';
import { CheckCircle2, Circle, ChevronRight } from 'lucide-react';

export default function DeliveryChecklist({job,quotes,sheets,orders,go}) {
  const data=deliveryOverview(job,quotes,sheets,orders,getInstallRequestsByJob(job.id),getCalendarEventsByJob(job.id));
  const {accepted,approvedItems,outstanding,issued,received,booked,bookingPending}=data;
  const curtain=outstanding.find(l=>l.source && isCurtainLine(l.source.line));
  const steps=[
    {label:'Customer approval',done:!!accepted,detail:accepted?.quoteNumber || 'Review the customer’s approved version',action:()=>go({section:'quote',...(accepted?{quote:accepted.id,mode:'review'}:{})})},
    {label:'Supplier orders',done:!!accepted && approvedItems.length>0 && !outstanding.length,detail:`${issued.length} issued document${issued.length===1?'':'s'} · ${orders.filter(o=>o.status==='draft').length} drafts`,action:()=>go({delivery:'orders',order:''})},
    {label:'Goods received',done:received,detail:received?'Recorded in project status':'Confirm delivery, then update the project status',action:()=>go({section:'overview'})},
    {label:'Installation booked',done:booked,detail:booked?'Booking or installation recorded':bookingPending?'Request started — check confirmation':'Choose an installer and date',action:()=>go({delivery:'install',order:''})},
  ];
  return <section className="workflow-card p-4 space-y-4" aria-label="Order and installation checklist">
    <div><h2 className="font-semibold text-slate-900">Approval to installation</h2><p className="text-xs text-slate-500 mt-1">Approved items and issued order documents are shown together. Confirm supplier receipt separately.</p></div>
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">{steps.map(step=><button key={step.label} onClick={step.action} className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-left hover:border-amber-400">{step.done?<CheckCircle2 size={17} className="text-green-600 shrink-0"/>:<Circle size={17} className="text-slate-400 shrink-0"/>}<span><span className="block text-sm font-medium">{step.label}</span><span className="block text-xs text-slate-500 mt-1">{step.detail}</span></span></button>)}</div>
    {!!approvedItems.length && <details><summary className="text-sm font-medium cursor-pointer">Approved items · {outstanding.length} need order checking</summary><div className="mt-3 space-y-2">{approvedItems.map(({item,source,ordered})=><div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 text-sm"><div><span className="font-medium">{item.customName || item.displayName || item.productNameSnapshot || item.description || 'Item'}</span><p className="text-xs text-slate-500">{item.location || source?.line.location || 'No room'} · Qty {item.quantity ?? 1}{source?.line.supplier?` · ${source.line.supplier}`:''}</p></div><span className={`text-xs ${ordered?'text-green-600':'text-amber-700'}`}>{ordered?'On an issued order':source?'Check supplier order':'Match to measurements / external order'}</span></div>)}</div></details>}
    {!accepted && <p className="text-xs text-amber-700">{job.status==='Approved'?'Project marked approved. Link or review its accepted quote to check the approved item list.':'An accepted quote will show the customer’s selected items here.'}</p>}
    {curtain && <button onClick={()=>go({delivery:'orders',order:'new',sheet:curtain.source.sheetId})} className="inline-flex items-center gap-1 text-sm font-medium text-amber-700">Prepare curtain order <ChevronRight size={14}/></button>}
  </section>;
}
