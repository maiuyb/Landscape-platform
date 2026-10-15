/* Compile untrusted AI suggestions into the same v6 recipes as manual editing. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./editor-core.js'):root.EditorCore,
    typeof module==='object'&&module.exports?require('./editor-presets.js'):root.EditorPresets);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.EditorAI=api;
})(globalThis,function(Core,Presets){
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  function patch(raw,rules){
    if(!object(raw)||Object.keys(raw).some(k=>!Object.hasOwn(rules,k)))throw Error('建议包含不支持的参数。');
    for(const[k,v]of Object.entries(raw))if(!Number.isFinite(v)||v<rules[k][0]||v>rules[k][1])throw Error('建议中的参数超出范围。');
    return Core.clone(raw);
  }
  const adjustmentRules=Object.fromEntries(Core.controls.map(c=>[c.key,[c.min,c.max]]));
  const detailRules=Object.fromEntries(Core.detail.controls.map(c=>[c.key,[c.min,c.max]]));
  function colors(raw,bands,channels){
    if(!object(raw)||Object.keys(raw).some(k=>!bands.includes(k)))throw Error('建议的颜色通道无效。');
    return Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,patch(v,Object.fromEntries(channels.map(c=>[c,[-100,100]])))]));
  }
  function validate(raw){
    const allowed=['name','description','preset_id','strength','adjustments','hsl','detail','effects','calibration'];
    if(!object(raw)||Object.keys(raw).some(k=>!allowed.includes(k))||typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>40||
       (raw.description!==undefined&&(typeof raw.description!=='string'||raw.description.length>240)))throw Error('建议格式无效。');
    const p={name:raw.name.trim(),description:raw.description||'',preset_id:raw.preset_id??null};
    if(p.preset_id!==null&&!Presets.byId.has(p.preset_id))throw Error('建议引用的预设不存在。');
    if(raw.strength!==undefined){if(p.preset_id===null||!Number.isFinite(raw.strength)||raw.strength<0||raw.strength>100)throw Error('预设强度无效。');p.strength=raw.strength;}
    p.adjustments=patch((raw.adjustments===undefined?{}:raw.adjustments),adjustmentRules);p.detail=patch((raw.detail===undefined?{}:raw.detail),detailRules);
    p.effects=patch((raw.effects===undefined?{}:raw.effects),{clarity:[-100,100],dehaze:[-100,100],vignette:[-100,100]});
    p.hsl=colors((raw.hsl===undefined?{}:raw.hsl),Core.tools.bands.map(b=>b.key),['hue','saturation','luminance']);
    p.calibration=colors((raw.calibration===undefined?{}:raw.calibration),['red','green','blue'],['hue','saturation']);
    const count=['adjustments','detail','effects'].reduce((n,k)=>n+Object.keys(p[k]).length,0)+
      ['hsl','calibration'].reduce((n,k)=>n+Object.values(p[k]).reduce((sum,v)=>sum+Object.keys(v).length,0),0);
    if(count>24||(!count&&p.preset_id===null))throw Error('建议缺少可用的调整。');
    return p;
  }
  function context(state){
    return {adjustments:Core.clone(state.adjustments),detail:Core.clone(state.detail),hsl:Core.clone(state.hsl),
      effects:{clarity:state.effects.clarity,dehaze:state.effects.dehaze,vignette:state.effects.vignette.amount},
      calibration:Core.clone(state.effects.calibration),mask_count:state.masks.length,geometry_count:state.geometry.length,
      active_preset:state.presetSession?.id||null};
  }
  const stepKey=s=>s.type+':'+(s.params.band||s.params.channel||'');
  function recipe(base,raw){
    const p=validate(raw);
    let next=p.preset_id?Presets.apply(base,p.preset_id):Core.clone(base);
    if(p.preset_id&&p.strength!==undefined)next=Presets.setAmount(next,p.strength);
    Object.assign(next.adjustments,p.adjustments);Object.assign(next.detail,p.detail);
    for(const[k,v]of Object.entries(p.hsl))Object.assign(next.hsl[k],v);
    for(const[k,v]of Object.entries(p.calibration))Object.assign(next.effects.calibration[k],v);
    for(const[k,v]of Object.entries(p.effects))if(k==='vignette')next.effects.vignette.amount=v;else next.effects[k]=v;
    for(const key of ['highlights','shadows'])if(Object.hasOwn(p.adjustments,key))next.legacyTone[key]=false;
    if(['temperature','tint'].some(k=>Object.hasOwn(p.adjustments,k)))next.whiteBalance.mode='custom';
    Core.syncWhiteBalance(next);
    delete next.presetSession;
    const before=new Map(Core.toRecipe(base).steps.map(s=>[stepKey(s),JSON.stringify(s)]));
    const result=Core.toRecipe(next);
    result.steps=result.steps.filter(s=>!['masks','crop','rotate','flip','straighten'].includes(s.type)&&before.get(stepKey(s))!==JSON.stringify(s));
    return {...result,name:p.name,description:p.description,ai:true};
  }
  return {context,validate,recipe};
});
