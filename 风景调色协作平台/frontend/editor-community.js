/* Read community records without losing the editor recipe's version or rendering semantics. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./editor-core.js'):root.EditorCore);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.EditorCommunity=api;
})(globalThis,function(Core){
  const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
  function hasSteps(record){return object(record)&&(Array.isArray(record.steps)||typeof record.steps==='string');}
  function normalize(raw){
    const record=object(raw?.recipe)?raw.recipe:raw;
    if(!object(record)||!hasSteps(record))throw Error('社区作品尚未提供可读取的配方，请稍后重试。');
    const version=record.version??1;
    if(![1,2,3,4,5,6].includes(version))throw Error('这份社区配方的版本暂不支持，请联系作者更新。');
    let steps=record.steps,rendering=record.rendering;
    try{if(typeof steps==='string')steps=JSON.parse(steps);if(typeof rendering==='string')rendering=JSON.parse(rendering);}catch{throw Error('社区配方的数据格式无效。');}
    if(!Array.isArray(steps)||steps.some(s=>!object(s)))throw Error('社区配方的操作列表无效。');
    if(rendering!==undefined&&!object(rendering))throw Error('社区配方的渲染设置无效。');
    const recipe={version,steps:Core.clone(steps)};
    if(rendering!==undefined)recipe.rendering=Core.clone(rendering);
    // Let the shared engine validate supported versions, curves and compatibility flags.
    Core.recipeState(Core.createState(),recipe);
    for(const key of ['id','name','description','author','cover_before','cover_after','category','tags'])
      if(record[key]!==undefined)recipe[key]=Core.clone(record[key]);
    if(typeof recipe.name!=='string'||!recipe.name.trim())recipe.name='社区配方';
    return recipe;
  }
  function publication(state,metadata={}){
    const recipe={...Core.toRecipe(state)};
    for(const key of ['name','description','category','tags','cover_before','cover_after'])
      if(metadata[key]!==undefined)recipe[key]=Core.clone(metadata[key]);
    return {recipe};
  }
  return {hasSteps,normalize,publication};
});
