import {getMsOptions,makeProductSelectHandlers} from '../../store/data';
import {openingQuestionFields} from '../../lib/openingQuestions';
import {CURTAIN_SETUPS,CURTAIN_SETUP_LABELS,curtainSetupForLine,OPERATION_REQUESTS,hasValue} from '../../lib/openingWorkflow';
import PricedItemPicker from '../PricedItemPicker';
import {Field} from './OpeningFields';

export default function OpeningQuestions({lines,savedLines,productTypes,onChange,onReview}){
  const questions=lines.map(line=>({line,fields:openingQuestionFields(savedLines.find(s=>s.id===line.id) || line,line)})).filter(q=>q.fields.length);
  if(!questions.length)return <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">No missing quote details on the measure sheet. You can continue quoting below.</p>;
  return <div className="quote-question-fields space-y-3"><p className="text-sm text-slate-600">Fill in these boxes, then choose Save answers.</p>{questions.map(({line,fields})=>{
    const pt=productTypes.find(p=>p.id===line.productTypeId),curtain=/curtain/i.test(line.productNameSnapshot || pt?.name || '');
    return <section key={line.id} aria-label={`Answers for ${line.location || 'Unnamed opening'}`} className="rounded-xl border border-amber-200 bg-white p-4 space-y-3">
      <h3 className="text-sm font-semibold text-slate-900">{line.location || 'Unnamed opening'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{fields.map(key=>{
        const change=value=>onChange(line.id,key,value);
        const common={key,value:line[key],onChange:change,attention:['widthMm','dropMm'].includes(key)?!(Number(line[key])>0):!hasValue(line[key])};
        if(key==='productTypeId')return <div key={key} className="rounded-lg ring-2 ring-amber-300 p-2"><label className="block text-xs font-medium text-slate-600 mb-1">What product is this?</label><PricedItemPicker value={line.productNameSnapshot} productTypes={productTypes} typesFirst {...makeProductSelectHandlers((_idx,k,v)=>onChange(line.id,k,v),0,productTypes)}/></div>;
        if(key==='widthMm' || key==='dropMm')return <Field {...common} label={key==='widthMm'?'Width (mm)':'Drop (mm)'} type="number"/>;
        if(key==='fabricColour')return <Field {...common} label="Fabric / colour"/>;
        if(key==='operationRequest')return <Field {...common} label={curtain?'Manual or motorised curtains?':'How should it be operated?'} options={OPERATION_REQUESTS} optionLabels={{Manual:'Manual — wand or cord',Automated:'Motorised','Manual and automated alternatives':'Quote both manual and motorised'}}/>;
        if(key==='curtainLayers')return <Field {...common} label="What curtains are needed?" value={curtainSetupForLine(line)} options={CURTAIN_SETUPS} optionLabels={CURTAIN_SETUP_LABELS}/>;
        if(key==='heading')return <Field {...common} label="Heading / pleat" options={getMsOptions('heading',pt).filter(o=>!curtain || !/roll/i.test(o))}/>;
        if(key==='liningFabricColour')return <Field {...common} label="Blockout / lining fabric and colour"/>;
        if(['trackType','manualTrackType','automatedTrackType'].includes(key))return <Field {...common} label={key==='manualTrackType'?'Manual track model':key==='automatedTrackType'?'Motorised track model':curtain?'Track model':'Control / hardware model'} options={getMsOptions('operationType',pt)}/>;
        if(key==='quantity')return <Field {...common} label="How many openings?" type="number"/>;
        if(key==='quantityConfirmed')return <label key={key} className="flex gap-2 items-center rounded-lg border border-amber-300 p-3 text-sm"><input type="checkbox" checked={line.quantityConfirmed===true} onChange={e=>{change(e.target.checked);onChange(line.id,'scopePlaceholder',!e.target.checked);if(!line.measureSource)onChange(line.id,'measureSource','plan');}}/>I have checked the number and location of these openings</label>;
        if(key==='planReview')return <button key={key} type="button" onClick={()=>onReview(line.id)} className="rounded-lg border border-amber-300 p-3 text-left text-sm text-amber-800">Review the changed plan details for this opening</button>;
        return null;
      })}</div>
    </section>;
  })}</div>;
}
