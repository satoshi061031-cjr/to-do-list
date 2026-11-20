/** Shared task detail fields: keep every editor and recurrence compatible. */
(function () {
  const validDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  };
  function sourceUrl(value) {
    try { const url = new URL(String(value || '').slice(0, 2000)); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
    catch (_) { return null; }
  }

  /** Repeat units, from the most to the least frequent. "weekdays" means Monday to Friday. */
  const REPEAT_UNITS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly'];
  function normalizeRepeat(value) {
    const unit = String(value || '').trim().toLowerCase();
    return REPEAT_UNITS.includes(unit) ? unit : null;
  }
  const integer = value => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim())) ? Number(value) : NaN);
  function repeatDays(value) {
    if (!Array.isArray(value)) return null;
    const days = [...new Set(value.map(integer).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
    return days.length && days.length < 7 ? days : null;
  }
  /** Up to 10 short labels; a leading "#" is dropped and duplicates are ignored regardless of case. */
  function normalizeTags(value) {
    const seen = new Set(), tags = [];
    for (const raw of Array.isArray(value) ? value : []) {
      const tag = String(raw || '').replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, 30);
      const key = tag.toLocaleLowerCase();
      if (!tag || seen.has(key)) continue;
      seen.add(key); tags.push(tag);
      if (tags.length === 10) break;
    }
    return tags;
  }

  function fields(value = {}) {
    const seen = new Set();
    const every = integer(value.repeatEvery);
    return {
      inbox: value.inbox === true,
      priority: ['low', 'high'].includes(value.priority) ? value.priority : 'normal',
      todayPinDate: validDate(value.todayPinDate),
      todayPinOrder: Number.isInteger(value.todayPinOrder) && value.todayPinOrder >= 0 ? Math.min(value.todayPinOrder, 2) : 0,
      createdAt: Number.isSafeInteger(value.createdAt) && value.createdAt > 0 && value.createdAt <= 8640000000000000 ? value.createdAt : null,
      completedAt: value.completed && Number.isSafeInteger(value.completedAt) && value.completedAt > 0 && value.completedAt <= 8640000000000000 ? value.completedAt : null,
      sourceUrl: sourceUrl(value.sourceUrl),
      notes: String(value.notes || '').slice(0, 10000),
      subtasks: (Array.isArray(value.subtasks) ? value.subtasks : []).slice(0, 100).filter(item =>
        item && typeof item.id === 'string' && !seen.has(item.id) && seen.add(item.id)
      ).map(item => ({ id: item.id.slice(0, 120), text: String(item.text || '').slice(0, 500), completed: Boolean(item.completed) })),
      tags: normalizeTags(value.tags),
      remindAt: Number.isFinite(value.remindAt) && value.remindAt > 0 ? value.remindAt : null,
      sourceReminderId: typeof value.sourceReminderId === 'string' ? value.sourceReminderId : null,
      sourcePlannerId: typeof value.sourcePlannerId === 'string' ? value.sourcePlannerId : null,
      sourceTripId: typeof value.sourceTripId === 'string' && value.sourceTripId.trim() ? value.sourceTripId.slice(0, 120) : null,
      sourceTripName: typeof value.sourceTripName === 'string' ? value.sourceTripName.slice(0, 60) : null,
      sourceTripDate: /^\d{4}-\d{2}-\d{2}$/.test(value.sourceTripDate || '') ? value.sourceTripDate : null,
      externalEventId: typeof value.externalEventId === 'string' ? value.externalEventId : null,
      sourceMailId: typeof value.sourceMailId === 'string' ? value.sourceMailId : null,
      sourceMailUrl: /^https:\/\/mail\.google\.com\//.test(value.sourceMailUrl || '') ? value.sourceMailUrl.slice(0, 2000) : null,
      repeatDay: Number.isInteger(value.repeatDay) && value.repeatDay >= 1 && value.repeatDay <= 31 ? value.repeatDay : null,
      // Optional recurrence details; absent means "every 1", "on the due weekday", "no end", "from the due date".
      repeatEvery: Number.isInteger(every) && every >= 2 && every <= 99 ? every : null,
      repeatDays: repeatDays(value.repeatDays),
      repeatUntil: validDate(value.repeatUntil),
      repeatFrom: value.repeatFrom === 'completion' ? 'completion' : null,
    };
  }

  const daysInMonth = (year, monthIndex) => new Date(year, monthIndex + 1, 0).getDate();
  const isoOf = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  /** Day of month a monthly task belongs to. A saved anchor only applies while the date is still clamped to month end. */
  function repeatAnchorDay(dueDate, repeatDay) {
    const iso = validDate(dueDate);
    if (!iso) return null;
    const [year, month, day] = iso.split('-').map(Number);
    const anchor = Number.isInteger(repeatDay) ? repeatDay : null;
    return anchor && anchor > day && anchor <= 31 && day === daysInMonth(year, month - 1) ? anchor : day;
  }

  /**
   * The next due date of a repeating task, or null when it does not repeat or
   * its series has ended. Monthly and yearly dates clamp to month end and
   * return to their original day (Jan 31 → Feb 28 → Mar 31). With repeatFrom
   * "completion" the next date counts from the day the task was finished.
   */
  function nextOccurrenceDate(task = {}, { today = null, completedOn = null } = {}) {
    const unit = normalizeRepeat(task.repeat);
    if (!unit) return null;
    const rule = fields(task);
    const every = rule.repeatEvery || 1;
    const fromCompletion = rule.repeatFrom === 'completion';
    const base = validDate(fromCompletion ? (completedOn || today) : task.dueDate) || validDate(today) || validDate(completedOn);
    if (!base) return null;
    const [year, month, day] = base.split('-').map(Number);
    let next = null;
    if (unit === 'daily') next = new Date(year, month - 1, day + every);
    else if (unit === 'weekdays') {
      next = new Date(year, month - 1, day + 1);
      while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
    } else if (unit === 'weekly') {
      if (rule.repeatDays) {
        // Weeks start on Monday; with "every N weeks" only every Nth week counts.
        const mondayOf = date => new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7));
        const startWeek = mondayOf(new Date(year, month - 1, day));
        for (let offset = 1; offset <= 7 * every + 7 && !next; offset += 1) {
          const candidate = new Date(year, month - 1, day + offset);
          const weeks = Math.round((mondayOf(candidate) - startWeek) / (7 * 86400000));
          if (rule.repeatDays.includes(candidate.getDay()) && weeks % every === 0) next = candidate;
        }
      } else next = new Date(year, month - 1, day + 7 * every);
    } else {
      const months = unit === 'monthly' ? every : 12 * every;
      const anchor = fromCompletion ? day : repeatAnchorDay(base, task.repeatDay);
      const target = new Date(year, month - 1 + months, 1);
      next = new Date(target.getFullYear(), target.getMonth(), Math.min(anchor, daysInMonth(target.getFullYear(), target.getMonth())));
    }
    if (!next) return null;
    const iso = isoOf(next);
    return rule.repeatUntil && iso > rule.repeatUntil ? null : iso;
  }

  /** Compatibility wrapper: the next date for a plain unit, counted from a due date. */
  function nextRepeatDate(iso, repeat, repeatDay = null, fallbackIso = null) {
    return nextOccurrenceDate({ repeat, dueDate: validDate(iso) || fallbackIso, repeatDay }, { today: fallbackIso });
  }

  /** A short label for a repeat rule in both languages, e.g. "Every 2 weeks · Mon, Thu". */
  function describeRepeat(task = {}) {
    const unit = normalizeRepeat(task.repeat);
    if (!unit) return null;
    const rule = fields(task), every = rule.repeatEvery || 1;
    const units = { daily: ['day', 'days', '天'], weekly: ['week', 'weeks', '周'], monthly: ['month', 'months', '个月'], yearly: ['year', 'years', '年'] };
    const plain = { daily: ['Daily', '每天'], weekdays: ['Weekdays', '工作日'], weekly: ['Weekly', '每周'], monthly: ['Monthly', '每月'], yearly: ['Yearly', '每年'] };
    let en, zh;
    if (unit === 'weekdays' || every === 1) [en, zh] = plain[unit];
    else { en = `Every ${every} ${units[unit][1]}`; zh = `每 ${every} ${units[unit][2]}`; }
    if (unit === 'weekly' && rule.repeatDays) {
      const enDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], zhDays = ['日', '一', '二', '三', '四', '五', '六'];
      const order = rule.repeatDays.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
      en += ` · ${order.map(day => enDays[day]).join(', ')}`;
      zh += ` · 周${order.map(day => zhDays[day]).join('、')}`;
    }
    if (rule.repeatFrom === 'completion') { en += ' · after done'; zh += ' · 完成后计'; }
    if (rule.repeatUntil) { en += ` · until ${rule.repeatUntil}`; zh += ` · 至 ${rule.repeatUntil}`; }
    return { en, zh };
  }

  function recurrence(value) {
    const current = fields(value);
    const unit = normalizeRepeat(value.repeat);
    return { notes: current.notes, subtasks: current.subtasks.map(item => ({ ...item, id: crypto.randomUUID(), completed: false })), priority: current.priority, inbox: false, todayPinDate: null, todayPinOrder: 0, createdAt: Date.now(), completedAt: null, sourceUrl: current.sourceUrl, remindAt: null,
      tags: current.tags,
      repeatDay: unit === 'monthly' || unit === 'yearly' ? repeatAnchorDay(value.dueDate, value.repeatDay) : null,
      repeatEvery: current.repeatEvery, repeatDays: current.repeatDays, repeatUntil: current.repeatUntil, repeatFrom: current.repeatFrom };
  }
  function editable(value = {}) {
    return { ...fields(value), text: String(value.text || '').trim().slice(0, 500), dueDate: validDate(value.dueDate),
      dueTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(value.dueTime || '') ? value.dueTime : null,
      categoryId: typeof value.categoryId === 'string' && value.categoryId ? value.categoryId : null,
      repeat: normalizeRepeat(value.repeat) };
  }
  function mergeDraft(current, draft = {}) {
    const keys = ['text', 'dueDate', 'dueTime', 'categoryId', 'repeat', 'repeatEvery', 'repeatDays', 'repeatUntil', 'repeatFrom', 'notes', 'subtasks', 'tags', 'inbox', 'priority', 'sourceUrl'];
    const candidate = editable(draft), latest = editable(current || {});
    const base = draft._baseTask && draft._baseTask.id === current?.id ? editable(draft._baseTask) : null;
    const patch = {}, conflicts = [];
    for (const key of keys) {
      if (!Object.hasOwn(draft, key)) continue;
      const desired = JSON.stringify(candidate[key]), prior = base && JSON.stringify(base[key]);
      if (base && desired === prior) continue;
      if (base && JSON.stringify(latest[key]) !== prior && JSON.stringify(latest[key]) !== desired) conflicts.push(key);
      patch[key] = candidate[key];
    }
    return { patch, conflicts: draft._forceTaskChanges === true ? [] : conflicts };
  }
  function source(value) {
    if (value.sourceTripId) return { href: `travel.html?focus=trip&id=${encodeURIComponent(value.sourceTripId)}`, label: 'Travel', zh: '来源旅行' };
    if (value.sourceMailId) return { href: fields(value).sourceMailUrl || 'mail.html', label: 'Mail', zh: '来源邮件' };
    if (value.sourceReminderId) return { href: `calendar.html?focus=reminder&id=${encodeURIComponent(value.sourceReminderId)}`, label: 'Calendar reminder', zh: '来源日历提醒' };
    if (value.sourcePlannerId) {
      let board = '';
      try { const state = JSON.parse(localStorage.getItem('planner-app-v1') || '{}');
        board = Object.keys(state.boards || {}).find(key => state.boards[key]?.entries?.some(item => item.id === value.sourcePlannerId)) || '';
      } catch (_) {}
      return { href: `planner.html?focus=card&id=${encodeURIComponent(value.sourcePlannerId)}&board=${encodeURIComponent(board)}`, label: 'Project card', zh: '来源项目卡片' };
    }
    if (fields(value).sourceUrl) return { href: fields(value).sourceUrl, label: 'Original link', zh: '原始链接' };
    return null;
  }
  const api = { fields, recurrence, source, validDate, sourceUrl, mergeDraft, nextRepeatDate, nextOccurrenceDate, repeatAnchorDay, normalizeRepeat, normalizeTags, describeRepeat, REPEAT_UNITS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.DailySpaceTaskFields = api;
})();
