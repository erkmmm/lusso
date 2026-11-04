import test from 'node:test';
import assert from 'node:assert/strict';
import {mapProjectDestination,quoteGroups,quoteRevisionOverrides,projectNextAction,isTestQuote} from '../src/lib/projectWorkspace.js';
const job={id:'j',status:'Quoted'};
const sent={id:'sent',title:'Curtains',quoteNumber:'QT-1',status:'Sent',updatedAt:'2026-11-01',lineItems:[{id:'a',unitCostPrice:100},{id:'b',type:'Optional'}],selectedLineItemIds:['b']};
test('old editors return to the same project, while customer preview links stay public',()=>{
 for(const [path,section,key,value] of [
 ['/quotes/sent/edit','quote','quote','sent'],['/measure-sheets/s/openings','measurements','sheet','s'],
 ['/jobs/j/takeoff?page=4&opening=a','measurements','view','plan'],['/jobs/j/quote-assistant','quote','ai','1'],
 ['/measure-sheets/s/purchase-order','delivery','order','new'],['/purchase-orders/o','delivery','order','o']]){
 const url=new URL(mapProjectDestination('j',path),'https://example.com');assert.equal(url.pathname,'/jobs/j');assert.equal(url.searchParams.get('section'),section);assert.equal(url.searchParams.get(key),value);
 }
 assert.equal(mapProjectDestination('j','/quotes/sent/preview'),'/quotes/sent/preview');
 assert.equal(mapProjectDestination('j','/jobs/other'),'/jobs/other');
 const plan=new URL(mapProjectDestination('j','/jobs/j/takeoff?page=4&opening=a'),'https://example.com');assert.equal(plan.searchParams.get('page'),'4');assert.equal(plan.searchParams.get('opening'),'a');
});
test('revision keeps prices and remaps the customer selection without changing the original',()=>{
 let i=0;const overrides=quoteRevisionOverrides(sent,()=>`new-${++i}`);
 assert.equal(overrides.version,2);assert.match(overrides.title,/Revision 2 of QT-1/);assert.deepEqual(overrides.selectedLineItemIds,['new-2']);assert.equal(overrides.lineItems[0].unitCostPrice,100);
 assert.deepEqual(overrides.lineItems[0].quoteWorkflow,{familyId:'sent',parentQuoteId:'sent',revision:2});assert.equal(sent.lineItems[0].id,'a');assert.deepEqual(sent.selectedLineItemIds,['b']);
 const next=quoteRevisionOverrides({...sent,...overrides,id:'second',quoteNumber:'QT-2'},()=>`next-${++i}`);assert.equal(next.version,3);assert.equal(next.lineItems[0].quoteWorkflow.familyId,'sent');assert.equal(next.title.match(/Revision/g).length,1);
});
test('test quotes and earlier revisions are visibly separated',()=>{
 const revised={...sent,...quoteRevisionOverrides(sent,()=> 'new'),id:'draft',status:'Draft'};
 const trial={...sent,id:'test',title:'TEST – Curtains',status:'Draft'};
 const groups=quoteGroups([sent,revised,trial]);assert.deepEqual(groups.drafts,[revised]);assert.deepEqual(groups.previous,[sent]);assert.deepEqual(groups.tests,[trial]);assert.equal(isTestQuote(trial),true);assert.equal(isTestQuote({...sent,title:'Testimonial curtains'}),false);
});
test('next actions target the real quote and ignore supplier test drafts',()=>{
 const trial={...sent,id:'test',title:'TEST Quote',status:'Draft',grandTotal:500};
 const next=projectNextAction(job,[],[sent,trial]);assert.equal(next.quoteId,'sent');assert.equal(next.label,'Review sent quote');
 assert.equal(projectNextAction(job,[],[trial]).section,'measurements');
 assert.equal(projectNextAction(job,[],[{...sent,status:'Accepted'}]).section,'delivery');
 const draft={...sent,id:'draft',status:'Draft',grandTotal:0};assert.equal(projectNextAction(job,[],[draft]).ai,true);
 draft.grandTotal=500;assert.equal(projectNextAction(job,[],[draft]).label,'Review draft quote');
});
