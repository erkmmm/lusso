import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const memory=new Map();
globalThis.localStorage={getItem:k=>memory.get(k) ?? null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)};
const events=new EventTarget();
globalThis.window={dispatchEvent:e=>events.dispatchEvent(e),addEventListener:(...args)=>events.addEventListener(...args),removeEventListener:(...args)=>events.removeEventListener(...args)};
const mock={name:'test-isolated-store',enforce:'pre',transform(code,id){if(id.endsWith('/src/store/storage.js')) return code.replace("import { compressToUTF16, decompressFromUTF16 } from 'lz-string';","import LZ from 'lz-string';const {compressToUTF16,decompressFromUTF16}=LZ;");},resolveId(id){if(/(?:^|\/)store\/db(?:\.js)?$/.test(id) || id==='./db') return '\0test-db';if(/(?:^|\/)lib\/supabase(?:\.js)?$/.test(id) || id==='./supabase') return '\0test-supabase';},load(id){if(id==='\0test-lz')return 'import LZ from "lz-string/libs/lz-string.js";export const {compressToUTF16,decompressFromUTF16}=LZ;';if(id==='\0test-db')return 'export const db=new Proxy({},{get:()=>()=>Promise.resolve()});export const batchUpsertCustomers=async()=>({});export const batchUpsertPricedItems=async()=>({});export const hydrateFromSupabase=async()=>({});';if(id==='\0test-supabase')return 'export const supabase={auth:{getSession:async()=>({data:{session:{access_token:"fictional-test-token"}}})}};';}};
test('actual takeoff reconciliation protects sheet answers, removals, heights and sheet ownership',async()=>{
 const vite=await createServer({configFile:false,root:new URL('..',import.meta.url).pathname,plugins:[mock],server:{middlewareMode:true,hmr:false},logLevel:'error'});
 try{
  const data=await vite.ssrLoadModule('/src/store/data.js');
  const job='fixture-job';
  const trial={id:'test-quote',jobId:job,title:'TEST – supplier trial',status:'Draft',lineItems:[],grandTotal:0};
  data.saveQuote(trial);
  assert.throws(()=>data.sendQuote(trial.id),/TEST/);
  assert.throws(()=>data.reactivateQuote(trial.id),/TEST/);
  assert.equal(data.getQuote(trial.id).status,'Draft');

  const sheet={id:'s1',jobId:job,updatedAt:'2026-11-04T00:00:00Z',lineItems:[{id:'a',source:'takeoff',takeoffGroup:'item:i1',takeoffItemId:'i1',location:'Office',lastPlanLabel:'Office',widthMm:2200,planWidthMm:2000,dropMm:2955,measureSource:'plan',fabricColour:'Chosen sheer',fixing:'Ceiling',notes:'Keep this note',quantity:1}]};
  data.saveMeasureSheet(sheet);
  const takeoff={id:'t1',jobId:job,fileName:'Plan.pdf',revision:1,items:[{id:'i1',pageNumber:1,label:'Office',quantity:1,fixing:'Face'}],measurements:[{id:'w',itemId:'i1',tag:'Width',lengthMm:2000,pageNumber:1},{id:'h',itemId:'i1',tag:'Height',lengthMm:3000,pageNumber:2}]};
  data.applyTakeoffToMeasureSheet(takeoff);
  let row=data.getMeasureSheet('s1').lineItems[0];
  assert.equal(row.widthMm,2200);assert.equal(row.dropMm,2955);assert.equal(row.fixing,'Ceiling');assert.equal(row.planHeightMm,3000);assert.deepEqual(row.pendingPlanChanges,{});assert.equal(row.notes,'Keep this note');
  data.applyTakeoffToMeasureSheet({...takeoff,revision:2,measurements:[{...takeoff.measurements[0],lengthMm:2300}]});
  row=data.getMeasureSheet('s1').lineItems[0];assert.equal(row.widthMm,2200);assert.equal(row.pendingPlanChanges.widthMm.value,2300);assert.equal(row.planRevisionReview.to,2);assert.equal(data.orderGate([row]).blocked,true);
  data.applyTakeoffToMeasureSheet({...takeoff,items:[],measurements:[]});
  row=data.getMeasureSheet('s1').lineItems[0];assert.equal(row.takeoffRemoved,true);assert.equal(row.fabricColour,'Chosen sheer');assert.equal(data.orderGate([row]).blocked,true);
  data.saveMeasureSheet({id:'s2',jobId:job,lineItems:[{id:'second-line',location:'Bedroom',productNameSnapshot:'Curtain',fabricColour:'Bedroom fabric',quantity:1,widthMm:'',dropMm:''}]});
  data.applyTakeoffToMeasureSheet({id:'t1',jobId:job,items:[{id:'i2',sheetLineId:'second-line',label:'Bedroom',quantity:1}],measurements:[{id:'w2',itemId:'i2',tag:'Width',lengthMm:1800}]});
  assert.equal(data.getMeasureSheet('s2').lineItems.length,1);assert.equal(data.getMeasureSheet('s2').lineItems[0].widthMm,1800);assert.equal(data.getMeasureSheet('s2').lineItems[0].fabricColour,'Bedroom fabric');assert.equal(data.getMeasureSheet('s1').lineItems.length,1);
  const conflict=data.saveOpeningChanges(job,{'second-line':{fabricColour:'Overwrite'}},{sheetId:'s2',baseUpdatedAt:'2020-01-01T00:00:00Z'});
  assert.equal(conflict.__conflict,true);assert.equal(data.getMeasureSheet('s2').lineItems[0].fabricColour,'Bedroom fabric');
  assert.throws(()=>data.saveOpeningChanges('different-job',{}, {sheetId:'s2'}));
  const ai=await vite.ssrLoadModule('/src/lib/openingAI.js');
  assert.equal(ai.findPlanEvidence([{text:'OFFICE CH 3000'},{text:'WINDOW SCHEDULE'}],'CH').length,1);
  const fetchBefore=globalThis.fetch;
  try {
    const sources=[{id:'p1',page:1,fileName:'Fixture.pdf',revision:1,text:'OFFICE CH 3000'}];
    globalThis.fetch=async()=>new Response(JSON.stringify({result:{heightReferences:[{sourceId:'p1',heightMm:3000,basis:'Ceiling / bracket to floor',evidence:'OFFICE CH 3000',mapping:'Confirm Office North mapping'}]} }),{status:200});
    const heights=await ai.suggestHeightReferences(job,{id:'a',location:'Office'},sources);
    assert.equal(heights[0].heightMm,3000);assert.equal(heights[0].source.page,1);
    globalThis.fetch=async()=>new Response(JSON.stringify({result:{heightReferences:[{sourceId:'p1',heightMm:2900,basis:'Ceiling / bracket to floor',evidence:'OFFICE CH 3000'}]} }),{status:200});
    await assert.rejects(()=>ai.suggestHeightReferences(job,{id:'a'},sources),/not printed/);
    globalThis.fetch=async()=>new Response(JSON.stringify({result:{suggestions:[{lineId:'a',sourceId:'customer-brief',evidence:'Office sheer only, manual.',patch:{curtainLayers:'Sheer only',operationRequest:'Manual',dropMm:9999}}]} }),{status:200});
    const specs=await ai.suggestOpeningSpecs(job,[{id:'a',location:'Office'}],[{id:'customer-brief',text:'Office sheer only, manual.'}]);
    assert.equal(specs[0].patch.operationRequest,'Manual');assert.equal('dropMm' in specs[0].patch,false);
  } finally {globalThis.fetch=fetchBefore;}

 }finally{await vite.close();delete globalThis.window;delete globalThis.localStorage;}
});
