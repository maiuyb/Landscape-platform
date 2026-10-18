/* Vector masks live in original-photo coordinates, independent of later geometry. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EditorMasks=api;})(globalThis,function(){
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n)),smooth=n=>{n=clamp(n,0,1);return n*n*(3-2*n);};
  const limits={layers:6,strokes:64,points:4096,strokePoints:512};
  const controls=[
    ['exposure','局部曝光',-3,3,.05,'EV'],['contrast','局部对比度',-100,100,1,''],
    ['highlights','局部高光',-100,100,1,''],['shadows','局部阴影',-100,100,1,''],
    ['temperature','局部色温',-100,100,1,''],['tint','局部色调',-100,100,1,''],
    ['saturation','局部饱和度',-100,100,1,''],['clarity','局部清晰度',-100,100,1,''],['dehaze','局部去朦胧',-100,100,1,'']
  ].map(([key,label,min,max,step,unit])=>({key,label,min,max,step,unit,default:0,hint:'仅作用于当前蒙版覆盖的区域'}));
  const defaults=()=>Object.fromEntries(controls.map(c=>[c.key,0]));
  function create(type,id){return{id,name:{brush:'画笔',linear:'线性渐变',radial:'径向渐变'}[type],type,visible:true,invert:false,opacity:100,feather:70,start:[.25,.5],end:[.75,.5],center:[.5,.5],radius:[.25,.25],strokes:[],adjustments:defaults()};}
  const point=p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&v>=0&&v<=1);
  function valid(m){return m&&typeof m.id==='string'&&/^[\w-]{1,64}$/.test(m.id)&&typeof m.name==='string'&&m.name.length<=60&&['brush','linear','radial'].includes(m.type)&&typeof m.visible==='boolean'&&typeof m.invert==='boolean'&&Number.isFinite(m.opacity)&&m.opacity>=0&&m.opacity<=100&&Number.isFinite(m.feather)&&m.feather>=0&&m.feather<=100&&point(m.start)&&point(m.end)&&point(m.center)&&point(m.radius)&&m.radius.every(v=>v>=.001)&&controls.every(c=>Number.isFinite(m.adjustments?.[c.key])&&m.adjustments[c.key]>=c.min&&m.adjustments[c.key]<=c.max)&&Array.isArray(m.strokes)&&m.strokes.length<=limits.strokes&&m.strokes.reduce((n,s)=>n+(s.points?.length||0),0)<=limits.points&&m.strokes.every(s=>typeof s.erase==='boolean'&&Number.isFinite(s.radius)&&s.radius>=.001&&s.radius<=.5&&Number.isFinite(s.feather)&&s.feather>=0&&s.feather<=1&&Array.isArray(s.points)&&s.points.length>0&&s.points.length<=limits.strokePoints&&s.points.every(point));}
  // Keep legacy Canvas affine arrays exact; perspective uses row-major 3x3.
  const projective=m=>m.length===9?m:[m[0],m[2],m[4],m[1],m[3],m[5],0,0,1];
  function multiply(a,b){if(a.length===9||b.length===9){a=projective(a);b=projective(b);return Array.from({length:9},(_,i)=>{const r=Math.floor(i/3)*3,c=i%3;return a[r]*b[c]+a[r+1]*b[c+3]+a[r+2]*b[c+6];});}return[a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
  function inverse(m){if(m.length===9){const[a,b,c,d,e,f,g,h,i]=m,A=e*i-f*h,B=f*g-d*i,C=d*h-e*g,det=a*A+b*B+c*C;return[A,c*h-b*i,b*f-c*e,B,a*i-c*g,c*d-a*f,C,b*g-a*h,a*e-b*d].map(v=>v/det);}const d=m[0]*m[3]-m[1]*m[2];return[m[3]/d,-m[1]/d,-m[2]/d,m[0]/d,(m[2]*m[5]-m[3]*m[4])/d,(m[1]*m[4]-m[0]*m[5])/d];}
  const transform=(m,x,y)=>m.length===9?[(m[0]*x+m[1]*y+m[2])/(m[6]*x+m[7]*y+m[8]),(m[3]*x+m[4]*y+m[5])/(m[6]*x+m[7]*y+m[8])]:[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
  function raster(m,w,h,frame={}){
    const fw=frame.fullWidth||w,fh=frame.fullHeight||h,sw=frame.sourceWidth||fw,sh=frame.sourceHeight||fh,ox=frame.offsetX||0,oy=frame.offsetY||0,matrix=frame.transform||[fw/sw,0,0,fh/sh,0,0],inv=inverse(matrix),out=new Float32Array(w*h);
    if(m.type==='brush'){
      const projected=matrix.length===9,factor=projected?1:Math.sqrt(Math.abs(matrix[0]*matrix[3]-matrix[1]*matrix[2]));
      for(const stroke of m.strokes){
        const coverage=new Float32Array(w*h),r=Math.max(.1,stroke.radius*Math.min(sw,sh)*factor),inner=r*(1-stroke.feather),points=stroke.points.map(p=>{if(projected)return[p[0]*sw,p[1]*sh];const q=transform(matrix,p[0]*sw,p[1]*sh);return[q[0]-ox,q[1]-oy];});
        for(let s=0;s<Math.max(1,points.length-1);s++){
          const a=points[s],b=points[Math.min(s+1,points.length-1)],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
          const box=projected?[[Math.min(a[0],b[0])-r,Math.min(a[1],b[1])-r],[Math.max(a[0],b[0])+r,Math.min(a[1],b[1])-r],[Math.max(a[0],b[0])+r,Math.max(a[1],b[1])+r],[Math.min(a[0],b[0])-r,Math.max(a[1],b[1])+r]].map(p=>{const q=transform(matrix,...p);return[q[0]-ox,q[1]-oy];}):[[Math.min(a[0],b[0])-r,Math.min(a[1],b[1])-r],[Math.max(a[0],b[0])+r,Math.max(a[1],b[1])+r]];
          const left=Math.max(0,Math.floor(Math.min(...box.map(p=>p[0])))),right=Math.min(w-1,Math.ceil(Math.max(...box.map(p=>p[0])))),top=Math.max(0,Math.floor(Math.min(...box.map(p=>p[1])))),bottom=Math.min(h-1,Math.ceil(Math.max(...box.map(p=>p[1]))));
          for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++){
            let qx=x+.5,qy=y+.5;if(projected){const q=transform(inv,x+ox+.5,y+oy+.5);qx=q[0];qy=q[1];}
            const t=length?clamp(((qx-a[0])*dx+(qy-a[1])*dy)/length,0,1):0,d=Math.hypot(qx-a[0]-t*dx,qy-a[1]-t*dy),v=d<=inner?1:1-smooth((d-inner)/Math.max(.0001,r-inner)),i=y*w+x;
            coverage[i]=Math.max(coverage[i],v);
          }
        }
        for(let i=0;i<out.length;i++)out[i]=stroke.erase?out[i]*(1-coverage[i]):out[i]+coverage[i]*(1-out[i]);
      }
    }else{
      const sx=m.start[0]*sw,sy=m.start[1]*sh,dx=(m.end[0]-m.start[0])*sw,dy=(m.end[1]-m.start[1])*sh,length=dx*dx+dy*dy;
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const p=transform(inv,x+ox+.5,y+oy+.5);let weight;
        if(m.type==='linear')weight=length>1e-6?clamp(((p[0]-sx)*dx+(p[1]-sy)*dy)/length,0,1):0;
        else{const d=Math.hypot((p[0]/sw-m.center[0])/m.radius[0],(p[1]/sh-m.center[1])/m.radius[1]),inner=1-m.feather/100;weight=d<=inner?1:1-smooth((d-inner)/Math.max(.0001,1-inner));}
        out[y*w+x]=weight;
      }
    }
    for(let i=0;i<out.length;i++)out[i]=(m.invert?1-out[i]:out[i])*m.opacity/100;
    return out;
  }
  const active=m=>m.visible&&m.opacity>0&&controls.some(c=>m.adjustments[c.key]!==0);
  function overlay(m,w,h,frame){const weights=raster(m,w,h,frame),data=new Uint8ClampedArray(w*h*4);for(let i=0;i<weights.length;i++){data[i*4]=255;data[i*4+1]=65;data[i*4+2]=80;data[i*4+3]=Math.round(weights[i]*95);}return data;}
  return{controls,defaults,create,valid,limits,multiply,inverse,transform,raster,active,overlay};
});
