'use strict';

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
  token: localStorage.getItem('cd_token') || '',
  user: JSON.parse(localStorage.getItem('cd_user') || 'null'),
  authMode: 'login',
};

const DEMO = { username: 'demo', password: 'demo1234' };
const $ = (s) => document.querySelector(s);

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
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------------- 认证 ---------------- */
function renderAuth() {
  const area = $('#authArea');
  if (state.user) {
    area.innerHTML = `<span class="chip">@ ${esc(state.user.username)}</span>` +
      `<button class="btn ghost" id="logoutBtn">退出</button>`;
    $('#logoutBtn').onclick = async () => {
      await api('/api/auth/logout', { method: 'POST', auth: true });
      state.token = ''; state.user = null;
      localStorage.removeItem('cd_token'); localStorage.removeItem('cd_user');
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
  localStorage.setItem('cd_token', state.token);
  localStorage.setItem('cd_user', JSON.stringify(state.user));
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
  const r = await api('/api/recipes/recommend', { auth: true });
  const box = $('#recommend');
  const list = r.data.recipes || [];
  box.innerHTML = list.map((rec, i) => `
    <div class="mini" data-id="${rec.id}">
      ${i < 3 ? `<div class="rank">TOP${i + 1}</div>` : ''}
      <img src="${esc(rec.cover_after)}" alt="${esc(rec.name)}" loading="lazy">
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
      <img src="${esc(rec.cover_after)}" alt="${esc(rec.name)}" loading="lazy">
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
async function openDetail(id) {
  const r = await api('/api/recipes/' + id, { auth: true });
  if (!r.ok) { toast('作品不存在'); return; }
  const rec = r.data.recipe;
  const same = rec.cover_before && rec.cover_before === rec.cover_after;
  const img = same
    ? `<img class="detail-img" src="${esc(rec.cover_after)}" alt="${esc(rec.name)}">`
    : `<div style="display:flex;gap:10px;flex-wrap:wrap">
         <figure style="margin:0"><img class="detail-img" style="width:175px" src="${esc(rec.cover_before)}"><figcaption class="muted" style="text-align:center">调色前</figcaption></figure>
         <figure style="margin:0"><img class="detail-img" style="width:175px" src="${esc(rec.cover_after)}"><figcaption class="muted" style="text-align:center">调色后</figcaption></figure>
       </div>`;
  const steps = (rec.steps || []).map((s) => {
    const p = s.params || {};
    const val = p.value != null ? `${p.value > 0 ? '+' : ''}${p.value}` : (p.name || JSON.stringify(p));
    return `<li><span>${esc(s.type)}</span><span>${esc(val)}</span></li>`;
  }).join('') || '<li><span>无参数</span><span></span></li>';
  const owner = state.user && rec.author_id === state.user.id;
  const actionBtns = owner
    ? '<button class="btn danger" id="dDel">删除作品</button>'
    : `<button class="btn ${rec.is_favorited ? 'ghost' : 'primary'}" id="dFav">${rec.is_favorited ? '★ 已收藏' : '☆ 收藏'}（${rec.favorite_count}）</button>`;
  $('#detailBody').innerHTML = `
    <h3>${esc(rec.name)}</h3>
    <div class="detail-head">
      <div>${img}</div>
      <div class="detail-info">
        <div class="card-meta"><span>@ ${esc(rec.author)}</span>${rec.category ? `<span class="chip">${esc(rec.category)}</span>` : ''}</div>
        <div style="margin-top:8px">${(rec.tags || []).map((t) => `<span class="chip">#${esc(t)}</span>`).join(' ')}</div>
        <p class="desc">${esc(rec.description || '（暂无描述）')}</p>
        <div class="steps-title">调色配方</div>
        <ul class="steps-list">${steps}</ul>
        <div class="modal-actions" style="margin-top:16px">${actionBtns}</div>
      </div>
    </div>`;
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

function buildSteps() {
  const steps = [];
  const map = { pBrightness: 'brightness', pContrast: 'contrast', pSaturation: 'saturation', pTemperature: 'temperature' };
  Object.keys(map).forEach((id) => {
    const v = parseInt($('#' + id).value, 10);
    if (v !== 0) steps.push({ type: map[id], params: { value: v } });
  });
  const preset = $('#pPreset').value;
  if (preset) steps.push({ type: 'filter', params: { name: preset } });
  return steps;
}

async function submitPublish() {
  if (!state.user) { toast('请先登录'); openAuth('login'); return; }
  const err = $('#publishError');
  err.textContent = '';
  const name = $('#pName').value.trim();
  if (!name) { err.textContent = '请填写名称'; return; }
  try {
    $('#publishSubmit').disabled = true;
    const cover = await uploadFile($('#pCover'));
    const payload = {
      name,
      description: $('#pDesc').value.trim(),
      category: $('#pCategory').value.trim(),
      tags: $('#pTags').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      cover_before: cover, cover_after: cover,
      steps: buildSteps(),
    };
    const r = await api('/api/recipes', { method: 'POST', body: payload, auth: true });
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
  ['#pName', '#pDesc', '#pCategory', '#pTags'].forEach((s) => ($(s).value = ''));
  $('#pCover').value = '';
  $('#pPreset').value = '';
  ['#pBrightness', '#pContrast', '#pSaturation', '#pTemperature'].forEach((s) => {
    $(s).value = 0;
    document.querySelector('.val[data-for="' + s.slice(1) + '"]').textContent = '0';
  });
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
    <img class="record-thumb" src="${esc(rec.cover_after)}" alt="${esc(rec.name)}" loading="lazy">
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

  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => switchView(t.dataset.view); });
  $('#sort').onchange = (e) => { state.sort = e.target.value; loadRecipes(true); };
  $('#category').onchange = (e) => { state.category = e.target.value; loadRecipes(true); };
  $('#search').onkeydown = (e) => {
    if (e.key === 'Enter') { state.search = $('#search').value.trim(); if (state.view !== 'community') switchView('community'); else loadRecipes(true); }
  };
  $('#loadMore').onclick = () => { state.page += 1; loadRecipes(false); };
  $('#publishBtn').onclick = () => {
    if (!state.user) { toast('请先登录'); openAuth('login'); return; }
    $('#publishError').textContent = '';
    $('#publishModal').classList.add('open');
  };
  $('#authSubmit').onclick = submitAuth;
  $('#authToggle').onclick = () => openAuth(state.authMode === 'login' ? 'register' : 'login');
  $('#publishSubmit').onclick = submitPublish;

  document.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => b.closest('.modal').classList.remove('open'); });
  document.querySelectorAll('.modal').forEach((m) => { m.onclick = (e) => { if (e.target === m) m.classList.remove('open'); }; });
  document.querySelectorAll('.steps input[type=range]').forEach((r) => {
    r.oninput = () => { document.querySelector('.val[data-for="' + r.id + '"]').textContent = r.value; };
  });
});
