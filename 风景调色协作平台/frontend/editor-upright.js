/* Local straight-line analysis and guide-constrained projective rectification.
 * Geometry: vanishing line -> affine rectification -> orthogonal guide axes.
 * Detection: gradient-oriented Hough voting; no cloud or external runtime. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./editor-masks.js'):root.EditorMasks);if(typeof module==='object'&&module.exports)module.exports=api;else root.EditorUpright=api;})(globalThis,function(M){
  const identity=()=>[1,0,0,0,1,0,0,0,1],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const corners=[[0,0],[1,0],[1,1],[0,1]];
  function valid(m){
    if(!Array.isArray(m)||m.length!==9||!m.every(v=>Number.isFinite(v)&&Math.abs(v)<=16)||Math.abs(m[8]-1)>1e-8)return false;
    const det=m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6]);
    if(det<1e-5||corners.some(([x,y])=>m[6]*x+m[7]*y+1<.08))return false;
    const q=corners.map(p=>M.transform(m,...p));
    return q.every(p=>p.every(v=>Math.abs(v)<=16))&&q.every((a,i)=>{const b=q[(i+1)%4],c=q[(i+2)%4];return(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0])>1e-5;});
  }
  function pixelMatrix(w,h,{matrix,autoCrop}){
    if(matrix.every((v,i)=>Math.abs(v-identity()[i])<1e-12))return identity();
    let m=M.multiply([w,0,0,0,h,0,0,0,1],M.multiply(matrix,[1/w,0,0,0,1/h,0,0,0,1]));
    let q=corners.map(([x,y])=>M.transform(m,x*w,y*h)),center=M.transform(m,w/2,h/2);
    const sx=Math.max(...q.map(p=>Math.abs(p[0]-center[0]))),sy=Math.max(...q.map(p=>Math.abs(p[1]-center[1]))),scale=Math.min(w/(2*sx),h/(2*sy));
    m=M.multiply([scale,0,0,scale,w/2-center[0]*scale,h/2-center[1]*scale],m);
    if(autoCrop){
      q=corners.map(([x,y])=>M.transform(m,x*w,y*h));
      const inside=(x,y)=>q.every((a,i)=>{const b=q[(i+1)%4];return(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])>=-1e-7;});
      let low=0,high=1;for(let i=0;i<32;i++){const k=(low+high)/2;if(corners.every(([x,y])=>inside(w/2+(x-.5)*w*k,h/2+(y-.5)*h*k)))low=k;else high=k;}
      const k=Math.max(.01,low*.99999);m=M.multiply([1/k,0,0,1/k,w/2*(1-1/k),h/2*(1-1/k)],m);
    }
    return m;
  }
  function solve(guides,aspect=1){
    if(!Number.isFinite(aspect)||aspect<=0||!Array.isArray(guides)||guides.length>4)throw Error('参考线无效。');
    const groups={vertical:[],horizontal:[]};
    for(const g of guides){
      if(!groups[g.axis]||![g.a,g.b].every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&v>=0&&v<=1)))throw Error('参考线应位于照片内。');
      const a=[(g.a[0]-.5)*aspect,g.a[1]-.5],b=[(g.b[0]-.5)*aspect,g.b[1]-.5],dx=b[0]-a[0],dy=b[1]-a[1];
      if(Math.hypot(dx,dy)<.08||Math.abs(g.axis==='vertical'?dy:dx)<Math.abs(g.axis==='vertical'?dx:dy)*.65)throw Error('请沿较长的墙边或横向边缘画线，并选择对应方向。');
      const l=cross([...a,1],[...b,1]),n=Math.hypot(l[0],l[1]);groups[g.axis].push({a,b,l:l.map(v=>v/n)});
    }
    if(groups.vertical.length>2||groups.horizontal.length>2||!Object.values(groups).some(g=>g.length===2))throw Error('至少画两条竖直参考线或两条水平参考线，每种最多两条。');
    const direction=(lines,m,axis)=>{
      if(!lines.length)return null;
      const values=lines.map(({a,b})=>{a=M.transform(m,...a);b=M.transform(m,...b);let x=b[0]-a[0],y=b[1]-a[1],n=Math.hypot(x,y),sign=(axis==='vertical'?y:x)<0?-1:1;return[x/n*sign,y/n*sign];});
      const x=values.reduce((s,v)=>s+v[0],0),y=values.reduce((s,v)=>s+v[1],0),n=Math.hypot(x,y);return[x/n,y/n];
    };
    const vanish=axis=>{const lines=groups[axis];if(lines.length<2)return null;
      if(Math.abs(lines[0].l[0]*lines[1].a[0]+lines[0].l[1]*lines[1].a[1]+lines[0].l[2])<.015)throw Error('两条参考线太接近，请选择主体两侧不同的边缘。');
      return cross(lines[0].l,lines[1].l);
    };
    let v=vanish('vertical'),h=vanish('horizontal');
    if(!h){const d=direction(groups.vertical,identity(),'vertical');h=[d[1],-d[0],0];}
    if(!v){const d=direction(groups.horizontal,identity(),'horizontal');v=[-d[1],d[0],0];}
    const horizon=cross(h,v);if(Math.abs(horizon[2])<1e-8)throw Error('参考线交点过近，请选择属于同一平面的边缘。');
    const p=[1,0,0,0,1,0,horizon[0]/horizon[2],horizon[1]/horizon[2],1];
    let dh=direction(groups.horizontal,p,'horizontal'),dv=direction(groups.vertical,p,'vertical');
    if(!dh)dh=[dv[1],-dv[0]];if(!dv)dv=[-dh[1],dh[0]];
    const determinant=dh[0]*dv[1]-dv[0]*dh[1];if(determinant<.3)throw Error('参考方向过于接近，无法稳定矫正。');
    const a=[dv[1]/determinant,-dv[0]/determinant,0,-dh[1]/determinant,dh[0]/determinant,0,0,0,1],c=[aspect,0,-aspect/2,0,1,-.5,0,0,1];
    let matrix=M.multiply(M.inverse(c),M.multiply(a,M.multiply(p,c)));matrix=matrix.map(v=>v/matrix[8]);
    if(!valid(matrix))throw Error('矫正幅度过大，请重新选择参考线，避免画面翻折。');
    return matrix;
  }
  function detect(data,width,height){
    if(width<48||height<48||width>640||height>640||data.length!==width*height*4)return[];
    const gray=new Float32Array(width*height),raw=new Float32Array(width*height);for(let i=0;i<gray.length;i++)raw[i]=(.2126*data[i*4]+.7152*data[i*4+1]+.0722*data[i*4+2])*(data[i*4+3]/255);
    for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){const i=y*width+x;gray[i]=(raw[i]*4+(raw[i-1]+raw[i+1]+raw[i-width]+raw[i+width])*2+raw[i-width-1]+raw[i-width+1]+raw[i+width-1]+raw[i+width+1])/16;}
    const points=[];
    for(let y=2;y<height-2;y+=2)for(let x=2;x<width-2;x+=2){const i=y*width+x,gx=-gray[i-width-1]+gray[i-width+1]-2*gray[i-1]+2*gray[i+1]-gray[i+width-1]+gray[i+width+1],gy=-gray[i-width-1]-2*gray[i-width]-gray[i-width+1]+gray[i+width-1]+2*gray[i+width]+gray[i+width+1],mag=Math.hypot(gx,gy);if(mag>60)points.push({x:x-width/2,y:y-height/2,mag,angle:(Math.atan2(gy,gx)*180/Math.PI+180)%180});}
    if(points.length<60)return[];
    const sorted=points.map(p=>p.mag).sort((a,b)=>a-b),threshold=Math.max(60,sorted[Math.floor(sorted.length*.6)]),edges=points.filter(p=>p.mag>=threshold),radius=Math.ceil(Math.hypot(width,height)/2),bins=radius+2,acc=new Float32Array(180*bins),cos=[],sin=[];
    for(let a=0;a<180;a++){cos[a]=Math.cos(a*Math.PI/180);sin[a]=Math.sin(a*Math.PI/180);}
    for(const p of edges)for(let k=-12;k<=12;k++){const a=(Math.round(p.angle)+k+180)%180;if(a>35&&a<55||a>125&&a<145)continue;const r=Math.round((p.x*cos[a]+p.y*sin[a]+radius)/2);if(r>=0&&r<bins)acc[a*bins+r]+=1;}
    const peaks=[];for(let a=0;a<180;a++)for(let r=0;r<bins;r++)if(acc[a*bins+r]>=16)peaks.push({a,r,v:acc[a*bins+r]});peaks.sort((a,b)=>b.v-a.v);
    const selected=[],lines=[];
    for(const peak of peaks){if(selected.some(p=>{const delta=Math.abs(p.a-peak.a);return(Math.min(delta,180-delta)<5)&&Math.abs((delta>90?bins-1-p.r:p.r)-peak.r)<6;}))continue;selected.push(peak);if(selected.length>160||lines.length>=24)break;
      const {a,r}=peak,rho=r*2-radius,tangent=[-sin[a],cos[a]],matches=edges.filter(p=>{const delta=Math.abs(p.angle-a);return Math.min(delta,180-delta)<=12&&Math.abs(p.x*cos[a]+p.y*sin[a]-rho)<2;}).map(p=>p.x*tangent[0]+p.y*tangent[1]).sort((a,b)=>a-b);
      let first=0,best=[0,0,0];for(let i=1;i<=matches.length;i++)if(i===matches.length||matches[i]-matches[i-1]>12){if(i-first>best[2])best=[matches[first],matches[i-1],i-first];first=i;}
      const length=best[1]-best[0];if(length<Math.min(width,height)*.25||best[2]<length*.25)continue;
      const endpoint=t=>[(rho*cos[a]+t*tangent[0]+width/2)/width,(rho*sin[a]+t*tangent[1]+height/2)/height];
      const ends=[endpoint(best[0]),endpoint(best[1])].map(p=>p.map(v=>Math.max(0,Math.min(1,v))));
      lines.push({axis:a<45||a>135?'vertical':'horizontal',a:ends[0],b:ends[1],length,support:Math.min(1,best[2]*2/length)});
    }
    return lines;
  }
  function automatic(data,width,height){
    const lines=detect(data,width,height),groups={vertical:lines.filter(l=>l.axis==='vertical'),horizontal:lines.filter(l=>l.axis==='horizontal')},pairs={};
    for(const axis of ['vertical','horizontal']){const list=groups[axis],index=axis==='vertical'?0:1,candidates=[];
      for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){const a=list[i],b=list[j],separation=Math.abs((a.a[index]+a.b[index]-b.a[index]-b.b[index])/2);if(separation<.18)continue;
        try{solve([a,b],width/height);candidates.push({guides:[a,b],score:(a.length+b.length)*Math.min(a.support,b.support)*separation});}catch{}}
      pairs[axis]=candidates.sort((a,b)=>b.score-a.score).slice(0,3);
    }
    const options=[];
    for(const v of pairs.vertical)for(const h of pairs.horizontal)options.push([...v.guides,...h.guides]);
    for(const axis of ['vertical','horizontal'])for(const p of pairs[axis])options.push(p.guides);
    let best=null;
    for(const guides of options){try{
      const matrix=solve(guides,width/height),residual=lines.filter(l=>guides.some(g=>g.axis===l.axis)).map(l=>{const a=M.transform(matrix,...l.a),b=M.transform(matrix,...l.b),dx=(b[0]-a[0])*width,dy=(b[1]-a[1])*height;return{error:Math.atan2(Math.abs(l.axis==='vertical'?dx:dy),Math.abs(l.axis==='vertical'?dy:dx))*180/Math.PI,weight:l.length*l.support};}),weight=residual.reduce((s,v)=>s+v.weight,0),error=residual.reduce((s,v)=>s+Math.min(30,v.error)*v.weight,0)/weight;
      if(error>3.5||guides.some(g=>g.support<.5))continue;
      const score=guides.reduce((s,g)=>s+g.length,0)*(guides.length===4?1.3:1)/(1+error);
      if(!best||score>best.score)best={matrix,guides:guides.map(({axis,a,b})=>({axis,a,b})),score,error,lineCount:lines.length};
    }catch{}}
    return best;
  }
  return{identity,valid,pixelMatrix,solve,detect,automatic};
});
