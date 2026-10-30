/* Shared Darkroom Credits, Daily Check-in, 163 Email Verification & Alipay Patronage Modal */
(() => {
  const TOKEN_KEY = 'landscape:token';
  const USER_KEY = 'landscape:user';
  const LEGACY_TOKEN_KEY = 'cd_token';
  const LEGACY_USER_KEY = 'cd_user';

  const isCommunitySubdir = /\/community(\/|$)/.test(location.pathname);
  const apiBase = isCommunitySubdir ? '../' : '';
  const qrAssetUrl = isCommunitySubdir ? '../assets/alipay-sponsor.jpg' : 'assets/alipay-sponsor.jpg';

  function getToken() {
    try {
      return (localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || '').trim();
    } catch {
      return '';
    }
  }

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY) || localStorage.getItem(LEGACY_USER_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveUser(user, token) {
    if (!user || typeof user !== 'object') return;
    try {
      const serialized = JSON.stringify(user);
      localStorage.setItem(USER_KEY, serialized);
      localStorage.setItem(LEGACY_USER_KEY, serialized);
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(LEGACY_TOKEN_KEY, token);
      }
    } catch {}
    window.dispatchEvent(new CustomEvent('landscape:user-updated', { detail: { user, token } }));
    try {
      if (window.parent && window.parent !== window) {
        window.parent.dispatchEvent(new CustomEvent('landscape:user-updated', { detail: { user, token } }));
      }
    } catch {}
  }

  async function requestJson(path, { method = 'GET', body = null } = {}) {
    const headers = {};
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== null) headers['Content-Type'] = 'application/json';
    try {
      const res = await fetch(apiBase + path.replace(/^\//, ''), {
        method, headers, body: body !== null ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (getToken() !== token) return {ok:false,status:409,data:{error:'登录状态已改变，请重新打开积分窗口。'}};
      return { ok: res.ok, status: res.status, data };
    } catch {
      return {ok:false,status:0,data:{error:'网络连接失败，请稍后重试。'}};
    }
  }

  let modalEl = null;
  let activeTab = 'redeem';
  let busy = false, opener = null, identity = getToken();
  function sessionChanged(){
    if(identity===getToken())return;
    identity=getToken();
    if(modalEl){modalEl.querySelectorAll('input').forEach(input=>input.value='');close();}
  }

  function ensureModal() {
    if (modalEl) return modalEl;
    const wrap = document.createElement('div');
    wrap.id = 'creditSponsorModal';
    wrap.className = 'cs-modal-backdrop';
    wrap.hidden = true;
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'csModalTitle');
    wrap.innerHTML = `
      <div class="cs-modal-card" @click.stop>
        <div class="cs-modal-top">
          <div>
            <p class="cs-kicker">DARKROOM CREDITS &amp; PATRONAGE // 显影积分与赞助</p>
            <h2 class="cs-title" id="csModalTitle">显影积分 · 兑换码与赞助支持</h2>
          </div>
          <button type="button" class="cs-close" id="csCloseBtn" aria-label="关闭积分与赞助窗口">&times;</button>
        </div>

        <div class="cs-balance-bar">
          <div class="cs-balance-num">
            当前显影积分：<strong id="csCreditCount">10</strong> 积分
            <span id="csEmailBadge" style="font-size:12px;color:#6e4e27;margin-left:8px;"></span>
          </div>
          <button type="button" class="cs-btn ghost" id="csQuickCheckinBtn">📅 每日签到 (+3)</button>
        </div>

        <div class="cs-tabs" role="tablist" aria-label="积分获取方式">
          <button type="button" class="cs-tab-btn active" data-cs-tab="redeem" role="tab" aria-selected="true">🎁 兑换码核销</button>
          <button type="button" class="cs-tab-btn" data-cs-tab="sponsor" role="tab" aria-selected="false">✦ 赞助开发者</button>
          <button type="button" class="cs-tab-btn" data-cs-tab="email" role="tab" aria-selected="false">✉️ 绑定邮箱 (+5)</button>
        </div>

        <!-- Tab 1: Redeem Code -->
        <div class="cs-section" data-cs-panel="redeem">
          <p class="cs-hint">
            输入站长发放的 24 小时有效专属兑换码（格式如 <code>LC-XXXX-XXXX</code>），核销后积分立即到账。新用户也可输入体验口令 <code>LANDSCAPE2026</code> 领取 +10 积分。
          </p>
          <div class="cs-input-row">
            <input type="text" class="cs-input" id="csRedeemInput" placeholder="输入兑换码，例如 LC-8F9A-2K4M 或 LANDSCAPE2026" maxlength="40" aria-label="积分兑换码">
            <button type="button" class="cs-btn" id="csRedeemSubmitBtn">立即核销兑换</button>
          </div>
          <p class="cs-hint" style="font-size:11.5px;color:#7a7265;">
            规则说明：每次云端千问 AI 建议消耗 1 显影积分；本地手动精修、预设、蒙版与相框导出完全免费。赞助兑换码自生成起 24 小时内有效，使用一次后自动核销。
          </p>
        </div>

        <!-- Tab 2: Alipay Sponsor + Auto 24h Code -->
        <div class="cs-section" data-cs-panel="sponsor" hidden>
          <div class="cs-sponsor-grid">
            <div class="cs-qr-frame">
              <img src="${qrAssetUrl}" alt="支付宝扫码赞助收款码">
              <div class="cs-qr-caption">
                <strong>推荐使用支付宝扫码赞助</strong><br>
                收款人：Ezio · 个人开发维护
              </div>
            </div>
            <div>
              <div class="cs-tiers">
                <div class="cs-tier-card"><span>随喜支持 ¥5</span><strong>+20 积分</strong></div>
                <div class="cs-tier-card"><span>暗房常客 ¥10</span><strong>+50 积分</strong></div>
                <div class="cs-tier-card"><span>馆藏赞助 ¥20</span><strong>+100 积分</strong></div>
              </div>
              <p class="cs-hint" style="margin-bottom:10px;">
                本项目云端 AI 建议接入个人千问 API。完成支付宝扫码后，在下方填写你的接收邮箱并提交，站长在邮件中一键确认后，系统将<strong>当场生成 24 小时有效的单次兑换码</strong>并自动发送至你的邮箱。
              </p>
              <div class="cs-input-row" style="margin-bottom:8px;">
                <input type="email" class="cs-input" id="csSponsorEmail" placeholder="接收兑换码的邮箱（如 xxx@163.com）" aria-label="接收兑换码的邮箱">
              </div>
              <div class="cs-input-row">
                <input type="text" class="cs-input" id="csSponsorNote" placeholder="赞助备注（选填，如：支付宝已转 10 元）" maxlength="120" aria-label="赞助备注">
                <button type="button" class="cs-btn" id="csSponsorNotifyBtn">我已完成赞助，申请发码</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Tab 3: 163 / Email Verification (+5 Bonus Credits) -->
        <div class="cs-section" data-cs-panel="email" hidden>
          <p class="cs-hint">
            绑定并验证你的邮箱，不仅可用于找回身份与自动接收赞助兑换码，<strong>首次完成邮箱验证还可立即获赠 +5 显影积分</strong>。
          </p>
          <div class="cs-input-row">
            <input type="email" class="cs-input" id="csBindEmailInput" placeholder="输入你的邮箱地址（支持 163 / QQ / Gmail 等）" aria-label="绑定邮箱地址">
            <button type="button" class="cs-btn ghost" id="csSendEmailCodeBtn">发送 6 位验证码</button>
          </div>
          <div class="cs-input-row">
            <input type="text" class="cs-input" id="csBindCodeInput" placeholder="输入邮件中的 6 位数字验证码" maxlength="6" inputmode="numeric" aria-label="邮箱验证码">
            <button type="button" class="cs-btn" id="csVerifyEmailBtn">验证并领取 +5 积分</button>
          </div>
        </div>

        <div id="csFeedback" class="cs-feedback" hidden role="status"></div>
      </div>
    `;
    document.body.appendChild(wrap);
    modalEl = wrap;

    wrap.addEventListener('click', e => {
      if (e.target === wrap) close();
    });
    wrap.querySelector('#csCloseBtn').addEventListener('click', close);
    document.addEventListener('keydown', e => {
      if (!modalEl || modalEl.hidden) return;
      if (e.key === 'Escape') {e.preventDefault();e.stopPropagation();close();}
      if (e.key === 'Tab') {
        const items=[...modalEl.querySelectorAll('button,input,select')].filter(el=>!el.disabled&&el.getClientRects().length);
        const first=items[0],last=items.at(-1);
        if(!modalEl.contains(document.activeElement)||(e.shiftKey&&document.activeElement===first)||(!e.shiftKey&&document.activeElement===last)){
          e.preventDefault();(e.shiftKey?last:first)?.focus();
        }
      }
    });

    wrap.querySelectorAll('[data-cs-tab]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.csTab));
    });

    wrap.querySelector('#csQuickCheckinBtn').addEventListener('click', () => checkin());
    wrap.querySelector('#csRedeemSubmitBtn').addEventListener('click', () => submitRedeem());
    wrap.querySelector('#csRedeemInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitRedeem();
      }
    });

    wrap.querySelector('#csSponsorNotifyBtn').addEventListener('click', () => submitSponsorNotify());
    wrap.querySelector('#csSendEmailCodeBtn').addEventListener('click', () => sendEmailCode());
    wrap.querySelector('#csVerifyEmailBtn').addEventListener('click', () => verifyEmailCode());
    wrap.querySelector('#csBindCodeInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        verifyEmailCode();
      }
    });

    return modalEl;
  }

  function showFeedback(msg, isError = false) {
    const el = ensureModal().querySelector('#csFeedback');
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.className = 'cs-feedback ' + (isError ? 'err' : 'ok');
    el.textContent = msg;
  }

  function renderModalState() {
    if (!modalEl) return;
    const user = getUser();
    const countEl = modalEl.querySelector('#csCreditCount');
    const checkinBtn = modalEl.querySelector('#csQuickCheckinBtn');
    const emailBadge = modalEl.querySelector('#csEmailBadge');
    const sponsorEmail = modalEl.querySelector('#csSponsorEmail');
    const bindEmail = modalEl.querySelector('#csBindEmailInput');

    if (user) {
      const credits = Number.isFinite(Number(user.credits)) ? Number(user.credits) : 10;
      countEl.textContent = String(credits);
      if (user.checked_in_today) {
        checkinBtn.textContent = '✓ 今日已签到';
        checkinBtn.disabled = true;
      } else {
        checkinBtn.textContent = '📅 每日签到 (+3)';
        checkinBtn.disabled = busy;
      }
      if (user.email_verified && user.email) {
        emailBadge.textContent = `· 已绑定邮箱 ${user.email}`;
        if (!sponsorEmail.value) sponsorEmail.value = user.email;
        if (!bindEmail.value) bindEmail.value = user.email;
      } else {
        emailBadge.textContent = '· 绑定邮箱可领 +5 积分';
      }
    } else {
      countEl.textContent = '未登录';
      checkinBtn.textContent = '登录后可签到 (+3)';
      checkinBtn.disabled = false;
      emailBadge.textContent = '';
    }
  }

  function switchTab(tab) {
    activeTab = tab || 'redeem';
    const el = ensureModal();
    el.querySelectorAll('[data-cs-tab]').forEach(btn => {
      const isMatch = btn.dataset.csTab === activeTab;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
    });
    el.querySelectorAll('[data-cs-panel]').forEach(panel => {
      panel.hidden = panel.dataset.csPanel !== activeTab;
    });
    showFeedback('');
  }

  async function refresh() {
    if (!getToken()) {
      renderModalState();
      return null;
    }
    const res = await requestJson('/api/credits/status');
    if (res.ok && res.data?.user) {
      saveUser(res.data.user);
      renderModalState();
      return res.data.user;
    }
    renderModalState();
    return null;
  }

  function open(tab = 'redeem') {
    sessionChanged();
    opener=document.activeElement;
    const el = ensureModal();
    switchTab(tab);
    renderModalState();
    el.hidden = false;
    el.querySelector('#csCloseBtn').focus();
    refresh();
  }

  function close() {
    if (!modalEl) return;
    modalEl.hidden = true;
    showFeedback('');
    if(opener?.isConnected&&opener.getClientRects().length)opener.focus();
  }

  async function checkin({ silentToast } = {}) {
    if (busy) return null;
    if (!getToken()) {
      open('redeem');
      showFeedback('请先登录账号后再进行每日签到（新用户注册即送 10 显影积分）。', true);
      return null;
    }
    busy = true;
    renderModalState();
    try {
      const res = await requestJson('/api/credits/checkin', { method: 'POST', body: {} });
      if (res.ok && res.data?.user) {
        saveUser(res.data.user);
        renderModalState();
        if (modalEl && !modalEl.hidden) {
          showFeedback(res.data.message || '签到成功！显影积分 +3');
        }
        if (typeof silentToast === 'function') silentToast(res.data.message || '签到成功！显影积分 +3');
        return res.data;
      } else {
        if (res.data?.checked_in_today) {
          const u = getUser();
          if (u) {
            u.checked_in_today = true;
            if (Number.isFinite(res.data.credits)) u.credits = res.data.credits;
            saveUser(u);
          }
        }
        const errMsg = res.data?.error || '签到失败，请稍后重试';
        if (modalEl && !modalEl.hidden) showFeedback(errMsg, true);
        if (typeof silentToast === 'function') silentToast(errMsg, true);
        return res.data;
      }
    } finally {
      busy = false;
      renderModalState();
    }
  }

  async function submitRedeem() {
    if (busy) return;
    if (!getToken()) {
      showFeedback('请先登录账号后再核销兑换码。', true);
      return;
    }
    const input = ensureModal().querySelector('#csRedeemInput');
    const code = (input.value || '').trim().toUpperCase();
    if (!code) {
      showFeedback('请输入兑换码', true);
      return;
    }
    busy = true;
    try {
      const res = await requestJson('/api/credits/redeem', { method: 'POST', body: { code } });
      if (res.ok && res.data?.user) {
        input.value = '';
        saveUser(res.data.user);
        renderModalState();
        showFeedback(res.data.message || `兑换成功！+${res.data.added} 显影积分`);
      } else {
        showFeedback(res.data?.error || '兑换失败，请检查兑换码是否正确或是否已过期', true);
      }
    } finally {
      busy = false;
    }
  }

  async function submitSponsorNotify() {
    if (busy) return;
    const el = ensureModal();
    const email = (el.querySelector('#csSponsorEmail').value || '').trim();
    const amount_note = (el.querySelector('#csSponsorNote').value || '').trim();
    if (!email) {
      showFeedback('请填写用于接收 24 小时兑换码的邮箱地址', true);
      return;
    }
    busy = true;
    try {
      const res = await requestJson('/api/credits/sponsor-notify', {
        method: 'POST',
        body: { email, amount_note },
      });
      if (res.ok) {
        el.querySelector('#csSponsorNote').value = '';
        showFeedback(res.data?.message || '已通知站长！确认收款后将自动发送 24 小时有效兑换码至你的邮箱。');
      } else {
        showFeedback(res.data?.error || '提交失败，请稍后重试', true);
      }
    } finally {
      busy = false;
    }
  }

  async function sendEmailCode() {
    if (busy) return;
    const el = ensureModal();
    const email = (el.querySelector('#csBindEmailInput').value || '').trim();
    if (!email) {
      showFeedback('请输入需要绑定的邮箱地址', true);
      return;
    }
    busy = true;
    try {
      const res = await requestJson('/api/auth/email/send-code', {
        method: 'POST',
        body: { email, purpose: getToken() ? 'bind' : 'login' },
      });
      if (res.ok) {
        showFeedback(res.data?.message || '验证码已发送至邮箱，请在 10 分钟内输入');
      } else {
        showFeedback(res.data?.error || '验证码发送失败', true);
      }
    } finally {
      busy = false;
    }
  }

  async function verifyEmailCode() {
    if (busy) return;
    const el = ensureModal();
    const email = (el.querySelector('#csBindEmailInput').value || '').trim();
    const code = (el.querySelector('#csBindCodeInput').value || '').trim();
    if (!email || !code) {
      showFeedback('请填写邮箱地址与 6 位数字验证码', true);
      return;
    }
    busy = true;
    try {
      const res = await requestJson('/api/auth/email/verify', {
        method: 'POST',
        body: { email, code },
      });
      if (res.ok && res.data?.user) {
        el.querySelector('#csBindCodeInput').value = '';
        saveUser(res.data.user, res.data.token);
        renderModalState();
        showFeedback(res.data.message || '邮箱验证成功！');
      } else {
        showFeedback(res.data?.error || '验证码校验失败', true);
      }
    } finally {
      busy = false;
    }
  }

  window.addEventListener('storage', sessionChanged);
  window.addEventListener('landscape:user-updated', () => {
    sessionChanged();renderModalState();
  });

  window.CreditSponsor = {
    open,
    close,
    checkin,
    refresh,
    saveUser, sessionChanged,
  };
})();
