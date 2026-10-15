/* The preview uses the exact same color pipeline as full-size export. */
importScripts('editor-tools.js','editor-detail.js','editor-effects.js','editor-masks.js','editor-core.js');
let source = null;
let nativeGeometry = null;
const geometryCache = new Map();
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'source') {
      source?.close(); source = data.image;
      geometryCache.clear();
      nativeGeometry = null;
      self.postMessage({ type: 'ready' });
      return;
    }
    if (data.type !== 'render' || !source) return;
    const start = performance.now();
    const key = JSON.stringify([data.maxSide, data.state.geometry]);
    let cached = geometryCache.get(key);
    if (!cached) {
      const canvas = EditorCore.render(source, data.state, { maxSide: data.maxSide, color: false });
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      cached = { canvas, pixels, output: new OffscreenCanvas(canvas.width, canvas.height) };
      geometryCache.set(key, cached);
      while (geometryCache.size > 2) geometryCache.delete(geometryCache.keys().next().value);
    }
    const pixels = new ImageData(new Uint8ClampedArray(cached.pixels.data), cached.pixels.width, cached.pixels.height);
    EditorCore.processPixels(pixels.data, pixels.width, pixels.height, data.state, Math.min(1,data.maxSide/Math.max(source.width,source.height)),EditorCore.prepareContext(cached.canvas,data.state));
    cached.output.getContext('2d').putImageData(pixels, 0, 0);
    const edited = cached.output.transferToImageBitmap();
    const original = await createImageBitmap(cached.canvas);
    let detail = null;
    const transfers=[edited,original];
    let maskOverlay=null;
    const selected=data.state.masks.find(m=>m.id===data.maskOverlay);
    if(selected){const overlay=new OffscreenCanvas(pixels.width,pixels.height);overlay.getContext('2d').putImageData(new ImageData(EditorCore.masks.overlay(selected,pixels.width,pixels.height,cached.canvas.editorFrame),pixels.width,pixels.height),0,0);maskOverlay=overlay.transferToImageBitmap();transfers.push(maskOverlay);}
    if(data.inspector){
      const geometryKey=JSON.stringify(data.state.geometry);
      if(nativeGeometry?.key!==geometryKey)nativeGeometry={key:geometryKey,canvas:EditorCore.render(source,data.state,{maxSide:0,color:false})};
      const region=EditorCore.renderRegion(nativeGeometry.canvas,data.state,data.inspector);
      detail={left:region.left,top:region.top,edited:await createImageBitmap(region.edited),original:await createImageBitmap(region.original)};
      transfers.push(detail.edited,detail.original);
    }else nativeGeometry=null;
    self.postMessage({ type: 'frame', id: data.id, revision: data.revision, maxSide: data.maxSide,
      requestedAt: data.requestedAt, geometry: data.state.geometry, edited, original,
      detail, maskOverlay, histogram: EditorCore.tools.histogram(pixels.data), renderMs: performance.now() - start }, transfers);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
