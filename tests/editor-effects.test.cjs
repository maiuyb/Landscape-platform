const test=require('node:test'),assert=require('node:assert/strict'),Core=require('../风景调色协作平台/frontend/editor-core.js');
const E=Core.effects,M=Core.masks;
test('gentle corner vignette leaves edge midpoints intact, preserving legacy profile rendering',()=>{
 const w=201,h=101,pixels=new Uint8ClampedArray(w*h*4).fill(160);for(let i=3;i<pixels.length;i+=4)pixels[i]=255;
 const state=Core.createState();state.effects.vignette.amount=-20;
 const modern=pixels.slice();Core.processPixels(modern,w,h,state);
 assert.equal(modern[(100)*4],160);assert.equal(modern[(50*w)*4],160);assert.ok(modern[0]<150);
 delete state.effects.vignette.profile;assert.equal(Core.toRecipe(state).version,6);const legacy=pixels.slice();Core.processPixels(legacy,w,h,state);assert.ok(legacy[100*4]<160);
 const restored=Core.recipeState(Core.createState(),Core.toRecipe(state)).state;assert.equal(restored.effects.vignette.profile,undefined);const roundtrip=pixels.slice();Core.processPixels(roundtrip,w,h,restored);assert.deepEqual(roundtrip,legacy);
});
test('perspective makes a known converging building parallel and supports inverse/affine composition',()=>{
 const w=600,h=400,p={vertical:40,horizontal:0,autoCrop:true},m=Core.perspectiveMatrix(w,h,p);
 const leftTop=M.transform(m,.3*w,0),leftBottom=M.transform(m,.2*w,h),rightTop=M.transform(m,.7*w,0),rightBottom=M.transform(m,.8*w,h);
 assert.ok(Math.abs(leftTop[0]-leftBottom[0])<1e-6);assert.ok(Math.abs(rightTop[0]-rightBottom[0])<1e-6);
 const composed=M.multiply([.8,0,0,.8,-10,-20],m),inverse=M.inverse(composed);
 for(const point of [[0,0],[w,h],[w*.3,h*.8]]){const back=M.transform(inverse,...M.transform(composed,...point));assert.ok(back.every((n,i)=>Math.abs(n-point[i])<1e-6));}
 for(const [width,height]of[[600,400],[400,600]])for(const vertical of[-60,0,60])for(const horizontal of[-60,0,60]){
  const inv=M.inverse(Core.perspectiveMatrix(width,height,{vertical,horizontal,autoCrop:true}));
  for(const corner of[[.5,.5],[width-.5,.5],[width-.5,height-.5],[.5,height-.5]]){const source=M.transform(inv,...corner);assert.ok(source[0]>=0&&source[0]<=width&&source[1]>=0&&source[1]<=height);}
 }
 const state=Core.createState();state.geometry.push({type:'perspective',params:p});assert.deepEqual(Core.recipeState(Core.createState(),Core.toRecipe(state)).state,state);
 assert.equal(Core.recipeState(Core.createState(),{version:6,steps:[{type:'perspective',params:{...p,vertical:Infinity}}]}).warnings.length,1);
});
test('all original-coordinate mask types remain consistent through perspective and tiled rendering',()=>{
 const w=120,h=80,frame=Core.geometryFrame(w,h,[{type:'perspective',params:{vertical:35,horizontal:-20,autoCrop:true}}]);
 for(const type of['brush','linear','radial']){
  const mask=M.create(type,'projected');if(type==='brush')mask.strokes=[{points:[[.2,.3],[.8,.6]],radius:.12,feather:.6,erase:false}];
  const full=M.raster(mask,w,h,frame),tile=M.raster(mask,31,23,{...frame,offsetX:40,offsetY:25});
  assert.ok(full.some(v=>v>.1));for(let y=0;y<23;y++)for(let x=0;x<31;x++)assert.ok(Math.abs(tile[y*31+x]-full[(y+25)*w+x+40])<1e-6);
 }
});
function fixture(w,h){const d=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;d.set([55+(x*7+y*3)%150,65+(x*3+y*5)%140,85+(x*2+y*7)%130,(x+y)%37?255:0],i);}return d;}
test('RGB calibration alters mixed colors, preserves neutrals/alpha and differs from eight-band HSL',()=>{
 const original=new Uint8ClampedArray([120,120,120,255,185,110,95,130,80,160,190,255]),s=Core.createState();s.effects.calibration.red.hue=55;s.effects.calibration.blue.saturation=-50;const actual=original.slice();Core.adjustPixels(actual,s);assert.deepEqual(actual.slice(0,4),original.slice(0,4));assert.notDeepEqual(actual.slice(4,7),original.slice(4,7));assert.equal(actual[7],130);
 const hsl=Core.createState();hsl.hsl.red.hue=55;hsl.hsl.blue.saturation=-50;const other=original.slice();Core.adjustPixels(other,hsl);assert.notDeepEqual(actual,other);
});
test('local contrast preserves uniform colors and changes edges; negative clarity softens',()=>{
 const w=160,h=20,d=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)d.set([x<80?90:150,x<80?90:150,x<80?90:150,255],(y*w+x)*4);
 const positive=d.slice(),negative=d.slice(),p=E.defaults();p.clarity=70;E.apply(positive,w,h,p);p.clarity=-70;E.apply(negative,w,h,p);const i=(10*w+79)*4;assert.ok(positive[i]<d[i]);assert.ok(negative[i]>d[i]);assert.equal(positive[0],90);assert.equal(positive[3],255);
});
test('dehaze removes a known atmospheric veil; negative values add a veil without changing alpha',()=>{
 const d=new Uint8ClampedArray([95,120,145,255,165,175,185,255]),p=E.defaults(),a=d.slice();p.dehaze=60;E.apply(a,2,1,p,1,{airlight:[1,1,1]});assert.ok(a[0]<d[0]);assert.ok((a[2]-a[0])>(d[2]-d[0]));p.dehaze=-50;const b=d.slice();E.apply(b,2,1,p,1,{airlight:[1,1,1]});assert.ok(b[0]>d[0]);assert.ok((b[2]-b[0])<(d[2]-d[0]));assert.equal(b[3],255);
});
test('vignette follows frame coordinates, feather and off-center position',()=>{
 const w=101,h=101,d=new Uint8ClampedArray(w*h*4).fill(150);for(let i=3;i<d.length;i+=4)d[i]=255;const p=E.defaults();p.vignette.amount=-80;E.apply(d,w,h,p);assert.ok(d[0]<d[(50*w+50)*4]);assert.equal(d[(50*w+50)*4],150);
 const roi=new Uint8ClampedArray(11*11*4).fill(150);for(let i=3;i<roi.length;i+=4)roi[i]=255;E.apply(roi,11,11,p,1,{fullWidth:w,fullHeight:h,offsetX:0,offsetY:0});for(let y=0;y<11;y++)for(let x=0;x<11;x++)assert.equal(roi[(y*11+x)*4],d[(y*w+x)*4]);
});
test('brush raster supports strokes, feather, erase, inversion and opacity',()=>{
 const m=M.create('brush','a');m.strokes=[{points:[[.25,.5],[.75,.5]],radius:.2,feather:.5,erase:false}];let weights=M.raster(m,100,100);assert.equal(weights[50*100+50],1);assert.equal(weights[0],0);assert.ok(weights[34*100+50]>0&&weights[34*100+50]<1);
 m.strokes.push({points:[[.5,.5]],radius:.08,feather:0,erase:true});weights=M.raster(m,100,100);assert.equal(weights[50*100+50],0);assert.equal(weights[50*100+30],1);m.invert=true;m.opacity=50;weights=M.raster(m,100,100);assert.equal(weights[50*100+50],.5);assert.equal(weights[50*100+30],0);
});
test('gradient masks and affine geometry track the source after crop, rotation, flip and straighten',()=>{
 const geo=[{type:'crop',params:{x:.1,y:.2,width:.8,height:.6}},{type:'rotate',params:{angle:90}},{type:'flip',params:{direction:'h'}},{type:'straighten',params:{angle:8,autoCrop:true}}],frame=Core.geometryFrame(1000,700,geo),m=M.create('linear','a');m.start=[0,0];m.end=[1,0];const weights=M.raster(m,frame.fullWidth,frame.fullHeight,frame),inverse=M.inverse(frame.transform);
 for(const [x,y]of[[50,50],[150,250],[300,400]]){const p=M.transform(inverse,x+.5,y+.5);assert.ok(Math.abs(weights[y*frame.fullWidth+x]-Math.max(0,Math.min(1,p[0]/1000)))<1e-6);const q=M.transform(frame.transform,...p);assert.ok(Math.abs(q[0]-x-.5)<1e-8);}
 const radial=M.create('radial','r');radial.feather=50;assert.equal(M.raster(radial,100,100)[50*100+50],1);assert.equal(M.raster(radial,100,100)[0],0);
});
test('full pipeline and tiled pipeline agree across seams with combined effects and sequential local layers',()=>{
 const w=175,h=109,original=fixture(w,h),s=Core.createState();s.effects.clarity=38;s.effects.dehaze=40;s.effects.vignette.amount=-50;s.effects.vignette.centerX=35;s.effects.calibration.green.hue=-20;s.detail.sharpen=25;s.detail.luminance=20;
 const first=M.create('radial','a');first.adjustments.exposure=.5;first.adjustments.clarity=30;first.adjustments.dehaze=15;const second=M.create('linear','b');second.adjustments.exposure=-.4;second.adjustments.dehaze=-10;s.masks=[first,second];const a=original.slice(),b=original.slice(),frame={...Core.geometryFrame(w,h,[]),airlight:[.9,.94,.98]};Core.processPixels(a,w,h,s,1,frame,1000);Core.processPixels(b,w,h,s,1,frame,48);let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));assert.ok(max<=1,`max pixel difference ${max}`);for(let i=3;i<a.length;i+=4)assert.equal(a[i],original[i]);
});
test('neutral/hidden/zero-opacity masks do not alter output; local exposure only affects selected region',()=>{
 const d=new Uint8ClampedArray(100*20*4).fill(80);for(let i=3;i<d.length;i+=4)d[i]=255;const s=Core.createState(),m=M.create('linear','a');m.start=[.2,0];m.end=[.8,0];s.masks=[m];const neutral=d.slice();Core.processPixels(neutral,100,20,s);assert.deepEqual(neutral,d);m.adjustments.exposure=1;const edited=d.slice();Core.processPixels(edited,100,20,s);assert.equal(edited[0],80);assert.equal(edited[(99)*4],160);m.visible=false;const hidden=d.slice();Core.processPixels(hidden,100,20,s);assert.deepEqual(hidden,d);m.visible=true;m.opacity=0;const zero=d.slice();Core.processPixels(zero,100,20,s);assert.deepEqual(zero,d);
});
test('v6 roundtrip, old recipe compatibility and malformed/oversized mask validation',()=>{
 const s=Core.createState();s.effects.clarity=35;s.effects.calibration.red.saturation=-40;s.effects.vignette.amount=-25;s.masks=[M.create('brush','safe')];s.masks[0].strokes=[{points:[[.2,.4],[.8,.6]],radius:.1,feather:.6,erase:false}];const recipe=Core.toRecipe(s);assert.equal(recipe.version,7);assert.deepEqual(Core.recipeState(Core.createState(),recipe).state,s);assert.deepEqual(Core.recipeState(Core.createState(),{version:5,steps:[]}).state,Core.createState());
 for(const change of[m=>m.radius=[0,0],m=>m.adjustments.exposure=Infinity,m=>m.strokes[0].points=[[NaN,0]],m=>m.id='__bad id',m=>m.strokes[0].points=new Array(513).fill([.5,.5])]){const m=Core.clone(s.masks[0]);change(m);assert.equal(M.valid(m),false);const result=Core.recipeState(Core.createState(),{version:6,steps:[{type:'masks',params:{layers:[m]}}]});assert.equal(result.warnings.length,1);assert.deepEqual(result.state.masks,[]);}
});
