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
    const identity=document.createElement('div');identity.className='account-menu-identity';
    const name=document.createElement('strong'),handle=document.createElement('span'),creditTag=document.createElement('span');
    name.textContent=state.user.display_name||state.user.username;
    handle.textContent='@'+state.user.username;
    creditTag.className='account-menu-credit-tag';
    creditTag.textContent=`✦ ${state.user.credits ?? 10} 显影积分`;
    identity.append(name,handle,creditTag);

    const checkinBtn=document.createElement('button');
    checkinBtn.type='button';
    checkinBtn.className='btn ghost dropdown-credit-btn';
    checkinBtn.textContent=state.user.checked_in_today?'✓ 今日已签到':'📅 每日签到 (+3)';
    checkinBtn.disabled=!!state.user.checked_in_today;
    checkinBtn.onclick=async()=>{
      if(window.CreditSponsor){
        await window.CreditSponsor.checkin({silentToast:msg=>toast(msg)});
      }
    };

    const giftBtn=document.createElement('button');
    giftBtn.type='button';
    giftBtn.className='btn ghost dropdown-gift-btn';
    giftBtn.innerHTML='<svg class="gift-icon" viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="14" height="9" rx="1.5"/><path d="M2 5.5h16v2.5H2zM10 5.5v11.5M10 5.5c-1.5-2.5-4-2.5-4-.5s2.5 1 4 .5zm0 0c1.5-2.5 4-2.5 4-.5s-2.5 1-4 .5z"/></svg><span>兑换码</span>';
    giftBtn.onclick=()=>{
      trigger.setAttribute('aria-expanded','false');
      if(window.CreditSponsor)window.CreditSponsor.open('redeem');
    };

    const management=document.createElement('button');management.type='button';management.className='btn ghost';management.textContent='用户中心';management.onclick=enterUserCenter;
    menu.append(identity,checkinBtn,giftBtn,management,logout);area.append(menu);
    area.onmouseenter=()=>{area.classList.remove('menu-dismissed');trigger.setAttribute('aria-expanded','true');};
    area.onmouseleave=()=>trigger.setAttribute('aria-expanded','false');
    area.onfocusin=()=>{area.classList.remove('menu-dismissed');trigger.setAttribute('aria-expanded','true');};
    area.onfocusout=e=>{if(!area.contains(e.relatedTarget))trigger.setAttribute('aria-expanded','false');};
    area.onkeydown=e=>{if(e.key==='Escape'){area.classList.add('menu-dismissed');trigger.setAttribute('aria-expanded','false');e.stopPropagation();}};
  };

  function syncCreditsUI(){
    const u=state.user;
    const bal=$('#ucCreditBalance'),chkStatus=$('#ucCheckinStatus'),emailStatus=$('#ucEmailStatus'),chkBtn=$('#ucCheckinBtn');
    if(!u){
      if(bal)bal.textContent='0';
      return;
    }
    const credits=Number.isFinite(Number(u.credits))?Number(u.credits):10;
    if(bal)bal.textContent=String(credits);
    if(chkStatus)chkStatus.textContent=u.checked_in_today?'今日已签到 ✓':'今日尚未签到（签到可领 +3 积分）';
    if(chkBtn){
      chkBtn.textContent=u.checked_in_today?'✓ 今日已签到':'📅 每日签到 (+3)';
      chkBtn.disabled=!!u.checked_in_today;
    }
    if(emailStatus){
      emailStatus.textContent=(u.email_verified&&u.email)?`已验证 (${u.email})`:'未绑定（首次验证赠送 +5 积分）';
    }
  }

  if(typeof renderAccountPanel==='function'){
    const origRenderAccount=renderAccountPanel;
    renderAccountPanel=()=>{
      origRenderAccount();
      syncCreditsUI();
    };
  }

  window.addEventListener('landscape:user-updated',e=>{
    const nextUser=e.detail?.user||readUser();
    const nextToken=e.detail?.token||readToken();
    if(nextUser){
      state.user=nextUser;
      if(nextToken)state.token=nextToken;
      renderAuth();
      syncCreditsUI();
    }
  });

  $('#ucCheckinBtn')?.addEventListener('click',async()=>{
    if(window.CreditSponsor)await window.CreditSponsor.checkin({silentToast:msg=>toast(msg)});
  });
  $('#ucRedeemBtn')?.addEventListener('click',()=>{
    if(window.CreditSponsor)window.CreditSponsor.open('redeem');
  });
  $('#ucBindEmailBtn')?.addEventListener('click',()=>{
    if(window.CreditSponsor)window.CreditSponsor.open('email');
  });
  $('#ucSponsorBtn')?.addEventListener('click',()=>{
    if(window.CreditSponsor)window.CreditSponsor.open('sponsor');
  });

  // Email verification login inside #authModal
  const emailToggle=$('#authEmailModeToggle'),emailBox=$('#authEmailBox'),emailInput=$('#authEmailInput'),emailCode=$('#authEmailCode'),sendCodeBtn=$('#authSendCodeBtn'),verifyEmailBtn=$('#authEmailVerifyBtn');
  if(emailToggle&&emailBox){
    emailToggle.addEventListener('click',()=>{
      emailBox.hidden=!emailBox.hidden;
      if(!emailBox.hidden)emailInput?.focus();
    });
  }
  if(sendCodeBtn){
    sendCodeBtn.addEventListener('click',async()=>{
      const email=(emailInput?.value||'').trim();
      if(!email){$('#authError').textContent='请输入有效的邮箱地址';return;}
      sendCodeBtn.disabled=true;
      try{
        const r=await api('/api/auth/email/send-code',{method:'POST',body:{email,purpose:'login'}});
        if(!r.ok){$('#authError').textContent=r.data?.error||'验证码发送失败';return;}
        $('#authError').textContent='';
        toast(r.data?.message||'验证码已发送，请查收邮件');
        emailCode?.focus();
      }finally{sendCodeBtn.disabled=false;}
    });
  }
  async function submitEmailAuth(){
    const email=(emailInput?.value||'').trim(),code=(emailCode?.value||'').trim();
    if(!email||!code){$('#authError').textContent='请填写邮箱地址与 6 位验证码';return;}
    if(verifyEmailBtn)verifyEmailBtn.disabled=true;
    try{
      const r=await api('/api/auth/email/verify',{method:'POST',body:{email,code}});
      if(!r.ok){$('#authError').textContent=r.data?.error||'验证码验证失败';return;}
      if(r.data?.token&&r.data?.user){
        state.token=r.data.token;
        state.user=r.data.user;
        writeSession(state.token,state.user);
        if(window.CreditSponsor)window.CreditSponsor.saveUser(state.user,state.token);
        $('#authModal')?.classList.remove('open');
        if(emailCode)emailCode.value='';
        renderAuth();
        renderAccountPanel();
        toast(r.data.message||'邮箱验证登录成功');
        loadRecipes();
        loadRecommend();
      }
    }finally{if(verifyEmailBtn)verifyEmailBtn.disabled=false;}
  }
  verifyEmailBtn?.addEventListener('click',submitEmailAuth);
  emailCode?.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submitEmailAuth();}});

  syncCreditsUI();

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
