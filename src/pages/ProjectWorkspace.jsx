import DeliveryChecklist from '../components/project/DeliveryChecklist';
import {useCallback,useEffect,useMemo,useState} from 'react';
import {useNavigate,useParams,useSearchParams,Link} from 'react-router-dom';
import {X,User,StickyNote,MessageSquare,Files,Mic,Briefcase,ClipboardList,FileText,PackageCheck,ChevronRight} from 'lucide-react';
import {useAuth} from '../contexts/AuthContext';
import {ProjectWorkspaceContext} from '../contexts/ProjectWorkspaceContext';
import {useDataRefresh} from '../hooks/useDataRefresh';
import {getJob,getCustomer,getMeasureSheetsByJob,getQuotesByJob,getTakeoffByJob,getPurchaseOrdersByJob,getNotes,isTaskOpen,JOB_STATUSES,updateJobStatus} from '../store/data';
import {projectNextAction,projectWorkspaceUrl,PROJECT_SECTIONS} from '../lib/projectWorkspace';
import {readQuoteSession} from '../lib/quoteSession';
import {quoteDocUrl} from '../lib/quoteDocs';
import StatusBadge from '../components/StatusBadge';
import JobProfile from './JobProfile';
import PurchaseOrder from './PurchaseOrder';
import PurchaseOrderView from './PurchaseOrderView';
import ProjectMeasurements from '../components/project/ProjectMeasurements';
import ProjectQuotes from '../components/project/ProjectQuotes';
import ProjectCustomerPanel from '../components/project/ProjectCustomerPanel';
import KeepProjectPanel from '../components/project/KeepProjectPanel';
import ProjectScope from '../components/project/ProjectScope';

const sections=[['overview','Overview',Briefcase],['measurements','Measurements',ClipboardList],['quote','Quote',FileText],['delivery','Orders & installation',PackageCheck]];
const tools=[['customer','Customer',User],['notes','Notes',StickyNote],['comms','Messages',MessageSquare],['documents','Documents',Files],['consults','Consultations',Mic]];
function readState(key){try{return JSON.parse(localStorage.getItem(key)) || {};}catch{return {};}}
export default function ProjectWorkspace(){const {id}=useParams();return <ProjectWorkspaceForJob key={id} jobId={id}/>;}
function ProjectWorkspaceForJob({jobId}){
 useDataRefresh();const {user}=useAuth();const navigate=useNavigate();const [params]=useSearchParams();
 const job=getJob(jobId),customer=getCustomer(job?.customerId);
 const sheets=getMeasureSheetsByJob(jobId).filter(s=>!s.deletedAt),quotes=getQuotesByJob(jobId).filter(q=>!q.deletedAt);
 const cacheKey=`ui.project-workspace.v1:${user?.id}:${jobId}`;
 const [initial]=useState(()=>{const saved=readState(cacheKey);const request=readQuoteSession(localStorage,user?.id,jobId).currentRun;return {...saved,...(!Object.hasOwn(saved,'ai') && ['running','starting','needs_input'].includes(request?.status)?{ai:'1'}:{})};});
 const search=params.toString();
 const state=useMemo(()=>{const value={section:'overview',view:'cards',mode:'review',ai:'0',delivery:'orders',...initial,...Object.fromEntries(new URLSearchParams(search))};if(!PROJECT_SECTIONS.includes(value.section))value.section='overview';return value;},[initial,search]);
 const go=useCallback(patch=>navigate(projectWorkspaceUrl(jobId,{...state,...patch})),[navigate,jobId,state]);
 const customerId=job?.customerId;
 const openPanel=useCallback(panel=>go({panel}),[go]);
 const context={jobId,customerId,params:{id:jobId,jobId},search,openPanel,state};
 useEffect(()=>{try{localStorage.setItem(cacheKey,JSON.stringify({...state,panel:''}));}catch{/* private mode */}},[cacheKey,state]);
 useEffect(()=>{if(!state.panel)return;const close=e=>{if(e.key==='Escape')go({panel:''});};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[state.panel,go]);
 if(!job || job.deletedAt)return <div className="p-6">Project not found. <Link to="/jobs" className="underline">Back to Projects</Link></div>;
 const next=projectNextAction(job,sheets,quotes),notes=getNotes({jobId}).filter(isTaskOpen).length;
 const plan=getTakeoffByJob(jobId),orders=getPurchaseOrdersByJob(jobId);
 const openNext=()=>go({section:next.section,...(next.section==='measurements'?{view:'cards'}:{}),...(next.sheetId?{sheet:next.sheetId}:{}),...(next.quoteId?{quote:next.quoteId}:{}),...(next.ai?{ai:'1'}:{})});
 return <ProjectWorkspaceContext.Provider value={context}><div className="project-workspace mx-auto max-w-[1600px] p-3 sm:p-5 space-y-4">
  <header className={`project-workspace-header relative top-0 z-30 rounded-xl border border-slate-200 bg-white shadow-sm`}>
   <div className="px-4 pt-3"><Link to="/jobs" className="inline-flex items-center gap-1 text-xs text-slate-500">Projects <ChevronRight size={12}/></Link><span className="ml-2 text-xs font-medium text-slate-500">{job.jobNumber}</span></div>
   <div className="px-4 py-3 flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold text-slate-900">{customer?.name || 'Project'}</h1><StatusBadge status={job.status}/><details className="relative"><summary className="cursor-pointer text-xs text-slate-500">Actions</summary><div className="absolute z-40 top-full left-0 mt-2 w-64 rounded-xl border bg-white p-3 shadow-lg"><label className="block text-xs font-medium text-slate-500">Project status<select aria-label="Project status" className="mt-1 w-full rounded-lg border p-2 text-sm" value={job.status} onChange={e=>updateJobStatus(jobId,e.target.value,'Staff')}>{JOB_STATUSES.map(status=><option key={status}>{status}</option>)}</select></label></div></details></div><p className="mt-1 text-xs text-slate-500">Installation: {job.siteAddress || customer?.address || 'Address needed'}{job.assignedStaff?` · ${job.assignedStaff}`:''}</p></div><button onClick={openNext} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white">{next.label}</button></div>
   <nav aria-label="Project sections" className="grid grid-cols-4 border-t border-slate-100">{sections.map(([key,label,Icon])=><button key={key} aria-label={label} aria-current={state.section===key?'page':undefined} onClick={()=>go({section:key})} className={`flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 px-1 sm:px-2 py-3 text-xs sm:text-sm border-b-2 ${state.section===key?'border-amber-500 bg-amber-50 text-amber-800 font-semibold':'border-transparent text-slate-500'}`}><Icon size={15}/><span className="sm:hidden">{key==='measurements'?'Measure':key==='delivery'?'Orders':label}</span><span className="hidden sm:inline">{label}</span></button>)}</nav>
   <div className="project-shared-tools flex gap-1 px-3 py-1 border-t border-slate-100 overflow-x-auto">{tools.map(([key,label,Icon])=><button key={key} aria-expanded={state.panel===key} onClick={()=>go({panel:state.panel===key?'':key})} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"><Icon size={13}/>{label}{key==='notes' && notes>0?` (${notes})`:''}</button>)}</div>
  </header>
  <KeepProjectPanel active={state.section==='overview'}><JobProfile embedded tab="overview" onTabChange={tab=>go({section:tab==='measures'?'measurements':tab==='quotes'?'quote':tab==='orders' || tab==='install'?'delivery':'overview',panel:['notes','comms','consults'].includes(tab)?tab:''})}/></KeepProjectPanel>
  <KeepProjectPanel active={state.section==='measurements'}><ProjectMeasurements job={job} sheets={sheets} state={state} go={go}/></KeepProjectPanel>
  <KeepProjectPanel active={state.section==='quote'}><ProjectQuotes job={job} quotes={quotes} state={state} go={go}/></KeepProjectPanel>
  <KeepProjectPanel active={state.section==='delivery'}><div className="space-y-4"><DeliveryChecklist job={job} quotes={quotes} sheets={sheets} orders={orders} go={go}/><div className="flex gap-2"><button className="rounded-lg border px-3 py-2 text-sm" aria-pressed={state.delivery==='orders'} onClick={()=>go({delivery:'orders',order:''})}>Orders ({orders.length})</button><button className="rounded-lg border px-3 py-2 text-sm" aria-pressed={state.delivery==='install'} onClick={()=>go({delivery:'install',order:''})}>Installation</button></div>{state.order==='new' && state.sheet?<ProjectScope params={{id:state.sheet}}><PurchaseOrder/></ProjectScope>:state.order?<ProjectScope params={{id:state.order}}><PurchaseOrderView/></ProjectScope>:<JobProfile embedded tab={state.delivery==='install'?'install':'orders'} onTabChange={tab=>go({section:tab==='measures'?'measurements':'delivery',delivery:tab==='install'?'install':'orders'})}/>}</div></KeepProjectPanel>
  {state.panel && <div className="fixed inset-0 z-[80] bg-slate-900/30" onClick={()=>go({panel:''})}><aside role="dialog" aria-modal="true" aria-label={tools.find(t=>t[0]===state.panel)?.[1] || 'Project details'} onClick={e=>e.stopPropagation()} className="absolute right-0 top-0 bottom-0 w-full max-w-xl bg-white shadow-xl overflow-y-auto p-5 project-tool-drawer"><div className="flex items-center justify-between mb-5"><h2 className="font-semibold text-lg">{tools.find(t=>t[0]===state.panel)?.[1]}</h2><button aria-label="Close project panel" onClick={()=>go({panel:''})}><X size={20}/></button></div>{state.panel==='customer'?<ProjectCustomerPanel customer={customer} job={job}/>:state.panel==='documents'?<div className="space-y-4"><p className="text-sm text-slate-500">Plans and customer documents from this project’s quotes.</p>{plan?.filePath && <button onClick={()=>go({panel:'',section:'measurements',view:'plan'})} className="block rounded-lg border p-3 text-sm">Open project plans</button>}{quotes.flatMap(q=>(q.documents || []).map(d=><a key={`${q.id}:${d.id}`} target="_blank" rel="noreferrer" href={quoteDocUrl(d)} className="block rounded-lg border p-3"><span className="text-sm font-medium">{d.name || 'Document'}</span><span className="block text-xs text-slate-500">{q.quoteNumber}</span></a>))}{!plan?.filePath && !quotes.some(q=>q.documents?.length) && <p className="text-sm text-slate-500">No documents yet. Add plans in Measurements or attach customer documents to a draft quote.</p>}</div>:<JobProfile key={state.panel} embedded tab={state.panel} onTabChange={tab=>go({panel:tab})}/>}</aside></div>}
 </div></ProjectWorkspaceContext.Provider>;
}
