const {test}=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../风景调色协作平台/frontend/editor-core.js');
const Presets=require('../风景调色协作平台/frontend/editor-presets.js');
const pixels=s=>Array.from(Core.adjustPixels(new Uint8ClampedArray([35,90,205,255,45,170,70,255,220,140,40,255,120,120,120,255]),s));

test('18 distinct native presets cover six categories and roundtrip without private session metadata',()=>{
  assert.equal(Presets.catalog.length,18);assert.equal(Presets.byId.size,18);
  const signatures=new Set();
  for(const category of Presets.categories)assert.equal(Presets.catalog.filter(p=>p.category===category.key).length,3);
  for(const preset of Presets.catalog){
    const state=Presets.apply(Core.createState(),preset.id);signatures.add(JSON.stringify(Presets.snapshot(state)));
    assert.ok(Core.effects.valid(state.effects));assert.ok(Core.tools.channels.every(c=>Core.tools.validCurve(state.curves[c])));
    const recipe=Core.toRecipe(state),restored=Core.recipeState(Core.createState(),recipe);
    assert.equal(recipe.version,6);assert.equal(JSON.stringify(recipe).includes('presetSession'),false);assert.deepEqual(restored.warnings,[]);
    assert.deepEqual(Presets.snapshot(restored.state),Presets.snapshot(state));assert.deepEqual(pixels(restored.state),pixels(state));
  }
  assert.equal(signatures.size,18);
});

test('switching presets replaces all managed fields and keeps exposure, white balance, geometry and masks',()=>{
  const base=Core.createState();base.adjustments.exposure=.65;base.adjustments.brightness=3;Core.setWhiteBalance(base,[1.12,1,.91],'sample');
  base.geometry=[{type:'rotate',params:{angle:90}}];base.masks=[Core.masks.create('linear','test')];base.effects.vignette.centerX=30;
  const input=Core.clone(base),first=Presets.apply(base,'neon-city'),second=Presets.apply(first,'airy-postcard'),direct=Presets.apply(base,'airy-postcard');
  assert.deepEqual(base,input);assert.deepEqual(Presets.snapshot(second),Presets.snapshot(direct));
  assert.equal(second.detail.color,0);assert.equal(second.effects.dehaze,0);assert.equal(second.hsl.magenta.saturation,0);
  for(const key of ['exposure','temperature','tint','brightness'])assert.equal(second.adjustments[key],base.adjustments[key]);
  assert.deepEqual(second.whiteBalance,base.whiteBalance);assert.deepEqual(second.geometry,base.geometry);assert.deepEqual(second.masks,base.masks);assert.equal(second.effects.vignette.centerX,30);
  const zero=Presets.setAmount(second,0);assert.deepEqual(Presets.snapshot(zero),Presets.snapshot(base));
  const removed=Presets.remove(second);assert.equal(removed.presetSession,undefined);assert.deepEqual(removed,base);
});

test('manual fields are pinned while remaining preset strength can still be reduced or removed',()=>{
  const base=Core.createState();base.adjustments.contrast=3;let state=Presets.apply(base,'golden-sunset');
  state.adjustments.contrast=27;state.hsl.green.hue=11;state.curves.blue=[[0,.02],[.4,.5],[1,.97]];state.effects.clarity=9;
  Presets.reconcile(state);assert.equal(state.presetSession.manual,true);
  state=Presets.setAmount(state,0);
  assert.equal(state.adjustments.contrast,27);assert.equal(state.hsl.green.hue,11);assert.equal(state.effects.clarity,9);assert.deepEqual(state.curves.blue,[[0,.02],[.4,.5],[1,.97]]);
  assert.equal(state.hsl.orange.saturation,0);assert.deepEqual(Presets.setAmount(state,100).curves.blue,state.curves.blue);
  state=Presets.remove(state);assert.equal(state.adjustments.contrast,27);assert.equal(state.presetSession,undefined);
});

test('strength remains bounded with valid curves even when original and preset knots do not match',()=>{
  const base=Core.createState();base.curves.master=Array.from({length:10},(_,i)=>[i/9,(i/9)**1.1]);
  const full=Presets.apply(base,'soft-fade');
  for(const amount of [-5,0,1,37,99,100,150,NaN]){
    const state=Presets.setAmount(full,amount);
    for(const channel of Core.tools.channels)assert.ok(Core.tools.validCurve(state.curves[channel]));
    assert.ok(state.presetSession.amount>=0&&state.presetSession.amount<=100);
  }
  assert.deepEqual(Presets.setAmount(full,0).curves.master,base.curves.master);
  assert.deepEqual(Presets.setAmount(full,100).curves.master,full.curves.master);
});

test('monochrome presets retain original hue-based luminance control and do not force a pre-HSL global desaturation',()=>{
  const state=Presets.apply(Core.createState(),'mono-landscape');assert.equal(state.adjustments.saturation,0);assert.equal(state.filter,null);
  const result=pixels(state);for(let i=0;i<result.length;i+=4)assert.ok(Math.max(...result.slice(i,i+3))-Math.min(...result.slice(i,i+3))<=1);
  const changed=Core.clone(state);changed.hsl.blue.luminance=30;assert.notDeepEqual(pixels(changed),result);
});

test('undo/redo restores selected preset, strength endpoints and manual overrides together',()=>{
  const initial=Core.createState(),history=Core.createHistory(initial);let state=Presets.apply(initial,'deep-forest');history.commit(state);
  state=Presets.setAmount(state,42);history.commit(state);state.adjustments.contrast=28;Presets.reconcile(state);history.commit(state);
  state=Presets.apply(state,'rose-dusk');history.commit(state);
  state=history.undo();assert.equal(state.presetSession.id,'deep-forest');assert.equal(state.presetSession.amount,42);assert.equal(state.adjustments.contrast,28);
  assert.equal(Presets.setAmount(state,0).adjustments.contrast,28);
  state=history.undo();assert.equal(state.presetSession.manual,false);assert.equal(state.presetSession.amount,42);
  state=history.redo();assert.equal(state.presetSession.manual,true);assert.equal(state.adjustments.contrast,28);
});
