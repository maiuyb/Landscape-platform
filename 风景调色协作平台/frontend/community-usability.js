/* Functional account navigation and private recipes; Gallery artwork stays in its existing styles. */
(() => {
  RecipeLibrary.configure({
    request:async(path,method,body)=>{const result=await api('/api'+path,{method,body,auth:true});if(!result.ok)throw Error(result.data.error||'操作失败，请重试');return result.data;},
    login:()=>{toast('请先登录');openAuth('login');},notify:toast,
    preview:recipe=>previewInEditor(recipe)
  });
  const originalPreview=previewInEditor;
  previewInEditor=async value=>{
    if(typeof value!=='object')return originalPreview(value);
    try{RecipeHandoff.open(value,EDITOR_URL);}catch(error){toast(error.message||'请从平台主站打开常用配方后预览。');}
  };

  const originalRenderAuth=renderAuth;
  renderAuth=()=>{
    originalRenderAuth();
    const trigger=$('#authUserBtn'),logout=$('#logoutBtn');if(!trigger||!logout)return;
    const area=$('#authArea');area.classList.add('account-menu');
    trigger.classList.add('avatar-only');trigger.querySelectorAll(':scope>span:not(.auth-avatar)').forEach(el=>el.remove());
    trigger.onclick=()=>openPublicProfile(state.user.id);trigger.setAttribute('aria-label','打开个人主页');
    trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','accountDropdown');
    const menu=document.createElement('div');menu.id='accountDropdown';menu.className='account-dropdown';
    const identity=document.createElement('div');identity.className='account-menu-identity';const name=document.createElement('strong'),handle=document.createElement('span');name.textContent=state.user.display_name||state.user.username;handle.textContent='@'+state.user.username;identity.append(name,handle);
    const management=document.createElement('button');management.type='button';management.className='btn ghost';management.textContent='用户中心';management.onclick=enterUserCenter;
    menu.append(identity,management,logout);area.append(menu);
    area.onmouseenter=()=>{area.classList.remove('menu-dismissed');trigger.setAttribute('aria-expanded','true');};
    area.onmouseleave=()=>trigger.setAttribute('aria-expanded','false');
    area.onfocusin=()=>{area.classList.remove('menu-dismissed');trigger.setAttribute('aria-expanded','true');};
    area.onfocusout=e=>{if(!area.contains(e.relatedTarget))trigger.setAttribute('aria-expanded','false');};
    area.onkeydown=e=>{if(e.key==='Escape'){area.classList.add('menu-dismissed');trigger.setAttribute('aria-expanded','false');e.stopPropagation();}};
  };

  let changing=false;
  const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.hidden=true;input.id='quickAvatarInput';input.setAttribute('aria-label','选择新头像');document.body.append(input);
  async function changeAvatar(file){
    if(!file||changing||!state.user)return;
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){toast('请选择 5MB 以内的 JPG/PNG/WebP 头像');return;}
    changing=true;const identity=state.token;toast('正在更新头像…');
    try{
      const form=new FormData();form.append('file',file);
      const upload=await api('/api/upload',{method:'POST',form,auth:true});
      if(identity!==state.token)return;
      if(!upload.ok)throw Error(upload.data.error||'头像上传失败');
      const result=await api('/api/users/me',{method:'PUT',auth:true,body:{avatar:upload.data.url}});
      if(identity!==state.token)return;
      if(!result.ok)throw Error(result.data.error||'头像保存失败');
      state.user=result.data.user;state.profileAvatarDraft=null;writeSession(state.token,state.user);renderAuth();renderAccountPanel();
      if(AuthorPortfolio.active())await AuthorPortfolio.reload();toast('头像已更新');
    }catch(error){toast(error.message||'头像更新失败，请重试');}finally{changing=false;}
  }
  input.onchange=()=>{const file=input.files?.[0];input.value='';changeAvatar(file);};
  function pickAvatar(){if(state.user&&!changing)input.click();}
  document.addEventListener('click',event=>{
    const avatar=event.target.closest('.editable-avatar,#ucProfileAvatar,#ucAvatarPreview');if(avatar)pickAvatar();
  });
  document.addEventListener('keydown',event=>{
    if((event.key==='Enter'||event.key===' ')&&event.target.matches('.editable-avatar,#ucProfileAvatar,#ucAvatarPreview')){event.preventDefault();pickAvatar();}
  });
  for(const id of ['ucProfileAvatar','ucAvatarPreview']){
    const element=document.getElementById(id);element.removeAttribute('aria-hidden');element.setAttribute('role','button');element.tabIndex=0;element.setAttribute('aria-label','更换头像');element.classList.add('editable-avatar');
  }
})();
