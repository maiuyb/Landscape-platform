const {test}=require('node:test'),assert=require('node:assert/strict');
const Core=require('../风景调色协作平台/frontend/editor-core.js'),Presets=require('../风景调色协作平台/frontend/editor-presets.js'),AI=require('../风景调色协作平台/frontend/editor-ai.js');
test('AI accepts modern absolute parameters, signed vignette and partial HSL without resetting other channels',()=>{
 const base=Core.createState();base.adjustments.exposure=.8;base.adjustments.temperature=13;base.hsl.blue.hue=17;base.hsl.red.saturation=9;base.effects.vignette.feather=87;
 const r=AI.recipe(base,{name:'自然',adjustments:{exposure:1.05,highlights:-20},hsl:{blue:{saturation:12}},effects:{vignette:-25,dehaze:6}}),next=Core.recipeState(base,r).state;
 assert.equal(r.version,7);assert.deepEqual(Core.recipeState(base,r).warnings,[]);assert.equal(next.adjustments.exposure,1.05);assert.equal(next.adjustments.temperature,13);
 assert.equal(next.hsl.blue.hue,17);assert.equal(next.hsl.blue.saturation,12);assert.equal(next.hsl.red.saturation,9);assert.equal(next.effects.vignette.amount,-25);assert.equal(next.effects.vignette.feather,87);assert.equal(base.adjustments.exposure,.8);
});
test('AI preset and overrides materialize identically to native preset; recipes never contain geometry/masks',()=>{
 const base=Core.createState();base.adjustments.exposure=.75;base.geometry=[{type:'flip',params:{direction:'h'}}];base.masks=[{id:'sentinel-user-mask'}];
 const r=AI.recipe(base,{name:'蓝调',preset_id:'blue-hour',strength:60,adjustments:{shadows:22},detail:{sharpen:18}});
 assert.ok(!r.steps.some(s=>['masks','flip','crop','rotate','straighten'].includes(s.type)));
 const expected=Presets.setAmount(Presets.apply(base,'blue-hour'),60);expected.adjustments.shadows=22;expected.detail.sharpen=18;delete expected.presetSession;
 assert.deepEqual(Core.recipeState(base,r).state,expected);
 assert.deepEqual(base.masks,[{id:'sentinel-user-mask'}]);assert.equal(base.adjustments.shadows,0);
});
test('AI preserves existing style, curves, masks, white balance and other edits for a simple refinement',()=>{
 const base=Presets.apply(Core.createState(),'rose-dusk');Core.setWhiteBalance(base,[1.1,1,.9],'sample');base.legacyTone.highlights=true;
 const r=AI.recipe(base,{name:'只提暗处',adjustments:{shadows:28}}),next=Core.recipeState(base,r).state;
 assert.deepEqual(r.steps,[{type:'shadows',params:{value:28}}]);assert.deepEqual(next.curves,base.curves);assert.deepEqual(next.hsl,base.hsl);assert.deepEqual(next.whiteBalance,base.whiteBalance);assert.equal(next.legacyTone.highlights,true);
 const modern=Core.recipeState(base,AI.recipe(base,{name:'压亮处',adjustments:{highlights:-12}})).state;assert.equal(modern.legacyTone.highlights,false);
});
test('AI rejects malformed, nonfinite, unsupported and excessive operations instead of clamping or ignoring',()=>{
 for(const p of [null,[],{name:'',adjustments:{contrast:1}},{name:'x',adjustments:{exposure:4}},{name:'x',adjustments:{contrast:NaN}},{name:'x',detail:{radius:.1}},{name:'x',effects:{vignette:{amount:-20}}},{name:'x',steps:[]},{name:'x',geometry:[]},{name:'x',preset_id:'missing'},{name:'x',preset_id:{}},{name:'x',strength:40,adjustments:{contrast:1}},{name:'x',hsl:{pink:{hue:1}}},{name:'x',calibration:{red:{value:1}}},{name:'x',adjustments:{}},{name:'x',hsl:Object.fromEntries(Core.tools.bands.map(b=>[b.key,{hue:1,saturation:2,luminance:3}])),adjustments:{contrast:1}}])assert.throws(()=>AI.recipe(Core.createState(),p));
});
test('AI context excludes source pixels, geometry and mask strokes and does not alias the editor',()=>{
 const base=Core.createState();base.geometry=[{type:'flip',params:{direction:'h'}}];base.masks=[{privateStrokes:[1,2,3]}];base.presetSession={id:'blue-hour',base:{private:'data'}};
 const c=AI.context(base);assert.equal(c.geometry_count,1);assert.equal(c.mask_count,1);assert.equal(c.active_preset,'blue-hour');assert.equal(JSON.stringify(c).includes('private'),false);c.adjustments.contrast=40;assert.equal(base.adjustments.contrast,0);
});
test('AI recipes share Core undo and flattened v6 export, retaining local edits across redo',()=>{
 const base=Core.createState(),history=Core.createHistory(base);const next=Core.recipeState(base,AI.recipe(base,{name:'夜景',preset_id:'quiet-night',adjustments:{exposure:.4}})).state;
 history.commit(next);assert.deepEqual(history.undo(),base);assert.deepEqual(history.redo(),next);assert.deepEqual(Core.recipeState(Core.createState(),Core.toRecipe(next)).state,next);
});
