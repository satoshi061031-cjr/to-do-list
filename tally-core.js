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
      records: [],
      settlements: Array.isArray(state.settlements) ? state.settlements.slice(0, 200) : [],
    };
    normalized.records = Array.isArray(state.records)
      ? state.records.map((record) => normalizeRecord(record, normalized)).filter(Boolean).slice(0, 1000)
      : [];
    return normalized;
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
    computeBalances,
    currencyCode,
    currencySymbol,
    formatAmount,
    normalizeRecord,
    normalizeState,
    personalRecords,
    readState,
    settlementSuggestions,
    sharedRecords,
    uid,
    writeState,
  };

  if (global) global.DailySpaceTallyCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : null);
