'use strict';

/* 与主编辑器共用的会话键；社区 -> 编辑器 / 编辑器 -> 社区的交接键 */
const TOKEN_KEY = 'landscape:token';
const USER_KEY = 'landscape:user';
const LEGACY_TOKEN_KEY = 'cd_token';
const LEGACY_USER_KEY = 'cd_user';
const SHARE_KEY = 'landscape:share-recipe';        // 编辑器写入，社区发布时读取（同源）
const EDITOR_URL = window.EDITOR_URL || '';        // 独立部署时仅用于打开编辑器，不自动传照片
const APP_PREFIX = new URL('../', location.href).pathname.replace(/\/$/, '');

const state = {
  view: 'community',
  search: '',
  category: '',
  sort: 'favorites',
  page: 1,
  pageSize: 12,
  total: 0,
  hasMore: false,
  loading: false,
  token: readToken(),
  user: readUser(),
  authMode: 'login',
  pairing: 'manual',
};

const DEMO = { username: 'demo', password: 'demo1234' };
const $ = (s) => document.querySelector(s);

function readToken() { return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || ''; }
function readUser() { try { return JSON.parse(localStorage.getItem(USER_KEY) || localStorage.getItem(LEGACY_USER_KEY) || 'null'); } catch (e) { return null; } }
function writeSession(token, user) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); }
function clearSession() { [TOKEN_KEY, USER_KEY, LEGACY_TOKEN_KEY, LEGACY_USER_KEY].forEach((k) => localStorage.removeItem(k)); }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 卡片/推荐/记录使用按需缩略图；详情仍用原图。
function thumbUrl(url, width = 800) {
  const name = localUploadName(url);
  return name ? `${APP_PREFIX}/api/thumb/${name}?w=${width}` : String(url || '');
}

function thumbSrcset(url) {
  const name = localUploadName(url);
  return name ? [200, 400, 800, 1200].map((w) => `${APP_PREFIX}/api/thumb/${name}?w=${w} ${w}w`).join(', ') : '';
}

function localUploadName(url) {
  const s = String(url || '');
  for (const prefix of [APP_PREFIX + '/uploads/', '/uploads/']) {
    if (s.startsWith(prefix)) {
      const name = s.slice(prefix.length);
      return name.length <= 180 && /^[a-z0-9][a-z0-9._-]*\.(jpg|jpeg|png|webp)$/i.test(name) ? name : '';
    }
  }
  return '';
}
function uploadOriginalUrl(url) {
  const name = localUploadName(url);
  return name ? `${APP_PREFIX}/uploads/${name}` : String(url || '');
}
// Image attributes can retry the original once; a failed fallback remains an honest placeholder.
document.addEventListener('error', event => {
  const img = event.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.originalSrc) return;
  img.removeAttribute('srcset');
  if (!img.dataset.usedOriginal) {
    img.dataset.usedOriginal = '1';
    img.src = img.dataset.originalSrc;
  } else {
    img.alt = '图片暂不可用';
    img.classList.add('image-unavailable');
  }
}, true);

async function api(path, { method = 'GET', body = null, auth = false, form = null } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth && state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch(path, { method, headers, body: form ? form : (body ? JSON.stringify(body) : null) });
  let data = {};
  try { data = await res.json(); } catch (e) { /* ignore */ }
  return { ok: res.ok, status: res.status, data };
}

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* try the HTTP-compatible path */ }
  }
  const ta = document.createElement('textarea');
  const previous = document.activeElement;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  ta.value = text; document.body.appendChild(ta); ta.select();
  try {
    if (!document.execCommand('copy')) throw Error('剪贴板不可用');
  } finally { ta.remove(); previous?.focus({preventScroll:true}); }
}

/* ---------------- 编辑器交接 ----------------
 * 已交付协议（landscape:connect/ready、landscape:share、landscape:preview）
 * 由 community-bridge.js 在组合应用中处理；社区原生只保留页面逻辑，
 * 不再另起一套消息协议，避免形成两套。
 */

/* ---------------- 认证 ---------------- */
function renderAuth() {
  const area = $('#authArea');
  if (state.user) {
    area.innerHTML = `<span class="chip">@ ${esc(state.user.username)}</span>` +
      `<button class="btn ghost" id="logoutBtn">退出</button>`;
    $('#logoutBtn').onclick = async () => {
      await api('/api/auth/logout', { method: 'POST', auth: true });
      state.token = ''; state.user = null; clearSession();
      renderAuth(); switchView('community'); toast('已退出登录');
    };
  } else {
    area.innerHTML = `<button class="btn ghost" id="loginBtn">登录</button>`;
    $('#loginBtn').onclick = () => openAuth('login');
  }
}

function openAuth(mode) {
  state.authMode = mode || 'login';
  $('#authTitle').textContent = state.authMode === 'login' ? '登录' : '注册';
  $('#authSubmit').textContent = state.authMode === 'login' ? '登录' : '注册';
  $('#authToggle').textContent = state.authMode === 'login' ? '没有账号？去注册' : '已有账号？去登录';
  if (state.authMode === 'login') {
    $('#authUser').value = DEMO.username;
    $('#authPass').value = DEMO.password;
  } else {
    $('#authUser').value = ''; $('#authPass').value = '';
  }
  $('#authError').textContent = '';
  $('#authModal').classList.add('open');
}

async function submitAuth() {
  const username = $('#authUser').value.trim();
  const password = $('#authPass').value.trim();
  const path = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
  const r = await api(path, { method: 'POST', body: { username, password } });
  if (!r.ok) { $('#authError').textContent = r.data.error || '操作失败'; return; }
  state.token = r.data.token; state.user = r.data.user;
  writeSession(state.token, state.user);
  $('#authModal').classList.remove('open');
  renderAuth();
  toast(state.authMode === 'login' ? '登录成功' : '注册成功');
  loadStats(); loadRecommend(); reloadCurrentView();
}

/* ---------------- 推荐 & 统计 ---------------- */
async function loadStats() {
  const a = await api('/api/recipes?page_size=1');
  const b = await api('/api/recipes/categories');
  const total = a.data.total || 0;
  const cats = (b.data.categories || []).length;
  $('#heroStats').innerHTML =
    `<div class="stat"><b>${total}</b><span>社区作品</span></div>` +
    `<div class="stat"><b>${cats}</b><span>风格分类</span></div>`;
}

async function loadRecommend() {
  const r = await api('/api/recipes/recommend', { auth: true });   // 摘要不含 steps
  const box = $('#recommend');
  const list = r.data.recipes || [];
  box.innerHTML = list.map((rec, i) => `
    <div class="mini" data-id="${rec.id}">
      ${i < 3 ? `<div class="rank">TOP${i + 1}</div>` : ''}
      <img data-original-src="${esc(uploadOriginalUrl(rec.cover_after || rec.cover_before))}" src="${esc(thumbUrl(rec.cover_after || rec.cover_before, 400))}" srcset="${esc(thumbSrcset(rec.cover_after || rec.cover_before))}" sizes="(max-width: 620px) 50vw, (max-width: 900px) 33vw, 16vw" width="400" height="533" alt="${esc(rec.name)}" loading="lazy" decoding="async">
      <div class="cap">${esc(rec.name)}<br><span class="muted">★ ${rec.favorite_count}</span></div>
    </div>`).join('') || '<div class="muted">暂无推荐</div>';
  box.querySelectorAll('.mini').forEach((m) => { m.onclick = () => openDetail(+m.dataset.id); });
}

/* ---------------- 分类 & 列表 ---------------- */
async function loadCategories() {
  const r = await api('/api/recipes/categories');
  const sel = $('#category');
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部分类</option>' +
    (r.data.categories || []).map((c) =>
      `<option value="${esc(c.name)}">${esc(c.name)} (${c.count})</option>`).join('');
  sel.value = cur;
}

function listEndpoint() {
  const p = new URLSearchParams({ page: state.page, page_size: state.pageSize });
  if (state.view === 'mine') return '/api/me/recipes?' + p.toString();
  if (state.view === 'favorites') return '/api/me/favorites?' + p.toString();
  p.set('sort', state.sort);
  if (state.search) p.set('search', state.search);
  if (state.category) p.set('category', state.category);
  return '/api/recipes?' + p.toString();
}

async function loadRecipes(reset) {
  if (state.loading) return;
  if ((state.view === 'mine' || state.view === 'favorites') && !state.user) {
    toast('请先登录'); openAuth('login'); return;
  }
  // 搜索时隐藏「为你推荐」，把「全部作品」区域顶上来。
  const recommendSection = $('#recommendSection');
  if (recommendSection) recommendSection.style.display = (state.view === 'community' && state.search) ? 'none' : '';
  state.loading = true;
  if (reset) { state.page = 1; $('#grid').innerHTML = ''; }
  const r = await api(listEndpoint(), { auth: true });
  state.loading = false;
  if (!r.ok) { toast(r.data.error || '加载失败'); return; }
  state.total = r.data.total || 0;
  state.hasMore = !!r.data.has_more;
  (r.data.recipes || []).forEach(appendCard);
  $('#empty').style.display = (state.total === 0) ? 'block' : 'none';
  $('#empty').textContent = state.view === 'mine' ? '还没有上传作品'
    : state.view === 'favorites' ? '还没有收藏作品' : '没有更多内容了';
  $('#loadMore').style.display = state.hasMore ? 'inline-block' : 'none';
  if (reset && state.view === 'community' && state.search) {
    requestAnimationFrame(() => document.querySelector('.toolbar')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
}

function appendCard(rec) {
  const isOwn = !!(state.user && rec.author_id === state.user.id);
  const isCommunity = state.view === 'community';
  const isMine = state.view === 'mine';
  const count = Number(rec.favorite_count) || 0;
  const star = rec.is_favorited ? '★' : '☆';
  const staticPill = `<span class="fav static ${rec.is_favorited ? 'on' : ''}">${star} <b>${count}</b></span>`;
  const favButton = `<button class="fav ${rec.is_favorited ? 'on' : ''}">${star} <b>${count}</b></button>`;

  let foot = '';
  let footClass = 'card-foot';
  if (isMine) {
    // 我的上传：收藏数放卡片左下角，删除在右下角，与全部作品的右下角对称。
    foot = `${staticPill}<button class="btn danger card-del">删除</button>`;
    footClass = 'card-foot split';
  } else if (isOwn) {
    // 全部作品里自己的作品也展示收藏数，外观与别人一致。
    foot = staticPill;
  } else {
    foot = favButton;
  }

  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-cover" data-id="${rec.id}">
      <img data-original-src="${esc(uploadOriginalUrl(rec.cover_after || rec.cover_before))}" src="${esc(thumbUrl(rec.cover_after || rec.cover_before, 800))}" srcset="${esc(thumbSrcset(rec.cover_after || rec.cover_before))}" sizes="(max-width: 480px) 100vw, (max-width: 900px) 33vw, 25vw" width="400" height="260" alt="${esc(rec.name)}" loading="lazy" decoding="async">
      ${rec.category ? `<span class="badge">${esc(rec.category)}</span>` : ''}
    </div>
    <div class="card-body">
      <div class="card-title" data-id="${rec.id}">${esc(rec.name)}</div>
      <div class="card-desc">${esc(rec.description || '—')}</div>
      <div class="card-meta">
        <span>@ ${esc(rec.author)}</span>
        ${(rec.tags || []).slice(0, 3).map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}
      </div>
      <div class="${footClass}">${foot}</div>
    </div>`;
  // 整张卡片可点开详情；按钮/链接等交互元素保持自己的行为（点赞、删除等）。
  card.addEventListener('click', (event) => {
    if (event.target.closest('button, a, input, select, textarea, label')) return;
    openDetail(rec.id);
  });

  if (isMine) {
    const del = card.querySelector('.card-del');
    if (del) del.onclick = () => deleteOwnRecipe(rec);
  } else if (!isOwn) {
    const fav = card.querySelector('.fav');
    if (fav) fav.onclick = (e) => toggleFavorite(rec, e.currentTarget);
  }
  $('#grid').appendChild(card);
}

async function deleteOwnRecipe(rec) {
  if (!confirm(`确定删除「${rec.name}」？删除后 7 天内可在“上传记录”里找回。`)) return;
  const r = await api('/api/recipes/' + rec.id, { method: 'DELETE', auth: true });
  if (!r.ok) { toast(r.data.error || '删除失败'); return; }
  toast('已删除，7 天内可找回');
  loadStats(); loadRecommend();
  if (state.view === 'records') loadRecords(true); else loadRecipes(true);
}

async function toggleFavorite(rec, btn) {
  if (!state.user) { toast('请先登录'); openAuth('login'); return; }
  const on = btn.classList.contains('on');
  const r = await api(`/api/recipes/${rec.id}/favorite`, { method: on ? 'DELETE' : 'POST', auth: true });
  if (!r.ok) { toast(r.data.error || '操作失败'); return; }
  toast(r.data.favorited ? '已收藏' : '已取消收藏');
  loadRecommend();
  loadRecipes(true);
}

/* ---------------- 详情 ---------------- */
function previewImage(rec) {
  const before = rec.cover_before || '';
  const after = rec.cover_after || '';
  const hasPair = before && after && before !== after;
  if (!hasPair) {
    return {
      pair: false,
      html: `<div class="detail-imgs single"><figure><img class="detail-img" src="${esc(uploadOriginalUrl(after || before))}" alt="${esc(rec.name)}" decoding="async">
        <figcaption class="muted">单图 · 未提供前后对比</figcaption></figure></div>`,
    };
  }
  const verified = rec.pairing === 'editor';
  const capA = verified ? '调色前' : '图 A（人工上传）';
  const capB = verified ? '调色后' : '图 B（人工上传）';
  const note = verified
    ? ''
    : '<div class="hint">人工上传的前后图 · 未验证为同一照片/同一构图，仅作参考</div>';
  return {
    pair: true,
    html: `<div class="detail-imgs pair">
        <figure><img class="detail-img" src="${esc(uploadOriginalUrl(before))}" alt="${esc(capA)}" decoding="async"><figcaption class="muted">${esc(capA)}</figcaption></figure>
        <figure><img class="detail-img" src="${esc(uploadOriginalUrl(after))}" alt="${esc(capB)}" decoding="async"><figcaption class="muted">${esc(capB)}</figcaption></figure>
      </div>${note}`,
  };
}

const lightboxState = {
  scale: 1, fitW: 0, fitH: 0,
  pointer: null, start: null, moved: false, suppressClickUntil: 0
};
const lightboxEl = (id) => document.getElementById(id);

function lightboxCanPan() {
  const box = lightboxEl('imageLightbox');
  const vp = lightboxEl('lightboxViewport');
  return !!(box && !box.hidden && vp &&
    (vp.scrollWidth > vp.clientWidth + 1 || vp.scrollHeight > vp.clientHeight + 1));
}

function syncLightboxPanCursor() {
  const vp = lightboxEl('lightboxViewport');
  if (vp) vp.classList.toggle('can-pan', lightboxCanPan());
}

function setLightboxZoomLabel() {
  const label = lightboxEl('lightboxZoom');
  if (label) label.textContent = lightboxState.scale <= 1.001 ? '适配' : `${lightboxState.scale.toFixed(1)}×`;
}

function measureLightboxFit() {
  const img = lightboxEl('lightboxImage');
  if (!img || !img.naturalWidth) return;
  const rect = img.getBoundingClientRect();
  if (rect.width && rect.height) {
    lightboxState.fitW = rect.width;
    lightboxState.fitH = rect.height;
  }
  setLightboxZoomLabel();
  syncLightboxPanCursor();
}

function resetLightboxZoom() {
  const img = lightboxEl('lightboxImage');
  const vp = lightboxEl('lightboxViewport');
  lightboxState.scale = 1;
  if (img) {
    img.style.width = '';
    img.style.height = '';
    img.style.maxWidth = '';
    img.style.maxHeight = '';
  }
  if (vp) { vp.scrollLeft = 0; vp.scrollTop = 0; }
  setLightboxZoomLabel();
  requestAnimationFrame(measureLightboxFit);
}

function applyLightboxZoom(nextScale, clientX, clientY) {
  const img = lightboxEl('lightboxImage');
  const vp = lightboxEl('lightboxViewport');
  if (!img || !vp) return;
  if (!lightboxState.fitW) measureLightboxFit();
  if (!lightboxState.fitW) return;
  const scale = Math.max(1, Math.min(6, nextScale));
  if (Math.abs(scale - lightboxState.scale) < 0.001) return;
  if (scale <= 1.001) { resetLightboxZoom(); return; }
  const before = img.getBoundingClientRect();
  const rx = clientX == null ? 0.5 : Math.max(0, Math.min(1, (clientX - before.left) / before.width));
  const ry = clientY == null ? 0.5 : Math.max(0, Math.min(1, (clientY - before.top) / before.height));
  lightboxState.scale = scale;
  img.style.maxWidth = 'none';
  img.style.maxHeight = 'none';
  img.style.width = `${Math.round(lightboxState.fitW * scale)}px`;
  img.style.height = `${Math.round(lightboxState.fitH * scale)}px`;
  setLightboxZoomLabel();
  requestAnimationFrame(() => {
    const after = img.getBoundingClientRect();
    if (clientX == null) {
      vp.scrollLeft = Math.max(0, (vp.scrollWidth - vp.clientWidth) / 2);
      vp.scrollTop = Math.max(0, (vp.scrollHeight - vp.clientHeight) / 2);
    } else {
      vp.scrollLeft += after.left + rx * after.width - clientX;
      vp.scrollTop += after.top + ry * after.height - clientY;
    }
    syncLightboxPanCursor();
  });
}

function openLightbox(src, alt) {
  const box = lightboxEl('imageLightbox');
  const img = lightboxEl('lightboxImage');
  if (!box || !img || !src) return;
  box.hidden = false;
  document.body.classList.add('lightbox-open');
  lightboxState.scale = 1;
  lightboxState.fitW = 0;
  lightboxState.fitH = 0;
  img.style.width = '';
  img.style.height = '';
  img.style.maxWidth = '';
  img.style.maxHeight = '';
  img.alt = alt || '';
  img.src = src;
  setLightboxZoomLabel();
  const done = () => requestAnimationFrame(measureLightboxFit);
  if (img.complete && img.naturalWidth) done();
  else img.addEventListener('load', done, { once: true });
  lightboxEl('lightboxClose')?.focus();
}

function closeLightbox() {
  const box = lightboxEl('imageLightbox');
  const img = lightboxEl('lightboxImage');
  const vp = lightboxEl('lightboxViewport');
  if (!box || box.hidden) return;
  box.hidden = true;
  if (img) {
    img.removeAttribute('src');
    img.style.width = '';
    img.style.height = '';
    img.style.maxWidth = '';
    img.style.maxHeight = '';
  }
  if (vp) {
    vp.classList.remove('panning', 'can-pan');
    vp.scrollLeft = 0;
    vp.scrollTop = 0;
  }
  lightboxState.scale = 1;
  lightboxState.fitW = 0;
  lightboxState.fitH = 0;
  setLightboxZoomLabel();
  document.body.classList.remove('lightbox-open');
}

function lightboxPointerDown(event) {
  if (event.button !== 0 || !lightboxCanPan()) return;
  const vp = lightboxEl('lightboxViewport');
  lightboxState.pointer = event.pointerId;
  lightboxState.start = { x: event.clientX, y: event.clientY, left: vp.scrollLeft, top: vp.scrollTop };
  lightboxState.moved = false;
  vp.classList.add('panning');
  vp.setPointerCapture?.(event.pointerId);
  event.preventDefault();
}

function lightboxPointerMove(event) {
  if (lightboxState.pointer !== event.pointerId || !lightboxState.start) return;
  const vp = lightboxEl('lightboxViewport');
  const dx = event.clientX - lightboxState.start.x;
  const dy = event.clientY - lightboxState.start.y;
  if (!lightboxState.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
  lightboxState.moved = true;
  vp.scrollLeft = lightboxState.start.left - dx;
  vp.scrollTop = lightboxState.start.top - dy;
  event.preventDefault();
}

function lightboxPointerUp(event) {
  if (lightboxState.pointer !== event.pointerId) return;
  const vp = lightboxEl('lightboxViewport');
  if (lightboxState.moved) lightboxState.suppressClickUntil = performance.now() + 350;
  lightboxState.pointer = null;
  lightboxState.start = null;
  vp?.classList.remove('panning');
  if (vp?.hasPointerCapture?.(event.pointerId)) vp.releasePointerCapture(event.pointerId);
}

const lightboxViewportEl = lightboxEl('lightboxViewport');
if (lightboxViewportEl) {
  lightboxViewportEl.addEventListener('wheel', (event) => {
    const box = lightboxEl('imageLightbox');
    if (!box || box.hidden) return;
    event.preventDefault();
    const delta = Math.max(-100, Math.min(100, event.deltaY));
    applyLightboxZoom(lightboxState.scale * Math.exp(-delta * 0.002), event.clientX, event.clientY);
  }, { passive: false });
  lightboxViewportEl.addEventListener('dblclick', (event) => {
    event.preventDefault();
    resetLightboxZoom();
  });
  lightboxViewportEl.addEventListener('pointerdown', lightboxPointerDown);
  lightboxViewportEl.addEventListener('pointermove', lightboxPointerMove);
  lightboxViewportEl.addEventListener('pointerup', lightboxPointerUp);
  lightboxViewportEl.addEventListener('pointercancel', lightboxPointerUp);
  lightboxViewportEl.addEventListener('lostpointercapture', lightboxPointerUp);
  lightboxViewportEl.addEventListener('click', (event) => {
    if (performance.now() < lightboxState.suppressClickUntil) return;
    if (event.target.closest('#lightboxImage')) return;
    closeLightbox();
  });
}
lightboxEl('lightboxClose')?.addEventListener('click', closeLightbox);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeLightbox();
});
window.addEventListener('resize', () => {
  const box = lightboxEl('imageLightbox');
  if (box && !box.hidden) resetLightboxZoom();
});

async function openDetail(id) {
  const r = await api('/api/recipes/' + id, { auth: true });   // 详情含完整配方
  if (!r.ok) { toast('作品不存在'); return; }
  const rec = r.data.recipe;
  const pv = previewImage(rec);
  const steps = (rec.steps || []).map((s) => {
    const p = s.params || {};
    const val = p.value != null ? `${p.value > 0 ? '+' : ''}${p.value}` : (p.name || JSON.stringify(p));
    return `<li><span>${esc(s.type)}</span><span>${esc(val)}</span></li>`;
  }).join('') || '<li><span>无可执行操作</span><span></span></li>';
  const owner = state.user && rec.author_id === state.user.id;
  const favBtn = owner
    ? `<span class="detail-fav-count">★ 收藏 ${rec.favorite_count || 0}</span>`
    : `<button class="btn ${rec.is_favorited ? 'ghost' : ''}" id="dFav">${rec.is_favorited ? '★ 已收藏' : '☆ 收藏'}（${rec.favorite_count}）</button>`;
  const delBtn = owner ? '<button class="btn danger" id="dDel">删除作品</button>' : '';

  $('#detailBody').innerHTML = `
    <h3>${esc(rec.name)}</h3>
    <div class="detail-photos">${pv.html}</div>
    <div class="detail-info">
      <div class="card-meta"><span>@ ${esc(rec.author)}</span>${rec.category ? `<span class="chip">${esc(rec.category)}</span>` : ''}</div>
      <div class="detail-tags">${(rec.tags || []).map((t) => `<span class="chip">#${esc(t)}</span>`).join(' ')}</div>
      <p class="desc">${esc(rec.description || '（暂无说明）')}</p>
      <button class="recipe-toggle" id="recipeToggle" type="button" aria-expanded="false" aria-controls="recipeBody">
        <span>调色配方</span>
        <svg class="recipe-caret" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5"/></svg>
      </button>
      <div class="recipe-body" id="recipeBody" hidden>
        <ul class="steps-list">${steps}</ul>
      </div>
      <div class="modal-actions" style="margin-top:16px">
        <button class="btn primary" id="dPreview">在我的照片上预览</button>
        <button class="btn ghost" id="dCopy">复制配方</button>
        ${favBtn}${delBtn}
      </div>
      <div class="hint">预览会把完整配方送到编辑器，套用在**你自己的照片**上；不会替换你的原图。</div>
    </div>`;

  $('#detailBody').querySelectorAll('.detail-img').forEach((img) => {
    img.addEventListener('click', (event) => {
      event.stopPropagation();
      openLightbox(img.currentSrc || img.src, img.alt);
    });
  });
  $('#dPreview').onclick = () => previewInEditor(rec.id);
  $('#dCopy').onclick = () => {
    const recipe = { version: rec.version || 1 };
    if (rec.rendering != null) recipe.rendering = rec.rendering;
    recipe.steps = rec.steps || [];
    copyText(JSON.stringify(recipe, null, 2)).then(() => toast('已复制配方'), () => toast('复制失败，请展开“调色配方”手动复制'));
  };
  const recipeToggle = $('#recipeToggle');
  if (recipeToggle) {
    recipeToggle.onclick = () => {
      const body = $('#recipeBody');
      const open = recipeToggle.getAttribute('aria-expanded') === 'true';
      recipeToggle.setAttribute('aria-expanded', String(!open));
      body.hidden = open;
    };
  }
  if ($('#dFav')) {
    $('#dFav').onclick = async () => {
      if (!state.user) { toast('请先登录'); openAuth('login'); return; }
      const r2 = await api(`/api/recipes/${rec.id}/favorite`, { method: rec.is_favorited ? 'DELETE' : 'POST', auth: true });
      if (r2.ok) { toast(r2.data.favorited ? '已收藏' : '已取消收藏'); openDetail(rec.id); loadRecommend(); loadRecipes(true); }
    };
  }
  if (owner) {
    $('#dDel').onclick = async () => {
      if (!confirm('确定删除这条作品？')) return;
      const r2 = await api('/api/recipes/' + rec.id, { method: 'DELETE', auth: true });
      if (r2.ok) { $('#detailModal').classList.remove('open'); toast('已删除'); loadStats(); loadRecommend(); loadRecipes(true); }
      else toast(r2.data.error || '删除失败');
    };
  }
  $('#detailModal').classList.add('open');
}

/* 预览：同源组合由 community-bridge.js 接管；独立部署只复制配方，不假装能传照片 */
async function previewInEditor(id) {
  const r = await api('/api/recipes/' + id, { auth: true });
  if (!r.ok) { toast('作品不存在'); return; }
  const rec = r.data.recipe;
  if (!Array.isArray(rec.steps) || !rec.steps.length) { toast('该作品没有可预览的配方'); return; }
  const recipe = { version: rec.version || 1 };
  if (rec.rendering != null) recipe.rendering = rec.rendering;
  recipe.steps = rec.steps;

  copyText(JSON.stringify(recipe, null, 2)).then(() => {
    if (EDITOR_URL) {
      try { window.open(EDITOR_URL, '_blank', 'noopener'); } catch { /* popup policy may require a manual visit */ }
      toast('已复制配方并请求打开编辑器；若未打开请手动访问。独立部署不自动传递照片/历史，请粘贴配方套用');
    } else {
      toast('已复制配方；独立部署无法自动传递照片/历史，请在编辑器粘贴套用');
    }
  }, () => toast('复制失败，请展开“调色配方”手动复制'));
}

/* ---------------- 发布 ---------------- */
async function uploadFile(input) {
  const f = input.files[0];
  if (!f) return '';
  const fd = new FormData();
  fd.append('file', f);
  const r = await api('/api/upload', { method: 'POST', form: fd });
  if (!r.ok) throw new Error(r.data.error || '图片上传失败');
  return r.data.url;
}

function imageSize(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

async function fileSha256(file) {
  if (!(window.crypto && window.crypto.subtle) || typeof file.arrayBuffer !== 'function') return null;
  try {
    const buf = await file.arrayBuffer();
    const digest = await window.crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return null; }
}

async function sameContent(a, b) {
  const [x, y] = await Promise.all([fileSha256(a), fileSha256(b)]);
  return !!(x && y && x === y);
}

function parseRecipeJson(text) {
  if (!text || !text.trim()) return { error: '请先「从编辑器读取」或粘贴配方 JSON' };
  let data;
  try { data = JSON.parse(text); } catch (e) { return { error: '配方 JSON 无法解析' }; }
  const recipe = (data && typeof data === 'object' && data.recipe && typeof data.recipe === 'object') ? data.recipe : data;
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) return { error: '配方格式无效' };
  const version = recipe.version == null ? 1 : recipe.version;
  if (![1, 2, 3, 4, 5, 6, 7, 8].includes(version)) return { error: '暂不支持的配方版本：' + version };
  if (!Array.isArray(recipe.steps)) return { error: '配方缺少 steps 数组' };
  return { recipe };
}

function updateRecipeStatus() {
  const text = $('#pRecipeJson').value;
  const parsed = parseRecipeJson(text);
  const status = $('#pRecipeStatus');
  if (parsed.error) { status.textContent = text.trim() ? ('⚠ ' + parsed.error) : '尚未载入配方。'; return; }
  const r = parsed.recipe;
  status.textContent = `✓ 已就绪：版本 ${r.version || 1}，共 ${r.steps.length} 个操作`;
}

function loadHandoff() {
  const raw = localStorage.getItem(SHARE_KEY);
  if (!raw) { toast('没有可读取的编辑器配方；独立部署请直接粘贴配方 JSON'); return; }
  $('#pRecipeJson').value = raw;
  state.pairing = 'editor';   // 来自编辑器分享：受控配对
  try {
    const data = JSON.parse(raw);
    const recipe = (data.recipe && typeof data.recipe === 'object') ? data.recipe : data;
    const meta = data.metadata || {};
    if (!$('#pName').value && (meta.name || recipe.name)) $('#pName').value = meta.name || recipe.name;
    if (!$('#pDesc').value && (meta.description || recipe.description)) $('#pDesc').value = meta.description || recipe.description;
    if (!$('#pCategory').value && (meta.category || recipe.category)) $('#pCategory').value = meta.category || recipe.category;
    if (!$('#pTags').value) {
      const tags = meta.tags || recipe.tags;
      if (Array.isArray(tags)) $('#pTags').value = tags.join(',');
    }
  } catch (e) { /* ignore */ }
  updateRecipeStatus();
  toast('已读取编辑器配方');
}

async function submitPublish() {
  if (!state.user) { toast('请先登录'); openAuth('login'); return; }
  const err = $('#publishError');
  err.textContent = '';
  const parsed = parseRecipeJson($('#pRecipeJson').value);
  if (parsed.error) { err.textContent = parsed.error; return; }
  const name = $('#pName').value.trim();
  if (!name) { err.textContent = '请填写名称'; return; }
  try {
    $('#publishSubmit').disabled = true;
    let beforeFile = $('#pBefore').files[0];
    let afterFile = $('#pAfter').files[0];
    // 前后图配对保证：仅凭 URL 不同不足以确认，须校验尺寸一致（同一照片/同一构图）
    if (beforeFile && afterFile) {
      const [a, b] = await Promise.all([imageSize(beforeFile), imageSize(afterFile)]);
      if (a && b && (a.w !== b.w || a.h !== b.h)) {
        err.textContent = `前后图尺寸不一致（${a.w}×${a.h} vs ${b.w}×${b.h}），无法确认是同一张照片、同一构图；请使用同尺寸图片，或只上传单张封面。`;
        return;
      }
      // 内容完全相同 → 不是前后对比，按单图发布
      if (await sameContent(beforeFile, afterFile)) {
        afterFile = null;
        toast('检测到前后图内容相同，将按单图发布');
      }
    }
    const cover_before = beforeFile ? await uploadFile($('#pBefore')) : '';
    const cover_after = afterFile ? await uploadFile($('#pAfter')) : '';
    const pairing = !cover_after ? 'single' : (state.pairing === 'editor' ? 'editor' : 'manual');
    // 元数据附加在完整配方之上；version/rendering/steps 来自编辑器
    const recipe = Object.assign({}, parsed.recipe, {
      name,
      description: $('#pDesc').value.trim(),
      category: $('#pCategory').value.trim(),
      tags: $('#pTags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      cover_before, cover_after,
      pairing,
    });
    const r = await api('/api/recipes', { method: 'POST', body: { recipe }, auth: true });
    if (!r.ok) { err.textContent = r.data.error || '发布失败'; return; }
    $('#publishModal').classList.remove('open');
    toast('发布成功');
    resetPublishForm();
    loadCategories(); loadStats(); loadRecommend(); reloadCurrentView();
  } catch (e) {
    err.textContent = e.message;
  } finally {
    $('#publishSubmit').disabled = false;
  }
}

function resetPublishForm() {
  ['#pName', '#pDesc', '#pCategory', '#pTags', '#pRecipeJson', '#pBefore', '#pAfter'].forEach((s) => { const el = $(s); if (el) el.value = ''; });
  ['#pBefore', '#pAfter'].forEach((s) => { const el = $(s); if (el) delete el.dataset.fromEditor; });
  document.querySelectorAll('.file-note').forEach((n) => { n.textContent = '默认使用编辑器内图片'; });
  const toggle = $('#pRecipeToggle');
  if (toggle) {
    toggle.setAttribute('aria-expanded', 'false');
    const body = $('#pRecipeBody');
    if (body) body.hidden = true;
  }
  state.pairing = 'manual';
  updateRecipeStatus();
}

/* ---------------- 上传记录 ---------------- */
async function loadRecords(reset) {
  if (!state.user) { toast('请先登录'); openAuth('login'); return; }
  if (reset) { state.recPage = 1; $('#records').innerHTML = ''; }
  const p = new URLSearchParams({ page: state.recPage || 1, page_size: 20 });
  const r = await api('/api/me/uploads?' + p.toString(), { auth: true });
  if (!r.ok) { toast(r.data.error || '加载失败'); return; }
  state.recTotal = r.data.total || 0;
  (r.data.recipes || []).forEach(appendRecord);
  $('#empty').style.display = (state.recTotal === 0) ? 'block' : 'none';
  $('#empty').textContent = '还没有上传记录';
}

function appendRecord(rec) {
  let status, actions;
  if (!rec.deleted) {
    status = '<span class="status active">已发布</span>';
    actions = '<button class="btn danger rec-del">删除</button>';
  } else if (rec.recoverable) {
    status = `<span class="status deleted">已删除 · ${rec.days_left} 天内可找回</span>`;
    actions = '<button class="btn rec-restore">找回</button>';
  } else {
    status = '<span class="status expired">已删除 · 已过期</span>';
    actions = '';
  }
  const el = document.createElement('div');
  el.className = 'record';
  el.innerHTML = `
      <img class="record-thumb" data-original-src="${esc(uploadOriginalUrl(rec.cover_after || rec.cover_before))}" src="${esc(thumbUrl(rec.cover_after || rec.cover_before, 200))}" srcset="${esc(thumbSrcset(rec.cover_after || rec.cover_before))}" sizes="88px" width="88" height="60" alt="${esc(rec.name)}" loading="lazy" decoding="async">
    <div class="record-info">
      <div class="record-name">${esc(rec.name)}${rec.category ? ` <span class="chip">${esc(rec.category)}</span>` : ''}</div>
      <div class="record-meta">上传时间：${esc(rec.created_at || '—')}</div>
      <div class="record-meta">状态：${status}${rec.deleted_at ? ` · 删除时间：${esc(rec.deleted_at)}` : ''}</div>
    </div>
    <div class="record-actions">${actions}</div>`;
  const del = el.querySelector('.rec-del');
  if (del) del.onclick = () => deleteOwnRecipe(rec);
  const res = el.querySelector('.rec-restore');
  if (res) res.onclick = () => restoreRecipe(rec);
  $('#records').appendChild(el);
}

async function restoreRecipe(rec) {
  const r = await api(`/api/recipes/${rec.id}/restore`, { method: 'POST', auth: true });
  if (!r.ok) { toast(r.data.error || '找回失败'); return; }
  toast('已找回');
  loadStats(); loadRecommend(); loadRecords(true);
}

/* ---------------- 视图 ---------------- */
function reloadCurrentView() {
  if (state.view === 'records') loadRecords(true);
  else loadRecipes(true);
}

function switchView(view) {
  if (view === 'records' && !state.user) { toast('请先登录'); openAuth('login'); view = 'community'; }
  state.view = view;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
  const comm = view === 'community';
  const isRecords = view === 'records';
  $('#sort').style.display = comm ? '' : 'none';
  $('#category').style.display = comm ? '' : 'none';
  $('#grid').style.display = isRecords ? 'none' : '';
  $('#records').style.display = isRecords ? 'flex' : 'none';
  $('#loadMore').style.display = 'none';
  $('#empty').style.display = 'none';
  if (isRecords) loadRecords(true);
  else loadRecipes(true);
}

/* ---------------- 事件 ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  renderAuth();
  loadStats(); loadCategories(); loadRecommend(); loadRecipes(true);
  updateRecipeStatus();

  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => switchView(t.dataset.view); });
  $('#sort').onchange = (e) => { state.sort = e.target.value; loadRecipes(true); };
  $('#category').onchange = (e) => { state.category = e.target.value; loadRecipes(true); };
  $('#search').onkeydown = (e) => {
    if (e.key === 'Enter') { state.search = $('#search').value.trim(); if (state.view !== 'community') switchView('community'); else loadRecipes(true); }
  };
  $('#loadMore').onclick = () => { state.page += 1; loadRecipes(false); };
  $('#publishBtn').onclick = () => {
    if (!state.user) { toast('请先登录'); openAuth('login'); return; }
    state.pairing = 'manual';           // 手动发布默认视为人工来源
    $('#publishError').textContent = '';
    updateRecipeStatus();
    $('#publishModal').classList.add('open');
  };
  $('#authSubmit').onclick = submitAuth;
  $('#authToggle').onclick = () => openAuth(state.authMode === 'login' ? 'register' : 'login');
  $('#publishSubmit').onclick = submitPublish;
  $('#pLoadHandoff').onclick = loadHandoff;
  const recipeToggle = $('#pRecipeToggle');
  if (recipeToggle) {
    recipeToggle.onclick = () => {
      const body = $('#pRecipeBody');
      const open = recipeToggle.getAttribute('aria-expanded') === 'true';
      recipeToggle.setAttribute('aria-expanded', String(!open));
      body.hidden = open;
    };
  }
  document.querySelectorAll('.file-pick').forEach((btn) => {
    btn.onclick = () => document.getElementById(btn.dataset.target)?.click();
  });
  document.querySelectorAll('#pBefore, #pAfter').forEach((input) => {
    input.addEventListener('change', () => {
      input.dataset.fromEditor = '0';
      const note = input.closest('.file-field')?.querySelector('.file-note');
      if (note) note.textContent = input.files[0]?.name || '默认使用编辑器内图片';
    });
  });
  $('#pRecipeJson').oninput = () => { state.pairing = 'manual'; updateRecipeStatus(); };
  $('#pClearRecipe').onclick = () => { $('#pRecipeJson').value = ''; state.pairing = 'manual'; updateRecipeStatus(); };

  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => b.closest('.modal').classList.remove('open'); });
  document.querySelectorAll('.modal').forEach((m) => { m.onclick = (e) => { if (e.target === m) m.classList.remove('open'); }; });
});
