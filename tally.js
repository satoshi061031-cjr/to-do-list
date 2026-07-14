(function () {
  const STORAGE_TALLY = "tally-book-v1";

  function uiLocale() {
    return window.DailySpaceI18n?.localeTag() || "en-US";
  }

  /** @type {{ id: string; date: string; amount: number; category: string; note: string }[]} */
  let records = [];
  let budget = 1000;
  let currencySymbol = "¥";
  let viewYear = new Date().getFullYear();
  let viewMonth = new Date().getMonth() + 1;

  const monthTitleEl = document.getElementById("tally-month-title");
  const metaEl = document.getElementById("tally-meta");
  const monthTotalEl = document.getElementById("tally-month-total");
  const weekTotalEl = document.getElementById("tally-week-total");
  const budgetInput = document.getElementById("tally-budget");
  const currencyInput = document.getElementById("tally-currency");
  const progressBar = document.getElementById("tally-progress-bar");
  const budgetNoteEl = document.getElementById("tally-budget-note");
  const settingsToggle = document.getElementById("tally-settings-toggle");
  const settingsPanel = document.getElementById("tally-settings");
  const form = document.getElementById("tally-form");
  const dateInput = document.getElementById("tally-date");
  const amountInput = document.getElementById("tally-amount");
  const categoryInput = document.getElementById("tally-category");
  const noteInput = document.getElementById("tally-note");
  const barsEl = document.getElementById("tally-bars");
  const recordListEl = document.getElementById("tally-record-list");
  const emptyEl = document.getElementById("tally-empty");
  const prevBtn = document.getElementById("tally-prev");
  const nextBtn = document.getElementById("tally-next");
  const todayBtn = document.getElementById("tally-today");
  const addOpenBtn = document.getElementById("tally-add-open");
  const addSheet = document.getElementById("tally-add-sheet");
  const addCloseBtn = document.getElementById("tally-add-close");
  const addBackdrop = document.getElementById("tally-add-backdrop");

  function id() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random();
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
    const [year, month, day] = iso.split("-").map(Number);
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

  function currency(value) {
    const symbol = currencySymbol || "¥";
    const separator = /[a-z0-9]$/i.test(symbol) ? " " : "";
    return `${symbol}${separator}${Number(value || 0).toFixed(2)}`;
  }

  function monthKey(year, month) {
    return `${year}-${pad2(month)}`;
  }

  function recordsForMonth(year, month) {
    const key = monthKey(year, month);
    return records.filter((record) => record.date.startsWith(key));
  }

  function total(list) {
    return list.reduce((sum, record) => sum + record.amount, 0);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[char];
    });
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_TALLY) || "{}");
      if (!parsed || typeof parsed !== "object") return;
      budget = Number.isFinite(parsed.budget) && parsed.budget > 0 ? parsed.budget : 1000;
      currencySymbol =
        typeof parsed.currency === "string" && parsed.currency.trim()
          ? parsed.currency.trim().slice(0, 8)
          : "¥";
      records = Array.isArray(parsed.records)
        ? parsed.records
            .filter((record) => record && typeof record.date === "string" && Number.isFinite(record.amount))
            .map((record) => ({
              id: typeof record.id === "string" ? record.id : id(),
              date: record.date,
              amount: Math.max(0, Number(record.amount)),
              category: typeof record.category === "string" ? record.category.slice(0, 40) : "Expense",
              note: typeof record.note === "string" ? record.note.slice(0, 120) : "",
            }))
        : [];
    } catch (_) {
      records = [];
      budget = 1000;
      currencySymbol = "¥";
    }
  }

  function saveState() {
    localStorage.setItem(
      STORAGE_TALLY,
      JSON.stringify({ version: 1, budget, currency: currencySymbol, records })
    );
  }

  function viewAnchorDate() {
    const now = new Date();
    if (viewYear === now.getFullYear() && viewMonth === now.getMonth() + 1) return now;
    return new Date(viewYear, viewMonth - 1, 1);
  }

  function renderSummary() {
    const monthRecords = recordsForMonth(viewYear, viewMonth);
    const monthTotal = total(monthRecords);
    const start = weekStart(viewAnchorDate());
    const end = addDays(start, 6);
    const weekRecords = records.filter((record) => {
      const date = parseIso(record.date);
      return date >= start && date <= end;
    });
    const spentThisWeek = total(weekRecords);
    const remaining = Math.max(0, budget - monthTotal);
    const percent = budget > 0 ? Math.min(100, (monthTotal / budget) * 100) : 0;

    monthTitleEl.textContent = new Date(viewYear, viewMonth - 1, 1).toLocaleDateString(uiLocale(), {
      year: "numeric",
      month: "long",
    });
    metaEl.textContent = `${monthRecords.length} records · ${percent.toFixed(0)}% of budget used`;
    monthTotalEl.textContent = currency(monthTotal);
    weekTotalEl.textContent = currency(spentThisWeek);
    budgetInput.value = String(budget);
    currencyInput.value = currencySymbol;
    progressBar.style.width = `${percent}%`;
    budgetNoteEl.textContent = `${currency(remaining)} remaining · ${currency(monthTotal)} spent`;
  }

  function renderBars() {
    const start = weekStart(viewAnchorDate());
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index);
      const amount = total(records.filter((record) => record.date === dateToIso(date)));
      return { date, amount };
    });
    const max = Math.max(1, ...days.map((day) => day.amount));
    barsEl.innerHTML = "";
    days.forEach((day) => {
      const bar = document.createElement("div");
      bar.className = "tally-bar";
      if (day.amount > 0) bar.classList.add("has-value");
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
    const yesterday = dateToIso(addDays(new Date(), -1));
    if (iso === yesterday) return "Yesterday";
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
    if (/rent|home|房租|住房/.test(normalized)) return "⌂";
    if (/shop|购物/.test(normalized)) return "◈";
    return "¥";
  }

  function removeRecord(recordId) {
    records = records.filter((record) => record.id !== recordId);
    saveState();
    render();
  }

  function renderRecords() {
    const monthRecords = recordsForMonth(viewYear, viewMonth).sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return records.indexOf(a) - records.indexOf(b);
    });
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
      heading.textContent = groupTitle(date);
      const card = document.createElement("div");
      card.className = "tally-record-group-card";

      groupRecords.forEach((record) => {
        const row = document.createElement("div");
        row.className = "tally-record";
        row.innerHTML = `
          <span class="tally-record-icon" aria-hidden="true">${categoryIcon(record.category)}</span>
          <div class="tally-record-main">
            <div class="tally-record-category">${escapeHtml(record.category)}</div>
            <div class="tally-record-note">${escapeHtml(record.note || "No note")}</div>
          </div>
          <div class="tally-record-amount">${currency(record.amount)}</div>
          <button type="button" class="tally-record-delete" aria-label="Delete record">×</button>
        `;
        row.querySelector(".tally-record-delete").addEventListener("click", () => removeRecord(record.id));
        card.appendChild(row);
      });

      group.append(heading, card);
      recordListEl.appendChild(group);
    });
    emptyEl.textContent = monthRecords.length ? "" : "No expenses this month.";
  }

  function render() {
    renderSummary();
    renderBars();
    renderRecords();
  }

  function shiftMonth(delta) {
    viewMonth += delta;
    if (viewMonth > 12) {
      viewMonth = 1;
      viewYear += 1;
    } else if (viewMonth < 1) {
      viewMonth = 12;
      viewYear -= 1;
    }
    render();
  }

  function goToCurrentMonth() {
    const now = new Date();
    viewYear = now.getFullYear();
    viewMonth = now.getMonth() + 1;
    render();
  }

  function setSheetOpen(open) {
    addSheet.hidden = !open;
    document.body.classList.toggle("tally-sheet-open", open);
    if (open) {
      dateInput.value = todayIso();
      window.requestAnimationFrame(() => amountInput.focus());
    } else {
      addOpenBtn.focus();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = Number(amountInput.value);
    const category = categoryInput.value.trim();
    const date = dateInput.value || todayIso();
    if (!Number.isFinite(amount) || amount <= 0 || !category) return;
    records.unshift({
      id: id(),
      date,
      amount,
      category: category.slice(0, 40),
      note: noteInput.value.trim().slice(0, 120),
    });
    const recordDate = parseIso(date);
    viewYear = recordDate.getFullYear();
    viewMonth = recordDate.getMonth() + 1;
    amountInput.value = "";
    categoryInput.value = "";
    noteInput.value = "";
    saveState();
    setSheetOpen(false);
    render();
  });

  budgetInput.addEventListener("change", () => {
    const next = Number(budgetInput.value);
    budget = Number.isFinite(next) && next > 0 ? next : 1000;
    saveState();
    render();
  });

  currencyInput.addEventListener("change", () => {
    currencySymbol = currencyInput.value.trim().slice(0, 8) || "¥";
    saveState();
    render();
  });

  settingsToggle.addEventListener("click", () => {
    const open = settingsPanel.hidden;
    settingsPanel.hidden = !open;
    settingsToggle.setAttribute("aria-expanded", String(open));
  });
  prevBtn.addEventListener("click", () => shiftMonth(-1));
  nextBtn.addEventListener("click", () => shiftMonth(1));
  todayBtn.addEventListener("click", goToCurrentMonth);
  addOpenBtn.addEventListener("click", () => setSheetOpen(true));
  addCloseBtn.addEventListener("click", () => setSheetOpen(false));
  addBackdrop.addEventListener("click", () => setSheetOpen(false));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !addSheet.hidden) setSheetOpen(false);
  });

  window.addEventListener("daily-space-agent-data-updated", (event) => {
    const domains = Array.isArray(event.detail?.domains) ? event.detail.domains : [];
    if (!domains.includes("tally")) return;
    loadState();
    render();
  });
  window.addEventListener("daily-space-locale-changed", render);

  loadState();
  render();
})();
