/* Viewport-prioritized thumbnail loading. Full-size photos are opened explicitly. */
(() => {
  const limit = 4, margin = 320, images = new Map(), active = new Set();
  let frame = 0;
  const schedule = () => { if (!frame) frame = requestAnimationFrame(pump); };
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const item = images.get(entry.target);
      if (item) item.near = entry.isIntersecting;
    }
    schedule();
  }, {rootMargin: `${margin}px 0px`});

  function register(root) {
    const found = root.matches?.('img[data-thumb-src]') ? [root] : [];
    found.push(...(root.querySelectorAll?.('img[data-thumb-src]') || []));
    for (const img of found) {
      if (images.has(img)) continue;
      images.set(img, {near: false, tries: 0, retryAt: 0});
      img.dataset.imageStatus = 'pending';
      observer.observe(img);
    }
    schedule();
  }

  function pump() {
    frame = 0;
    for (const [img] of images) {
      if (img.isConnected) continue;
      observer.unobserve(img);images.delete(img);active.delete(img);
      img.onload = img.onerror = null;
      img.removeAttribute('srcset');img.removeAttribute('src');
    }
    const now = Date.now(), height = innerHeight;
    const pending = [...images].filter(([img, item]) => {
      const rect = img.getBoundingClientRect();
      return item.near && rect.width > 0 && rect.top < height + margin && rect.bottom > -margin &&
        !active.has(img) && item.retryAt <= now &&
        (item.upgrade || ['pending', 'retrying'].includes(img.dataset.imageStatus));
    });
    const rank = img => {
      const rect = img.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < height ? rect.top : height + Math.max(0, rect.top - height, -rect.bottom);
    };
    pending.sort(([a], [b]) => rank(a) - rank(b));
    for (const [img, item] of pending) {
      if (active.size >= limit) break;
      active.add(img);item.tries++;
      if (!item.upgrade) img.dataset.imageStatus = 'loading';
      let timeout;
      const finish = success => {
        clearTimeout(timeout);
        active.delete(img);img.onload = img.onerror = null;
        if (!img.isConnected) { images.delete(img);schedule();return; }
        if (success) {
          img.dataset.imageStatus = 'ready';observer.unobserve(img);images.delete(img);
        } else if (item.tries < 3) {
          const delay = item.tries * 500;
          item.retryAt = Date.now() + delay;img.dataset.imageStatus = 'retrying';
          img.removeAttribute('srcset');img.removeAttribute('src');
          setTimeout(schedule, delay + 10);
        } else {
          img.dataset.imageStatus = 'failed';img.alt = '图片暂不可用';
          img.removeAttribute('srcset');img.removeAttribute('src');
          img.classList.add('image-unavailable');observer.unobserve(img);images.delete(img);
        }
        schedule();
      };
      img.onload = () => finish(img.naturalWidth > 0);
      img.onerror = () => finish(false);
      timeout = setTimeout(() => finish(false), 15000);
      // Measure the actual column width, including the user's column preference.
      img.sizes = `${Math.max(1, Math.ceil(img.getBoundingClientRect().width))}px`;
      img.loading = 'eager';
      img.fetchPriority = img.getBoundingClientRect().top < height ? 'high' : 'low';
      if (img.dataset.thumbSrcset) img.srcset = img.dataset.thumbSrcset;
      img.src = img.dataset.thumbSrc;
    }
  }

  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) register(node);
    schedule();
  }).observe(document.body, {childList: true, subtree: true});
  addEventListener('scroll', schedule, {passive: true});
  addEventListener('resize', () => {
    for (const img of document.querySelectorAll('img[data-thumb-srcset][data-image-status="ready"]')) {
      const required = Math.min(1200, Math.ceil(img.getBoundingClientRect().width * devicePixelRatio));
      if (required <= img.naturalWidth || images.has(img)) continue;
      // Keep the existing picture visible while a larger variant gets its queue slot.
      images.set(img, {near: false, tries: 0, retryAt: 0, upgrade: true});
      observer.observe(img);
    }
    schedule();
  }, {passive: true});
  register(document.body);
})();
