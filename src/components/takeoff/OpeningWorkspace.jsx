import OpeningQuestions from './OpeningQuestions';
import MeasureSheetOpeningCard from '../MeasureSheetOpeningCard';
import {resolveMeasureEntry} from '../../lib/measureMath';
import {markLineCheckMeasured,markLinePlanEstimate} from '../../store/data';
import {useRef,useState,useEffect,useImperativeHandle} from 'react';
import {v4 as uuidv4} from 'uuid';
import {X,Loader2,ExternalLink} from 'lucide-react';
import {getMeasureSheetByJob,getMeasureSheet,getMeasureSheetsByJob,getProductTypes,saveOpeningChanges} from '../../store/data';
import {syncNow} from '../../store/db';
import {supabase} from '../../lib/supabase';
import {useDataRefresh} from '../../hooks/useDataRefresh';
import {useProfile} from '../../contexts/UserProfileContext';
import {openingGaps,readiness,previewBulk,hasValue,isScopePlaceholder} from '../../lib/openingWorkflow';
import {suggestOpeningSpecs,readPlanSources,findPlanEvidence,suggestHeightReferences} from '../../lib/openingAI';
import OpeningFields,{Field,inputClass} from './OpeningFields';
import MakeSizeCalculator from './MakeSizeCalculator';
const action='rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40';
const secondary='rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 disabled:opacity-40';
export default function OpeningWorkspace({jobId,sheetId,takeoff,pdf,initialItemId,onClose,onJump,onPlace,onFocusOpening,embeddedInPlan=false,closeRef,savedDraft,onDraftChange,answersOnly=false,onSaved=()=>{},onEditing=()=>{}}) {
  useDataRefresh();
  const editorRoot=useRef(null);
  const sheets=getMeasureSheetsByJob(jobId).filter(s=>!s.deletedAt);
  const [chosenSheetId,setChosenSheetId]=useState(()=>sheetId || (initialItemId?sheets.find(s=>s.lineItems?.some(l=>l.takeoffItemId===initialItemId))?.id:null) || getMeasureSheetByJob(jobId)?.id);
  const candidate=getMeasureSheet(sheetId || chosenSheetId);
  const sheet=candidate?.jobId===jobId?candidate:null;
  const {displayName}=useProfile() || {};
  const restoredDraft=savedDraft?.sheetId===sheet?.id?savedDraft:null;
  const baseline=useRef(restoredDraft?.baseUpdatedAt || sheet?.updatedAt);
  useEffect(()=>{if(!baseline.current && sheet?.updatedAt) baseline.current=sheet.updatedAt;},[sheet?.updatedAt]);
  const [tab,setTab]=useState(restoredDraft?.tab || 'Openings');
  const [showAll,setShowAll]=useState(false);
  const questionsView=answersOnly && !showAll;
  const [expandedSpecs,setExpandedSpecs]=useState(new Set());
  const [otherSpecs,setOtherSpecs]=useState(new Set());
  const [fills,setFills]=useState(restoredDraft?.fills || {});
  const [additions,setAdditions]=useState(restoredDraft?.additions || []);
  const [activeId,setActiveId]=useState(()=>initialItemId?(sheet?.lineItems?.find(l=>l.takeoffItemId===initialItemId)?.id || ''):(restoredDraft?.activeId || ''));
  const [selected,setSelected]=useState(new Set());
  const [filter,setFilter]=useState('');
  const [bulk,setBulk]=useState({});
  const [overwrite,setOverwrite]=useState(false);
  const [bulkPreview,setBulkPreview]=useState(null);
  const [brief,setBrief]=useState(restoredDraft?.brief || '');
  const [suggestions,setSuggestions]=useState([]);
  const [chosen,setChosen]=useState(new Set());
  const [sources,setSources]=useState([]);
  const [query,setQuery]=useState('');
  const [progress,setProgress]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [briefNote,setBriefNote]=useState(restoredDraft?.briefNote || '');
  const [heightSuggestions,setHeightSuggestions]=useState([]);
  const [referenceHeight,setReferenceHeight]=useState('');
  const [referenceBasis,setReferenceBasis]=useState('');
  const types=getProductTypes().filter(p=>p.isActive!==false);
  const stored=[...(sheet?.lineItems || []),...additions];
  const lines=stored.map(l=>({...l,...fills[l.id]}));
  const active=lines.find(l=>l.id===activeId);
  const [previousItemId,setPreviousItemId]=useState(initialItemId);
  if(previousItemId!==initialItemId){
    setPreviousItemId(initialItemId);
    const linked=sheet?.lineItems?.find(l=>l.takeoffItemId===initialItemId);
    if(linked)setActiveId(linked.id);
  }
  const focusLineId=active?.id,focusItemId=active?.takeoffItemId,focusPage=active?.takeoffPage,focusRemoved=active?.takeoffRemoved;
  useEffect(()=>{
    if(focusLineId)onFocusOpening?.({id:focusLineId,takeoffItemId:focusItemId,takeoffPage:focusPage,takeoffRemoved:focusRemoved});
  },[focusLineId,focusItemId,focusPage,focusRemoved,onFocusOpening]);
  useEffect(()=>{
    if(embeddedInPlan && activeId)editorRoot.current?.querySelector(`[data-line-card="${CSS.escape(activeId)}"]`)?.scrollIntoView({block:'nearest'});
  },[activeId,embeddedInPlan]);
  const groups=readiness(lines);
  const dirty=Object.keys(fills).length>0 || additions.length>0 || Boolean(briefNote);
  useEffect(()=>{
    if(!onDraftChange || !sheet?.id)return;
    onDraftChange({sheetId:sheet.id,baseUpdatedAt:baseline.current,fills,additions,briefNote,brief,activeId,tab});
  },[sheet?.id,fills,additions,briefNote,brief,activeId,tab,onDraftChange]);
  useEffect(()=>{if(onDraftChange)onEditing(dirty);},[dirty,onDraftChange,onEditing]);
  useEffect(()=>{if(!dirty)return;const warn=event=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[dirty]);
  function chooseActive(id){setActiveId(id);setReferenceHeight('');setReferenceBasis('');setHeightSuggestions([]);}
  function patch(id,values) {
    setFills(prev=>({...prev,[id]:{...prev[id],...values}}));setBulkPreview(null);setMessage('');onEditing(true);
  }
  function field(id,key,value) {
    const values={[key]:value};
    if(key==='curtainLayers'){
      values.liningMode=value==='Separate sheer and blockout'?'separate':value==='Curtain with attached lining'?'attached':'';
      values.attachedLining=Boolean(values.liningMode);
      if(values.liningMode!=='separate'){values.liningHeading='';values.liningTrackType='';}
    }
    if(key==='widthMm' || key==='dropMm') {
      const current=lines.find(l=>l.id===id);
      if(current?.measureSource==='site' || (current?.source!=='takeoff' && current?.measureSource!=='plan'))values[key==='widthMm'?'widthBasis':'dropBasis']=key==='widthMm'?'Finished track width':'Finished make drop';
      if(current?.makeSizeCalculation) values.makeSizeCalculation={...current.makeSizeCalculation,reviewedAt:null,reviewed:false};
    }
    patch(id,values);
  }
  const toggle=(set,id)=>set(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next;});
  async function save() {
    setBusy(true);setError('');setMessage('');
    try {
      const remote=await supabase.from('measure_sheets').select('updated_at').eq('id',sheet.id).single();
      if(remote.error) throw new Error('Connect to Lusso before confirming the save. Your typed answers remain on this screen.');
      if(Date.parse(remote.data.updated_at)>Date.parse(baseline.current)) throw new Error('The sheet changed elsewhere. Close and reopen this editor to review the newer sheet before applying these answers.');
      const changes={...fills};
      for(const line of lines) if(changes[line.id] || additions.some(a=>a.id===line.id)) {
        if(!String(line.location || '').trim()) throw new Error('Give every opening a room / opening name.');
        if(!Number.isInteger(Number(line.quantity)) || Number(line.quantity)<=0) throw new Error(`Enter a whole positive quantity for ${line.location}.`);
        if(changes[line.id]?.quantity!==undefined) changes[line.id]={...changes[line.id],quantity:Number(changes[line.id].quantity)};
        for(const key of ['widthMm','dropMm']) if(changes[line.id]?.[key]!==undefined && hasValue(changes[line.id][key]) && !(Number(changes[line.id][key])>0)) throw new Error(`Check ${line.location}'s ${key==='widthMm'?'width':'drop'}.`);
      }
      const newLines=additions.map(l=>({...l,...fills[l.id]}));
      const saved=saveOpeningChanges(jobId,changes,{sheetId:sheet.id,baseUpdatedAt:baseline.current,by:displayName,source:'Plan / opening review',newLines,internalNote:briefNote});
      if(saved?.__conflict) throw new Error('A newer sheet was saved. Reopen this editor to compare your answers.');
      baseline.current=saved.updatedAt;
      await syncNow([{table:'measure_sheets',record:saved}]);
      const verify=await supabase.from('measure_sheets').select('updated_at').eq('id',saved.id).single();
      if(verify.error || Date.parse(verify.data.updated_at)!==Date.parse(saved.updatedAt)) throw new Error('Saved on this Mac; the online save could not be confirmed. Check the connection and save again.');
      setFills({});setAdditions([]);setBriefNote('');setMessage('Answers saved and confirmed online.');onEditing(false);onSaved({...saved,updatedAt:verify.data.updated_at});
    } catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  async function analyseBrief() {
    setBusy(true);setError('');setSuggestions([]);setChosen(new Set());
    try {const proposed=await suggestOpeningSpecs(jobId,lines,[{id:'customer-brief',text:brief}]);setSuggestions(proposed);if(!proposed.length)setMessage('No supported changes found. You can fill the remaining decisions in Openings.');}
    catch(e){setError(e.message);} finally{setBusy(false);}
  }
  function applySuggestions() {
    const changed=new Map();
    for(const s of suggestions.filter(s=>chosen.has(s.id) && s.lineId)) for(const [key,value] of Object.entries(s.patch)) {
      const id=`${s.lineId}:${key}`;
      if(changed.has(id) && JSON.stringify(changed.get(id))!==JSON.stringify(value)){setError('Selected proposals disagree on the same field. Choose one answer for each opening before applying.');return;}
      changed.set(id,value);
    }
    for(const suggestion of suggestions.filter(s=>chosen.has(s.id))) {
      const {patch:values,lineId}=suggestion;
      const evidence={source:'Customer brief',excerpt:suggestion.evidence,at:new Date().toISOString()};
      if(lineId) {const line=lines.find(l=>l.id===lineId);patch(lineId,{...values,briefEvidence:[...(line.briefEvidence || []),evidence]});}
      else {const id=uuidv4();setAdditions(prev=>[...prev,{id,...values,quantity:values.quantity || 1,widthMm:'',dropMm:'',scopePlaceholder:true,quantityConfirmed:false,measureSource:'plan',notes:[values.notes,'Unmeasured scope from customer brief; confirm opening count and mapping before pricing.'].filter(Boolean).join(' '),briefEvidence:[evidence]}]);onEditing(true);}
    }
    setBriefNote(`CUSTOMER BRIEF reviewed ${new Date().toLocaleDateString('en-AU')}:\n${brief}`);setSuggestions([]);setChosen(new Set());setTab('Openings');setMessage('Selected proposals are in your unsaved answers. Review them, then save.');
  }
  async function readPlans() {
    if(!pdf) return;
    setBusy(true);setError('');
    try{setSources(await readPlanSources(pdf,takeoff,(page,total)=>setProgress(`Reading plan page ${page} of ${total}…`)));}
    catch(e){setError(e.message);}finally{setBusy(false);setProgress('');}
  }
  async function findHeights() {
    if(!active) return;
    setBusy(true);setError('');setHeightSuggestions([]);
    try {let pages=sources;if(!pages.length){pages=await readPlanSources(pdf,takeoff,(page,total)=>setProgress(`Reading page ${page} of ${total}…`));setSources(pages);}setHeightSuggestions(await suggestHeightReferences(jobId,active,pages));}
    catch(e){setError(e.message);}finally{setBusy(false);setProgress('');}
  }
  function addReference(source) {
    if(!active) return;
    patch(active.id,{planSources:[...(active.planSources || []),{fileName:source.fileName,revision:source.revision,page:source.page,excerpt:source.excerpt,kind:'Reference — mapping / measurement basis requires review'}]});
    setMessage('Reference attached to this opening’s unsaved answers. It has not been used as a finished drop.');
  }
  function acceptPlanChange(key,suggestion) {
    const pending={...active.pendingPlanChanges};delete pending[key];
    patch(active.id,{[key]:suggestion.value,pendingPlanChanges:pending,...(key!=='location'?{measureSource:'plan'}:{})});
  }
  useImperativeHandle(closeRef,()=>({close}));
  function close() {
    if(busy)return;
    if(dirty && !window.confirm('Discard the unsaved answers in this editor?')) return;
    onClose?.();
  }
  if(!sheet || sheet.deletedAt) return <div className="p-4 text-sm">Create a measure sheet for this project before reviewing opening specifications.</div>;
  const selectedTypes=[...new Set(lines.filter(l=>selected.has(l.id)).map(l=>l.productTypeId || l.productNameSnapshot))];
  const bulkType=selectedTypes.length===1?lines.find(l=>selected.has(l.id)):null;
  const bulkEditor={...(bulkType?{productTypeId:bulkType.productTypeId,productNameSnapshot:bulkType.productNameSnapshot}:{}),...bulk};
  const filtered=lines.filter(l=>!filter || `${l.location} ${openingGaps(l).pricing.join(' ')} ${openingGaps(l).ordering.join(' ')}`.toLowerCase().includes(filter.toLowerCase()));
  return <fieldset ref={editorRoot} disabled={busy} className="opening-workspace min-w-0 w-full space-y-4 text-slate-800">
    <div className="opening-workspace-heading flex items-start justify-between gap-2"><div className="min-w-0"><h2 className="text-base lg:text-lg font-semibold">{questionsView?'Details to complete':'Openings & specifications'}</h2><p className="mt-1 text-xs text-slate-500">{questionsView?'Only the boxes that need an answer are shown here.':'Changes are saved only when you choose Save answers.'}</p></div>{embeddedInPlan && dirty && <button aria-label="Save opening answers" disabled={busy} onClick={save} className={`${action} shrink-0 min-h-11`}>Save</button>}{onClose && <button className="shrink-0 min-w-11 min-h-11 flex items-center justify-center" aria-label="Close opening editor" onClick={close}><X size={20}/></button>}</div>
    {!sheetId && sheets.length>1 && <label className="block text-xs font-medium">Measure sheet<select className={`${inputClass} mt-1`} value={chosenSheetId || ''} onChange={e=>{if(dirty){setError('Save your answers before switching sheets.');return;}const target=sheets.find(s=>s.id===e.target.value);setChosenSheetId(target.id);baseline.current=target.updatedAt;setSelected(new Set());setActiveId('');setSuggestions([]);setMessage('');}}>{sheets.map(s=><option key={s.id} value={s.id}>{s.title || s.name || s.measureDate || s.id} · {(s.lineItems || []).length} entries</option>)}</select></label>}
    {answersOnly && <button type="button" onClick={()=>setShowAll(value=>!value)} className="text-xs text-slate-500 underline">{showAll?'Show only boxes needing an answer':'Show all specifications'}</button>}
    {!questionsView && <div className="opening-workspace-tabs flex flex-wrap gap-2">{['Openings','Bulk edit','Customer brief','Plan evidence'].map(t=><button key={t} onClick={()=>setTab(t)} className={`${secondary} ${tab===t?'bg-amber-50 border-amber-300 text-amber-800':''}`}>{t}</button>)}</div>}
    {onDraftChange && dirty && <button type="button" className="text-xs text-slate-500 underline" onClick={()=>{if(!window.confirm('Discard your unsaved opening answers? Saved measure-sheet details are kept.'))return;setFills({});setAdditions([]);setBriefNote('');baseline.current=sheet.updatedAt;setError('');setMessage('Unsaved opening answers discarded.');}}>Discard unsaved opening answers</button>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    <div key={questionsView?'questions':tab} className="opening-content-enter">
    {questionsView?<OpeningQuestions lines={lines} savedLines={stored} productTypes={types} onChange={field} onReview={id=>{setShowAll(true);setTab('Openings');chooseActive(id);setExpandedSpecs(prev=>new Set([...prev,id]));}}/>:<>

    {tab==='Openings' && <>
      <details open={embeddedInPlan?undefined:true} className="rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-medium min-h-8">Missing details & filters</summary><p className="mt-2 text-sm font-medium">{lines.length} opening / scope entries · {lines.filter(l=>isScopePlaceholder(l)).length} need opening count or mapping confirmed</p><div className="mt-2 flex flex-wrap gap-2">{groups.map(g=><button key={`${g.stage}:${g.label}`} onClick={()=>setFilter(g.label)} className={`rounded-full border px-2 py-1 text-xs ${g.stage==='pricing'?'border-amber-200 text-amber-800':'border-slate-200 text-slate-500'}`}>{g.lineIds.length} · {g.label}{g.stage==='ordering'?' · before ordering':''}</button>)}</div></details>
      <Field label="Find room or missing decision" value={filter} onChange={setFilter}/>
      <div className="space-y-3">{filtered.map(line=>{const gaps=openingGaps(line),idx=lines.findIndex(l=>l.id===line.id);return <section key={line.id}>
        <div className="mb-1 flex items-center gap-2 px-1"><input type="checkbox" aria-label={`Select ${line.location}`} checked={selected.has(line.id)} onChange={()=>toggle(setSelected,line.id)}/><span className="text-xs text-amber-700">{gaps.pricing.length?`For pricing: ${gaps.pricing.join(', ')}`:'Pricing specifications recorded'}</span></div>
        <MeasureSheetOpeningCard item={line} idx={idx} productTypes={types} sheetId={sheet.id} lineCount={lines.length}
          cardOpen={activeId===line.id} isExpanded={expandedSpecs.has(line.id)} otherOpen={otherSpecs.has(line.id)}
          nextItem={filtered[filtered.findIndex(l=>l.id===line.id)+1]}
          toggleCard={id=>chooseActive(activeId===id?'':id)} openOnly={chooseActive}
          toggleItemExpand={id=>toggle(setExpandedSpecs,id)} toggleOtherSpecs={id=>toggle(setOtherSpecs,id)}
          setLineItem={(_idx,key,value)=>field(line.id,key,value)}
          commitMeasure={(_idx,key,raw)=>{const result=resolveMeasureEntry(raw);if(result)field(line.id,key,result.value);patch(line.id,{[`${key}Expr`]:result?.expression || ''});}}
          confirmLineMeasured={()=>patch(line.id,markLineCheckMeasured(line,{by:displayName}))}
          revertLineToPlan={()=>patch(line.id,markLinePlanEstimate(line))}
          setLinePhotos={(_id,paths)=>patch(line.id,{photoPaths:paths})}>
          {embeddedInPlan && (!line.takeoffItemId || line.takeoffRemoved) && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">This opening is not placed on the current plan. Place it to link these specifications to a window.</p>}
          <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={!isScopePlaceholder(line)} onChange={e=>patch(line.id,{quantityConfirmed:e.target.checked,scopePlaceholder:!e.target.checked,...(isScopePlaceholder(line) && !line.measureSource?{measureSource:'plan'}:{})})}/>Opening count and mapping confirmed</label>
          <div className="flex flex-wrap gap-2">{onJump && line.takeoffPage && <button className={secondary} onClick={()=>{if(dirty && !embeddedInPlan){setError('Save or discard your answers before returning to the plan.');return;}onJump(line.takeoffPage,line.takeoffItemId);}}>Show on plan · page {line.takeoffPage}</button>}{onPlace && !line.takeoffItemId && <button className={secondary} onClick={()=>{if(dirty){setError('Save your answers before placing this opening.');return;}onPlace(line.id);}}>Place this opening on the plan</button>}</div>
          {line.planRevisionReview && <div className="rounded-lg border border-amber-200 p-3 text-sm"><p>Plan revision changed from r{line.planRevisionReview.from} to r{line.planRevisionReview.to}. Confirm this opening still matches the drawing. Existing specifications and site sizes are retained.</p><button className={secondary} onClick={()=>patch(line.id,{planRevisionReview:null,reviewedRevision:line.planRevisionReview.to})}>I compared this opening with the revised plan</button></div>}
          {line.takeoffRemoved && <div className="rounded-lg bg-amber-50 p-3 text-sm">This opening was removed from the current plan markup. Its sheet details are retained. Reposition it or confirm the scope before pricing.</div>}
          {Object.entries(line.pendingPlanChanges || {}).map(([key,value])=><div key={key} className="rounded-lg border border-amber-200 p-3 text-sm"><p>Plan proposes {key==='widthMm'?'width':key==='dropMm'?'drop':key}: <strong>{value.value}</strong>; current answer: <strong>{line[key] || '—'}</strong>.</p><p className="text-xs text-slate-500">{value.fileName} · p{value.page} · r{value.revision} · {value.reason}</p><div className="mt-2 flex gap-2"><button className={secondary} onClick={()=>acceptPlanChange(key,value)}>Use plan value (provisional)</button><button className={secondary} onClick={()=>{const next={...line.pendingPlanChanges};delete next[key];patch(line.id,{pendingPlanChanges:next,reviewedPlanValues:{...line.reviewedPlanValues,[key]:value.value}});}}>Keep my answer</button></div></div>)}
          <details className="rounded-xl border border-slate-200 p-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-500">Optional size adjustments</summary>
            <p className="my-3 text-xs text-slate-500">Plan dimensions are estimates for quoting. Final manufacturing sizes and allowances can be confirmed at the site check measure.</p>
            <MakeSizeCalculator key={line.id} line={line} onApply={values=>patch(line.id,values)} onInputsChange={inputs=>patch(line.id,{makeSizeCalculation:{inputs,reviewed:false}})}/>
          </details>
          <button className={secondary} onClick={()=>{setQuery(line.location || '');setTab('Plan evidence');}}>Find heights / schedules in plans</button>
          {!!line.planSources?.length && <div className="space-y-2"><h3 className="text-sm font-semibold">Plan references</h3>{line.planSources.map((s,i)=><div key={i} className="rounded-lg bg-slate-50 p-3 text-xs"><p>{s.fileName} · revision {s.revision} · page {s.page}</p><p className="whitespace-pre-wrap mt-1">{s.excerpt}</p>{onJump && <button className="mt-1 underline" onClick={()=>{if(dirty && !embeddedInPlan){setError('Save your answers before opening this drawing.');return;}onJump(s.page);}}>Open source drawing</button>}</div>)}</div>}
          {!!line.briefEvidence?.length && <details><summary className="cursor-pointer text-xs text-slate-500">Customer brief evidence</summary>{line.briefEvidence.map((e,i)=><p key={i} className="mt-2 text-xs">{e.excerpt}</p>)}</details>}
          {!!line.specHistory?.length && <details><summary className="cursor-pointer text-xs text-slate-500">Change history ({line.specHistory.length})</summary>{[...line.specHistory].reverse().map((h,i)=><div key={i} className="mt-2 rounded-lg bg-slate-50 p-3 text-xs"><p>{h.at} · {h.by} · {h.source}</p>{h.changes.map(c=><p key={c.field}>{c.field}: {JSON.stringify(c.from)} → {JSON.stringify(c.to)}</p>)}<button className="mt-1 underline" onClick={()=>patch(line.id,Object.fromEntries(h.changes.map(c=>[c.field,c.from])))}>Restore these previous values to my unsaved answers</button></div>)}</details>}
        </MeasureSheetOpeningCard>
      </section>;})}</div>
    </>}
    {tab==='Bulk edit' && <div className="space-y-4"><p className="text-sm">Select the openings to share these answers. Different product types can have different hardware; group similar products together.</p><div className="grid gap-2 sm:grid-cols-2">{lines.map(l=><label key={l.id} className="flex gap-2 text-sm"><input type="checkbox" checked={selected.has(l.id)} onChange={()=>toggle(setSelected,l.id)}/>{l.location}</label>)}</div><button className={secondary} onClick={()=>setSelected(new Set(lines.map(l=>l.id)))}>Select all entries</button><OpeningFields bulk line={bulkEditor} productTypes={types} onChange={(key,value)=>{setBulk(p=>({...p,[key]:value,...(key==='curtainLayers'?{liningMode:value==='Separate sheer and blockout'?'separate':value==='Curtain with attached lining'?'attached':'',attachedLining:/separate|attached/i.test(value)}:{})}));setBulkPreview(null);}}/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overwrite} onChange={e=>{setOverwrite(e.target.checked);setBulkPreview(null);}}/>Replace existing answers too</label><button className={secondary} onClick={()=>setBulkPreview(previewBulk(lines,[...selected],bulk,overwrite))}>Preview changes to {selected.size} entries</button>{bulkPreview && <div className="rounded-xl border border-slate-200 p-3 space-y-2"><p className="text-sm font-semibold">{bulkPreview.length} entries will change</p>{bulkPreview.map(({line,patch:values})=><div key={line.id} className="text-xs"><strong>{line.location}</strong>{Object.entries(values).map(([key,value])=><p key={key}>{key}: {String(line[key] || 'blank')} → {String(value)}</p>)}</div>)}<button disabled={!bulkPreview.length} className={action} onClick={()=>{for(const change of bulkPreview)patch(change.line.id,change.patch);setBulkPreview(null);setTab('Openings');}}>Apply this preview to my unsaved answers</button></div>}</div>}
    {tab==='Customer brief' && <div className="space-y-4"><p className="text-sm text-slate-600">Paste the customer’s email or consultation notes. The Mac assistant proposes field changes and missing rooms for your review. Keep Start Lusso Quote Assistant running on this Mac. It cannot send a quote or place an order.</p><textarea rows={9} maxLength={24000} className={inputClass} value={brief} onChange={e=>setBrief(e.target.value)} placeholder="Paste customer email / agreed requirements…"/>{sheet.internalNotes && <button className={secondary} onClick={()=>setBrief(sheet.internalNotes.slice(0,24000))}>Use saved sheet notes as the brief</button>}<button className={action} disabled={busy || !brief.trim()} onClick={analyseBrief}>{busy?'Reading brief…':'Find specifications and missing openings'}</button>{suggestions.map(s=><label key={s.id} className="block rounded-xl border border-slate-200 p-3 space-y-2"><span className="flex gap-2 text-sm font-semibold"><input type="checkbox" checked={chosen.has(s.id)} onChange={()=>toggle(setChosen,s.id)}/>{s.lineId?lines.find(l=>l.id===s.lineId)?.location:`Add unmeasured scope: ${s.patch.location}`}</span>{Object.entries(s.patch).map(([key,value])=><span key={key} className="block text-xs">{key}: {String(lines.find(l=>l.id===s.lineId)?.[key] || 'blank')} → {String(value)}</span>)}<blockquote className="text-xs text-slate-500">“{s.evidence}”</blockquote>{s.question && <span className="block text-xs text-amber-700">Still needs your decision: {s.question}</span>}</label>)}{!!suggestions.length && <button className={action} disabled={!chosen.size} onClick={applySuggestions}>Use {chosen.size} reviewed proposals</button>}</div>}
    {tab==='Plan evidence' && <div className="space-y-4"><p className="text-sm text-slate-600">Search all pages for room heights, window IDs, schedules, sections, bulkheads and floor levels. Check the drawing visually before associating a dimension with an opening.</p>{pdf?<button className={secondary} disabled={busy} onClick={readPlans}>{sources.length?'Read plans again':'Read all plan pages'}</button>:<a href={`/jobs/${jobId}/takeoff`} className="inline-flex items-center gap-1 text-sm text-amber-700">Open takeoff to search the PDF <ExternalLink size={14}/></a>}{pdf && active && <button className={action} disabled={busy} onClick={findHeights}>Find possible heights for {active.location}</button>}{heightSuggestions.map((ref,i)=><div key={i} className="rounded-xl border border-amber-200 p-3 space-y-2"><p className="font-semibold text-sm">{ref.heightMm} mm · {ref.basis}</p><p className="text-xs">{ref.source.fileName} · r{ref.source.revision} · p{ref.source.page}</p><blockquote className="whitespace-pre-wrap text-xs">{ref.evidence}</blockquote><p className="text-xs text-amber-800">{ref.mapping}</p><button className={secondary} onClick={()=>{addReference({...ref.source,excerpt:ref.evidence});setReferenceHeight(String(ref.heightMm));setReferenceBasis(ref.basis);setMessage('Candidate selected. Confirm its room mapping and record it in the calculator below; it is not a finished drop.');}}>Review this height reference</button></div>)}{progress && <p className="text-sm">{progress}</p>}{sources.some(s=>s.scanned) && <p className="text-sm text-amber-700">Some pages have no readable text. Inspect those pages visually; no dimensions have been inferred from them.</p>}<Field label="Search plan text (room, CH, bulkhead, W06, section…)" value={query} onChange={setQuery}/><label className="block text-xs">Attach references to<select className={`${inputClass} mt-1`} value={activeId} onChange={e=>chooseActive(e.target.value)}><option value="">Choose an opening</option>{lines.map(l=><option key={l.id} value={l.id}>{l.location}</option>)}</select></label>{active && <div className="rounded-xl border border-slate-200 p-3 space-y-3"><p className="text-sm font-medium">Record a height read from a referenced drawing</p><Field label="Stated height (mm)" type="number" value={referenceHeight} onChange={setReferenceHeight}/><Field label="What the height represents" value={referenceBasis} onChange={setReferenceBasis} options={['Ceiling / bracket to floor','Window height','Finished make drop']}/><button className={secondary} disabled={!(Number(referenceHeight)>0) || !referenceBasis || !active.planSources?.length} onClick={()=>{patch(active.id,{makeSizeCalculation:{inputs:{...(active.makeSizeCalculation?.inputs || {}),widthBasis:active.widthBasis || '',rawWidthMm:active.planWidthMm || active.widthMm || '',dropBasis:referenceBasis,rawDropMm:referenceHeight},reviewed:false}});setTab('Openings');setMessage('Height added to the calculator. Confirm its mapping, deductions and clearance before using a finished size.');}}>Use as a calculator reference, not a finished drop</button></div>}{findPlanEvidence(sources,query).map(s=><div key={s.id} className="rounded-xl border border-slate-200 p-3 space-y-2"><p className="text-sm font-semibold">{s.fileName} · r{s.revision} · p{s.page}</p><p className="whitespace-pre-wrap text-xs text-slate-600">{s.excerpt}</p><div className="flex gap-2"><button className={secondary} disabled={!active} onClick={()=>addReference(s)}>Attach this reference</button>{onJump && <button className={secondary} onClick={()=>{if(dirty){setError('Save your answers before opening the source drawing.');return;}onJump(s.page);}}>Inspect drawing</button>}</div><details><summary className="cursor-pointer text-xs text-slate-500">Full extracted page text</summary><p className="mt-2 whitespace-pre-wrap text-xs">{s.text}</p></details></div>)}</div>}
    </>}
    </div>
    <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-slate-200 bg-white p-3"><button className={action} disabled={busy || !dirty} onClick={save}>{busy?<Loader2 size={16} className="animate-spin"/>:'Save answers'}</button><p className="text-xs text-slate-500">{dirty?'Unsaved answers · existing sent quotes are unchanged':embeddedInPlan?'All changes saved':'Measure-sheet answers are shared with takeoff and new draft preparation.'}</p></div>
  </fieldset>;
}
