const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../风景调色协作平台/frontend/editor-core.js');

test('history restores adjustments, geometry and filter as one document', () => {
  const state = Core.createState(), history = Core.createHistory(state);
  state.adjustments.brightness = 24;
  state.geometry.push({ type: 'rotate', params: { angle: 90 } });
  state.filter = 'film'; history.commit(state);
  state.adjustments.brightness = 53; history.commit(state);
  const restored = history.undo();
  assert.equal(restored.adjustments.brightness, 24);
  assert.equal(restored.filter, 'film');
  assert.equal(restored.geometry[0].params.angle, 90);
  restored.geometry.length = 0;
  assert.equal(history.current().geometry.length, 1);
  assert.equal(history.redo().adjustments.brightness, 53);
});
test('one gesture commits once, no-op is ignored and a new edit removes redo', () => {
  const state = Core.createState(), history = Core.createHistory(state);
  for (let i = 0; i <= 50; i++) state.adjustments.brightness = i;
  history.commit(state); history.commit(state);
  assert.equal(history.length, 2);
  assert.equal(history.undo().adjustments.brightness, 0);
  state.adjustments.contrast = 12; history.commit(state);
  assert.equal(history.canRedo, false);
});
test('history supports twenty undo actions with bounded state storage', () => {
  const state = Core.createState(), history = Core.createHistory(state);
  for (let i = 1; i <= 30; i++) { state.adjustments.brightness = i; history.commit(state); }
  assert.equal(history.length, 21);
  let count = 0;
  while (history.canUndo) { history.undo(); count++; }
  assert.equal(count, 20); assert.equal(history.current().adjustments.brightness, 10);
});
test('recipe preview never mutates its base and validates unknown and nonfinite steps', () => {
  const base = Core.createState(); base.filter = 'film';
  const result = Core.recipeState(base, [
    { type: 'brightness', params: { value: 500 } },
    { type: 'tint', params: { value: -12 } },
    { type: 'run-script', params: { value: 'anything' } },
    { type: 'exposure', params: { value: Infinity } }
  ]);
  assert.equal(base.adjustments.brightness, 0); assert.equal(base.filter, 'film');
  assert.equal(result.state.adjustments.brightness, 100);
  assert.equal(result.state.adjustments.tint, -12);
  assert.equal(result.warnings.length, 2);
  assert.throws(() => Core.recipeState(base, '{broken'));
});
test('recipe roundtrip preserves geometry, filter strength and neutral values', () => {
  const state = Core.createState();
  state.geometry.push({ type: 'crop', params: { x: 0.1, y: 0.2, width: 0.8, height: 0.7, unit: 'normalized' } });
  state.geometry.push({ type: 'rotate', params: { angle: -17 } });
  state.filter = 'bw'; state.filterStrength = 46; state.adjustments.tint = 8;
  const result = Core.recipeState(Core.createState(), JSON.stringify(Core.toRecipe(state)));
  assert.deepEqual(result.state, state); assert.deepEqual(result.warnings, []);
});
test('rotations and crops use original dimensions independently of display size', () => {
  assert.deepEqual(Core.outputSize(2400, 1600, [{ type: 'rotate', params: { angle: 90 } }]), { width: 1600, height: 2400 });
  assert.deepEqual(Core.outputSize(2400, 1600, [{ type: 'crop', params: { width: 0.5, height: 0.75 } }]), { width: 1200, height: 1200 });
});
test('neutral pixels are unchanged, saturation removes color and alpha survives', () => {
  const pixels = new Uint8ClampedArray([36, 127, 208, 210, 255, 0, 0, 0]);
  assert.deepEqual(Core.adjustPixels(pixels.slice(), Core.createState()), pixels);
  const state = Core.createState(); state.adjustments.saturation = -100;
  const out = Core.adjustPixels(pixels.slice(), state);
  assert.equal(out[0], out[1]); assert.equal(out[1], out[2]); assert.equal(out[3], 210);
  assert.equal(out[4], 255); assert.equal(out[7], 0);
});
test('positive highlights brighten light pixels and positive shadows lift black', () => {
  const state = Core.createState(); state.adjustments.shadows = 30; state.adjustments.highlights = 30;
  const pixels = Core.adjustPixels(new Uint8ClampedArray([0, 0, 0, 255, 210, 210, 210, 255]), state);
  assert.ok(pixels[0] > 0); assert.ok(pixels[4] > 210);
});
test('filter rendering is deterministic and zero strength equals no filter', () => {
  const input = new Uint8ClampedArray([100, 128, 160, 255]);
  const state = Core.createState(); state.filter = 'film';
  assert.deepEqual(Core.adjustPixels(input.slice(), state), Core.adjustPixels(input.slice(), state));
  state.filterStrength = 0;
  assert.deepEqual(Core.adjustPixels(input.slice(), state), input);
});

test('legacy recipes reproduce frozen v1 pixel output after explicit unit/sign migration', () => {
  const crypto = require('node:crypto');
  const fixture = require('./fixtures/legacy-rendering.json');
  for (const entry of fixture.cases) {
    const old = entry.state;
    const steps = Object.entries(old.adjustments).map(([type, value]) => ({ type, params: { value } }));
    steps.push({ type: 'filter', params: { name: old.filter, strength: old.filterStrength } });
    for (const recipe of [{ version: 1, steps }, { steps: JSON.stringify(steps) }, steps]) {
      const migrated = Core.recipeState(Core.createState(), recipe);
      const output = Core.adjustPixels(new Uint8ClampedArray(Array.from({length:fixture.pixelCount},(_,i)=>(i*73+i*i*19)%256)), migrated.state);
      assert.equal(crypto.createHash('sha256').update(output).digest('hex'), entry.sha256);
      assert.match(migrated.warnings[0], /已兼容旧配方/);
      const roundtrip = Core.recipeState(Core.createState(), Core.toRecipe(migrated.state));
      assert.deepEqual(roundtrip.state, migrated.state);
      assert.deepEqual(Core.adjustPixels(new Uint8ClampedArray(Array.from({length:fixture.pixelCount},(_,i)=>(i*73+i*i*19)%256)),roundtrip.state),output);
    }
  }
});

test('v2 recipes preserve EV, highlight direction and new controls; unsupported versions are rejected', () => {
  const state = Core.createState();
  Object.assign(state.adjustments, { exposure: 0.75, highlights: -25, whites: -18, blacks: 23, vibrance: 46 });
  assert.equal(Core.toRecipe(state).version, 6);
  assert.deepEqual(Core.recipeState(Core.createState(), Core.toRecipe(state)).state, state);
  const parsed = Core.recipeState(state, { version: 2, steps: [
    { type: 'exposure', params: { value: 500 } }, { type: 'whites', params: { value: -500 } },
    { type: '__proto__', params: { value: 5 } }, { type: 'blacks', params: { value: NaN } }
  ] });
  assert.equal(parsed.state.adjustments.exposure, 3); assert.equal(parsed.state.adjustments.whites, -100);
  assert.equal(parsed.warnings.length, 2);
  assert.throws(() => Core.recipeState(state, { version: 999, steps: [] }), /版本/);
  assert.throws(() => Core.recipeState(state, { version: '2', steps: [] }), /版本/);
  assert.throws(() => Core.recipeState(state, { version: 2, steps: [], rendering: { legacyTone: { highlights: 'yes' } } }), /兼容/);
});

test('white and black endpoints have narrower tonal influence than highlights and shadows', () => {
  const input = new Uint8ClampedArray([32,32,32,255,128,128,128,255,223,223,223,255]);
  const effect = (key, value) => { const state = Core.createState(); state.adjustments[key] = value; return Core.adjustPixels(input.slice(), state); };
  const white = effect('whites', 50), black = effect('blacks', 50);
  assert.ok(white[8] > input[8]); assert.ok(white[8] - input[8] > white[4] - input[4]);
  assert.ok(black[0] > input[0]); assert.ok(black[0] - input[0] > black[4] - input[4]);
  assert.ok(effect('whites', -50)[8] < input[8]); assert.ok(effect('blacks', -50)[0] < input[0]);
  assert.ok(effect('highlights', 50)[4] > white[4]); assert.ok(effect('shadows', 50)[4] > black[4]);
});

test('vibrance favors muted colors, preserves gray and alpha, and differs from saturation', () => {
  const input = new Uint8ClampedArray([140,125,115,210,220,55,20,255,120,120,120,255]);
  const state = Core.createState(); state.adjustments.vibrance = 60;
  const out = Core.adjustPixels(input.slice(), state);
  const chroma = (pixels, i) => Math.max(...pixels.slice(i,i+3)) - Math.min(...pixels.slice(i,i+3));
  assert.ok((chroma(out,0)-chroma(input,0))/chroma(input,0) > (chroma(out,4)-chroma(input,4))/chroma(input,4));
  assert.deepEqual(out.slice(8), input.slice(8)); assert.equal(out[3],210);
  state.adjustments.vibrance = -60;
  assert.ok(chroma(Core.adjustPixels(input.slice(),state),0) < chroma(input,0));
  state.adjustments.vibrance = 0; state.adjustments.saturation = 60;
  assert.notDeepEqual(Core.adjustPixels(input.slice(),state),out);
});

test('endpoint extremes remain monotonic on a gray ramp and do not tint neutral pixels', () => {
  const ramp = new Uint8ClampedArray(Array.from({length:256},(_,v)=>[v,v,v,255]).flat());
  for (const key of ['whites','blacks','highlights','shadows']) {
    for (const value of [-100,100]) {
      const state=Core.createState(); state.adjustments[key]=value;
      const out=Core.adjustPixels(ramp.slice(),state);
      for(let i=0;i<out.length;i+=4) {
        assert.equal(out[i],out[i+1]); assert.equal(out[i+1],out[i+2]);
        if(i>0) assert.ok(out[i]>=out[i-4], `${key} ${value} reverses gray ramp at ${i/4}`);
      }
    }
  }
  // Combined extremes with reduced exposure can otherwise reverse the darkest tones.
  for(const exposure of [-3,0,3]) {
    for(let mask=0;mask<16;mask++) {
      const state=Core.createState();state.adjustments.exposure=exposure;
      ['whites','blacks','highlights','shadows'].forEach((key,i)=>{state.adjustments[key]=(mask&(1<<i))?100:-100;});
      const out=Core.adjustPixels(ramp.slice(),state);
      for(let i=4;i<out.length;i+=4) assert.ok(out[i]>=out[i-4], `EV ${exposure}, combination ${mask}, gray ${i/4}`);
    }
  }
});

test('pixel processing reads UI state a bounded number of times, independent of image size', () => {
  const state=Core.createState();Object.assign(state.adjustments,{highlights:-30,whites:20,blacks:10,vibrance:40});
  let reads=0;
  const proxy=value=>new Proxy(value,{get(target,key){reads++;const next=target[key];return next&&typeof next==='object'?proxy(next):next;}});
  const data=new Uint8ClampedArray(Array.from({length:8192},(_,i)=>(i*37)%256));
  const expected=Core.adjustPixels(data.slice(),state),actual=Core.adjustPixels(data.slice(),proxy(state));
  assert.deepEqual(actual,expected);
  assert.ok(reads<300,`read reactive parameters ${reads} times`);
});
