/* Editor-owned adapter around the unchanged community app from 87a0ae1. */
(() => {
  // Hosting prefix belongs to this adapter, leaving the member's API unchanged.
  const prefix = new URL('../', location.href).pathname.replace(/\/$/, '');
  const originalApi = api;
  api = (path, options) => originalApi(prefix + path, options);
  if (parent === window) return;
  let channel='',sequence=0,previewRequest=0,pendingPublish=false;const seenShares=new Set();
  const originalAuth=submitAuth;
  submitAuth=async()=>{
    await originalAuth();
    if(state.user&&pendingPublish){pendingPublish=false;document.querySelector('#publishModal').classList.add('open');}
  };
  const send=(type,data={})=>parent.postMessage({type,channel,id:channel+':'+(++sequence),sentAt:Date.now(),...data},location.origin);
  const valid=e=>e.source===parent&&e.origin===location.origin&&e.data&&typeof e.data==='object';
  const setFile=(selector,blob,name)=>{
    const input=document.querySelector(selector);
    const transfer=new DataTransfer();
    if(blob)transfer.items.add(new File([blob],name,{type:'image/png'}));
    input.files=transfer.files;
    input.dataset.fromEditor='1';
    const note=input.closest('.file-field')?.querySelector('.file-note');
    if(note) note.textContent='默认使用编辑器内图片';
  };
  window.addEventListener('message',e=>{
    if(!valid(e))return;
    const d=e.data;
    if(d.type==='landscape:connect'&&typeof d.channel==='string'){
      channel=d.channel;send('landscape:ready');return;
    }
    if(channel&&d.channel===channel&&d.type==='landscape:auth'&&Number.isFinite(d.sentAt)&&Math.abs(Date.now()-d.sentAt)<=300000){openAuth('login');return;}
    if(channel&&d.channel===channel&&d.type==='landscape:search'&&Number.isFinite(d.sentAt)&&Math.abs(Date.now()-d.sentAt)<=300000){
      const query=String(d.query||'').trim();
      const input=document.querySelector('#search');
      if(input)input.value=query;
      state.search=query;
      if(state.view!=='community')switchView('community');else loadRecipes(true);
      return;
    }
    if(!channel||d.channel!==channel||d.type!=='landscape:share'||typeof d.id!=='string'||!d.id||seenShares.has(d.id)||!Number.isFinite(d.sentAt)||Math.abs(Date.now()-d.sentAt)>300000)return;
    if(!d.payload?.recipe||!(d.after instanceof Blob))return;
    seenShares.add(d.id);if(seenShares.size>100)seenShares.delete(seenShares.values().next().value);
    // Reuse the community's existing parser and metadata form; consume immediately.
    localStorage.setItem(SHARE_KEY,JSON.stringify(d.payload));
    loadHandoff();localStorage.removeItem(SHARE_KEY);
    setFile('#pBefore',d.before,'调色前.png');setFile('#pAfter',d.after,'调色后.png');
    document.querySelector('#publishModal').classList.add('open');
    document.querySelector('#publishError').textContent='';
    send('landscape:share-received');
    if(!state.user){pendingPublish=true;document.querySelector('#publishModal').classList.remove('open');toast('请先登录，再发布当前作品');openAuth('login');}
  });
  // Preserve the community DOM, filters and scroll, and return to the live editor.
  previewInEditor=async id=>{
    const button=document.querySelector('#dPreview'),request=++previewRequest;
    const r=await api('/api/recipes/'+id,{auth:true});
    if(request!==previewRequest||!button?.isConnected||!document.querySelector('#detailModal').classList.contains('open'))return;
    if(!r.ok){toast(r.data.error||'配方读取失败');return;}
    if(!channel){toast('编辑器连接尚未就绪，请稍后重试');return;}
    send('landscape:preview',{payload:{recipe:r.data.recipe,meta:{id,name:r.data.recipe.name,author:r.data.recipe.author}}});
  };
  document.addEventListener('click',e=>{if(e.target.closest('[data-close]')||e.target===document.querySelector('#detailModal'))previewRequest++;});
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelector('#pLoadHandoff').onclick=()=>send('landscape:share-request');
  });
  window.addEventListener('storage',e=>{
    if([TOKEN_KEY,USER_KEY,LEGACY_TOKEN_KEY,LEGACY_USER_KEY].includes(e.key)){
      state.token=readToken();state.user=readUser();renderAuth();
    }
  });
})();
