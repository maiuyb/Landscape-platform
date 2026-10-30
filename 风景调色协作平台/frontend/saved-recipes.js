/* Shared private recipe library UI for the editor and community. */
window.RecipeLibrary = (() => {
  let options, list, edit, host, page=1, search='', generation=0, session='', editing=null, opener=null, sourceSaving=false, editSaving=false;
  const token=()=>localStorage.getItem('landscape:token')||localStorage.getItem('cd_token')||'';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const find=id=>document.getElementById(id);
  async function request(path, method='GET', body) {
    const identity=token();
    if(!identity)throw Error('请先登录，再使用常用配方。');
    const result=await options.request(path,method,body);
    if(identity!==token())throw Error('登录状态已改变，请重新打开常用配方。');
    return result;
  }
  function configure(value){options=value;session=token();}
  function sessionChanged(){
    if(session===token())return;
    session=token();generation++;editing=null;
    list?.close();edit?.close();
    restoreContent();
    if(list)find('savedRecipeList').replaceChildren();
    if(edit){edit.querySelector('form').reset();find('savedRecipeSource').textContent='';}
  }
  function requireLogin(){sessionChanged();if(token())return true;options.login();return false;}
  function mount(){
    if(list)return;
    list=document.createElement('dialog');list.id='savedRecipesDialog';list.className='saved-recipes-dialog';list.setAttribute('aria-labelledby','savedRecipesTitle');
    list.innerHTML=`<div class="saved-recipes-heading"><h2 id="savedRecipesTitle">常用配方</h2><button type="button" data-library-close aria-label="关闭常用配方">×</button></div><div id="savedLibraryContent"><p class="saved-recipes-hint">保存到当前账号，可在不同照片上预览使用；不包含照片。</p><form id="savedRecipeSearchForm"><label for="savedRecipeSearch">搜索名称或备注</label><div class="saved-recipes-search"><input id="savedRecipeSearch" type="search" maxlength="100"><button type="submit">搜索</button></div></form><p id="savedRecipeStatus" role="status"></p><button type="button" id="savedRecipeRetry" hidden>重新加载</button><div id="savedRecipeList"></div><nav class="saved-recipes-pagination" aria-label="常用配方分页"><button type="button" id="savedRecipePrev">上一页</button><span id="savedRecipePage"></span><button type="button" id="savedRecipeNext">下一页</button></nav></div>`;
    document.body.append(list);
    list.querySelector('[data-library-close]').onclick=()=>list.close();
    list.onclose=()=>{if(!host){generation++;opener?.focus();}};
    find('savedRecipeSearchForm').onsubmit=e=>{e.preventDefault();search=find('savedRecipeSearch').value.trim();page=1;load();};
    find('savedRecipePrev').onclick=()=>{page--;load();};find('savedRecipeNext').onclick=()=>{page++;load();};find('savedRecipeRetry').onclick=load;
    find('savedRecipeList').onclick=async e=>{
      const button=e.target.closest('button[data-saved-action]');if(!button)return;
      const entry=button.closest('[data-saved-id]').recipe;
      if(button.dataset.savedAction==='preview'){
        list.close();options.preview({...entry.recipe,name:entry.name,description:entry.note||entry.description,author:entry.author});
      }else if(button.dataset.savedAction==='edit')openEditor(entry);
      else if(confirm(`从常用配方移除「${entry.name}」？原作品和收藏不受影响。`)){
        button.disabled=true;
        try{await request('/me/saved-recipes/'+entry.id,'DELETE');await load();}catch(error){find('savedRecipeStatus').textContent=error.message;}finally{button.disabled=false;}
      }
    };
    edit=document.createElement('dialog');edit.id='savedRecipeEditDialog';edit.className='saved-recipes-dialog';edit.setAttribute('aria-labelledby','savedRecipeEditTitle');
    edit.innerHTML=`<form><h2 id="savedRecipeEditTitle">保存常用配方</h2><label for="savedRecipeName">配方名称</label><input id="savedRecipeName" maxlength="100" required><p id="savedRecipeSource" class="saved-recipes-hint"></p><label for="savedRecipeNote">我的备注</label><textarea id="savedRecipeNote" rows="4" maxlength="500" placeholder="例如：适合阴天山景，曝光可稍微降低"></textarea><button type="button" id="savedRecipeUseDescription" hidden>采用作者说明</button><button type="button" id="savedRecipeUseTags" hidden>采用作者标签</button><p id="savedRecipeEditStatus" role="alert"></p><div class="saved-recipes-actions"><button type="button" id="savedRecipeCancel">取消</button><button type="submit" id="savedRecipeSubmit">保存</button></div></form>`;
    document.body.append(edit);
    find('savedRecipeCancel').onclick=()=>edit.close();
    edit.oncancel=event=>{if(editSaving)event.preventDefault();};
    edit.onclose=()=>{editing=null;if(list.open)find('savedRecipeList').querySelector('details[open] summary, summary')?.focus();};
    find('savedRecipeUseDescription').onclick=()=>{find('savedRecipeNote').value=(editing.description||'').slice(0,500);};
    find('savedRecipeUseTags').onclick=()=>{find('savedRecipeNote').value=(editing.tags||[]).join('、').slice(0,500);};
    edit.querySelector('form').onsubmit=async e=>{
      e.preventDefault();const entry=editing;if(!entry)return;
      const button=find('savedRecipeSubmit');button.disabled=true;editSaving=true;find('savedRecipeCancel').disabled=true;
      try{
        const data={name:find('savedRecipeName').value.trim(),note:find('savedRecipeNote').value.trim()};
        await request('/me/saved-recipes'+(entry.id?'/'+entry.id:''),entry.id?'PATCH':'POST',entry.id?data:{...data,recipe:entry.recipe});
        if(editing!==entry)return;
        edit.close();options.notify('常用配方已保存');if(list.open||host)await load();
      }catch(error){if(editing===entry)find('savedRecipeEditStatus').textContent=error.message;}finally{button.disabled=false;editSaving=false;find('savedRecipeCancel').disabled=false;}
    };
  }
  function openEditor(entry){
    editing=entry;find('savedRecipeName').value=entry.name||'当前配方';find('savedRecipeNote').value=entry.note||'';
    find('savedRecipeSource').textContent=[entry.author?'作者：'+entry.author:'',entry.description].filter(Boolean).join(' · ');
    find('savedRecipeUseDescription').hidden=!entry.description;find('savedRecipeUseTags').hidden=!entry.tags?.length;
    find('savedRecipeEditStatus').textContent='';if(!edit.open)edit.showModal();find('savedRecipeName').focus();
  }
  async function load(){
    const expanded=new Set([...find('savedRecipeList').querySelectorAll('details[open]')].map(entry=>entry.dataset.savedId));
    const version=++generation;find('savedRecipeStatus').textContent='正在加载…';find('savedRecipeRetry').hidden=true;find('savedRecipeList').replaceChildren();
    find('savedRecipePrev').disabled=true;find('savedRecipeNext').disabled=true;
    try{
      const data=await request('/me/saved-recipes?'+new URLSearchParams({page,search}));
      if(version!==generation)return;
      const pages=Math.max(1,Math.ceil(data.total/12));if(page>pages){page=pages;return load();}
      find('savedRecipeStatus').textContent=data.total?`${data.total} 份常用配方`:(search?'没有匹配的配方。':'还没有常用配方。可从社区作品中存取，也可保存当前照片的调色配方。');
      find('savedRecipePage').textContent=`${page} / ${pages}`;find('savedRecipePrev').disabled=page<=1;find('savedRecipeNext').disabled=page>=pages;
      for(const entry of data.recipes){
        const article=document.createElement('details');article.className='saved-recipe-entry';article.dataset.savedId=entry.id;article.recipe=entry;article.open=expanded.has(String(entry.id));
        article.innerHTML=`<summary><strong>${esc(entry.name)}</strong><span class="saved-recipe-chevron" aria-hidden="true"></span></summary><div class="saved-recipe-body">${entry.author?`<p class="saved-recipes-hint">来自 ${esc(entry.author)}</p>`:''}<p>${esc(entry.note||entry.description||'尚未添加备注')}</p>${entry.tags?.length?`<p class="saved-recipes-hint">${entry.tags.map(esc).join(' · ')}</p>`:''}<div class="saved-recipes-actions"><button type="button" data-saved-action="preview">在我的照片上预览</button><button type="button" data-saved-action="edit">编辑备注</button><button type="button" data-saved-action="remove">移除</button></div></div>`;
        find('savedRecipeList').append(article);
      }
    }catch(error){if(version===generation){find('savedRecipeStatus').textContent=error.message;find('savedRecipeRetry').hidden=false;}}
  }
  function restoreContent(){if(host){list.append(find('savedLibraryContent'));host=null;}}
  function open(){if(!requireLogin())return;mount();restoreContent();opener=document.activeElement;page=1;search='';find('savedRecipeSearch').value='';list.showModal();load();}
  function showIn(container){if(!requireLogin())return;mount();restoreContent();host=container;host.append(find('savedLibraryContent'));page=1;search='';find('savedRecipeSearch').value='';load();}
  function closePanel(){generation++;if(host)restoreContent();}
  async function saveSource(id){
    if(!requireLogin()||sourceSaving)return;
    mount();
    sourceSaving=true;
    try{const result=await request('/me/saved-recipes','POST',{source_recipe_id:id});options.notify(result.already_saved?'这份配方已保存，可修改备注':'已存为常用配方');openEditor(result.saved_recipe);}catch(error){options.notify(error.message);}finally{sourceSaving=false;}
  }
  function saveCurrent(recipe,name){if(!requireLogin())return;mount();openEditor({recipe,name,note:''});}
  window.addEventListener('storage',sessionChanged);
  return {configure,sessionChanged,open,showIn,closePanel,saveSource,saveCurrent};
})();
