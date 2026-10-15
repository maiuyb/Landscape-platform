/* Spatial filters shared by the preview worker, native-pixel inspector and export. */
(function(root,factory){const detail=factory();if(typeof module==='object'&&module.exports)module.exports=detail;else root.EditorDetail=detail;})(globalThis,function(){
  const controls=[
    {key:'sharpen',label:'锐化',min:0,max:100,step:1,default:0,hint:'增强边缘细节；过强可能产生光晕'},
    {key:'radius',label:'锐化半径',min:.5,max:3,step:.1,default:1,unit:'像素',hint:'按源图像素计算；数值越大，影响的边缘越宽',depends:'sharpen'},
    {key:'protection',label:'锐化边缘保护',min:0,max:100,step:1,default:0,hint:'优先增强明显边缘，减少天空与噪点被锐化',depends:'sharpen'},
    {key:'luminance',label:'明度降噪',min:0,max:100,step:1,default:0,hint:'减少明暗噪点；过强会损失细小纹理'},
    {key:'color',label:'颜色降噪',min:0,max:100,step:1,default:0,hint:'减少杂色噪点，同时保留颜色边界'}
  ];
  const defaults=()=>Object.fromEntries(controls.map(c=>[c.key,c.default]));
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function radii(p,scale){return {noise:(p.luminance||p.color)?Math.ceil(2*Math.max(.35,1.3*scale)):0,sharp:p.sharpen?Math.ceil(3*Math.max(.2,p.radius*scale)):0};}
  function padding(p,scale=1){const r=radii(p,scale);return r.noise+r.sharp+2;}
  function gaussian(values,alpha,w,h,sigma){
    const r=Math.ceil(3*sigma),kernel=[];for(let k=-r;k<=r;k++)kernel.push(Math.exp(-k*k/(2*sigma*sigma)));
    const temp=new Float32Array(values.length),out=new Float32Array(values.length);
    for(let axis=0;axis<2;axis++){
      const src=axis?temp:values,dst=axis?out:temp;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const i=y*w+x;if(!alpha[i])continue;let sum=0,weight=0;
        for(let k=-r;k<=r;k++){
          const j=axis?clamp(y+k,0,h-1)*w+x:y*w+clamp(x+k,0,w-1),a=kernel[k+r]*alpha[j];
          sum+=src[j]*a;weight+=a;
        }
        dst[i]=weight?sum/weight:src[i];
      }
    }
    return out;
  }
  function apply(data,w,h,params,scale=1){
    const p={...defaults(),...params};if(!p.sharpen&&!p.luminance&&!p.color)return data;
    const size=w*h,Y=new Float32Array(size),U=new Float32Array(size),V=new Float32Array(size),alpha=new Float32Array(size);
    for(let i=0,j=0;i<size;i++,j+=4){Y[i]=.299*data[j]+.587*data[j+1]+.114*data[j+2];U[i]=data[j+2]-Y[i];V[i]=data[j]-Y[i];alpha[i]=data[j+3]/255;}
    let resultY=Y,resultU=U,resultV=V;
    if(p.luminance||p.color){
      const sigma=Math.max(.35,1.3*scale),r=radii(p,scale).noise,spatial=[],lumaWeights=new Float32Array(511),colorWeights=new Float32Array(1021);
      const lumaSigma=6+p.luminance*.35,colorSigma=12+p.color*.6,guideSigma=10+p.color*.15;
      for(let k=0;k<511;k++)lumaWeights[k]=Math.exp(-k*k/(2*lumaSigma*lumaSigma));
      for(let k=0;k<1021;k++)colorWeights[k]=Math.exp(-k*k/(2*colorSigma*colorSigma));
      const guideWeights=new Float32Array(511);for(let k=0;k<511;k++)guideWeights[k]=Math.exp(-k*k/(2*guideSigma*guideSigma));
      for(let k=-r;k<=r;k++)spatial.push(Math.exp(-k*k/(2*sigma*sigma)));
      // Separable joint bilateral approximation. Both passes use the original guidance
      // so the second pass does not mistake a smoothed color boundary for flat color.
      for(let axis=0;axis<2;axis++){
        const prevY=resultY,prevU=resultU,prevV=resultV;
        resultY=p.luminance?new Float32Array(size):Y;resultU=p.color?new Float32Array(size):U;resultV=p.color?new Float32Array(size):V;
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
          const i=y*w+x;if(!alpha[i])continue;let sy=0,wy=0,su=0,sv=0,wc=0;
          for(let k=-r;k<=r;k++){
            const j=axis?clamp(y+k,0,h-1)*w+x:y*w+clamp(x+k,0,w-1),base=spatial[k+r]*alpha[j];if(!base)continue;
            const diff=Math.min(510,Math.round(Math.abs(Y[i]-Y[j])));
            if(p.luminance){const weight=base*lumaWeights[diff];sy+=prevY[j]*weight;wy+=weight;}
            if(p.color){const cd=Math.min(1020,Math.round(Math.abs(U[i]-U[j])+Math.abs(V[i]-V[j]))),weight=base*guideWeights[diff]*colorWeights[cd];su+=prevU[j]*weight;sv+=prevV[j]*weight;wc+=weight;}
          }
          if(wy)resultY[i]=prevY[i]+(sy/wy-prevY[i])*p.luminance/100;
          if(wc){resultU[i]=prevU[i]+(su/wc-prevU[i])*p.color/100;resultV[i]=prevV[i]+(sv/wc-prevV[i])*p.color/100;}
        }
      }
    }
    let blurred=null;if(p.sharpen)blurred=gaussian(resultY,alpha,w,h,Math.max(.2,p.radius*scale));
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=y*w+x,j=i*4;if(!alpha[i])continue;
      let light=resultY[i];
      if(blurred){
        // Local gradient gate suppresses low-contrast noise without drawing a user mask.
        const left=y*w+Math.max(0,x-1),right=y*w+Math.min(w-1,x+1),top=Math.max(0,y-1)*w+x,bottom=Math.min(h-1,y+1)*w+x;
        const gx=alpha[left]&&alpha[right]?Math.abs(resultY[right]-resultY[left]):0,gy=alpha[top]&&alpha[bottom]?Math.abs(resultY[bottom]-resultY[top]):0;
        const edge=Math.max(gx,gy),threshold=p.protection*.35,gate=p.protection?clamp((edge-threshold)/(10+threshold*.7),0,1):1;
        light+=clamp((light-blurred[i])*p.sharpen/100*1.5,-32,32)*gate;
      }
      const r=light+resultV[i],b=light+resultU[i],g=(light-.299*r-.114*b)/.587;
      data[j]=clamp(r,0,255);data[j+1]=clamp(g,0,255);data[j+2]=clamp(b,0,255);
    }
    return data;
  }
  function applyTiled(data,w,h,params,scale=1,tileSize=512){
    if(w*h<=tileSize*tileSize||(!params.sharpen&&!params.luminance&&!params.color))return apply(data,w,h,params,scale);
    const source=data.slice(),pad=padding(params,scale);
    for(let y=0;y<h;y+=tileSize)for(let x=0;x<w;x+=tileSize){
      const cw=Math.min(tileSize,w-x),ch=Math.min(tileSize,h-y),sx=Math.max(0,x-pad),sy=Math.max(0,y-pad),rw=Math.min(w,x+cw+pad)-sx,rh=Math.min(h,y+ch+pad)-sy;
      const region=new Uint8ClampedArray(rw*rh*4);
      for(let row=0;row<rh;row++)region.set(source.subarray(((sy+row)*w+sx)*4,((sy+row)*w+sx+rw)*4),row*rw*4);
      apply(region,rw,rh,params,scale);
      for(let row=0;row<ch;row++)data.set(region.subarray(((y-sy+row)*rw+x-sx)*4,((y-sy+row)*rw+x-sx+cw)*4),((y+row)*w+x)*4);
    }
    return data;
  }
  return{controls,defaults,apply,applyTiled,padding};
});
