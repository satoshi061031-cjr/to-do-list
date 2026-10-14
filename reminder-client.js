/** Opt-in background push for Google; Guest schedules never leave this device. */
(function () {
  const TODO = 'todo-app-v2', CALENDAR = 'calendar-app-v1';
  const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
  const read = key => { try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) { return {}; } };
  const owner = () => read('daily-space-auth-v1').email || 'guest';
  const signedIn = () => /google|gmail/i.test(read('daily-space-auth-v1').provider || '') && owner() !== 'guest';
  const permission = () => typeof Notification === 'function' ? Notification.permission : 'unsupported';
  let setupDone = false, enabled = false, configuration = null, subscription = null, status = '', syncReady = false, syncing = false, needsSync = false, localTick = false, checking = false;
  let generation = 0;
  function jobs() {
    const todos = read(TODO).todos || []; const reminders = read(CALENDAR).reminders || [];
    const sources = new Set(reminders.map(item => item.id)); const out = [];
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; const now = Date.now();
    function add(kind, item, date, time) {
      const dueAt = Number.isFinite(item.remindAt) && item.remindAt > 0 ? item.remindAt : new Date(`${date}T${/^\d{2}:\d{2}$/.test(time || '') ? time : '19:00'}:00`).getTime();
      if (!Number.isSafeInteger(dueAt) || dueAt < now - 86400000 || dueAt > now + 366 * 86400000) return;
      out.push({ source: `${kind}:${item.id}`, dueAt, title: String(item.text || '').slice(0, 160), timeZone: zone,
        href: `${kind === 'todo' ? 'todo.html?focus=todo' : 'calendar.html?focus=reminder'}&id=${encodeURIComponent(item.id)}` });
    }
    for (const item of todos) { if (!item.completed && !(item.sourceReminderId && sources.has(item.sourceReminderId))) add('todo', item, item.dueDate, item.dueTime); }
    for (const item of reminders) { const linked = todos.find(todo => todo.sourceReminderId === item.id || item.linkedTodoId === todo.id); if (!linked?.completed) add('reminder', item, item.date, item.startTime); }
    return out.slice(0, 500);
  }
  async function registration() {
    if (!navigator.serviceWorker || window.Capacitor?.isNativePlatform?.()) return null;
    try {
      return await Promise.race([navigator.serviceWorker.ready, new Promise(resolve => setTimeout(() => resolve(null), 2000))]);
    } catch (_) { return null; }
  }
  async function request(path, method, body, keepalive = false) {
    const response = await fetch(`/api/reminders/${path}`, { method, credentials: 'same-origin', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {}), keepalive });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(value.error || 'Reminder request failed.'), { status: response.status });
    return value;
  }
  function message() {
    if (status) return status;
    if (permission() === 'unsupported') return t('Notifications are unavailable here. On iPhone, add this site to the Home Screen first.', '此浏览器暂不支持通知。iPhone 请先将网站添加到主屏幕。');
    if (!signedIn()) return t('Guest reminders stay on this device and require this page to remain open.', 'Guest 提醒保留在本机，需要保持页面打开。');
    if (enabled) return t('Background reminders on. Closing the page is fine. Untimed tasks remind at 19:00.', '后台提醒已开启，可以关闭页面。未设时间的任务会在 19:00 提醒。');
    if (configuration?.configured === false) return t('Background push needs server configuration. Local alerts still work while this page is open.', '后台推送尚待服务器配置；页面打开时仍可使用本地提醒。');
    return t('Enable reminders on this device to receive alerts after closing the page.', '在此设备开启提醒，关闭页面后也能接收通知。');
  }
  function render() {
    for (const root of document.querySelectorAll('.reminder-settings')) {
      root.querySelector('summary').textContent = t('Reminders', '提醒');
      root.querySelector('[role=status]').textContent = message();
      const control = root.querySelector('button'); control.textContent = enabled ? t('Turn off background reminders', '关闭此设备后台提醒') : t('Enable reminders', '开启提醒');
      control.disabled = permission() === 'unsupported' || permission() === 'denied';
      if (permission() === 'denied') root.querySelector('[role=status]').textContent = t('Notifications are blocked. Allow this site in browser settings, then reload.', '通知权限被阻止，请在浏览器设置中允许此网站通知后刷新。');
    }
  }
  async function refresh() {
    const currentGeneration = generation; const currentOwner = owner();
    if (!signedIn()) { enabled = false; configuration = null; render(); return; }
    checking = true;
    try {
      const reg = await registration(); const sub = await reg?.pushManager?.getSubscription();
      subscription = sub || null;
      const result = await request(`status${sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ''}`, 'GET');
      if (currentGeneration !== generation || currentOwner !== owner()) return;
      subscription = sub || null; configuration = result; enabled = result.enabled && permission() === 'granted';
      // Subscription ownership may change after sign-out: delete an unregistered browser key first.
      if (sub && !result.enabled) { await sub.unsubscribe(); subscription = null; }
      render(); if (enabled) await sync();
    } catch (_) { if (currentGeneration === generation) { enabled = Boolean(subscription) && permission() === 'granted'; status = t('Cannot check background reminders. Reconnect and try again.', '暂时无法检查后台提醒，请联网后重试。'); render(); } }
    finally { if (currentGeneration === generation) checking = false; }
  }
  async function enable() {
    status = '';
    if (permission() === 'unsupported' || permission() === 'denied') { render(); return permission(); }
    // Request in the initiating gesture, before networking or service worker startup.
    const perm = permission() === 'granted' ? 'granted' : await Notification.requestPermission().catch(() => permission());
    if (perm !== 'granted' || !signedIn()) { render(); await tick(); return perm; }
    const currentOwner = owner(), currentGeneration = generation;
    checking = true;
    try {
      configuration = await request('status', 'GET');
      if (!configuration.configured) { enabled = false; render(); await tick(); return perm; }
      if (!syncReady) { status = t('Wait for account sync to finish before enabling background reminders.', '请先等待账户同步完成，再开启后台提醒。'); render(); return perm; }
      const reg = await registration(); if (!reg?.pushManager) throw new Error('Push unavailable');
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const data = atob(configuration.publicKey.replace(/-/g, '+').replace(/_/g, '/'));
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(data, char => char.charCodeAt(0)) });
      }
      if (currentOwner !== owner() || currentGeneration !== generation) { await sub.unsubscribe(); return perm; }
      await request('subscription', 'POST', { subscription: sub.toJSON(), jobs: jobs() });
      if (currentOwner !== owner() || currentGeneration !== generation) { await sub.unsubscribe(); return perm; }
      subscription = sub; enabled = true;
    } catch (_) { enabled = false; status = t('Background reminders could not be enabled. Local alerts work while the page is open; try again when connected.', '后台提醒开启失败。页面打开时可使用本地提醒，请联网后重试。'); }
    finally { if (currentGeneration === generation) checking = false; }
    render(); return perm;
  }
  async function disable() {
    try {
      if (subscription && signedIn()) await request('subscription', 'DELETE', { endpoint: subscription.endpoint });
      const reg = await registration(); const sub = await reg?.pushManager?.getSubscription(); await sub?.unsubscribe();
      subscription = null; enabled = false; status = t('Background reminders off on this device.', '已关闭此设备后台提醒。');
    } catch (_) { status = t('Could not turn off reminders. Reconnect and try again.', '关闭提醒失败，请联网后重试。'); }
    render();
  }
  async function sync() {
    if (!enabled || !signedIn() || !syncReady) return;
    if (syncing) { needsSync = true; return; }
    syncing = true; const currentGeneration = generation;
    try { await request('schedule', 'PUT', { jobs: jobs() }); if (generation === currentGeneration) { status = ''; render(); } }
    catch (_) { if (generation === currentGeneration) { status = t('Reminder changes have not reached the server. Reconnect before closing the page.', '提醒更改尚未同步到服务器，请联网同步后再关闭页面。'); render(); } }
    finally { syncing = false; if (needsSync) { needsSync = false; sync(); } }
  }
  async function defer(kind, id, delay) {
    const key = kind === 'todo' ? TODO : CALENDAR; const state = read(key); const item = (state[kind === 'todo' ? 'todos' : 'reminders'] || []).find(value => value.id === id);
    if (!item || item.completed) return false;
    const now = new Date(); if (delay === 'tomorrow') { now.setDate(now.getDate() + 1); now.setHours(9, 0, 0, 0); } else now.setTime(now.getTime() + 600000);
    item.remindAt = now.getTime();
    // Keep a linked calendar reminder and its task on the same schedule.
    if (kind === 'todo' && item.sourceReminderId) {
      const calendar = read(CALENDAR); const reminder = calendar.reminders?.find(value => value.id === item.sourceReminderId);
      if (reminder) { reminder.remindAt = item.remindAt; localStorage.setItem(CALENDAR, JSON.stringify(calendar)); }
    }
    if (kind === 'reminder') {
      const tasks = read(TODO); const linked = tasks.todos?.find(task => task.sourceReminderId === item.id || task.id === item.linkedTodoId);
      if (linked?.completed) return false;
      if (linked) { linked.remindAt = item.remindAt; localStorage.setItem(TODO, JSON.stringify(tasks)); }
    }
    localStorage.setItem(key, JSON.stringify(state));
    status = delay === 'tomorrow' ? t('Reminder set for tomorrow at 09:00.', '已设为明天 09:00 提醒。') : t('Reminder set for 10 minutes from now.', '已设为 10 分钟后提醒。');
    window.dispatchEvent(new CustomEvent('daily-space-agent-data-updated', { detail: { domains: ['todo', 'calendar'] } }));
    render(); await sync(); return true;
  }
  async function tick() {
    if (enabled || checking || localTick || permission() !== 'granted') return;
    localTick = true; const currentOwner = owner(); const currentGeneration = generation;
    try {
      const key = `daily-space-local-alerts:${currentOwner}`; const fired = read(key); const reg = await registration(); const due = jobs().filter(job => job.dueAt <= Date.now());
      if (generation !== currentGeneration || owner() !== currentOwner || enabled) return;
      for (const job of due) {
        const tag = `${job.source}:${job.dueAt}`; if (fired[tag]) continue;
        const data = { href: job.href, source: job.source, owner: currentOwner };
        if (reg) await reg.showNotification('Daily Space', { body: job.title, tag, data, actions: [{ action: 'snooze', title: t('10 min later', '10 分钟后') }, { action: 'tomorrow', title: t('Tomorrow', '明天') }] });
        else { const note = new Notification('Daily Space', { body: job.title, tag }); note.onclick = () => { location.href = job.href; note.close(); }; }
        fired[tag] = Date.now();
      }
      for (const [key, time] of Object.entries(fired)) { if (time < Date.now() - 2 * 86400000) delete fired[key]; }
      localStorage.setItem(key, JSON.stringify(fired));
    } catch (_) { /* Permission can change between checking and showing an alert. */ }
    finally { localTick = false; }
  }
  function setup() {
    if (setupDone) return; setupDone = true;
    function boot() {
      const anchor = document.getElementById('todo-list') || document.getElementById('calendar-alerts-btn');
      if (anchor) {
        const root = document.createElement('details'); root.className = 'reminder-settings'; root.dataset.i18nIgnore = '';
        const summary = document.createElement('summary'); summary.textContent = t('Reminders', '提醒');
        const description = document.createElement('p'); description.setAttribute('role', 'status'); description.dataset.i18nIgnore = '';
        const control = document.createElement('button'); control.type = 'button'; control.addEventListener('click', () => { control.disabled = true; (enabled ? disable() : enable()).finally(render); });
        root.append(summary, description, control); anchor.after(root);
      }
      const params = new URLSearchParams(location.search);
      const source = params.get('localReminder'); const action = params.get('reminderAction');
      if (source && params.get('reminderOwner') === owner() && ['snooze', 'tomorrow'].includes(action)) {
        const [kind, ...id] = source.split(':'); if (['todo','reminder'].includes(kind)) defer(kind, id.join(':'), action === 'snooze' ? 10 : 'tomorrow');
        ['localReminder','reminderAction','reminderOwner'].forEach(key => params.delete(key)); history.replaceState(history.state, '', `${location.pathname}?${params}${location.hash}`);
      }
      render(); refresh().finally(tick);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
    window.addEventListener('daily-space-user-sync-updated', event => { syncReady = event.detail?.status === 'ok'; if (syncReady) sync(); });
    window.addEventListener('daily-space-agent-data-updated', () => { sync(); tick(); });
    window.addEventListener('storage', event => { if ([TODO, CALENDAR].includes(event.key)) { sync(); tick(); } });
    window.addEventListener('online', () => { status = ''; refresh(); });
    window.addEventListener('daily-space-locale-changed', render);
    window.addEventListener('daily-space-auth-updated', async () => { generation++; enabled = false; checking = false; syncReady = false; status = ''; configuration = null;
      if (!signedIn()) { const reg = await registration(); await (await reg?.pushManager?.getSubscription())?.unsubscribe(); }
      render(); refresh();
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); tick(); } });
    window.setInterval(tick, 30000);
  }
  window.DailySpaceReminders = { setup, enable, tick, defer, jobs };
})();
