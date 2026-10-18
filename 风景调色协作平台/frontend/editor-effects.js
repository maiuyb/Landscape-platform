/* Deterministic local contrast, atmospheric veil, RGB calibration and vignette. */
(function(root,factory){const effects=factory();if(typeof module==='object'&&module.exports)module.exports=effects;else root.EditorEffects=effects;})(globalThis,function(){
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
  const defaults=()=>({clarity:0,dehaze:0,calibration:Object.fromEntries(['red','green','blue'].map(k=>[k,{hue:0,saturation:0}])),vignette:{profile:'corner',amount:0,midpoint:50,feather:70,roundness:0,centerX:50,centerY:50}});
  const controls=[{key:'clarity',label:'清晰度',hint:'增强中等尺度的明暗层次；负值柔化',min:-100,max:100},{key:'dehaze',label:'去朦胧',hint:'减少雾感；负值增加雾感，过强可能压暗或放大噪点',min:-100,max:100}].map(c=>({step:1,default:0,unit:'',...c}));
  const vignetteControls=[['amount','暗角强度',-100,100,0,'负值压暗边缘，正值提亮边缘'],['midpoint','暗角范围',0,100,50,'调整保留的中心区域大小'],['feather','暗角羽化',0,100,70,'使边缘过渡更柔和'],['roundness','暗角圆度',0,100,0,'从跟随画面比例的椭圆变为圆形'],['centerX','暗角中心 · 水平',0,100,50,'按当前构图定位中心'],['centerY','暗角中心 · 垂直',0,100,50,'按当前构图定位中心']].map(([key,label,min,max,value,hint])=>({key,label,min,max,default:value,hint,step:1,unit:''}));
  function valid(p){return p&&[undefined,'legacy','corner'].includes(p.vignette?.profile)&&controls.every(c=>Number.isFinite(p[c.key])&&p[c.key]>=c.min&&p[c.key]<=c.max)&&vignetteControls.every(c=>Number.isFinite(p.vignette?.[c.key])&&p.vignette[c.key]>=c.min&&p.vignette[c.key]<=c.max)&&['red','green','blue'].every(k=>['hue','saturation'].every(c=>Number.isFinite(p.calibration?.[k]?.[c])&&Math.abs(p.calibration[k][c])<=100));}
  function calibrationMatrix(calibration){
    if(!calibration||Object.values(calibration).every(p=>!p.hue&&!p.saturation))return null;
    const weights=[.299,.587,.114],matrix=[1,0,0,0,1,0,0,0,1];
    for(const[index,key]of['red','green','blue'].entries()){
      const p=calibration[key],h=((index*120+p.hue*.3+360)%360)/60,x=1-Math.abs(h%2-1);
      const rgb=h<1?[1,x,0]:h<2?[x,1,0]:h<3?[0,1,x]:h<4?[0,x,1]:h<5?[x,0,1]:[1,0,x];
      const delta=rgb.map((v,k)=>((v-1/3)*(1+p.saturation/100)-((k===index?1:0)-1/3))*.65),luma=delta.reduce((v,d,k)=>v+d*weights[k],0);
      for(let row=0;row<3;row++)for(let column=0;column<3;column++)matrix[row*3+column]+=(delta[row]-luma)*((column===index?1:0)-weights[column]);
    }
    return matrix;
  }
  function blur(values,alpha,w,h,r){
    if(!r)return values.slice();const temp=new Float32Array(values.length),out=new Float32Array(values.length);
    for(let axis=0;axis<2;axis++){
      const src=axis?temp:values,dst=axis?out:temp,lines=axis?w:h,length=axis?h:w;
      const index=(line,k)=>axis?clamp(k,0,h-1)*w+line:line*w+clamp(k,0,w-1);
      for(let line=0;line<lines;line++){
        let sum=0,count=0;for(let k=-r;k<=r;k++){const i=index(line,k);sum+=src[i]*alpha[i];count+=alpha[i];}
        for(let k=0;k<length;k++){
          const i=index(line,k);dst[i]=count?sum/count:src[i];const leave=index(line,k-r),enter=index(line,k+r+1);sum+=src[enter]*alpha[enter]-src[leave]*alpha[leave];count+=alpha[enter]-alpha[leave];
        }
      }
    }
    return out;
  }
  function minimum(values,w,h,r){
    const tmp=new Float32Array(values.length),out=new Float32Array(values.length),queue=new Int32Array(Math.max(w,h)+2*r+2);
    for(let axis=0;axis<2;axis++){
      const src=axis?tmp:values,dst=axis?out:tmp,lines=axis?w:h,length=axis?h:w;
      const index=(line,k)=>axis?clamp(k,0,h-1)*w+line:line*w+clamp(k,0,w-1);
      for(let line=0;line<lines;line++){
        let head=0,tail=0;
        for(let k=-r;k<length+r;k++){
          const v=src[index(line,k)];while(tail>head&&src[index(line,queue[tail-1])]>=v)tail--;queue[tail++]=k;
          while(tail>head&&queue[head]<k-2*r)head++;
          if(k>=r)dst[index(line,k-r)]=src[index(line,queue[head])];
        }
      }
    }
    return out;
  }
  function airlight(data){
    const samples=[],stride=Math.max(1,Math.ceil(data.length/4/50000))*4;
    for(let i=0;i<data.length;i+=stride)if(data[i+3]>127)samples.push({dark:Math.min(data[i],data[i+1],data[i+2]),rgb:[data[i],data[i+1],data[i+2]]});
    if(!samples.length)return[1,1,1];samples.sort((a,b)=>b.dark-a.dark);
    const count=Math.max(1,Math.ceil(samples.length*.005)),sum=[0,0,0];for(let i=0;i<count;i++)for(let c=0;c<3;c++)sum[c]+=samples[i].rgb[c];return sum.map(v=>clamp(v/count/255,.65,1));
  }
  function padding(p,scale=1){return (p.clarity?3*Math.max(1,Math.ceil(8*scale)):0)+(p.dehaze>0?Math.max(1,Math.ceil(12*scale))+Math.max(1,Math.ceil(6*scale)):0)+2;}
  function active(p){return !!(p.clarity||p.dehaze||p.vignette.amount);}
  function apply(data,w,h,p,scale=1,frame={}){
    if(!active(p))return data;
    const n=w*h,alpha=new Float32Array(n);for(let i=0;i<n;i++)alpha[i]=data[i*4+3]/255;
    if(p.dehaze){
      const A=frame.airlight||airlight(data),strength=p.dehaze/100;let transmission=null;
      if(strength>0){const dark=new Float32Array(n);for(let i=0;i<n;i++)dark[i]=alpha[i]?Math.min(data[i*4]/(255*A[0]),data[i*4+1]/(255*A[1]),data[i*4+2]/(255*A[2])):1;transmission=blur(minimum(dark,w,h,Math.max(1,Math.ceil(12*scale))),alpha,w,h,Math.max(1,Math.ceil(6*scale)));}
      for(let i=0;i<n;i++)if(alpha[i]){
        const dark=transmission?clamp(transmission[i],0,1):0,skyProtection=1-.65*smooth((dark-.65)/.3),t=strength>0?Math.max(.3,1-strength*.8*dark*skyProtection):1+strength*.5;
        for(let c=0;c<3;c++){const I=data[i*4+c]/255;data[i*4+c]=clamp((strength>0?(I-A[c])/t+A[c]:I*t+A[c]*(1-t))*255,0,255);}
      }
    }
    if(p.clarity){
      const luminance=new Float32Array(n);for(let i=0;i<n;i++)luminance[i]=.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2];let base=luminance;
      const r=Math.max(1,Math.ceil(8*scale));for(let k=0;k<3;k++)base=blur(base,alpha,w,h,r);
      for(let i=0;i<n;i++)if(alpha[i]){const mid=4*(luminance[i]/255)*(1-luminance[i]/255),delta=clamp((luminance[i]-base[i])*p.clarity/100*1.3*mid,-35,35);for(let c=0;c<3;c++)data[i*4+c]=clamp(data[i*4+c]+delta,0,255);}
    }
    const v=p.vignette;
    if(v.amount){
      const fw=frame.fullWidth||w,fh=frame.fullHeight||h,ox=frame.offsetX||0,oy=frame.offsetY||0,round=v.roundness/100,minimumSize=Math.min(fw,fh),rx=(fw*(1-round)+minimumSize*round)/2,ry=(fh*(1-round)+minimumSize*round)/2,inner=.05+v.midpoint*.009,span=.1+v.feather*.012;
      const corner=v.profile==='corner',cornerInner=.52+v.midpoint*.006-Math.abs(v.amount)*.0018,cornerSpan=Math.max(.02,(1-cornerInner)*(.35+v.feather*.0065));
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;if(!data[i+3])continue;const d=Math.hypot((x+ox+.5-fw*v.centerX/100)/rx,(y+oy+.5-fh*v.centerY/100)/ry),weight=corner?smooth((d/Math.SQRT2-cornerInner)/cornerSpan):smooth((d-inner)/span),gain=2**(v.amount/100*1.5*weight);for(let c=0;c<3;c++)data[i+c]=v.amount<0?data[i+c]*gain:255-(255-data[i+c])/gain;}
    }
    return data;
  }
  return{defaults,controls,vignetteControls,valid,calibrationMatrix,airlight,padding,active,apply,blur,minimum};
});
