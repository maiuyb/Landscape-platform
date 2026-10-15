const {test}=require('node:test'),assert=require('node:assert/strict'),Core=require('../风景调色协作平台/frontend/editor-core.js'),D=Core.detail;
const image=(w,h,fn)=>new Uint8ClampedArray(Array.from({length:w*h},(_,i)=>fn(i%w,Math.floor(i/w))).flat());
const run=(pixels,w,h,settings,scale=1)=>D.apply(pixels.slice(),w,h,{...D.defaults(),...settings},scale);
const luma=(d,i)=>.299*d[i]+.587*d[i+1]+.114*d[i+2];
const variance=values=>{const mean=values.reduce((a,b)=>a+b,0)/values.length;return values.reduce((a,b)=>a+(b-mean)**2,0)/values.length;};
test('neutral detail defaults preserve all pixels, and constant colors/alpha survive filtering',()=>{
  const pixels=image(20,15,(x,y)=>[x*10,y*15,70,(x+y)%2?255:0]);assert.deepEqual(run(pixels,20,15,{}),pixels);
  const flat=image(20,15,()=>[80,130,170,150]);assert.deepEqual(run(flat,20,15,{sharpen:100,luminance:100,color:100}),flat);
  const out=run(pixels,20,15,{sharpen:80,luminance:70,color:60});for(let i=0;i<pixels.length;i+=4){assert.equal(out[i+3],pixels[i+3]);if(!pixels[i+3])assert.deepEqual(out.slice(i,i+4),pixels.slice(i,i+4));}
});
test('luma denoise reduces known luminance noise while preserving a strong step edge',()=>{
  const w=48,h=24,p=image(w,h,(x,y)=>{const v=(x<24?65:195)+((x*17+y*23)%17)-8;return[v,v,v,255];}),out=run(p,w,h,{luminance:85});
  const values=d=>Array.from({length:16*16},(_,i)=>d[((i%16+4)+(Math.floor(i/16)+4)*w)*4]);
  assert.ok(variance(values(out))<variance(values(p))*.45);
  assert.ok(out[(12*w+25)*4]-out[(12*w+22)*4]>110);
});
test('color denoise reduces chroma variance without flattening luma or crossing color boundaries',()=>{
  const w=48,h=24,p=image(w,h,(x,y)=>{const n=((x*17+y*23)%19)-9;return[x<24?130+n:190+n,x<24?130-n*.299/.587:70-n*.299/.587,x<24?130:50,255];}),out=run(p,w,h,{color:90});
  const chroma=d=>Array.from({length:16*16},(_,i)=>{const j=((i%16+4)+(Math.floor(i/16)+4)*w)*4;return d[j]-d[j+1];});
  assert.ok(variance(chroma(out))<variance(chroma(p))*.5);
  for(let i=0;i<p.length;i+=4)assert.ok(Math.abs(luma(out,i)-luma(p,i))<1.1);
  assert.ok(out[(12*w+25)*4]-out[(12*w+22)*4]>45);
});
test('sharpen enhances edges; protection suppresses flat-area noise and radius uses source scale',()=>{
  const w=64,h=20,p=image(w,h,(x,y)=>{const v=(x<32?80:180)+((x*11+y*7)%5)-2;return[v,v,v,255];});
  const sharp=run(p,w,h,{sharpen:80,radius:1.5}),protectedImage=run(p,w,h,{sharpen:80,radius:1.5,protection:80});
  assert.ok(sharp[(10*w+31)*4]<p[(10*w+31)*4]);assert.ok(sharp[(10*w+32)*4]>p[(10*w+32)*4]);
  const error=d=>{let sum=0;for(let y=3;y<17;y++)for(let x=5;x<20;x++){const i=(y*w+x)*4;sum+=(d[i]-p[i])**2;}return sum;};
  assert.ok(error(protectedImage)<error(sharp)*.2);
  assert.notDeepEqual(run(p,w,h,{sharpen:80,radius:3}),run(p,w,h,{sharpen:80,radius:3},.3));
});
test('transparent hidden colors do not bleed into opaque image edges',()=>{
  const p=image(20,20,(x)=>x<10?[255,0,255,0]:[100,100,100,255]),out=run(p,20,20,{sharpen:100,radius:3,luminance:100,color:100});
  for(let i=0;i<p.length;i+=4)if(p[i+3])assert.deepEqual(Array.from(out.slice(i,i+3)),[100,100,100]);
});
test('v4 serializes detail and straighten, validates values, and preserves old recipe defaults',()=>{
  const state=Core.createState();state.detail={sharpen:40,radius:1.7,protection:35,luminance:20,color:50};state.geometry.push({type:'straighten',params:{angle:8.3,autoCrop:true}});
  assert.equal(Core.toRecipe(state).version,6);assert.deepEqual(Core.recipeState(Core.createState(),Core.toRecipe(state)).state,state);
  for(const version of[1,2,3])assert.deepEqual(Core.recipeState(Core.createState(),{version,steps:[]}).state.detail,D.defaults());
  const invalid=Core.recipeState(state,{version:4,steps:[{type:'detail',params:{...state.detail,radius:NaN}},{type:'straighten',params:{angle:46,autoCrop:true}},{type:'straighten',params:{angle:5,autoCrop:'yes'}}]});assert.equal(invalid.warnings.length,3);assert.deepEqual(invalid.state,state);
});
test('straighten auto crop remains inside rotated source at multiple sizes and signs',()=>{
  for(const[w,h]of[[2400,1600],[900,1600],[1000,1000]])for(const angle of[-45,-10,0,13,45]){
    const out=Core.straightenSize(w,h,{angle,autoCrop:true}),r=Math.abs(angle)*Math.PI/180;
    assert.ok(out.width*Math.cos(r)+out.height*Math.sin(r)<=w+1e-8);assert.ok(out.width*Math.sin(r)+out.height*Math.cos(r)<=h+1e-8);
    assert.ok(Math.abs(out.width/out.height-w/h)<.003);assert.deepEqual(Core.outputSize(w,h,[{type:'straighten',params:{angle,autoCrop:true}}]),out);
  }
});

test('tiled spatial filters match untiled pixels across seams and image borders',()=>{
  const w=95,h=83,p=image(w,h,(x,y)=>[(x*7+y*13)%256,(x*13+y*7)%256,(x*11+y*3)%256,(x+y)%17?255:0]);
  for(const radius of[.5,1,3]){const settings={...D.defaults(),sharpen:70,radius,protection:35,luminance:55,color:60};assert.deepEqual(D.applyTiled(p.slice(),w,h,settings,1,32),D.apply(p.slice(),w,h,settings));}
});
