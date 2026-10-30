/* A bounded native-resolution sample: never magnify the downscaled preview. */
window.EditorLoupe = (() => {
  const SIDE=56, SCALE=4, MAX_REGION=1024*1024;
  function sample(source, geometry, point) {
    const width=source.naturalWidth||source.width,height=source.naturalHeight||source.height;
    const frame=EditorCore.geometryFrame(width,height,geometry),inverse=EditorCore.masks.inverse(frame.transform);
    const center=[point.x*frame.fullWidth,point.y*frame.fullHeight];
    const locate=(x,y)=>EditorCore.masks.transform(inverse,center[0]+x-SIDE/2,center[1]+y-SIDE/2);
    const corners=[[0,0],[SIDE,0],[0,SIDE],[SIDE,SIDE]].map(p=>locate(...p));
    if(!corners.flat().every(Number.isFinite))throw Error('细节区域不可用');
    const left=Math.max(0,Math.floor(Math.min(...corners.map(p=>p[0])))-1),top=Math.max(0,Math.floor(Math.min(...corners.map(p=>p[1])))-1);
    const right=Math.min(width,Math.ceil(Math.max(...corners.map(p=>p[0])))+1),bottom=Math.min(height,Math.ceil(Math.max(...corners.map(p=>p[1])))+1);
    const tile=document.createElement('canvas');tile.width=tile.height=SIDE;
    const context=tile.getContext('2d'),out=context.createImageData(SIDE,SIDE);
    if(right>left&&bottom>top){
      if((right-left)*(bottom-top)>MAX_REGION)throw Error('当前位置放大范围过大，请换一个位置');
      const region=document.createElement('canvas');region.width=right-left;region.height=bottom-top;
      const raw=region.getContext('2d',{willReadFrequently:true});raw.drawImage(source,left,top,region.width,region.height,0,0,region.width,region.height);
      const pixels=raw.getImageData(0,0,region.width,region.height).data;
      for(let y=0;y<SIDE;y++)for(let x=0;x<SIDE;x++){
        const p=locate(x+.5,y+.5),sx=Math.floor(p[0]),sy=Math.floor(p[1]);
        if(sx<left||sx>=right||sy<top||sy>=bottom)continue;
        const from=((sy-top)*region.width+sx-left)*4,to=(y*SIDE+x)*4;
        for(let c=0;c<4;c++)out.data[to+c]=pixels[from+c];
      }
      region.width=region.height=0;
    }
    context.putImageData(out,0,0);
    const original=EditorCore.masks.transform(inverse,...center);
    return {tile,x:Math.floor(original[0]),y:Math.floor(original[1]),regionPixels:Math.max(0,right-left)*Math.max(0,bottom-top)};
  }
  return {sample,side:SIDE,scale:SCALE};
})();
