const { createApp, ref, reactive, computed, watch, onMounted, nextTick } = Vue;

const API_BASE = 'http://localhost:5000/api';

const app = createApp({
  setup() {
    const mainCanvas = ref(null);
    const compareCanvas = ref(null);

    // 状态
    const currentView = ref('editor');
    const imageLoaded = ref(false);
    const originalImageUrl = ref('');
    const originalImage = ref(null);
    const viewMode = ref('single');
    const sliderPos = ref(50);
    const activeTab = ref('manual');
    const showCompare = ref(false);
    const aiLoading = ref(false);
    const galleryLoading = ref(false);
    const user = ref(null);
    const loginDialogVisible = ref(false);
    const publishDialogVisible = ref(false);
    const previewDialogVisible = ref(false);
    const previewRecipeData = ref(null);
    const communitySearch = ref('');
    const diagnosisResult = ref([]);
    const aiResults = ref([]);
    const galleryResults = ref([]);
    const communityRecipes = ref([]);

    // 登录表单
    const loginForm = reactive({ username: '', password: '' });

    // 发布表单
    const publishForm = reactive({ name: '', description: '' });

    // 调色参数
    const adjustments = reactive([
      { key: 'brightness', label: '亮度', value: 0 },
      { key: 'contrast', label: '对比度', value: 0 },
      { key: 'saturation', label: '饱和度', value: 0 },
      { key: 'temperature', label: '色温', value: 0 },
      { key: 'exposure', label: '曝光', value: 0 },
      { key: 'shadows', label: '阴影', value: 0 },
      { key: 'highlights', label: '高光', value: 0 }
    ]);

    // 预设滤镜
    const presetFilters = [
      { name: 'clarity', label: '通透', color: 'linear-gradient(135deg, #e8f5e9, #81c784)' },
      { name: 'warm-autumn', label: '暖秋', color: 'linear-gradient(135deg, #fff3e0, #ff8a65)' },
      { name: 'film', label: '胶片', color: 'linear-gradient(135deg, #fce4ec, #ce93d8)' },
      { name: 'cool-tone', label: '冷调', color: 'linear-gradient(135deg, #e3f2fd, #64b5f6)' },
      { name: 'bw', label: '黑白', color: 'linear-gradient(135deg, #e0e0e0, #424242)' },
      { name: 'vivid', label: '鲜艳', color: 'linear-gradient(135deg, #f3e5f5, #ff4081)' }
    ];

    // 历史记录 (撤销/重做)
    const history = ref([]);
    const historyIndex = ref(-1);
    const currentFilter = ref(null);

    // 配方步骤记录
    const recipeSteps = ref([]);

    function saveState() {
      if (!mainCanvas.value) return;
      const ctx = mainCanvas.value.getContext('2d');
      const dataUrl = mainCanvas.value.toDataURL();
      history.value = history.value.slice(0, historyIndex.value + 1);
      history.value.push(dataUrl);
      if (history.value.length > 20) history.value.shift();
      historyIndex.value = history.value.length - 1;
    }

    function restoreState(index) {
      if (index < 0 || index >= history.value.length) return;
      const img = new Image();
      img.onload = () => {
        const ctx = mainCanvas.value.getContext('2d');
        ctx.clearRect(0, 0, mainCanvas.value.width, mainCanvas.value.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = history.value[index];
    }

    function undo() {
      if (historyIndex.value > 0) {
        historyIndex.value--;
        restoreState(historyIndex.value);
      }
    }

    function redo() {
      if (historyIndex.value < history.value.length - 1) {
        historyIndex.value++;
        restoreState(historyIndex.value);
      }
    }

    function addRecipeStep(type, params) {
      recipeSteps.value.push({ type, params });
    }

    // 图片上传
    function loadImage(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        originalImageUrl.value = e.target.result;
        const img = new Image();
        img.onload = () => {
          originalImage.value = img;
          imageLoaded.value = true;
          initCanvas(img);
          nextTick(() => {
            applyAdjustments();
            runDiagnosis();
          });
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    function handleUpload(file) {
      loadImage(file);
      return false;
    }

    function handleDrop(e) {
      const file = e.dataTransfer.files[0];
      if (file) loadImage(file);
    }

    function initCanvas(img) {
      const canvas = mainCanvas.value;
      const maxW = canvas.parentElement.clientWidth - 20;
      const maxH = canvas.parentElement.clientHeight - 20;
      let w = img.naturalWidth;
      let h = img.naturalHeight;
      if (w > maxW) { h = h * maxW / w; w = maxW; }
      if (h > maxH) { w = w * maxH / h; h = maxH; }
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      saveState();
      recipeSteps.value = [];
    }

    // Canvas 像素操作
    function getCanvasData() {
      const canvas = mainCanvas.value;
      const ctx = canvas.getContext('2d');
      return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    function putCanvasData(data) {
      const canvas = mainCanvas.value;
      const ctx = canvas.getContext('2d');
      ctx.putImageData(data, 0, 0);
    }

    // 调色处理
    function applyAdjustments() {
      if (!imageLoaded.value || !mainCanvas.value) return;
      const canvas = mainCanvas.value;
      const ctx = canvas.getContext('2d');

      // 从原图重新绘制
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(originalImage.value, 0, 0, canvas.width, canvas.height);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      const adj = {};
      adjustments.forEach(a => adj[a.key] = a.value);

      for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i+1], b = data[i+2];

        // 曝光 (整体亮度缩放)
        if (adj.exposure !== 0) {
          const factor = 1 + adj.exposure / 100;
          r *= factor; g *= factor; b *= factor;
        }

        // 亮度
        if (adj.brightness !== 0) {
          r += adj.brightness * 2.55;
          g += adj.brightness * 2.55;
          b += adj.brightness * 2.55;
        }

        // 对比度
        if (adj.contrast !== 0) {
          const factor = (259 * (adj.contrast + 255)) / (255 * (259 - adj.contrast));
          r = factor * (r - 128) + 128;
          g = factor * (g - 128) + 128;
          b = factor * (b - 128) + 128;
        }

        // 饱和度
        if (adj.saturation !== 0) {
          const gray = 0.299 * r + 0.587 * g + 0.114 * b;
          const s = 1 + adj.saturation / 100;
          r = gray + (r - gray) * s;
          g = gray + (g - gray) * s;
          b = gray + (b - gray) * s;
        }

        // 色温
        if (adj.temperature !== 0) {
          r += adj.temperature * 1.5;
          b -= adj.temperature * 1.5;
        }

        // 阴影 (提亮暗部)
        if (adj.shadows !== 0) {
          const brightness = (r + g + b) / 3;
          if (brightness < 128) {
            const shadowFactor = 1 + (adj.shadows / 100) * (1 - brightness / 128);
            r *= shadowFactor; g *= shadowFactor; b *= shadowFactor;
          }
        }

        // 高光 (压暗亮部)
        if (adj.highlights !== 0) {
          const brightness = (r + g + b) / 3;
          if (brightness > 128) {
            const highlightFactor = 1 - (adj.highlights / 100) * ((brightness - 128) / 128);
            r *= highlightFactor; g *= highlightFactor; b *= highlightFactor;
          }
        }

        // 应用当前滤镜
        if (currentFilter.value) {
          const fr = r, fg = g, fb = b;
          switch (currentFilter.value) {
            case 'bw': { const gray = 0.299 * fr + 0.587 * fg + 0.114 * fb; r = gray; g = gray; b = gray; break; }
            case 'warm-autumn': { r = fr * 1.1; g = fg * 0.95; b = fb * 0.85; break; }
            case 'cool-tone': { r = fr * 0.85; g = fg * 0.95; b = fb * 1.15; break; }
            case 'film': { r = fr * 0.95; g = fg * 0.9; b = fb * 0.85; const grain = (Math.random() - 0.5) * 10; r += grain; g += grain; b += grain; break; }
            case 'vivid': { const avg = (fr + fg + fb) / 3; r = avg + (fr - avg) * 1.3; g = avg + (fg - avg) * 1.3; b = avg + (fb - avg) * 1.3; break; }
            case 'clarity': { r = fr * 1.05; g = fg * 1.05; b = fb * 1.05; const clarityGrain = 5 * Math.sin(i * 0.1); r += clarityGrain; g += clarityGrain; b += clarityGrain; break; }
          }
        }

        data[i] = Math.max(0, Math.min(255, r));
        data[i+1] = Math.max(0, Math.min(255, g));
        data[i+2] = Math.max(0, Math.min(255, b));
      }

      ctx.putImageData(imageData, 0, 0);
    }

    // 应用滤镜
    function applyFilter(name) {
      currentFilter.value = currentFilter.value === name ? null : name;
      applyAdjustments();
      addRecipeStep('filter', { name });
    }

    // 旋转
    function rotateLeft() {
      rotateCanvas(-90);
      addRecipeStep('rotate', { angle: -90 });
    }

    function rotateRight() {
      rotateCanvas(90);
      addRecipeStep('rotate', { angle: 90 });
    }

    function rotateCanvas(angle) {
      const canvas = mainCanvas.value;
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      const rad = angle * Math.PI / 180;
      const sin = Math.abs(Math.sin(rad)), cos = Math.abs(Math.cos(rad));
      const nw = Math.ceil(w * cos + h * sin);
      const nh = Math.ceil(w * sin + h * cos);

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = nw; tempCanvas.height = nh;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.translate(nw / 2, nh / 2);
      tempCtx.rotate(rad);
      tempCtx.drawImage(canvas, -w / 2, -h / 2);

      canvas.width = nw; canvas.height = nh;
      ctx.drawImage(tempCanvas, 0, 0);
      saveState();
    }

    // 翻转
    function flipH() {
      const canvas = mainCanvas.value;
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(canvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      saveState();
      addRecipeStep('flip', { direction: 'h' });
    }

    function flipV() {
      const canvas = mainCanvas.value;
      const ctx = canvas.getContext('2d');
      ctx.translate(0, canvas.height);
      ctx.scale(1, -1);
      ctx.drawImage(canvas, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      saveState();
      addRecipeStep('flip', { direction: 'v' });
    }

    // 裁剪 (简化: 弹出对话框输入)
    function startCrop() {
      ElMessageBox.prompt('裁剪尺寸 (格式: 宽度x高度，如 1920x1080)', '裁剪', {
        inputPattern: /^\d+x\d+$/,
        inputErrorMessage: '格式不正确，请使用 宽度x高度 格式'
      }).then(({ value }) => {
        const [w, h] = value.split('x').map(Number);
        const canvas = mainCanvas.value;
        const ctx = canvas.getContext('2d');
        const sx = Math.min((canvas.width - w) / 2, 0);
        const sy = Math.min((canvas.height - h) / 2, 0);
        const sw = Math.min(w, canvas.width);
        const sh = Math.min(h, canvas.height);
        const imageData = ctx.getImageData(Math.max(0, sx), Math.max(0, sy), sw, sh);
        canvas.width = sw; canvas.height = sh;
        ctx.putImageData(imageData, 0, 0);
        saveState();
        addRecipeStep('crop', { x: Math.max(0, sx), y: Math.max(0, sy), width: sw, height: sh });
      }).catch(() => {});
    }

    // 直方图诊断
    function runDiagnosis() {
      if (!imageLoaded.value) return;
      const canvas = mainCanvas.value;
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const n = data.length / 4;

      let hSum = 0, sSum = 0, vSum = 0;
      let darkCount = 0, brightCount = 0, shadowCount = 0, highlightCount = 0;
      const hueHist = new Float32Array(360);

      for (let i = 0; i < data.length; i += 4) {
        let r = data[i] / 255, g = data[i+1] / 255, b = data[i+2] / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const v = max;
        const s = max === 0 ? 0 : (max - min) / max;
        let h = 0;
        if (s !== 0) {
          const d = max - min;
          if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
          else if (max === g) h = ((b - r) / d + 2) * 60;
          else h = ((r - g) / d + 4) * 60;
        }

        hSum += h; sSum += s; vSum += v;
        if (v < 0.25) darkCount++;
        if (v > 0.85) brightCount++;
        if (v < 0.15) shadowCount++;
        if (v > 0.95) highlightCount++;
        hueHist[Math.floor(h)]++;
      }

      const avgV = vSum / n;
      const avgS = sSum / n;
      const avgH = hSum / n;

      const diag = [];

      // 曝光诊断
      if (avgV < 0.3) diag.push({ label: '曝光不足', severity: 'severe', icon: '⚠' });
      else if (avgV > 0.75) diag.push({ label: '过曝', severity: 'severe', icon: '⚠' });

      if (darkCount / n > 0.4) diag.push({ label: '阴影过暗', severity: 'moderate', icon: '⚠' });
      if (brightCount / n > 0.3) diag.push({ label: '高光溢出', severity: 'moderate', icon: '⚠' });

      // 偏色诊断
      if (avgH > 190 && avgH < 260) diag.push({ label: '偏色（偏蓝）', severity: 'mild', icon: '⚡' });
      else if (avgH > 0 && avgH < 40) diag.push({ label: '偏色（偏暖）', severity: 'mild', icon: '⚡' });
      else if (avgH > 80 && avgH < 160) diag.push({ label: '偏色（偏绿）', severity: 'mild', icon: '⚡' });

      diagnosisResult.value = diag;
      return { avgV, avgS, avgH, hueHist, diag };
    }

    // AI 推荐
    async function requestAI() {
      if (!imageLoaded.value) return;
      aiLoading.value = true;

      const diagData = runDiagnosis();
      const canvas = mainCanvas.value;

      // 生成缩略图 (base64)
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 224; thumbCanvas.height = 224 * (canvas.height / canvas.width);
      const thumbCtx = thumbCanvas.getContext('2d');
      thumbCtx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      const thumbBase64 = thumbCanvas.toDataURL('image/jpeg', 0.7).split(',')[1];

      try {
        const res = await fetch(`${API_BASE}/ai/recommend`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            diagnosis: diagData.diag,
            image_base64: thumbBase64
          })
        });
        const data = await res.json();
        aiResults.value = data.recipes || [];
      } catch (e) {
        ElMessage.error('AI 推荐失败，请检查后端服务');
        aiResults.value = [];
      } finally {
        aiLoading.value = false;
      }
    }

    function applyAIRecipe(recipe) {
      applyRecipeSteps(recipe.steps);
      ElMessage.success(`已应用方案: ${recipe.name}`);
    }

    // 渲染 AI 预览缩略图
    function renderPreview(canvasEl, recipe) {
      if (!imageLoaded.value || !originalImage.value) return;
      const c = canvasEl;
      c.width = 120; c.height = 90;
      const ctx = c.getContext('2d');
      ctx.drawImage(originalImage.value, 0, 0, 120, 90);
      const imageData = ctx.getImageData(0, 0, 120, 90);
      const data = imageData.data;

      const steps = recipe.steps || [];
      const adj = {};
      steps.forEach(s => {
        if (s.type === 'filter') currentFilter.value = s.params.name;
        else if (['brightness','contrast','saturation','temperature','exposure','shadows','highlights'].includes(s.type))
          adj[s.type] = s.params.value;
      });

      for (let i = 0; i < data.length; i += 4) {
        let r = data[i], g = data[i+1], b = data[i+2];

        if (adj.exposure) { const f = 1 + adj.exposure / 100; r *= f; g *= f; b *= f; }
        if (adj.brightness) { r += adj.brightness * 2.55; g += adj.brightness * 2.55; b += adj.brightness * 2.55; }
        if (adj.contrast) { const f = (259 * (adj.contrast + 255)) / (255 * (259 - adj.contrast)); r = f * (r - 128) + 128; g = f * (g - 128) + 128; b = f * (b - 128) + 128; }
        if (adj.saturation) { const gray = 0.299 * r + 0.587 * g + 0.114 * b; const s = 1 + adj.saturation / 100; r = gray + (r - gray) * s; g = gray + (g - gray) * s; b = gray + (b - gray) * s; }
        if (adj.temperature) { r += adj.temperature * 1.5; b -= adj.temperature * 1.5; }
        if (adj.shadows) { const br = (r+g+b)/3; if (br < 128) { const f = 1 + (adj.shadows/100)*(1-br/128); r*=f; g*=f; b*=f; } }
        if (adj.highlights) { const br = (r+g+b)/3; if (br > 128) { const f = 1 - (adj.highlights/100)*((br-128)/128); r*=f; g*=f; b*=f; } }

        if (currentFilter.value) {
          if (currentFilter.value === 'bw') { const gray = 0.299*r+0.587*g+0.114*b; r=gray; g=gray; b=gray; }
          else if (currentFilter.value === 'warm-autumn') { r*=1.1; g*=0.95; b*=0.85; }
          else if (currentFilter.value === 'cool-tone') { r*=0.85; g*=0.95; b*=1.15; }
        }

        data[i] = Math.max(0, Math.min(255, r));
        data[i+1] = Math.max(0, Math.min(255, g));
        data[i+2] = Math.max(0, Math.min(255, b));
      }
      ctx.putImageData(imageData, 0, 0);
      currentFilter.value = null;
    }

    function applyRecipeSteps(steps) {
      if (!steps) return;
      steps.forEach(s => {
        switch (s.type) {
          case 'brightness': case 'contrast': case 'saturation': case 'temperature':
          case 'exposure': case 'shadows': case 'highlights': {
            const a = adjustments.find(x => x.key === s.type);
            if (a) a.value = s.params.value;
            break;
          }
          case 'filter': currentFilter.value = s.params.name; break;
          case 'rotate': if (s.params.angle === -90) rotateLeft(); else rotateRight(); break;
          case 'flip': if (s.params.direction === 'h') flipH(); else flipV(); break;
        }
      });
      applyAdjustments();
    }

    // 图库匹配
    async function matchGallery() {
      if (!imageLoaded.value) return;
      galleryLoading.value = true;

      const diag = runDiagnosis();
      const features = { avgV: diag.avgV, avgS: diag.avgS, avgH: diag.avgH };

      try {
        const res = await fetch(`${API_BASE}/gallery/match`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ features })
        });
        const data = await res.json();
        galleryResults.value = data.results || [];
      } catch (e) {
        ElMessage.error('图库匹配失败');
      } finally {
        galleryLoading.value = false;
      }
    }

    function applyGalleryRecipe(item) {
      if (item.steps) applyRecipeSteps(JSON.parse(item.steps));
      ElMessage.success(`已应用: ${item.name}`);
    }

    // 社区功能
    async function fetchCommunity() {
      try {
        const res = await fetch(`${API_BASE}/recipes?search=${encodeURIComponent(communitySearch.value)}`);
        const data = await res.json();
        communityRecipes.value = data.recipes || [];
      } catch (e) {
        communityRecipes.value = [];
      }
    }

    function searchCommunity() {
      fetchCommunity();
    }

    function applyCommunityRecipe(r) {
      if (previewDialogVisible.value) previewDialogVisible.value = false;
      if (r.steps) applyRecipeSteps(JSON.parse(r.steps));
      ElMessage.success(`已套用配方: ${r.name}`);
    }

    function previewRecipe(r) {
      previewRecipeData.value = r;
      previewDialogVisible.value = true;
    }

    // 导出
    function exportImage(format) {
      const canvas = mainCanvas.value;
      const mime = format === 'png' ? 'image/png' : 'image/jpeg';
      const link = document.createElement('a');
      link.download = `调色作品.${format}`;
      link.href = canvas.toDataURL(mime, 0.92);
      link.click();
      ElMessage.success(`已导出 ${format.toUpperCase()} 格式`);
    }

    // 复制配方 JSON
    function copyRecipe() {
      const recipe = {
        steps: recipeSteps.value,
        adjustments: adjustments.map(a => ({ ...a })),
        filter: currentFilter.value
      };
      navigator.clipboard.writeText(JSON.stringify(recipe, null, 2));
      ElMessage.success('配方已复制到剪贴板');
    }

    // 登录
    function showLoginDialog() {
      if (user.value) {
        user.value = null;
        ElMessage.success('已退出登录');
        return;
      }
      loginDialogVisible.value = true;
    }

    async function login() {
      try {
        const res = await fetch(`${API_BASE}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(loginForm)
        });
        const data = await res.json();
        if (data.user) {
          user.value = data.user;
          loginDialogVisible.value = false;
          ElMessage.success('登录成功');
        } else {
          ElMessage.error(data.error || '登录失败');
        }
      } catch (e) {
        ElMessage.error('登录失败');
      }
    }

    async function register() {
      try {
        const res = await fetch(`${API_BASE}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(loginForm)
        });
        const data = await res.json();
        if (data.user) {
          user.value = data.user;
          loginDialogVisible.value = false;
          ElMessage.success('注册成功');
        } else {
          ElMessage.error(data.error || '注册失败');
        }
      } catch (e) {
        ElMessage.error('注册失败');
      }
    }

    // 发布配方
    function showPublishDialog() {
      publishForm.name = '';
      publishForm.description = '';
      publishDialogVisible.value = true;
    }

    async function publishRecipe() {
      const canvas = mainCanvas.value;
      const afterDataUrl = canvas.toDataURL('image/jpeg', 0.85);

      const recipe = {
        name: publishForm.name,
        description: publishForm.description,
        steps: recipeSteps.value,
        adjustments: adjustments.map(a => ({ key: a.key, value: a.value })),
        filter: currentFilter.value,
        cover_before: originalImageUrl.value,
        cover_after: afterDataUrl,
        features: { avgV: runDiagnosis()?.avgV, avgS: runDiagnosis()?.avgS, avgH: runDiagnosis()?.avgH }
      };

      try {
        const res = await fetch(`${API_BASE}/recipes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipe, username: user.value?.username })
        });
        const data = await res.json();
        if (data.id) {
          ElMessage.success('配方发布成功');
          publishDialogVisible.value = false;
          fetchCommunity();
        } else {
          ElMessage.error(data.error || '发布失败');
        }
      } catch (e) {
        ElMessage.error('发布失败');
      }
    }

    function showMyRecipes() {
      currentView.value = 'community';
    }

    onMounted(() => {
      fetchCommunity();
      window.addEventListener('resize', () => {
        if (imageLoaded.value && originalImage.value) {
          initCanvas(originalImage.value);
          applyAdjustments();
        }
      });
    });

    return {
      mainCanvas, compareCanvas, currentView, imageLoaded, originalImageUrl,
      viewMode, sliderPos, activeTab, showCompare,
      aiLoading, galleryLoading, user, loginDialogVisible, publishDialogVisible,
      previewDialogVisible, previewRecipeData, communitySearch,
      diagnosisResult, aiResults, galleryResults, communityRecipes,
      loginForm, publishForm, adjustments, presetFilters, history, historyIndex,
      currentFilter, recipeSteps,
      handleUpload, handleDrop, applyAdjustments, applyFilter,
      rotateLeft, rotateRight, flipH, flipV, startCrop,
      undo, redo, exportImage, copyRecipe,
      requestAI, renderPreview, applyAIRecipe,
      matchGallery, applyGalleryRecipe,
      fetchCommunity, searchCommunity, applyCommunityRecipe, previewRecipe,
      showLoginDialog, login, register,
      showPublishDialog, publishRecipe, showMyRecipes
    };
  }
});

app.use(ElementPlus);
app.mount('#app');