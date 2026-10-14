/* Shared, deterministic document model for preview, undo and full-size export. */
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.EditorCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const Tools = typeof module === 'object' && module.exports ? require('./editor-tools.js') : globalThis.EditorTools;
  const controls = [
    { key: 'exposure', label: '曝光', group: 'light', min: -3, max: 3, step: 0.05, unit: 'EV', hint: '整体曝光；正值更亮，负值更暗' },
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
      whiteBalance: { gains: [1,1,1], mode: 'original' }, hsl: Tools.createHSL(), curves: Tools.createCurves(), geometry: [], filter: null, filterStrength: 100 };
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
    if (![1, 2, 3].includes(version)) throw new Error('暂不支持此配方版本，请使用版本 1、2 或 3 的配方。');
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
        let value = clamp(p.value, version === 1 ? -100 : control.min, version === 1 ? 100 : control.max);
        if (version === 1 && step.type === 'exposure') { value /= 50; migrated = true; }
        if (version === 1 && step.type === 'highlights') { value = -value; migrated = true; }
        state.adjustments[step.type] = value;
        if (['highlights','shadows'].includes(step.type)) {
          state.legacyTone[step.type] = version === 1 || legacyTone?.[step.type] === true;
          if (version === 1) migrated = true;
        }
      } else if (version === 3 && step?.type === 'white-balance' && Array.isArray(p.gains) && p.gains.length === 3 && p.gains.every(v=>Number.isFinite(v)&&v>=.25&&v<=4) && ['original','auto','sample','custom'].includes(p.mode)) {
        state.whiteBalance = { gains: p.gains.slice(), mode: p.mode };
      } else if (version === 3 && step?.type === 'hsl' && Tools.bands.some(b=>b.key===p.band) && ['hue','saturation','luminance'].every(k=>Number.isFinite(p[k]))) {
        state.hsl[p.band] = Object.fromEntries(['hue','saturation','luminance'].map(k=>[k,clamp(p[k],-100,100)]));
      } else if (version === 3 && step?.type === 'curve' && Tools.channels.includes(p.channel) && Tools.validCurve(p.points)) {
        state.curves[p.channel] = clone(p.points);
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
    if (migrated) warnings.unshift('已兼容旧配方：保留旧版明暗效果，并按原语义读取曝光和高光。');
    return { state, warnings };
  }
  function toRecipe(state) {
    return {
      version: 3,
      rendering: { legacyTone: clone(state.legacyTone) },
      steps: [
        ...clone(state.geometry),
        ...controls.map(c => ({ type: c.key, params: { value: state.adjustments[c.key] } })),
        { type: 'white-balance', params: clone(state.whiteBalance) },
        ...Tools.bands.map(b=>({type:'hsl',params:{band:b.key,...state.hsl[b.key]}})),
        ...Tools.channels.map(channel=>({type:'curve',params:{channel,points:clone(state.curves[channel])}})),
        { type: 'filter', params: { name: state.filter, strength: state.filterStrength } }
      ]
    };
  }
  function rotationSize(width, height, angle) {
    const rad = angle * Math.PI / 180;
    return {
      width: Math.max(1, Math.ceil(width * Math.abs(Math.cos(rad)) + height * Math.abs(Math.sin(rad)) - 1e-8)),
      height: Math.max(1, Math.ceil(width * Math.abs(Math.sin(rad)) + height * Math.abs(Math.cos(rad)) - 1e-8))
    };
  }
  function outputSize(width, height, geometry) {
    for (const step of geometry) {
      if (step.type === 'rotate') ({ width, height } = rotationSize(width, height, step.params.angle));
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
    const gains = state.whiteBalance.gains.slice(), hsl = Tools.compileHSL(clone(state.hsl)), curves = Tools.compileCurves(clone(state.curves));
    const hslScratch = new Float64Array(3), hasCurves = Object.values(curves).some(Boolean);
    if (controls.every(c => a[c.key] === 0) && gains.every(v=>v===1) && !hsl && !hasCurves && (!filter || strength === 0)) return data;
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
  function render(image, state, { maxSide = 1200, scale = 1, color = true } = {}) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const ratio = maxSide ? Math.min(1, maxSide / Math.max(width, height)) : scale;
    let canvas = makeCanvas(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const step of state.geometry) {
      const p = step.params;
      let next;
      if (step.type === 'rotate') {
        const size = rotationSize(canvas.width, canvas.height, p.angle);
        next = makeCanvas(size.width, size.height);
        const ctx = next.getContext('2d');
        ctx.translate(next.width / 2, next.height / 2);
        ctx.rotate(p.angle * Math.PI / 180);
        ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
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
    if (color) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      adjustPixels(pixels.data, state);
      ctx.putImageData(pixels, 0, 0);
    }
    return canvas;
  }
  return { controls, filters, clone, clamp, createState, createHistory, recipeState, toRecipe, outputSize, adjustPixels, render, tools: Tools };
});
