(function(root,factory){const tools=factory();if(typeof module==='object'&&module.exports)module.exports=tools;else root.EditorTools=tools;})(globalThis,function(){
  const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
  const bands=[['red','红色',0],['orange','橙色',30],['yellow','黄色',60],['green','绿色',120],['cyan','青色',180],['blue','蓝色',240],['purple','紫色',270],['magenta','洋红',330]].map(([key,label,hue])=>({key,label,hue}));
  const channels=['master','red','green','blue'];
  const identity=()=>[[0,0],[1,1]];
  const createHSL=()=>Object.fromEntries(bands.map(b=>[b.key,{hue:0,saturation:0,luminance:0}]));
  const createCurves=()=>Object.fromEntries(channels.map(c=>[c,identity()]));
  function validCurve(points){
    return Array.isArray(points)&&points.length>=2&&points.length<=10&&points.every((p,i)=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&v>=0&&v<=1)&&(!i||p[0]-points[i-1][0]>=0.001-1e-9))&&points[0][0]===0&&points.at(-1)[0]===1;
  }
  // Shape-preserving cubic Hermite interpolation: harmonic internal slopes, bounded endpoint slopes.
  function curveLUT(points){
    const n=points.length,h=[],d=[],m=new Array(n).fill(0);
    for(let i=0;i<n-1;i++){h[i]=points[i+1][0]-points[i][0];d[i]=(points[i+1][1]-points[i][1])/h[i];}
    if(n===2)m[0]=m[1]=d[0];
    else{
      for(let i=1;i<n-1;i++)if(d[i-1]*d[i]>0){const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];m[i]=(w1+w2)/(w1/d[i-1]+w2/d[i]);}
      const edge=(h0,h1,d0,d1)=>{let value=((2*h0+h1)*d0-h0*d1)/(h0+h1);if(value*d0<=0)value=0;else if(d0*d1<0&&Math.abs(value)>3*Math.abs(d0))value=3*d0;return value;};
      m[0]=edge(h[0],h[1],d[0],d[1]);m[n-1]=edge(h[n-2],h[n-3],d[n-2],d[n-3]);
    }
    const lut=new Float64Array(256);let segment=0;
    for(let i=0;i<256;i++){
      const x=i/255;while(segment<n-2&&x>points[segment+1][0])segment++;
      const t=(x-points[segment][0])/h[segment],t2=t*t,t3=t2*t;
      lut[i]=clamp(((2*t3-3*t2+1)*points[segment][1]+(t3-2*t2+t)*h[segment]*m[segment]+(-2*t3+3*t2)*points[segment+1][1]+(t3-t2)*h[segment]*m[segment+1])*255,0,255);
    }
    return lut;
  }
  function compileCurves(curves){
    return Object.fromEntries(channels.map(channel=>{const points=curves[channel];return[channel,points.every(p=>Math.abs(p[0]-p[1])<1e-12)?null:curveLUT(points)];}));
  }
  function lookup(lut,value){value=clamp(value,0,255);const i=Math.floor(value),fraction=value-i;return lut[i]+(lut[Math.min(255,i+1)]-lut[i])*fraction;}
  function compileHSL(hsl){
    if(bands.every(b=>Object.values(hsl[b.key]).every(v=>v===0)))return null;
    const table={hue:new Float64Array(360),saturation:new Float64Array(360),luminance:new Float64Array(360)};
    for(let hue=0;hue<360;hue++){
      let left=bands.length-1;for(let i=0;i<bands.length-1;i++)if(hue>=bands[i].hue&&hue<bands[i+1].hue){left=i;break;}
      const right=(left+1)%bands.length,span=(right?bands[right].hue:360)-bands[left].hue;
      const t=(hue-bands[left].hue)/span,s=t*t*(3-2*t);
      for(const key of Object.keys(table))table[key][hue]=hsl[bands[left].key][key]*(1-s)+hsl[bands[right].key][key]*s;
    }
    return table;
  }
  const hueValue=(table,key,i,j,f)=>table[key][i]+(table[key][j]-table[key][i])*f;
  const hueChannel=(p,q,t)=>{t=(t+1)%1;if(t<1/6)return p+(q-p)*6*t;if(t<.5)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;};
  function hslPixel(r,g,b,table,out=[]){
    r=clamp(r/255,0,1);g=clamp(g/255,0,1);b=clamp(b/255,0,1);
    const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
    if(delta<1e-8){out[0]=r*255;out[1]=g*255;out[2]=b*255;return out;}
    let l=(max+min)/2,s=delta/(1-Math.abs(2*l-1)),h;
    if(max===r)h=((g-b)/delta+(g<b?6:0))*60;else if(max===g)h=((b-r)/delta+2)*60;else h=((r-g)/delta+4)*60;
    const i=Math.floor(h)%360,j=(i+1)%360,f=h-Math.floor(h);
    const chromaWeight=clamp(s/0.25,0,1);
    const shift=hueValue(table,'hue',i,j,f)*0.3*chromaWeight,sat=hueValue(table,'saturation',i,j,f)/100,light=hueValue(table,'luminance',i,j,f)/100*chromaWeight;
    h=((h+shift+360)%360)/360;s=clamp(s*(1+sat),0,1);l=clamp(l+light*(light>=0?1-l:l)*0.5,0,1);
    const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;
    out[0]=hueChannel(p,q,h+1/3)*255;out[1]=hueChannel(p,q,h)*255;out[2]=hueChannel(p,q,h-1/3)*255;return out;
  }
  function histogram(data,maxSamples=150000){
    const result=Object.fromEntries(['luma','red','green','blue'].map(k=>[k,new Array(256).fill(0)]));let count=0;
    const step=Math.max(1,Math.ceil(data.length/4/maxSamples))*4;
    for(let i=0;i<data.length;i+=step)if(data[i+3]){result.red[data[i]]++;result.green[data[i+1]]++;result.blue[data[i+2]]++;result.luma[Math.round(.299*data[i]+.587*data[i+1]+.114*data[i+2])]++;count++;}
    result.count=count;return result;
  }
  function sampleGains(rgb){
    if(rgb.length!==3||rgb.some(v=>!Number.isFinite(v)||v<6))throw new Error('这处太暗，无法可靠取样，请选择白色或浅灰区域。');
    if(rgb.some(v=>v>=250)&&Math.max(...rgb)-Math.min(...rgb)>12)throw new Error('这处颜色已截断，请选择未过曝的白色或浅灰区域。');
    const target=.299*rgb[0]+.587*rgb[1]+.114*rgb[2];return rgb.map(v=>clamp(target/v,.25,4));
  }
  // Two chromatic axes plus harmonic normalization: a neutral sample retains its
  // original luminance. The inverse recovers the ratios of sampleGains exactly.
  function whiteBalanceValues(gains){
    return {temperature:25*Math.log2(gains[0]/gains[2]),tint:25*Math.log2(Math.sqrt(gains[0]*gains[2])/gains[1])};
  }
  function whiteBalanceGains(temperature,tint){
    if(temperature===0&&tint===0)return[1,1,1];
    const gains=[2**(temperature/50+tint/75),2**(-2*tint/75),2**(-temperature/50+tint/75)];
    const normalizer=.299/gains[0]+.587/gains[1]+.114/gains[2];return gains.map(v=>v*normalizer);
  }
  function autoWhiteBalance(data){
    // Prefer near-neutral areas; broader gray-world fallback handles a stronger overall cast.
    for(const threshold of [.12,.35]){
      const sums=[0,0,0];let count=0;
      for(let i=0;i<data.length;i+=4){if(!data[i+3])continue;const rgb=[data[i],data[i+1],data[i+2]],max=Math.max(...rgb),min=Math.min(...rgb);
        if(min<12||max>245||(max-min)/(max||1)>threshold)continue;
        rgb.forEach((v,k)=>sums[k]+=v);count++;
      }
      if(count>=Math.max(16,data.length/4*.005)){
        const rgb=sums.map(v=>v/count),gains=sampleGains(rgb);return gains.map(v=>clamp(v,.65,1.55));
      }
    }
    throw new Error('照片中可用于估计白平衡的区域不足，请使用取样笔。');
  }
  function autoExposure(data){
    const hist=histogram(data).luma,total=hist.reduce((a,b)=>a+b,0);
    if(!total)throw new Error('没有可用于估计曝光的像素。');
    const percentile=q=>{let sum=0;for(let i=0;i<256;i++){sum+=hist[i];if(sum>=total*q)return Math.max(1,i)/255;}return 1;};
    const median=percentile(.5),bright=percentile(.99);
    return Math.round(clamp(Math.min(Math.log2(.45/median)*.7,Math.log2(.98/bright)+.25),-1.5,1.5)*20)/20;
  }
  function resizeCrop(start,handle,dx,dy,ratio=0,minWidth=.001,minHeight=.001){
    const left=handle.includes('w'),right=handle.includes('e'),top=handle.includes('n'),bottom=handle.includes('s');
    let x=start.x,y=start.y,w=start.width,h=start.height;
    if(left){x=clamp(x+dx,0,start.x+start.width-minWidth);w=start.x+start.width-x;}
    if(right)w=clamp(w+dx,minWidth,1-x);
    if(top){y=clamp(y+dy,0,start.y+start.height-minHeight);h=start.y+start.height-y;}
    if(bottom)h=clamp(h+dy,minHeight,1-y);
    if(ratio){
      const corner=(left||right)&&(top||bottom);
      if(corner){
        if(Math.abs(dx)/start.width>=Math.abs(dy)/start.height)h=w/ratio;else w=h*ratio;
        const ax=left?start.x+start.width:start.x,ay=top?start.y+start.height:start.y;
        const maxW=left?ax:1-ax,maxH=top?ay:1-ay;
        w=clamp(w,Math.max(minWidth,minHeight*ratio),Math.min(maxW,maxH*ratio));h=w/ratio;x=left?ax-w:ax;y=top?ay-h:ay;
      }else if(left||right){
        const cy=start.y+start.height/2,ax=left?start.x+start.width:start.x;
        w=clamp(w,Math.max(minWidth,minHeight*ratio),Math.min(left?ax:1-ax,2*Math.min(cy,1-cy)*ratio));h=w/ratio;y=cy-h/2;x=left?ax-w:ax;
      }else{
        const cx=start.x+start.width/2,ay=top?start.y+start.height:start.y;
        h=clamp(h,Math.max(minHeight,minWidth/ratio),Math.min(top?ay:1-ay,2*Math.min(cx,1-cx)/ratio));w=h*ratio;x=cx-w/2;y=top?ay-h:ay;
      }
    }
    return{x,y,width:w,height:h};
  }
  return{bands,channels,identity,createHSL,createCurves,validCurve,curveLUT,compileCurves,lookup,compileHSL,hslPixel,histogram,sampleGains,whiteBalanceValues,whiteBalanceGains,autoWhiteBalance,autoExposure,resizeCrop};
});
