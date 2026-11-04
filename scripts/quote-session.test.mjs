import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteSessionKey,readQuoteSession,writeQuoteSession,chooseQuoteRun} from '../src/lib/quoteSession.js';
const store=()=>{const data=new Map();return {getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};};
const pending={id:'r1',userId:'u1',jobId:'j1',sheetId:'s1',status:'needs_input',summary:'FHA needs a choice',questions:['Centre opening?'],startedAt:'2026-11-04',sessionId:'never-cache-this',process:{secret:true}};
test('reopening restores the waiting question, typed answer and exact unsaved sheet baseline without resuming',()=>{
 const storage=store();
 const state={currentRun:pending,answers:{r1:'Use centre opening'},sheetId:'s1',instructions:'TEST only',approvedSheet:{id:'s1',updatedAt:'v1'},openingDraft:{runId:'r1',sheetId:'s1',baseUpdatedAt:'v1',fills:{line:{heading:'Box Pleat'}},additions:[],briefNote:'',tab:'Openings',activeId:'line'}};
 assert.equal(writeQuoteSession(storage,'u1','j1',state),true);
 const restored=readQuoteSession(storage,'u1','j1');
 assert.deepEqual(restored.currentRun.questions,['Centre opening?']);assert.equal(restored.answers.r1,'Use centre opening');
 assert.equal(restored.openingDraft.baseUpdatedAt,'v1');assert.equal(restored.openingDraft.fills.line.heading,'Box Pleat');
 assert.equal(restored.currentRun.sessionId,undefined);assert.equal(restored.currentRun.process,undefined);
 writeQuoteSession(storage,'u1','j1',{...restored,answers:{...restored.answers,r1:''}});
 assert.equal(readQuoteSession(storage,'u1','j1').answers.r1,'');
});
test('saved progress is isolated between staff and jobs; bad caches fail closed',()=>{
 const storage=store();writeQuoteSession(storage,'u1','j1',{currentRun:pending});
 assert.deepEqual(readQuoteSession(storage,'u2','j1'),{});assert.deepEqual(readQuoteSession(storage,'u1','j2'),{});
 storage.setItem(quoteSessionKey('u2','j1'),storage.getItem(quoteSessionKey('u1','j1')));
 assert.deepEqual(readQuoteSession(storage,'u2','j1'),{});
 storage.setItem(quoteSessionKey('u1','j1'),'{broken');assert.deepEqual(readQuoteSession(storage,'u1','j1'),{});
 assert.equal(writeQuoteSession({setItem(){throw new Error('Quota');}},'u1','j1',{}),false);
});
test('unfinished requests take precedence over newer finished requests, for the exact staff member and job',()=>{
 const done={...pending,id:'r2',status:'completed',startedAt:'2026-11-05'};
 assert.equal(chooseQuoteRun([done,pending,{...pending,id:'other',jobId:'j2',startedAt:'2026-11-06'}],'u1','j1').id,'r1');
 assert.equal(chooseQuoteRun([pending],'u2','j1'),null);
});
