import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {useNavigate} from 'react-router-dom';
import {Search,X,ChevronRight} from 'lucide-react';
import {getCustomers,getJobsFiltered,getQuotes} from '../store/data';
import {useDataRefresh} from '../hooks/useDataRefresh';
import {useAuth} from '../contexts/AuthContext';
import {useProfile} from '../contexts/UserProfileContext';
import {searchAppRecords} from '../lib/appSearch';

export default function GlobalSearch({open,onClose}) {
  useDataRefresh();
  const navigate=useNavigate(),{user}=useAuth(),{isAM,displayName}=useProfile() || {};
  const [query,setQuery]=useState(''),[active,setActive]=useState(0);
  const inputRef=useRef(null),dialogRef=useRef(null);
  const key=`lusso.search-recent:${user?.id}`;
  const records={customers:getCustomers(),jobs:getJobsFiltered(isAM,displayName),quotes:getQuotes()};
  const results=searchAppRecords(records,query);
  let recent=[];
  try {const saved=JSON.parse(localStorage.getItem(key) || '[]');recent=Array.isArray(saved)?saved:[];}catch{/* private mode */}
  // Resolve stored ids against current records so deleted or inaccessible records never reappear.
  const allowed=new Map([...records.jobs.filter(j=>!j.deletedAt).map(j=>[`job:${j.id}`,`/jobs/${j.id}`]),...records.customers.filter(c=>!c.deletedAt).map(c=>[`customer:${c.id}`,`/customers/${c.id}`]),...records.quotes.filter(q=>!q.deletedAt && records.jobs.some(j=>j.id===q.jobId)).map(q=>[`quote:${q.id}`,`/jobs/${q.jobId}?section=quote&quote=${encodeURIComponent(q.id)}&mode=review`])]);
  const shown=query.trim()?results:recent.filter(r=>allowed.has(r.key)).map(r=>({...r,to:allowed.get(r.key)})).slice(0,8);
  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement;
    inputRef.current?.focus();
    return()=>{if(previous?.isConnected)previous.focus();};
  },[open]);
  useEffect(()=>{
    if(open)dialogRef.current?.querySelector('[data-search-active="true"]')?.scrollIntoView({block:'nearest'});
  },[active,open]);
  const choose=result=>{
    try{localStorage.setItem(key,JSON.stringify([result,...recent.filter(r=>r.key!==result.key)].slice(0,8)));}catch{/* private mode */}
    onClose();navigate(result.to);
  };
  if(!open)return null;
  return createPortal(<div className="fixed inset-0 z-[120] p-3 sm:pt-[12vh] flex items-start justify-center" style={{background:'rgba(15,23,42,.55)'}} onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="Search the app" className="w-full max-w-2xl rounded-2xl border border-slate-200 shadow-2xl overflow-hidden" style={{background:'var(--card,var(--lusso-paper-pure,#fff))'}} onKeyDown={e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}
      if(e.key==='ArrowDown'){e.preventDefault();setActive(i=>Math.min(i+1,shown.length-1));}
      if(e.key==='ArrowUp'){e.preventDefault();setActive(i=>Math.max(i-1,0));}
      if(e.key==='Enter' && e.target===inputRef.current && shown[active]){e.preventDefault();choose(shown[active]);}
      if(e.key==='Tab'){const controls=[...dialogRef.current.querySelectorAll('input,button')];const first=controls[0],last=controls.at(-1);if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}}
    }}>
      <div className="flex gap-3 items-center p-4 border-b border-slate-200"><Search size={20} className="text-slate-400"/><input ref={inputRef} aria-label="Search customers, projects and quotes" placeholder="Name, project or quote number, address…" value={query} onChange={e=>{setQuery(e.target.value);setActive(0);}} className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-900"/><button aria-label="Close search" onClick={onClose} className="p-2"><X size={18}/></button></div>
      <p className="px-4 pt-3 text-xs text-slate-500">{query.trim()?`${shown.length} results`:'Recently opened from search'}</p>
      <div className="max-h-[60dvh] overflow-y-auto p-2" aria-live="polite">{shown.length?shown.map((r,i)=><button key={r.key} data-search-active={active===i?'true':undefined} onClick={()=>choose(r)} onFocus={()=>setActive(i)} className={`w-full flex items-center gap-3 p-3 text-left rounded-xl ${active===i?'bg-amber-50':'hover:bg-slate-50'}`}><span className="text-[10px] uppercase tracking-wide text-slate-500 w-14 shrink-0">{r.kind}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-900 truncate">{r.label}</span><span className="block text-xs text-slate-500 truncate">{r.meta}</span></span><ChevronRight size={15}/></button>):<p className="px-3 py-8 text-sm text-slate-500 text-center">{query.trim()?'No matches. Try a name, address or number.':'Search for a customer, project or quote to get started.'}</p>}</div>
      <p className="border-t border-slate-200 p-3 text-xs text-slate-500">↑ ↓ to select · Enter to open · Esc to close</p>
    </section>
  </div>,document.body);
}
