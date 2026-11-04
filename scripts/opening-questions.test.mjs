import test from 'node:test';
import assert from 'node:assert/strict';
import {openingQuestionFields} from '../src/lib/openingQuestions.js';
const complete={productNameSnapshot:'Curtain',widthMm:2000,dropMm:2400,fabricColour:'Kindness Platinum',operationRequest:'Manual',curtainLayers:'Sheer only',heading:'Reverse Pleat',trackType:'Fineline',measureSource:'plan'};
test('show actual missing fields, excluding completed specs and order-only checks',()=>{
 assert.deepEqual(openingQuestionFields(complete),[]);
 assert.deepEqual(openingQuestionFields({...complete,dropMm:'',fabricColour:''}),['dropMm','fabricColour']);
});
test('keep a field mounted while typing until the saved sheet catches up',()=>{
 const saved={...complete,fabricColour:''},editing={...saved,fabricColour:'K'};
 assert.deepEqual(openingQuestionFields(saved,editing),['fabricColour']);
 assert.deepEqual(openingQuestionFields(editing,editing),[]);
});
test('changing an answer exposes the additional price-affecting boxes without asking for known values again',()=>{
 const editing={...complete,operationRequest:'Manual and automated alternatives',manualTrackType:'Fineline',curtainLayers:'Separate sheer and blockout'};
 assert.deepEqual(openingQuestionFields({...complete,manualTrackType:'Fineline'},editing),['liningFabricColour','automatedTrackType']);
 const legacy={...complete,curtainLayers:'',liningMode:'separate',liningFabricColour:'Simplicity Off White'};
 assert.deepEqual(openingQuestionFields(legacy),[]);
});
