import test from 'node:test';
import assert from 'node:assert/strict';
import {libraryItemFromQuoteLine, duplicateLibraryName, moveQuoteText, swapQuoteGroups} from '../src/lib/quoteBuilderItems.js';
import {describeLine} from '../src/lib/describeLine.js';
import {quoteSections} from '../src/lib/quoteSections.js';

const line = {
  id:'quote-line', productTypeId:'curtain', productNameSnapshot:'Curtain', customName:'Bespoke curved pelmet',
  description:'Made to fit the bay window', unitCostPrice:'125.50', labourCost:'20', marginPercent:0,
  manualSellPrice:'250.75', quantity:8, discountPercent:15, location:'Office A', widthMm:2000,
  internalNotes:'Private supplier negotiation', customerNotes:'One-off instructions', pricedItemId:'original-library-item', supplier:'Supplier', taxable:true,
};
test('custom quote names override composed names without changing the source product',()=>{
  assert.equal(describeLine(line,[{id:'curtain',name:'Curtain'}]),'Bespoke curved pelmet');
  assert.equal(line.productNameSnapshot,'Curtain');
  assert.equal(describeLine({...line,customName:null},[{id:'curtain',name:'Curtain'}]),'Curtain');
});
test('explicit library copy preserves base unit pricing including zero margin, without quote-specific data',()=>{
  const item=libraryItemFromQuoteLine(line,{id:'new-id',productTypes:[{id:'curtain',name:'Curtain'}]});
  assert.equal(item.id,'new-id'); assert.equal(item.itemName,line.customName);
  assert.equal(item.costPrice,125.5); assert.equal(item.labourCost,20); assert.equal(item.sellPrice,250.75); assert.equal(item.marginPercent,0);assert.equal(item.category,'Curtain');
  for (const key of ['quantity','discountPercent','internalNotes','customerNotes','location','widthMm','pricedItemId']) assert.equal(Object.hasOwn(item,key),false,key);
  assert.equal(line.pricedItemId,'original-library-item');
});
test('free items, GST-free items and size-based prices remain reusable',()=>{
  const free=libraryItemFromQuoteLine({...line,manualSellPrice:0,taxable:false},{id:'free'});
  assert.equal(free.sellPrice,0); assert.equal(free.gstApplicable,false);assert.equal(free.taxRate,0);
  const calculated=libraryItemFromQuoteLine({...line,manualSellPrice:'',pricePerSqm:'45.25'},{id:'sqm'});
  assert.equal(calculated.sellPrice,null);assert.equal(calculated.pricePerSqm,45.25);
});
test('invalid names and invalid costs cannot enter the library',()=>{
  assert.throws(()=>libraryItemFromQuoteLine(line,{name:'   '}),/item name/);
  for (const value of [-1,'abc',Infinity]) assert.throws(()=>libraryItemFromQuoteLine({...line,unitCostPrice:value}),/Material cost/);
});
test('duplicate names include inactive library records and ignore case/outer spaces',()=>{
  assert.equal(duplicateLibraryName([{itemName:' Pelmet ',isActive:false}],'PELMET'),true);
  assert.equal(duplicateLibraryName([{itemName:'Pelmet'}],'Bay pelmet'),false);
});
test('text block movement respects before/after positions and boundaries',()=>{
  const items=[{id:'a',placement:'before'},{id:'b',placement:'after'},{id:'c',placement:'before'}];
  assert.deepEqual(moveQuoteText(items,'c',-1).map(i=>i.id),['c','b','a']);
  assert.deepEqual(moveQuoteText(items,'a',-1),items);
  assert.deepEqual(moveQuoteText(items,'unknown',1),items);
  assert.deepEqual(items.map(i=>i.id),['a','b','c']);
});
test('moving rooms retains choice groups, prices, stable window references and customer order',()=>{
  const lines=[{id:'a',location:'Office A',type:'Multiple Choice',choiceGroupId:'blind',sortOrder:0},{id:'b',location:'Office A',type:'Multiple Choice',choiceGroupId:'blind',sortOrder:1},{id:'c',location:'Office B',type:'Required',sortOrder:2},{id:'d',location:'Kitchen',type:'Required',sortOrder:3}];
  const moved=swapQuoteGroups(lines,['a','b','c'],['d']);
  assert.deepEqual(moved.map(i=>i.id),['d','a','b','c']);
  const rooms=quoteSections(moved); assert.equal(rooms[0].room,'Kitchen'); assert.equal(rooms[1].room,'Office');
  assert.deepEqual(rooms[1].entries[0].blocks[0].items.map(i=>i.id),['a','b']);
  assert.equal(rooms[1].entries[0].ref,'A');assert.equal(rooms[1].entries[1].ref,'B');
  const entryMoved=quoteSections(swapQuoteGroups(moved,['a','b'],['c']))[1];
  assert.equal(entryMoved.entries[0].ref,'B');assert.equal(entryMoved.entries[1].ref,'A');
  assert.deepEqual(lines.map(i=>i.sortOrder),[0,1,2,3]);
});
