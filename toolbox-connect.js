/**
 * Toolbox: connect an AI assistant (Claude, ChatGPT, …) to dayfly over MCP.
 * The server issues a personal key that is shown once, with setup snippets.
 * Only its identifier is kept, in the synced dayfly-connections-v1 store, so
 * replacing or turning off the key revokes the old one once this device syncs.
 * The card is one persistent element, so re-rendering the Toolbox never loses
 * a key that is still on screen.
 */
(function () {
  const KEY = 'dayfly-connections-v1';
  const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
  const owner = () => window.DailySpaceView?.owner() || 'guest';
  const ready = () => window.DailySpaceWorkbenchPreferences?.ready() === true;
  const usable = () => ready() && owner() !== 'guest';
  let root = null, render = () => {};

  function read() {
    try { const value = JSON.parse(localStorage.getItem(KEY) || 'null'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
    catch (_) { return {}; }
  }
  const activeKeyId = () => { const id = read().mcpKeyId; return typeof id === 'string' && id ? id : null; };

  function save(change) {
    const raw = JSON.stringify({ ...read(), version: 1, ...change });
    localStorage.setItem(KEY, raw);
    if (localStorage.getItem(KEY) !== raw) throw new Error('This device did not keep the change.');
    // Local changes schedule the account sync that activates or revokes the key.
    window.dispatchEvent(new CustomEvent('daily-space-agent-data-updated', { detail: { domains: ['connections'], source: 'toolbox-connect' } }));
  }

  function build() {
    const node = (tag, cls = '', text = '') => { const el = document.createElement(tag); if (cls) el.className = cls; if (text) el.textContent = text; return el; };
    const copy = (el, en, zh) => { el.dataset.connectEn = en; el.dataset.connectZh = zh; el.textContent = t(en, zh); return el; };
    const button = (en, zh, run) => { const el = copy(node('button'), en, zh); el.type = 'button'; el.addEventListener('click', run); return el; };
    root = node('details', 'toolbox-connect'); root.dataset.i18nIgnore = ''; root.dataset.connect = '';

    const summary = node('summary');
    const icon = node('span', 'toolbox-icon'); icon.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(key, value);
    const plug = document.createElementNS(svg.namespaceURI, 'path'); plug.setAttribute('d', 'M9 2v6 M15 2v6 M6 8h12v3a6 6 0 0 1-12 0z M12 17v5'); svg.append(plug); icon.append(svg);
    const title = node('span', 'toolbox-connect-title'), state = node('span', 'toolbox-connect-state');
    title.append(copy(node('strong'), 'Connect an AI assistant (MCP)', '连接 AI 助手（MCP）'), state);
    const chevron = node('span', 'toolbox-connect-chevron', '›'); chevron.setAttribute('aria-hidden', 'true');
    summary.append(icon, title, chevron);

    const body = node('div', 'toolbox-connect-body');
    const help = copy(node('p'), 'Let Claude, ChatGPT or another assistant that supports MCP work with your dayfly data.', '让 Claude、ChatGPT 或其他支持 MCP 的助手使用你的 dayfly 数据。');
    const scope = copy(node('p', 'toolbox-connect-scope'), 'The key can read and change your tasks, expenses and reminders. Keep it private; you can turn it off here at any time.', '密钥可以读取和修改你的待办、账目和提醒。请妥善保管；随时可以在这里停用。');
    const status = node('p', 'toolbox-connect-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const create = button('Create key', '生成密钥', createKey); create.dataset.connectPrimary = '';
    const revoke = button('Turn off', '停用', turnOff);
    const actions = node('div', 'toolbox-connect-actions'); actions.append(create, revoke);

    const fields = [];
    function field(en, zh, copyEn, copyZh, kind = 'input') {
      const label = node('label', 'toolbox-connect-field'), control = node(kind);
      control.readOnly = true; control.spellcheck = false; control.setAttribute('autocomplete', 'off'); control.setAttribute('autocapitalize', 'off');
      if (kind === 'textarea') control.rows = 3; else control.type = 'text';
      control.addEventListener('focus', () => control.select());
      const copyButton = button('Copy', '复制', async () => {
        clearTimeout(copyButton.resetTimer);
        try { await navigator.clipboard.writeText(control.value); copyButton.textContent = t('Copied', '已复制'); }
        catch (_) { control.focus(); control.select(); copyButton.textContent = t('Select and copy', '请手动复制'); }
        copyButton.resetTimer = setTimeout(() => { copyButton.textContent = t('Copy', '复制'); }, 2500);
      });
      copyButton.dataset.connectLabelEn = copyEn; copyButton.dataset.connectLabelZh = copyZh;
      const row = node('span', kind === 'textarea' ? 'toolbox-connect-row is-stacked' : 'toolbox-connect-row'); row.append(control, copyButton);
      label.append(copy(node('span'), en, zh), row); fields.push(control);
      return { label, control };
    }
    const reveal = node('div', 'toolbox-connect-reveal'); reveal.hidden = true;
    const endpoint = field('Endpoint', '接口地址', 'Copy endpoint', '复制接口地址');
    const secret = field('Key (Authorization: Bearer) — shown only once', '密钥（Authorization: Bearer）— 只显示这一次', 'Copy key', '复制密钥');
    const claudeCode = field('Claude Code — run in a terminal', 'Claude Code — 在终端中运行', 'Copy Claude Code command', '复制 Claude Code 命令', 'textarea');
    const pathUrl = field('Claude, ChatGPT and other apps that take only a URL', '只能填写网址的 Claude、ChatGPT 等应用', 'Copy connector address', '复制连接器地址');
    const urlWarning = copy(node('p', 'toolbox-connect-warning'), 'This address contains your key: anyone who has it can read and change your data. Paste it only into your own assistant.', '这个地址包含你的密钥：任何拿到它的人都能读取和修改你的数据。只粘贴到你自己的助手里。');
    const hide = button('Hide key', '隐藏密钥', () => { clearReveal(); render(); create.focus({ preventScroll: true }); });
    reveal.append(endpoint.label, secret.label, claudeCode.label, pathUrl.label, urlWarning, hide);
    body.append(help, scope, status, actions, reveal); root.append(summary, body);

    let busy = false, notice = null, shown = null;
    function clearReveal() { shown = null; reveal.hidden = true; for (const control of fields) control.value = ''; }

    async function createKey() {
      // Guests get the existing account dialog instead of a key.
      if (owner() === 'guest') { document.querySelector('.sidebar-auth-entry')?.click(); return; }
      if (busy || !usable()) return;
      const who = owner(), replacing = Boolean(activeKeyId());
      busy = true; notice = null; clearReveal(); render();
      try {
        const response = await fetch('/api/mcp/key', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || '' }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.token || !data.keyId || !data.endpoint || !data.pathEndpoint) throw new Error(data.error || 'failed');
        if (who !== owner() || !usable()) throw new Error('changed');
        try { save({ mcpKeyId: data.keyId, mcpKeyCreatedAt: Date.now() }); } catch (_) { notice = 'storage'; return; }
        shown = { owner: who, keyId: data.keyId, token: data.token, replacing, working: false, checks: 0 };
        endpoint.control.value = data.endpoint; secret.control.value = data.token; pathUrl.control.value = data.pathEndpoint;
        claudeCode.control.value = `claude mcp add --transport http dayfly ${data.endpoint} --header "Authorization: Bearer ${data.token}"`;
        reveal.hidden = false;
        setTimeout(check, 4000);
      } catch (_) {
        notice = 'error';
      } finally { busy = false; render(); }
    }

    function turnOff() {
      if (busy || !usable() || !activeKeyId()) return;
      try { save({ mcpKeyId: null, mcpKeyCreatedAt: null }); } catch (_) { notice = 'storage'; render(); return; }
      clearReveal(); notice = 'off'; render(); create.focus({ preventScroll: true });
    }

    /** Once this device has synced the new identifier, the key answers a ping. */
    async function check() {
      const current = shown;
      if (!current || current.working || current.checking || current.checks >= 8) return;
      current.checking = true; current.checks += 1;
      try {
        const response = await fetch('/api/mcp', { method: 'POST', credentials: 'omit', cache: 'no-store',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${current.token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
        if (response.ok && shown === current) { current.working = true; render(); }
      } catch (_) { /* The status keeps saying the key starts working after sync. */ }
      finally { current.checking = false; }
    }

    function message(active) {
      if (!ready()) return t('Your workspace is loading…', '工作台正在加载…');
      if (owner() === 'guest') return t('Sign in with Google to connect an assistant. Guest data stays on this device, so an assistant cannot reach it.', '使用 Google 登录后才能连接助手。访客数据只保存在本机，助手无法访问。');
      if (notice === 'error') return t('Could not create a key. Check your connection and sign-in, then try again.', '生成密钥失败，请检查网络和登录状态后重试。');
      if (notice === 'storage') return t('Could not save on this device. Free some space, then try again.', '无法保存到本机，请释放空间后重试。');
      if (shown) {
        const replaced = shown.replacing ? ` ${t('The previous key stops working at the same time.', '旧密钥会同时失效。')}` : '';
        return shown.working ? t('Key created and working. Copy it now: it is shown only once.', '密钥已生成并已生效。请现在复制：它只显示这一次。')
          : t('Key created. Copy it now: it is shown only once. It starts working a few seconds after this device syncs.', '密钥已生成。请现在复制：它只显示这一次。本机同步后几秒内生效。') + replaced;
      }
      if (active) {
        const created = Number(read().mcpKeyCreatedAt);
        const since = created > 0 ? new Date(created).toLocaleDateString(window.DailySpaceI18n?.localeTag?.() || undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
        return since ? t(`On since ${since}. One key is active.`, `自 ${since} 起开启，当前有一个生效的密钥。`) : t('On. One key is active.', '已开启，当前有一个生效的密钥。');
      }
      if (notice === 'off') return t('Turned off. The key stops working once this device syncs.', '已停用。本机同步后密钥即失效。');
      return t('Off. No assistant can reach your data.', '未开启，任何助手都无法访问你的数据。');
    }

    render = function () {
      root.querySelectorAll('[data-connect-en]').forEach(el => { el.textContent = t(el.dataset.connectEn, el.dataset.connectZh); });
      root.querySelectorAll('[data-connect-label-en]').forEach(el => el.setAttribute('aria-label', t(el.dataset.connectLabelEn, el.dataset.connectLabelZh)));
      const active = activeKeyId(), member = owner() !== 'guest';
      // Another account, or a key replaced or turned off elsewhere: the key on screen is no longer this workspace's.
      if (shown && (shown.owner !== owner() || shown.keyId !== active)) clearReveal();
      state.textContent = !member ? t('Sign in to use', '登录后可用') : active ? t('On', '已开启') : t('Off', '未开启');
      create.disabled = busy || !ready();
      create.textContent = !member ? t('Sign in', '登录') : busy ? t('Creating…', '正在生成…') : active ? t('Replace key', '更换密钥') : t('Create key', '生成密钥');
      revoke.hidden = !active || !member; revoke.disabled = busy || !usable();
      status.textContent = message(active);
      status.classList.toggle('is-error', notice === 'error' || notice === 'storage');
    };

    for (const event of ['daily-space-auth-updated', 'daily-space-locale-changed']) window.addEventListener(event, () => render());
    window.addEventListener('daily-space-user-sync-updated', event => { if (event.detail?.status === 'ok') check(); render(); });
    window.addEventListener('daily-space-agent-data-updated', event => { if (event.detail?.domains?.includes('connections') && event.detail.source !== 'toolbox-connect') render(); });
    window.addEventListener('storage', event => { if (event.key === KEY || event.key === null) render(); });
  }

  window.DailySpaceAssistantConnect = {
    /** The card element, created once; Toolbox appends it wherever it renders its groups. */
    element() { if (!root) build(); render(); return root; },
  };
})();
