'use strict';

/* 与主编辑器共用的会话键；社区 -> 编辑器 / 编辑器 -> 社区的交接键 */
const TOKEN_KEY = 'landscape:token';
const USER_KEY = 'landscape:user';
const LEGACY_TOKEN_KEY = 'cd_token';
const LEGACY_USER_KEY = 'cd_user';
const SHARE_KEY = 'landscape:share-recipe';        // 编辑器写入，社区发布时读取（同源）
const EDITOR_URL = window.EDITOR_URL || '';        // 独立部署时仅用于打开编辑器，不自动传照片

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

function copyText(text) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
  return Promise.resolve();
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
      <img src="${esc(rec.cover_after || rec.cover_before)}" alt="${esc(rec.name)}" loading="lazy">
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
}

function appendCard(rec) {
  const isOwn = !!(state.user && rec.author_id === state.user.id);
  const foot = isOwn
    ? `<button class="btn danger card-del">删除</button>`
    : `<button class="fav ${rec.is_favorited ? 'on' : ''}">${rec.is_favorited ? '★' : '☆'} <b>${rec.favorite_count}</b></button>`;
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="card-cover" data-id="${rec.id}">
      <img src="${esc(rec.cover_after || rec.cover_before)}" alt="${esc(rec.name)}" loading="lazy">
      ${rec.category ? `<span class="badge">${esc(rec.category)}</span>` : ''}
    </div>
    <div class="card-body">
      <div class="card-title" data-id="${rec.id}">${esc(rec.name)}</div>
      <div class="card-desc">${esc(rec.description || '—')}</div>
      <div class="card-meta">
        <span>@ ${esc(rec.author)}</span>
        ${(rec.tags || []).slice(0, 3).map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}
      </div>
      <div class="card-foot">${foot}</div>
    </div>`;
  card.querySelector('.card-cover').onclick = () => openDetail(rec.id);
  card.querySelector('.card-title').onclick = () => openDetail(rec.id);
  if (isOwn) card.querySelector('.card-del').onclick = () => deleteOwnRecipe(rec);
  else card.querySelector('.fav').onclick = (e) => toggleFavorite(rec, e.currentTarget);
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
      html: `<div class="detail-imgs"><figure><img class="detail-img" src="${esc(after || before)}" alt="${esc(rec.name)}">
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
    html: `<div class="detail-imgs">
        <figure><img class="detail-img" style="width:180px" src="${esc(before)}" alt="${esc(capA)}"><figcaption class="muted">${esc(capA)}</figcaption></figure>
        <figure><img class="detail-img" style="width:180px" src="${esc(after)}" alt="${esc(capB)}"><figcaption class="muted">${esc(capB)}</figcaption></figure>
      </div>${note}`,
  };
}

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
  const favBtn = owner ? '' : `<button class="btn ${rec.is_favorited ? 'ghost' : ''}" id="dFav">${rec.is_favorited ? '★ 已收藏' : '☆ 收藏'}（${rec.favorite_count}）</button>`;
  const delBtn = owner ? '<button class="btn danger" id="dDel">删除作品</button>' : '';

  $('#detailBody').innerHTML = `
    <h3>${esc(rec.name)}</h3>
    <div class="detail-head">
      <div>${pv.html}</div>
      <div class="detail-info">
        <div class="card-meta"><span>@ ${esc(rec.author)}</span>${rec.category ? `<span class="chip">${esc(rec.category)}</span>` : ''}</div>
        <div style="margin-top:8px">${(rec.tags || []).map((t) => `<span class="chip">#${esc(t)}</span>`).join(' ')}</div>
        <p class="desc">${esc(rec.description || '（暂无说明）')}</p>
        <div class="steps-title">调色配方（版本 ${esc(rec.version || 1)}）</div>
        <ul class="steps-list">${steps}</ul>
        <div class="modal-actions" style="margin-top:16px">
          <button class="btn primary" id="dPreview">在我的照片上预览</button>
          <button class="btn ghost" id="dCopy">复制配方</button>
          ${favBtn}${delBtn}
        </div>
        <div class="hint">预览会把完整配方送到编辑器，套用在**你自己的照片**上；不会替换你的原图。</div>
      </div>
    </div>`;

  $('#dPreview').onclick = () => previewInEditor(rec.id);
  $('#dCopy').onclick = () => {
    const recipe = { version: rec.version || 1 };
    if (rec.rendering != null) recipe.rendering = rec.rendering;
    recipe.steps = rec.steps || [];
    copyText(JSON.stringify(recipe, null, 2)).then(() => toast('已复制配方'), () => toast('复制失败'));
  };
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
      window.open(EDITOR_URL, '_blank', 'noopener');
      toast('已打开编辑器；独立部署无法自动传递照片/历史，请粘贴配方套用');
    } else {
      toast('已复制配方；独立部署无法自动传递照片/历史，请在编辑器粘贴套用');
    }
  }, () => toast('复制失败，请手动复制配方'));
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
  if (![1, 2, 3, 4, 5, 6].includes(version)) return { error: '暂不支持的配方版本：' + version };
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
    <img class="record-thumb" src="${esc(rec.cover_after || rec.cover_before)}" alt="${esc(rec.name)}" loading="lazy">
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
  $('#pRecipeJson').oninput = () => { state.pairing = 'manual'; updateRecipeStatus(); };
  $('#pClearRecipe').onclick = () => { $('#pRecipeJson').value = ''; state.pairing = 'manual'; updateRecipeStatus(); };

  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => b.closest('.modal').classList.remove('open'); });
  document.querySelectorAll('.modal').forEach((m) => { m.onclick = (e) => { if (e.target === m) m.classList.remove('open'); }; });
});
