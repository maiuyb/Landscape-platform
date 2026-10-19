/* Shared, deterministic document model for preview, undo and full-size export. */
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.EditorCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const Tools = typeof module === 'object' && module.exports ? require('./editor-tools.js') : globalThis.EditorTools;
  const Detail = typeof module === 'object' && module.exports ? require('./editor-detail.js') : globalThis.EditorDetail;
  const Effects = typeof module === 'object' && module.exports ? require('./editor-effects.js') : globalThis.EditorEffects;
  const Masks = typeof module === 'object' && module.exports ? require('./editor-masks.js') : globalThis.EditorMasks;
  const Upright = typeof module === 'object' && module.exports ? require('./editor-upright.js') : globalThis.EditorUpright;
  const controls = [
    { key: 'exposure', label: '曝光', group: 'light', min: -3, max: 3, step: 0.01, unit: 'EV', hint: '整体曝光；正值更亮，负值更暗；方向键每次微调 0.01 EV' },
    { key: 'contrast', label: '对比度', group: 'light', hint: '调整明暗之间的差异' },
    { key: 'highlights', label: '高光', group: 'light', hint: '正值提亮亮部，负值压暗亮部' },
    { key: 'shadows', label: '阴影', group: 'light', hint: '正值提亮暗部，负值压暗暗部' },
    { key: 'whites', label: '白色', group: 'endpoints', hint: '调整最亮端；正值提亮，负值压暗' },
    { key: 'blacks', label: '黑色', group: 'endpoints', hint: '调整最暗端；正值抬黑，负值加深' },
    { key: 'brightness', label: '亮度', group: 'more-light', hint: '整体提亮或压暗，与曝光的变化方式不同' },
    { key: 'temperature', label: '色温', group: 'color', rail: 'temperature', hint: '相对色温；负值偏冷，正值偏暖' },
    { key: 'tint', label: '色调', group: 'color', rail: 'tint', hint: '负值偏绿，正值偏洋红' },
    { key: 'saturation', label: '饱和度', group: 'color', rail: 'saturation', hint: '整体增强或减弱色彩' },
    { key: 'vibrance', label: '自然饱和度', group: 'color', rail: 'vibrance', hint: '鲜艳度 / Vibrance：优先调整较淡颜色，减少已鲜艳颜色的增强' }
  ].map(c => ({ min: -100, max: 100, step: 1, unit: '', ...c }));
  const controlByKey = Object.fromEntries(controls.map(c => [c.key, c]));
  const legacyKeys = new Set(controls.filter(c => !['whites', 'blacks', 'vibrance'].includes(c.key)).map(c => c.key));
  const filters = [
    { name: 'clarity', label: '通透', description: '明暗更分明，适合山景与阴天' },
    { name: 'warm-autumn', label: '暖秋', description: '保留暖色，适合秋林与日落' },
    { name: 'film', label: '胶片', description: '柔和低饱和，适合街景与远山' },
    { name: 'cool-tone', label: '冷调', description: '冷静蓝调，适合雪景与海岸' },
    { name: 'bw', label: '黑白', description: '关注光影与形状，适合层次鲜明的景色' }
  ];
  const allowedFilters = new Set([...filters.map(f => f.name), 'vivid']);
  const clone = value => JSON.parse(JSON.stringify(value));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  function createState() {
    return { adjustments: Object.fromEntries(controls.map(c => [c.key, 0])), legacyTone: { highlights: false, shadows: false },
      detail: Detail.defaults(), effects: Effects.defaults(), masks: [], whiteBalance: { gains: [1,1,1], mode: 'original' }, hsl: Tools.createHSL(), curves: Tools.createCurves(), geometry: [], filter: null, filterStrength: 100 };
  }
  function createHistory(initial = createState(), maxUndo = 20) {
    let entries = [clone(initial)];
    let index = 0;
    return {
      get canUndo() { return index > 0; },
      get canRedo() { return index < entries.length - 1; },
      get length() { return entries.length; },
      current() { return clone(entries[index]); },
      commit(state) {
        if (JSON.stringify(state) === JSON.stringify(entries[index])) return false;
        entries = entries.slice(0, index + 1);
        entries.push(clone(state));
        if (entries.length > maxUndo + 1) entries.shift();
        index = entries.length - 1;
        return true;
      },
      undo() { if (index > 0) index--; return this.current(); },
      redo() { if (index < entries.length - 1) index++; return this.current(); }
    };
  }
  function recipeState(base, rawRecipe) {
    const state = clone(base);
    const warnings = [];
    let recipe = rawRecipe;
    if (typeof recipe === 'string') {
      try { recipe = JSON.parse(recipe); } catch { throw new Error('配方格式无法读取，请尝试其他方案。'); }
    }
    const version = Array.isArray(recipe) ? 1 : recipe?.version ?? 1;
    if (![1, 2, 3, 4, 5, 6, 7, 8].includes(version)) throw new Error('暂不支持此配方版本，请使用版本 1 到 8 的配方。');
    let steps = Array.isArray(recipe) ? recipe : recipe?.steps;
    if (typeof steps === 'string') {
      try { steps = JSON.parse(steps); } catch { throw new Error('配方格式无法读取，请尝试其他方案。'); }
    }
    if (!Array.isArray(steps)) throw new Error('配方缺少可执行的操作。');
    const legacyTone = version >= 2 ? recipe?.rendering?.legacyTone : null;
    if (legacyTone && (typeof legacyTone !== 'object' || ['highlights','shadows'].some(key => typeof legacyTone[key] !== 'boolean'))) {
      throw new Error('配方的旧版效果兼容设置无效。');
    }
    let migrated = false;
    for (const step of steps) {
      const p = step?.params || {};
      const control = Object.hasOwn(controlByKey, step?.type) ? controlByKey[step.type] : null;
      if (control && (version >= 2 || legacyKeys.has(step.type)) && Number.isFinite(p.value)) {
        if(version<5&&['temperature','tint'].includes(step.type)&&state.whiteBalance.model==='relative'){
          state.adjustments.temperature=0;state.adjustments.tint=0;delete state.whiteBalance.model;state.whiteBalance.mode='custom';
        }
        let value = clamp(p.value, version === 1 ? -100 : control.min, version === 1 ? 100 : control.max);
        if (version === 1 && step.type === 'exposure') { value /= 50; migrated = true; }
        if (version === 1 && step.type === 'highlights') { value = -value; migrated = true; }
        state.adjustments[step.type] = value;
        if (['highlights','shadows'].includes(step.type)) {
          state.legacyTone[step.type] = version === 1 || legacyTone?.[step.type] === true;
          if (version === 1) migrated = true;
        }
      } else if (version >= 3 && step?.type === 'white-balance' && Array.isArray(p.gains) && p.gains.length === 3 && p.gains.every(v=>Number.isFinite(v)&&v>=(version>=5&&p.model==='relative'?1/64:.25)&&v<=(version>=5&&p.model==='relative'?64:4)) && ['original','auto','sample','custom'].includes(p.mode) && (p.model===undefined||(version>=5&&p.model==='relative'))) {
        if(p.model!=='relative'&&state.whiteBalance.model==='relative')for(const key of['temperature','tint'])if(!steps.some(s=>s?.type===key&&Number.isFinite(s.params?.value)))state.adjustments[key]=0;
        state.whiteBalance = { gains: p.gains.slice(), mode: p.mode };
        if(p.model==='relative')state.whiteBalance.model='relative';
      } else if (version >= 3 && step?.type === 'hsl' && Tools.bands.some(b=>b.key===p.band) && ['hue','saturation','luminance'].every(k=>Number.isFinite(p[k]))) {
        state.hsl[p.band] = Object.fromEntries(['hue','saturation','luminance'].map(k=>[k,clamp(p[k],-100,100)]));
      } else if (version >= 3 && step?.type === 'curve' && Tools.channels.includes(p.channel) && Tools.validCurve(p.points)) {
        state.curves[p.channel] = clone(p.points);
      } else if (version >= 6 && step?.type === 'effects' && Effects.valid(p) && !(version<7&&p.vignette.profile==='corner'&&p.vignette.amount)) {
        state.effects = clone(p);
      } else if (version >= 6 && step?.type === 'masks' && Array.isArray(p.layers) && p.layers.length<=Masks.limits.layers && p.layers.every(Masks.valid) && new Set(p.layers.map(m=>m.id)).size===p.layers.length) {
        state.masks = clone(p.layers);
      } else if (version >= 4 && step?.type === 'detail' && Detail.controls.every(c=>Number.isFinite(p[c.key])&&p[c.key]>=c.min&&p[c.key]<=c.max)) {
        state.detail = Object.fromEntries(Detail.controls.map(c=>[c.key,p[c.key]]));
      } else if(step?.type==='upright'){
        if(version<8||Object.keys(p).length!==2||!Upright.valid(p.matrix)||typeof p.autoCrop!=='boolean')throw Error('透视参考线配方无效或版本过旧。');
        state.geometry.push({type:'upright',params:{matrix:clone(p.matrix),autoCrop:p.autoCrop}});
      } else if (version >= 7 && step?.type === 'perspective' && [p.vertical,p.horizontal].every(v=>Number.isFinite(v)&&Math.abs(v)<=60) && typeof p.autoCrop==='boolean') {
        state.geometry.push({type:'perspective',params:{vertical:p.vertical,horizontal:p.horizontal,autoCrop:p.autoCrop}});
      } else if (version >= 4 && step?.type === 'straighten' && Number.isFinite(p.angle) && Math.abs(p.angle)<=45 && typeof p.autoCrop==='boolean') {
        state.geometry.push({type:'straighten',params:{angle:p.angle,autoCrop:p.autoCrop}});
      } else if (step?.type === 'filter' && (p.name === null || allowedFilters.has(p.name))) {
        state.filter = p.name;
        state.filterStrength = Number.isFinite(p.strength) ? clamp(p.strength, 0, 100) : 100;
      } else if (step?.type === 'rotate' && Number.isFinite(p.angle)) {
        state.geometry.push({ type: 'rotate', params: { angle: clamp(p.angle, -360, 360) } });
      } else if (step?.type === 'flip' && ['h', 'v'].includes(p.direction)) {
        state.geometry.push({ type: 'flip', params: { direction: p.direction } });
      } else if (step?.type === 'crop' && p.unit === 'normalized' && [p.x, p.y, p.width, p.height].every(Number.isFinite)
        && p.x >= 0 && p.y >= 0 && p.width > 0 && p.height > 0 && p.x + p.width <= 1.000001 && p.y + p.height <= 1.000001) {
        state.geometry.push(clone(step));
      } else {
        warnings.push(`已忽略不支持的操作：${step?.type || '未知'}`);
      }
    }
    syncWhiteBalance(state);
    if (migrated) warnings.unshift('已兼容旧配方：保留旧版明暗效果，并按原语义读取曝光和高光。');
    return { state, warnings };
  }
  function toRecipe(state) {
    return {
      version: state.geometry.some(g=>g.type==='upright')?8:state.geometry.some(g=>g.type==='perspective')||state.effects.vignette.profile==='corner'&&state.effects.vignette.amount!==0?7:6,
      rendering: { legacyTone: clone(state.legacyTone) },
      steps: [
        ...clone(state.geometry),
        ...controls.map(c => ({ type: c.key, params: { value: state.adjustments[c.key] } })),
        { type: 'detail', params: clone(state.detail) },
        { type: 'effects', params: clone(state.effects) },
        { type: 'masks', params: {layers:clone(state.masks)} },
        { type: 'white-balance', params: state.whiteBalance.model==='relative'?{...clone(state.whiteBalance),gains:Tools.whiteBalanceGains(state.adjustments.temperature,state.adjustments.tint)}:clone(state.whiteBalance) },
        ...Tools.bands.map(b=>({type:'hsl',params:{band:b.key,...state.hsl[b.key]}})),
        ...Tools.channels.map(channel=>({type:'curve',params:{channel,points:clone(state.curves[channel])}})),
        { type: 'filter', params: { name: state.filter, strength: state.filterStrength } }
      ]
    };
  }
  function syncWhiteBalance(state) {
    if(state.whiteBalance.model==='relative')state.whiteBalance.gains=Tools.whiteBalanceGains(state.adjustments.temperature,state.adjustments.tint);
  }
  function setWhiteBalance(state,gains,mode) {
    const values=Tools.whiteBalanceValues(gains);
    state.adjustments.temperature=clamp(values.temperature,-100,100);state.adjustments.tint=clamp(values.tint,-100,100);
    state.whiteBalance={gains:Tools.whiteBalanceGains(state.adjustments.temperature,state.adjustments.tint),mode,model:'relative'};
  }
  function rotationSize(width, height, angle) {
    const rad = angle * Math.PI / 180;
    return {
      width: Math.max(1, Math.ceil(width * Math.abs(Math.cos(rad)) + height * Math.abs(Math.sin(rad)) - 1e-8)),
      height: Math.max(1, Math.ceil(width * Math.abs(Math.sin(rad)) + height * Math.abs(Math.cos(rad)) - 1e-8))
    };
  }
  function straightenSize(width,height,{angle,autoCrop}) {
    if(!autoCrop)return rotationSize(width,height,angle);
    const radians=Math.abs(angle)*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
    const factor=Math.min(width/(width*c+height*s),height/(width*s+height*c));
    return {width:Math.max(1,Math.floor(width*factor+1e-8)),height:Math.max(1,Math.floor(height*factor+1e-8))};
  }
  function spatialPadding(state,scale=1){return Detail.padding(state.detail,scale)+Effects.padding(state.effects,scale)+(state.masks||[]).filter(Masks.active).reduce((n,m)=>n+Effects.padding({...Effects.defaults(),...m.adjustments},scale),0);}
  function processPixels(data,width,height,state,scale=1,context={},tileSize=512) {
    // Snapshot reactive parameters before spatial loops and mask rasterization as well.
    state=clone(state);
    adjustPixels(data,state);
    const layers=(state.masks||[]).filter(Masks.active);
    if(!Effects.active(state.effects)&&!layers.length)return Detail.applyTiled(data,width,height,state.detail,scale);
    const frame={fullWidth:width,fullHeight:height,offsetX:0,offsetY:0,sourceWidth:width/scale,sourceHeight:height/scale,transform:[scale,0,0,scale,0,0],...context};
    frame.airlight ||= Effects.airlight(data);
    const localStates=layers.map(m=>{const s=createState();for(const c of controls)if(Object.hasOwn(m.adjustments,c.key))s.adjustments[c.key]=m.adjustments[c.key];s.effects.clarity=m.adjustments.clarity;s.effects.dehaze=m.adjustments.dehaze;return s;});
    function spatial(pixels,w,h,f){
      Effects.apply(pixels,w,h,state.effects,scale,f);Detail.apply(pixels,w,h,state.detail,scale);
      layers.forEach((m,index)=>{const weights=Masks.raster(m,w,h,f);if(!weights.some(v=>v>0))return;const adjusted=pixels.slice(),s=localStates[index];adjustPixels(adjusted,s);Effects.apply(adjusted,w,h,s.effects,scale,f);for(let i=0;i<weights.length;i++)for(let c=0;c<3;c++)pixels[i*4+c]+=weights[i]*(adjusted[i*4+c]-pixels[i*4+c]);});
    }
    if(width<=tileSize&&height<=tileSize){spatial(data,width,height,frame);return data;}
    const source=data.slice(),pad=spatialPadding(state,scale);
    for(let y=0;y<height;y+=tileSize)for(let x=0;x<width;x+=tileSize){
      const tw=Math.min(tileSize,width-x),th=Math.min(tileSize,height-y),sx=Math.max(0,x-pad),sy=Math.max(0,y-pad),right=Math.min(width,x+tw+pad),bottom=Math.min(height,y+th+pad),w=right-sx,h=bottom-sy,part=new Uint8ClampedArray(w*h*4);
      for(let j=0;j<h;j++)part.set(source.subarray(((sy+j)*width+sx)*4,((sy+j)*width+right)*4),j*w*4);
      spatial(part,w,h,{...frame,offsetX:frame.offsetX+sx,offsetY:frame.offsetY+sy});
      for(let j=0;j<th;j++)data.set(part.subarray(((y-sy+j)*w+x-sx)*4,((y-sy+j)*w+x-sx+tw)*4),((y+j)*width+x)*4);
    }
    return data;
  }
  function perspectiveMatrix(w,h,{vertical,horizontal,autoCrop}){
    // Projective denominator changes converging lines; keep it positive over
    // the full image. Fit the quadrilateral, then crop an inscribed rectangle.
    const u=horizontal*.005,v=vertical*.005;
    if(!u&&!v)return[1,0,0,0,1,0,0,0,1];
    let m=[1+u,w*v/h,-w*(u+v)/2,h*u/w,1+v,-h*(u+v)/2,2*u/w,2*v/h,1-u-v];
    let corners=[[0,0],[w,0],[w,h],[0,h]].map(p=>Masks.transform(m,...p));
    const xs=corners.map(p=>p[0]),ys=corners.map(p=>p[1]),left=Math.min(...xs),top=Math.min(...ys),right=Math.max(...xs),bottom=Math.max(...ys),scale=Math.min(w/(right-left),h/(bottom-top));
    m=Masks.multiply([scale,0,0,scale,(w-scale*(right+left))/2,(h-scale*(top+bottom))/2],m);
    if(autoCrop){
      corners=[[0,0],[w,0],[w,h],[0,h]].map(p=>Masks.transform(m,...p));
      const inside=(x,y)=>corners.every((a,i)=>{const b=corners[(i+1)%4];return(b[0]-a[0])*(y-a[1])-(b[1]-a[1])*(x-a[0])>=-1e-7;});
      let low=0,high=1;
      for(let i=0;i<32;i++){const k=(low+high)/2;if([[1,1],[-1,1],[-1,-1],[1,-1]].every(([x,y])=>inside(w/2+x*w*k/2,h/2+y*h*k/2)))low=k;else high=k;}
      const k=Math.max(.01,low*.99999);m=Masks.multiply([1/k,0,0,1/k,w/2*(1-1/k),h/2*(1-1/k)],m);
    }
    return m;
  }
  function warpPerspective(canvas,p){
    if(!p.matrix&&!p.vertical&&!p.horizontal)return canvas;
    const w=canvas.width,h=canvas.height,next=makeCanvas(w,h),ctx=next.getContext('2d'),source=canvas.getContext('2d').getImageData(0,0,w,h).data,pixels=ctx.createImageData(w,h),out=pixels.data,inv=Masks.inverse(p.matrix?Upright.pixelMatrix(w,h,p):perspectiveMatrix(w,h,p));
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const denominator=inv[6]*(x+.5)+inv[7]*(y+.5)+inv[8],sx=(inv[0]*(x+.5)+inv[1]*(y+.5)+inv[2])/denominator-.5,sy=(inv[3]*(x+.5)+inv[4]*(y+.5)+inv[5])/denominator-.5;if(sx<-.5||sy<-.5||sx>w-.5||sy>h-.5)continue;
      const px=clamp(sx,0,w-1),py=clamp(sy,0,h-1),ix=Math.floor(px),iy=Math.floor(py),fx=px-ix,fy=py-iy,j=(y*w+x)*4;
      const a=(iy*w+ix)*4,b=(iy*w+Math.min(ix+1,w-1))*4,c=(Math.min(iy+1,h-1)*w+ix)*4,d=(Math.min(iy+1,h-1)*w+Math.min(ix+1,w-1))*4;
      const wa=(1-fx)*(1-fy)*source[a+3],wb=fx*(1-fy)*source[b+3],wc=(1-fx)*fy*source[c+3],wd=fx*fy*source[d+3],alpha=wa+wb+wc+wd;out[j+3]=alpha;
      if(alpha)for(let channel=0;channel<3;channel++)out[j+channel]=(source[a+channel]*wa+source[b+channel]*wb+source[c+channel]*wc+source[d+channel]*wd)/alpha;
    }
    ctx.putImageData(pixels,0,0);return next;
  }
  function geometryFrame(sourceWidth,sourceHeight,geometry,width=sourceWidth,height=sourceHeight){
    let matrix=[width/sourceWidth,0,0,height/sourceHeight,0,0];
    for(const step of geometry){const p=step.params,oldW=width,oldH=height;({width,height}=outputSize(width,height,[step]));let op;
      if(step.type==='rotate'||step.type==='straighten'){const r=p.angle*Math.PI/180,c=Math.cos(r),s=Math.sin(r);op=[c,s,-s,c,width/2-c*oldW/2+s*oldH/2,height/2-s*oldW/2-c*oldH/2];}
      else if(step.type==='perspective')op=perspectiveMatrix(oldW,oldH,p);
      else if(step.type==='upright')op=Upright.pixelMatrix(oldW,oldH,p);
      else if(step.type==='flip')op=p.direction==='h'?[-1,0,0,1,width,0]:[1,0,0,-1,0,height];
      else if(step.type==='crop'){const sx=width/(oldW*p.width),sy=height/(oldH*p.height);op=[sx,0,0,sy,-oldW*p.x*sx,-oldH*p.y*sy];}
      if(op)matrix=Masks.multiply(op,matrix);
    }
    return{fullWidth:width,fullHeight:height,sourceWidth,sourceHeight,transform:matrix,offsetX:0,offsetY:0};
  }
  function prepareContext(raw,state){
    const frame={...(raw.editorFrame||{fullWidth:raw.width,fullHeight:raw.height})};
    if(state.effects.dehaze||(state.masks||[]).some(m=>Masks.active(m)&&m.adjustments.dehaze)){
      const factor=Math.min(1,224/Math.max(raw.width,raw.height)),sample=makeCanvas(Math.max(1,Math.round(raw.width*factor)),Math.max(1,Math.round(raw.height*factor)));sample.getContext('2d').drawImage(raw,0,0,sample.width,sample.height);const data=sample.getContext('2d').getImageData(0,0,sample.width,sample.height).data;adjustPixels(data,state);frame.airlight=Effects.airlight(data);
    }
    return frame;
  }
  function outputSize(width, height, geometry) {
    for (const step of geometry) {
      if (step.type === 'rotate') ({ width, height } = rotationSize(width, height, step.params.angle));
      if (step.type === 'straighten') ({ width, height } = straightenSize(width, height, step.params));
      if (step.type === 'crop') {
        width = Math.max(1, Math.round(width * step.params.width));
        height = Math.max(1, Math.round(height * step.params.height));
      }
    }
    return { width, height };
  }
  function adjustPixels(data, state) {
    // Read reactive UI parameters once; millions of proxy property reads otherwise dominate processing.
    const a = { ...state.adjustments }, legacyTone = { ...state.legacyTone };
    const filter = state.filter, strength = state.filterStrength / 100;
    const gains = state.whiteBalance.model==='relative'?Tools.whiteBalanceGains(a.temperature,a.tint):state.whiteBalance.gains.slice(), hsl = Tools.compileHSL(clone(state.hsl)), curves = Tools.compileCurves(clone(state.curves));
    if(state.whiteBalance.model==='relative'){a.temperature=0;a.tint=0;}
    const calibration=Effects.calibrationMatrix(clone(state.effects.calibration));
    const hslScratch = new Float64Array(3), hasCurves = Object.values(curves).some(Boolean);
    if (controls.every(c => a[c.key] === 0) && gains.every(v=>v===1) && !hsl && !hasCurves && !calibration && (!filter || strength === 0)) return data;
    const exposure = Math.pow(2, a.exposure);
    const modernToneScale = 0.8 * Math.min(1, exposure);
    const contrast = (259 * (a.contrast + 255)) / (255 * (259 - a.contrast));
    const endpoint = value => {
      value = clamp(value, 0, 255);
      const x = value / 255, y = 1 - x, xx = x * x, yy = y * y;
      const x4 = xx * xx, y4 = yy * yy;
      return value + a.whites * 0.3 * x4 * x4 + a.blacks * 0.3 * y4 * y4;
    };
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      let r = data[i], g = data[i + 1], b = data[i + 2];
      if (gains[0]!==1 || gains[1]!==1 || gains[2]!==1) { r*=gains[0];g*=gains[1];b*=gains[2]; }
      if(calibration){const nr=calibration[0]*r+calibration[1]*g+calibration[2]*b,ng=calibration[3]*r+calibration[4]*g+calibration[5]*b;b=calibration[6]*r+calibration[7]*g+calibration[8]*b;r=nr;g=ng;}
      const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      // The new tonal response remains monotonic at its limits. Imported v1 controls retain their frozen response.
      const shadow = 1 - luma;
      const tone = (legacyTone.shadows ? a.shadows * 1.3 * Math.pow(shadow, 3) : a.shadows * modernToneScale * shadow * shadow * shadow)
        + (legacyTone.highlights ? a.highlights * 1.3 * Math.pow(luma, 3) : a.highlights * modernToneScale * luma * luma * luma);
      r = contrast * (r * exposure + a.brightness * 2.55 + tone - 128) + 128;
      g = contrast * (g * exposure + a.brightness * 2.55 + tone - 128) + 128;
      b = contrast * (b * exposure + a.brightness * 2.55 + tone - 128) + 128;
      if (a.whites || a.blacks) {
        // 30/255 * 8 < 1: endpoint compression cannot reverse a grayscale gradient.
        r = endpoint(r); g = endpoint(g); b = endpoint(b);
      }
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const saturation = 1 + a.saturation / 100;
      r = gray + (r - gray) * saturation + a.temperature * 1.1 + a.tint * 0.45;
      g = gray + (g - gray) * saturation - a.tint * 0.7;
      b = gray + (b - gray) * saturation - a.temperature * 1.1 + a.tint * 0.45;
      if (a.vibrance !== 0) {
        r = clamp(r, 0, 255); g = clamp(g, 0, 255); b = clamp(b, 0, 255);
        const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
        const muted = 1 - (maximum - minimum) / (maximum || 1);
        const center = 0.299 * r + 0.587 * g + 0.114 * b;
        let factor = 1 + a.vibrance / 100 * muted * muted;
        // Limit chroma expansion to available RGB headroom instead of clipping individual channels.
        if (maximum > center) factor = Math.min(factor, (255 - center) / (maximum - center));
        if (minimum < center) factor = Math.min(factor, center / (center - minimum));
        r = center + (r - center) * factor;
        g = center + (g - center) * factor;
        b = center + (b - center) * factor;
      }
      if (hsl) { Tools.hslPixel(r,g,b,hsl,hslScratch);r=hslScratch[0];g=hslScratch[1];b=hslScratch[2]; }
      if (curves.master) { r=Tools.lookup(curves.master,r);g=Tools.lookup(curves.master,g);b=Tools.lookup(curves.master,b); }
      if (curves.red) r=Tools.lookup(curves.red,r);
      if (curves.green) g=Tools.lookup(curves.green,g);
      if (curves.blue) b=Tools.lookup(curves.blue,b);
      let fr = r, fg = g, fb = b;
      switch (filter) {
        case 'bw': fr = fg = fb = 0.299 * r + 0.587 * g + 0.114 * b; break;
        case 'warm-autumn': fr = r * 1.08 + 4; fg = g * 0.98; fb = b * 0.88; break;
        case 'cool-tone': fr = r * 0.9; fg = g * 0.98; fb = b * 1.08 + 3; break;
        case 'film': fr = r * 0.88 + 15; fg = g * 0.86 + 14; fb = b * 0.82 + 16; break;
        case 'clarity': fr = (r - 128) * 1.08 + 132; fg = (g - 128) * 1.08 + 132; fb = (b - 128) * 1.08 + 132; break;
        case 'vivid': {
          const avg = (r + g + b) / 3;
          fr = avg + (r - avg) * 1.3; fg = avg + (g - avg) * 1.3; fb = avg + (b - avg) * 1.3;
          break;
        }
      }
      data[i] = clamp(r + (fr - r) * strength, 0, 255);
      data[i + 1] = clamp(g + (fg - g) * strength, 0, 255);
      data[i + 2] = clamp(b + (fb - b) * strength, 0, 255);
    }
    return data;
  }
  function makeCanvas(width, height) {
    const canvas = typeof document === 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    if (canvas.width !== width || canvas.height !== height) throw new Error('图片尺寸超过浏览器可处理范围。');
    return canvas;
  }
  function render(image, state, { maxSide = 1200, scale = 1, color = true, sourceScale = 1, sourceSize = null } = {}) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const ratio = maxSide ? Math.min(1, maxSide / Math.max(width, height)) : scale;
    let canvas = makeCanvas(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
    const geometryContext=geometryFrame(sourceSize?.width||width/sourceScale,sourceSize?.height||height/sourceScale,state.geometry,canvas.width,canvas.height);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const step of state.geometry) {
      const p = step.params;
      let next;
      if (step.type === 'rotate' || step.type === 'straighten') {
        const size = step.type === 'straighten' ? straightenSize(canvas.width,canvas.height,p) : rotationSize(canvas.width, canvas.height, p.angle);
        next = makeCanvas(size.width, size.height);
        const ctx = next.getContext('2d');
        ctx.translate(next.width / 2, next.height / 2);
        ctx.rotate(p.angle * Math.PI / 180);
        ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      } else if (step.type === 'perspective'||step.type==='upright') {
        next = warpPerspective(canvas,p);
      } else if (step.type === 'flip') {
        next = makeCanvas(canvas.width, canvas.height);
        const ctx = next.getContext('2d');
        ctx.translate(p.direction === 'h' ? canvas.width : 0, p.direction === 'v' ? canvas.height : 0);
        ctx.scale(p.direction === 'h' ? -1 : 1, p.direction === 'v' ? -1 : 1);
        ctx.drawImage(canvas, 0, 0);
      } else if (step.type === 'crop') {
        next = makeCanvas(Math.max(1, Math.round(canvas.width * p.width)), Math.max(1, Math.round(canvas.height * p.height)));
        next.getContext('2d').drawImage(canvas, canvas.width * p.x, canvas.height * p.y, canvas.width * p.width, canvas.height * p.height, 0, 0, next.width, next.height);
      }
      if (next) canvas = next;
    }
    canvas.editorFrame=geometryContext;
    if (color) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      processPixels(pixels.data, canvas.width, canvas.height, state, ratio*sourceScale,prepareContext(canvas,state));
      ctx.putImageData(pixels, 0, 0);
    }
    return canvas;
  }
  function renderRegion(raw,state,{x=.5,y=.5,side=256}={}) {
    const width=Math.min(side,raw.width),height=Math.min(side,raw.height);
    const left=clamp(Math.round(x*raw.width-width/2),0,raw.width-width),top=clamp(Math.round(y*raw.height-height/2),0,raw.height-height);
    const pad=spatialPadding(state),sx=Math.max(0,left-pad),sy=Math.max(0,top-pad),right=Math.min(raw.width,left+width+pad),bottom=Math.min(raw.height,top+height+pad);
    const region=raw.getContext('2d').getImageData(sx,sy,right-sx,bottom-sy);
    processPixels(region.data,region.width,region.height,state,1,{...prepareContext(raw,state),offsetX:sx,offsetY:sy});
    const padded=makeCanvas(region.width,region.height);padded.getContext('2d').putImageData(region,0,0);
    const edited=makeCanvas(width,height),original=makeCanvas(width,height);
    edited.getContext('2d').drawImage(padded,left-sx,top-sy,width,height,0,0,width,height);
    original.getContext('2d').drawImage(raw,left,top,width,height,0,0,width,height);
    return {edited,original,left,top,width,height};
  }
  return { upright:Upright,perspectiveMatrix,effects:Effects,masks:Masks,geometryFrame,prepareContext,spatialPadding,syncWhiteBalance, setWhiteBalance, detail: Detail, processPixels, renderRegion, straightenSize, controls, filters, clone, clamp, createState, createHistory, recipeState, toRecipe, outputSize, adjustPixels, render, tools: Tools };
});
