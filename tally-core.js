(function (global) {
  const STORAGE_KEY = "tally-book-v1";
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const ISO_CURRENCY = /^[A-Z]{3}$/;
  const SYMBOL_TO_CODE = {
    "¥": "JPY",
    $: "USD",
    "€": "EUR",
    "£": "GBP",
    "₩": "KRW",
    "₹": "INR",
    "HK$": "HKD",
    "S$": "SGD",
  };
  const CODE_TO_SYMBOL = {
    JPY: "¥",
    USD: "$",
    EUR: "€",
    GBP: "£",
    KRW: "₩",
    INR: "₹",
    HKD: "HK$",
    SGD: "S$",
    CNY: "CN¥",
    MYR: "RM",
    THB: "฿",
    TWD: "NT$",
    AUD: "A$",
    CAD: "C$",
    VND: "₫",
    PHP: "₱",
  };

  function uid(prefix) {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${prefix || "tally"}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function clean(value, max) {
    return typeof value === "string" ? value.trim().slice(0, max) : "";
  }

  function validDate(value) {
    if (typeof value !== "string" || !ISO_DATE.test(value) || value < "1900-01-01" || value > "9999-12-31") return null;
    const parsed = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
  }

  function normalizeCategoryBudget(value, baseCurrency) {
    const month = clean(value?.month, 7), category = clean(value?.category, 40), amount = Number(value?.amount);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < "1900-01" || !category || !Number.isFinite(amount) || amount <= 0 || amount > 1e12) return null;
    return { id: clean(value.id, 120) || uid("budget"), month, category, amount, currency: currencyCode(value.currency, baseCurrency) };
  }

  function normalizeRecurringBill(value, baseCurrency) {
    const nextDate = validDate(value?.nextDate), name = clean(value?.name, 60), amount = Number(value?.amount);
    const currency = currencyCode(value?.currency, baseCurrency), fxRate = currency === baseCurrency ? 1 : Number(value?.fxRate);
    if (!nextDate || !name || !Number.isFinite(amount) || amount <= 0 || amount > 1e12 || !Number.isFinite(fxRate) || fxRate <= 0 || fxRate > 1e6) return null;
    const [year, month, day] = nextDate.split("-").map(Number);
    return { id: clean(value.id, 70) || uid("bill"), name, amount, currency, fxRate, category: clean(value.category, 40) || "Other", note: clean(value.note, 120), nextDate,
      interval: value.interval === "yearly" ? "yearly" : "monthly",
      anchorDay: Number.isInteger(value.anchorDay) && value.anchorDay >= 1 && value.anchorDay <= 31 ? value.anchorDay : day,
      anchorMonth: Number.isInteger(value.anchorMonth) && value.anchorMonth >= 1 && value.anchorMonth <= 12 ? value.anchorMonth : month,
      handledDates: [...new Set((Array.isArray(value.handledDates) ? value.handledDates : []).filter(validDate))].sort().slice(-600),
      enabled: value.enabled !== false };
  }

  // Calendar arithmetic retains the original day (Jan 31 -> Feb 28 -> Mar 31).
  function nextBillDate(bill, occurrence) {
    const valid = validDate(occurrence || bill?.nextDate); if (!valid) return null;
    let [year, month] = valid.split("-").map(Number);
    if (bill.interval === "yearly") { year++; month = bill.anchorMonth; }
    else if (++month === 13) { year++; month = 1; }
    if (year > 9999) return null;
    const day = Math.min(bill.anchorDay || Number(valid.slice(-2)), new Date(Date.UTC(year, month, 0)).getUTCDate());
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function categoryBudgetProgress(state, month) {
    return (state.categoryBudgets || []).filter(item => item.month === month && item.currency === state.baseCurrency).map(budget => {
      const spent = personalRecords(state.records).filter(record => validDate(record.date) && record.date.startsWith(`${month}-`) && record.category.toLocaleLowerCase() === budget.category.toLocaleLowerCase()).reduce((sum, record) => sum + baseAmount(record), 0);
      return { ...budget, spent, remaining: budget.amount - spent, percent: Math.min(100, spent / budget.amount * 100) };
    });
  }

  function saveRecurringBill(state, raw) {
    const bill = normalizeRecurringBill(raw, state.baseCurrency);
    if (!bill) throw new Error("Invalid recurring bill.");
    const existing = state.recurringBills.find(item => item.id === bill.id);
    if (!existing && state.recurringBills.length >= 100) throw new Error("At most 100 recurring bills.");
    return { ...state, recurringBills: existing ? state.recurringBills.map(item => item.id === bill.id ? { ...bill, handledDates: existing.handledDates } : item) : [...state.recurringBills, bill] };
  }

  function handleRecurringBill(state, id, expectedDate, asOf, confirm) {
    const bill = (state.recurringBills || []).find(item => item.id === id);
    if (!bill || !bill.enabled || !validDate(expectedDate) || !validDate(asOf) || expectedDate > asOf) return { state, changed: false, reason: "unavailable" };
    if (bill.nextDate !== expectedDate) return { state, changed: false, reason: "stale" };
    const recordId = `bill:${bill.id}:${expectedDate}`;
    const duplicate = bill.handledDates.includes(expectedDate) || state.records.some(item => item.id === recordId || (item.recurringBillId === id && item.recurringDate === expectedDate));
    const nextDate = nextBillDate(bill, expectedDate);
    const nextBill = { ...bill, nextDate: nextDate || expectedDate, enabled: Boolean(nextDate), handledDates: [...new Set([...bill.handledDates, expectedDate])].sort().slice(-600) };
    const record = confirm && !duplicate ? normalizeRecord({ id: recordId, date: expectedDate, amount: bill.amount, currency: bill.currency, fxRate: bill.fxRate, category: bill.category, note: bill.note || bill.name, scope: "personal", recurringBillId: bill.id, recurringDate: expectedDate }, state) : null;
    return { state: { ...state, recurringBills: state.recurringBills.map(item => item.id === id ? nextBill : item), records: record ? [record, ...state.records] : state.records }, changed: true, record, duplicate };
  }

  function confirmRecurringBill(state, id, expectedDate, asOf) { return handleRecurringBill(state, id, expectedDate, asOf, true); }
  function skipRecurringBill(state, id, expectedDate, asOf) { return handleRecurringBill(state, id, expectedDate, asOf, false); }

  // Spending insights read the personal ledger only, in the base currency at each
  // record's saved exchange rate. "Other" (and its Chinese forms) always folds into
  // the remainder bucket, so the chart never shows two "Other" rows.
  const OTHER_CATEGORIES = new Set(["other", "其他", "其它"]);

  function monthPrefix(year, month) {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  }

  function validMonth(year, month) {
    return Number.isInteger(year) && year >= 1900 && year <= 9999 && Number.isInteger(month) && month >= 1 && month <= 12;
  }

  function categoryBreakdown(state, year, month, limit = 6) {
    const y = Number(year), m = Number(month);
    const result = { year: y, month: m, total: 0, count: 0, items: [] };
    if (!validMonth(y, m)) return result;
    const prefix = `${monthPrefix(y, m)}-`, groups = new Map();
    personalRecords(state?.records).forEach(record => {
      const amount = baseAmount(record);
      if (typeof record?.date !== "string" || !record.date.startsWith(prefix) || !Number.isFinite(amount) || amount <= 0) return;
      const category = clean(record.category, 40) || "Other", key = category.toLocaleLowerCase();
      const group = groups.get(key) || { key, category, amount: 0, count: 0, other: OTHER_CATEGORIES.has(key) };
      group.amount += amount; group.count += 1; groups.set(key, group);
      result.total += amount; result.count += 1;
    });
    const size = Number.isInteger(Number(limit)) && Number(limit) >= 0 ? Math.min(Number(limit), 50) : 6;
    const named = [...groups.values()].filter(group => !group.other).sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
    const rest = [...named.slice(size), ...[...groups.values()].filter(group => group.other)];
    const items = named.slice(0, size).map(group => ({ ...group, categories: 1 }));
    if (rest.length) items.push({ key: "", category: "Other", other: true, categories: rest.length,
      amount: rest.reduce((sum, group) => sum + group.amount, 0), count: rest.reduce((sum, group) => sum + group.count, 0) });
    result.items = items.map(item => ({ ...item, share: result.total > 0 ? item.amount / result.total : 0 }));
    return result;
  }

  /** Oldest first; the last entry is endYear/endMonth. */
  function monthlyTotals(state, endYear, endMonth, count = 6) {
    const y = Number(endYear), m = Number(endMonth);
    if (!validMonth(y, m)) return [];
    const size = Number.isInteger(Number(count)) && Number(count) >= 1 ? Math.min(Number(count), 120) : 6;
    const end = y * 12 + m - 1;
    const months = Array.from({ length: size }, (_, index) => {
      const value = end - size + 1 + index, year = Math.floor(value / 12), month = value - year * 12 + 1;
      return { year, month, key: monthPrefix(year, month), total: 0, count: 0 };
    });
    const byKey = new Map(months.map(item => [item.key, item]));
    personalRecords(state?.records).forEach(record => {
      const entry = byKey.get(typeof record?.date === "string" ? record.date.slice(0, 7) : ""), amount = baseAmount(record);
      if (!entry || !Number.isFinite(amount) || amount <= 0) return;
      entry.total += amount; entry.count += 1;
    });
    return months;
  }

  // Likely subscriptions: the same merchant charged about monthly (3+ times) or
  // yearly (2+ times) at a steady amount, recently enough to still be active.
  const SUBSCRIPTION_RULES = [
    { interval: "monthly", minGap: 26, maxGap: 35, minCount: 3, staleAfter: 62 },
    { interval: "yearly", minGap: 350, maxGap: 380, minCount: 2, staleAfter: 731 },
  ];
  const SUBSCRIPTION_KEY_LENGTH = 60; // the longest bill name, so a bill can always cover its key
  const MAX_DISMISSED_SUBSCRIPTIONS = 200;

  function subscriptionLabel(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").split(" · ")[0].trim().slice(0, SUBSCRIPTION_KEY_LENGTH).trim() : "";
  }

  /** Merchant key: the note's first " · " segment (or a bill name), trimmed and lowercased. */
  function subscriptionKey(value) {
    return subscriptionLabel(value).toLowerCase();
  }

  function recordMerchant(record) {
    return subscriptionLabel(record?.note) || subscriptionLabel(record?.category);
  }

  function normalizeDismissedSubscriptions(value) {
    const keys = (Array.isArray(value) ? value.slice(-1000) : []).map(subscriptionKey).filter(Boolean);
    return [...new Set(keys)].slice(-MAX_DISMISSED_SUBSCRIPTIONS);
  }

  function dismissSubscription(state, key) {
    const normalized = subscriptionKey(key);
    if (!normalized) return state;
    const kept = normalizeDismissedSubscriptions(state?.dismissedSubscriptions).filter(item => item !== normalized);
    return { ...state, dismissedSubscriptions: [...kept, normalized].slice(-MAX_DISMISSED_SUBSCRIPTIONS) };
  }

  function restoreSubscription(state, key) {
    const normalized = subscriptionKey(key);
    return { ...state, dismissedSubscriptions: normalizeDismissedSubscriptions(state?.dismissedSubscriptions).filter(item => item !== normalized) };
  }

  function dayNumber(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    return Math.round(Date.UTC(year, month - 1, day) / 86400000);
  }

  // Walk back from the newest charge while each earlier one keeps the rhythm, the
  // currency and an amount within 15% of the newest. A same-day copy of the same
  // charge counts once; any other break ends the run.
  function recentRun(sorted, rule) {
    const latest = sorted[sorted.length - 1], run = [latest];
    for (let index = sorted.length - 2; index >= 0; index -= 1) {
      const record = sorted[index], gap = dayNumber(run[0].date) - dayNumber(record.date);
      if (gap === 0 && record.currency === run[0].currency && record.amount === run[0].amount) continue;
      if (gap < rule.minGap || gap > rule.maxGap || record.currency !== latest.currency ||
        Math.abs(record.amount - latest.amount) > latest.amount * 0.15 + 1e-9) break;
      run.unshift(record);
    }
    return run;
  }

  function detectSubscriptions(state, todayIso) {
    const today = validDate(todayIso);
    if (!today || !state) return [];
    const dismissed = new Set(normalizeDismissedSubscriptions(state.dismissedSubscriptions));
    const covered = new Set((Array.isArray(state.recurringBills) ? state.recurringBills : [])
      .flatMap(bill => [subscriptionKey(bill?.name), subscriptionKey(bill?.note)]).filter(Boolean));
    const groups = new Map();
    personalRecords(state.records).forEach(record => {
      if (!validDate(record?.date) || !(Number(record.amount) > 0)) return;
      const key = recordMerchant(record).toLowerCase();
      // "Other" and the unnamed default category say nothing about who was paid.
      if (!key || OTHER_CATEGORIES.has(key) || key === "expense") return;
      // Charges a bill already records are covered, whatever their note says.
      if (record.recurringBillId) { covered.add(key); return; }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...record, amount: Number(record.amount), currency: currencyCode(record.currency, state.baseCurrency) });
    });
    const suggestions = [];
    groups.forEach((records, key) => {
      if (covered.has(key) || dismissed.has(key) || records.length < 2) return;
      const sorted = records.sort((a, b) => a.date.localeCompare(b.date));
      for (const rule of SUBSCRIPTION_RULES) {
        const run = recentRun(sorted, rule), latest = run[run.length - 1];
        if (run.length < rule.minCount || dayNumber(today) - dayNumber(latest.date) > rule.staleAfter) continue;
        const [year, month, day] = latest.date.split("-").map(Number);
        // A charge on the last day of a short month keeps an earlier, later day (Jan 31 -> Feb 28 -> Mar 31).
        const anchorDay = day === new Date(Date.UTC(year, month, 0)).getUTCDate() ? Math.max(...run.map(record => Number(record.date.slice(8)))) : day;
        const nextDate = nextBillDate({ interval: rule.interval, anchorDay, anchorMonth: month }, latest.date);
        if (!nextDate) break;
        suggestions.push({ key, name: recordMerchant(latest), interval: rule.interval, amount: latest.amount, currency: latest.currency,
          fxRate: latest.currency === state.baseCurrency ? 1 : Number(latest.fxRate) || 1, category: clean(latest.category, 40) || "Other",
          count: run.length, firstDate: run[0].date, lastDate: latest.date, nextDate, anchorDay, anchorMonth: month });
        break;
      }
    });
    return suggestions.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name));
  }

  /** The recurring bill a confirmed suggestion becomes: next charge one interval after the last. */
  function subscriptionBill(suggestion) {
    return { name: suggestion.name, amount: suggestion.amount, currency: suggestion.currency, fxRate: suggestion.fxRate,
      category: suggestion.category, note: "", nextDate: suggestion.nextDate, interval: suggestion.interval,
      anchorDay: suggestion.anchorDay, anchorMonth: suggestion.anchorMonth, enabled: true };
  }

  function currencyCode(value, fallback) {
    const raw = clean(value, 8);
    const upper = raw.toUpperCase();
    if (ISO_CURRENCY.test(upper)) return upper;
    return SYMBOL_TO_CODE[raw] || fallback || "JPY";
  }

  function currencySymbol(code, legacy) {
    return CODE_TO_SYMBOL[currencyCode(code)] || clean(legacy, 8) || currencyCode(code);
  }

  function normalizePerson(person, index) {
    if (!person || typeof person !== "object") return null;
    const name = clean(person.name, 60);
    if (!name) return null;
    return {
      id: clean(person.id, 120) || uid("person"),
      name,
      isSelf: Boolean(person.isSelf || index === 0),
    };
  }

  function normalizeRecord(record, state) {
    if (!record || !ISO_DATE.test(String(record.date || "")) || !(Number(record.amount) > 0)) {
      return null;
    }
    const baseCurrency = state.baseCurrency;
    const currency = currencyCode(record.currency, baseCurrency);
    const fxRate = Number(record.fxRate);
    const scope = record.scope === "shared" ? "shared" : "personal";
    const validPeople = new Set(state.people.map((person) => person.id));
    const defaultMembers = state.people.map((person) => person.id);
    const splitAmongIds = Array.isArray(record.splitAmongIds)
      ? [...new Set(record.splitAmongIds.filter((id) => validPeople.has(id)))]
      : [];
    return {
      id: clean(record.id, 120) || uid("expense"),
      date: record.date,
      amount: Number(record.amount),
      currency,
      fxRate: currency === baseCurrency ? 1 : fxRate > 0 ? fxRate : 1,
      category: clean(record.category, 40) || "Expense",
      note: clean(record.note, 120),
      tripId: clean(record.tripId, 160) || null,
      tripName: clean(record.tripName, 60),
      recurringBillId: clean(record.recurringBillId, 70) || null,
      recurringDate: validDate(record.recurringDate),
      scope,
      paidById:
        scope === "shared" && validPeople.has(record.paidById)
          ? record.paidById
          : state.selfPersonId,
      splitAmongIds:
        scope === "shared"
          ? splitAmongIds.length
            ? splitAmongIds
            : defaultMembers
          : [state.selfPersonId],
    };
  }

  function normalizeState(raw) {
    const state = raw && typeof raw === "object" ? raw : {};
    let people = Array.isArray(state.people)
      ? state.people.map(normalizePerson).filter(Boolean).slice(0, 24)
      : [];
    if (!people.length) people = [{ id: "tally-self", name: "Me", isSelf: true }];
    let self = people.find((person) => person.id === state.selfPersonId) || people.find((person) => person.isSelf);
    if (!self) self = people[0];
    people = people.map((person) => ({ ...person, isSelf: person.id === self.id }));
    const baseCurrency = currencyCode(state.baseCurrency || state.currency, "JPY");
    const normalized = {
      version: 2,
      budget: Number(state.budget) > 0 ? Number(state.budget) : 1000,
      currency: currencySymbol(baseCurrency, state.currency),
      baseCurrency,
      selfPersonId: self.id,
      people,
      tripBudgets: Object.fromEntries(Object.entries(state.tripBudgets && typeof state.tripBudgets === "object" ? state.tripBudgets : {}).slice(0, 100).filter(([key, value]) =>
        !["__proto__", "constructor", "prototype"].includes(key) && key.length <= 160 && Number.isFinite(Number(value?.amount)) && Number(value.amount) > 0
      ).map(([key, value]) => [key, { amount: Number(value.amount), currency: currencyCode(value.currency, baseCurrency) }])),
      categoryBudgets: [],
      recurringBills: [],
      records: [],
      settlements: Array.isArray(state.settlements) ? state.settlements.slice() : [],
      // Identifier of the active quick-add key (never the key itself); clearing it revokes the key.
      quickAddKeyId: /^[A-Za-z0-9_-]{16,64}$/.test(String(state.quickAddKeyId || "")) ? String(state.quickAddKeyId) : null,
      // Merchant keys the user marked "Not a subscription".
      dismissedSubscriptions: normalizeDismissedSubscriptions(state.dismissedSubscriptions),
    };
    normalized.records = Array.isArray(state.records)
      ? state.records.map((record) => normalizeRecord(record, normalized)).filter(Boolean)
      : [];
    const budgetKeys = new Set(), billIds = new Set();
    normalized.categoryBudgets = (Array.isArray(state.categoryBudgets) ? state.categoryBudgets : []).map(item => normalizeCategoryBudget(item, baseCurrency)).filter(item => {
      if (!item) return false; const key = `${item.month}:${item.currency}:${item.category.toLocaleLowerCase()}`;
      if (budgetKeys.has(key)) return false; budgetKeys.add(key); return true;
    }).slice(0, 2400);
    normalized.recurringBills = (Array.isArray(state.recurringBills) ? state.recurringBills : []).map(item => normalizeRecurringBill(item, baseCurrency)).filter(item => {
      if (!item || billIds.has(item.id)) return false; billIds.add(item.id); return true;
    }).slice(0, 100);
    return normalized;
  }

  // Only matching record IDs describe the same transaction. Old rows without an
  // ID remain independent choices even if their dates and amounts happen to match.
  function ledgerSide(raw) {
    const book = raw == null ? {} : JSON.parse(raw);
    if (!book || typeof book !== "object" || Array.isArray(book) ||
        (book.records !== undefined && !Array.isArray(book.records))) throw new Error("invalid-ledger");
    const state = normalizeState(book), records = new Map();
    if (state.records.length !== (book.records || []).length) throw new Error("invalid-ledger");
    state.records.forEach((record, index) => {
      if (records.has(record.id) || !Number.isFinite(record.amount)) throw new Error("invalid-ledger");
      records.set(record.id, { ...book.records[index], ...record });
    });
    return { book, state, records };
  }

  function compareLedgers(localRaw, cloudRaw) {
    const local = ledgerSide(localRaw), cloud = ledgerSide(cloudRaw);
    const target = cloudRaw == null ? local : cloud;
    const rows = [];
    for (const id of new Set([...cloud.records.keys(), ...local.records.keys()])) {
      const device = local.records.get(id), remote = cloud.records.get(id);
      const fields = device && remote ? [...new Set([...Object.keys(device), ...Object.keys(remote)])].filter(key =>
        JSON.stringify(device[key]) !== JSON.stringify(remote[key]) ||
        (key === "fxRate" && local.state.baseCurrency !== cloud.state.baseCurrency)
      ) : [];
      rows.push({ id, local: device, cloud: remote, fields, kind: !device ? "cloud" : !remote ? "local" : fields.length ? "changed" : "same" });
    }
    return { local, cloud, target, rows };
  }

  function needsMergeRate(source, target, record) {
    return source.state.baseCurrency !== target.state.baseCurrency && record.currency !== target.state.baseCurrency;
  }

  function mergeLedgerRecords(preview, choices, rates) {
    const { target } = preview;
    const people = new Map(target.state.people.map(person => [person.id, person]));
    const records = [];
    for (const row of preview.rows) {
      const choice = row.kind === "same" ? "cloud" : choices.get(row.id);
      if (choice === "omit") continue;
      if (!["local", "cloud"].includes(choice) || !row[choice]) throw new Error("missing-choice");
      const source = preview[choice], record = { ...row[choice] };
      if (record.currency === target.state.baseCurrency) record.fxRate = 1;
      else if (needsMergeRate(source, target, record)) {
        const rate = Number(rates.get(row.id));
        if (!Number.isFinite(rate) || rate <= 0) throw new Error("missing-rate");
        record.fxRate = rate;
      }
      if (source !== target) {
        const mapPerson = id => {
          if (id === source.state.selfPersonId) return target.state.selfPersonId;
          const person = source.state.people.find(item => item.id === id);
          if (!person || id === target.state.selfPersonId || (people.has(id) && people.get(id).name !== person.name)) {
            throw new Error("people-conflict");
          }
          people.set(id, person);
          return id;
        };
        record.paidById = mapPerson(record.paidById);
        record.splitAmongIds = record.splitAmongIds.map(mapPerson);
      }
      records.push(record);
    }
    if (people.size > 24) throw new Error("people-conflict");
    return { ...target.book, baseCurrency: target.state.baseCurrency, people: [...people.values()], selfPersonId: target.state.selfPersonId, records };
  }

  function changeBaseCurrency(state, value) {
    const current = currencyCode(state.baseCurrency || state.currency, "JPY");
    const next = currencyCode(value, current);
    if (next === current) return { state, changed: false, blocked: false };
    // Saved rates, settlements and budgets are denominated in the original base.
    // A different display currency needs an explicit migration with dated rates;
    // never reinterpret those amounts or normalize their saved rates to one.
    const hasHistory = (Array.isArray(state.records) && state.records.length > 0) ||
      (Array.isArray(state.settlements) && state.settlements.length > 0) ||
      (state.tripBudgets && Object.keys(state.tripBudgets).length > 0);
    const hasPlanning = Boolean(state.categoryBudgets?.length || state.recurringBills?.length);
    if (hasHistory || hasPlanning) return { state, changed: false, blocked: true, reason: "history" };
    return { state: { ...state, baseCurrency: next, currency: currencySymbol(next) }, changed: true, blocked: false };
  }

  function readState(storage) {
    const target = storage || global?.localStorage;
    try {
      return normalizeState(JSON.parse(target?.getItem(STORAGE_KEY) || "{}"));
    } catch (_) {
      return normalizeState({});
    }
  }

  function writeState(state, storage) {
    const target = storage || global?.localStorage;
    const normalized = normalizeState(state);
    target?.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function baseAmount(record) {
    return Number(record?.amount || 0) * Number(record?.fxRate || 1);
  }

  function personalRecords(records) {
    return (Array.isArray(records) ? records : []).filter((record) => record.scope !== "shared");
  }

  function sharedRecords(records) {
    return (Array.isArray(records) ? records : []).filter((record) => record.scope === "shared");
  }

  // Callers choose the ledger/trip scope first. Use saved rates and local calendar
  // dates, with the entire month's day count as the daily-average denominator.
  function monthSpending(records, year, month) {
    const dayCount = new Date(year, month, 0).getDate();
    const prefix = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
    const days = Array.from({ length: dayCount }, (_, index) => ({
      date: `${prefix}-${String(index + 1).padStart(2, "0")}`,
      amount: 0,
      count: 0,
    }));
    const byDate = new Map(days.map(day => [day.date, day]));
    (records || []).forEach(record => {
      const day = byDate.get(record.date);
      if (!day) return;
      day.amount += baseAmount(record);
      day.count++;
    });
    const total = days.reduce((sum, day) => sum + day.amount, 0);
    return { days, total, average: total / dayCount, firstWeekday: new Date(year, month - 1, 1).getDay() };
  }

  function computeBalances(state, records) {
    const balances = Object.fromEntries(state.people.map((person) => [person.id, 0]));
    sharedRecords(records || state.records).forEach((record) => {
      const amount = baseAmount(record);
      const members = record.splitAmongIds.filter((id) => Object.hasOwn(balances, id));
      if (!members.length || !Object.hasOwn(balances, record.paidById)) return;
      balances[record.paidById] += amount;
      const share = amount / members.length;
      members.forEach((id) => {
        balances[id] -= share;
      });
    });
    (state.settlements || []).forEach((settlement) => {
      const amount = Number(settlement.amountBase || settlement.amount || 0);
      if (!(amount > 0)) return;
      if (Object.hasOwn(balances, settlement.fromId)) balances[settlement.fromId] += amount;
      if (Object.hasOwn(balances, settlement.toId)) balances[settlement.toId] -= amount;
    });
    Object.keys(balances).forEach((id) => {
      balances[id] = Math.round(balances[id] * 100) / 100;
    });
    return balances;
  }

  function settlementSuggestions(state, records) {
    const balances = computeBalances(state, records);
    const debtors = Object.entries(balances)
      .filter(([, amount]) => amount < -0.005)
      .map(([id, amount]) => ({ id, amount: -amount }))
      .sort((a, b) => b.amount - a.amount);
    const creditors = Object.entries(balances)
      .filter(([, amount]) => amount > 0.005)
      .map(([id, amount]) => ({ id, amount }))
      .sort((a, b) => b.amount - a.amount);
    const suggestions = [];
    let d = 0;
    let c = 0;
    while (d < debtors.length && c < creditors.length) {
      const amount = Math.min(debtors[d].amount, creditors[c].amount);
      suggestions.push({
        fromId: debtors[d].id,
        toId: creditors[c].id,
        amount: Math.round(amount * 100) / 100,
      });
      debtors[d].amount -= amount;
      creditors[c].amount -= amount;
      if (debtors[d].amount < 0.005) d += 1;
      if (creditors[c].amount < 0.005) c += 1;
    }
    return suggestions;
  }

  function formatAmount(state, amount, currency) {
    const code = currencyCode(currency, state.baseCurrency);
    // The saved legacy symbol belongs to the base currency only; any other code
    // without a known symbol shows its ISO code (e.g. "IDR 20.85"), never the base symbol.
    const symbol = code === state.baseCurrency ? currencySymbol(code, state.currency) : (CODE_TO_SYMBOL[code] || code);
    const separator = /[a-z0-9]$/i.test(symbol) ? " " : "";
    return `${symbol}${separator}${Number(amount || 0).toFixed(2)}`;
  }

  const api = {
    STORAGE_KEY,
    baseAmount,
    categoryBreakdown,
    categoryBudgetProgress,
    changeBaseCurrency,
    computeBalances,
    currencyCode,
    currencySymbol,
    detectSubscriptions,
    dismissSubscription,
    formatAmount,
    monthlyTotals,
    monthSpending,
    nextBillDate,
    normalizeCategoryBudget,
    normalizeRecurringBill,
    compareLedgers,
    mergeLedgerRecords,
    needsMergeRate,
    normalizeRecord,
    normalizeState,
    personalRecords,
    confirmRecurringBill,
    restoreSubscription,
    skipRecurringBill,
    saveRecurringBill,
    subscriptionBill,
    subscriptionKey,
    validDate,
    readState,
    settlementSuggestions,
    sharedRecords,
    uid,
    writeState,
  };

  if (global) global.DailySpaceTallyCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : null);
