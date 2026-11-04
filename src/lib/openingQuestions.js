import {openingGaps} from './openingWorkflow.js';
// Keep a question on screen while its answer is being typed; only saving the
// sheet removes it. Include newly required fields when another answer changes.
export function openingQuestionFields(saved,line=saved){
  const gaps=new Set([...openingGaps(saved).pricing,...openingGaps(line).pricing]);
  const fields=[];
  if(gaps.has('Product'))fields.push('productTypeId');
  if(gaps.has('Measurements'))for(const key of ['widthMm','dropMm'])if(!(Number(saved[key])>0) || !(Number(line[key])>0))fields.push(key);
  for(const [gap,key] of [['Fabric','fabricColour'],['Operation','operationRequest'],['Curtain setup','curtainLayers'],['Heading','heading'],['Blockout / lining fabric','liningFabricColour'],['Track model','trackType']])if(gaps.has(gap))fields.push(key);
  if(gaps.has('Track models for both options') || gaps.has('Hardware for both options'))for(const key of ['manualTrackType','automatedTrackType'])if(!saved[key] || !line[key])fields.push(key);
  if(gaps.has('Opening count / mapping'))fields.push('quantity','quantityConfirmed');
  if(gaps.has('Plan changes'))fields.push('planReview');
  return [...new Set(fields)];
}
