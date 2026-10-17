/* Presentation frames use local CC0 wood textures and remain outside the photo recipe. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EditorFrames=api;})(globalThis,function(){
  const styles=[
    {id:'paper',name:'白色木框',description:'细木纹白漆框，配暖白卡纸'},
    {id:'charcoal',name:'黑色木框',description:'哑光深色木框，保留细腻木纹'},
    {id:'oak',name:'暖木纹框',description:'自然暖木色，四边顺纹与斜角接缝'}
  ];
  const defaults=()=>({style:'paper',margin:8,width:5});
  const materialUrl=typeof document==='undefined'?null:new URL('assets/frames/',document.currentScript?.src||location.href);
  let materials=null,pending=null;
  function layout(width,height,options=defaults()){
    const style=styles.some(s=>s.id===options.style)?options.style:'paper';
    const margin=Math.max(0,Math.min(16,Number(options.margin)||0));
    const rail=Math.max(2,Math.min(10,Number.isFinite(Number(options.width))?Number(options.width):5));
    const mat=Math.round(Math.min(width,height)*margin/100),edge=Math.max(2,Math.round(Math.min(width,height)*rail/100)),inset=mat+edge;
    return{style,mat,edge,inset,width:width+2*inset,height:height+2*inset};
  }
  function tint(image,style){
    const tile=document.createElement('canvas');tile.width=tile.height=1024;
    const c=tile.getContext('2d',{willReadFrequently:true});
    // Fine Grained Wood has vertical grain; normalize every material along the rail.
    if(style!=='oak'){c.translate(1024,0);c.rotate(Math.PI/2);}
    c.drawImage(image,0,0,1024,1024);c.resetTransform();
    const pixels=c.getImageData(0,0,1024,1024),d=pixels.data;
    for(let i=0;i<d.length;i+=4){
      if(style==='oak'){d[i]=82+d[i]*.65;d[i+1]=60+d[i+1]*.75;d[i+2]=38+d[i+2]*.8;}
      else{const grain=(.2126*d[i]+.7152*d[i+1]+.0722*d[i+2]-75)*(style==='paper'?.16:.22);d[i]=(style==='paper'?235:39)+grain;d[i+1]=(style==='paper'?233:40)+grain;d[i+2]=(style==='paper'?225:38)+grain;}
    }
    c.putImageData(pixels,0,0);return tile;
  }
  function load(){
    if(materials)return Promise.resolve();
    if(pending)return pending;
    pending=(async()=>{
      const images=await Promise.all(['fine_grained_wood.jpg','dark_wood.jpg'].map(async file=>{const image=new Image();image.src=new URL(file,materialUrl).href;await image.decode();return image;}));
      materials={paper:tint(images[0],'paper'),charcoal:tint(images[0],'charcoal'),oak:tint(images[1],'oak')};
    })().catch(()=>{pending=null;throw Error('相框材质未能载入，请重试。');});
    return pending;
  }
  function render(photo,options){
    if(!materials)throw Error('相框材质尚未载入。');
    const f=layout(photo.width,photo.height,options),{width:w,height:h,edge:e,inset:i}=f;
    if(w*h>64e6||Math.max(w,h)>32767)throw Error('带框图片尺寸过大，请选择 50% 尺寸再导出。');
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const c=canvas.getContext('2d');c.fillStyle='#f7f4ec';c.fillRect(0,0,w,h);
    const tileSize=Math.min(photo.width,photo.height)*1.4;
    // Four clipped rails meet at 45 degrees. Grain and profile turn with each rail.
    for(let side=0;side<4;side++){
      c.save();c.translate(side===1||side===2?w:0,side>=2?h:0);c.rotate(side*Math.PI/2);
      const length=side%2?h:w;
      c.beginPath();c.moveTo(0,0);c.lineTo(length,0);c.lineTo(length-e,e);c.lineTo(e,e);c.closePath();c.clip();
      const pattern=c.createPattern(materials[f.style],'repeat');
      pattern.setTransform(new DOMMatrix().scale(tileSize/1024).translate(side*83,-side*173));
      c.fillStyle=pattern;c.fillRect(0,0,length,e);
      const profile=c.createLinearGradient(0,0,0,e);
      for(const [stop,color]of [[0,'#ffffff70'],[.045,'#ffffff28'],[.12,'#ffffff00'],[.72,'#00000000'],[.87,'#00000019'],[.94,'#00000060'],[.975,'#ffffff48'],[1,'#00000080']])profile.addColorStop(stop,color);
      c.fillStyle=profile;c.fillRect(0,0,length,e);
      c.fillStyle=side===0?'#ffffff0b':side===2?'#00000018':'#00000008';c.fillRect(0,0,length,e);
      c.lineWidth=Math.max(.5,Math.min(photo.width,photo.height)*.00065);c.strokeStyle='#241a1255';
      c.beginPath();c.moveTo(0,0);c.lineTo(e,e);c.moveTo(length,0);c.lineTo(length-e,e);c.stroke();c.restore();
    }
    if(f.mat){
      const shadow=Math.min(f.mat,Math.max(1,Math.min(photo.width,photo.height)*.007));
      // Shadow lies on the mat; draw the photograph last without an overlay.
      c.save();c.beginPath();c.rect(e,e,w-2*e,h-2*e);c.clip();
      c.shadowColor='#271d1660';c.shadowBlur=shadow;c.lineWidth=Math.max(1,shadow*.5);c.strokeStyle='#c6bfb0';c.strokeRect(e,e,w-2*e,h-2*e);c.restore();
      c.strokeStyle='#d0c9bb';c.lineWidth=Math.max(1,Math.min(photo.width,photo.height)*.002);c.strokeRect(i-.5,i-.5,photo.width+1,photo.height+1);
    }
    c.drawImage(photo,i,i);return canvas;
  }
  return{styles,defaults,layout,load,render};
});
