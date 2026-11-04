import { getMsOptions, getTypeSpecKeys, MS_SPEC_FIELDS } from '../../store/data';
import { OPERATION_REQUESTS, isScopePlaceholder, CURTAIN_SETUPS, CURTAIN_SETUP_LABELS, curtainSetupForLine, openingOperation } from '../../lib/openingWorkflow';
export const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-500';
export function Field({label,value,onChange,options,optionLabels={},type='text',hint,attention=false}) {
  return <label className="block space-y-1"><span className="text-xs font-medium text-slate-600">{label}</span>{options ? <select aria-label={label} aria-required={attention || undefined} className={`${inputClass} ${attention?'border-amber-400 ring-2 ring-amber-200 bg-amber-50/30':''}`} value={value ?? ''} onChange={e=>onChange(e.target.value)}><option value="">Choose…</option>{[...new Set([...options,...(value && !options.includes(value)?[value]:[])])].map(o=><option key={o} value={o}>{optionLabels[o] || o}</option>)}</select> : <input aria-label={label} aria-required={attention || undefined} className={`${inputClass} ${attention?'border-amber-400 ring-2 ring-amber-200 bg-amber-50/30':''}`} type={type} value={value ?? ''} onChange={e=>onChange(e.target.value)} />}{hint && <span className="block text-xs text-slate-400">{hint}</span>}</label>;
}
export default function OpeningFields({line,productTypes,onChange,bulk=false}) {
  const pt=productTypes.find(p=>p.id===line.productTypeId) || productTypes.find(p=>p.name.toLowerCase()===(line.productNameSnapshot || '').toLowerCase());
  const name=line.productNameSnapshot || pt?.name || '';
  const curtain=/curtain/i.test(name), roman=/roman/i.test(name);
  const keys=pt ? getTypeSpecKeys(pt) : curtain ? ['heading','control','operationType','trackColour','fixing','returnSide','hem'] : roman ? ['fixing','control','operationType','hem','chainColour'] : name ? ['fixing','control','operationType','heading','baseBarType','baseBarColour','chainColour'] : ['fixing','control'];
  return <div className="grid gap-3 sm:grid-cols-2">
    {!bulk && <Field label="Room / opening" value={line.location} onChange={v=>onChange('location',v)} />}
    <label className="block space-y-1"><span className="text-xs font-medium text-slate-600">Product</span><select className={inputClass} value={pt?.id || ''} onChange={e=>{const p=productTypes.find(t=>t.id===e.target.value);onChange('productTypeId',p?.id || '');onChange('productNameSnapshot',p?.name || '');}}><option value="">Choose…</option>{productTypes.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <Field label="Fabric / range / colour" value={line.fabricColour} onChange={v=>onChange('fabricColour',v)} />
    <Field label="Operation requested" value={openingOperation(line)} onChange={v=>onChange('operationRequest',v)} options={OPERATION_REQUESTS} hint="Both means two quote alternatives for this same opening." />
    {(curtain || bulk) && <>
      <Field label="Curtain setup" hint="Sheer only, blockout only, or both as separate curtains." value={curtainSetupForLine(line)} onChange={v=>onChange('curtainLayers',v)} options={CURTAIN_SETUPS} optionLabels={CURTAIN_SETUP_LABELS} />
      <Field label="Track arrangement" value={line.trackArrangement} onChange={v=>onChange('trackArrangement',v)} options={['Single track','Double tracks with dual brackets','Two separate tracks','Existing track — fabric only']} />
      <Field label="Track installation" value={line.trackRecess} onChange={v=>onChange('trackRecess',v)} options={['Recessed / built into ceiling','Surface mounted','Existing — confirm']} />
    </>}
    {(bulk || /separate|attached/i.test(line.curtainLayers || '') || roman) && <Field label="Blockout / lining fabric and colour" value={line.liningFabricColour} onChange={v=>onChange('liningFabricColour',v)} />}
    {roman && <Field label="Roman lining" value={line.liningRequirement} onChange={v=>onChange('liningRequirement',v)} options={['Unlined','Lined']} />}
    {line.operationRequest==='Manual and automated alternatives' && <><Field label={curtain?'Manual track model':'Manual control / hardware model'} value={line.manualTrackType} onChange={v=>onChange('manualTrackType',v)} options={getMsOptions('operationType',pt)}/><Field label={curtain?'Automated track model':'Automated control / hardware model'} value={line.automatedTrackType} onChange={v=>onChange('automatedTrackType',v)} options={getMsOptions('operationType',pt)}/></>}
    {MS_SPEC_FIELDS.filter(f=>keys.includes(f.key) && f.key!=='lining' && !(f.key==='operationType' && line.operationRequest==='Manual and automated alternatives') && !(curtain && ['baseBarType','baseBarColour','chainColour'].includes(f.key)) && !(f.key==='motorSide' && !['Automated','Manual and automated alternatives'].includes(line.operationRequest))).map(f=>{
      let options=getMsOptions(f.optionKey,pt);
      if (f.key==='heading' && curtain) options=options.filter(o=>!/roll/i.test(o));
      return <Field key={f.key} label={f.key==='operationType' ? (curtain?'Track model':'Control / hardware model') : f.label} value={line[f.itemField]} onChange={v=>onChange(f.itemField,v)} options={options} />;
    })}
    {line.operationRequest && line.operationRequest!=='Manual' && <Field label="Motor power" value={line.motorPower} onChange={v=>onChange('motorPower',v)} options={['Battery','240V','Low voltage — confirm system']} />}
    <Field label="Supplier" value={line.supplier} onChange={v=>onChange('supplier',v)} />
    {!bulk && <><Field label="Quantity" type="number" value={line.quantity} onChange={v=>onChange('quantity',v)} /><label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={!isScopePlaceholder(line)} onChange={e=>{onChange('quantityConfirmed',e.target.checked);onChange('scopePlaceholder',!e.target.checked);if(isScopePlaceholder(line) && !line.measureSource)onChange('measureSource','plan');}} />Opening count and mapping confirmed</label></>}
    <label className="block space-y-1 sm:col-span-2"><span className="text-xs font-medium text-slate-600">Opening notes</span><textarea rows={3} className={inputClass} value={line.notes || ''} onChange={e=>onChange('notes',e.target.value)} /></label>
  </div>;
}
