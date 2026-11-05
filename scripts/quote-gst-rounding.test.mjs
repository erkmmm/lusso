import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteGst} from '../src/lib/quoteGst.js';

test('accepted document tax and total remain exact with per-line rounding',()=>{
  const lines=[1520.72,496.78,886.26,885.18,852.13,614.55,1890,610,743.26,809.40,743.26,1072.24,1035.68];
  const subtotal=lines.reduce((a,b)=>a+b,0);
  assert.equal(Number(subtotal.toFixed(2)),12159.46);
  assert.equal(quoteGst(lines,10,1,true),1215.96);
  assert.equal(Number((subtotal+quoteGst(lines,10,1,true)).toFixed(2)),13375.42);
  assert.equal(Number(quoteGst(lines,10).toFixed(2)),1215.95);
});
test('per-line rounding handles credit lines, discounts and empty taxable totals',()=>{
  assert.equal(quoteGst([10.05,-10.05],10,1,true),0);
  assert.equal(quoteGst([20.10],10,.5,true),1.01);
  assert.equal(quoteGst([],10,1,true),0);
  assert.equal(quoteGst([100],0,1,true),0);
  assert.equal(quoteGst([100,50],10,.9),13.5);
});
