/* One-time, same-origin standalone-community preview, consumed once by the editor. */
window.RecipeHandoff = (() => {
  const key='landscape:one-time-preview',editor=new URL('.',document.currentScript.src);
  function open(recipe,customUrl){
    const target=customUrl?new URL(customUrl,location.href):editor;
    if(target.origin!==location.origin||!/^https?:$/.test(target.protocol))throw Error('请从平台主站打开社区，再预览这份配方。');
    const value=JSON.stringify({sentAt:Date.now(),recipe});
    if(value.length>400000)throw Error('配方内容过大，请从平台主站打开社区预览。');
    sessionStorage.setItem(key,value);
    location.assign(target.href);
  }
  function take(){
    try{const value=sessionStorage.getItem(key);sessionStorage.removeItem(key);if(!value||value.length>400000)return null;const item=JSON.parse(value);return Number.isFinite(item.sentAt)&&Math.abs(Date.now()-item.sentAt)<300000?item.recipe:null;}catch{return null;}
  }
  return {open,take};
})();
