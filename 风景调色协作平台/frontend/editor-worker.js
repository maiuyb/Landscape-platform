/* The preview uses the exact same color pipeline as full-size export. */
importScripts('editor-tools.js','editor-core.js');
let source = null;
const geometryCache = new Map();
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'source') {
      source?.close(); source = data.image;
      geometryCache.clear();
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
    EditorCore.adjustPixels(pixels.data, data.state);
    cached.output.getContext('2d').putImageData(pixels, 0, 0);
    const edited = cached.output.transferToImageBitmap();
    const original = await createImageBitmap(cached.canvas);
    self.postMessage({ type: 'frame', id: data.id, revision: data.revision, maxSide: data.maxSide,
      requestedAt: data.requestedAt, geometry: data.state.geometry, edited, original,
      histogram: EditorCore.tools.histogram(pixels.data), renderMs: performance.now() - start }, [edited, original]);
  } catch (error) {
    self.postMessage({ type: 'error', message: error.message });
  }
};
