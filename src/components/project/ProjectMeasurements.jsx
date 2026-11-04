import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import NewMeasureSheet from '../../pages/NewMeasureSheet';
import JobTakeoff from '../../pages/JobTakeoff';
import ImportMeasureSheet from '../../pages/ImportMeasureSheet';
import ProjectScope from './ProjectScope';
export default function ProjectMeasurements({job,sheets,state,go}){
 const [opened,setOpened]=useState(new Set());
 const selected=sheets.find(s=>s.id===state.sheet) || [...sheets].sort((a,b)=>Date.parse(b.updatedAt || b.createdAt)-Date.parse(a.updatedAt || a.createdAt))[0];
 const view=state.view || 'cards',creating=state.sheet==='new';
 const planVisible=state.section==='measurements' && view==='plan';
 useEffect(()=>{if(!planVisible)return;const previous=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=previous;};},[planVisible]);
 // Once mounted, cards/table share one editor and changes survive plan switches.
 const needsEditor=view==='cards' || view==='table';
 if(needsEditor && (selected || creating) && !opened.has('editor'))setOpened(new Set([...opened,'editor']));
 if(view==='plan' && !opened.has('plan'))setOpened(new Set([...opened,'plan']));
 return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex rounded-lg border border-slate-200 bg-white p-1">{[['cards','Cards'],['table','Table'],['plan','Plan']].map(([key,label])=><button key={key} type="button" aria-pressed={view===key} onClick={()=>go({section:'measurements',view:key})} className={`rounded-md px-3 py-2 text-sm ${view===key?'bg-amber-100 font-semibold text-amber-900':'text-slate-600'}`}>{label}</button>)}</div><div className="flex gap-2 items-center">{sheets.length>0 && <select aria-label="Measure sheet" className="rounded-lg border border-slate-200 px-3 py-2 text-sm max-w-72" value={creating?'new':selected?.id || ''} onChange={e=>go({sheet:e.target.value})}>{creating && <option value="new">New measure sheet</option>}{sheets.map(s=><option key={s.id} value={s.id}>{s.title || s.name || s.measureDate || 'Measure sheet'} · {s.lineItems?.length || 0} openings</option>)}</select>}<button className="text-xs text-slate-500 underline" onClick={()=>go({sheet:'new',view:'cards'})}>Add sheet</button><button className="text-xs text-slate-500 underline" onClick={()=>go({view:'import'})}>Import</button></div></div>
 {!selected && !creating && view!=='plan' && view!=='import' && <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center"><h2 className="font-semibold">Add the openings for this project</h2><p className="mt-2 text-sm text-slate-500">Measure on site, start from a plan, or import a measure sheet.</p><button onClick={()=>go({sheet:'new',view:'cards'})} className="mt-4 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white">Start measure sheet</button></div>}
 {opened.has('editor') && (selected || creating) && <div hidden={!needsEditor}><ProjectScope params={{id:creating?'new':selected?.id}} search={`?customerId=${job.customerId}&jobId=${job.id}`}><NewMeasureSheet key={creating?'new':selected?.id} routeSheetId={creating?'new':selected?.id} routeSearch={`?customerId=${job.customerId}&jobId=${job.id}`} embedded onSubmitted={saved=>go({sheet:saved.id,view:view==='table'?'table':'cards'})} layout={view==='table'?'table':'cards'}/></ProjectScope></div>}
 {opened.has('plan') && createPortal(<div role="dialog" aria-modal="true" aria-label="Full screen plan takeoff" className="fixed inset-0 z-[70] overflow-hidden" style={{display:planVisible?'block':'none',backgroundColor:'var(--pin-base,var(--surf-card,#f1f5f9))'}}><ProjectScope params={{id:job.id}}><JobTakeoff active={planVisible} onExit={()=>go({view:'cards'})}/></ProjectScope></div>,document.body)}
 {view==='import' && <ProjectScope params={{id:'import'}} search={`?customerId=${job.customerId}&jobId=${job.id}`}><ImportMeasureSheet/></ProjectScope>}
 </div>;
}
