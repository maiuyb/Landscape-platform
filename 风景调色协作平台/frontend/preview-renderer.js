(function (root) {
  class EditorPreview {
    static supported() {
      return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';
    }
    constructor(source, { onFrame, onError, onThumbnails }) {
      this.onFrame = onFrame; this.onError = onError;
      this.onThumbnails=onThumbnails;this.pendingThumbnails=null;
      this.ready = false; this.busy = false; this.pending = null; this.latestId = 0; this.disposed = false;
      this.worker = new Worker(new URL('editor-worker.js', document.baseURI));
      this.timer = setTimeout(() => this.fail(new Error('Preview initialization timed out')), 15000);
      this.worker.onerror = event => { event.preventDefault(); this.fail(new Error(event.message)); };
      this.worker.onmessage = ({ data }) => {
        if (this.disposed) { data.items?.forEach(i=>i.image.close());data.edited?.close(); data.original?.close(); data.maskOverlay?.close(); data.detail?.edited.close(); data.detail?.original.close(); return; }
        clearTimeout(this.timer);
        if (data.type === 'error') { this.fail(new Error(data.message)); return; }
        if (data.type === 'ready') this.ready = true;
        if(data.type==='thumbnails'){this.busy=false;try{this.onThumbnails?.(data);}finally{data.items.forEach(i=>i.image.close());}}
        if (data.type === 'frame') {
          this.busy = false;
          // The owner decides whether a completed interactive frame is still useful.
          try { this.onFrame(data); } finally { data.edited.close(); data.original.close(); data.maskOverlay?.close(); data.detail?.edited.close(); data.detail?.original.close(); }
        }
        this.pump();
      };
      Promise.resolve().then(() => createImageBitmap(source)).then(image => {
        if (this.disposed) { image.close(); return; }
        this.worker.postMessage({ type: 'source', image }, [image]);
      }).catch(error => this.fail(error));
    }
    request(state, { maxSide, revision, requestedAt, inspector = null, maskOverlay = null }) {
      this.pending = { type: 'render', id: ++this.latestId, state, maxSide, revision, requestedAt, inspector, maskOverlay };
      this.pump();
    }
    requestThumbnails(state,items,generation){this.pendingThumbnails={type:'thumbnails',state,items,generation};this.pump();}
    pump() {
      if (this.disposed || !this.ready || this.busy || (!this.pending&&!this.pendingThumbnails)) return;
      const request = this.pending||this.pendingThumbnails;if(this.pending)this.pending=null;else this.pendingThumbnails=null; this.busy = true;
      this.timer = setTimeout(() => this.fail(new Error('Preview rendering timed out')), 15000);
      try { this.worker.postMessage(request); } catch (error) { this.fail(error); }
    }
    fail(error) {
      if (this.disposed) return;
      this.dispose(); this.onError(error);
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true; this.pending = null;this.pendingThumbnails=null;
      clearTimeout(this.timer); this.worker.terminate();
    }
  }
  root.EditorPreview = EditorPreview;
})(globalThis);
