(function () {
  const Core = window.DailySpaceTallyCore;
  if (!Core) return;
  const deleteIcon = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';

  let state = Core.readState();
  let viewYear = new Date().getFullYear();
  let viewMonth = new Date().getMonth() + 1;
  let viewMode = "personal";
  let ledgerLayout = "list";
  let selectedDay = "";
  let viewOwner = window.DailySpaceView.owner();
  let editingId = null;
  let fxSerial = 0;
  let fxController = null;
  let fxPending = false;
  let composing = false;
  let savingExpense = false;
  let continuingEntry = false;
  let planningUI = null, quickAddUI = null, insightsUI = null, receiptUI = null;

  const $ = (id) => document.getElementById(id);
  const monthTitleEl = $("tally-month-title");
  const metaEl = $("tally-meta");
  const monthTotalEl = $("tally-month-total");
  const weekTotalEl = $("tally-week-total");
  const todayTotalEl = $("tally-today-total");
  const monthViewEl = $("tally-month-view");
  const monthGridEl = $("tally-month-grid");
  const weekdaysEl = $("tally-month-weekdays");
  const daySummaryEl = $("tally-day-summary");
  const budgetInput = $("tally-budget");
  const currencyInput = $("tally-currency");
  const currencyNote = $("tally-currency-note");
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
  let tripFilter = (new URLSearchParams(location.search).get("tripFilter") || "").trim().slice(0, 160);
  const scopeInput = $("tally-scope");
  const recordCurrencyInput = $("tally-record-currency");
  const quickCurrency = $("tally-quick-currency");
  const quickRate = $("tally-quick-rate");
  const quickFx = $("tally-quick-fx");
  for (const option of recordCurrencyInput.options) quickCurrency.add(new Option(option.text, option.value));
  let quickOwner, quickBase, quickRateContext = "", quickRateRequest;
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
  // Desktop keeps "Add expense" in the page action cluster instead of floating
  // over the ledger; phone keeps the full-width capture above the dock.
  (function placeAddButton() {
    const actions = document.querySelector(".tally-intro-actions");
    if (!addOpenBtn || !actions || !window.matchMedia) return;
    const home = document.createComment("tally-add-open");
    addOpenBtn.before(home);
    const wide = window.matchMedia("(min-width: 820px)");
    const place = () => {
      if (wide.matches) actions.prepend(addOpenBtn);
      else home.after(addOpenBtn);
      addOpenBtn.classList.toggle("is-inline", wide.matches);
    };
    place();
    wide.addEventListener?.("change", place);
  })();
  const addSheet = $("tally-add-sheet");
  const addCloseBtn = $("tally-add-close");
  const addBackdrop = $("tally-add-backdrop");
  const sheetTitleEl = $("tally-add-title");
  const submitBtn = $("tally-submit");
  const saveAnotherBtn = $("tally-save-another");
  const entryStatusEl = $("tally-entry-status");
  const formErrorEl = $("tally-form-error");
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

  function ensureSelectedDay() {
    const key = monthKey(viewYear, viewMonth);
    if (selectedDay.startsWith(`${key}-`) && dateToIso(parseIso(selectedDay)) === selectedDay) return;
    selectedDay = todayIso().startsWith(`${key}-`) ? todayIso() : `${key}-01`;
  }

  function restoreView() {
    const saved = window.DailySpaceView.read("tally");
    const now = new Date();
    viewYear = now.getFullYear(); viewMonth = now.getMonth() + 1;
    if (Number.isInteger(saved.year) && saved.year >= 1900 && saved.year <= 9999 && Number.isInteger(saved.month) && saved.month >= 1 && saved.month <= 12) {
      viewYear = saved.year; viewMonth = saved.month;
    }
    viewMode = saved.mode === "shared" ? "shared" : "personal";
    ledgerLayout = saved.layout === "month" ? "month" : "list";
    selectedDay = typeof saved.day === "string" ? saved.day : "";
    ensureSelectedDay();
  }

  function captureDate() {
    return ledgerLayout === "month" ? selectedDay : todayIso();
  }

  function filteredTripLink() {
    if (!tripFilter) return { tripId: null, tripName: "" };
    const trip = window.DailySpaceTripExpenses.trips().find(item => item.ref === tripFilter);
    const record = state.records.find(item => window.DailySpaceTripExpenses.matches(item, tripFilter));
    return { tripId: tripFilter, tripName: trip?.name || record?.tripName || "" };
  }

  function changeMonth(offset) {
    const next = new Date(viewYear, viewMonth - 1 + offset, 1);
    if (next.getFullYear() < 1900 || next.getFullYear() > 9999) return;
    const day = parseIso(selectedDay).getDate();
    viewYear = next.getFullYear(); viewMonth = next.getMonth() + 1;
    selectedDay = dateToIso(new Date(viewYear, viewMonth - 1, Math.min(day, new Date(viewYear, viewMonth, 0).getDate())));
    render();
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
    document.querySelectorAll("[data-tally-layout]").forEach(button => {
      const active = button.dataset.tallyLayout === ledgerLayout;
      button.setAttribute("aria-pressed", String(active));
      button.textContent = button.dataset.tallyLayout === "month" ? (isZh() ? "月历" : "Month") : (isZh() ? "列表" : "List");
    });
    $("tally-layout-switch").setAttribute("aria-label", isZh() ? "账单显示方式" : "Transactions view");
    monthViewEl.hidden = ledgerLayout !== "month";
    daySummaryEl.hidden = ledgerLayout !== "month";
    $("tally-list-total").hidden = ledgerLayout === "month";
    $("tally-today-strip").hidden = ledgerLayout === "month";
    $("tally-prev").disabled = viewYear === 1900 && viewMonth === 1;
    $("tally-next").disabled = viewYear === 9999 && viewMonth === 12;
  }

  let calendarKey = "";
  let weekdaysLocale = "";
  function renderMonth() {
    if (ledgerLayout !== "month") return;
    const overview = Core.monthSpending(activeRecords(), viewYear, viewMonth);
    const key = monthKey(viewYear, viewMonth);
    if (weekdaysLocale !== uiLocale()) {
      weekdaysLocale = uiLocale();
      weekdaysEl.replaceChildren(...Array.from({ length: 7 }, (_, index) => {
        const day = document.createElement("span");
        day.textContent = new Date(2026, 0, 4 + index).toLocaleDateString(uiLocale(), { weekday: "narrow" });
        return day;
      }));
    }
    if (calendarKey !== key) {
      calendarKey = key;
      const nodes = Array.from({ length: overview.firstWeekday }, () => {
        const spacer = document.createElement("span"); spacer.setAttribute("aria-hidden", "true"); return spacer;
      });
      overview.days.forEach((day, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tally-month-day";
        button.dataset.tallyDay = day.date;
        button.setAttribute("aria-controls", "tally-day-summary tally-record-list");
        const number = document.createElement("span"); number.className = "tally-month-date"; number.textContent = String(index + 1);
        const amount = document.createElement("span"); amount.className = "tally-month-amount";
        button.append(number, amount);
        button.addEventListener("click", () => { selectedDay = day.date; render(); });
        nodes.push(button);
      });
      monthGridEl.replaceChildren(...nodes);
    }
    const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
    monthGridEl.querySelectorAll("[data-tally-day]").forEach((button, index) => {
      const day = overview.days[index];
      const fullDate = parseIso(day.date).toLocaleDateString(uiLocale(), { year: "numeric", month: "long", day: "numeric", weekday: "long" });
      button.setAttribute("aria-pressed", String(day.date === selectedDay));
      button.tabIndex = day.date === selectedDay ? 0 : -1;
      if (day.date === todayIso()) button.setAttribute("aria-current", "date");
      else button.removeAttribute("aria-current");
      button.classList.toggle("has-spend", day.count > 0);
      const label = `${fullDate} · ${baseMoney(day.amount)} · ${isZh() ? `${day.count} 笔支出` : `${day.count} expense${day.count === 1 ? "" : "s"}`}`;
      button.setAttribute("aria-label", label);
      button.title = label;
      const amount = day.amount >= 1000 ? compact.format(day.amount).toLowerCase()
        : new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: day.amount < 10 ? 2 : 1 }).format(day.amount);
      const amountEl = button.querySelector(".tally-month-amount");
      const text = day.count ? amount : "–";
      if (amountEl.textContent !== text) amountEl.textContent = text;
    });
    monthViewEl.setAttribute("aria-label", isZh() ? "月度支出" : "Monthly spending");
    $("tally-month-hint").textContent = isZh() ? `每日概览 · ${state.baseCurrency} · 点选查看完整金额` : `Daily overview · ${state.baseCurrency} · Select a day for exact amounts`;
    $("tally-calendar-total-label").textContent = isZh() ? "本月支出" : "Month total";
    $("tally-calendar-average-label").textContent = isZh() ? "日均支出" : "Daily average";
    $("tally-calendar-total").textContent = baseMoney(overview.total);
    $("tally-calendar-average").textContent = baseMoney(overview.average);
    $("tally-average-note").textContent = isZh() ? `日均按整月 ${overview.days.length} 天计算` : `Daily average uses all ${overview.days.length} days of this month`;
    const selected = overview.days.find(day => day.date === selectedDay);
    $("tally-day-title").textContent = parseIso(selectedDay).toLocaleDateString(uiLocale(), { month: "long", day: "numeric", weekday: "long" });
    $("tally-day-meta").textContent = `${baseMoney(selected.amount)} · ${isZh() ? `${selected.count} 笔支出` : `${selected.count} expense${selected.count === 1 ? "" : "s"}`}`;
    $("tally-day-add").textContent = isZh() ? "记一笔" : "Add expense";
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
    monthTotalEl.textContent = baseMoney(monthTotal) + " " + state.baseCurrency;
    weekTotalEl.textContent = baseMoney(spentThisWeek) + " " + state.baseCurrency;
    todayTotalEl.textContent = baseMoney(spentToday) + " " + state.baseCurrency;
    budgetInput.value = String(state.budget);
    currencyInput.value = state.baseCurrency;
    const currencyLocked = Boolean(state.records.length || state.settlements.length || Object.keys(state.tripBudgets).length || state.categoryBudgets.length || state.recurringBills.length);
    currencyInput.readOnly = currencyLocked;
    currencyInput.setAttribute("aria-describedby", "tally-currency-note");
    currencyNote.hidden = !currencyLocked;
    currencyNote.textContent = currencyLocked ? (isZh()
      ? "账本已有记录、结算或预算/账单，基础币种已锁定；可为单笔支出选择其他币种。"
      : "Base currency is locked while this ledger has records, settlements, budgets or bills. Add expenses in another currency instead.") : "";
    // Clip rather than resize: the bar animates without re-laying out the page and keeps its rounded ends.
    progressBar.style.setProperty("--progress", `${Math.max(0, Math.min(100, viewMode === "personal" ? percent : 0))}%`);
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
    // Only the first view grows the bars; later re-renders update them in place.
    if (!barsEl.dataset.grown) { barsEl.dataset.grown = "1"; setTimeout(() => barsEl.classList.add("is-settled"), 400); }
  }

  function groupTitle(iso) {
    if (iso === todayIso()) return isZh() ? "今天" : "Today";
    if (iso === dateToIso(addDays(new Date(), -1))) return isZh() ? "昨天" : "Yesterday";
    return parseIso(iso).toLocaleDateString(uiLocale(), {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }

  function categoryIcon(category) {
    const normalized = String(category || "").toLowerCase();
    let paths = '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>';
    if (/coffee|cafe|咖啡/.test(normalized)) paths = '<path d="M4 8h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4ZM16 9h2a3 3 0 0 1 0 6h-2M7 3v2M12 3v2M3 22h15"/>';
    else if (/grocery|market|超市|杂货/.test(normalized)) paths = '<path d="M2 3h3l3 13h11l3-9H6"/><circle cx="9" cy="21" r="1"/><circle cx="18" cy="21" r="1"/>';
    else if (/uber|taxi|transport|交通|打车/.test(normalized)) paths = '<path d="m5 10 2-6h10l2 6M3 17v-5l2-2h14l2 2v5ZM5 17v3M19 17v3M7 14h1M16 14h1"/>';
    else if (/dining|restaurant|lunch|dinner|餐|午饭|晚饭/.test(normalized)) paths = '<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M19 3c-3 2-4 5-4 9h4M19 3v18"/>';
    else if (/hotel|住宿|酒店/.test(normalized)) paths = '<path d="M3 19V9M21 19v-7H3M3 16h18M7 12V7h4v5M12 12V7h5a4 4 0 0 1 4 4v1"/>';
    else if (/shop|购物/.test(normalized)) paths = '<path d="M5 7h14l2 14H3ZM8 7V5a4 4 0 0 1 8 0v2"/>';
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false">${paths}</svg>`;
  }

  let recordsSignature = "";
  function renderRecords() {
    const monthRecords = recordsForMonth(activeRecords(), viewYear, viewMonth).filter(record => ledgerLayout !== "month" || record.date === selectedDay).sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return state.records.indexOf(a) - state.records.indexOf(b);
    });
    const tripNames = new Map(window.DailySpaceTripExpenses.trips().map(trip => [trip.ref, trip.name]));
    const signature = JSON.stringify([viewYear, viewMonth, viewMode, ledgerLayout, selectedDay, monthRecords, state.baseCurrency, state.people, uiLocale(), todayIso(), [...tripNames]]);
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
      heading.hidden = ledgerLayout === "month";
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
          <button type="button" class="tally-record-delete" aria-label="Delete record">${deleteIcon}</button>
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
    $("tally-empty-kicker").hidden = ledgerLayout === "month";
    emptyCtaBtn.hidden = ledgerLayout === "month";
    emptyEl.dataset.i18nIgnore = "true";
    emptyEl.textContent = ledgerLayout === "month"
      ? (viewMode === "shared" ? (isZh() ? "这天还没有多人支出。" : "No shared expenses on this day.") : (isZh() ? "这天还没有支出。" : "No expenses on this day."))
      : (viewMode === "shared" ? (isZh() ? "本月还没有多人支出。" : "No shared expenses this month.") : (isZh() ? "本月还没有支出。" : "No expenses this month."));
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
    ensureSelectedDay();
    syncQuickCurrency();
    window.DailySpaceView?.write("tally", { year: viewYear, month: viewMonth, mode: viewMode, layout: ledgerLayout, day: selectedDay });
    const meta = document.getElementById("tally-page-meta");
    if (meta) meta.textContent = new Date().toLocaleDateString(uiLocale(), { weekday: "long", month: "long", day: "numeric" });
    renderViewSwitch();
    renderPeople();
    renderSummary();
    renderBars();
    renderMonth();
    renderRecords();
    renderSettlement();
    insightsUI?.render(); planningUI?.render(); quickAddUI?.render();
    document.querySelector(".tally-app")?.classList.add("is-rendered");
  }

  /**
   * Quick add from outside the app (e.g. an iOS Shortcut). The key is shown once;
   * only its identifier is kept in the synced ledger, and clearing it revokes the key.
   */
  function mountQuickAdd() {
    const tr = (en, zh) => isZh() ? zh : en;
    const node = (tag, text = "", className = "") => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
    const copy = (tag, en, zh, cls) => { const el = node(tag, tr(en, zh), cls); el.dataset.quickEn = en; el.dataset.quickZh = zh; return el; };
    const action = (en, zh, run) => { const el = copy("button", en, zh); el.type = "button"; el.addEventListener("click", run); return el; };
    const root = node("details", "", "tally-planning tally-quick-add"); root.id = "tally-quick-add"; root.dataset.i18nIgnore = "";
    const summary = copy("summary", "Shortcut quick add", "快捷指令记账");
    const body = node("div", "", "tally-planning-body");
    const help = copy("p", "Record an expense without opening dayfly — for example from an iOS Shortcut, by sending the amount to your personal address with a key.", "不打开 dayfly 也能记一笔：例如在 iOS 快捷指令里，用密钥把金额发到你的专属地址。", "tally-plan-help");
    const state_ = node("p", "", "tally-plan-help"); state_.setAttribute("role", "status"); state_.setAttribute("aria-live", "polite");
    const reveal = node("div", "", "tally-quick-reveal"); reveal.hidden = true;
    const readonly = (labelEn, labelZh, id) => {
      const label = node("label"); const field = node("input"); field.type = "text"; field.readOnly = true; field.id = id; field.spellcheck = false;
      field.addEventListener("focus", () => field.select());
      const copyButton = action("Copy", "复制", async () => {
        try { await navigator.clipboard.writeText(field.value); copyButton.textContent = tr("Copied", "已复制"); }
        catch (_) { field.focus(); field.select(); copyButton.textContent = tr("Select and copy", "请手动复制"); }
      });
      const row = node("span", "", "tally-quick-row"); row.append(field, copyButton);
      label.append(copy("span", labelEn, labelZh), row); return { label, field };
    };
    const address = readonly("Address (POST)", "接口地址（POST）", "tally-quick-endpoint");
    const secret = readonly("Key — shown only once", "密钥 — 只显示这一次", "tally-quick-token");
    const example = node("pre", "", "tally-quick-example");
    const once = copy("p", "Paste the key into your Shortcut now. It cannot be shown again; create a new key if you lose it.", "请现在就把密钥粘贴到快捷指令里。之后无法再次查看，丢失后只能重新生成。", "tally-plan-help");
    reveal.append(address.label, secret.label, once, example);
    const create = action("Create key", "生成密钥", createKey);
    const revoke = action("Turn off", "停用", () => {
      if (!canEdit()) return;
      const previous = Core.readState(); state = { ...previous, quickAddKeyId: null }; saveState(); reveal.hidden = true; secret.field.value = ""; render();
    });
    const actions = node("div", "", "tally-plan-actions"); actions.append(create, revoke);
    body.append(help, state_, actions, reveal); root.append(summary, body);
    (document.getElementById("tally-planning") || $("tally-quick-options")).after(root);
    const more = action("Shortcut quick add", "快捷指令记账", () => { $("tally-tools").open = false; root.open = true; root.scrollIntoView({ block: "start", behavior: "auto" }); summary.focus({ preventScroll: true }); });
    $("tally-tools").querySelector(".workspace-menu-panel").append(more);
    let busy = false, notice = null;
    const signedIn = () => window.DailySpaceView.owner() !== "guest";
    function canEdit() {
      return viewOwner === window.DailySpaceView.owner() && document.documentElement.dataset.workspaceReady !== "false" && document.documentElement.dataset.workspaceLocked !== "true" && !localStorage.getItem("daily-space-snapshot-recovery-v1");
    }
    async function createKey() {
      if (busy || !signedIn() || !canEdit()) return;
      const owner = viewOwner; busy = true; notice = null; render();
      try {
        const response = await fetch("/api/tally/quick-add/key", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "" }) });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.token || !data.keyId) throw new Error(data.error || "failed");
        if (owner !== window.DailySpaceView.owner() || !canEdit()) throw new Error("changed");
        // Saving the identifier makes this key the only active one; any earlier key stops working.
        state = { ...Core.readState(), quickAddKeyId: data.keyId }; saveState();
        address.field.value = data.endpoint; secret.field.value = data.token;
        example.textContent = `POST ${data.endpoint}\nAuthorization: Bearer <${tr("key", "密钥")}>\nContent-Type: application/json\n\n{ "amount": 32, "category": "${tr("Lunch", "午餐")}", "note": "" }`;
        reveal.hidden = false;
      } catch (_) {
        notice = ["Could not create a key. Check your connection and sign-in, then try again.", "生成密钥失败，请检查网络和登录状态后重试。"];
      } finally { busy = false; render(); }
    }
    function render() {
      root.querySelectorAll("[data-quick-en]").forEach(el => { el.textContent = isZh() ? el.dataset.quickZh : el.dataset.quickEn; });
      const active = Boolean(state.quickAddKeyId), member = signedIn();
      if (!active && !busy) { reveal.hidden = true; secret.field.value = ""; }
      create.disabled = busy || !member; revoke.hidden = !active;
      create.textContent = busy ? tr("Creating…", "正在生成…") : active ? tr("Replace key", "更换密钥") : tr("Create key", "生成密钥");
      state_.textContent = notice ? tr(...notice)
        : !member ? tr("Sign in with Google to use quick add; guest data stays on this device only.", "使用 Google 登录后才能使用；访客数据只保存在本机。")
        : !active ? tr("Quick add is off.", "尚未开启。")
        : !reveal.hidden ? tr("Key created. It starts working a few seconds after this device syncs.", "密钥已生成，本机同步完成后几秒内生效。")
        : tr("Quick add is on. One key is active.", "已开启，当前有一个生效的密钥。");
    }
    render();
    return { render };
  }

  /** Optional personal-ledger planning; normal capture remains amount-first. */
  function mountPlanning() {
    const tr = (en, zh) => isZh() ? zh : en;
    const node = (tag, text = "", className = "") => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
    const copy = (tag, en, zh, cls) => { const el = node(tag, tr(en, zh), cls); el.dataset.planEn = en; el.dataset.planZh = zh; return el; };
    const action = (en, zh, run) => { const el = copy("button", en, zh); el.type = "button"; el.addEventListener("click", run); return el; };
    const field = (en, zh, input) => { const label = node("label"); label.append(copy("span", en, zh), input); return label; };
    const input = (name, type = "text", maxLength) => { const el = node("input"); el.name = name; el.type = type; if (maxLength) el.maxLength = maxLength; return el; };
    const root = node("details", "", "tally-planning"); root.id = "tally-planning"; root.dataset.i18nIgnore = "";
    const summary = copy("summary", "Budgets & bills", "分类预算与周期账单");
    const body = node("div", "", "tally-planning-body"), status = node("p", "", "tally-planning-status"); status.setAttribute("role", "status");
    const budgetHeading = node("h2"), budgetHelp = copy("p", "Category limits use your personal expenses and saved exchange rates for the selected month.", "分类额度按所选月份的个人支出和已保存汇率计算。", "tally-card-note");
    const budgetList = node("div", "", "tally-plan-list"), allocation = node("p", "", "tally-card-note");
    const budgetForm = node("form", "", "tally-plan-form"); budgetForm.id = "tally-category-budget-form";
    const budgetCategory = input("category", "text", 40); budgetCategory.required = true; budgetCategory.setAttribute("list", "tally-category-options");
    const budgetAmount = input("amount", "number"); budgetAmount.required = true; budgetAmount.min = "0.01"; budgetAmount.max = "1000000000000"; budgetAmount.step = "0.01"; budgetAmount.inputMode = "decimal";
    const budgetSave = copy("button", "Save category limit", "保存分类额度"); budgetSave.type = "submit";
    budgetForm.append(field("Category", "分类", budgetCategory), field("Limit in base currency", "基础币种额度", budgetAmount), budgetSave);
    const billHeading = copy("h2", "Recurring bills", "周期账单"), billHelp = copy("p", "Bills stay pending until you confirm an expense. Skipping advances only that occurrence.", "到期后需手动确认才会记账；跳过仅略过本次。", "tally-card-note");
    const billList = node("div", "", "tally-plan-list"), billEditor = node("details", "", "tally-bill-editor");
    const billEditorSummary = copy("summary", "Add or edit a bill", "添加或编辑账单");
    const billForm = node("form", "", "tally-plan-form"); billForm.id = "tally-recurring-form";
    const billName = input("name", "text", 60); billName.required = true;
    const billAmount = input("amount", "number"); billAmount.required = true; billAmount.min = "0.01"; billAmount.max = "1000000000000"; billAmount.step = "0.01"; billAmount.inputMode = "decimal";
    const billDate = input("nextDate", "date"); billDate.required = true; billDate.min = "1900-01-01"; billDate.max = "9999-12-31";
    const billInterval = node("select"); billInterval.name = "interval";
    for (const [value, en, zh] of [["monthly", "Monthly", "每月"], ["yearly", "Yearly", "每年"]]) { const option = copy("option", en, zh); option.value = value; billInterval.append(option); }
    const billCategory = input("category", "text", 40); billCategory.setAttribute("list", "tally-category-options");
    const billCurrency = input("currency", "text", 3); billCurrency.required = true; billCurrency.pattern = "[A-Za-z]{3}"; billCurrency.setAttribute("list", "tally-currency-options"); billCurrency.autocapitalize = "characters";
    const billFx = input("fxRate", "number"); billFx.min = "0.000001"; billFx.max = "1000000"; billFx.step = "any"; billFx.inputMode = "decimal";
    const billNote = input("note", "text", 120), billEnabled = input("enabled", "checkbox"); billEnabled.checked = true;
    const fxLabel = field("Saved rate to base currency", "保存的基础币种汇率", billFx);
    const billSave = copy("button", "Save bill", "保存账单"); billSave.type = "submit";
    let editingBillId = null, editingBudgetId = null, editorOwner = viewOwner, busy = false, ime = false;
    const resetBill = () => { editingBillId = null; billForm.reset(); billDate.value = todayIso(); billCurrency.value = state.baseCurrency; billFx.value = "1"; billEnabled.checked = true; syncBillFx(); };
    const billCancel = action("Clear editor", "清空编辑", () => { resetBill(); persistDraft(); });
    billForm.append(field("Bill name", "账单名称", billName), field("Amount", "金额", billAmount), field("Next due date", "下次到期", billDate), field("Repeats", "重复周期", billInterval), field("Category (optional)", "分类（可选）", billCategory), field("Currency", "币种", billCurrency), fxLabel, field("Note (optional)", "备注（可选）", billNote), field("Enabled", "启用", billEnabled), billSave, billCancel);
    billEditor.append(billEditorSummary, billForm);
    body.append(budgetHeading, budgetHelp, allocation, budgetList, budgetForm, billHeading, billHelp, billList, billEditor, status); root.append(summary, body);
    (document.getElementById("tally-spending-insights") || $("tally-quick-options")).after(root);
    const more = action("Budgets & bills", "分类预算与周期账单", () => { $("tally-tools").open = false; root.open = true; root.scrollIntoView({ block: "start", behavior: "auto" }); summary.focus({ preventScroll: true }); });
    $("tally-tools").querySelector(".workspace-menu-panel").append(more);
    function ready(expectedOwner = editorOwner) {
      return expectedOwner === window.DailySpaceView.owner() && expectedOwner === viewOwner && document.documentElement.dataset.workspaceReady !== "false" && document.documentElement.dataset.workspaceLocked !== "true" && !localStorage.getItem("daily-space-snapshot-recovery-v1");
    }
    function message(en, zh, error = false) { status.textContent = tr(en, zh); status.classList.toggle("is-error", error); }
    function commit(transform, expectedOwner = editorOwner) {
      if (busy || !ready(expectedOwner)) { message("Your workspace changed. Reopen this page before saving.", "工作台已变更，请重新打开本页后保存。", true); return false; }
      const previous = Core.readState(); busy = true;
      try { state = transform(previous); saveState(); render(); return true; }
      catch (_) { state = previous; message("Could not save. Your form is still here; check device storage and retry.", "保存失败，表单已保留；请检查本机存储后重试。", true); return false; }
      finally { busy = false; }
    }
    function syncBillFx() { const foreign = billCurrency.value.toUpperCase() !== state.baseCurrency; fxLabel.hidden = !foreign; billFx.required = foreign; if (!foreign) billFx.value = "1"; }
    function persistDraft() {
      if (!ready()) return;
      window.DailySpaceView.write("tally", { planningDraft: { editingBillId, editingBudgetId, billOpen: billEditor.open, bill: Object.fromEntries(new FormData(billForm)), enabled: billEnabled.checked, budget: { category: budgetCategory.value, amount: budgetAmount.value } } });
    }
    function restoreDraft() {
      const draft = window.DailySpaceView.read("tally").planningDraft;
      resetBill(); budgetForm.reset();
      if (!draft || typeof draft !== "object") return;
      const existing = draft.editingBillId && state.recurringBills.find(item => item.id === draft.editingBillId);
      editingBillId = existing ? existing.id : null;
      editingBudgetId = state.categoryBudgets.some(item => item.id === draft.editingBudgetId) ? draft.editingBudgetId : null;
      if (!draft.editingBillId || existing) for (const key of ["name", "amount", "nextDate", "interval", "category", "currency", "fxRate", "note"]) if (typeof draft.bill?.[key] === "string") billForm.elements[key].value = draft.bill[key];
      billEnabled.checked = draft.enabled !== false; billEditor.open = Boolean(draft.billOpen);
      budgetCategory.value = typeof draft.budget?.category === "string" ? draft.budget.category.slice(0, 40) : ""; budgetAmount.value = draft.budget?.amount || ""; syncBillFx();
    }
    function editBill(id) {
      const bill = state.recurringBills.find(item => item.id === id); if (!bill || !ready()) return;
      editingBillId = id; billEditor.open = true;
      for (const key of ["name", "amount", "nextDate", "interval", "category", "currency", "fxRate", "note"]) billForm.elements[key].value = bill[key];
      billEnabled.checked = bill.enabled; syncBillFx(); persistDraft(); billName.focus();
    }
    budgetForm.addEventListener("submit", event => {
      event.preventDefault(); if (ime || event.isComposing || !budgetForm.reportValidity()) return;
      const category = budgetCategory.value.trim(), month = monthKey(viewYear, viewMonth), amount = Number(budgetAmount.value);
      if (!category) return;
      if (commit(current => {
        const existing = current.categoryBudgets.find(item => item.id === editingBudgetId && item.month === month && item.currency === current.baseCurrency) || current.categoryBudgets.find(item => item.month === month && item.currency === current.baseCurrency && item.category.toLocaleLowerCase() === category.toLocaleLowerCase());
        if (current.categoryBudgets.some(item => item.id !== existing?.id && item.month === month && item.currency === current.baseCurrency && item.category.toLocaleLowerCase() === category.toLocaleLowerCase())) throw new Error("duplicate category");
        const budget = Core.normalizeCategoryBudget({ id: existing?.id, month, category, amount, currency: current.baseCurrency }, current.baseCurrency);
        if (!budget || (!existing && current.categoryBudgets.length >= 2400)) throw new Error("budget");
        return { ...current, categoryBudgets: existing ? current.categoryBudgets.map(item => item.id === existing.id ? budget : item) : [...current.categoryBudgets, budget] };
      })) { editingBudgetId = null; budgetForm.reset(); persistDraft(); message("Category limit saved.", "分类额度已保存。"); }
    });
    billForm.addEventListener("submit", event => {
      event.preventDefault(); if (ime || event.isComposing || !billForm.reportValidity()) return;
      const values = Object.fromEntries(new FormData(billForm));
      if (commit(current => {
        const old = current.recurringBills.find(item => item.id === editingBillId);
        const retainAnchor = old && old.nextDate === values.nextDate && old.interval === values.interval;
        return Core.saveRecurringBill(current, { ...values, id: editingBillId || undefined, currency: values.currency.toUpperCase(), enabled: billEnabled.checked, anchorDay: retainAnchor ? old.anchorDay : undefined, anchorMonth: retainAnchor ? old.anchorMonth : undefined });
      })) { resetBill(); billEditor.open = false; persistDraft(); message("Bill saved. It will only be recorded after confirmation.", "账单已保存，手动确认后才会记账。"); }
    });
    for (const form of [budgetForm, billForm]) {
      form.addEventListener("input", persistDraft); form.addEventListener("change", persistDraft);
      form.addEventListener("compositionstart", () => { ime = true; }); form.addEventListener("compositionend", () => { ime = false; });
      form.addEventListener("keydown", event => { if (event.key === "Enter" && (ime || event.isComposing || event.keyCode === 229)) event.preventDefault(); });
    }
    billCurrency.addEventListener("input", syncBillFx); billEditor.addEventListener("toggle", persistDraft);
    window.addEventListener("pagehide", persistDraft);
    restoreDraft();
    return { render() {
      if (editorOwner !== window.DailySpaceView.owner()) { editorOwner = window.DailySpaceView.owner(); resetBill(); editingBudgetId = null; budgetForm.reset(); billEditor.open = false; root.open = false; status.textContent = ""; }
      if (!editingBillId && !billName.value && !billAmount.value) { billCurrency.value = state.baseCurrency; syncBillFx(); }
      root.querySelectorAll("[data-plan-en]").forEach(el => { el.textContent = isZh() ? el.dataset.planZh : el.dataset.planEn; });
      more.textContent = tr("Budgets & bills", "分类预算与周期账单");
      body.hidden = !ready();
      const month = monthKey(viewYear, viewMonth), ownerAtRender = editorOwner;
      const dueCount = state.recurringBills.filter(bill => bill.enabled && bill.nextDate <= todayIso()).length;
      summary.textContent = `${tr("Budgets & bills", "分类预算与周期账单")}${dueCount ? tr(` · ${dueCount} pending`, ` · ${dueCount} 项待确认`) : ""}`;
      budgetHeading.textContent = `${tr("Category limits", "分类额度")} · ${month} · ${state.baseCurrency}`;
      const budgets = Core.categoryBudgetProgress(state, month);
      const allocated = budgets.reduce((sum, item) => sum + item.amount, 0);
      allocation.textContent = `${tr("Allocated", "已分配")} ${baseMoney(allocated)} / ${tr("monthly budget", "月预算")} ${baseMoney(state.budget)}${allocated > state.budget ? tr(" · limits exceed your monthly budget", " · 分类额度超过月预算") : ""}`;
      budgetList.replaceChildren();
      if (!budgets.length) budgetList.append(copy("p", "No category limits for this month.", "这个月还没有设置分类额度。", "tally-card-note"));
      budgets.forEach(budget => {
        const row = node("div", "", "tally-plan-row"); row.dataset.categoryBudgetId = budget.id;
        const description = node("div"), title = node("strong", budget.category), value = node("p", `${baseMoney(budget.spent)} / ${baseMoney(budget.amount)} · ${budget.remaining < 0 ? tr("Over", "超出") : tr("Remaining", "剩余")} ${baseMoney(Math.abs(budget.remaining))}`);
        value.classList.toggle("is-over", budget.remaining < 0); description.append(title, value);
        const buttons = node("div", "", "tally-plan-actions");
        buttons.append(action("Edit", "编辑", () => { if (!ready(ownerAtRender)) return; editingBudgetId = budget.id; budgetCategory.value = budget.category; budgetAmount.value = budget.amount; persistDraft(); budgetAmount.focus(); }), action("Remove", "移除", () => { if (commit(current => ({ ...current, categoryBudgets: current.categoryBudgets.filter(item => item.id !== budget.id) }), ownerAtRender)) { if (editingBudgetId === budget.id) { editingBudgetId = null; budgetForm.reset(); persistDraft(); } message("Category limit removed.", "分类额度已移除。"); } }));
        row.append(description, buttons); budgetList.append(row);
      });
      billList.replaceChildren();
      if (!state.recurringBills.length) billList.append(copy("p", "No recurring bills yet.", "还没有周期账单。", "tally-card-note"));
      [...state.recurringBills].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.nextDate.localeCompare(b.nextDate)).forEach(bill => {
        const row = node("div", "", "tally-plan-row"); row.dataset.recurringBillId = bill.id;
        const info = node("div"), heading = node("strong", bill.name);
        const due = bill.enabled && bill.nextDate <= todayIso();
        info.append(heading, node("p", `${Core.formatAmount(state, bill.amount, bill.currency)} · ${bill.nextDate} · ${bill.enabled ? (due ? tr("Pending confirmation", "待确认") : tr("Upcoming", "未到期")) : tr("Paused", "已暂停")}`));
        if (bill.currency !== state.baseCurrency) info.append(node("p", `${tr("Saved rate", "保存汇率")} ${bill.fxRate} · ${baseMoney(bill.amount * bill.fxRate)}`));
        const buttons = node("div", "", "tally-plan-actions");
        const handle = confirm => {
          let result;
          if (commit(current => { result = confirm ? Core.confirmRecurringBill(current, bill.id, bill.nextDate, todayIso()) : Core.skipRecurringBill(current, bill.id, bill.nextDate, todayIso()); return result.state; }, ownerAtRender)) message(result?.record ? "Expense confirmed; the next occurrence is ready." : confirm ? "This occurrence was already handled or changed." : "This occurrence was skipped.", result?.record ? "已确认记账，下次账单已安排。" : confirm ? "本次账单已处理或发生变更。" : "已跳过本次账单。");
        };
        if (due) buttons.append(action("Confirm expense", "确认记账", () => handle(true)), action("Skip once", "跳过本次", () => handle(false)));
        buttons.append(action("Edit", "编辑", () => editBill(bill.id)), action("Delete bill", "删除账单", () => { if (commit(current => ({ ...current, recurringBills: current.recurringBills.filter(item => item.id !== bill.id) }), ownerAtRender)) { if (editingBillId === bill.id) resetBill(); persistDraft(); message("Bill removed. Recorded expenses are kept.", "账单已删除，已确认的消费记录会保留。"); } }));
        row.append(info, buttons); billList.append(row);
      });
    } };
  }

  /**
   * Personal spending insights: the selected month by category, a six-month
   * trend that navigates the ledger, and likely subscriptions that can become
   * recurring bills. Bars are plain HTML; their lengths are clip-paths.
   */
  function mountInsights() {
    const tr = (en, zh) => isZh() ? zh : en;
    const node = (tag, text = "", className = "") => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
    const copy = (tag, en, zh, cls) => { const el = node(tag, tr(en, zh), cls); el.dataset.insightEn = en; el.dataset.insightZh = zh; return el; };
    const section = (id, heading) => { const el = node("section", "", "tally-insight"); heading.id = id; heading.tabIndex = -1; el.setAttribute("aria-labelledby", id); el.append(heading); return el; };
    const root = node("details", "", "tally-planning tally-spending"); root.id = "tally-spending-insights"; root.dataset.i18nIgnore = "";
    const summary = node("summary"), body = node("div", "", "tally-planning-body"), scope = node("p", "", "tally-insight-note");
    const subscriptionList = node("div", "", "tally-subscription-list");
    const subscriptions = section("tally-subscriptions-heading", copy("h2", "Possible subscriptions", "可能的订阅"));
    subscriptions.append(subscriptionList);
    const categoryHeading = node("h2"), categories = section("tally-categories-heading", categoryHeading);
    const totalLine = node("p", "", "tally-insight-total"), totalValue = node("strong"), totalChange = node("span");
    totalLine.append(totalValue, totalChange);
    const categoryList = node("ul", "", "tally-category-bars"), categoryEmpty = node("p", "", "tally-insight-empty");
    categories.append(totalLine, categoryList, categoryEmpty);
    const trendSection = section("tally-trend-heading", copy("h2", "Six-month trend", "近六个月趋势"));
    const trendHint = node("p", "", "tally-insight-note"), trend = node("div", "", "tally-trend"), trendEmpty = node("p", "", "tally-insight-empty");
    trend.setAttribute("role", "group");
    const bars = Array.from({ length: 6 }, () => {
      const button = node("button", "", "tally-trend-bar"); button.type = "button";
      const value = node("span", "", "tally-trend-value"), track = node("span", "", "tally-trend-track"), fill = node("span", "", "tally-trend-fill"), month = node("span", "", "tally-trend-month");
      track.setAttribute("aria-hidden", "true"); track.append(fill); button.append(value, track, month);
      button.addEventListener("click", () => openMonth(button.dataset.month));
      trend.append(button);
      return { button, value, fill, month };
    });
    trendSection.append(trendHint, trend, trendEmpty);
    const status = node("p", "", "tally-planning-status"); status.setAttribute("role", "status");
    body.append(scope, subscriptions, categories, trendSection, status); root.append(summary, body);
    $("tally-quick-options").after(root);
    const more = node("button"); more.type = "button";
    more.addEventListener("click", () => {
      $("tally-tools").open = false; root.open = true; window.DailySpaceView.write("tally", { insightsOpen: true });
      root.scrollIntoView({ block: "start", behavior: "auto" }); summary.focus({ preventScroll: true });
    });
    $("tally-tools").querySelector(".workspace-menu-panel").append(more);
    const wide = window.matchMedia("(min-width: 820px)");
    let ownerAtRender = viewOwner, trendEnd = null, subscriptionSignature = "";
    // Open on desktop and closed on phone until the person chooses; that choice lasts for the session.
    const applyOpenPreference = () => { const saved = window.DailySpaceView.read("tally").insightsOpen; root.open = typeof saved === "boolean" ? saved : wide.matches; };
    applyOpenPreference();
    summary.addEventListener("click", () => window.DailySpaceView.write("tally", { insightsOpen: !root.open }));
    root.addEventListener("toggle", () => { if (root.open) renderInsights(); });

    function ready(expectedOwner = viewOwner) {
      return expectedOwner === window.DailySpaceView.owner() && expectedOwner === viewOwner && document.documentElement.dataset.workspaceReady !== "false" && document.documentElement.dataset.workspaceLocked !== "true" && !localStorage.getItem("daily-space-snapshot-recovery-v1");
    }
    function say(text, error = false) { status.textContent = text; status.classList.toggle("is-error", error); }
    function commit(transform, expectedOwner) {
      if (!ready(expectedOwner)) { say(tr("Your workspace changed. Reopen this page before saving.", "工作台已变更，请重新打开本页后保存。"), true); return false; }
      const previous = Core.readState();
      try { state = transform(previous); saveState(); render(); return true; }
      catch (error) {
        state = previous;
        say(error?.message === "stale" ? tr("This suggestion has changed. Check the list again.", "该建议已变化，请重新查看。")
          : /100 recurring bills/.test(error?.message || "") ? tr("You already have 100 recurring bills. Remove one first.", "周期账单已达 100 项上限，请先删除一项。")
          : tr("Could not save on this device. Check browser storage and try again.", "无法保存到本机，请检查浏览器存储空间后重试。"), true);
        return false;
      }
    }
    function openMonth(key) {
      const [year, month] = String(key || "").split("-").map(Number);
      if (!Number.isInteger(year) || !Number.isInteger(month)) return;
      const offset = year * 12 + month - (viewYear * 12 + viewMonth);
      if (offset) changeMonth(offset);
    }
    trend.addEventListener("keydown", event => {
      const index = bars.findIndex(bar => bar.button === event.target);
      if (index < 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: bars.length - 1 }[event.key];
      if (next === undefined || next < 0 || next >= bars.length) return;
      event.preventDefault();
      openMonth(bars[next].button.dataset.month);
      bars[next].button.focus();
    });
    function focusAfterChange() {
      (subscriptions.hidden ? categoryHeading : subscriptionList.querySelector("button") || categoryHeading).focus({ preventScroll: true });
    }
    function addBill(key, owner) {
      let added = null;
      if (!commit(current => {
        added = Core.detectSubscriptions(current, todayIso()).find(item => item.key === key);
        if (!added) throw new Error("stale");
        return Core.saveRecurringBill(current, Core.subscriptionBill(added));
      }, owner)) return;
      say(tr(`${added.name} is now a recurring bill, next due ${added.nextDate}. Like other bills, it is recorded only after you confirm it in Budgets & bills.`,
        `已将 ${added.name} 添加为周期账单，下次到期 ${added.nextDate}。和其他账单一样，需在“分类预算与周期账单”中确认后才会记账。`));
      focusAfterChange();
    }
    function dismiss(key, name, owner) {
      if (!commit(current => Core.dismissSubscription(current, key), owner)) return;
      say(tr(`${name} will not be suggested as a subscription again.`, `不会再把 ${name} 提示为订阅。`));
      window.DailySpaceUndo?.offer(tr("Subscription suggestion hidden", "已隐藏订阅提示"), () => {
        if (commit(current => Core.restoreSubscription(current, key), owner)) say(tr(`${name} can be suggested again.`, `已恢复 ${name} 的订阅提示。`));
      });
      focusAfterChange();
    }
    const monthLabel = (year, month, options = { year: "numeric", month: "long" }) => new Date(year, month - 1, 1).toLocaleDateString(uiLocale(), options);
    const percent = share => share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`;
    const categoryName = item => !item.other ? item.category : item.categories > 1 ? tr(`Other · ${item.categories} categories`, `其他 · ${item.categories} 类`) : tr("Other", "其他");

    function renderSubscriptions(list) {
      subscriptions.hidden = !list.length;
      const signature = JSON.stringify([list, uiLocale(), state.baseCurrency, ownerAtRender]);
      if (signature === subscriptionSignature) return;
      subscriptionSignature = signature;
      const owner = ownerAtRender;
      subscriptionList.replaceChildren(...list.map((item, index) => {
        const card = node("article", "", "tally-subscription"); card.dataset.subscriptionKey = item.key;
        const info = node("div"), title = node("strong", `${item.name} · ${Core.formatAmount(state, item.amount, item.currency)} / ${item.interval === "yearly" ? tr("year", "年") : tr("month", "月")}`);
        title.id = `tally-subscription-${index}`;
        // Each fact stays on one line; the line breaks only between them.
        const detail = node("p", "", "tally-subscription-detail");
        [tr(`${item.count} charges`, `已扣费 ${item.count} 次`), tr(`last on ${item.lastDate}`, `最近一次 ${item.lastDate}`), tr(`next ${item.nextDate}`, `下次 ${item.nextDate}`),
          item.currency !== state.baseCurrency ? `≈ ${baseMoney(item.amount * item.fxRate)}` : ""].filter(Boolean)
          .forEach((text, index) => { if (index) detail.append(" · "); detail.append(node("span", text)); });
        info.append(node("p", tr("Looks like a subscription", "看起来像订阅"), "tally-subscription-kicker"), title, detail);
        const actions = node("div", "", "tally-plan-actions");
        const add = node("button", tr("Add as bill", "添加为账单"), "is-primary"), no = node("button", tr("Not a subscription", "不是订阅"));
        for (const button of [add, no]) { button.type = "button"; button.setAttribute("aria-describedby", title.id); }
        add.addEventListener("click", () => addBill(item.key, owner));
        no.addEventListener("click", () => dismiss(item.key, item.name, owner));
        actions.append(add, no); card.append(info, actions);
        return card;
      }));
    }

    function renderCategories() {
      const breakdown = Core.categoryBreakdown(state, viewYear, viewMonth);
      const now = new Date(), isCurrent = viewYear === now.getFullYear() && viewMonth === now.getMonth() + 1;
      const label = monthLabel(viewYear, viewMonth), previous = new Date(viewYear, viewMonth - 2, 1);
      const previousTotal = Core.monthlyTotals(state, previous.getFullYear(), previous.getMonth() + 1, 1)[0]?.total || 0;
      const previousName = previous.toLocaleDateString(uiLocale(), { month: isZh() ? "short" : "long" });
      categoryHeading.textContent = isCurrent ? tr("This month by category", "本月支出分类") : tr(`${label} by category`, `${label}支出分类`);
      totalLine.hidden = !(breakdown.total > 0);
      totalValue.textContent = baseMoney(breakdown.total);
      const change = previousTotal > 0 ? (breakdown.total - previousTotal) / previousTotal * 100 : null, rounded = Math.round(Math.abs(change || 0));
      totalChange.textContent = change === null ? tr(`Nothing recorded in ${previousName}`, `${previousName}没有记录`)
        : rounded === 0 ? tr(`About the same as ${previousName} (${baseMoney(previousTotal)})`, `与${previousName}基本持平（${baseMoney(previousTotal)}）`)
        : change > 0 ? tr(`↑ ${rounded}% vs ${previousName} (${baseMoney(previousTotal)})`, `较${previousName} ↑ ${rounded}%（${baseMoney(previousTotal)}）`)
        : tr(`↓ ${rounded}% vs ${previousName} (${baseMoney(previousTotal)})`, `较${previousName} ↓ ${rounded}%（${baseMoney(previousTotal)}）`);
      categoryList.hidden = !breakdown.items.length; categoryEmpty.hidden = breakdown.items.length > 0;
      categoryEmpty.textContent = isCurrent ? tr("No personal expenses this month yet.", "本月还没有个人支出。") : tr(`No personal expenses in ${label}.`, `${label}没有个人支出。`);
      categoryList.setAttribute("aria-label", `${tr(`Spending by category, ${label}`, `${label}按分类支出`)}${breakdown.items.length ? tr(": ", "：") : ""}${breakdown.items.map(item => `${categoryName(item)} ${percent(item.share)}`).join(tr(", ", "，"))}`);
      const max = Math.max(0, ...breakdown.items.map(item => item.amount));
      // Rows are reused so a month change moves each bar instead of rebuilding the list.
      categoryList.replaceChildren(...breakdown.items.map((item, index) => {
        let row = categoryList.children[index];
        if (!row) {
          row = node("li", "", "tally-category-row");
          const track = node("span", "", "tally-category-track"); track.setAttribute("aria-hidden", "true"); track.append(node("span", "", "tally-category-fill"));
          row.append(node("span", "", "tally-category-name"), node("span", "", "tally-category-value"), track);
        }
        row.classList.toggle("is-other", Boolean(item.other));
        row.children[0].textContent = categoryName(item);
        row.children[1].textContent = `${baseMoney(item.amount)} · ${percent(item.share)}`;
        row.querySelector(".tally-category-fill").style.setProperty("--bar", `${max > 0 ? item.amount / max * 100 : 0}%`);
        return row;
      }));
    }

    function renderTrend() {
      const now = new Date(), current = now.getFullYear() * 12 + now.getMonth(), selected = viewYear * 12 + viewMonth - 1;
      // The window stays put while the selected month is inside it, so choosing a bar never shifts the chart.
      const covers = end => end !== null && selected <= end && selected > end - bars.length;
      if (!covers(trendEnd)) trendEnd = covers(current) ? current : selected;
      const months = Core.monthlyTotals(state, Math.floor(trendEnd / 12), trendEnd % 12 + 1, bars.length);
      if (months.length !== bars.length) { trend.hidden = true; trendHint.hidden = true; trendEmpty.hidden = true; return; }
      const max = Math.max(0, ...months.map(item => item.total)), first = months[0], last = months[months.length - 1];
      const start = new Date(first.year, first.month - 1, 1), end = new Date(last.year, last.month - 1, 1);
      const rangeFormat = new Intl.DateTimeFormat(uiLocale(), { year: "numeric", month: "long" });
      const range = typeof rangeFormat.formatRange === "function" ? rangeFormat.formatRange(start, end) : `${rangeFormat.format(start)} – ${rangeFormat.format(end)}`;
      trend.hidden = !(max > 0); trendHint.hidden = !(max > 0); trendEmpty.hidden = max > 0;
      trendHint.textContent = tr(`${range} · Select a month to show it in Transactions.`, `${range} · 选择月份可在账单中查看。`);
      trendEmpty.textContent = tr(`No personal expenses in ${range}.`, `${range}没有个人支出。`);
      const peak = months.reduce((best, item) => item.total > best.total ? item : best, first);
      trend.setAttribute("aria-label", tr(`Monthly personal spending, ${range}. Highest: ${monthLabel(peak.year, peak.month)}, ${baseMoney(peak.total)}.`,
        `每月个人支出，${range}。最高：${monthLabel(peak.year, peak.month)}，${baseMoney(peak.total)}。`));
      const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
      months.forEach((item, index) => {
        const bar = bars[index], pressed = item.year === viewYear && item.month === viewMonth;
        const label = `${monthLabel(item.year, item.month)}${item.year * 12 + item.month - 1 === current ? tr(" so far", "（截至今天）") : ""} · ${baseMoney(item.total)} · ${isZh() ? `${item.count} 笔支出` : `${item.count} expense${item.count === 1 ? "" : "s"}`}`;
        bar.button.dataset.month = item.key;
        bar.button.setAttribute("aria-pressed", String(pressed));
        bar.button.tabIndex = pressed ? 0 : -1;
        bar.button.setAttribute("aria-label", label); bar.button.title = label;
        bar.button.classList.toggle("is-empty", !(item.total > 0));
        bar.value.textContent = !(item.total > 0) ? "–" : item.total >= 1000 ? compact.format(item.total).toLowerCase()
          : new Intl.NumberFormat(uiLocale(), { maximumFractionDigits: item.total < 10 ? 2 : 0 }).format(item.total);
        bar.month.textContent = monthLabel(item.year, item.month, { month: "short" });
        bar.fill.style.setProperty("--bar", `${max > 0 ? item.total / max * 100 : 0}%`);
      });
    }

    function renderInsights() {
      const owner = window.DailySpaceView.owner();
      if (ownerAtRender !== owner) { ownerAtRender = owner; trendEnd = null; subscriptionSignature = ""; say(""); applyOpenPreference(); }
      root.querySelectorAll("[data-insight-en]").forEach(el => { el.textContent = isZh() ? el.dataset.insightZh : el.dataset.insightEn; });
      more.textContent = tr("Spending insights", "支出分析");
      const ok = ready(owner);
      body.hidden = !ok;
      const suggestions = ok ? Core.detectSubscriptions(state, todayIso()) : [];
      summary.textContent = `${tr("Spending insights", "支出分析")}${suggestions.length ? tr(` · ${suggestions.length} possible subscription${suggestions.length === 1 ? "" : "s"}`, ` · ${suggestions.length} 个可能的订阅`) : ""}`;
      if (!ok || !root.open) return;
      scope.textContent = tr(`Personal expenses in ${state.baseCurrency}, at each expense's saved exchange rate.`, `个人支出，按每笔保存的汇率折算为 ${state.baseCurrency}。`);
      renderSubscriptions(suggestions);
      renderCategories();
      renderTrend();
    }
    return { render: renderInsights };
  }

  /**
   * Receipt photos for a new expense: shown only to signed-in people when the
   * server can read receipts. Fills the open form and never saves on its own.
   */
  function mountReceiptScan() {
    const tr = (en, zh) => isZh() ? zh : en;
    const wrap = document.createElement("div"); wrap.className = "tally-receipt"; wrap.dataset.i18nIgnore = ""; wrap.hidden = true;
    const file = document.createElement("input"); file.type = "file"; file.accept = "image/*"; file.setAttribute("capture", "environment"); file.hidden = true; file.tabIndex = -1; file.id = "tally-receipt-file";
    const button = document.createElement("button"); button.type = "button"; button.id = "tally-receipt-scan"; button.className = "tally-receipt-button";
    button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3 8h4l2-3h6l2 3h4v12H3Z"/><circle cx="12" cy="13.5" r="3.5"/></svg>';
    const label = document.createElement("span"); button.append(label);
    const note = document.createElement("p"); note.id = "tally-receipt-status"; note.className = "tally-receipt-status"; note.setAttribute("role", "status");
    wrap.append(file, button, note);
    form.prepend(wrap);
    let available = false, checkedOwner = null, serial = 0, controller = null, busy = false;

    function say(text, error = false) { note.textContent = text; note.classList.toggle("is-error", error); }
    function setBusy(next) {
      // aria-disabled keeps focus on the button while the photo is read.
      busy = next; button.setAttribute("aria-disabled", String(next)); wrap.setAttribute("aria-busy", String(next));
      label.textContent = tr("Scan receipt", "扫描小票");
    }
    /** Visibility changes only when the sheet opens, so the amount field never jumps under a finger. */
    function sync() {
      const owner = window.DailySpaceView.owner();
      wrap.hidden = !(available && checkedOwner === owner && owner !== "guest" && !editingId);
      label.textContent = tr("Scan receipt", "扫描小票");
    }
    async function refresh() {
      const owner = window.DailySpaceView.owner();
      // A repeat confirmation of the same account keeps the answer while it is re-checked.
      if (checkedOwner !== owner) available = false;
      checkedOwner = owner;
      if (owner === "guest") { available = false; return; }
      try {
        const response = await fetch("/api/agent/status", { credentials: "same-origin" });
        const data = await response.json().catch(() => ({}));
        if (checkedOwner === owner && owner === window.DailySpaceView.owner()) available = response.ok && data?.receiptScan === true;
      } catch (_) { /* Scanning stays hidden; manual entry is unaffected. */ }
    }
    function cancel() { serial += 1; controller?.abort(); controller = null; setBusy(false); }
    function reset() { cancel(); say(""); sync(); }

    function loadImage(source) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(source), image = new Image();
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(Object.assign(new Error("decode"), { code: "IMAGE_DECODE" })); };
        image.src = url;
      });
    }
    // At most 1600 px on the long side as JPEG, comfortably under the server's 4 MB limit.
    async function downscale(source) {
      if (source.type && !source.type.startsWith("image/")) throw Object.assign(new Error("type"), { code: "IMAGE_DECODE" });
      let image;
      try { image = await createImageBitmap(source, { imageOrientation: "from-image" }); }
      catch (_) { image = await loadImage(source); }
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
      if (!(width > 0 && height > 0)) throw Object.assign(new Error("empty"), { code: "IMAGE_DECODE" });
      const scale = Math.min(1, 1600 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); // transparent PNGs become paper, not black
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close?.();
      for (const quality of [0.8, 0.65, 0.5]) {
        const url = canvas.toDataURL("image/jpeg", quality);
        if (url.length <= 3_900_000) return url;
      }
      throw Object.assign(new Error("size"), { code: "IMAGE_TOO_LARGE" });
    }

    function filledMessage(filled) {
      if (!filled.length) return tr("Nothing could be read from this photo. Enter the expense yourself.", "未能从照片中读出内容，请手动填写。");
      const names = { amount: ["amount", "金额"], currency: ["currency", "币种"], date: ["date", "日期"], category: ["category", "分类"], note: ["note", "备注"] };
      const keys = Object.keys(names).filter(key => filled.includes(key)), en = keys.map(key => names[key][0]);
      const list = en.length > 1 ? `${en.slice(0, -1).join(", ")} and ${en[en.length - 1]}` : en[0], missing = !filled.includes("amount");
      return tr(`Filled ${list} from the receipt. Check them before saving.${missing ? " No total was found, so enter the amount." : ""}`,
        `已从小票填入${keys.map(key => names[key][1]).join("、")}，请核对后保存。${missing ? "未识别到总金额，请手动填写。" : ""}`);
    }
    function apply(receipt) {
      const filled = [], date = Core.validDate(receipt.date);
      if (date) { dateInput.value = date; filled.push("date"); }
      if (Number(receipt.amount) > 0) { amountInput.value = String(Number(receipt.amount)); filled.push("amount"); }
      if (typeof receipt.currency === "string" && /^[A-Z]{3}$/.test(receipt.currency)) { selectRecordCurrency(receipt.currency); filled.push("currency"); }
      if (typeof receipt.category === "string" && receipt.category.trim()) { categoryInput.value = receipt.category.trim().slice(0, 40); syncCategorySuggestions(categoryInput.value); filled.push("category"); }
      // "Merchant · details" keeps the merchant first, which is how subscriptions are grouped.
      const text = [receipt.merchant, receipt.note].filter(value => typeof value === "string" && value.trim()).map(value => value.trim()).join(" · ").slice(0, 120);
      if (text) { noteInput.value = text; filled.push("note"); }
      if (text || recordCurrencyInput.value !== state.baseCurrency) extraOptions.open = true;
      clearFormError();
      if (filled.includes("currency") || (date && recordCurrencyInput.value !== state.baseCurrency)) refreshFxRate();
      else { syncSharedFields(); saveDraft(); }
      return filledMessage(filled);
    }
    function failure(error) {
      const status = error?.status, code = error?.code;
      if (code === "IMAGE_DECODE") return tr("This photo could not be opened. Try a JPEG or PNG photo, or enter the expense yourself.", "无法打开这张照片，请换一张 JPEG 或 PNG 照片，或手动填写。");
      if (code === "IMAGE_TOO_LARGE" || status === 413) return tr("This photo is too large to send. Try a closer photo of the receipt.", "照片太大，无法发送，请靠近小票重新拍摄。");
      if (status === 401) return tr("Sign in again to scan receipts. You can still enter this expense yourself.", "请重新登录后再扫描小票；也可以直接手动填写。");
      if (status === 429) return tr("Too many scans in a short time. Wait a minute, or enter the expense yourself.", "扫描太频繁，请稍等一分钟，或手动填写。");
      if (status === 422) return tr("No receipt details were found in this photo. Enter the expense yourself.", "照片中没有找到小票信息，请手动填写。");
      if (status === 503) { available = false; return tr("Receipt scanning is not available right now. Enter the expense yourself.", "小票扫描暂不可用，请手动填写。"); }
      if (error?.name === "AbortError") return tr("Reading the receipt took too long. Try again, or enter the expense yourself.", "读取小票超时，请重试或手动填写。");
      return tr("Could not read the receipt. Check your connection, or enter the expense yourself.", "读取小票失败，请检查网络或手动填写。");
    }

    button.addEventListener("click", () => { if (!busy && !wrap.hidden) file.click(); });
    file.addEventListener("change", async () => {
      const chosen = file.files?.[0]; file.value = "";
      if (!chosen || addSheet.hidden || sheetMotion.closing || editingId) return;
      cancel();
      const ticket = serial, owner = window.DailySpaceView.owner(), request = new AbortController();
      const current = () => ticket === serial && owner === window.DailySpaceView.owner() && !addSheet.hidden && !sheetMotion.closing && !editingId;
      const timeout = setTimeout(() => request.abort(), 45000);
      controller = request; setBusy(true); say(tr("Reading the receipt… You can keep typing.", "正在读取小票…可以继续填写。"));
      try {
        const image = await downscale(chosen);
        if (!current()) return;
        const response = await fetch("/api/tally/receipt", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image, lang: isZh() ? "zh" : "en", today: todayIso() }), signal: request.signal });
        const data = await response.json().catch(() => ({}));
        if (!current()) return;
        if (!response.ok) throw Object.assign(new Error("scan failed"), { status: response.status, code: data?.code });
        say(apply(data?.receipt && typeof data.receipt === "object" ? data.receipt : {}));
      } catch (error) {
        if (current()) say(failure(error), true);
      } finally {
        clearTimeout(timeout);
        if (ticket === serial) { controller = null; setBusy(false); }
      }
    });
    setBusy(false);
    refresh();
    return { cancel, reset, refresh };
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
    const suggestions = categories.filter((category) => category.toLowerCase() !== active).slice(0, 3);
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
    fxRateInput.disabled = !foreignCurrency;
    fxRateInput.required = foreignCurrency;
    fxHelp.textContent = foreignCurrency
      ? fxPending ? "Fetching rate…" : `1 ${recordCurrencyInput.value} = ${fxRateInput.value || "?"} ${state.baseCurrency}`
      : "";
  }

  function setCurrency(select, value) {
    const code = Core.currencyCode(value, state.baseCurrency);
    for (const currency of new Set([state.baseCurrency, code])) {
      if (![...select.options].some(option => option.value === currency)) select.add(new Option(currency, currency));
    }
    select.value = code;
  }

  function selectRecordCurrency(value) { setCurrency(recordCurrencyInput, value); }

  function currencyPreferenceKey() {
    return "dayfly-entry-currency:" + window.DailySpaceView.owner();
  }

  function lastCurrency() {
    try { return Core.currencyCode(localStorage.getItem(currencyPreferenceKey()), state.baseCurrency); }
    catch (_) { return state.baseCurrency; }
  }

  function rememberCurrency(code) {
    try { localStorage.setItem(currencyPreferenceKey(), code); } catch (_) { /* Entry was saved. */ }
    setCurrency(quickCurrency, code);
  }

  async function lookupRate(from, to, date, signal) {
    const params = new URLSearchParams({ from, to, date });
    const response = await fetch(`/api/fx/rate?${params}`, { signal });
    if (!response.ok) throw new Error("rate unavailable");
    const rate = Number((await response.json()).rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("invalid rate");
    return rate;
  }

  function syncQuickCurrency() {
    const owner = window.DailySpaceView.owner();
    if (owner !== quickOwner || quickBase !== state.baseCurrency) {
      if (quickOwner !== undefined && owner !== quickOwner) {
        quickAmount.value = ""; quickCategory.value = ""; quickError.hidden = true;
      }
      quickOwner = owner;
      quickBase = state.baseCurrency;
      setCurrency(quickCurrency, lastCurrency());
    }
    const from = quickCurrency.value, to = state.baseCurrency, date = captureDate();
    const expanded = $("tally-quick-options").open;
    const context = JSON.stringify([owner, from, to, date, expanded]);
    if (context === quickRateContext) return;
    quickRateContext = context;
    quickRateRequest?.abort();
    quickFx.hidden = from === to;
    quickRate.disabled = from === to;
    quickRate.required = from !== to;
    quickRate.value = from === to ? "1" : "";
    quickFx.firstElementChild.textContent = `1 ${from} → ${to}`;
    if (from === to || !expanded) return;
    const controller = new AbortController();
    quickRateRequest = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    lookupRate(from, to, date, controller.signal).then(rate => {
      if (!controller.signal.aborted && quickRateContext === context) quickRate.value = String(rate);
    }).catch(() => { /* The labelled exchange rate remains editable offline. */ })
      .finally(() => clearTimeout(timeout));
  }

  function clearFormError() {
    formErrorEl.hidden = true;
    formErrorEl.textContent = "";
    entryStatusEl.hidden = true;
    entryStatusEl.textContent = "";
    form.querySelectorAll('[aria-invalid="true"]').forEach(input => { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-errormessage'); });
  }

  function showFormError(message, input) {
    if (extraOptions.contains(input)) extraOptions.open = true;
    formErrorEl.textContent = message;
    formErrorEl.hidden = false;
    input?.setAttribute('aria-invalid', 'true');
    input?.setAttribute('aria-errormessage', formErrorEl.id);
    input?.focus({ preventScroll: true });
    (input?.closest('label') || input)?.scrollIntoView({ block: 'nearest' });
  }

  function cancelFxRequest() {
    fxSerial++;
    fxController?.abort();
    fxController = null;
    fxPending = false;
    submitBtn.disabled = false;
    saveAnotherBtn.disabled = false;
    syncSheetMode();
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
    saveAnotherBtn.disabled = true;
    submitBtn.textContent = "Fetching rate…";
    fxField.setAttribute("aria-busy", "true");
    fxHelp.textContent = "Fetching rate…";
    saveDraft();
    try {
      const rate = await lookupRate(from, state.baseCurrency, dateInput.value || todayIso(), controller.signal);
      if (!current()) return;
      fxRateInput.value = String(rate);
      fxHelp.textContent = `1 ${from} = ${rate.toFixed(6)} ${state.baseCurrency}`;
      saveDraft();
    } catch (_) {
      if (current()) fxHelp.textContent = "Rate unavailable — enter it manually.";
    } finally {
      clearTimeout(timeout);
      if (ticket === fxSerial) {
        fxController = null;
        fxPending = false;
        submitBtn.disabled = false;
        saveAnotherBtn.disabled = false;
        syncSheetMode();
        fxField.setAttribute("aria-busy", "false");
      }
    }
  }

  function syncSheetMode() {
    const editing = Boolean(editingId);
    sheetTitleEl.textContent = editing ? "Edit expense" : "Add expense";
    submitBtn.textContent = "Save";
    saveAnotherBtn.hidden = editing;
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
      continuing: continuingEntry,
      paidById: paidByInput.value, splitAmongIds: Array.from(splitPeopleEl.querySelectorAll("input:checked")).map(input => input.value) } });
  }
  function setSheetOpen(open, record, fromHistory = false, preserve = true, immediate = false) {
    if (!open) {
      if (addSheet.hidden || (sheetMotion.closing && !immediate)) return;
      if (preserve) saveDraft();
      cancelFxRequest();
      receiptUI?.cancel();
      editingId = null;
      continuingEntry = false;
      composing = false;
      sheetMotion.close(() => document.body.classList.remove("tally-sheet-open"), immediate);
      if (!fromHistory) sheetHistory.back();
      return;
    }
    if (!fromHistory && !sheetHistory.push({ id: record?.id || null })) return;
    cancelFxRequest();
    editingId = record?.id || null;
    composing = false;
    const draft = window.DailySpaceView.read("tally").draft;
    const customSplit = draft?.scope === "shared" && (draft.paidById !== state.selfPersonId ||
      draft.splitAmongIds?.length !== state.people.length || state.people.some(person => !draft.splitAmongIds?.includes(person.id)));
    // A blank date-only form follows the next selected day. Currency, scope and
    // participant choices are meaningful even before an amount has been typed.
    const hasDraftContent = draft && (editingId || draft.amount || draft.category?.trim() || draft.note?.trim() || draft.tripId ||
      draft.currency !== state.baseCurrency || draft.scope !== viewMode || customSplit || draft.continuing);
    const value = draft && draft.id === editingId && hasDraftContent ? draft : record;
    continuingEntry = !editingId && Boolean(value?.continuing);
    dateInput.value = value?.date || captureDate();
    amountInput.value = value?.amount || "";
    categoryInput.value = value?.category || "";
    noteInput.value = value?.note || "";
    const tripLink = value ? { tripId: value.tripId || null, tripName: value.tripName || "" } : filteredTripLink();
    window.DailySpaceTripExpenses.populate(tripInput, tripLink.tripId || "", tripLink.tripName);
    scopeInput.value = value?.scope || (viewMode === "shared" ? "shared" : "personal");
    selectRecordCurrency(value?.currency || lastCurrency());
    fxRateInput.value = String(value?.fxRate ?? (recordCurrencyInput.value === state.baseCurrency ? 1 : ""));
    clearFormError();
    syncSheetMode();
    receiptUI?.reset();
    renderPeople(true);
    paidByInput.value = value?.paidById || state.selfPersonId;
    syncSharedFields();
    if (value?.splitAmongIds) splitPeopleEl.querySelectorAll("input").forEach(input => { input.checked = value.splitAmongIds.includes(input.value); });
    syncCategorySuggestions(categoryInput.value);
    extraOptions.open = Boolean(value?.note || tripInput.value || scopeInput.value === "shared");
    form.scrollTop = 0;
    sheetMotion.open();
    document.body.classList.add("tally-sheet-open");
    fitSheet();
    amountInput.focus({ preventScroll: true });
    if (recordCurrencyInput.value !== state.baseCurrency && !fxRateInput.value) refreshFxRate();
  }
  form.addEventListener("input", saveDraft);
  form.addEventListener("change", saveDraft);
  form.addEventListener("input", clearFormError);
  form.addEventListener("change", clearFormError);
  form.addEventListener("invalid", event => { if (extraOptions.contains(event.target)) extraOptions.open = true; }, true);
  form.addEventListener("compositionstart", () => { composing = true; });
  form.addEventListener("compositionend", () => { composing = false; });
  form.addEventListener("keydown", event => {
    if (event.key === "Enter" && (composing || event.isComposing || event.keyCode === 229)) event.preventDefault();
  });
  window.addEventListener("pagehide", () => { saveDraft(); cancelFxRequest(); });
  window.addEventListener("daily-space-auth-updated", () => {
    setSheetOpen(false, null, false, false, true);
    form.reset();
    state = Core.readState();
    if (viewOwner !== window.DailySpaceView.owner()) {
      viewOwner = window.DailySpaceView.owner();
      restoreView();
    }
    receiptUI?.refresh();
    render();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (sheetMotion.closing || fxPending || composing || savingExpense) return;
    clearFormError();
    if (!form.checkValidity()) {
      const invalid = form.querySelector(':invalid');
      const message = invalid === amountInput ? (isZh() ? '请输入有效金额，最小为 0.01。' : 'Enter a valid amount of at least 0.01.')
        : invalid === fxRateInput ? (isZh() ? '请填写有效汇率后再保存。' : 'Enter a valid exchange rate before saving.')
        : invalid === dateInput ? (isZh() ? '请选择有效日期。' : 'Choose a valid date.')
        : (isZh() ? '请检查标出的字段。' : 'Check the highlighted field.');
      showFormError(message, invalid);
      return;
    }
    const amount = Number(amountInput.value);
    const category = categoryInput.value.trim() || (isZh() ? "其他" : "Other");
    const shared = scopeInput.value === "shared";
    const splitAmongIds = Array.from(splitPeopleEl.querySelectorAll("input:checked")).map(
      (input) => input.value
    );
    if (!(amount > 0) || !category) return;
    if (shared && !splitAmongIds.length) {
      showFormError(isZh() ? '请选择至少一位分摊人。' : 'Choose at least one person to split with.', splitPeopleEl.querySelector('input'));
      return;
    }
    const foreignCurrency = recordCurrencyInput.value !== state.baseCurrency;
    const fxRate = foreignCurrency ? Number(fxRateInput.value) : 1;
    if (!Number.isFinite(fxRate) || !(fxRate > 0)) return;
    const nextRecord = Core.normalizeRecord(
      {
        ...state.records.find(record => record.id === editingId),
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
    const continueAdding = !editingId && event.submitter === saveAnotherBtn;
    const previousState = state;
    state = { ...state, records: editingId
      ? state.records.map(record => record.id === editingId ? nextRecord : record)
      : [nextRecord, ...state.records] };
    savingExpense = true;
    try { saveState(); }
    catch (_) {
      state = previousState;
      showFormError(isZh() ? "无法保存到本机，请保留当前内容并检查浏览器存储空间。" : "Could not save on this device. Keep this form and check browser storage.", amountInput);
      return;
    } finally { savingExpense = false; }
    if (!editingId) rememberCurrency(nextRecord.currency);
    const recordDate = parseIso(nextRecord.date);
    viewYear = recordDate.getFullYear();
    viewMonth = recordDate.getMonth() + 1;
    selectedDay = nextRecord.date;
    viewMode = nextRecord.scope === "shared" ? "shared" : "personal";
    window.DailySpaceView.write("tally", { draft: null });
    if (continueAdding) {
      continuingEntry = true;
      amountInput.value = "";
      noteInput.value = "";
      clearFormError();
      receiptUI?.reset();
      saveDraft();
      entryStatusEl.textContent = isZh() ? "已保存，可以继续记下一笔。" : "Saved. Ready for another expense.";
      entryStatusEl.hidden = false;
      form.scrollTop = 0;
      fitSheet();
      amountInput.focus({ preventScroll: true });
    } else setSheetOpen(false, null, false, false);
    render();
  });

  document.querySelectorAll("[data-tally-view]").forEach((button) => {
    button.addEventListener("click", () => {
      viewMode = button.dataset.tallyView === "shared" ? "shared" : "personal";
      render();
    });
  });
  document.querySelectorAll("[data-tally-layout]").forEach(button => {
    button.addEventListener("click", () => { ledgerLayout = button.dataset.tallyLayout; render(); });
  });
  $("tally-prev").addEventListener("click", () => changeMonth(-1));
  $("tally-next").addEventListener("click", () => changeMonth(1));
  $("tally-today").addEventListener("click", () => {
    viewYear = new Date().getFullYear();
    viewMonth = new Date().getMonth() + 1;
    selectedDay = todayIso();
    render();
  });
  budgetInput.addEventListener("change", () => {
    state.budget = Number(budgetInput.value) > 0 ? Number(budgetInput.value) : 1000;
    saveState();
    render();
  });
  currencyInput.addEventListener("change", () => {
    const result = Core.changeBaseCurrency(state, currencyInput.value);
    if (result.changed) { state = result.state; saveState(); }
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
      ["id", "date", "amount", "currency", "fxRate", "category", "note", "scope", "paidById", "splitAmongIds", "tripId", "tripName", "recurringBillId", "recurringDate", "_format"],
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
        record.recurringBillId || "",
        record.recurringDate || "",
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
  $("tally-day-add").addEventListener("click", () => setSheetOpen(true));
  monthGridEl.addEventListener("keydown", event => {
    const button = event.target.closest("[data-tally-day]");
    if (!button || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const date = parseIso(button.dataset.tallyDay);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (step !== undefined) {
      const next = addDays(date, step);
      if (next.getFullYear() < 1900 || next.getFullYear() > 9999) return;
      event.preventDefault();
      selectedDay = dateToIso(next); viewYear = next.getFullYear(); viewMonth = next.getMonth() + 1;
      render();
      const nextButton = monthGridEl.querySelector(`[data-tally-day="${selectedDay}"]`);
      nextButton?.focus({ preventScroll: true });
      nextButton?.scrollIntoView({ block: "nearest" });
    }
  });

  const quickForm = $("tally-quick-form");
  const quickAmount = $("tally-quick-amount");
  const quickCategory = $("tally-quick-category");
  const quickError = $("tally-quick-error");
  $("tally-quick-options").addEventListener("toggle", syncQuickCurrency);
  quickCurrency.addEventListener("change", syncQuickCurrency);
  quickRate.addEventListener("input", () => quickRateRequest?.abort());
  if (quickForm && quickAmount && quickCategory) {
    quickForm.addEventListener("input", () => { quickError.hidden = true; quickError.textContent = ""; });
    quickForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const amount = Number(quickAmount.value);
      const category = quickCategory.value.trim() || (isZh() ? "其他" : "Other");
      if (!(amount > 0) || !category) return;
      syncQuickCurrency();
      if (!quickForm.reportValidity()) return;
      const nextRecord = Core.normalizeRecord(
        {
          id: Core.uid("expense"),
          date: captureDate(),
          amount,
          currency: quickCurrency.value,
          fxRate: Number(quickRate.value),
          category,
          note: "",
          ...filteredTripLink(),
          scope: viewMode,
          paidById: state.selfPersonId,
          splitAmongIds: viewMode === "shared" ? state.people.map(person => person.id) : [],
        },
        state
      );
      if (!nextRecord) return;
      const previousState = state;
      state = { ...state, records: [nextRecord, ...state.records] };
      try { saveState(); }
      catch (_) {
        state = previousState;
        quickError.textContent = isZh() ? "无法保存到本机，请保留当前内容并检查浏览器存储空间。" : "Could not save on this device. Keep this form and check browser storage.";
        quickError.hidden = false;
        quickAmount.focus();
        return;
      }
      quickError.hidden = true; quickError.textContent = "";
      rememberCurrency(nextRecord.currency);
      const date = parseIso(nextRecord.date);
      viewYear = date.getFullYear(); viewMonth = date.getMonth() + 1; selectedDay = nextRecord.date;
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
  window.addEventListener("daily-space-user-sync-updated", event => {
    // Cloud data can arrive before its ready flag; refresh guarded planning only
    // after the account snapshot is usable, including the first signed-in load.
    if (event.detail?.workspaceReady === true && viewOwner === window.DailySpaceView.owner()) {
      state = Core.readState(); render();
    } else { insightsUI?.render(); planningUI?.render(); }
    quickAddUI?.render();
  });
  window.addEventListener("storage", event => {
    if (event.key === Core.STORAGE_KEY && viewOwner === window.DailySpaceView.owner()) { state = Core.readState(); render(); }
  });

  restoreView();
  insightsUI = mountInsights();
  planningUI = mountPlanning();
  quickAddUI = mountQuickAdd();
  receiptUI = mountReceiptScan();
  setupRecordSwipe();

  /**
   * Phone: swipe a record left to reveal Delete instead of showing a bin on
   * every row. Keyboard focus also reveals it, and one row is open at a time.
   */
  function setupRecordSwipe() {
    const REVEAL = 88, OPEN_AT = 44;
    const phone = matchMedia("(max-width: 819px)");
    let gesture = null, openRow = null, swallowClick = false;
    const setOffset = (row, x) => { row.style.setProperty("--swipe-x", `${x}px`); row.style.setProperty("--swipe-reveal", `${Math.max(0, -x)}px`); };
    // Rows are rebuilt on render; a removed row can no longer be "open".
    const live = () => { if (openRow && !openRow.isConnected) openRow = null; return openRow; };
    function close(row = openRow) {
      if (!row) return;
      row.classList.remove("is-swiping", "is-swipe-open"); setOffset(row, 0);
      if (row === openRow) openRow = null;
    }
    recordListEl.addEventListener("touchstart", (event) => {
      if (!phone.matches || event.touches.length !== 1) return;
      const row = event.target.closest(".tally-record");
      if (live() && openRow !== row) { close(); swallowClick = true; }
      if (!row || event.target.closest(".tally-record-delete")) { gesture = null; return; }
      const touch = event.touches[0];
      gesture = { row, x: touch.clientX, y: touch.clientY, dx: 0, locked: false, base: row === openRow ? -REVEAL : 0 };
    }, { passive: true });
    recordListEl.addEventListener("touchmove", (event) => {
      const touch = event.touches[0];
      if (!gesture || !touch) return;
      const dx = touch.clientX - gesture.x, dy = touch.clientY - gesture.y;
      if (!gesture.locked) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { gesture = null; return; }
        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
        gesture.locked = true; gesture.row.classList.add("is-swiping");
      }
      gesture.dx = dx;
      setOffset(gesture.row, Math.max(-REVEAL - 12, Math.min(0, gesture.base + dx)));
    }, { passive: true });
    const end = () => {
      const current = gesture; gesture = null;
      if (!current?.locked) return;
      swallowClick = true; setTimeout(() => { swallowClick = false; }, 400);
      current.row.classList.remove("is-swiping");
      if (current.base + current.dx < -OPEN_AT) {
        if (openRow && openRow !== current.row) close();
        openRow = current.row; openRow.classList.add("is-swipe-open"); setOffset(openRow, -REVEAL);
      } else close(current.row);
    };
    recordListEl.addEventListener("touchend", end);
    recordListEl.addEventListener("touchcancel", () => { if (gesture?.locked) close(gesture.row); gesture = null; });
    // After a swipe, or while a row is open, a tap closes instead of opening the editor.
    recordListEl.addEventListener("click", (event) => {
      if (event.target.closest(".tally-record-delete")) return;
      if (swallowClick || live()) { event.preventDefault(); event.stopPropagation(); swallowClick = false; close(); }
    }, true);
    document.addEventListener("touchstart", (event) => { if (live() && !recordListEl.contains(event.target)) close(); }, { passive: true });
    window.addEventListener("scroll", () => close(), { passive: true });
    phone.addEventListener?.("change", () => close());
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
      selectedDay = record.date;
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
