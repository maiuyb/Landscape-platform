/* Auth UI shared by standalone community and the main-site frame. */
(() => {
  const $=s=>document.querySelector(s), ids={login:'authLoginCaptcha',email:'authEmailCaptcha',reset:'authResetCaptcha'}, challenges={}, versions={};
  async function refresh(purpose,requestPurpose=purpose){
    const id=ids[purpose],version=(versions[purpose]||0)+1;versions[purpose]=version;
    challenges[purpose]='';const answer=$('#'+id+'Answer');if(answer)answer.value='';
    const button=$('#'+id+'Refresh');if(button)button.disabled=true;
    try{
      const result=await api('/api/auth/captcha?purpose='+requestPurpose);
      if(versions[purpose]!==version)return;
      if(!result.ok){$('#authError').textContent=result.data.error||'图形验证加载失败，请点击图片重试。';return;}
      challenges[purpose]=result.data.captcha_id;$('#'+id+'Image').src=result.data.image;
    }finally{if(versions[purpose]===version&&button)button.disabled=false;}
  }
  function body(purpose){return{captcha_id:challenges[purpose]||'',captcha_answer:$('#'+ids[purpose]+'Answer').value.trim()};}
  function opened(){
    const register=state.authMode==='register';
    for(const p of ['login','email','reset']){
      versions[p]=(versions[p]||0)+1;challenges[p]='';
      const answer=$('#'+ids[p]+'Answer'),button=$('#'+ids[p]+'Refresh');
      if(answer)answer.value='';if(button)button.disabled=false;
    }
    const pass=$('#authPass'),passToggle=$('#authPassToggle');
    if(pass&&passToggle){pass.type='password';passToggle.setAttribute('aria-pressed','false');passToggle.setAttribute('aria-label','显示密码');}
    $('#authLoginCaptcha').hidden=true;$('#authPasswordFields').hidden=false;$('#authSubmit').hidden=false;
    $('#authEmailInput').value='';$('#authEmailCode').value='';$('#authEmailBox').hidden=!register;
    for(const id of ['authResetEmail','authResetCode','authResetPassword']){const input=$('#'+id);if(input)input.value='';}
    if($('#authResetError'))$('#authResetError').textContent='';
    $('#authEmailDivider').hidden=register;$('#authEmailVerifyBtn').hidden=register;
    $('#authForgotRow').hidden=register;$('#authResetBox').hidden=true;$('#authActions').hidden=false;
    $('#authPass').placeholder=register?'8–128 位密码':'密码';
    $('#authEmailModeToggle').textContent='✉️ 邮箱验证码登录';
    if(register)refresh('email');
  }
  async function failed(data){
    if(state.authMode==='login'&&(data.code==='captcha_required'||!$('#authLoginCaptcha').hidden)){
      $('#authLoginCaptcha').hidden=false;await refresh('login');$('#authLoginCaptchaAnswer').focus();
    }
  }
  for(const purpose of ['login','email','reset']){
    const button=$('#'+ids[purpose]+'Refresh');
    if(button)button.addEventListener('click',()=>refresh(purpose,purpose==='reset'?'email':purpose));
  }
  $('#authLoginCaptchaAnswer').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submitAuth();}});
  $('#authPassToggle')?.addEventListener('click',()=>{
    const pass=$('#authPass'),toggle=$('#authPassToggle');if(!pass||!toggle)return;
    const visible=pass.type==='password';pass.type=visible?'text':'password';
    toggle.setAttribute('aria-pressed',String(visible));toggle.setAttribute('aria-label',visible?'隐藏密码':'显示密码');
  });
  window.AuthGuard={opened,refresh,body,failed};
})();
