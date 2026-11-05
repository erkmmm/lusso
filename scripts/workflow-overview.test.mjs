import test from 'node:test';
import assert from 'node:assert/strict';
import {matchesProjectView,hasInstallation,deliveryOverview,approvedOrderSelection,prioritiseToday} from '../src/lib/workflowOverview.js';
import {searchAppRecords} from '../src/lib/appSearch.js';

const job={id:'j',customerId:'c',jobNumber:'LUS-12',status:'Measured',siteAddress:'45 Coastal Road'};
const customer={id:'c',name:'Fixture Customer',address:'45 Coastal Road'};
const sent={id:'q',jobId:'j',customerId:'c',quoteNumber:'QT-77',status:'Sent',title:'Blinds'};
test('project views respect approval, delivery, closed projects and test drafts',()=>{
  assert.equal(matchesProjectView(job,'quoting',[]),true);
  assert.equal(matchesProjectView(job,'quoting',[sent]),false);
  assert.equal(matchesProjectView(job,'approval',[sent]),true);
  const accepted={...sent,status:'Accepted'};
  assert.equal(matchesProjectView(job,'approval',[sent,accepted]),false);
  assert.equal(matchesProjectView(job,'ordering',[accepted]),true);
  assert.equal(matchesProjectView({...job,status:'Ordered'},'ordering',[accepted]),false);
  assert.equal(matchesProjectView({...job,status:'Completed'},'booking',[accepted]),false);
  assert.equal(matchesProjectView(job,'quoting',[{...sent,title:'TEST Quote'}]),true);
  assert.equal(matchesProjectView(job,'booking',[accepted],[{jobId:'j',status:'Declined'}]),true);
  assert.equal(matchesProjectView(job,'booking',[accepted],[{jobId:'j',status:'Sent'}]),false);
  assert.equal(hasInstallation('j',[],[{jobId:'j',eventType:'consultation'}]),false);
});
test('delivery keeps explicit customer options and matches issued lines to the correct sheet',()=>{
  const accepted={...sent,status:'Accepted',selectedLineItemIds:['optional'],lineItems:[
    {id:'standard',type:'Standard',measureSheetLineItemId:'a'},
    {id:'optional',type:'Optional',measureSheetLineItemId:'b'},
    {id:'declined',type:'Optional',preselected:true,measureSheetLineItemId:'c'},
    {id:'heading',type:'Heading'},
  ]};
  const sheets=[{id:'s',lineItems:[{id:'a'},{id:'b'},{id:'c'}]}];
  const orders=[{status:'draft',measureSheetId:'s',draftSnapshot:{lineKeys:['a']}},{status:'sent',measureSheetId:'other',snapshot:{lineKeys:['b']}}];
  let result=deliveryOverview(job,[accepted],sheets,orders);
  assert.deepEqual(result.approvedItems.map(r=>r.item.id),['standard','optional']);
  assert.equal(result.outstanding.length,2);
  orders.push({status:'sent',measureSheetId:'s',snapshot:{lineKeys:['a']}});
  result=deliveryOverview({...job,status:'Received'},[accepted],sheets,orders);
  assert.equal(result.outstanding[0].item.id,'optional');
  assert.equal(result.received,true);
  assert.equal(result.booked,false);
  assert.equal(deliveryOverview(job,[accepted],sheets,orders,[{jobId:'j',status:'Sent'}]).booked,false);
  assert.equal(deliveryOverview(job,[accepted],sheets,orders,[{jobId:'j',status:'Sent'}]).bookingPending,true);
  assert.equal(deliveryOverview(job,[accepted],sheets,orders,[{jobId:'j',status:'Accepted'}]).booked,true);
  assert.deepEqual([...approvedOrderSelection(job,[accepted],sheets,orders,'s').lineIds],['b']);
  assert.equal(approvedOrderSelection(job,[accepted],sheets,orders,'other'),null);
  assert.equal(deliveryOverview(job,[],sheets,orders).accepted,undefined);
});
test('Today places installations, rework and overdue work before routine follow-up',()=>{
  const result=prioritiseToday([
    {key:'quotes',label:'Quotes',items:[{id:'1'}]},
    {key:'tasks',label:'To-dos',items:[{id:'2'},{id:'3',urgent:true}]},
    {key:'installs',label:'Today',items:[{id:'4'}]},
  ]);
  assert.deepEqual(result.map(r=>r.id),['4','3','2','1']);
  assert.equal(result[0].action,'Open installation');
});
test('global search finds names, addresses and quote numbers within accessible projects',()=>{
  const records={customers:[customer],jobs:[job],quotes:[sent,{...sent,id:'hidden',jobId:'private'}]};
  assert.equal(searchAppRecords(records,'LUS-12')[0].to,'/jobs/j');
  assert.ok(searchAppRecords(records,'coastal fixture').some(r=>r.kind==='Project'));
  assert.match(searchAppRecords(records,'QT-77')[0].to,/section=quote&quote=q/);
  assert.equal(searchAppRecords(records,'QT-77').length,1);
  assert.equal(searchAppRecords(records,'unknown').length,0);
  assert.equal(searchAppRecords(records,'').length,0);
  assert.equal(searchAppRecords({...records,jobs:[{...job,deletedAt:'today'}]},'LUS-12').length,0);
});
