const { createApp, ref, shallowRef, reactive, computed, watch, nextTick, onMounted, onBeforeUnmount } = Vue;
const Core = EditorCore;

createApp({
  components: {
    AdjustmentControl: {
      props: ['control', 'modelValue', 'disabled'],
      emits: ['update:modelValue', 'start', 'commit', 'number-input', 'reset'],
      template: `<div class="adjustment" :class="[control.rail ? 'rail-' + control.rail : '', {'custom-rail': control.gradient}]" :style="control.gradient ? {'--rail': control.gradient} : undefined">
        <div class="adjustment-heading"><label :for="control.key" @dblclick="$emit('reset', control.key)" title="双击复位">{{ control.label }}</label>
          <div class="value-entry"><input :id="control.key + '-value'" type="number" :min="control.min" :max="control.max" step="any"
            :disabled="disabled" :value="control.precision || control.key === 'exposure' ? Number(modelValue).toFixed(control.precision || 2) : modelValue" :aria-label="control.label + '数值'"
            :aria-describedby="control.key + '-hint'" @change="$emit('number-input', control, $event)"
            @keydown.enter.prevent="$event.target.blur()" @keydown.esc.prevent="$event.target.value = modelValue; $event.target.blur()">
            <span v-if="control.unit">{{ control.unit }}</span></div></div>
        <div class="range-row"><input :id="control.key" type="range" :min="control.min" :max="control.max" :step="control.step"
          :disabled="disabled" :value="modelValue" @input="$emit('start'); $emit('update:modelValue', Number($event.target.value))" @change="$emit('commit')" @pointercancel="$emit('commit')"
          :aria-describedby="control.key + '-hint'" :title="control.hint">
          <button class="reset-control" @click="$emit('reset', control.key)" :aria-label="'复位' + (control.resetLabel || control.label)" :disabled="modelValue === (control.default || 0)">↺</button></div>
        <p class="control-hint" :id="control.key + '-hint'">{{ control.hint }}</p></div>`
    }
  },
  setup() {
    const mainCanvas = ref(null), compareCanvas = ref(null), canvasContainer = ref(null), communityContainer = ref(null);
    const currentView = ref('editor'), imageLoaded = ref(false), imageLoading = ref(false);
    const originalImageUrl = ref(''), filename = ref(''), message = ref(''), error = ref('');
    const state = ref(Core.createState()), historyVersion = ref(0);
    const sourceImage = shallowRef(null);
    let history = Core.createHistory(), importVersion = 0, frame = null, observer = null;
    let renderer = null, sourcePreview = null, paintRevision = 0, requestedAt = 0, dragging = false;
    const thumbnailCache = new WeakMap();
    const hoverFilter = ref(null), wbPicking = ref(false), histogram = shallowRef(null);
    const hslMode = ref('hue'), curveChannel = ref('master'), selectedCurvePoint = ref(0);
    const curveDraft = reactive({});
    let curveDrag = null;
    const preview = ref(null), aiOpen = ref(false), aiLoading = ref(false), aiResults = ref([]), aiStatus = ref('');
    const galleryLoading = ref(false), galleryResults = ref([]);
    const compareMode = ref('edited'), sliderPos = ref(50), zoom = ref(100);
    const viewport = reactive({ width: 600, height: 400 });
    const cropOpen = ref(false), cropRatio = ref('free'), crop = reactive({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 });
    const cropDraft = reactive({});
    const showGuides = ref(true), straightenOpen = ref(false), straightenAngle = ref(0), straightenAutoCrop = ref(true);
    const inspectorBusy = ref(false), inspectorOpen = ref(false), inspectorBefore = ref(false), inspectorPosition = reactive({x:.5,y:.5}), inspectorCanvas = ref(null), inspectorOriginal = ref(null);
    const detailControls = Core.detail.controls.map(c=>({unit:'',...c}));
    const effectControls=Core.effects.controls.map(c=>({...c,key:'effect-'+c.key,field:c.key,kind:'effect'}));
    const vignetteDirection=ref('dark');
    const vignetteMode=computed(()=>state.value.effects.vignette.amount>0?'bright':state.value.effects.vignette.amount<0?'dark':vignetteDirection.value);
    const vignetteControls=computed(()=>Core.effects.vignetteControls.map(c=>({...c,key:'vignette-'+c.key,field:c.key,kind:'vignette',...(c.key==='amount'?{min:0,label:vignetteMode.value==='dark'?'暗角强度':'亮角强度',hint:vignetteMode.value==='dark'?'向右加深黑色暗角；0 为无效果':'向右增强白色亮角；0 为无效果'}:{})})));
    function changeVignetteMode(event){const mode=event.target.value;if(!['dark','bright'].includes(mode))return;vignetteDirection.value=mode;state.value.effects.vignette.amount=Math.abs(state.value.effects.vignette.amount)*(mode==='dark'?-1:1);commit();}
    const calibrationControls=['red','green','blue'].flatMap((band,i)=>['hue','saturation'].map(field=>({key:`cal-${band}-${field}`,kind:'calibration',band,field,label:['红','绿','蓝'][i]+'原色'+(field==='hue'?'色相':'饱和度'),min:-100,max:100,step:1,default:0,unit:'',hint:field==='hue'?'改变原色方向，也会影响由它混合而成的颜色':'改变原色的色彩强度'})));
    const maskControls=Core.masks.controls.map(c=>({...c,key:'mask-'+c.key,field:c.key,kind:'mask'}));
    const maskId=ref(null),maskEditing=ref(false),showMask=ref(true),maskErase=ref(false),brushSize=ref(12),brushFeather=ref(70),maskCanvas=ref(null);
    let maskDrag=null;
    const selectedMask=computed(()=>state.value.masks.find(m=>m.id===maskId.value)||null);
    const maskFrame=computed(()=>sourceImage.value?Core.geometryFrame(sourceImage.value.naturalWidth,sourceImage.value.naturalHeight,state.value.geometry):null);
    function maskScreen(p){const f=maskFrame.value,q=Core.masks.transform(f.transform,p[0]*f.sourceWidth,p[1]*f.sourceHeight);return[q[0]/f.fullWidth,q[1]/f.fullHeight];}
    const maskHandles=computed(()=>{const m=selectedMask.value;if(!m||m.type==='brush'||!maskFrame.value)return[];return(m.type==='linear'?[['start',m.start,'渐变起点'],['end',m.end,'渐变终点']]:[['center',m.center,'径向中心'],['radius',[m.center[0]+m.radius[0],m.center[1]+m.radius[1]],'径向范围']]).map(([key,p,label])=>{const q=maskScreen(p);return{key,label,style:{left:q[0]*100+'%',top:q[1]*100+'%'}};});});
    const maskGuide=computed(()=>{const m=selectedMask.value;if(!m||m.type==='brush'||!maskFrame.value)return null;const f=maskFrame.value;return{viewBox:`0 0 ${f.fullWidth} ${f.fullHeight}`,matrix:`matrix(${f.transform.join(' ')})`,sw:f.sourceWidth,sh:f.sourceHeight};});
    let cropDrag = null;
    const rotationAngle = ref(0), exportOpen = ref(false), exporting = ref(false);
    const exportOptions = reactive({ format: 'jpg', quality: 92, scale: 1 });
    const communitySearch = ref(''), communityRecipes = ref([]), communityLoading = ref(false), communityError = ref('');
    const recipeDetail = ref(null), exportDialog = ref(null), recipeDialog = ref(null);
    watch(exportOpen, async open => { await nextTick(); if (open) exportDialog.value.showModal(); else exportDialog.value.close(); });
    watch(recipeDetail, async recipe => { await nextTick(); if (recipe) recipeDialog.value.showModal(); else recipeDialog.value.close(); });
    let communityScroll = 0, searchTimer = null, communityVersion = 0, communityFetched = false;
    const previewSize = reactive({ width: 1, height: 1 });
    const canUndo = computed(() => { historyVersion.value; return history.canUndo; });
    const canRedo = computed(() => { historyVersion.value; return history.canRedo; });
    const hoveredState = computed(() => {
      if (!hoverFilter.value) return null;
      const next=Core.clone(state.value);next.filter=hoverFilter.value.name;next.filterStrength=100;return next;
    });
    const legacyBalanceValues = computed(()=>state.value.whiteBalance.model!=='relative'&&state.value.adjustments.temperature===0&&state.value.adjustments.tint===0&&state.value.whiteBalance.gains.some(v=>v!==1)?Core.tools.whiteBalanceValues(state.value.whiteBalance.gains):null);
    const colorControls = computed(()=>Core.controls.filter(c=>c.group==='color').map(c=>(state.value.whiteBalance.model==='relative'||legacyBalanceValues.value)&&['temperature','tint'].includes(c.key)?{...c,step:.1,precision:2}:c));
    function adjustmentValue(key) {return legacyBalanceValues.value&&['temperature','tint'].includes(key)?legacyBalanceValues.value[key]:state.value.adjustments[key];}
    const activeState = computed(() => {
      const base=preview.value?.state || hoveredState.value || state.value;
      if(!straightenOpen.value)return base;
      const next=Core.clone(base);next.geometry.push({type:'straighten',params:{angle:straightenAngle.value,autoCrop:straightenAutoCrop.value}});return next;
    });
    const outputDimensions = computed(() => sourceImage.value ? Core.outputSize(sourceImage.value.naturalWidth, sourceImage.value.naturalHeight, activeState.value.geometry) : { width: 0, height: 0 });
    const exportDimensions = computed(() => sourceImage.value ? Core.outputSize(Math.max(1, Math.round(sourceImage.value.naturalWidth * exportOptions.scale)), Math.max(1, Math.round(sourceImage.value.naturalHeight * exportOptions.scale)), state.value.geometry) : { width: 0, height: 0 });
    const stageStyle = computed(() => {
      const fit = Math.min((viewport.width - 32) / previewSize.width, (viewport.height - 32) / previewSize.height, 1);
      const scale = Math.max(0.02, fit) * zoom.value / 100;
      return { width: `${Math.round(previewSize.width * scale)}px`, height: `${Math.round(previewSize.height * scale)}px` };
    });
    const cropStyle = computed(() => ({ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.width * 100}%`, height: `${crop.height * 100}%` }));
    const cropPixels = computed(() => ({ x: Math.round(crop.x*outputDimensions.value.width), y: Math.round(crop.y*outputDimensions.value.height), width: Math.round(crop.width*outputDimensions.value.width), height: Math.round(crop.height*outputDimensions.value.height) }));
    const cropHandles = ['nw','n','ne','e','se','s','sw','w'].map((key,i)=>({key,label:['左上角','上边界','右上角','右边界','右下角','下边界','左下角','左边界'][i]}));
    const hslControls = computed(() => Core.tools.bands.map(b=>({
      key:'hsl-'+b.key,band:b.key,label:b.label,resetLabel:b.label+{hue:'色相',saturation:'饱和度',luminance:'亮度'}[hslMode.value],min:-100,max:100,step:1,unit:'',rail:'hsl-'+b.key,
      gradient:hslMode.value==='hue'?`linear-gradient(90deg,hsl(${b.hue-30} 55% 55%),hsl(${b.hue} 55% 55%),hsl(${b.hue+30} 55% 55%))`:hslMode.value==='saturation'?`linear-gradient(90deg,#78828c,hsl(${b.hue} 70% 55%))`:`linear-gradient(90deg,#29313e,hsl(${b.hue} 55% 55%),#e7edf3)`,
      hint:{hue:'调整此颜色的偏向',saturation:'调整此颜色的浓淡',luminance:'调整此颜色的明暗'}[hslMode.value]
    })));
    const curvePoints = computed(() => state.value.curves[curveChannel.value]);
    const selectedPoint = computed(() => curvePoints.value[Math.min(selectedCurvePoint.value,curvePoints.value.length-1)]);
    watch(selectedPoint,()=>Object.keys(curveDraft).forEach(key=>delete curveDraft[key]));
    watch(curvePoints,points=>{selectedCurvePoint.value=Math.min(selectedCurvePoint.value,points.length-1);});
    const curvePath = computed(() => Array.from(Core.tools.curveLUT(curvePoints.value),(v,i)=>`${i?'L':'M'}${i} ${(255-v).toFixed(2)}`).join(' '));
    function histogramPath(channel,height=70) {
      const values=histogram.value?.[channel]||new Array(256).fill(0),max=Math.max(1,...values);
      return `M0 ${height} `+values.map((v,i)=>`L${i} ${(height-Math.sqrt(v/max)*(height-3)).toFixed(1)}`).join(' ')+` L255 ${height} Z`;
    }
    const dirty = computed(() => JSON.stringify(state.value) !== JSON.stringify(Core.createState()));
    const locked = computed(() => !imageLoaded.value || imageLoading.value || exporting.value || !!preview.value || cropOpen.value || straightenOpen.value);
    function notify(text) { error.value = ''; message.value = text; }
    function fail(text) { message.value = ''; error.value = text; }
    function draw(target, result) {
      if (!target) return;
      target.width = result.width; target.height = result.height;
      target.getContext('2d').drawImage(result, 0, 0);
    }
    function presentPreview(edited, original, geometry, { revision, maxSide, mode, renderMs = 0, histogram: distribution, detail, maskOverlay }) {
      draw(mainCanvas.value, edited); draw(compareCanvas.value, original);
      if(maskOverlay)draw(maskCanvas.value,maskOverlay);
      const size = Core.outputSize(sourcePreview.width, sourcePreview.height, geometry);
      // The display geometry stays fixed while interactive raster resolution changes.
      previewSize.width = size.width; previewSize.height = size.height;
      const canvas = mainCanvas.value;
      canvas.dataset.previewMode = mode; canvas.dataset.previewQuality = maxSide;
      canvas.dataset.previewStatus = revision === paintRevision && !dragging ? 'ready' : 'pending';
      canvas.dataset.previewRevision = revision; canvas.dataset.previewRenderMs = renderMs.toFixed(1);
      if (revision === paintRevision) canvas.dataset.previewLatencyMs = (performance.now() - requestedAt).toFixed(1);
      if(distribution)histogram.value=distribution;
      if(detail && inspectorOpen.value){inspectorBusy.value=revision!==paintRevision||dragging;draw(inspectorCanvas.value,detail.edited);draw(inspectorOriginal.value,detail.original);if(inspectorCanvas.value)inspectorCanvas.value.dataset.previewStatus=revision===paintRevision?'ready':'pending';}
    }
    function initRenderer() {
      renderer?.dispose(); renderer = null;
      if (!EditorPreview.supported()) return;
      try {
        const owner = new EditorPreview(sourceImage.value, {
          onFrame(result) {
            if (renderer !== owner || !mainCanvas.value) return;
            const current = result.revision === paintRevision;
            const interactive = dragging && result.maxSide === 640 && JSON.stringify(result.geometry) === JSON.stringify(activeState.value.geometry);
            if (!current && !interactive) return;
            presentPreview(result.edited, result.original, result.geometry, { ...result, mode: 'worker' });
          },
          onError() {
            if (renderer !== owner) return;
            renderer = null;
            notify('已切换兼容预览方式，可以继续编辑。'); schedulePaint();
          }
        });
        renderer = owner;
      } catch { renderer = null; }
    }
    function paint() {
      frame = null;
      if (!sourcePreview || !mainCanvas.value) return;
      try {
        const maxSide = dragging ? 640 : 1200;
        if (renderer) {
          renderer.request(Core.clone(activeState.value), { maxSide, revision: paintRevision, requestedAt, inspector:inspectorOpen.value?{...inspectorPosition,side:256}:null,maskOverlay:showMask.value&&maskEditing.value?maskId.value:null });
        } else {
          const start = performance.now();
          const result = Core.render(sourcePreview, activeState.value, { maxSide, sourceScale:sourcePreview.width/sourceImage.value.naturalWidth,sourceSize:{width:sourceImage.value.naturalWidth,height:sourceImage.value.naturalHeight} });
          const original = Core.render(sourcePreview, activeState.value, { maxSide, color: false });
          const detail=inspectorOpen.value?Core.renderRegion(Core.render(sourceImage.value,activeState.value,{maxSide:0,color:false}),activeState.value,inspectorPosition):null;
          if(maskEditing.value&&showMask.value&&selectedMask.value){const overlay=Core.masks.overlay(selectedMask.value,result.width,result.height,result.editorFrame);maskCanvas.value.width=result.width;maskCanvas.value.height=result.height;maskCanvas.value.getContext('2d').putImageData(new ImageData(overlay,result.width,result.height),0,0);}
          presentPreview(result, original, activeState.value.geometry, { detail, revision: paintRevision, maxSide, mode: 'compatible', renderMs: performance.now() - start, histogram:Core.tools.histogram(result.getContext('2d').getImageData(0,0,result.width,result.height).data) });
        }
      } catch (e) { fail(`预览失败：${e.message}。可撤销或重置后重试。`); }
    }
    function schedulePaint() {
      paintRevision++; requestedAt = performance.now();
      if (mainCanvas.value) mainCanvas.value.dataset.previewStatus = 'pending';
      if(inspectorOpen.value)inspectorBusy.value=true;
      if(inspectorCanvas.value)inspectorCanvas.value.dataset.previewStatus='pending';
      if (frame === null) frame = requestAnimationFrame(paint);
    }
    function beginAdjustment() { hoverFilter.value=null; wbPicking.value=false; dragging = true; }
    watch(activeState, schedulePaint, { deep: true });
    watch([inspectorOpen,inspectorPosition],schedulePaint,{deep:true,flush:'post'});
    watch([maskId,maskEditing,showMask],schedulePaint,{flush:'post'});
    watch(selectedMask,m=>{if(!m){maskEditing.value=false;maskDrag=null;}});
    function invalidateProposals() {
      if (aiResults.value.length) aiStatus.value = '当前编辑已改变，请重新获取建议。';
      aiResults.value = []; galleryResults.value = [];
    }
    function commit() {
      dragging = false;
      hoverFilter.value=null;wbPicking.value=false;
      if (history.commit(state.value)) invalidateProposals();
      historyVersion.value++; schedulePaint();
    }
    function restore(action) {
      maskPointerUp();maskEditing.value=false;
      dragging = false;
      hoverFilter.value=null;wbPicking.value=false;
      preview.value = null; cropOpen.value = false;
      straightenOpen.value=false;
      curveDrag=null;
      const restored = history[action]();
      if (JSON.stringify(restored) !== JSON.stringify(state.value)) invalidateProposals();
      state.value = restored; historyVersion.value++; schedulePaint();
    }
    function setAdjustment(key, value) {
      error.value = '';
      hoverFilter.value=null;wbPicking.value=false;
      if(['temperature','tint'].includes(key)&&legacyBalanceValues.value)Core.setWhiteBalance(state.value,state.value.whiteBalance.gains,'custom');
      if(['temperature','tint'].includes(key)&&state.value.whiteBalance.mode!=='original')state.value.whiteBalance.mode='custom';
      if (state.value.legacyTone[key]) {
        state.value.legacyTone[key] = false;
        notify('此项已切换到新版平滑调整，可撤销以恢复旧配方效果。');
      }
      state.value.adjustments[key] = value;
      if(['temperature','tint'].includes(key))Core.syncWhiteBalance(state.value);
    }
    function resetAdjustment(key) { setAdjustment(key, 0); commit(); }
    function resetGroup(group) {
      if (locked.value) return;
      for (const control of Core.controls) {
        if (group === 'light' ? control.group !== 'color' : control.group === group) setAdjustment(control.key, 0);
      }
      if(group==='color'){state.value.whiteBalance={gains:[1,1,1],mode:'original'};state.value.hsl=Core.tools.createHSL();state.value.effects.calibration=Core.effects.defaults().calibration;}
      commit(); notify(`已复位${group === 'light' ? '光线' : '颜色'}，可撤销。`);
    }
    function inputAdjustment(control, event) {
      if (locked.value) return;
      const input = event.target, value = input.valueAsNumber;
      if (!Number.isFinite(value) || value < control.min || value > control.max || (control.key !== 'exposure' && !control.precision && !Number.isInteger(value))) {
        fail(`${control.label}请输入 ${control.min} 到 ${control.max}${control.unit ? ' ' + control.unit : ''} 之间的${control.key === 'exposure' || control.precision ? '数值' : '整数'}。`);
        input.value = control.key === 'exposure' || control.precision ? adjustmentValue(control.key).toFixed(control.precision || 2) : adjustmentValue(control.key);
        return;
      }
      const next = control.key === 'exposure' || control.precision ? Math.round(value * 100) / 100 : value;
      error.value = '';
      if (next === adjustmentValue(control.key)) return;
      setAdjustment(control.key, next);
      error.value = ''; commit();
    }
    function resetImage() {
      if (locked.value) return;
      vignetteDirection.value='dark';state.value = Core.createState(); commit(); notify('已恢复原图，可撤销这次重置。');
    }
    async function loadImage(file) {
      if (!file || imageLoading.value || exporting.value) return;
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return fail('仅支持 JPG / PNG / WebP，请重新选择图片。');
      if (file.size > 20 * 1024 * 1024) return fail('图片超过 20MB，请选择更小的文件。');
      imageLoading.value = true; error.value = ''; message.value = '正在读取图片…';
      const version = ++importVersion, url = URL.createObjectURL(file);
      try {
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve; image.onerror = () => reject(new Error('文件损坏或浏览器无法解码')); image.src = url;
        });
        const prepared = Core.render(image, Core.createState(), { color: false });
        if (version !== importVersion) { URL.revokeObjectURL(url); return; }
        const oldUrl = originalImageUrl.value;
        renderer?.dispose(); renderer = null; sourcePreview = prepared; dragging = false;hoverFilter.value=null;wbPicking.value=false;histogram.value=null;selectedCurvePoint.value=0;
        sourceImage.value = image; originalImageUrl.value = url; filename.value = file.name;
        vignetteDirection.value='dark';state.value = Core.createState(); history = Core.createHistory(state.value); historyVersion.value++;
        preview.value = null; cropOpen.value = false; straightenOpen.value=false;inspectorOpen.value=false;Object.assign(inspectorPosition,{x:.5,y:.5});compareMode.value = 'edited'; zoom.value = 100;
        aiResults.value = []; aiStatus.value = ''; galleryResults.value = []; recipeDetail.value = null;
        currentView.value = 'editor'; imageLoaded.value = true;
        // The canvas inside v-if exists only after the DOM update completes.
        await nextTick(); observeCanvas();
        draw(mainCanvas.value, prepared); draw(compareCanvas.value, prepared);
        previewSize.width = prepared.width; previewSize.height = prepared.height;
        initRenderer(); schedulePaint();
        if (oldUrl) URL.revokeObjectURL(oldUrl);
        notify(`已载入 ${file.name} · ${image.naturalWidth} × ${image.naturalHeight}，可以开始调整。`);
      } catch (e) { URL.revokeObjectURL(url); fail(`读取失败：${e.message}。请重新选择图片。`); }
      finally { if (version === importVersion) imageLoading.value = false; }
    }
    function handleUpload(event) { loadImage(event.target.files[0]); event.target.value = ''; }
    function handleDrop(event) { loadImage(event.dataTransfer.files[0]); }
    function observeCanvas() {
      observer?.disconnect(); if (!canvasContainer.value) return;
      observer = new ResizeObserver(entries => {
        const rect = entries[0].contentRect; viewport.width = rect.width; viewport.height = rect.height;
        if (window.innerWidth <= 760 && compareMode.value === 'slider') compareMode.value = 'edited';
      });
      observer.observe(canvasContainer.value);
    }
    function transform(type, params) { if (locked.value) return; maskPointerUp();maskEditing.value=false;state.value.geometry.push({ type, params }); commit(); }
    function rotateFree() {
      const angle = Number(rotationAngle.value);
      if (!Number.isFinite(angle) || angle < -180 || angle > 180) return fail('旋转角度应在 -180° 到 180° 之间。');
      if (angle !== 0) transform('rotate', { angle }); rotationAngle.value = 0;
    }
    function beginCrop() {
      maskPointerUp();maskEditing.value=false;
      if (locked.value) return;
      hoverFilter.value=null;wbPicking.value=false;
      inspectorOpen.value=false;
      cropOpen.value = true; cropRatio.value = 'free';
      Object.keys(cropDraft).forEach(key => delete cropDraft[key]);
      Object.assign(crop, { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }); compareMode.value = 'edited'; zoom.value = 100;
      revealMobileTool('.crop-bar');
    }
    function constrainCrop() {
      let w = Core.clamp(Number(crop.width), 1/outputDimensions.value.width, 1), h = Core.clamp(Number(crop.height), 1/outputDimensions.value.height, 1);
      const ratio=cropNormalizedRatio();
      if (ratio) {
        h = w / ratio;
        if (h > 1) { h = 1; w = ratio; }
      }
      crop.width = w; crop.height = h;
      crop.x = Core.clamp(Number(crop.x), 0, 1 - w); crop.y = Core.clamp(Number(crop.y), 0, 1 - h);
    }
    function cropNormalizedRatio() {
      if(cropRatio.value==='free')return 0;
      const ratio=cropRatio.value==='original'?sourceImage.value.naturalWidth/sourceImage.value.naturalHeight:Number(cropRatio.value);
      return ratio*outputDimensions.value.height/outputDimensions.value.width;
    }
    function cropPixelInput(key,event) {
      const value=event.target.valueAsNumber,dimension=['x','width'].includes(key)?outputDimensions.value.width:outputDimensions.value.height;
      delete cropDraft[key];
      if(!Number.isInteger(value)||value<(['width','height'].includes(key)?1:0)||value>dimension){fail('请输入图片范围内的整数像素。');event.target.value=cropPixels.value[key];return;}
      crop[key]=value/dimension;
      if(key==='height'&&cropNormalizedRatio())crop.width=crop.height*cropNormalizedRatio();
      constrainCrop();error.value='';
    }
    function cropPoint(event) {
      const rect = event.currentTarget.getBoundingClientRect();
      return { x: Core.clamp((event.clientX - rect.left) / rect.width, 0, 1), y: Core.clamp((event.clientY - rect.top) / rect.height, 0, 1) };
    }
    function cropPointerDown(event) {
      if(event.button!==0)return;
      event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
      const handle=event.target.closest('[data-crop-handle]')?.dataset.cropHandle;
      cropDrag={point:cropPoint(event),start:{...crop},mode:handle||(event.target.closest('.crop-selection')?'move':'select')};
    }
    function cropPointerMove(event) {
      if (!cropDrag) return; const point = cropPoint(event);
      const dx=point.x-cropDrag.point.x,dy=point.y-cropDrag.point.y,start=cropDrag.start;
      if(cropDrag.mode==='move'){crop.x=Core.clamp(start.x+dx,0,1-start.width);crop.y=Core.clamp(start.y+dy,0,1-start.height);return;}
      if(cropDrag.mode==='select'){
        if(Math.abs(dx)+Math.abs(dy)<.002)return;
        const ratio=cropNormalizedRatio();let w=Math.max(1/outputDimensions.value.width,Math.abs(dx)),h=Math.max(1/outputDimensions.value.height,Math.abs(dy));
        const left=dx<0,top=dy<0,ax=cropDrag.point.x,ay=cropDrag.point.y;
        if(ratio){w=Math.max(w,h*ratio);w=Math.min(w,left?ax:1-ax,(top?ay:1-ay)*ratio);h=w/ratio;}
        Object.assign(crop,{x:left?ax-w:ax,y:top?ay-h:ay,width:w,height:h});constrainCrop();return;
      }
      Object.assign(crop,Core.tools.resizeCrop(start,cropDrag.mode,dx,dy,cropNormalizedRatio(),1/outputDimensions.value.width,1/outputDimensions.value.height));
    }
    function cropHandleKey(handle,event) {
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();const step=event.shiftKey?10:1;
      const dx=(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0)/outputDimensions.value.width;
      const dy=(event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0)/outputDimensions.value.height;
      Object.assign(crop,Core.tools.resizeCrop({...crop},handle,dx,dy,cropNormalizedRatio(),1/outputDimensions.value.width,1/outputDimensions.value.height));
    }
    function applyCrop() {
      constrainCrop(); state.value.geometry.push({ type: 'crop', params: { ...crop, unit: 'normalized' } });
      cropOpen.value = false; cropDrag = null; commit(); notify('已裁剪，可撤销并继续调色。');
    }
    function setDetail(key,value) {state.value.detail[key]=value;error.value='';}
    function inputDetail(control,event) {
      const value=event.target.valueAsNumber;
      if(!Number.isFinite(value)||value<control.min||value>control.max||(control.key!=='radius'&&!Number.isInteger(value))){fail(`${control.label}请输入 ${control.min} 到 ${control.max} 之间的${control.key==='radius'?'数值':'整数'}。`);event.target.value=state.value.detail[control.key];return;}
      setDetail(control.key,control.key==='radius'?Math.round(value*10)/10:value);commit();
    }
    function resetDetail(key) {setDetail(key,detailControls.find(c=>c.key===key).default);commit();}
    function resetDetails() {state.value.detail=Core.detail.defaults();state.value.effects.clarity=0;state.value.effects.dehaze=0;commit();notify('已复位细节，可撤销。');}
    function advancedTarget(control){return control.kind==='effect'?state.value.effects:control.kind==='vignette'?state.value.effects.vignette:control.kind==='calibration'?state.value.effects.calibration[control.band]:selectedMask.value?.adjustments;}
    function advancedValue(control){const value=advancedTarget(control)?.[control.field]??control.default;return control.kind==='vignette'&&control.field==='amount'?Math.abs(value):value;}
    function setAdvanced(control,value){const target=advancedTarget(control);if(target){if(control.kind==='vignette'&&control.field==='amount'){vignetteDirection.value=vignetteMode.value;value=Math.abs(value)*(vignetteMode.value==='dark'?-1:1);}target[control.field]=value;}error.value='';}
    function inputAdvanced(control,event){const v=event.target.valueAsNumber;if(!Number.isFinite(v)||v<control.min||v>control.max||(control.step===1&&!Number.isInteger(v))){event.target.value=advancedValue(control);return fail(`${control.label}请输入 ${control.min} 到 ${control.max} 之间的${control.step===1?'整数':'数值'}。`);}setAdvanced(control,Math.round(v*100)/100);commit();}
    function resetAdvanced(key){const c=[...effectControls,...vignetteControls.value,...calibrationControls,...maskControls].find(c=>c.key===key);if(c){setAdvanced(c,c.default);commit();}}
    function resetAdvancedGroup(kind){if(kind==='calibration')state.value.effects.calibration=Core.effects.defaults().calibration;else if(kind==='vignette'){vignetteDirection.value='dark';state.value.effects.vignette=Core.effects.defaults().vignette;}else if(selectedMask.value)selectedMask.value.adjustments=Core.masks.defaults();commit();}
    function selectMask(id){maskPointerUp();maskId.value=id;maskEditing.value=false;}
    function addMask(type){
      if(locked.value)return;if(state.value.masks.length>=Core.masks.limits.layers)return fail('第一版最多支持 6 个蒙版，请先删除不需要的蒙版。');
      maskPointerUp();maskEditing.value=false;const id='mask-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),m=Core.masks.create(type,id);state.value.masks.push(m);maskId.value=id;commit();editMask();
    }
    function editMask(){if(locked.value||!selectedMask.value)return;maskPointerUp();maskEditing.value=!maskEditing.value;wbPicking.value=false;hoverFilter.value=null;compareMode.value='edited';if(maskEditing.value){inspectorOpen.value=false;revealMobileTool('.mask-status');}}
    function deleteMask(){if(!selectedMask.value)return;maskPointerUp();state.value.masks=state.value.masks.filter(m=>m.id!==maskId.value);maskId.value=null;maskEditing.value=false;commit();}
    function clearBrush(){if(!selectedMask.value)return;selectedMask.value.strokes=[];commit();}
    function maskPoint(event){const layer=event.currentTarget,rect=layer.getBoundingClientRect(),f=maskFrame.value;return Core.masks.transform(Core.masks.inverse(f.transform),(event.clientX-rect.left)/rect.width*f.fullWidth,(event.clientY-rect.top)/rect.height*f.fullHeight).map((v,i)=>Core.clamp(v/(i?f.sourceHeight:f.sourceWidth),0,1));}
    function maskPointerDown(event){
      if(event.button!==0||!selectedMask.value)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);const m=selectedMask.value,p=maskPoint(event),handle=event.target.closest('[data-mask-handle]')?.dataset.maskHandle;
      maskDrag={point:p,handle,start:Core.clone(m)};beginAdjustment();
      if(m.type==='brush'){
        const count=m.strokes.reduce((n,s)=>n+s.points.length,0);if(m.strokes.length>=64||count>=4096){maskDrag=null;dragging=false;return fail('此画笔蒙版已达笔画或点数上限，请新建蒙版或清空笔画。');}
        m.strokes.push({points:[p],radius:brushSize.value/200,feather:brushFeather.value/100,erase:maskErase.value});
      }else if(!handle){if(m.type==='linear'){m.start=p.slice();m.end=p.slice();}else{m.center=p.slice();m.radius=[.001,.001];}}
    }
    function maskPointerMove(event){
      if(!maskDrag||!selectedMask.value)return;const m=selectedMask.value,p=maskPoint(event),start=maskDrag.start;
      if(m.type==='brush'){
        const stroke=m.strokes[m.strokes.length-1],last=stroke.points.at(-1),f=maskFrame.value;if(Math.hypot((p[0]-last[0])*f.sourceWidth,(p[1]-last[1])*f.sourceHeight)<Math.max(1,stroke.radius*Math.min(f.sourceWidth,f.sourceHeight)*.08))return;
        if(stroke.points.length>=512||m.strokes.reduce((n,s)=>n+s.points.length,0)>=4096){maskPointerUp();return fail('这一笔已达点数上限，已保存；可以继续分笔绘制。');}stroke.points.push(p);
      }else if(m.type==='linear')m[maskDrag.handle==='start'?'start':'end']=p;
      else if(maskDrag.handle==='center')m.center=start.center.map((v,i)=>Core.clamp(v+p[i]-maskDrag.point[i],0,1));
      else m.radius=p.map((v,i)=>Core.clamp(Math.abs(v-m.center[i]),.001,1));
    }
    function maskPointerUp(){if(!maskDrag)return;maskDrag=null;commit();}
    function maskHandleKey(key,event){if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||!selectedMask.value)return;event.preventDefault();const m=selectedMask.value,f=maskFrame.value,step=event.shiftKey?10:1,p=key==='radius'?m.center.map((v,i)=>v+m.radius[i]):m[key],q=Core.masks.transform(f.transform,p[0]*f.sourceWidth,p[1]*f.sourceHeight);q[0]+=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0;q[1]+=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;const next=Core.masks.transform(Core.masks.inverse(f.transform),...q).map((v,i)=>Core.clamp(v/(i?f.sourceHeight:f.sourceWidth),0,1));if(key==='radius')m.radius=next.map((v,i)=>Math.max(.001,Math.abs(v-m.center[i])));else m[key]=next;commit();}
    function revealMobileTool(selector) {if(window.innerWidth<=760)nextTick(()=>document.querySelector(selector)?.scrollIntoView({block:'center',behavior:'smooth'}));}
    function toggleInspector() {if(!inspectorOpen.value&&locked.value)return;wbPicking.value=false;hoverFilter.value=null;inspectorOpen.value=!inspectorOpen.value;if(inspectorOpen.value)revealMobileTool('.detail-inspector');}
    function nudgeInspector(dx,dy) {inspectorPosition.x=Core.clamp(inspectorPosition.x+dx,0,1);inspectorPosition.y=Core.clamp(inspectorPosition.y+dy,0,1);}
    function stageClick(event) {
      if(maskEditing.value)return;
      if(wbPicking.value)return pickWhiteBalance(event);
      if(!inspectorOpen.value||cropOpen.value||straightenOpen.value)return;
      const bounds=mainCanvas.value.getBoundingClientRect();Object.assign(inspectorPosition,{x:Core.clamp((event.clientX-bounds.left)/bounds.width,0,1),y:Core.clamp((event.clientY-bounds.top)/bounds.height,0,1)});
    }
    function beginStraighten() {
      maskPointerUp();maskEditing.value=false;
      if(locked.value)return;inspectorOpen.value=false;hoverFilter.value=null;wbPicking.value=false;
      straightenAngle.value=0;straightenAutoCrop.value=true;straightenOpen.value=true;compareMode.value='edited';zoom.value=100;
      revealMobileTool('.straighten-bar');
    }
    function inputStraighten(event) {
      const value=event.target.valueAsNumber;
      if(!Number.isFinite(value)||value< -45||value>45){event.target.value=straightenAngle.value;return fail('拉直角度应在 −45° 到 45° 之间。');}
      straightenAngle.value=Math.round(value*10)/10;error.value='';dragging=false;schedulePaint();
    }
    function finishStraighten(apply) {
      if(apply&&straightenAngle.value!==0)state.value.geometry.push({type:'straighten',params:{angle:straightenAngle.value,autoCrop:straightenAutoCrop.value}});
      straightenOpen.value=false;dragging=false;
      if(apply)commit();else schedulePaint();
    }
    function sourcePixels() {
      const canvas=Core.render(sourcePreview,state.value,{maxSide:224,color:false});
      return canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    }
    function autoExposure() {
      if(locked.value)return;
      try{
        const base=Core.clone(state.value);base.adjustments.exposure=0;
        const canvas=Core.render(sourceImage.value,base,{maxSide:224});
        setAdjustment('exposure',Core.tools.autoExposure(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data));
        commit();notify('已自动调整曝光，可微调或撤销。');
      }catch(e){fail(e.message);}
    }
    function setWhiteBalance(gains,mode) {
      if(mode==='original'){state.value.whiteBalance={gains:[1,1,1],mode};state.value.adjustments.temperature=0;state.value.adjustments.tint=0;}
      else Core.setWhiteBalance(state.value,gains,mode);
      wbPicking.value=false;commit();
    }
    function autoWhiteBalance() {
      if(locked.value)return false;
      try{setWhiteBalance(Core.tools.autoWhiteBalance(sourcePixels()),'auto');notify('已自动调整白平衡，可微调或撤销。');return true;}
      catch(e){fail(e.message);return false;}
    }
    function whiteBalanceChoice(event) {
      if(locked.value)return;
      try{
        if(event.target.value==='original')setWhiteBalance([1,1,1],'original');
        else if(event.target.value==='auto'&&!autoWhiteBalance())event.target.value=state.value.whiteBalance.mode;
      }catch(e){event.target.value=state.value.whiteBalance.mode;fail(e.message);}
    }
    function toggleWBSampling() { if(locked.value)return;hoverFilter.value=null;wbPicking.value=!wbPicking.value;compareMode.value='edited'; }
    function pickWhiteBalance(event) {
      if(!wbPicking.value)return;
      const bounds=mainCanvas.value.getBoundingClientRect(),x=(event.clientX-bounds.left)/bounds.width,y=(event.clientY-bounds.top)/bounds.height;
      try{
        const canvas=Core.render(sourcePreview,state.value,{color:false});
        const px=Core.clamp(Math.round(x*(canvas.width-1)),0,canvas.width-1),py=Core.clamp(Math.round(y*(canvas.height-1)),0,canvas.height-1);
        const left=Math.max(0,px-2),top=Math.max(0,py-2),data=canvas.getContext('2d').getImageData(left,top,Math.min(5,canvas.width-left),Math.min(5,canvas.height-top)).data;
        const rgb=[0,0,0];let count=0;for(let i=0;i<data.length;i+=4)if(data[i+3]){for(let c=0;c<3;c++)rgb[c]+=data[i+c];count++;}
        if(!count)throw new Error('这处是透明区域，请选择照片中的白色或浅灰区域。');
        setWhiteBalance(Core.tools.sampleGains(rgb.map(v=>v/count)),'sample');notify('已按取样区域校正白平衡，可微调或撤销。');
      }catch(e){fail(e.message);}
    }
    function setHSL(band,value) { hoverFilter.value=null;state.value.hsl[band][hslMode.value]=value; }
    function hslNumber(control,event) {
      const value=event.target.valueAsNumber;
      if(!Number.isInteger(value)||value< -100||value>100){fail('HSL 请输入 −100 到 100 之间的整数。');event.target.value=state.value.hsl[control.band][hslMode.value];return;}
      setHSL(control.band,value);error.value='';commit();
    }
    function resetHSLControl(key) { setHSL(key.slice(4),0);commit(); }
    function resetHSL() { state.value.hsl=Core.tools.createHSL();commit(); }
    function selectCurve(channel) {curveChannel.value=channel;selectedCurvePoint.value=0;}
    function moveCurvePoint(index,x,y) {
      const points=curvePoints.value;
      if(index===0)x=0;else if(index===points.length-1)x=1;else {const gap=Math.min(.004,(points[index+1][0]-points[index-1][0])/2);x=Core.clamp(x,points[index-1][0]+gap,points[index+1][0]-gap);}
      points[index]=[x,Core.clamp(y,0,1)];
    }
    function curvePointerDown(event) {
      if(locked.value||event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
      const bounds=event.currentTarget.getBoundingClientRect(),x=Core.clamp((event.clientX-bounds.left)/bounds.width,0,1),y=Core.clamp(1-(event.clientY-bounds.top)/bounds.height,0,1);
      let index=Number(event.target.dataset.point);if(!Number.isInteger(index)){
        index=curvePoints.value.findIndex(p=>Math.abs(p[0]-x)<.015);
        if(index<0){if(curvePoints.value.length>=10)return fail('每个通道最多 10 个控制点。');curvePoints.value.push([x,y]);curvePoints.value.sort((a,b)=>a[0]-b[0]);index=curvePoints.value.findIndex(p=>p[0]===x);}
      }
      selectedCurvePoint.value=index;curveDrag={index};beginAdjustment();moveCurvePoint(index,x,y);
    }
    function curvePointerMove(event) {
      if(!curveDrag)return;const bounds=event.currentTarget.getBoundingClientRect();
      moveCurvePoint(curveDrag.index,(event.clientX-bounds.left)/bounds.width,1-(event.clientY-bounds.top)/bounds.height);
    }
    function curvePointerUp() {if(!curveDrag)return;curveDrag=null;commit();}
    function curveNumber(axis,event) {
      if(locked.value)return;
      const value=event.target.valueAsNumber;
      delete curveDraft[axis];
      if(!Number.isFinite(value)||value<0||value>255){fail('曲线坐标应在 0 到 255 之间。');event.target.value=Math.round(selectedPoint.value[axis]*255);return;}
      const point=selectedPoint.value.slice();point[axis]=value/255;moveCurvePoint(selectedCurvePoint.value,...point);error.value='';commit();
    }
    function deleteCurvePoint() {const index=selectedCurvePoint.value;if(index<=0||index>=curvePoints.value.length-1)return;curvePoints.value.splice(index,1);selectedCurvePoint.value=Math.max(0,index-1);commit();}
    function resetCurve(all=false) {if(all)state.value.curves=Core.tools.createCurves();else state.value.curves[curveChannel.value]=Core.tools.identity();selectedCurvePoint.value=0;commit();}
    function curveKey(event) {
      if(locked.value)return;
      if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();deleteCurvePoint();return;}
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;
      event.preventDefault();const step=(event.shiftKey?10:1)/255,p=selectedPoint.value;
      moveCurvePoint(selectedCurvePoint.value,p[0]+(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0),p[1]+(event.key==='ArrowDown'?-step:event.key==='ArrowUp'?step:0));commit();
    }
    function beginPreview(recipe) {
      if (!imageLoaded.value) return fail('请先载入照片，再在自己的照片上预览。');
      if (imageLoading.value || exporting.value || cropOpen.value || straightenOpen.value) return;
      commit();
      error.value = '';
      try {
        const proposal = Core.recipeState(state.value, recipe);
        preview.value = { name: recipe.name, state: proposal.state, warnings: proposal.warnings };
        recipeDetail.value = null; currentView.value = 'editor'; compareMode.value = 'edited';
        if (proposal.warnings.length) notify(proposal.warnings.join('；'));
      } catch (e) { fail(e.message); }
    }
    function hoverStyle(filter,event) { if(locked.value||wbPicking.value||(event?.pointerType&&event.pointerType!=='mouse'))return;hoverFilter.value=filter;compareMode.value='edited'; }
    function leaveStyle(filter) { if(hoverFilter.value?.name===filter.name)hoverFilter.value=null; }
    function applyFilter(filter) { if(locked.value)return;hoverFilter.value=null;state.value.filter=filter.name;state.value.filterStrength=100;commit();notify(`已应用「${filter.label}」，可以调整强度或撤销。`); }
    function applyPreview() {
      if (!preview.value) return; const name = preview.value.name;
      state.value = Core.clone(preview.value.state); preview.value = null; commit(); notify(`已应用「${name}」，可以继续调色或撤销。`);
    }
    function cancelPreview() { preview.value = null; schedulePaint(); notify('已取消预览，保留之前的编辑。'); }
    function removeFilter() { state.value.filter = null; commit(); }
    function renderThumbnail(canvas, recipe) {
      if (!canvas || !sourceImage.value || dragging) return;
      const key = JSON.stringify([importVersion, state.value, recipe]);
      if (thumbnailCache.get(canvas) === key) return;
      try {
        draw(canvas, Core.render(sourceImage.value, Core.recipeState(state.value, recipe).state, { maxSide: 240 }));
        thumbnailCache.set(canvas, key);
      }
      catch { canvas.width = 1; canvas.height = 1; }
    }
    function diagnosis() {
      const canvas = Core.render(sourceImage.value, state.value, { maxSide: 224 });
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let valueSum = 0, saturationSum = 0, hueX = 0, hueY = 0, dark = 0, bright = 0, count = 0;
      const hueHist = new Array(360).fill(0);
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] === 0) continue;
        const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
        const v = Math.max(r, g, b), min = Math.min(r, g, b), delta = v - min;
        const saturation = v === 0 ? 0 : delta / v;
        let hue = 0;
        if (delta > 0) {
          if (v === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) * 60;
          else if (v === g) hue = ((b - r) / delta + 2) * 60;
          else hue = ((r - g) / delta + 4) * 60;
          hueHist[Math.floor(hue) % 360]++;
          hueX += Math.cos(hue * Math.PI / 180) * saturation;
          hueY += Math.sin(hue * Math.PI / 180) * saturation;
        }
        count++; valueSum += v; saturationSum += saturation;
        if (v < 0.2) dark++; if (v > 0.95) bright++;
      }
      const n = Math.max(1, count), diag = [];
      if (valueSum / n < 0.3) diag.push({ label: '画面整体较暗' });
      if (dark / n > 0.4) diag.push({ label: '暗部较多' });
      if (bright / n > 0.15) diag.push({ label: '亮部较多' });
      const avgH = (Math.atan2(hueY, hueX) * 180 / Math.PI + 360) % 360;
      return { canvas, diag, avgV: valueSum / n, avgS: saturationSum / n, avgH, hueHist };
    }
    async function api(path, options = {}) {
      const response = await fetch(`/api${path}`, { ...options, signal: AbortSignal.timeout(65000) });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || `服务暂不可用（${response.status}）`); return data;
    }
    async function requestAI() {
      if (locked.value || aiLoading.value) return;
      aiLoading.value = true; aiStatus.value = '正在分析当前版本…'; const version = importVersion;
      const baseState = JSON.stringify(state.value);
      try {
        const d = diagnosis();
        const data = await api('/ai/recommend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ diagnosis: d.diag, image_base64: d.canvas.toDataURL('image/jpeg', 0.7).split(',')[1] }) });
        if (version !== importVersion) return;
        if (baseState !== JSON.stringify(state.value)) {
          aiResults.value = []; aiStatus.value = '分析期间编辑已改变，请重新获取当前版本的建议。'; return;
        }
        aiResults.value = data.recipes || [];
        aiStatus.value = data.demo ? '演示方案：未连接云端模型，以下为固定示例配方。' : '建议已生成，点击方案先预览。';
        if (!aiResults.value.length) throw new Error('没有收到可用方案，请重试或使用手动调整。');
      } catch (e) { if (version === importVersion) aiStatus.value = `获取失败：${e.message}`; }
      finally { aiLoading.value = false; }
    }
    async function matchGallery() {
      if (locked.value || galleryLoading.value) return;
      galleryLoading.value = true; const version = importVersion;
      const baseState = JSON.stringify(state.value);
      try {
        const d = diagnosis();
        const data = await api('/gallery/match', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ features: { avgV: d.avgV, avgS: d.avgS, avgH: d.avgH } }) });
        if (version === importVersion && baseState === JSON.stringify(state.value)) galleryResults.value = data.results || [];
      } catch (e) { if (version === importVersion) fail(`图库匹配失败：${e.message}`); }
      finally { galleryLoading.value = false; }
    }
    async function fetchCommunity() {
      const version = ++communityVersion; communityLoading.value = true; communityError.value = '';
      try {
        const data = await api(`/recipes?search=${encodeURIComponent(communitySearch.value)}`);
        if (version === communityVersion) { communityRecipes.value = data.recipes || []; communityFetched = true; }
      } catch (e) { if (version === communityVersion) communityError.value = `加载失败：${e.message}`; }
      finally { if (version === communityVersion) communityLoading.value = false; }
    }
    function searchCommunity() { clearTimeout(searchTimer); searchTimer = setTimeout(fetchCommunity, 250); }
    function openCommunity() { currentView.value = 'community'; if (!communityFetched) fetchCommunity(); }
    watch(currentView, async (value, oldValue) => {
      if (oldValue === 'community') communityScroll = communityContainer.value?.scrollTop || 0;
      await nextTick();
      if (value === 'editor') { observeCanvas(); schedulePaint(); }
      else if (communityContainer.value) communityContainer.value.scrollTop = communityScroll;
    }, { flush: 'pre' });
    function openExport() { if (locked.value) return; commit(); exportOpen.value = true; }
    async function exportImage() {
      if (exporting.value || preview.value || !sourceImage.value) return;
      exporting.value = true; error.value = ''; message.value = '正在生成导出文件…';
      try {
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
        const result = Core.render(sourceImage.value, state.value, { maxSide: 0, scale: Number(exportOptions.scale) });
        let canvas = result;
        if (exportOptions.format === 'jpg') {
          canvas = document.createElement('canvas'); canvas.width = result.width; canvas.height = result.height;
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(result, 0, 0);
        }
        const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('浏览器无法生成文件')), exportOptions.format === 'png' ? 'image/png' : 'image/jpeg', Number(exportOptions.quality) / 100));
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.download = `${filename.value.replace(/\.[^.]+$/, '')}-调色.${exportOptions.format}`; link.href = url;
        document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
        exportOpen.value = false; notify(`已生成 ${canvas.width} × ${canvas.height} 的 ${exportOptions.format.toUpperCase()} 文件并发起下载。`);
      } catch (e) { fail(`导出失败：${e.message}。当前编辑已保留，可以重试。`); }
      finally { exporting.value = false; }
    }
    async function copyRecipe() {
      if (locked.value) return;
      try { await navigator.clipboard.writeText(JSON.stringify(Core.toRecipe(state.value), null, 2)); notify('当前配方已复制，可在其他照片上复用。'); }
      catch { fail('剪贴板不可用，请使用“下载配方”保存文件。'); }
    }
    function downloadRecipe() {
      if (locked.value) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(Core.toRecipe(state.value), null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = '调色配方.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000); notify('已发起配方下载。');
    }
    async function importRecipe(event) {
      const file = event.target.files[0]; event.target.value = ''; if (!file || locked.value) return;
      try { const recipe = JSON.parse(await file.text()); beginPreview({ ...recipe, name: recipe.name || '导入配方' }); }
      catch { fail('配方无法读取，请选择有效的 JSON 配方文件。'); }
    }
    function keydown(event) {
      if(event.key==='Escape'){maskPointerUp();maskEditing.value=false;wbPicking.value=false;hoverFilter.value=null;if(straightenOpen.value)finishStraighten(false);}
      if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable || currentView.value !== 'editor' || locked.value || exportOpen.value) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); restore(event.shiftKey ? 'redo' : 'undo'); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); restore('redo'); }
    }
    function beforeUnload(event) { if (imageLoaded.value && dirty.value) { event.preventDefault(); event.returnValue = ''; } }
    onMounted(() => { window.addEventListener('keydown', keydown); window.addEventListener('beforeunload', beforeUnload); });
    onBeforeUnmount(() => {
      importVersion++; observer?.disconnect(); clearTimeout(searchTimer); if (frame !== null) cancelAnimationFrame(frame);
      renderer?.dispose();
      if (originalImageUrl.value) URL.revokeObjectURL(originalImageUrl.value);
      window.removeEventListener('keydown', keydown); window.removeEventListener('beforeunload', beforeUnload);
    });
    return {
      effectControls,vignetteControls,vignetteMode,changeVignetteMode,calibrationControls,maskControls,advancedValue,setAdvanced,inputAdvanced,resetAdvanced,resetAdvancedGroup,
      maskId,maskEditing,showMask,maskErase,brushSize,brushFeather,maskCanvas,selectedMask,maskHandles,maskGuide,selectMask,addMask,editMask,deleteMask,clearBrush,maskPointerDown,maskPointerMove,maskPointerUp,maskHandleKey,
      mainCanvas, compareCanvas, canvasContainer, communityContainer, currentView, imageLoaded, imageLoading, originalImageUrl, filename, message, error,
      state, preview, hoverFilter, wbPicking, histogram, histogramPath, canUndo, canRedo, activeState, controls: Core.controls, colorControls, adjustmentValue, filters: Core.filters, locked, dirty,
      compareMode, sliderPos, zoom, stageStyle, previewSize, outputDimensions, exportDimensions,
      detailControls,setDetail,inputDetail,resetDetail,resetDetails,inspectorBusy,inspectorOpen,inspectorBefore,inspectorCanvas,inspectorOriginal,inspectorPosition,toggleInspector,nudgeInspector,stageClick,showGuides,straightenOpen,straightenAngle,straightenAutoCrop,beginStraighten,inputStraighten,finishStraighten,commitStraightenPreview:()=>{dragging=false;schedulePaint();},
      cropOpen, cropRatio, crop, cropStyle, cropPixels, cropDraft, cropHandles, cropPixelInput, cropHandleKey, rotationAngle, cropPointerDown, cropPointerMove, cropPointerUp: () => { cropDrag = null; },
      hslMode,hslControls,setHSL,hslNumber,resetHSLControl,resetHSL,curveChannel,curvePoints,curvePath,selectedCurvePoint,selectedPoint,curveDraft,selectCurve,curvePointerDown,curvePointerMove,curvePointerUp,curveNumber,deleteCurvePoint,resetCurve,curveKey,
      exportOpen, exporting, exportOptions, aiOpen, aiLoading, aiResults, aiStatus, galleryLoading, galleryResults,
      communitySearch, communityRecipes, communityLoading, communityError, recipeDetail, exportDialog, recipeDialog,
      handleUpload, handleDrop, beginAdjustment, commit, setAdjustment, resetAdjustment, resetGroup, inputAdjustment, resetImage, restore, transform, rotateFree, beginCrop, constrainCrop, applyCrop,
      beginPreview, hoverStyle, leaveStyle, applyFilter, applyPreview, cancelPreview, removeFilter, renderThumbnail, requestAI, matchGallery,
      autoExposure,autoWhiteBalance,whiteBalanceChoice,toggleWBSampling,pickWhiteBalance,
      fetchCommunity, searchCommunity, openCommunity, openExport, exportImage, copyRecipe, downloadRecipe, importRecipe
    };
  }
}).mount('#app');
