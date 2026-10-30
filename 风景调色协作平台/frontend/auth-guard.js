/* Auth UI shared by standalone community and the main-site frame. */
(() => {
  const $=s=>document.querySelector(s), ids={login:'authLoginCaptcha',email:'authEmailCaptcha'}, challenges={}, versions={};
  async function refresh(purpose){
    const id=ids[purpose],version=(versions[purpose]||0)+1;versions[purpose]=version;
    challenges[purpose]='';$('#'+id+'Answer').value='';
    const button=$('#'+id+'Refresh');button.disabled=true;
    try{
      const result=await api('/api/auth/captcha?purpose='+purpose);
      if(versions[purpose]!==version)return;
      if(!result.ok){$('#authError').textContent=result.data.error||'图形验证加载失败，请点击图片重试。';return;}
      challenges[purpose]=result.data.captcha_id;$('#'+id+'Image').src=result.data.image;
    }finally{if(versions[purpose]===version)button.disabled=false;}
  }
  function body(purpose){return{captcha_id:challenges[purpose]||'',captcha_answer:$('#'+ids[purpose]+'Answer').value.trim()};}
  function opened(){
    const register=state.authMode==='register';
    for(const p of ['login','email']){versions[p]=(versions[p]||0)+1;challenges[p]='';$('#'+ids[p]+'Answer').value='';$('#'+ids[p]+'Refresh').disabled=false;}
    $('#authLoginCaptcha').hidden=true;$('#authPasswordFields').hidden=false;$('#authSubmit').hidden=false;
    $('#authEmailInput').value='';$('#authEmailCode').value='';$('#authEmailBox').hidden=!register;
    $('#authEmailDivider').hidden=register;$('#authEmailVerifyBtn').hidden=register;
    $('#authPass').placeholder=register?'8–128 位密码':'密码';
    $('#authEmailModeToggle').textContent='✉️ 邮箱验证码登录';
    if(register)refresh('email');
  }
  async function failed(data){
    if(state.authMode==='login'&&(data.code==='captcha_required'||!$('#authLoginCaptcha').hidden)){
      $('#authLoginCaptcha').hidden=false;await refresh('login');$('#authLoginCaptchaAnswer').focus();
    }
  }
  for(const purpose of ['login','email'])$('#'+ids[purpose]+'Refresh').addEventListener('click',()=>refresh(purpose));
  $('#authLoginCaptchaAnswer').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();submitAuth();}});
  window.AuthGuard={opened,refresh,body,failed};
})();
