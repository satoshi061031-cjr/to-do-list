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
    const symbol = currencySymbol(code, state.currency);
    const separator = /[a-z0-9]$/i.test(symbol) ? " " : "";
    return `${symbol}${separator}${Number(amount || 0).toFixed(2)}`;
  }

  const api = {
    STORAGE_KEY,
    baseAmount,
    categoryBudgetProgress,
    changeBaseCurrency,
    computeBalances,
    currencyCode,
    currencySymbol,
    formatAmount,
    monthSpending,
    nextBillDate,
    normalizeCategoryBudget,
    normalizeRecurringBill,
    normalizeRecord,
    normalizeState,
    personalRecords,
    confirmRecurringBill,
    skipRecurringBill,
    saveRecurringBill,
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
