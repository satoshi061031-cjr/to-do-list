/** Habits: schedules, check-ins and streaks over local calendar dates. Pure rules; no DOM or account state. */
(function (global) {
  const KEY = 'dayfly-habits-v1';
  const VERSION = 1;
  const MAX_HABITS = 50;
  const MAX_NAME = 40;
  // Three years of local dates, including today. Older check-ins roll off on the next save.
  const HISTORY_DAYS = 3 * 365 + 1;
  // Another device can be a calendar day ahead in a different time zone.
  const FUTURE_DAYS = 2;
  // The whole workspace syncs as one snapshot of at most 1 MB.
  const MAX_BYTES = 200 * 1024;
  const COLORS = Object.freeze(['primary', 'secondary', 'tertiary', 'success', 'danger']);
  const TYPES = Object.freeze(['daily', 'weekdays', 'weekly']);
  const DAY_MS = 86400000;
  const MAX_STAMP = 8640000000000000;
  const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
  const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|‍|️|[\u{e0020}-\u{e007f}])+$/u;
  const PICTOGRAPH = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
  const graphemes = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

  const fail = (message, code = 'HABIT_INVALID') => { throw Object.assign(new Error(message), { code }); };
  const own = (object, key) => Boolean(object) && Object.prototype.hasOwnProperty.call(object, key);
  const pad = value => String(value).padStart(2, '0');
  const stamp = value => Number.isSafeInteger(value) && value > 0 && value <= MAX_STAMP ? value : null;

  // Dates are local calendar days ("YYYY-MM-DD"); arithmetic uses whole UTC days, so DST never shifts a day.
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '9999-12-31') return null;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  }
  function localDate(value = Date.now()) {
    const time = new Date(value);
    return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;
  }
  const toNumber = date => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
  const fromNumber = number => new Date(number * DAY_MS).toISOString().slice(0, 10);
  // 1970-01-01 was a Thursday; 0 is Sunday, as in Date#getDay.
  const weekdayOf = number => ((number % 7) + 11) % 7;
  // Weeks start on Monday, matching Weekly review.
  const mondayOf = number => number - (weekdayOf(number) + 6) % 7;
  const todayOf = value => validDate(value) || localDate();
  function addDays(date, offset) {
    const day = validDate(date);
    if (!day || !Number.isFinite(offset)) fail('Invalid date.', 'HABIT_DATE');
    return fromNumber(toNumber(day) + Math.trunc(offset));
  }
  function weekday(date) { const day = validDate(date); return day ? weekdayOf(toNumber(day)) : null; }
  function weekStart(date) { const day = validDate(date); return day ? fromNumber(mondayOf(toNumber(day))) : null; }

  function identity(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 120 && value.trim() === value &&
      !RESERVED.has(value) && !(value in Object.prototype) ? value : null;
  }
  function plainName(value) {
    return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim() : '';
  }
  function cleanName(value) { return Array.from(plainName(value)).slice(0, MAX_NAME).join('').trim(); }
  /** One emoji (including ZWJ sequences, flags and skin tones) or an empty string. */
  function cleanIcon(value) {
    if (typeof value !== 'string') return '';
    const icon = value.trim();
    if (!icon || icon.length > 16 || !EMOJI.test(icon) || !PICTOGRAPH.test(icon)) return '';
    if (graphemes) { let count = 0; for (const _ of graphemes.segment(icon)) if (++count > 1) return ''; }
    else if (Array.from(icon).length > 10) return '';
    return icon;
  }
  function cleanFrequency(value, strictMode = false) {
    const type = value && typeof value === 'object' && !Array.isArray(value) ? value.type : undefined;
    if (type === 'daily') return { type };
    if (type === 'weekdays' && Array.isArray(value.days) && value.days.length <= 7) {
      const days = [...new Set(value.days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
      if (days.length && (!strictMode || days.length === value.days.length)) return { type, days };
    }
    if (type === 'weekly' && Number.isInteger(value.times) && value.times >= 1 && value.times <= 7) return { type, times: value.times };
    if (strictMode) fail('Invalid habit frequency.');
    return { type: 'daily' };
  }
  function normalizeHabit(raw, index = 0, strictMode = false) {
    const invalid = message => { if (strictMode) fail(message); return null; };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('Invalid habit.');
    const id = identity(raw.id);
    if (!id) return invalid('Invalid habit ID.');
    const name = cleanName(raw.name);
    if (!name || (strictMode && Array.from(plainName(raw.name)).length > MAX_NAME)) return invalid('Each habit needs a name of up to 40 characters.');
    const icon = cleanIcon(raw.icon);
    if (strictMode) {
      if (raw.icon != null && raw.icon !== '' && !icon) fail('Use one emoji as a habit icon.');
      if (raw.color != null && !COLORS.includes(raw.color)) fail('Invalid habit color.');
      for (const field of ['createdAt', 'archivedAt']) if (raw[field] != null && !stamp(raw[field])) fail('Invalid habit date.');
      if (raw.order != null && !Number.isSafeInteger(raw.order)) fail('Invalid habit order.');
    }
    return { id, name, icon, color: COLORS.includes(raw.color) ? raw.color : 'primary', frequency: cleanFrequency(raw.frequency, strictMode),
      createdAt: stamp(raw.createdAt), archivedAt: stamp(raw.archivedAt), order: Number.isSafeInteger(raw.order) ? raw.order : index };
  }
  function bytes(value) {
    const text = JSON.stringify(value);
    // TextEncoder exists in every supported browser and in Node; the fallback is a safe overestimate.
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length * 3;
  }
  /** Keep the store within its sync budget by letting the oldest check-ins roll off first. */
  function fit(state, strictMode) {
    let size = bytes(state);
    if (size <= MAX_BYTES) return state;
    if (strictMode) fail('Habit history is larger than this workspace can keep.', 'HABITS_SIZE');
    const entries = [], counts = new Map();
    for (const id of Object.keys(state.checkins)) {
      const dates = Object.keys(state.checkins[id]);
      counts.set(id, dates.length);
      for (const date of dates) entries.push([date, id]);
    }
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    let index = 0;
    while (size > MAX_BYTES && index < entries.length) {
      // About 15 bytes per check-in; measure again after each batch.
      const batch = Math.max(1, Math.ceil((size - MAX_BYTES) / 15));
      for (let count = 0; count < batch && index < entries.length; count++, index++) {
        const [date, id] = entries[index];
        delete state.checkins[id][date];
        const left = counts.get(id) - 1; counts.set(id, left);
        if (!left) delete state.checkins[id];
      }
      size = bytes(state);
    }
    return state;
  }
  function defaults() { return { version: VERSION, habits: [], checkins: {} }; }
  function build(raw, today, strictMode) {
    const now = toNumber(todayOf(today));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { if (strictMode) fail('Invalid habits data.'); return defaults(); }
    if (strictMode && raw.habits != null && !Array.isArray(raw.habits)) fail('Invalid habits data.');
    const input = Array.isArray(raw.habits) ? raw.habits : [];
    if (strictMode && input.length > MAX_HABITS) fail('Keep at most 50 habits.', 'HABITS_LIMIT');
    const seen = new Set(), habits = [];
    for (let index = 0; index < input.length && habits.length < MAX_HABITS; index++) {
      const habit = normalizeHabit(input[index], index, strictMode);
      if (!habit) continue;
      if (seen.has(habit.id)) { if (strictMode) fail('Duplicate habit IDs.'); continue; }
      seen.add(habit.id); habits.push(habit);
    }
    habits.sort((a, b) => a.order - b.order);
    habits.forEach((habit, index) => { habit.order = index; });
    const source = raw.checkins, valid = source && typeof source === 'object' && !Array.isArray(source);
    if (strictMode && source != null && !valid) fail('Invalid habit check-ins.');
    const oldest = now - (HISTORY_DAYS - 1), newest = now + FUTURE_DAYS, checkins = {};
    if (valid) {
      if (strictMode) for (const id of Object.keys(source)) if (!seen.has(id)) fail('Check-ins refer to a missing habit.');
      for (const habit of habits) {
        if (!own(source, habit.id)) continue;
        const map = source[habit.id];
        if (!map || typeof map !== 'object' || Array.isArray(map)) { if (strictMode) fail('Invalid habit check-ins.'); continue; }
        const dates = [];
        for (const key of Object.keys(map)) {
          const date = validDate(key), value = map[key];
          if (!date || !(value === 1 || (!strictMode && value === true))) { if (strictMode) fail('Invalid habit check-in.'); continue; }
          const number = toNumber(date);
          if (number > newest) { if (strictMode) fail('Habit check-ins cannot be in the future.'); continue; }
          if (number >= oldest) dates.push(date);
        }
        if (dates.length) checkins[habit.id] = Object.fromEntries(dates.sort().map(date => [date, 1]));
      }
    }
    return fit({ version: VERSION, habits, checkins }, strictMode);
  }
  /** Bounded, canonical state. Invalid entries are dropped; it never throws for stored data. */
  function normalize(raw, today) { return build(raw, today, false); }
  /** The same contract for imported files: anything invalid is an error instead of being dropped. */
  function strict(raw, today) { return build(raw, today, true); }

  const checkinsFor = (state, id) => own(state?.checkins, id) && state.checkins[id] && typeof state.checkins[id] === 'object' ? state.checkins[id] : {};
  function doneNumbers(done) {
    const set = new Set();
    const list = done instanceof Set ? [...done] : Array.isArray(done) ? done
      : done && typeof done === 'object' ? Object.keys(done).filter(key => done[key] === 1 || done[key] === true) : [];
    for (const item of list) { const date = validDate(item); if (date) set.add(toNumber(date)); }
    return set;
  }
  function earliest(set) { let first = Infinity; for (const number of set) if (number < first) first = number; return first; }
  function dueOn(habit, number) {
    const frequency = habit?.frequency;
    if (frequency?.type === 'weekdays') return Array.isArray(frequency.days) && frequency.days.includes(weekdayOf(number));
    return frequency?.type === 'daily' || frequency?.type === 'weekly';
  }
  const weekCount = (set, monday) => { let count = 0; for (let number = monday; number < monday + 7; number++) if (set.has(number)) count++; return count; };
  // A habit starts on its creation day, or earlier when past days were ticked.
  function startOf(habit, set, now) {
    let first = Math.min(now, earliest(set));
    if (stamp(habit?.createdAt)) first = Math.min(first, toNumber(localDate(habit.createdAt)));
    return first;
  }

  /** Whether the schedule includes this date. Weekly habits can be done on any day of the week. */
  function isDue(habit, date) { const day = validDate(date); return Boolean(day) && dueOn(habit, toNumber(day)); }
  /** Whether a habit belongs in Today: scheduled, and for weekly habits not already met this week (unless done today). */
  function dueToday(habit, done, today) {
    const now = toNumber(todayOf(today));
    if (!dueOn(habit, now)) return false;
    if (habit.frequency.type !== 'weekly') return true;
    const set = doneNumbers(done);
    return set.has(now) || weekCount(set, mondayOf(now)) < habit.frequency.times;
  }
  function isDone(state, habitId, date) { const map = checkinsFor(state, habitId); return own(map, date) && map[date] === 1; }

  /**
   * Consecutive completed periods ending today. An unfinished today never breaks it.
   * Daily and weekday habits count scheduled days only; weekly habits count weeks that met their target.
   */
  function currentStreak(habit, done, today) {
    const set = doneNumbers(done), now = toNumber(todayOf(today)), first = earliest(set);
    if (!set.size || !habit?.frequency) return 0;
    if (habit.frequency.type === 'weekly') {
      const target = habit.frequency.times;
      let monday = mondayOf(now), streak = weekCount(set, monday) >= target ? 1 : 0;
      for (monday -= 7; monday + 6 >= first; monday -= 7) { if (weekCount(set, monday) >= target) streak++; else break; }
      return streak;
    }
    let streak = set.has(now) && dueOn(habit, now) ? 1 : 0;
    for (let number = now - 1; number >= first; number--) {
      if (!dueOn(habit, number)) continue;
      if (set.has(number)) streak++; else break;
    }
    return streak;
  }
  /** The longest run with the same rules, over the saved history up to today. */
  function bestStreak(habit, done, today) {
    const set = doneNumbers(done), now = toNumber(todayOf(today)), first = earliest(set);
    if (!set.size || !habit?.frequency || first > now) return 0;
    let best = 0, run = 0;
    if (habit.frequency.type === 'weekly') {
      for (let monday = mondayOf(first); monday <= now; monday += 7) {
        if (weekCount(set, monday) >= habit.frequency.times) best = Math.max(best, ++run); else run = 0;
      }
      return best;
    }
    for (let number = first; number <= now; number++) {
      if (!dueOn(habit, number)) continue;
      if (set.has(number)) best = Math.max(best, ++run); else run = 0;
    }
    return best;
  }
  /**
   * Share of scheduled days (or weeks, for weekly habits) completed in the last `days` days, from the habit's start.
   * Today, the current week and a partial first week only count once completed.
   */
  function completionRate(habit, done, today, days = 30) {
    const set = doneNumbers(done), now = toNumber(todayOf(today));
    const span = Number.isInteger(days) && days > 0 ? Math.min(days, HISTORY_DAYS) : 30;
    const opening = startOf(habit, set, now), start = Math.max(now - span + 1, opening);
    let hits = 0, due = 0;
    if (habit?.frequency?.type === 'weekly') {
      const target = habit.frequency.times, current = mondayOf(now), firstWeek = mondayOf(opening);
      for (let monday = mondayOf(start); monday <= current; monday += 7) {
        const met = weekCount(set, monday) >= target;
        if (!met && (monday === current || monday === firstWeek)) continue;
        due++; if (met) hits++;
      }
      return { done: hits, due, rate: due ? hits / due : null, unit: 'week' };
    }
    for (let number = start; number <= now; number++) {
      if (!dueOn(habit, number)) continue;
      const hit = set.has(number);
      if (number === now && !hit) continue;
      due++; if (hit) hits++;
    }
    return { done: hits, due, rate: due ? hits / due : null, unit: 'day' };
  }
  function weekProgress(habit, done, today) {
    const set = doneNumbers(done), now = toNumber(todayOf(today));
    return { done: weekCount(set, mondayOf(now)), target: habit?.frequency?.type === 'weekly' ? habit.frequency.times : null };
  }
  function totalCheckins(done, today) { const now = toNumber(todayOf(today)); let total = 0; for (const number of doneNumbers(done)) if (number <= now) total++; return total; }
  function dayState(habit, set, number, now, start) {
    if (number > now) return 'future';
    const scheduled = dueOn(habit, number);
    if (set.has(number)) return scheduled ? 'done' : 'extra';
    if (!scheduled) return 'rest';
    if (number < start) return 'before';
    if (number === now) return 'pending';
    return habit.frequency.type === 'weekly' ? 'open' : 'missed';
  }
  /** Columns of Monday-first weeks, oldest first; the last column holds today. */
  function heatmap(habit, done, today, weeks = 12) {
    const set = doneNumbers(done), now = toNumber(todayOf(today)), start = startOf(habit, set, now);
    const count = Number.isInteger(weeks) && weeks > 0 ? Math.min(weeks, 157) : 12;
    const opening = mondayOf(now) - (count - 1) * 7, target = habit?.frequency?.type === 'weekly' ? habit.frequency.times : null;
    return Array.from({ length: count }, (_, column) => {
      const monday = opening + column * 7, total = weekCount(set, monday);
      return { start: fromNumber(monday), count: total, met: target ? total >= target : null,
        days: Array.from({ length: 7 }, (__, row) => ({ date: fromNumber(monday + row), state: dayState(habit, set, monday + row, now, start) })) };
    });
  }
  /** The most recent days ending today, oldest first, for a check-in strip. */
  function lastDays(habit, done, today, length = 7) {
    const set = doneNumbers(done), now = toNumber(todayOf(today)), start = startOf(habit, set, now);
    const count = Number.isInteger(length) && length > 0 ? Math.min(length, 31) : 7;
    return Array.from({ length: count }, (_, index) => {
      const number = now - (count - 1) + index;
      return { date: fromNumber(number), weekday: weekdayOf(number), done: set.has(number), due: dueOn(habit, number), state: dayState(habit, set, number, now, start) };
    });
  }
  function stats(habit, done, today) {
    const day = todayOf(today);
    return { current: currentStreak(habit, done, day), best: bestStreak(habit, done, day), rate: completionRate(habit, done, day),
      total: totalCheckins(done, day), week: weekProgress(habit, done, day), doneToday: doneNumbers(done).has(toNumber(day)) };
  }
  /** Today's progress over active habits of an already normalized state. */
  function summary(state, today) {
    const day = todayOf(today); let due = 0, done = 0;
    for (const habit of state?.habits || []) {
      if (habit.archivedAt) continue;
      const map = checkinsFor(state, habit.id);
      if (!dueToday(habit, map, day)) continue;
      due++; if (map[day] === 1) done++;
    }
    return { due, done };
  }

  function uid() {
    const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return `habit-${random}`;
  }
  function frequencyInput(value) {
    try { return cleanFrequency(value, true); } catch (_) { return fail('Choose how often to repeat this habit.', 'HABIT_FREQUENCY'); }
  }
  function find(state, id) {
    const habit = state.habits.find(item => item.id === id);
    if (!habit) fail('This habit is no longer available.', 'HABIT_MISSING');
    return habit;
  }
  function create(raw, value, now = Date.now(), today) {
    const day = todayOf(today ?? localDate(now)), state = normalize(raw, day);
    if (state.habits.length >= MAX_HABITS) fail('Keep at most 50 habits. Archive or delete one before adding another.', 'HABITS_LIMIT');
    const id = value?.id === undefined ? uid() : identity(value.id);
    if (!id) fail('Invalid habit ID.');
    if (state.habits.some(item => item.id === id)) fail('This habit already exists.', 'HABIT_EXISTS');
    const habit = normalizeHabit({ id, name: value?.name, icon: value?.icon, color: value?.color, frequency: frequencyInput(value?.frequency ?? { type: 'daily' }),
      createdAt: stamp(now) || Date.now(), archivedAt: null, order: state.habits.length }, state.habits.length);
    if (!habit) fail('Give the habit a name.', 'HABIT_NAME');
    return normalize({ ...state, habits: [...state.habits, habit] }, day);
  }
  function update(raw, id, value, today) {
    const day = todayOf(today), state = normalize(raw, day), existing = find(state, id);
    const habit = normalizeHabit({ ...existing, name: value?.name ?? existing.name, icon: value?.icon ?? existing.icon, color: value?.color ?? existing.color,
      frequency: value?.frequency === undefined ? existing.frequency : frequencyInput(value.frequency) }, existing.order);
    if (!habit) fail('Give the habit a name.', 'HABIT_NAME');
    return normalize({ ...state, habits: state.habits.map(item => item.id === id ? habit : item) }, day);
  }
  function archive(raw, id, archived = true, now = Date.now(), today) {
    const day = todayOf(today), state = normalize(raw, day); find(state, id);
    return normalize({ ...state, habits: state.habits.map(item => item.id === id ? { ...item, archivedAt: archived ? item.archivedAt || stamp(now) || Date.now() : null } : item) }, day);
  }
  /** Removes a habit and its history; `removed` restores both in place. */
  function remove(raw, id, today) {
    const day = todayOf(today), state = normalize(raw, day), habit = find(state, id);
    const checkins = { ...state.checkins }, history = own(checkins, id) ? checkins[id] : null;
    delete checkins[id];
    return { state: normalize({ ...state, habits: state.habits.filter(item => item.id !== id), checkins }, day),
      removed: { habit, checkins: history, index: state.habits.indexOf(habit) } };
  }
  function restore(raw, removed, today) {
    const day = todayOf(today), state = normalize(raw, day), habit = normalizeHabit(removed?.habit);
    if (!habit) fail('There is nothing to restore.', 'HABIT_MISSING');
    if (state.habits.some(item => item.id === habit.id)) return state;
    if (state.habits.length >= MAX_HABITS) fail('Keep at most 50 habits. Archive or delete one before adding another.', 'HABITS_LIMIT');
    const habits = [...state.habits], index = Number.isInteger(removed.index) ? Math.min(Math.max(0, removed.index), habits.length) : habits.length;
    habits.splice(index, 0, habit);
    const checkins = { ...state.checkins };
    if (removed.checkins && typeof removed.checkins === 'object' && Object.keys(removed.checkins).length) checkins[habit.id] = removed.checkins;
    return normalize({ ...state, habits: habits.map((item, order) => ({ ...item, order })), checkins }, day);
  }
  /** Moves an active habit one place up (-1) or down (+1) among active habits. */
  function move(raw, id, delta, today) {
    const day = todayOf(today), state = normalize(raw, day), active = state.habits.filter(item => !item.archivedAt);
    const from = active.findIndex(item => item.id === id);
    if (from < 0) fail('This habit is no longer available.', 'HABIT_MISSING');
    const to = from + Math.sign(Number(delta) || 0);
    if (to === from || to < 0 || to >= active.length) return state;
    const a = active[from], b = active[to];
    return normalize({ ...state, habits: state.habits.map(item => item.id === a.id ? { ...item, order: b.order } : item.id === b.id ? { ...item, order: a.order } : item) }, day);
  }
  /** Marks one day done or not done. Only today and earlier days within the saved history can change. */
  function setCheckin(raw, habitId, date, done, today) {
    const day = todayOf(today), state = normalize(raw, day), habit = find(state, habitId);
    if (habit.archivedAt) fail('Restore this habit before checking in.', 'HABIT_ARCHIVED');
    const target = validDate(date);
    if (!target || target > day) fail('Choose today or an earlier day.', 'HABIT_DATE');
    if (toNumber(target) < toNumber(day) - (HISTORY_DAYS - 1)) fail('That day is outside the saved history.', 'HABIT_DATE');
    if (isDone(state, habitId, target) === Boolean(done)) return state;
    const map = { ...checkinsFor(state, habitId) };
    if (done) map[target] = 1; else delete map[target];
    const checkins = { ...state.checkins };
    if (Object.keys(map).length) checkins[habitId] = map; else delete checkins[habitId];
    return normalize({ ...state, checkins }, day);
  }
  function toggleCheckin(raw, habitId, date, today) {
    const day = todayOf(today), state = normalize(raw, day);
    return setCheckin(state, habitId, date, !isDone(state, habitId, validDate(date)), day);
  }
  /** Import rule: keep existing habits by ID, add new ones and add check-ins that are not saved yet. */
  function merge(currentRaw, incomingRaw, today) {
    const day = todayOf(today), current = normalize(currentRaw, day), incoming = strict(incomingRaw, day);
    const known = new Set(current.habits.map(habit => habit.id));
    const additions = incoming.habits.filter(habit => !known.has(habit.id));
    if (current.habits.length + additions.length > MAX_HABITS) fail('Too many habits after merge.', 'HABITS_LIMIT');
    const habits = [...current.habits, ...additions.map((habit, index) => ({ ...habit, order: current.habits.length + index }))];
    const checkins = {}; let checkinsAdded = 0;
    for (const habit of habits) {
      const dates = new Set(Object.keys(checkinsFor(current, habit.id)));
      for (const date of Object.keys(checkinsFor(incoming, habit.id))) if (!dates.has(date)) { dates.add(date); checkinsAdded++; }
      if (dates.size) checkins[habit.id] = Object.fromEntries([...dates].sort().map(date => [date, 1]));
    }
    const state = { version: VERSION, habits, checkins };
    if (bytes(state) > MAX_BYTES) fail('Habit history exceeds the storage limit after merge.', 'HABITS_SIZE');
    return { state: normalize(state, day), added: additions.length, skipped: incoming.habits.length - additions.length, checkinsAdded };
  }

  const api = Object.freeze({ KEY, VERSION, MAX_HABITS, MAX_NAME, HISTORY_DAYS, MAX_BYTES, COLORS, TYPES,
    defaults, normalize, strict, normalizeHabit, cleanIcon, merge, bytes, uid,
    localDate, validDate, addDays, weekday, weekStart, checkinsFor, isDue, dueToday, isDone,
    currentStreak, bestStreak, completionRate, weekProgress, totalCheckins, heatmap, lastDays, stats, summary,
    create, update, archive, remove, restore, move, setCheckin, toggleCheckin });
  if (global) global.DailySpaceHabits = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : null);
