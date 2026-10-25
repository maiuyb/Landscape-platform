/* Author portfolios reuse the community's public APIs, artwork details and image fallback. */
(() => {
  const PAGE_SIZE = 24;
  let route = null, generation = 0, user = null, total = 0;
  const el = id => document.getElementById(id);
  const active = () => !!route && document.documentElement.classList.contains('author-mode');

  function address(value, replace = false, notify = true) {
    const url = AuthorRoute.url(location.href, value);
    if (url.href === location.href) return;
    // The host owns browser history when embedded; the iframe only mirrors its address.
    history[replace || parent !== window ? 'replaceState' : 'pushState'](null, '', url);
    if (notify) window.dispatchEvent(new CustomEvent('landscape:author-route-change', { detail: { route: value, replace } }));
  }

  function leave({ notify = true } = {}) {
    if (!route) return;
    generation++;
    route = null; user = null;
    document.documentElement.classList.remove('author-mode');
    el('authorPage').hidden = true;
    el('authorShareFallback').hidden = true;
    document.title = '风景调色 · 社区';
    address(null, false, notify);
  }

  function refreshActions() {
    const owner = !!(user && state.user && user.id === state.user.id);
    for (const id of ['authorEdit', 'authorManage']) {
      if (el(id)) el(id).hidden = !owner;
    }
  }

  function publishTitle() {
    if (active() && user) window.dispatchEvent(new CustomEvent('landscape:author-title', { detail: { author: route.author, title: document.title } }));
  }

  function header() {
    const name = user.display_name || user.username;
    const avatar = user.avatar
      ? `<img data-original-src="${esc(uploadOriginalUrl(user.avatar))}" src="${esc(thumbUrl(user.avatar, 160))}" alt="${esc(name)}的头像">`
      : esc(userInitial(user));
    el('authorHeader').innerHTML = `
      <div class="author-identity"><div class="public-profile-avatar">${avatar}</div>
        <div class="author-intro"><div class="kicker">PHOTOGRAPHER’S PORTFOLIO</div>
          <h1 id="authorHeading" tabindex="-1">${esc(name)}</h1>
          <div class="public-profile-handle">@${esc(user.username)}</div>
          <p class="public-profile-bio">${esc(user.bio || '这位作者还没有填写简介。')}</p>
          <div class="public-profile-meta">${user.location ? `<span>${esc(user.location)}</span>` : ''}<span>加入于 ${esc(formatJoined(user.created_at))}</span></div>
        </div>
      </div>
      <div class="author-aside"><div class="author-stats"><span><b>${Number(user.works_count) || 0}</b>公开作品</span><span><b>${Number(user.favorites_received) || 0}</b>获收藏</span></div>
        <div class="author-actions"><button type="button" id="authorEdit" class="btn primary" hidden>编辑资料</button><button type="button" id="authorManage" class="btn ghost" hidden>管理作品</button><button type="button" id="authorShare" class="btn ghost">分享主页</button></div>
      </div>`;
    refreshActions();
    el('authorEdit').onclick = () => enterManagement('account');
    el('authorManage').onclick = () => enterManagement('mine');
    el('authorShare').onclick = share;
    document.title = `${name}的作品集 · 风景调色`;
    publishTitle();
  }

  function enterManagement(view) {
    if (!state.user || state.user.id !== route?.author) return;
    document.documentElement.classList.add('uc-mode');
    setUserCenterView(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'account') el('ucDisplayNameInput').focus({ preventScroll: true });
  }

  async function share() {
    // A shared link always opens the complete main site, including from the standalone community.
    const url = AuthorRoute.url(new URL('../', location.href), route).href;
    try { await copyText(url); toast('已复制主页链接'); }
    catch {
      el('authorShareFallback').hidden = false;
      el('authorShareUrl').value = url;
      el('authorShareUrl').focus(); el('authorShareUrl').select();
    }
  }

  function pagination() {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const box = el('authorPagination');
    box.hidden = pages <= 1;
    const numbers = [...new Set([1, route.page - 1, route.page, route.page + 1, pages])].filter(p => p >= 1 && p <= pages).sort((a,b) => a-b);
    let previous = 0;
    box.innerHTML = `<button type="button" class="page-btn" data-author-page="${route.page - 1}" ${route.page <= 1 ? 'disabled' : ''}>上一页</button>` + numbers.map(p => {
      const gap = previous && p > previous + 1 ? '<span class="page-ellipsis">…</span>' : '';
      previous = p;
      return gap + `<button type="button" class="page-num${p === route.page ? ' active' : ''}" data-author-page="${p}" ${p === route.page ? 'aria-current="page"' : ''}>${p}</button>`;
    }).join('') + `<button type="button" class="page-btn" data-author-page="${route.page + 1}" ${route.page >= pages ? 'disabled' : ''}>下一页</button>`;
  }

  async function render(value, { focus = false } = {}) {
    const next = AuthorRoute.normalize(value);
    if (!next) {
      leave({ notify: false });
      exitUserCenter(true);
      return;
    }
    const changedAuthor = route?.author !== next.author;
    route = next;
    const request = ++generation;
    state.listRequest = (state.listRequest || 0) + 1;
    state.loading = false;
    document.documentElement.classList.remove('uc-mode');
    document.documentElement.classList.add('author-mode');
    document.querySelector('.topbar')?.classList.remove('search-hidden');
    el('authorPage').hidden = false;
    el('ucAccountPanel').hidden = true;
    el('ucSettingsPanel').hidden = true;
    document.querySelector('.toolbar').style.display = '';
    el('detailModal').classList.remove('open');
    closeLightbox();
    el('authorToolbar').hidden = true;
    el('authorRetry').hidden = true;
    el('authorPagination').hidden = true;
    el('authorShareFallback').hidden = true;
    el('authorWorks').innerHTML = '';
    el('authorWorks').setAttribute('aria-busy', 'true');
    el('authorStatus').textContent = '正在布置作品展厅…';
    el('authorSort').value = route.sort;
    if (changedAuthor || !user) {
      user = null;
      el('authorHeader').innerHTML = '<h1 id="authorHeading" tabindex="-1">作者作品集</h1>';
    }
    let errorMessage = '暂时无法打开这位作者的主页，请检查链接或重新加载。';
    try {
      const [profile, works] = await Promise.all([
        api('/api/users/' + next.author),
        api(`/api/recipes?author_id=${next.author}&sort=${next.sort}&page=${next.page}&page_size=${PAGE_SIZE}`),
      ]);
      if (request !== generation || !active()) return;
      if (!profile.ok) {
        errorMessage = profile.status === 404 ? '这位作者不存在或主页已不可用。' : '暂时无法读取作者资料，请稍后重试。';
        throw Error('profile unavailable');
      }
      user = profile.data.user;
      header();
      if (!works.ok) { errorMessage = '作品暂时加载失败，请重试。'; throw Error('works unavailable'); }
      total = Number(works.data.total) || 0;
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      if (next.page > pages) {
        const corrected = { ...next, page: pages };
        address(corrected, true);
        return render(corrected, { focus });
      }
      const items = works.data.recipes || [];
      el('authorWorks').innerHTML = items.map(rec => {
        const cover = rec.cover_after || rec.cover_before;
        return `<button type="button" class="public-work author-work" data-work-id="${Number(rec.id)}" aria-label="查看作品：${esc(rec.name)}">
          <div class="author-work-mat"><img data-original-src="${esc(uploadOriginalUrl(cover))}" src="${esc(thumbUrl(cover, 800))}" srcset="${esc(thumbSrcset(cover))}" sizes="(max-width: 620px) 100vw, (max-width: 1000px) 50vw, 33vw" alt="${esc(rec.name)}" loading="lazy" decoding="async"></div>
          <div class="author-work-caption"><strong>${esc(rec.name)}</strong><span>☆ ${Number(rec.favorite_count) || 0}</span></div></button>`;
      }).join('');
      el('authorToolbar').hidden = false;
      el('authorWorkCount').textContent = `${total} 件公开作品`;
      el('authorStatus').textContent = total ? '' : '这里还没有公开作品，期待下一次光影相遇。';
      pagination();
      if (focus) {
        const target = el(changedAuthor ? 'authorHeading' : 'authorWorksHeading');
        target.focus({ preventScroll: true });
        if (changedAuthor) window.scrollTo({ top: 0, behavior: 'smooth' });
        else target.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    } catch {
      if (request !== generation || !active()) return;
      el('authorStatus').textContent = errorMessage;
      el('authorRetry').hidden = false;
    } finally {
      if (request === generation) el('authorWorks').setAttribute('aria-busy', 'false');
    }
  }

  function navigate(value, options = {}) {
    const next = AuthorRoute.normalize(value);
    address(next, !!options.replace);
    return render(next, { focus: true });
  }

  window.AuthorPortfolio = {
    active, leave, refreshActions, publishTitle,
    open: id => navigate({ author: id, sort: 'latest', page: 1 }),
    reload: () => route ? render(route) : Promise.resolve(),
    restore: value => {
      const next = AuthorRoute.normalize(value);
      if (JSON.stringify(next) === JSON.stringify(route)) { publishTitle(); return Promise.resolve(); }
      address(next, true, false);
      return render(next);
    },
  };
  document.addEventListener('DOMContentLoaded', () => {
    el('authorBack').onclick = () => exitUserCenter(true);
    el('authorSort').onchange = e => navigate({ ...route, sort: e.target.value, page: 1 });
    el('authorRetry').onclick = () => render(route);
    el('authorWorks').onclick = e => { const work = e.target.closest('[data-work-id]'); if (work) openDetail(Number(work.dataset.workId)); };
    el('authorPagination').onclick = e => {
      const button = e.target.closest('[data-author-page]');
      if (button && !button.disabled) navigate({ ...route, page: Number(button.dataset.authorPage) });
    };
    const initial = AuthorRoute.parse(location.search);
    if (initial) render(initial);
  });
  window.addEventListener('popstate', () => { if (parent === window) render(AuthorRoute.parse(location.search)); });
})();
