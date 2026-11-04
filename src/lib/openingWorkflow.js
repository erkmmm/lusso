/** Shared opening workflow. Pure helpers keep plan suggestions separate from approved sizes. */
export const OPENING_FIELDS = ['productTypeId','productNameSnapshot','fabricColour','heading','curtainLayers','liningFabricColour','attachedLining','liningRequirement','fixing','trackRecess','operationRequest','manualTrackType','automatedTrackType','trackType','trackArrangement','trackColour','control','motorSide','returnSide','hem','baseBarType','baseBarColour','chainColour','supplier','motorPower','widthBasis','dropBasis','quantity','notes'];
export const WIDTH_BASES = ['Opening width','Wall-to-wall','Finished track width'];
export const DROP_BASES = ['Ceiling / bracket to floor','Window height','Finished make drop'];
export const OPERATION_REQUESTS = ['Manual','Automated','Manual and automated alternatives'];
export const hasValue = v => v !== undefined && v !== null && String(v).trim() !== '';
const positive = v => hasValue(v) && Number.isFinite(Number(v)) && Number(v) > 0;
const numeric = v => hasValue(v) && Number.isFinite(Number(v));
export function calculateMakeSize(values = {}) {
  const errors = [];
  const { widthBasis, dropBasis, rawWidthMm, rawDropMm, leftAllowanceMm, rightAllowanceMm, trackDeductionMm, floorClearanceMm, topOverlapMm, bottomOverlapMm } = values;
  let widthMm = null, dropMm = null;
  if (!WIDTH_BASES.includes(widthBasis) || !positive(rawWidthMm)) errors.push('Choose the width basis and enter its measurement.');
  else if (widthBasis === 'Finished track width') widthMm = Number(rawWidthMm);
  else if (![leftAllowanceMm,rightAllowanceMm].every(numeric)) errors.push('Enter both width adjustments; use 0 when none is required.');
  else widthMm = Number(rawWidthMm) + Number(leftAllowanceMm) + Number(rightAllowanceMm);
  if (!DROP_BASES.includes(dropBasis) || !positive(rawDropMm)) errors.push('Choose the height basis and enter its measurement.');
  else if (dropBasis === 'Finished make drop') dropMm = Number(rawDropMm);
  else if (dropBasis === 'Ceiling / bracket to floor') {
    if (![trackDeductionMm,floorClearanceMm].every(v => numeric(v) && Number(v) >= 0)) errors.push('Confirm the track deduction and floor clearance, including 0 where appropriate.');
    else dropMm = Number(rawDropMm) - Number(trackDeductionMm) - Number(floorClearanceMm);
  } else {
    if (![topOverlapMm,bottomOverlapMm].every(numeric)) errors.push('Confirm top and bottom overlaps for the window height.');
    else dropMm = Number(rawDropMm) + Number(topOverlapMm) + Number(bottomOverlapMm);
  }
  if (widthMm !== null && widthMm <= 0) errors.push('Finished width must be greater than zero.');
  if (dropMm !== null && dropMm <= 0) errors.push('Finished drop must be greater than zero.');
  return { widthMm, dropMm, errors, valid: !errors.length };
}
export function editOpening(line, patch, { by = 'Lusso team', source = 'Opening review', at = new Date().toISOString() } = {}) {
  const changes = Object.entries(patch).filter(([key,value]) => key !== 'id' && JSON.stringify(line[key] ?? '') !== JSON.stringify(value ?? ''));
  if (!changes.length) return line;
  const history = [...(line.specHistory || []), { at, by, source, changes: changes.map(([field,to]) => ({field,from:line[field] ?? '',to})) }].slice(-60);
  return { ...line, ...Object.fromEntries(changes), specHistory: history };
}
export function linkedSheetLine(items, itemId, lineId) {
  return items.find(l => l.id === lineId || (itemId && l.takeoffItemId === itemId));
}
export function planUpdate(line, row, context = {}) {
  const next = { ...line, lastPlanLabel:row.label, planWidthMm: row.widthMm, planDropMm: row.dropMm, takeoffItemId: row.itemId, takeoffPage: row.pageNumber, takeoffRemoved: false };
  const pending = { ...(line.pendingPlanChanges || {}) };
  const incoming = { location:row.label, widthMm:row.widthMm, dropMm:row.dropMm };
  // A changed plan proposes dimensions; it never silently replaces a non-empty answer.
  for (const [field,value] of Object.entries(incoming)) {
    if (!hasValue(value)) continue;
    if (field==='location' && (!hasValue(line.lastPlanLabel) || String(line.lastPlanLabel)===String(value))) continue;
    const previousPlan=field==='widthMm'?line.planWidthMm:field==='dropMm'?line.planDropMm:null;
    if (field!=='location' && hasValue(previousPlan) && String(previousPlan)===String(value)) continue;
    if (String(line[field] ?? '') === String(value) || String(line.reviewedPlanValues?.[field] ?? '') === String(value)) { delete pending[field]; continue; }
    if (field !== 'location' && line.measureSource === 'site') { pending[field] = { value, ...context, reason:'Site measurement retained' }; continue; }
    if (!hasValue(line[field]) && !line.makeSizeCalculation) next[field] = value;
    else pending[field] = { value, ...context, reason:'Review changed plan value' };
  }
  next.pendingPlanChanges = pending;
  return next;
}
export function isScopePlaceholder(line = {}) {
  return line.scopePlaceholder || line.quantityConfirmed===false || (line.quantityConfirmed!==true && /UNMEASURED scope placeholder|SCOPE PLACEHOLDER ONLY/i.test(line.notes || ''));
}
export const CURTAIN_SETUPS=['Sheer only','Blockout only','Separate sheer and blockout','Curtain with attached lining'];
export const CURTAIN_SETUP_LABELS={'Separate sheer and blockout':'Sheer + blockout','Curtain with attached lining':'Curtain + sewn-in lining'};
// Explicit legacy lining settings and product descriptions can answer this
// question. Two tracks alone do not tell us which fabrics hang on them.
export function curtainSetupForLine(line={}) {
  if(hasValue(line.curtainLayers))return line.curtainLayers;
  if(line.liningMode==='separate')return 'Separate sheer and blockout';
  if(line.liningMode==='attached' || (line.attachedLining && line.liningMode!==''))return 'Curtain with attached lining';
  const product=line.productNameSnapshot || '';
  if(/curtain/i.test(product) && /sheer/i.test(product) && !/blockout|blackout|double|dual/i.test(product))return 'Sheer only';
  if(/curtain/i.test(product) && /blockout|blackout/i.test(product) && !/sheer|double|dual/i.test(product))return 'Blockout only';
  return '';
}
export function openingOperation(line={}) {
  if(hasValue(line.operationRequest))return line.operationRequest;
  const product=line.productNameSnapshot || '';
  const manual=/\bmanual\b|wand operation|wand operated|cord drawn|chain operated/i.test(product);
  const motorised=/motoris|motoriz|\bbattery\b|\b240\s*v\b|\belectric\b/i.test(product);
  return manual!==motorised?(manual?'Manual':'Automated'):'';
}
export function openingGaps(line = {}) {
  const pricing = [], ordering = [];
  if (isScopePlaceholder(line)) pricing.push('Opening count / mapping');
  if (!positive(line.widthMm) || !positive(line.dropMm)) pricing.push('Measurements');
  if (!hasValue(line.productNameSnapshot || line.productTypeId)) pricing.push('Product');
  if (!hasValue(line.fabricColour)) pricing.push('Fabric');
  const operation=openingOperation(line);
  if (!hasValue(operation)) pricing.push('Operation');
  const curtain = /curtain/i.test(line.productNameSnapshot || '');
  const curtainSetup=curtainSetupForLine(line);
  if (curtain && !hasValue(curtainSetup)) pricing.push('Curtain setup');
  if (curtain && !hasValue(line.heading)) pricing.push('Heading');
  if (curtain && /separate|attached/i.test(curtainSetup) && !hasValue(line.liningFabricColour)) pricing.push('Blockout / lining fabric');
  if (!hasValue(line.fixing)) ordering.push('Fixing');
  if (operation==='Manual and automated alternatives' && (!hasValue(line.manualTrackType) || !hasValue(line.automatedTrackType))) pricing.push(curtain?'Track models for both options':'Hardware for both options');
  else if (curtain && operation!=='Manual and automated alternatives' && !hasValue(line.trackType)) pricing.push('Track model');
  if (curtain && !hasValue(line.trackRecess)) ordering.push('Track recess');
  if (!hasValue(line.control)) ordering.push('Opening / control direction');
  if (line.measureSource !== 'site') ordering.push('Check measure');
  if (line.takeoffRemoved || line.planRevisionReview || Object.keys(line.pendingPlanChanges || {}).length) pricing.push('Plan changes');
  return { pricing:[...new Set(pricing)], ordering:[...new Set(ordering)] };
}
export function readiness(lines) {
  const groups = {};
  for (const line of lines) for (const [stage,gaps] of Object.entries(openingGaps(line))) for (const gap of gaps) {
    const key = `${stage}:${gap}`;
    (groups[key] ||= {stage,label:gap,lineIds:[]}).lineIds.push(line.id);
  }
  return Object.values(groups);
}
export function previewBulk(lines, ids, patch, overwrite = false) {
  return lines.filter(l => ids.includes(l.id)).map(line => ({line,patch:Object.fromEntries(Object.entries(patch).filter(([field,value]) => hasValue(value) && (overwrite || !hasValue(line[field])) && String(line[field] ?? '') !== String(value)))})).filter(x => Object.keys(x.patch).length);
}
// Suggestions have to cite exact supplied source text and valid current opening IDs.
export function parseOpeningSuggestions(raw, lines, sources) {
  const text = String(raw || '').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'');
  const data = JSON.parse(text);
  if (!Array.isArray(data.suggestions) || data.suggestions.length > 200) throw new Error('The assistant did not return a reviewable list.');
  const allowed = new Set([...OPENING_FIELDS.filter(f=>f!=='productTypeId'),'location']);
  const newNames=new Set();
  return data.suggestions.map((s,index) => {
    const source = sources.find(x => x.id === s.sourceId);
    if (!source || !hasValue(s.evidence) || !source.text.includes(s.evidence)) throw new Error('A suggestion could not be verified against its source.');
    if (s.lineId && !lines.some(l => l.id === s.lineId)) throw new Error('A suggestion refers to a different opening.');
    const patch = Object.fromEntries(Object.entries(s.patch || {}).filter(([k,v]) => allowed.has(k) && (k==='quantity' ? Number.isInteger(v) && v>0 : k==='attachedLining' ? typeof v==='boolean' : typeof v==='string')));
    if (!s.lineId && !hasValue(patch.location)) throw new Error('A new opening needs a room name.');
    if(!s.lineId) {
      const name=String(patch.location).trim().toLowerCase();
      if(newNames.has(name) || lines.some(l=>String(l.location || '').trim().toLowerCase()===name)) throw new Error('The brief proposed a duplicate opening. Review the room mapping before adding it.');
      newNames.add(name);
    }
    if (patch.operationRequest && !OPERATION_REQUESTS.includes(patch.operationRequest)) throw new Error('Unrecognised operation choice.');
    return { id:`suggestion-${index}`, lineId:s.lineId || null, patch, sourceId:source.id, evidence:s.evidence, question:String(s.question || '').slice(0,1000) };
  });
}
/** One physical source opening, two mutually exclusive quote choices. Never guess hardware. */
export function expandOperationAlternatives(line) {
  if(line.operationRequest!=='Manual and automated alternatives') return [line];
  return ['Manual','Automated'].map(operation=>({...line,operationRequest:operation,choiceGroupId:line.choiceGroupId || `operation:${line.id}`,trackType:operation==='Manual'?line.manualTrackType || '':line.automatedTrackType || '',operationAlternative:operation}));
}
export function openingQuoteSnapshot(line) {
  const setup=curtainSetupForLine(line),operation=openingOperation(line);
  line={...line,...(setup?{curtainLayers:setup}:{}),...(operation?{operationRequest:operation}:{})};
  return Object.fromEntries(['operationRequest','operationAlternative','curtainLayers','trackArrangement','trackRecess','motorPower','manualTrackType','automatedTrackType','liningFabricColour','planSources','makeSizeCalculation','source','measureSource','scopePlaceholder','quantityConfirmed','takeoffRemoved','pendingPlanChanges','planRevisionReview'].filter(k=>line[k]!==undefined).map(k=>[k,line[k]]));
}
