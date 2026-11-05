import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup() {
  let handler,cleanup,frame,clicks=0,blurred=false,disabled=false,visible=true,modal=false;
  const editor={isConnected:true,getClientRects:()=>visible?[{}]:[],contains:()=>true};
  const button={isConnected:true,matches:()=>disabled,click:()=>{assert.equal(blurred,true);clicks++;}};
  const context={
    useEffect:fn=>{cleanup=fn();},
    window:{addEventListener:(_,fn)=>{handler=fn;},removeEventListener:()=>{handler=null;}},
    document:{querySelectorAll:()=>[{getClientRects:()=>modal?[{}]:[]}],activeElement:{blur:()=>{blurred=true;}}},
    requestAnimationFrame:fn=>{frame=fn;return 1;},cancelAnimationFrame:()=>{frame=null;},
    editorRef:{current:editor},saveRef:{current:button},
  };
  const source=fs.readFileSync(new URL('../src/hooks/useEditorSaveShortcut.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'').replace('export function','function');
  vm.runInNewContext(source+';useEditorSaveShortcut(editorRef,saveRef,true);',context);
  return {key:(extra={})=>{let prevented=false;handler({key:'s',metaKey:true,preventDefault:()=>{prevented=true;},...extra});return prevented;},flush:()=>{frame?.();frame=null;},count:()=>clicks,setDisabled:v=>{disabled=v;},setVisible:v=>{visible=v;},setModal:v=>{modal=v;},cleanup:()=>cleanup(),handler:()=>handler};
}
test('Cmd+S and Ctrl+S blur pending inputs and activate the existing save path once',()=>{
  const app=setup();
  assert.equal(app.key(),true);
  assert.equal(app.count(),0);
  app.flush();assert.equal(app.count(),1);
  assert.equal(app.key({metaKey:false,ctrlKey:true}),true);
  app.flush();assert.equal(app.count(),2);
  app.cleanup();assert.equal(app.handler(),null);
});
test('hidden editors, open dialogs, disabled save and repeated keys never save behind the user',()=>{
  const app=setup();
  app.setVisible(false);assert.equal(app.key(),false);app.flush();assert.equal(app.count(),0);
  app.setVisible(true);app.setModal(true);assert.equal(app.key(),false);app.flush();assert.equal(app.count(),0);
  app.setModal(false);app.setDisabled(true);assert.equal(app.key(),true);app.flush();assert.equal(app.count(),0);
  app.setDisabled(false);assert.equal(app.key({repeat:true}),true);app.flush();assert.equal(app.count(),0);
  assert.equal(app.key({altKey:true}),false);
  app.key();app.cleanup();app.flush();assert.equal(app.count(),0);
});
