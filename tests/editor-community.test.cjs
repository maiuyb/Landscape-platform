const {test}=require('node:test'),assert=require('node:assert/strict');
const Core=require('../风景调色协作平台/frontend/editor-core.js'),Presets=require('../风景调色协作平台/frontend/editor-presets.js'),Community=require('../风景调色协作平台/frontend/editor-community.js');
test('legacy community steps stored as JSON retain v1 exposure and highlight semantics',()=>{
 const r=Community.normalize({id:1,name:'旧样板',steps:JSON.stringify([{type:'exposure',params:{value:50}},{type:'highlights',params:{value:20}}])});
 const s=Core.recipeState(Core.createState(),r).state;assert.equal(r.version,1);assert.equal(s.adjustments.exposure,1);assert.equal(s.adjustments.highlights,-20);
});
test('v6 community records preserve full rendering, HSL, curves, details, effects and masks',()=>{
 const s=Core.createState();s.adjustments.exposure=.8;s.adjustments.highlights=-20;Core.setWhiteBalance(s,[1.05,1,.95],'sample');s.hsl.blue.saturation=12;s.curves.red=[[0,0],[.5,.55],[1,1]];s.detail.sharpen=14;s.effects.dehaze=8;s.masks=[Core.masks.create('radial','one')];s.geometry=[{type:'flip',params:{direction:'h'}}];
 const raw={...Core.toRecipe(s),id:7,name:'新版',author:'member'},normalized=Community.normalize(raw);assert.deepEqual(Core.recipeState(Core.createState(),normalized).state,s);
 normalized.steps[0].params.direction='v';assert.equal(raw.steps[0].params.direction,'h');
});
test('detail response wrappers and stored rendering JSON preserve compatibility settings',()=>{
 const r=Community.normalize({recipe:{version:6,name:'兼容',rendering:JSON.stringify({legacyTone:{highlights:true,shadows:false}}),steps:'[{"type":"highlights","params":{"value":-12}}]'}});
 assert.equal(r.rendering.legacyTone.highlights,true);assert.equal(Core.recipeState(Core.createState(),r).state.legacyTone.highlights,true);
});
test('summary cards are distinct from actual empty recipes; malformed and future versions fail clearly',()=>{
 assert.equal(Community.hasSteps({id:1,name:'summary'}),false);assert.equal(Community.hasSteps({steps:[]}),true);assert.deepEqual(Community.normalize({steps:[]}).steps,[]);
 for(const r of [null,[],{id:1},{steps:'broken'},{steps:'{}'},{steps:[null]},{version:99,steps:[]},{version:'6',steps:[]},{version:6,rendering:{legacyTone:{highlights:'bad',shadows:false}},steps:[]}])assert.throws(()=>Community.normalize(r));
});
test('publication payload exports actual flattened v6 state with metadata and no private preset session',()=>{
 const s=Presets.apply(Core.createState(),'golden-sunset');s.adjustments.exposure=.6;
 const p=Community.publication(s,{name:'晚霞',category:'日落',tags:['暖色'],cover_before:'/uploads/before.jpg',cover_after:'/uploads/after.jpg',author_id:999});
 assert.equal(p.recipe.version,6);assert.ok(p.recipe.rendering);assert.equal(p.recipe.name,'晚霞');assert.equal('author_id' in p.recipe,false);assert.equal(JSON.stringify(p).includes('presetSession'),false);
 const actual=Core.clone(s);delete actual.presetSession;assert.deepEqual(Core.recipeState(Core.createState(),p.recipe).state,actual);
});
test('API rendering null means absent flags and invalid steps cannot silently disappear',()=>{
 const r=Community.normalize({version:1,rendering:null,steps:[{type:'exposure',params:{value:40}}]});
 assert.equal(r.rendering,undefined);assert.equal(Core.recipeState(Core.createState(),r).state.adjustments.exposure,.8);
 for(const step of [{type:'unknown',params:{}},{type:'exposure',params:{value:null}},{type:'masks',params:{layers:[{}]}}])assert.throws(()=>Community.normalize({version:6,steps:[step]}));
});
test('community reuse defaults to global color while geometry and masks are independent opt-ins',()=>{
 const {fixtures}=require('./community-fixtures.cjs'),r=fixtures()[0],base=Core.createState();
 base.geometry=[{type:'flip',params:{direction:'v'}}];base.masks=[Core.masks.create('radial','mine')];
 const global=Community.reuse(r);assert.deepEqual(Community.scope(r),{geometry:true,masks:true});
 const next=Core.recipeState(base,global).state;assert.deepEqual(next.geometry,base.geometry);assert.deepEqual(next.masks,base.masks);
 assert.equal(next.adjustments.exposure,.8);assert.equal(next.adjustments.highlights,-20);
 const geometry=Community.reuse(r,{geometry:true}),masks=Community.reuse(r,{masks:true});
 assert.ok(geometry.steps.some(s=>s.type==='crop'));assert.equal(geometry.steps.some(s=>s.type==='masks'),false);
 assert.ok(masks.steps.some(s=>s.type==='masks'));assert.equal(masks.steps.some(s=>s.type==='crop'),false);
 assert.deepEqual(Community.reuse(r,{geometry:true,masks:true}).steps,r.steps);
});
