const {test}=require('node:test');const assert=require('node:assert/strict');
const Core=require('../风景调色协作平台/frontend/editor-core.js'),T=Core.tools;
const pixel=(rgb,state)=>Array.from(Core.adjustPixels(new Uint8ClampedArray([...rgb,255]),state)).slice(0,3);
test('eight-color HSL affects its color, preserves gray, and wraps continuously through red',()=>{
  const state=Core.createState();state.hsl.red.hue=70;state.hsl.green.saturation=-100;
  assert.notDeepEqual(pixel([220,30,30],state),[220,30,30]);assert.deepEqual(pixel([120,120,120],state),[120,120,120]);
  assert.deepEqual(pixel([30,30,220],state),[30,30,220]);
  const green=pixel([30,200,30],state);assert.equal(green[0],green[1]);assert.equal(green[1],green[2]);
  const a=pixel([220,30,31],state),b=pixel([220,31,30],state);assert.ok(a.every((v,i)=>Math.abs(v-b[i])<=3));
  state.hsl.blue.luminance=50;assert.ok(pixel([30,30,200],state)[2]>200);
});
test('curve interpolation is bounded, shape-preserving and reproduces identity',()=>{
  assert.ok(T.curveLUT([[0,0],[.3,.3],[1,1]]).every((v,i)=>Math.abs(v-i)<1e-8));
  const lut=T.curveLUT([[0,0],[.25,.1],[.7,.85],[1,1]]);assert.ok(lut.every((v,i)=>v>=0&&v<=255&&(!i||v>=lut[i-1])));
  const state=Core.createState();state.curves.master=[[0,0],[.5,.7],[1,1]];
  const gray=pixel([100,100,100],state);assert.ok(gray[0]>100);assert.equal(gray[0],gray[1]);assert.equal(gray[1],gray[2]);
  state.curves= T.createCurves();state.curves.red=[[0,0],[.5,.7],[1,1]];
  const red=pixel([100,100,100],state);assert.ok(red[0]>100);assert.equal(red[1],100);assert.equal(red[2],100);
});
test('HSL, curves and white balance preserve v3 compatibility and legacy v1/v2 behavior',()=>{
  const state=Core.createState();state.hsl.cyan.hue=-22;state.hsl.blue.luminance=31;
  state.curves.blue=[[0,.05],[.4,.5],[1,.95]];state.whiteBalance={gains:[1.1,1,.9],mode:'sample'};
  assert.equal(Core.toRecipe(state).version,6);assert.deepEqual(Core.recipeState(Core.createState(),Core.toRecipe(state)).state,state);
  const old=Core.toRecipe(state);old.version=3;old.steps=old.steps.filter(step=>!['detail','effects','masks'].includes(step.type));const v3=Core.recipeState(Core.createState(),old);assert.equal(v3.warnings.length,0);assert.deepEqual(v3.state,state);
  const v2=Core.recipeState(Core.createState(),{version:2,steps:[{type:'exposure',params:{value:1}},{type:'highlights',params:{value:-20}}]});
  assert.equal(v2.state.adjustments.exposure,1);assert.equal(v2.state.adjustments.highlights,-20);assert.deepEqual(v2.state.hsl,T.createHSL());
  const bad=Core.recipeState(state,{version:3,steps:[{type:'curve',params:{channel:'master',points:[[0,0],[.5,.6],[.5,.7],[1,1]]}},{type:'hsl',params:{band:'red',hue:NaN,saturation:0,luminance:0}},{type:'white-balance',params:{gains:[0,1,1],mode:'auto'}}]});
  assert.equal(bad.warnings.length,3);assert.deepEqual(bad.state,state);
});
test('histograms exclude transparent pixels and count RGB/luma bins',()=>{
  const h=T.histogram(new Uint8ClampedArray([255,0,0,255,100,100,100,255,0,0,0,0]));
  assert.equal(h.count,2);assert.equal(h.red[255],1);assert.equal(h.luma[100],1);assert.equal(h.luma.reduce((a,b)=>a+b,0),2);
});
test('white-balance sample corrects a cast and gray-world ignores saturated colors',()=>{
  const rgb=[170,150,110],state=Core.createState();state.whiteBalance={gains:T.sampleGains(rgb),mode:'sample'};
  const balanced=pixel(rgb,state);assert.ok(Math.max(...balanced)-Math.min(...balanced)<=1);
  assert.throws(()=>T.sampleGains([0,2,3]),/太暗/);
  const source=new Uint8ClampedArray(Array.from({length:40},(_,i)=>i<30?[170,150,120,255]:[255,0,0,255]).flat());
  const gains=T.autoWhiteBalance(source);assert.ok(gains[0]<1&&gains[2]>1);
  const vegetation=new Uint8ClampedArray(Array.from({length:230},(_,i)=>i<30?[170,168,165,255]:[100,150,110,255]).flat());
  assert.ok(T.autoWhiteBalance(vegetation).every(gain=>Math.abs(gain-1)<.04));
  assert.throws(()=>T.autoWhiteBalance(new Uint8ClampedArray([255,0,0,255])),/不足/);
});
test('auto exposure is deterministic and constrained by bright tones',()=>{
  const pixels=values=>new Uint8ClampedArray(values.flatMap(v=>[v,v,v,255]));
  assert.ok(T.autoExposure(pixels(new Array(100).fill(50)))>0);
  assert.ok(T.autoExposure(pixels(new Array(100).fill(210)))<0);
  assert.ok(T.autoExposure(pixels([...new Array(90).fill(30),...new Array(10).fill(250)]))<=.3);
});
test('auto/sample white balance writes editable temperature/tint without applying correction twice',()=>{
  const rgb=[170,150,120],state=Core.createState(),gains=T.sampleGains(rgb);
  Core.setWhiteBalance(state,gains,'sample');
  assert.ok(state.adjustments.temperature<0);assert.ok(Math.abs(state.adjustments.tint)>0);
  assert.ok(state.whiteBalance.gains.every((v,i)=>Math.abs(v-gains[i])<1e-12));
  const balanced=pixel(rgb,state);assert.ok(Math.max(...balanced)-Math.min(...balanced)<=1);
  assert.deepEqual(pixel([0,0,0],state),[0,0,0]);
  const recipe=Core.toRecipe(state);assert.equal(recipe.version,6);assert.deepEqual(Core.recipeState(Core.createState(),recipe).state,state);
  const start=state.adjustments.temperature;state.adjustments.temperature=start+1;Core.syncWhiteBalance(state);
  assert.notDeepEqual(pixel(rgb,state),balanced);
  state.adjustments.temperature=0;Core.syncWhiteBalance(state);assert.equal(state.adjustments.tint,recipe.steps.find(s=>s.type==='tint').params.value);
  state.adjustments.tint=0;Core.syncWhiteBalance(state);assert.deepEqual(state.whiteBalance.gains,[1,1,1]);assert.deepEqual(pixel(rgb,state),rgb);
  for(const temperature of[-100,100])for(const tint of[-100,100])assert.ok(T.whiteBalanceGains(temperature,tint).every(v=>v>=1/64&&v<=64));
  // The old gain-plus-additive scheme keeps its exact output after a v5 save.
  const old={version:4,steps:[{type:'temperature',params:{value:10}},{type:'tint',params:{value:3}},{type:'white-balance',params:{gains:[1.1,1,.9],mode:'custom'}}]};
  const legacy=Core.recipeState(Core.createState(),old).state,roundtrip=Core.recipeState(Core.createState(),Core.toRecipe(legacy)).state;
  assert.equal(legacy.whiteBalance.model,undefined);assert.deepEqual(pixel(rgb,roundtrip),pixel(rgb,legacy));
  const relative=Core.createState();Core.setWhiteBalance(relative,gains,'sample');
  const partial=Core.recipeState(relative,{version:4,steps:[{type:'white-balance',params:{gains:[1,1,1],mode:'original'}}]}).state;assert.deepEqual(pixel(rgb,partial),rgb);
  const oldManual=Core.recipeState(relative,{version:1,steps:[{type:'temperature',params:{value:5}}]}).state;
  const expected=Core.clone(relative);delete expected.whiteBalance.model;expected.adjustments.temperature=5;expected.adjustments.tint=0;assert.deepEqual(pixel(rgb,oldManual),pixel(rgb,expected));
});
test('crop edge/corner resizing stays anchored, constrained and ratio-locked',()=>{
  const start={x:.1,y:.2,width:.6,height:.5};
  const west=T.resizeCrop(start,'w',.1,0);assert.equal(west.x,.2);assert.ok(Math.abs(west.x+west.width-.7)<1e-10);
  for(const handle of ['nw','n','ne','e','se','s','sw','w'])for(const dx of [-.9,.1,.9])for(const dy of [-.9,.1,.9]){
    const rect=T.resizeCrop(start,handle,dx,dy,1,.001,.001);
    assert.ok(rect.x>=-1e-8&&rect.y>=-1e-8&&rect.x+rect.width<=1+1e-8&&rect.y+rect.height<=1+1e-8,handle);
    assert.ok(rect.width>0&&rect.height>0);assert.ok(Math.abs(rect.width/rect.height-1)<1e-8);
  }
});
