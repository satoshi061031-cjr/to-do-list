(function () {
  const Core = window.DailySpaceTallyCore;
  if (!Core) return;

  let state = Core.readState();
  let viewYear = new Date().getFullYear();
  let viewMonth = new Date().getMonth() + 1;
  let viewMode = "personal";
  let editingId = null;
  let fxSerial = 0;
  let fxController = null;
  let fxPending = false;

  const $ = (id) => document.getElementById(id);
  const monthTitleEl = $("tally-month-title");
  const metaEl = $("tally-meta");
  const monthTotalEl = $("tally-month-total");
  const weekTotalEl = $("tally-week-total");
  const todayTotalEl = $("tally-today-total");
  const budgetInput = $("tally-budget");
  const currencyInput = $("tally-currency");
  const progressBar = $("tally-progress-bar");
  const budgetNoteEl = $("tally-budget-note");
  const settingsToggle = $("tally-settings-toggle");
  const settingsPanel = $("tally-settings");
  const form = $("tally-form");
  const dateInput = $("tally-date");
  const amountInput = $("tally-amount");
  const categoryInput = $("tally-category");
  const noteInput = $("tally-note");
  const tripInput = $("tally-trip");
  const extraOptions = $("tally-extra-options");
  let tripFilter = new URLSearchParams(location.search).get("tripFilter") || "";
  const scopeInput = $("tally-scope");
  const recordCurrencyInput = $("tally-record-currency");
  const fxField = $("tally-fx-field");
  const fxRateInput = $("tally-fx-rate");
  const fxHelp = $("tally-fx-help");
  const sharedFields = $("tally-shared-fields");
  const paidByInput = $("tally-paid-by");
  const splitPeopleEl = $("tally-split-people");
  const barsEl = $("tally-bars");
  const weekEmptyEl = $("tally-week-empty");
  const recordListEl = $("tally-record-list");
  const emptyEl = $("tally-empty");
  const emptyPanelEl = $("tally-empty-panel");
  const emptyCtaBtn = $("tally-empty-cta");
  const addOpenBtn = $("tally-add-open");
  const addSheet = $("tally-add-sheet");
  const addCloseBtn = $("tally-add-close");
  const addBackdrop = $("tally-add-backdrop");
  const sheetEyebrowEl = $("tally-sheet-eyebrow");
  const sheetTitleEl = $("tally-add-title");
  const submitBtn = $("tally-submit");
  const categoryOptionsEl = $("tally-category-options");
  const categorySuggestionsEl = $("tally-category-suggestions");
  const settlementEl = $("tally-settlement");
  const sharedTotalEl = $("tally-shared-total");
  const balanceListEl = $("tally-balance-list");
  const settlementListEl = $("tally-settlement-list");
  const peopleListEl = $("tally-people-list");
  const personNameInput = $("tally-person-name");
  const personAddBtn = $("tally-person-add");

  function uiLocale() {
    return window.DailySpaceI18n?.localeTag() || "en-US";
  }

  function isZh() {
    return uiLocale().toLowerCase().startsWith("zh");
  }

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function dateToIso(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function todayIso() {
    return dateToIso(new Date());
  }

  function parseIso(iso) {
    const [year, month, day] = String(iso).split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function weekStart(date) {
    return addDays(date, -date.getDay());
  }

  function monthKey(year, month) {
    return `${year}-${pad2(month)}`;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
    });
  }

  function personName(personId) {
    return state.people.find((person) => person.id === personId)?.name || "Unknown";
  }

  function activeRecords() {
    const records = viewMode === "shared" ? Core.sharedRecords(state.records) : Core.personalRecords(state.records);
    return tripFilter ? records.filter(record => window.DailySpaceTripExpenses.matches(record, tripFilter)) : records;
  }

  function recordsForMonth(records, year, month) {
    const key = monthKey(year, month);
    return records.filter((record) => record.date.startsWith(key));
  }

  function total(records) {
    return records.reduce((sum, record) => sum + Core.baseAmount(record), 0);
  }

  function baseMoney(value) {
    return Core.formatAmount(state, value, state.baseCurrency);
  }

  function originalMoney(record) {
    return Core.formatAmount(state, record.amount, record.currency);
  }

  function saveState() {
    state = Core.writeState(state);
    window.dispatchEvent(new CustomEvent("daily-space-agent-data-updated", { detail: { domains: ["tally"], source: "tally-page" } }));
  }

  function viewAnchorDate() {
    const now = new Date();
    if (viewYear === now.getFullYear() && viewMonth === now.getMonth() + 1) return now;
    return new Date(viewYear, viewMonth - 1, 1);
  }

  function renderViewSwitch() {
    document.querySelectorAll("[data-tally-view]").forEach((button) => {
      const active = button.dataset.tallyView === viewMode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    settlementEl.hidden = viewMode !== "shared";
  }

  function renderSummary() {
    const records = activeRecords();
    const monthRecords = recordsForMonth(records, viewYear, viewMonth);
    const monthTotal = total(monthRecords);
    const personalMonthTotal = total(
      recordsForMonth(Core.personalRecords(state.records), viewYear, viewMonth)
    );
    const start = weekStart(viewAnchorDate());
    const end = addDays(start, 6);
    const weekRecords = records.filter((record) => {
      const date = parseIso(record.date);
      return date >= start && date <= end;
    });
    const spentThisWeek = total(weekRecords);
    const spentToday = total(records.filter((record) => record.date === todayIso()));
    const remaining = state.budget - personalMonthTotal;
    const percent = state.budget > 0 ? Math.min(100, (personalMonthTotal / state.budget) * 100) : 0;
    const overBudget = remaining < 0;

    monthTitleEl.textContent = new Date(viewYear, viewMonth - 1, 1).toLocaleDateString(uiLocale(), {
      year: "numeric",
      month: "long",
    });
    metaEl.textContent =
      viewMode === "shared"
        ? `${monthRecords.length} shared records · converted to ${state.baseCurrency}`
        : overBudget
          ? `${monthRecords.length} records · ${baseMoney(Math.abs(remaining))} over budget`
          : `${monthRecords.length} records · ${percent.toFixed(0)}% of budget used`;
    monthTotalEl.textContent = baseMoney(monthTotal);
    weekTotalEl.textContent = baseMoney(spentThisWeek);
    todayTotalEl.textContent = baseMoney(spentToday);
    budgetInput.value = String(state.budget);
    currencyInput.value = state.baseCurrency;
    progressBar.style.width = `${viewMode === "personal" ? percent : 0}%`;
    progressBar.classList.toggle("is-over", viewMode === "personal" && overBudget);
    budgetNoteEl.textContent = overBudget
      ? `${baseMoney(Math.abs(remaining))} over · ${baseMoney(personalMonthTotal)} spent`
      : `${baseMoney(Math.max(0, remaining))} remaining · ${baseMoney(personalMonthTotal)} spent`;
    budgetNoteEl.classList.toggle("is-over", overBudget);
  }

  function renderBars() {
    const records = activeRecords();
    const start = weekStart(viewAnchorDate());
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index);
      return { date, amount: total(records.filter((record) => record.date === dateToIso(date))) };
    });
    const hasSpend = days.some((day) => day.amount > 0);
    barsEl.innerHTML = "";
    barsEl.hidden = !hasSpend;
    weekEmptyEl.hidden = hasSpend;
    if (!hasSpend) return;
    const max = Math.max(1, ...days.map((day) => day.amount));
    days.forEach((day) => {
      const bar = document.createElement("div");
      bar.className = `tally-bar${day.amount > 0 ? " has-value" : ""}`;
      const height = day.amount > 0 ? Math.max(12, (day.amount / max) * 100) : 0;
      const weekday = day.date.toLocaleDateString(uiLocale(), { weekday: "short" });
      bar.innerHTML = `
        <span class="tally-bar-value">${day.amount ? day.amount.toFixed(0) : ""}</span>
        <span class="tally-bar-track"><span class="tally-bar-fill" style="height:${height}%"></span></span>
        <span class="tally-bar-day">${escapeHtml(weekday)}</span>
      `;
      barsEl.appendChild(bar);
    });
  }

  function groupTitle(iso) {
    if (iso === todayIso()) return "Today";
    if (iso === dateToIso(addDays(new Date(), -1))) return "Yesterday";
    return parseIso(iso).toLocaleDateString(uiLocale(), {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }

  function categoryIcon(category) {
    const normalized = String(category || "").toLowerCase();
    if (/coffee|cafe|咖啡/.test(normalized)) return "☕";
    if (/grocery|market|超市|杂货/.test(normalized)) return "🛒";
    if (/uber|taxi|transport|交通|打车/.test(normalized)) return "🚕";
    if (/dining|restaurant|lunch|dinner|餐|午饭|晚饭/.test(normalized)) return "🍴";
    if (/hotel|住宿|酒店/.test(normalized)) return "⌂";
    if (/shop|购物/.test(normalized)) return "◈";
    return "¥";
  }

  let recordsSignature = "";
  function renderRecords() {
    const monthRecords = recordsForMonth(activeRecords(), viewYear, viewMonth).sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return state.records.indexOf(a) - state.records.indexOf(b);
    });
    const tripNames = new Map(window.DailySpaceTripExpenses.trips().map(trip => [trip.ref, trip.name]));
    const signature = JSON.stringify([viewMode, monthRecords, state.baseCurrency, state.people, uiLocale(), todayIso(), [...tripNames]]);
    if (signature === recordsSignature) return;
    recordsSignature = signature;
    const groups = new Map();
    monthRecords.forEach((record) => {
      if (!groups.has(record.date)) groups.set(record.date, []);
      groups.get(record.date).push(record);
    });
    recordListEl.innerHTML = "";
    groups.forEach((groupRecords, date) => {
      const group = document.createElement("li");
      group.className = "tally-record-group";
      const heading = document.createElement("h2");
      heading.className = "tally-record-group-title";
      heading.textContent = `${groupTitle(date)} · ${baseMoney(total(groupRecords))}`;
      const card = document.createElement("div");
      card.className = "tally-record-group-card";
      groupRecords.forEach((record) => {
        const row = document.createElement("div");
        row.className = "tally-record";
        row.dataset.recordId = record.id;
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        row.setAttribute("aria-label", "Edit record");
        const converted =
          record.currency !== state.baseCurrency
            ? `<small>${baseMoney(Core.baseAmount(record))}</small>`
            : "";
        const detail =
          record.scope === "shared"
            ? isZh()
              ? `${personName(record.paidById)} 付款 · ${record.splitAmongIds.length} 人分摊`
              : `${personName(record.paidById)} paid · split ${record.splitAmongIds.length}`
            : record.note || "";
        row.innerHTML = `
          <span class="tally-record-icon" aria-hidden="true">${categoryIcon(record.category)}</span>
          <div class="tally-record-main">
            <div class="tally-record-category">${escapeHtml(record.category)}</div>
            ${detail ? `<div class="tally-record-note">${escapeHtml(detail)}</div>` : ""}
            ${record.tripId ? `<div class="tally-record-trip" data-i18n-ignore>${escapeHtml(tripNames.get(record.tripId) || record.tripName || (isZh() ? "关联行程" : "Linked trip"))}</div>` : ""}
          </div>
          <div class="tally-record-amount">${originalMoney(record)}${converted}</div>
          <button type="button" class="tally-record-delete" aria-label="Delete record">×</button>
        `;
        row.querySelector(".tally-record-delete").addEventListener("click", (event) => {
          event.stopPropagation();
          const index = state.records.findIndex((item) => item.id === record.id);
          if (index === -1) return;
          const removed = state.records[index];
          state.records = state.records.filter((item) => item.id !== record.id);
          saveState();
          render();
          window.DailySpaceUndo?.offer("Expense deleted", () => {
            state.records.splice(Math.min(index, state.records.length), 0, removed);
            saveState();
            render();
          });
        });
        row.addEventListener("click", (event) => {
          if (!event.target.closest(".tally-record-delete")) setSheetOpen(true, record);
        });
        row.addEventListener("keydown", (event) => {
          if (event.target !== row) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setSheetOpen(true, record);
        });
        card.appendChild(row);
      });
      group.append(heading, card);
      recordListEl.appendChild(group);
    });
    const isEmpty = monthRecords.length === 0;
    emptyPanelEl.hidden = !isEmpty;
    emptyEl.textContent =
      viewMode === "shared" ? "No shared expenses this month." : "No expenses this month.";
    recordListEl.hidden = isEmpty;
  }

  let peopleSignature = "";
  function renderPeople(reset = false) {
    const signature = JSON.stringify([state.people, uiLocale()]);
    if (!reset && signature === peopleSignature) return;
    peopleSignature = signature;
    const preserve = !reset && !addSheet.hidden;
    const payer = paidByInput.value;
    const checked = [...splitPeopleEl.querySelectorAll("input:checked")].map(input => input.value);
    peopleListEl.innerHTML = state.people
      .map(
        (person) =>
          `<span class="tally-person-pill">${escapeHtml(person.name)}${person.isSelf ? " · You" : ""}</span>`
      )
      .join("");
    paidByInput.innerHTML = state.people
      .map((person) => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`)
      .join("");
    const selected = new Set(
      preserve ? checked : editingId
        ? state.records.find((record) => record.id === editingId)?.splitAmongIds || []
        : state.people.map((person) => person.id)
    );
    splitPeopleEl.innerHTML = state.people
      .map(
        (person) => `
          <label class="tally-person-check">
            <input type="checkbox" value="${escapeHtml(person.id)}" ${selected.has(person.id) ? "checked" : ""} />
            <span>${escapeHtml(person.name)}</span>
          </label>
        `
      )
      .join("");
    if (preserve && state.people.some(person => person.id === payer)) paidByInput.value = payer;
  }

  function renderSettlement() {
    if (viewMode !== "shared") return;
    const monthRecords = recordsForMonth(Core.sharedRecords(state.records), viewYear, viewMonth);
    const balances = Core.computeBalances(state, monthRecords);
    const suggestions = Core.settlementSuggestions(state, monthRecords);
    sharedTotalEl.textContent = baseMoney(total(monthRecords));
    balanceListEl.innerHTML = state.people
      .map((person) => {
        const balance = balances[person.id] || 0;
        const label = Math.abs(balance) < 0.005
          ? isZh() ? "已结清" : "Settled"
          : balance > 0
            ? isZh() ? "应收" : "gets back"
            : isZh() ? "应付" : "owes";
        return `
          <div class="tally-balance-row">
            <span>${escapeHtml(person.name)}</span>
            <strong class="${balance < -0.005 ? "is-negative" : ""}">${label} ${baseMoney(Math.abs(balance))}</strong>
          </div>
        `;
      })
      .join("");
    settlementListEl.innerHTML = suggestions.length
      ? `<p class="tally-settlement-kicker">Suggested settlement</p>${suggestions
          .map(
            (item) =>
              isZh()
                ? `<p><b>${escapeHtml(personName(item.fromId))}</b> 支付给 <b>${escapeHtml(personName(item.toId))}</b> ${baseMoney(item.amount)}</p>`
                : `<p><b>${escapeHtml(personName(item.fromId))}</b> pays <b>${escapeHtml(personName(item.toId))}</b> ${baseMoney(item.amount)}</p>`
          )
          .join("")}`
      : `<p class="tally-settled-copy">Everyone is settled up.</p>`;
  }

  function render() {
    window.DailySpaceView?.write("tally", { year: viewYear, month: viewMonth, mode: viewMode });
    const meta = document.getElementById("tally-page-meta");
    if (meta) meta.textContent = new Date().toLocaleDateString(uiLocale(), { weekday: "long", month: "long", day: "numeric" });
    renderViewSwitch();
    renderPeople();
    renderSummary();
    renderBars();
    renderRecords();
    renderSettlement();
  }

  function knownCategories() {
    const seen = new Map();
    state.records.forEach((record) => {
      const category = String(record.category || "").trim();
      if (category && !seen.has(category.toLowerCase())) seen.set(category.toLowerCase(), category);
    });
    return Array.from(seen.values());
  }

  function syncCategorySuggestions(activeCategory) {
    const categories = knownCategories();
    categoryOptionsEl.innerHTML = categories
      .map((category) => `<option value="${escapeHtml(category)}"></option>`)
      .join("");
    const active = String(activeCategory || "").trim().toLowerCase();
    const suggestions = categories.filter((category) => category.toLowerCase() !== active).slice(0, 6);
    categorySuggestionsEl.innerHTML = "";
    suggestions.forEach((category) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tally-category-chip";
      chip.textContent = category;
      chip.addEventListener("click", () => {
        categoryInput.value = category;
        categoryInput.focus();
        syncCategorySuggestions(category);
      });
      categorySuggestionsEl.appendChild(chip);
    });
    categorySuggestionsEl.hidden = !suggestions.length;
  }

  function syncSharedFields() {
    const shared = scopeInput.value === "shared";
    sharedFields.hidden = !shared;
    const foreignCurrency = recordCurrencyInput.value !== state.baseCurrency;
    fxField.hidden = !foreignCurrency;
    fxRateInput.required = foreignCurrency;
    fxHelp.textContent = foreignCurrency
      ? fxPending ? "Fetching rate…" : `1 ${recordCurrencyInput.value} = ${fxRateInput.value || "?"} ${state.baseCurrency}`
      : "";
  }

  function cancelFxRequest() {
    fxSerial++;
    fxController?.abort();
    fxController = null;
    fxPending = false;
    submitBtn.disabled = false;
    fxField.setAttribute("aria-busy", "false");
  }

  function fxContext() {
    return JSON.stringify([window.DailySpaceView.owner(), editingId, dateInput.value || todayIso(), recordCurrencyInput.value, state.baseCurrency]);
  }

  async function refreshFxRate() {
    cancelFxRequest();
    const from = recordCurrencyInput.value;
    syncSharedFields();
    if (!from || from === state.baseCurrency) {
      fxRateInput.value = "1";
      saveDraft();
      return;
    }
    const ticket = fxSerial;
    const context = fxContext();
    const controller = new AbortController();
    fxController = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    const current = () => ticket === fxSerial && context === fxContext() && !addSheet.hidden && !sheetMotion.closing;
    fxRateInput.value = "";
    fxPending = true;
    submitBtn.disabled = true;
    fxField.setAttribute("aria-busy", "true");
    fxHelp.textContent = "Fetching rate…";
    saveDraft();
    try {
      const params = new URLSearchParams({ from, to: state.baseCurrency, date: dateInput.value || todayIso() });
      const response = await fetch(`/api/fx/rate?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error("rate unavailable");
      const payload = await response.json();
      if (!current()) return;
      if (!Number.isFinite(Number(payload.rate)) || !(Number(payload.rate) > 0)) throw new Error("invalid rate");
      fxRateInput.value = String(payload.rate);
      fxHelp.textContent = `1 ${from} = ${Number(payload.rate).toFixed(6)} ${state.baseCurrency}`;
      saveDraft();
    } catch (_) {
      if (current()) fxHelp.textContent = "Rate unavailable — enter it manually.";
    } finally {
      clearTimeout(timeout);
      if (ticket === fxSerial) {
        fxController = null;
        fxPending = false;
        submitBtn.disabled = false;
        fxField.setAttribute("aria-busy", "false");
      }
    }
  }

  function syncSheetMode() {
    const editing = Boolean(editingId);
    sheetEyebrowEl.textContent = editing ? "Edit transaction" : "New transaction";
    sheetTitleEl.textContent = editing ? "Edit expense" : "Add expense";
    submitBtn.textContent = editing ? "Save changes" : "Add transaction";
  }

  const sheetMotion = window.DailySpaceDialogHistory.motion(addSheet);
  const sheetHistory = window.DailySpaceDialogHistory.create("tally", {
    isOpen: () => !addSheet.hidden && !sheetMotion.closing,
    restore: data => {
      const record = data?.id ? state.records.find(item => item.id === data.id) : null;
      if (data?.id && !record) return;
      setSheetOpen(true, record, true);
    },
    close: () => setSheetOpen(false, null, true),
  });
  const fitSheet = window.DailySpaceDialogHistory.fitViewport(addSheet);
  function saveDraft() {
    if (addSheet.hidden || sheetMotion.closing) return;
    window.DailySpaceView.write("tally", { draft: { id: editingId, date: dateInput.value,
      amount: amountInput.value, category: categoryInput.value, note: noteInput.value,
      tripId: tripInput.value || null, tripName: tripInput.selectedOptions[0]?.dataset.tripName || "",
      scope: scopeInput.value, currency: recordCurrencyInput.value, fxRate: fxRateInput.value,
      paidById: paidByInput.value, splitAmongIds: Array.from(splitPeopleEl.querySelectorAll("input:checked")).map(input => input.value) } });
  }
  function setSheetOpen(open, record, fromHistory = false, preserve = true, immediate = false) {
    if (!open) {
      if (addSheet.hidden || (sheetMotion.closing && !immediate)) return;
      if (preserve) saveDraft();
      cancelFxRequest();
      editingId = null;
      sheetMotion.close(() => document.body.classList.remove("tally-sheet-open"), immediate);
      if (!fromHistory) sheetHistory.back();
      return;
    }
    if (!fromHistory && !sheetHistory.push({ id: record?.id || null })) return;
    cancelFxRequest();
    editingId = record?.id || null;
    const draft = window.DailySpaceView.read("tally").draft;
    const value = draft && draft.id === editingId ? draft : record;
    dateInput.value = value?.date || todayIso();
    amountInput.value = value?.amount || "";
    categoryInput.value = value?.category || "";
    noteInput.value = value?.note || "";
    window.DailySpaceTripExpenses.populate(tripInput, value?.tripId || "", value?.tripName);
    scopeInput.value = value?.scope || (viewMode === "shared" ? "shared" : "personal");
    recordCurrencyInput.value = value?.currency || state.baseCurrency;
    fxRateInput.value = String(value?.fxRate ?? 1);
    syncSheetMode();
    renderPeople(true);
    paidByInput.value = value?.paidById || state.selfPersonId;
    syncSharedFields();
    if (value?.splitAmongIds) splitPeopleEl.querySelectorAll("input").forEach(input => { input.checked = value.splitAmongIds.includes(input.value); });
    syncCategorySuggestions(categoryInput.value);
    extraOptions.open = Boolean(value?.note || tripInput.value || scopeInput.value === "shared" || recordCurrencyInput.value !== state.baseCurrency);
    form.scrollTop = 0;
    sheetMotion.open();
    document.body.classList.add("tally-sheet-open");
    fitSheet();
    amountInput.focus({ preventScroll: true });
    if (recordCurrencyInput.value !== state.baseCurrency && !fxRateInput.value) refreshFxRate();
  }
  form.addEventListener("input", saveDraft);
  form.addEventListener("change", saveDraft);
  form.addEventListener("invalid", event => { if (extraOptions.contains(event.target)) extraOptions.open = true; }, true);
  window.addEventListener("pagehide", () => { saveDraft(); cancelFxRequest(); });
  window.addEventListener("daily-space-auth-updated", () => {
    setSheetOpen(false, null, false, false, true);
    form.reset();
    state = Core.readState();
    render();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (sheetMotion.closing || fxPending || !form.reportValidity()) return;
    const amount = Number(amountInput.value);
    const category = categoryInput.value.trim();
    const shared = scopeInput.value === "shared";
    const splitAmongIds = Array.from(splitPeopleEl.querySelectorAll("input:checked")).map(
      (input) => input.value
    );
    if (!(amount > 0) || !category || (shared && !splitAmongIds.length)) return;
    const foreignCurrency = recordCurrencyInput.value !== state.baseCurrency;
    const fxRate = foreignCurrency ? Number(fxRateInput.value) : 1;
    if (!Number.isFinite(fxRate) || !(fxRate > 0)) return;
    const nextRecord = Core.normalizeRecord(
      {
        id: editingId || Core.uid("expense"),
        date: dateInput.value || todayIso(),
        amount,
        currency: recordCurrencyInput.value,
        fxRate,
        category,
        note: noteInput.value,
        tripId: tripInput.value || null,
        tripName: tripInput.value ? tripInput.selectedOptions[0]?.dataset.tripName || "" : "",
        scope: shared ? "shared" : "personal",
        paidById: paidByInput.value,
        splitAmongIds,
      },
      state
    );
    if (!nextRecord) return;
    if (editingId) {
      state.records = state.records.map((record) => (record.id === editingId ? nextRecord : record));
    } else {
      state.records.unshift(nextRecord);
    }
    const recordDate = parseIso(nextRecord.date);
    viewYear = recordDate.getFullYear();
    viewMonth = recordDate.getMonth() + 1;
    viewMode = nextRecord.scope === "shared" ? "shared" : "personal";
    saveState();
    window.DailySpaceView.write("tally", { draft: null });
    setSheetOpen(false, null, false, false);
    render();
  });

  document.querySelectorAll("[data-tally-view]").forEach((button) => {
    button.addEventListener("click", () => {
      viewMode = button.dataset.tallyView === "shared" ? "shared" : "personal";
      render();
    });
  });
  $("tally-prev").addEventListener("click", () => {
    viewMonth -= 1;
    if (viewMonth < 1) {
      viewMonth = 12;
      viewYear -= 1;
    }
    render();
  });
  $("tally-next").addEventListener("click", () => {
    viewMonth += 1;
    if (viewMonth > 12) {
      viewMonth = 1;
      viewYear += 1;
    }
    render();
  });
  $("tally-today").addEventListener("click", () => {
    viewYear = new Date().getFullYear();
    viewMonth = new Date().getMonth() + 1;
    render();
  });
  budgetInput.addEventListener("change", () => {
    state.budget = Number(budgetInput.value) > 0 ? Number(budgetInput.value) : 1000;
    saveState();
    render();
  });
  currencyInput.addEventListener("change", () => {
    state.baseCurrency = Core.currencyCode(currencyInput.value, state.baseCurrency);
    state.currency = Core.currencySymbol(state.baseCurrency, currencyInput.value);
    saveState();
    render();
  });
  settingsToggle.addEventListener("click", () => {
    document.getElementById("tally-tools").open = false;
    settingsPanel.hidden = !settingsPanel.hidden;
    settingsToggle.setAttribute("aria-expanded", String(!settingsPanel.hidden));
  });
  const exportBtn = $("tally-export");
  exportBtn?.addEventListener("click", () => {
    document.getElementById("tally-tools").open = false;
    const rows = [
      ["id", "date", "amount", "currency", "fxRate", "category", "note", "scope", "paidById", "splitAmongIds", "tripId", "tripName", "_format"],
      ...state.records.map((record) => [
        record.id,
        record.date || "",
        record.amount ?? "",
        record.currency || state.baseCurrency || "",
        record.fxRate ?? "",
        record.category || "",
        record.note || "",
        record.scope || "personal",
        record.paidById || "",
        record.splitAmongIds.join("|"),
        record.tripId || "",
        record.tripName || "",
        "daily-space-csv-v1",
      ]),
    ];
    const csv = rows
      .map((row) =>
        row
          .map(window.DailySpaceWorkspaceCore.csvCell)
          .join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `tally-${todayIso()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });
  personAddBtn.addEventListener("click", () => {
    const name = personNameInput.value.trim().slice(0, 60);
    if (!name || state.people.some((person) => person.name.toLowerCase() === name.toLowerCase())) return;
    state.people.push({ id: Core.uid("person"), name, isSelf: false });
    personNameInput.value = "";
    saveState();
    render();
  });
  personNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      personAddBtn.click();
    }
  });
  addOpenBtn.addEventListener("click", () => setSheetOpen(true));
  addCloseBtn.addEventListener("click", () => setSheetOpen(false));
  addBackdrop.addEventListener("click", () => setSheetOpen(false));
  emptyCtaBtn.addEventListener("click", () => setSheetOpen(true));

  const quickForm = $("tally-quick-form");
  const quickAmount = $("tally-quick-amount");
  const quickCategory = $("tally-quick-category");
  if (quickForm && quickAmount && quickCategory) {
    quickForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const amount = Number(quickAmount.value);
      const category = quickCategory.value.trim();
      if (!(amount > 0) || !category) return;
      const nextRecord = Core.normalizeRecord(
        {
          id: Core.uid("expense"),
          date: todayIso(),
          amount,
          currency: state.baseCurrency,
          fxRate: 1,
          category,
          note: "",
          scope: "personal",
          paidById: state.selfPersonId,
          splitAmongIds: [],
        },
        state
      );
      if (!nextRecord) return;
      state.records.unshift(nextRecord);
      saveState();
      quickAmount.value = "";
      quickCategory.value = "";
      render();
      quickAmount.focus();
    });
  }
  scopeInput.addEventListener("change", syncSharedFields);
  recordCurrencyInput.addEventListener("change", refreshFxRate);
  dateInput.addEventListener("change", () => {
    if (recordCurrencyInput.value !== state.baseCurrency) refreshFxRate();
  });
  fxRateInput.addEventListener("input", () => { cancelFxRequest(); syncSharedFields(); });
  categoryInput.addEventListener("input", () => syncCategorySuggestions(categoryInput.value));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !addSheet.hidden) setSheetOpen(false);
  });
  window.addEventListener("daily-space-agent-data-updated", (event) => {
    if (!Array.isArray(event.detail?.domains) || !event.detail.domains.includes("tally")) return;
    if (event.detail.source === "tally-page") return;
    const previousCurrency = state.baseCurrency;
    state = Core.readState();
    render();
    if (previousCurrency !== state.baseCurrency && !addSheet.hidden && !sheetMotion.closing) refreshFxRate();
  });
  window.addEventListener("daily-space-locale-changed", render);

  const savedView = window.DailySpaceView.read("tally");
  if (Number.isInteger(savedView.year) && savedView.year >= 1900 && savedView.year <= 9999 && savedView.month >= 1 && savedView.month <= 12) {
    viewYear = savedView.year; viewMonth = savedView.month;
    viewMode = savedView.mode === "shared" ? "shared" : "personal";
  }
  if (!window.matchMedia("(max-width: 819px)").matches) document.getElementById("tally-insights").open = true;
  if (tripFilter) {
    const filter = document.createElement("button"); filter.type = "button"; filter.className = "tally-trip-filter";
    filter.textContent = `${isZh() ? "旅行费用" : "Trip expenses"} · ${window.DailySpaceTripExpenses.trips().find(trip => trip.ref === tripFilter)?.name || ""} ×`;
    filter.addEventListener("click", () => { tripFilter = ""; filter.remove(); const params = new URLSearchParams(location.search); params.delete("tripFilter"); history.replaceState(history.state, "", `${location.pathname}?${params}${location.hash}`); render(); });
    document.querySelector(".tally-view-switch").after(filter);
  }
  saveState();
  render();
  const captureParams = new URLSearchParams(location.search);
  if (captureParams.get("trip") && !captureParams.has("focus")) {
    const ref = captureParams.get("trip").slice(0, 160); const name = captureParams.get("tripName")?.slice(0, 60) || "";
    const seed = { tripId: ref, tripName: name, date: window.DailySpaceWorkspaceCore.date(captureParams.get("date")) || todayIso() };
    const existingDraft = window.DailySpaceView.read("tally").draft;
    window.DailySpaceView.write("tally", { draft: { ...(existingDraft?.id === null ? existingDraft : {}), ...seed, id: null } });
    requestAnimationFrame(() => setSheetOpen(true));
  }
  const searchTarget = window.DailySpaceSearch?.target();
  if (searchTarget?.focus === "expense") {
    const record = state.records.find(item => item.id === searchTarget.id);
    if (record) {
      const date = parseIso(record.date); viewYear = date.getFullYear(); viewMonth = date.getMonth() + 1;
      viewMode = record.scope === "shared" ? "shared" : "personal";
      render();
      requestAnimationFrame(() => {
        const node = recordListEl.querySelector(`[data-record-id="${CSS.escape(record.id)}"]`);
        window.DailySpaceSearch.highlight(node);
        node?.click();
      });
    } else window.DailySpaceSearch.missing();
  }
  if (history.state?.workspaceSheet?.key === "tally" && history.state.workspaceSheet.owner === window.DailySpaceView.owner()) {
    const id = history.state.workspaceSheet.data?.id;
    const record = id && state.records.find(item => item.id === id);
    if (!id || record) setSheetOpen(true, record, true);
  }
})();
