import {useState} from 'react';
import {calculateMakeSize,WIDTH_BASES,DROP_BASES} from '../../lib/openingWorkflow';
import {Field} from './OpeningFields';
export default function MakeSizeCalculator({line,onApply,onInputsChange}) {
  const [values,setValues]=useState(()=>line.makeSizeCalculation?.inputs || {widthBasis:line.widthBasis || '',dropBasis:line.dropBasis || '',rawWidthMm:line.planWidthMm || line.widthMm || '',rawDropMm:line.planHeightMm || '',leftAllowanceMm:'',rightAllowanceMm:'',trackDeductionMm:'',floorClearanceMm:'',topOverlapMm:'',bottomOverlapMm:''});
  const set=(key,value)=>{const next={...values,[key]:value};setValues(next);onInputsChange?.(next);};
  const result=calculateMakeSize(values);
  const number=(key,label)=><Field key={key} label={label} type="number" value={values[key]} onChange={v=>set(key,v)} />;
  return <div className="rounded-xl border border-slate-200 p-4 space-y-3">
    <h3 className="font-semibold text-sm">Measurement → finished size</h3>
    <p className="text-xs text-slate-500">Keep the original measurement and each adjustment. These calculations remain provisional until checked on site.</p>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="What was measured across?" options={WIDTH_BASES} value={values.widthBasis} onChange={v=>set('widthBasis',v)} />{number('rawWidthMm','Original width (mm)')}
      {values.widthBasis && values.widthBasis!=='Finished track width' && <>{number('leftAllowanceMm','Left adjustment (mm; negative deducts)')}{number('rightAllowanceMm','Right adjustment (mm; negative deducts)')}</>}
      <Field label="What was measured vertically?" options={DROP_BASES} value={values.dropBasis} onChange={v=>set('dropBasis',v)} />{number('rawDropMm','Original height / drop (mm)')}
      {values.dropBasis==='Ceiling / bracket to floor' && <>{number('trackDeductionMm','Track / carrier deduction (mm)')}{number('floorClearanceMm','Floor clearance (mm)')}</>}
      {values.dropBasis==='Window height' && <>{number('topOverlapMm','Top overlap (mm)')}{number('bottomOverlapMm','Bottom overlap (mm)')}</>}
    </div>
    <p className="text-sm font-semibold">Proposed make size: {result.widthMm ?? '—'} × {result.dropMm ?? '—'} mm</p>
    {result.errors.map(e=><p key={e} className="text-xs text-amber-700">{e}</p>)}
    <button type="button" disabled={!result.valid} onClick={()=>onApply({widthMm:result.widthMm,dropMm:result.dropMm,widthBasis:values.widthBasis,dropBasis:values.dropBasis,makeSizeCalculation:{inputs:values,result,reviewedAt:new Date().toISOString()},measureSource:line.measureSource==='site'?'site':'plan'})} className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-40">Use this calculation in my unsaved answers</button>
  </div>;
}
