(function () {
  const STORAGE_TALLY = "tally-book-v1";

  function uiLocale() {
    return window.DailySpaceI18n?.localeTag() || "en-US";
  }

  /** @type {{ id: string; date: string; amount: number; category: string; note: string }[]} */
  let records = [];
  let budget = 1000;
  let selectedDate = todayIso();
  let viewYear = new Date().getFullYear();
  let viewMonth = new Date().getMonth() + 1;

  const monthTitleEl = document.getElementById("tally-month-title");
  const metaEl = document.getElementById("tally-meta");
  const monthTotalEl = document.getElementById("tally-month-total");
  const todayTotalEl = document.getElementById("tally-today-total");
  const weekTotalEl = document.getElementById("tally-week-total");
  const budgetInput = document.getElementById("tally-budget");
  const progressBar = document.getElementById("tally-progress-bar");
  const budgetNoteEl = document.getElementById("tally-budget-note");
  const calendarGridEl = document.getElementById("tally-calendar-grid");
  const form = document.getElementById("tally-form");
  const dateInput = document.getElementById("tally-date");
  const amountInput = document.getElementById("tally-amount");
  const categoryInput = document.getElementById("tally-category");
  const noteInput = document.getElementById("tally-note");
  const barsEl = document.getElementById("tally-bars");
  const selectedTitleEl = document.getElementById("tally-selected-title");
  const selectedTotalEl = document.getElementById("tally-selected-total");
  const recordListEl = document.getElementById("tally-record-list");
  const emptyEl = document.getElementById("tally-empty");
  const prevBtn = document.getElementById("tally-prev");
  const nextBtn = document.getElementById("tally-next");
  const todayBtn = document.getElementById("tally-today");

  function id() {
    return typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : String(Date.now()) + Math.random();
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function todayIso() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function toIso(year, month, day) {
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  function parseIso(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function mondayIndex(date) {
    return (date.getDay() + 6) % 7;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function currency(value) {
    return `¥${value.toFixed(2)}`;
  }

  function monthKey(year, month) {
    return `${year}-${pad2(month)}`;
  }

  function recordsForMonth(year, month) {
    const key = monthKey(year, month);
    return records.filter((r) => r.date.startsWith(key));
  }

  function total(list) {
    return list.reduce((sum, r) => sum + r.amount, 0);
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_TALLY) || "{}");
      if (!parsed || typeof parsed !== "object") return;
      budget = Number.isFinite(parsed.budget) && parsed.budget > 0 ? parsed.budget : 1000;
      records = Array.isArray(parsed.records)
        ? parsed.records
            .filter((r) => r && typeof r.date === "string" && Number.isFinite(r.amount))
            .map((r) => ({
              id: typeof r.id === "string" ? r.id : id(),
              date: r.date,
              amount: Math.max(0, Number(r.amount)),
              category: typeof r.category === "string" ? r.category.slice(0, 40) : "Expense",
              note: typeof r.note === "string" ? r.note.slice(0, 120) : "",
            }))
        : [];
    } catch (_) {
      records = [];
      budget = 1000;
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_TALLY, JSON.stringify({ version: 1, budget, records }));
  }

  function selectDate(iso) {
    selectedDate = iso;
    const d = parseIso(iso);
    viewYear = d.getFullYear();
    viewMonth = d.getMonth() + 1;
    render();
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

  function renderSummary() {
    const monthRecords = recordsForMonth(viewYear, viewMonth);
    const monthTotal = total(monthRecords);
    const today = todayIso();
    const todayTotal = total(records.filter((r) => r.date === today));
    const now = new Date();
    const weekStart = addDays(now, -mondayIndex(now));
    const weekEnd = addDays(weekStart, 6);
    const weekTotal = total(records.filter((r) => {
      const d = parseIso(r.date);
      return d >= weekStart && d <= weekEnd;
    }));
    const remaining = Math.max(0, budget - monthTotal);
    const percent = budget > 0 ? Math.min(100, (monthTotal / budget) * 100) : 0;

    monthTitleEl.textContent = new Date(viewYear, viewMonth - 1, 1).toLocaleDateString(uiLocale(), {
      year: "numeric",
      month: "long",
    });
    metaEl.textContent = `${monthRecords.length} records · ${percent.toFixed(0)}% of budget used`;
    monthTotalEl.textContent = currency(monthTotal);
    todayTotalEl.textContent = currency(todayTotal);
    weekTotalEl.textContent = currency(weekTotal);
    budgetInput.value = String(budget);
    progressBar.style.width = `${percent}%`;
    budgetNoteEl.textContent = `${currency(remaining)} remaining · ${currency(monthTotal)} spent`;
  }

  function renderCalendar() {
    const first = new Date(viewYear, viewMonth - 1, 1);
    const start = addDays(first, -mondayIndex(first));
    calendarGridEl.innerHTML = "";
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i);
      const iso = toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
      const dayTotal = total(records.filter((r) => r.date === iso));
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tally-day";
      if (d.getMonth() !== viewMonth - 1) btn.classList.add("is-outside");
      if (iso === selectedDate) btn.classList.add("is-selected");
      btn.innerHTML = `<span class="tally-day-number">${d.getDate()}</span><span class="tally-day-amount">${dayTotal ? currency(dayTotal) : " "}</span>`;
      btn.addEventListener("click", () => selectDate(iso));
      calendarGridEl.appendChild(btn);
    }
  }

  function renderBars() {
    const days = recordsForMonth(viewYear, viewMonth).reduce((acc, r) => {
      const day = Number(r.date.slice(-2));
      acc[day] = (acc[day] || 0) + r.amount;
      return acc;
    }, {});
    const entries = Object.entries(days)
      .map(([day, amount]) => ({ day: Number(day), amount }))
      .sort((a, b) => a.day - b.day)
      .slice(-10);
    const max = Math.max(1, ...entries.map((x) => x.amount));
    barsEl.innerHTML = "";
    if (entries.length === 0) {
      barsEl.innerHTML = '<p class="tally-empty">No expense data yet.</p>';
      return;
    }
    entries.forEach((entry) => {
      const bar = document.createElement("div");
      bar.className = "tally-bar";
      bar.innerHTML = `<span>${entry.amount.toFixed(0)}</span><span class="tally-bar-fill" style="height:${Math.max(8, (entry.amount / max) * 100)}%"></span><span>${pad2(entry.day)}</span>`;
      barsEl.appendChild(bar);
    });
  }

  function renderRecords() {
    const selectedRecords = records.filter((r) => r.date === selectedDate).sort((a, b) => b.amount - a.amount);
    selectedTitleEl.textContent = parseIso(selectedDate).toLocaleDateString(uiLocale(), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    selectedTotalEl.textContent = currency(total(selectedRecords));
    dateInput.value = selectedDate;
    recordListEl.innerHTML = "";
    selectedRecords.forEach((record) => {
      const li = document.createElement("li");
      li.className = "tally-record";
      li.innerHTML = `
        <div class="tally-record-main">
          <div class="tally-record-category">${record.category}</div>
          <div class="tally-record-note">${record.note || "No note"}</div>
        </div>
        <div class="tally-record-amount">-${currency(record.amount)}</div>
        <button type="button" class="tally-record-delete" aria-label="Delete record">×</button>
      `;
      li.querySelector(".tally-record-delete").addEventListener("click", () => {
        records = records.filter((r) => r.id !== record.id);
        saveState();
        render();
      });
      recordListEl.appendChild(li);
    });
    emptyEl.textContent = selectedRecords.length ? "" : "No expenses for this day.";
  }

  function render() {
    renderSummary();
    renderCalendar();
    renderBars();
    renderRecords();
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = Number(amountInput.value);
    const category = categoryInput.value.trim();
    if (!Number.isFinite(amount) || amount <= 0 || !category) return;
    records.unshift({
      id: id(),
      date: dateInput.value || selectedDate,
      amount,
      category: category.slice(0, 40),
      note: noteInput.value.trim().slice(0, 120),
    });
    amountInput.value = "";
    categoryInput.value = "";
    noteInput.value = "";
    saveState();
    render();
  });

  budgetInput.addEventListener("change", () => {
    const next = Number(budgetInput.value);
    budget = Number.isFinite(next) && next > 0 ? next : 1000;
    saveState();
    render();
  });

  prevBtn.addEventListener("click", () => shiftMonth(-1));
  nextBtn.addEventListener("click", () => shiftMonth(1));
  todayBtn.addEventListener("click", () => selectDate(todayIso()));

  window.addEventListener("daily-space-agent-data-updated", (event) => {
    const domains = Array.isArray(event.detail?.domains) ? event.detail.domains : [];
    if (!domains.includes("tally")) return;
    loadState();
    render();
  });

  window.addEventListener("daily-space-locale-changed", () => render());

  loadState();
  render();
})();
