import test from 'node:test';
import assert from 'node:assert/strict';
import {openingFocusView} from '../src/lib/planSpecFocus.js';
import {pageToView} from '../src/lib/planRotate.js';

test('selected window stays centred with context on normal and rotated plans',()=>{
  const points=[{x:140,y:420},{x:480,y:420}],size={width:1200,height:900};
  const snapshot=JSON.stringify(points);
  for(const rotation of [0,90,180,270])for(const viewport of [{width:650,height:620},{width:360,height:220}]) {
    const view=openingFocusView(points,size,rotation,viewport);
    const shown=points.map(p=>pageToView(p,rotation,size)).map(p=>({x:p.x*view.scale+view.tx,y:p.y*view.scale+view.ty}));
    assert.ok(Math.abs((shown[0].x+shown[1].x)/2-viewport.width/2)<1e-8);
    assert.ok(Math.abs((shown[0].y+shown[1].y)/2-viewport.height/2)<1e-8);
    for(const p of shown){assert.ok(p.x>20 && p.x<viewport.width-20);assert.ok(p.y>20 && p.y<viewport.height-20);}
  }
  assert.equal(JSON.stringify(points),snapshot);
});
test('unplaced and invalid openings never invent a plan location',()=>{
  assert.equal(openingFocusView([],{width:1200,height:900},0,{width:650,height:620}),null);
  assert.equal(openingFocusView([{x:NaN,y:1}],{width:1200,height:900},0,{width:650,height:620}),null);
  assert.equal(openingFocusView([{x:1,y:1}],{width:1200,height:900},0,{width:0,height:0}),null);
});
