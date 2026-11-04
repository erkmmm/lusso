import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateMakeSize,planUpdate,previewBulk,parseOpeningSuggestions,readiness,editOpening,openingGaps,curtainSetupForLine} from '../src/lib/openingWorkflow.js';
test('finished sizes require explicit deductions, separate ceiling and window height',()=>{
 assert.equal(calculateMakeSize({widthBasis:'Opening width',rawWidthMm:2000,dropBasis:'Ceiling / bracket to floor',rawDropMm:3000}).valid,false);
 const result=calculateMakeSize({widthBasis:'Opening width',rawWidthMm:2000,leftAllowanceMm:100,rightAllowanceMm:100,dropBasis:'Ceiling / bracket to floor',rawDropMm:3000,trackDeductionMm:35,floorClearanceMm:10});
 assert.equal(result.valid,true);assert.equal(result.widthMm,2200);assert.equal(result.dropMm,2955);
 assert.equal(calculateMakeSize({widthBasis:'Finished track width',rawWidthMm:2000,dropBasis:'Finished make drop',rawDropMm:2400}).dropMm,2400);
});
test('plan movements retain confirmed specs and dimensions; empty measurements do not erase answers',()=>{
 const line={id:'a',widthMm:2100,dropMm:2400,fabricColour:'Selected',fixing:'Ceiling',measureSource:'site'};
 const result=planUpdate(line,{itemId:'i',widthMm:2200,dropMm:'',label:'Office'},{revision:2});
 assert.equal(result.widthMm,2100);assert.equal(result.dropMm,2400);assert.equal(result.fabricColour,'Selected');assert.equal(result.pendingPlanChanges.widthMm.value,2200);
 assert.equal(planUpdate({id:'a',widthMm:2100},{widthMm:2200}).widthMm,2100);
});
test('bulk changes preserve existing answers unless overwrite was explicitly chosen',()=>{
 const lines=[{id:'a',fabricColour:'Selected'},{id:'b',fabricColour:''}];
 assert.deepEqual(previewBulk(lines,['a','b'],{fabricColour:'New'}).map(x=>x.line.id),['b']);
 assert.equal(previewBulk(lines,['a','b'],{fabricColour:'New'},true).length,2);
});
test('brief review rejects invented citations, wrong jobs and arbitrary fields',()=>{
 const sources=[{id:'email',text:'Office sheer only, manual.'}], lines=[{id:'a'}];
 const value={suggestions:[{lineId:'a',sourceId:'email',evidence:sources[0].text,patch:{operationRequest:'Manual',widthMm:9999}}]};
 assert.deepEqual(parseOpeningSuggestions(JSON.stringify(value),lines,sources)[0].patch,{operationRequest:'Manual'});
 assert.throws(()=>parseOpeningSuggestions(JSON.stringify({suggestions:[{...value.suggestions[0],evidence:'Invented'}]}),lines,sources));
 assert.throws(()=>parseOpeningSuggestions(JSON.stringify({suggestions:[{...value.suggestions[0],lineId:'other-job'}]}),lines,sources));
});
test('readiness counts openings per decision and every edit carries a recoverable history',()=>{
 const lines=[{id:'a'},{id:'b'}];assert.equal(readiness(lines).find(x=>x.label==='Measurements').lineIds.length,2);
 const edited=editOpening({id:'a',heading:'Wave Fold'},{heading:'Reverse Pleat'},{by:'Jett',source:'Review'});
 assert.equal(edited.specHistory[0].changes[0].from,'Wave Fold');assert.equal(edited.specHistory[0].changes[0].to,'Reverse Pleat');
});
test('unrelated plan saves do not question a calculated size or a renamed sheet opening',()=>{
 const line={id:'a',location:'Office North',lastPlanLabel:'Office A',widthMm:2300,planWidthMm:2100,dropMm:2955,planDropMm:'',makeSizeCalculation:{},reviewedPlanValues:{}};
 const unchanged=planUpdate(line,{itemId:'i',label:'Office A',widthMm:2100,dropMm:''});
 assert.deepEqual(unchanged.pendingPlanChanges,{});assert.equal(unchanged.location,'Office North');assert.equal(unchanged.widthMm,2300);
 const changed=planUpdate(line,{itemId:'i',label:'Office A',widthMm:2200,dropMm:''});
 assert.equal(changed.pendingPlanChanges.widthMm.value,2200);
 const kept=planUpdate({...changed,pendingPlanChanges:{},reviewedPlanValues:{widthMm:2200}},{itemId:'i',label:'Office A',widthMm:2200,dropMm:''});
 assert.deepEqual(kept.pendingPlanChanges,{});
});
test('manual and automated choices remain mutually exclusive snapshots of one opening',async()=>{
 const {expandOperationAlternatives,openingQuoteSnapshot}=await import('../src/lib/openingWorkflow.js');
 const line={id:'a',quantity:2,operationRequest:'Manual and automated alternatives',trackType:'Unknown shared track',manualTrackType:'KAW',automatedTrackType:'Oslo 84 (240v)',planSources:[{page:3}],measureSource:'plan'};
 const choices=expandOperationAlternatives(line);
 assert.equal(choices.length,2);assert.equal(choices[0].id,choices[1].id);assert.equal(choices[0].choiceGroupId,choices[1].choiceGroupId);assert.equal(choices[0].quantity,2);assert.equal(choices[0].trackType,'KAW');assert.equal(choices[1].trackType,'Oslo 84 (240v)');
 assert.equal(expandOperationAlternatives({...line,manualTrackType:''})[0].trackType,'');
 assert.deepEqual(openingQuoteSnapshot(line).planSources,[{page:3}]);
});

test('plan dimensions can be quoted without manufacturing calculations, with site check still required',()=>{
 const line={id:'plan',source:'takeoff',measureSource:'plan',widthMm:2200,dropMm:2700,productNameSnapshot:'Curtain',fabricColour:'Selected sheer',operationRequest:'Manual',curtainLayers:'Sheer only',heading:'Wave Fold',trackType:'KAW',fixing:'Ceiling',trackRecess:'Recessed / built into ceiling',control:'C/O'};
 assert.deepEqual(openingGaps(line).pricing,[]);
 assert.ok(openingGaps(line).ordering.includes('Check measure'));
 assert.ok(openingGaps({...line,dropMm:''}).pricing.includes('Measurements'));
 assert.equal(line.makeSizeCalculation,undefined);
});

test('curtain setup uses explicit legacy specs without guessing from double tracks',()=>{
 const base={productNameSnapshot:'Curtain',fabricColour:'Selected',widthMm:2000,dropMm:2400};
 assert.equal(curtainSetupForLine({...base,liningMode:'separate'}),'Separate sheer and blockout');
 assert.equal(curtainSetupForLine({...base,attachedLining:true}),'Curtain with attached lining');
 assert.equal(curtainSetupForLine({...base,productNameSnapshot:'Manual Reverse Pleat Sheer Curtain'}),'Sheer only');
 assert.equal(curtainSetupForLine({...base,productNameSnapshot:'Double Curtain Track'}),'');
 assert.equal(curtainSetupForLine({...base,curtainLayers:'Blockout only',liningMode:'separate'}),'Blockout only');
 assert.ok(openingGaps({...base,liningMode:'separate'}).pricing.includes('Blockout / lining fabric'));
 assert.ok(!openingGaps({...base,liningMode:'separate'}).pricing.includes('Curtain setup'));
 assert.ok(openingGaps({...base,productNameSnapshot:'Double Curtain Track'}).pricing.includes('Curtain setup'));
});
