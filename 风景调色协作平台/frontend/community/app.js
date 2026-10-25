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
  pageSize: 50,
  total: 0,
  hasMore: false,
  loading: false,
  token: readToken(),
  user: readUser(),
  authMode: 'login',
  pairing: 'manual',
  profileAvatarDraft: null,
};

const $ = (s) => document.querySelector(s);

/* ---------------- 个性化设置 ---------------- */
const PREF_KEY = 'landscape:prefs';
const prefs = { fontScale: 1, displayMode: 'card' };

function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
    const scale = Number(raw.fontScale);
    if ([0.9, 1, 1.1].includes(scale)) prefs.fontScale = scale;
    if (['card', 'gallery'].includes(raw.displayMode)) prefs.displayMode = raw.displayMode;
  } catch { /* ignore */ }
}

function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

function applyPrefs() {
  document.documentElement.style.setProperty('--ui-font-scale', prefs.fontScale);
  const grid = document.getElementById('grid');
  if (grid) grid.classList.toggle('gallery-mode', prefs.displayMode === 'gallery');
  document.querySelectorAll('[data-font-scale]').forEach((b) => b.classList.toggle('active', Number(b.dataset.fontScale) === prefs.fontScale));
  const displayMode = document.getElementById('displayMode');
  if (displayMode) displayMode.value = prefs.displayMode;
}

function setFontScale(scale) {
  prefs.fontScale = Number(scale);
  savePrefs();
  applyPrefs();
}

function setDisplayMode(mode) {
  prefs.displayMode = mode;
  savePrefs();
  applyPrefs();
  if (['community', 'favorites', 'mine'].includes(state.view)) loadRecipes(false);
}

function readToken() { return localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || ''; }
function readUser() { try { return JSON.parse(localStorage.getItem(USER_KEY) || localStorage.getItem(LEGACY_USER_KEY) || 'null'); } catch (e) { return null; } }
function writeSession(token, user) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); }
function clearSession() { [TOKEN_KEY, USER_KEY, LEGACY_TOKEN_KEY, LEGACY_USER_KEY].forEach((k) => localStorage.removeItem(k)); }

function userInitial(user) {
  const value = String(user?.display_name || user?.username || '?').trim();
  return (value.charAt(0) || '?').toUpperCase();
}

function updateAvatarDisplay(img, initial, url, name) {
  if (img) {
    delete img.dataset.usedOriginal;
    img.classList.remove('image-unavailable');
    if (url) {
      img.dataset.originalSrc = uploadOriginalUrl(url);
      img.src = thumbUrl(url, 160);
      img.hidden = false;
    } else {
      img.hidden = true;
      img.removeAttribute('src');
      delete img.dataset.originalSrc;
    }
  }
  if (initial) {
    initial.textContent = userInitial({ display_name: name });
    initial.hidden = !!url;
  }
}

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
  let res;
  try { res = await fetch(path, { method, headers, body: form ? form : (body ? JSON.stringify(body) : null) }); }
  catch { return {ok:false, status:0, data:{error:'网络暂不可用，请重试'}}; }
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
  if (!area) return;
  if (state.user) {
    const name = state.user.display_name || state.user.username;
    const avatar = state.user.avatar
      ? `<span class="auth-avatar"><img data-original-src="${esc(uploadOriginalUrl(state.user.avatar))}" src="${esc(thumbUrl(state.user.avatar, 80))}" alt=""></span>`
      : `<span class="auth-avatar">${esc(userInitial(state.user))}</span>`;
    area.innerHTML = `<button type="button" class="auth-user" id="authUserBtn">${avatar}<span>@ ${esc(state.user.username)}</span></button>` +
      `<button class="btn ghost" id="logoutBtn">退出</button>`;
    $('#authUserBtn').onclick = () => enterUserCenter();
    $('#logoutBtn').onclick = async () => {
      await api('/api/auth/logout', { method: 'POST', auth: true });
      state.token = ''; state.user = null; state.profileAvatarDraft = null; clearSession();
      renderAuth(); exitUserCenter(true); toast('已退出登录');
    };
  } else {
    area.innerHTML = `<button class="btn ghost" id="loginBtn">登录</button>`;
    $('#loginBtn').onclick = () => openAuth('login');
  }
}

async function refreshMe() {
  if (!state.token) return;
  const token = state.token;
  const r = await api('/api/auth/me', { auth: true });
  if (state.token !== token) return;
  if (r.ok && r.data.user) {
    state.user = r.data.user;
    writeSession(state.token, state.user);
    renderAuth();
    if (document.documentElement.classList.contains('uc-mode')) renderAccountPanel();
  } else if (r.status === 401) {
    state.token = '';
    state.user = null;
    state.profileAvatarDraft = null;
    clearSession();
    renderAuth();
    exitUserCenter(true);
  }
}

/* ---------------- 账号概览与资料编辑 ---------------- */
function formatJoined(value) {
  return String(value || '').slice(0, 10) || '—';
}

function setProfileError(message = '') {
  const el = $('#ucProfileError');
  if (el) el.textContent = message;
}

function renderAccountPanel() {
  const user = state.user;
  if (!user) return;
  const name = user.display_name || user.username;
  const avatar = state.profileAvatarDraft !== null ? state.profileAvatarDraft : (user.avatar || '');
  updateAvatarDisplay($('#ucAvatarImage'), $('#ucAvatarInitial'), avatar, name);
  updateAvatarDisplay($('#ucAvatarPreviewImg'), $('#ucAvatarPreviewInitial'), avatar, name);

  const display = $('#ucDisplayName');
  if (display) display.textContent = name;
  const handle = $('#ucProfileHandle');
  if (handle) handle.textContent = '@' + user.username;
  const bio = $('#ucProfileBio');
  if (bio) bio.textContent = user.bio || '还没有填写简介。';
  const meta = $('#ucProfileMeta');
  if (meta) {
    const parts = [];
    if (user.location) parts.push(`<span>${esc(user.location)}</span>`);
    if (user.created_at) parts.push(`<span>加入于 ${esc(formatJoined(user.created_at))}</span>`);
    meta.innerHTML = parts.join('');
  }

  const stats = $('#ucProfileStats');
  if (stats) {
    const values = [
      [user.works_count, '作品'],
      [user.favorites_given, '收藏'],
      [user.favorites_received, '获收藏'],
    ];
    stats.innerHTML = values.map(([value, label]) =>
      `<div class="uc-stat"><b>${Number(value) || 0}</b><span>${label}</span></div>`).join('');
  }

  const accountName = $('#ucAccountName');
  if (accountName) accountName.textContent = user.username;
  const joined = $('#ucJoinedAt');
  if (joined) joined.textContent = formatJoined(user.created_at);

  const nameInput = $('#ucDisplayNameInput');
  if (nameInput && !nameInput.dataset.edited && document.activeElement !== nameInput) nameInput.value = user.display_name || user.username;
  const bioInput = $('#ucBioInput');
  if (bioInput && !bioInput.dataset.edited && document.activeElement !== bioInput) bioInput.value = user.bio || '';
  const locationInput = $('#ucLocationInput');
  if (locationInput && !locationInput.dataset.edited && document.activeElement !== locationInput) locationInput.value = user.location || '';

  const remove = $('#ucAvatarRemove');
  if (remove) remove.hidden = !avatar;
}

async function loadMyProfile() {
  if (!state.token) return;
  const token = state.token;
  const r = await api('/api/users/me', { auth: true });
  if (state.token !== token) return;
  if (!r.ok) {
    if (r.status === 401) {
      state.token = '';
      state.user = null;
      clearSession();
      renderAuth();
      exitUserCenter(true);
    }
    return;
  }
  state.user = r.data.user;
  writeSession(state.token, state.user);
  renderAuth();
  renderAccountPanel();
}

async function pickProfileAvatar(file) {
  setProfileError('');
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    setProfileError('头像仅支持 JPG/PNG/WebP 格式');
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    setProfileError('头像需小于 5MB');
    return;
  }
  const form = new FormData();
  form.append('file', file);
  const token = state.token;
  const r = await api('/api/upload', { method: 'POST', form });
  if (state.token !== token) return;
  if (!r.ok) {
    setProfileError(r.data.error || '头像上传失败');
    return;
  }
  state.profileAvatarDraft = r.data.url || '';
  renderProfileAvatar();
}

function renderProfileAvatar() {
  if (!state.user) return;
  const avatar = state.profileAvatarDraft !== null ? state.profileAvatarDraft : (state.user.avatar || '');
  const name = state.user.display_name || state.user.username;
  updateAvatarDisplay($('#ucAvatarImage'), $('#ucAvatarInitial'), avatar, name);
  updateAvatarDisplay($('#ucAvatarPreviewImg'), $('#ucAvatarPreviewInitial'), avatar, name);
  $('#ucAvatarRemove').hidden = !avatar;
}

async function saveProfile() {
  if (!state.user) return;
  setProfileError('');
  const displayName = $('#ucDisplayNameInput').value.trim();
  const bio = $('#ucBioInput').value.trim();
  const location = $('#ucLocationInput').value.trim();
  if (!displayName) { setProfileError('昵称不能为空'); return; }
  if (displayName.length > 20) { setProfileError('昵称最多 20 个字符'); return; }
  if (bio.length > 160) { setProfileError('简介最多 160 个字符'); return; }
  if (location.length > 40) { setProfileError('所在地最多 40 个字符'); return; }
  const avatar = state.profileAvatarDraft !== null ? state.profileAvatarDraft : (state.user.avatar || '');
  const token = state.token;
  const r = await api('/api/users/me', {
    method: 'PUT',
    auth: true,
    body: { display_name: displayName, bio, location, avatar },
  });
  if (state.token !== token) return;
  if (!r.ok) {
    setProfileError(r.data.error || '保存失败');
    return;
  }
  state.user = r.data.user;
  state.profileAvatarDraft = null;
  clearProfileDraftMarks();
  writeSession(state.token, state.user);
  renderAuth();
  renderAccountPanel();
  toast('资料已保存');
}

async function openPublicProfile(userId) {
  const id = Number(userId);
  if (!id) return;
  const r = await api('/api/users/' + id);
  if (!r.ok) { toast(r.data.error || '用户不存在'); return; }
  const user = r.data.user;
  const name = user.display_name || user.username;
  const worksResult = await api(`/api/recipes?author_id=${id}&page_size=9&sort=latest`);
  const works = worksResult.ok ? (worksResult.data.recipes || []) : [];
  const avatar = user.avatar
    ? `<img data-original-src="${esc(uploadOriginalUrl(user.avatar))}" src="${esc(thumbUrl(user.avatar, 160))}" alt="${esc(name)}的头像">`
    : esc(userInitial(user));
  const meta = [];
  if (user.location) meta.push(`<span>${esc(user.location)}</span>`);
  if (user.created_at) meta.push(`<span>加入于 ${esc(formatJoined(user.created_at))}</span>`);
  const workHtml = works.map((rec) => {
    const cover = rec.cover_after || rec.cover_before;
    return `<button type="button" class="public-work" data-work-id="${rec.id}">
      <img data-original-src="${esc(uploadOriginalUrl(cover))}" src="${esc(thumbUrl(cover, 400))}" alt="${esc(rec.name)}" loading="lazy" decoding="async">
      <span>${esc(rec.name)}</span>
    </button>`;
  }).join('');

  $('#publicProfileBody').innerHTML = `
    <div class="public-profile-head">
      <div class="public-profile-avatar">${avatar}</div>
      <div>
        <h2>${esc(name)}</h2>
        <div class="public-profile-handle">@ ${esc(user.username)}</div>
        <p class="public-profile-bio">${esc(user.bio || '这位作者还没有填写简介。')}</p>
        <div class="public-profile-meta">${meta.join('')}</div>
      </div>
    </div>
    <div class="public-profile-stats">
      <span><b>${Number(user.works_count) || 0}</b>作品</span>
      <span><b>${Number(user.favorites_received) || 0}</b>获收藏</span>
    </div>
    <h3 class="public-profile-section-title">最近作品</h3>
    ${workHtml ? `<div class="public-profile-works">${workHtml}</div>` : '<p class="hint">还没有公开作品。</p>'}`;

  $('#detailModal').classList.remove('open');
  $('#profileModal').classList.add('open');
  $('#publicProfileBody').querySelectorAll('.public-work').forEach((btn) => {
    btn.onclick = () => {
      const workId = Number(btn.dataset.workId);
      $('#profileModal').classList.remove('open');
      if (workId) openDetail(workId);
    };
  });
}

function openAuth(mode) {
  state.authMode = mode || 'login';
  $('#authTitle').textContent = state.authMode === 'login' ? '登录' : '注册';
  $('#authSubmit').textContent = state.authMode === 'login' ? '登录' : '注册';
  $('#authToggle').textContent = state.authMode === 'login' ? '没有账号？去注册' : '已有账号？去登录';
  $('#authUser').value = '';
  $('#authPass').value = '';
  $('#authPass').autocomplete = state.authMode === 'login' ? 'current-password' : 'new-password';
  $('#authError').textContent = '';
  $('#authModal').classList.add('open');
}

async function submitAuth() {
  const username = $('#authUser').value.trim();
  const password = $('#authPass').value.trim();
  const path = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
  const r = await api(path, { method: 'POST', body: { username, password } });
  if (!r.ok) { $('#authError').textContent = r.data.error || '操作失败'; return; }
  state.token = r.data.token; state.user = r.data.user; state.profileAvatarDraft = null;
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
  if ((state.view === 'mine' || state.view === 'favorites') && !state.user) {
    toast('请先登录'); openAuth('login'); return;
  }
  const request = state.listRequest = (state.listRequest || 0) + 1;
  const view = state.view;
  // 搜索时隐藏「为你推荐」，把「全部作品」区域顶上来。
  const recommendSection = $('#recommendSection');
  if (recommendSection) recommendSection.style.display = (state.view === 'community' && state.search) ? 'none' : '';
  state.loading = true;
  if (reset) state.page = 1;
  $('#grid').innerHTML = '';
  let r;
  try { r = await api(listEndpoint(), { auth: true }); }
  catch { r = {ok:false, data:{error:'网络暂不可用，请重试'}}; }
  if (request !== state.listRequest || state.view !== view) return;
  state.loading = false;
  if (!r.ok) { toast(r.data.error || '加载失败'); return; }
  state.total = r.data.total || 0;
  state.hasMore = !!r.data.has_more;
  (r.data.recipes || []).forEach(appendCard);
  $('#empty').style.display = (state.total === 0) ? 'block' : 'none';
  $('#empty').textContent = state.view === 'mine' ? '还没有上传作品'
    : state.view === 'favorites' ? '还没有收藏作品' : '没有更多内容了';
  renderPagination();
  if (reset && state.view === 'community' && state.search) {
    requestAnimationFrame(() => document.querySelector('.toolbar')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
}

function renderPagination() {
  const wrap = $('#pagination');
  if (!wrap) return;
  const records = state.view === 'records';
  const total = Number(records ? state.recTotal : state.total) || 0;
  const totalPages = Math.max(1, Math.ceil(total / (records ? 20 : state.pageSize)));
  if (total === 0 || totalPages <= 1) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';
  const current = Math.min(Math.max(1, Number(records ? state.recPage : state.page) || 1), totalPages);
  let pages;
  if (totalPages <= 9) {
    pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  } else if (current <= 5) {
    pages = [1, 2, 3, 4, 5, 6, 7, '…', totalPages];
  } else if (current >= totalPages - 4) {
    pages = [1, '…', totalPages - 6, totalPages - 5, totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  } else {
    pages = [1, '…', current - 2, current - 1, current, current + 1, current + 2, '…', totalPages];
  }
  const box = $('#pageNumbers');
  if (box) {
    box.innerHTML = pages.map((p) => p === '…'
      ? '<span class="page-ellipsis">…</span>'
      : `<button type="button" class="page-num${p === current ? ' active' : ''}" data-page="${p}">${p}</button>`).join('');
  }
  const prev = $('#prevPage');
  const next = $('#nextPage');
  if (prev) prev.disabled = current <= 1;
  if (next) next.disabled = current >= totalPages;
}

function goToPage(page) {
  const records = state.view === 'records';
  const totalPages = Math.max(1, Math.ceil((Number(records ? state.recTotal : state.total) || 0) / (records ? 20 : state.pageSize)));
  const next = Math.min(Math.max(1, Number(page) || 1), totalPages);
  if (next === (records ? state.recPage : state.page)) return;
  if (records) { state.recPage = next; loadRecords(false); }
  else { state.page = next; loadRecipes(false); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function appendGalleryCard(rec) {
  const cover = rec.cover_after || rec.cover_before;
  const count = Number(rec.favorite_count) || 0;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gallery-card';
  btn.setAttribute('aria-label', rec.name);
  btn.innerHTML = `<img data-original-src="${esc(uploadOriginalUrl(cover))}" src="${esc(thumbUrl(cover, 800))}" srcset="${esc(thumbSrcset(cover))}" sizes="(max-width: 620px) 50vw, (max-width: 900px) 33vw, 25vw" width="400" height="260" alt="${esc(rec.name)}" loading="lazy" decoding="async"><span class="gallery-meta"><strong>${esc(rec.name)}</strong><span>☆ ${count}</span></span>`;
  btn.onclick = () => openDetail(rec.id);
  $('#grid').appendChild(btn);
}

function appendCard(rec) {
  if (prefs.displayMode === 'gallery') { appendGalleryCard(rec); return; }
  const isOwn = !!(state.user && rec.author_id === state.user.id);
  const isCommunity = state.view === 'community';
  const isMine = state.view === 'mine';
  const count = Number(rec.favorite_count) || 0;
  const star = rec.is_favorited ? '★' : '☆';
  const staticPill = `<span class="fav static ${rec.is_favorited ? 'on' : ''}">${star} <b>${count}</b></span>`;
  const favButton = `<button class="fav ${rec.is_favorited ? 'on' : ''}">${star} <b>${count}</b></button>`;
  const authorHtml = rec.author_id
    ? `<button type="button" class="author-link" data-author-id="${rec.author_id}">@ ${esc(rec.author)}</button>`
    : `<span>@ ${esc(rec.author || '匿名')}</span>`;

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
        ${authorHtml}
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
  const authorLink = card.querySelector('.author-link');
  if (authorLink) authorLink.onclick = (event) => {
    event.stopPropagation();
    openPublicProfile(Number(authorLink.dataset.authorId));
  };
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
      <div class="card-meta">${rec.author_id ? `<button type="button" class="author-link" data-author-id="${rec.author_id}">@ ${esc(rec.author)}</button>` : `<span>@ ${esc(rec.author)}</span>`}${rec.category ? `<span class="chip">${esc(rec.category)}</span>` : ''}</div>
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
  $('#detailBody').querySelectorAll('.author-link').forEach((link) => {
    link.onclick = (event) => {
      event.stopPropagation();
      openPublicProfile(Number(link.dataset.authorId));
    };
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
    const newId = r.data?.id ?? r.data?.recipe?.id;
    $('#publishModal').classList.remove('open');
    $('#detailModal').classList.remove('open');
    toast('发布成功');
    resetPublishForm();
    loadCategories(); loadStats(); loadRecommend(); reloadCurrentView();
    if (newId) setTimeout(() => openDetail(newId), 260);
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
  const request = state.listRequest = (state.listRequest || 0) + 1;
  if (reset) state.recPage = 1;
  $('#records').innerHTML = '';
  const p = new URLSearchParams({ page: state.recPage || 1, page_size: 20 });
  const r = await api('/api/me/uploads?' + p.toString(), { auth: true });
  if (request !== state.listRequest || state.view !== 'records') return;
  if (!r.ok) { toast(r.data.error || '加载失败'); return; }
  state.recTotal = r.data.total || 0;
  (r.data.recipes || []).forEach(appendRecord);
  $('#empty').style.display = (state.recTotal === 0) ? 'block' : 'none';
  $('#empty').textContent = '还没有上传记录';
  renderPagination();
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
  $('#displayMode').hidden = isRecords;
  $('#grid').style.display = isRecords ? 'none' : '';
  $('#records').style.display = isRecords ? 'flex' : 'none';
  const pagination = $('#pagination');
  if (pagination) pagination.style.display = 'none';
  $('#empty').style.display = 'none';
  if (isRecords) loadRecords(true);
  else loadRecipes(true);
}

/* ---------------- 用户中心 ---------------- */
function setUserCenterView(view) {
  state.listRequest = (state.listRequest || 0) + 1;
  state.loading = false;
  $('#empty').style.display = 'none';
  document.querySelectorAll('.uc-nav button').forEach((b) => b.classList.toggle('active', b.dataset.ucView === view));
  const account = document.getElementById('ucAccountPanel');
  const settings = document.getElementById('ucSettingsPanel');
  const toolbar = document.querySelector('.toolbar');
  const grid = document.getElementById('grid');
  const records = document.getElementById('records');
  if (view === 'account') {
    clearProfileDraftMarks();
    if (account) account.hidden = false;
    if (settings) settings.hidden = true;
    if (toolbar) toolbar.style.display = 'none';
    if (grid) grid.style.display = 'none';
    if (records) records.style.display = 'none';
    const empty = document.getElementById('empty');
    const pagination = $('#pagination');
    if (pagination) pagination.style.display = 'none';
    renderAccountPanel();
    loadMyProfile();
  } else if (view === 'settings') {
    if (account) account.hidden = true;
    if (settings) settings.hidden = false;
    if (toolbar) toolbar.style.display = 'none';
    if (grid) grid.style.display = 'none';
    if (records) records.style.display = 'none';
    const empty = document.getElementById('empty');
    const pagination = $('#pagination');
    if (pagination) pagination.style.display = 'none';
  } else {
    if (account) account.hidden = true;
    if (settings) settings.hidden = true;
    if (toolbar) toolbar.style.display = '';
    if (view === 'records') switchView('records');
    else switchView(view);
  }
}

function enterUserCenter() {
  if (!state.user) { toast('请先登录'); openAuth('login'); return; }
  document.documentElement.classList.add('uc-mode');
  setUserCenterView('account');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function clearProfileDraftMarks() {
  for (const id of ['ucDisplayNameInput','ucBioInput','ucLocationInput']) {
    const input = document.getElementById(id);
    if (input) delete input.dataset.edited;
  }
}

function exitUserCenter(force = false) {
  if (!force && !document.documentElement.classList.contains('uc-mode')) return;
  document.documentElement.classList.remove('uc-mode');
  const account = document.getElementById('ucAccountPanel');
  if (account) account.hidden = true;
  const settings = document.getElementById('ucSettingsPanel');
  if (settings) settings.hidden = true;
  const toolbar = document.querySelector('.toolbar');
  if (toolbar) toolbar.style.display = '';
  switchView('community');
  loadRecommend();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------------- 事件 ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  loadPrefs();
  applyPrefs();
  renderAuth();
  refreshMe();
  loadStats(); loadCategories(); loadRecommend(); loadRecipes(true);
  updateRecipeStatus();

  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => switchView(t.dataset.view); });
  $('#sort').onchange = (e) => { state.sort = e.target.value; loadRecipes(true); };
  $('#displayMode').onchange = (e) => setDisplayMode(e.target.value);
  $('#category').onchange = (e) => { state.category = e.target.value; loadRecipes(true); };
  $('#search').onkeydown = (e) => {
    if (e.key === 'Enter') { state.search = $('#search').value.trim(); if (state.view !== 'community') switchView('community'); else loadRecipes(true); }
  };
  $('#searchSubmit').onclick = () => {
    state.search = $('#search').value.trim();
    if (state.view !== 'community') switchView('community'); else loadRecipes(true);
  };
  document.querySelectorAll('.uc-nav button').forEach((btn) => {
    btn.onclick = () => setUserCenterView(btn.dataset.ucView);
  });
  const ucBack = $('#ucBack');
  if (ucBack) ucBack.onclick = exitUserCenter;
  const ucSaveProfile = $('#ucSaveProfile');
  if (ucSaveProfile) ucSaveProfile.onclick = saveProfile;
  for (const id of ['ucDisplayNameInput','ucBioInput','ucLocationInput']) {
    document.getElementById(id)?.addEventListener('input', event => { event.target.dataset.edited = '1'; });
  }
  const ucAvatarPick = $('#ucAvatarPick');
  const ucAvatarInput = $('#ucAvatarInput');
  if (ucAvatarPick && ucAvatarInput) {
    ucAvatarPick.onclick = () => ucAvatarInput.click();
    ucAvatarInput.onchange = () => {
      const file = ucAvatarInput.files?.[0];
      ucAvatarInput.value = '';
      pickProfileAvatar(file);
    };
  }
  const ucAvatarRemove = $('#ucAvatarRemove');
  if (ucAvatarRemove) ucAvatarRemove.onclick = () => {
    state.profileAvatarDraft = '';
    renderProfileAvatar();
  };
  const ucPreviewPublic = $('#ucPreviewPublic');
  if (ucPreviewPublic) ucPreviewPublic.onclick = () => {
    if (state.user) openPublicProfile(state.user.id);
  };
  document.querySelectorAll('[data-font-scale]').forEach((btn) => {
    btn.onclick = () => setFontScale(btn.dataset.fontScale);
  });
  const pageNumbers = $('#pageNumbers');
  if (pageNumbers) pageNumbers.onclick = (e) => {
    const b = e.target.closest('[data-page]');
    if (b) goToPage(Number(b.dataset.page));
  };
  const prevPage = $('#prevPage');
  if (prevPage) prevPage.onclick = () => goToPage((state.view === 'records' ? state.recPage : state.page) - 1);
  const nextPage = $('#nextPage');
  if (nextPage) nextPage.onclick = () => goToPage((state.view === 'records' ? state.recPage : state.page) + 1);
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

  const syncModalScrollLock = () => {
    const locked = !!document.querySelector('.modal.open');
    document.documentElement.classList.toggle('modal-open', locked);
    document.body.classList.toggle('modal-open', locked);
  };
  const modalObserver = new MutationObserver(syncModalScrollLock);
  document.querySelectorAll('.modal').forEach((modal) => {
    modalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] });
    modal.addEventListener('wheel', (event) => {
      if (!modal.classList.contains('open')) return;
      if (!event.deltaY) return;
      const card = event.target instanceof Element ? event.target.closest('.modal-card') : null;
      if (!card) { event.preventDefault(); return; }
      const canScroll = (el) => {
        if (!(el instanceof Element)) return false;
        const overflowY = getComputedStyle(el).overflowY;
        if (!/(auto|scroll|overlay)/.test(overflowY)) return false;
        if (el.scrollHeight <= el.clientHeight + 1) return false;
        return event.deltaY < 0
          ? el.scrollTop > 0
          : el.scrollTop + el.clientHeight < el.scrollHeight - 1;
      };
      let node = event.target instanceof Element ? event.target : null;
      while (node && node !== card) {
        if (canScroll(node)) return;
        node = node.parentElement;
      }
      if (canScroll(card)) return;
      event.preventDefault();
    }, { passive: false });
  });
  syncModalScrollLock();
});

/* 嵌入式顶栏：下滑隐藏，上滑显示；上滑越多，搜索框向两边展开 */
(() => {
  if (!document.documentElement.classList.contains('embedded')) return;
  const topbar = document.querySelector('.topbar');
  const searchWrap = document.querySelector('.search-wrap');
  if (!topbar || !searchWrap) return;
  const MAX_W = 760;
  const MIN_W = 520;
  const RANGE = 620;
  let lastY = window.scrollY || 0;
  let hidden = false;
  let raf = 0;
  const render = () => {
    raf = 0;
    const y = window.scrollY || 0;
    const delta = y - lastY;
    if (y <= 40) hidden = false;
    else if (delta > 1.5) hidden = true;
    else if (delta < -1.5) hidden = false;
    topbar.classList.toggle('search-hidden', hidden);
    const ratio = Math.min(1, Math.max(0, y / RANGE));
    const width = Math.round(MAX_W - (MAX_W - MIN_W) * ratio);
    searchWrap.style.setProperty('--search-width', `${width}px`);
    lastY = y;
  };
  window.addEventListener('scroll', () => {
    if (!raf) raf = requestAnimationFrame(render);
  }, { passive: true });
  render();
})();
