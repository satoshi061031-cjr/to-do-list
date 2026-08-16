(function () {
  const STORAGE_TODO = "todo-app-v2";
  const STORAGE_CALENDAR = "calendar-app-v1";
  const STORAGE_MAIL_DIGEST = "daily-space-mail-digest-v1";
  const STORAGE_TALLY = "tally-book-v1";
  const STORAGE_REMINDER_FIRED = "daily-space-reminder-fired-v1";
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;

  function todayIso() {
    if (window.DailySpaceAgentData && typeof window.DailySpaceAgentData.todayIso === "function") {
      return window.DailySpaceAgentData.todayIso();
    }
    const n = new Date();
    const y = n.getFullYear();
    const m = String(n.getMonth() + 1).padStart(2, "0");
    const d = String(n.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function nowHm() {
    const n = new Date();
    return `${pad2(n.getHours())}:${pad2(n.getMinutes())}`;
  }

  function isEveningHour() {
    return new Date().getHours() >= 17;
  }

  function readTodos() {
    try {
      const raw = localStorage.getItem(STORAGE_TODO);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.todos)) return [];
      return parsed.todos.filter(
        (t) => t && typeof t === "object" && typeof t.text === "string"
      );
    } catch (_) {
      return [];
    }
  }

  function readReminders() {
    try {
      const raw = localStorage.getItem(STORAGE_CALENDAR);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.reminders)) return [];
      return parsed.reminders.filter(
        (r) =>
          r &&
          typeof r === "object" &&
          typeof r.date === "string" &&
          ISO_DATE.test(r.date) &&
          typeof r.text === "string" &&
          r.text.trim()
      );
    } catch (_) {
      return [];
    }
  }

  function isOverdue(dueDate, completed) {
    if (!dueDate || completed) return false;
    return dueDate < todayIso();
  }

  function getTodayStats() {
    const today = todayIso();
    const todos = readTodos();
    const dueToday = todos.filter((t) => t.dueDate === today);
    const dueTodayOpen = dueToday.filter((t) => !t.completed);
    const dueTodayDone = dueToday.filter((t) => t.completed);
    const overdueOpen = todos.filter((t) => isOverdue(t.dueDate, t.completed));
    const remindersToday = readReminders()
      .filter((r) => r.date === today)
      .sort((a, b) =>
        (a.startTime || a.endTime || "99:99").localeCompare(b.startTime || b.endTime || "99:99")
      );
    return {
      today,
      dueTodayTotal: dueToday.length,
      dueTodayOpen: dueTodayOpen.length,
      dueTodayDone: dueTodayDone.length,
      overdueOpen: overdueOpen.length,
      remindersToday,
      remainingOpen: dueTodayOpen.length + overdueOpen.length,
      cleared: dueToday.length > 0 && dueTodayOpen.length === 0 && overdueOpen.length === 0,
    };
  }

  function readCachedMailDigest() {
    try {
      const raw = localStorage.getItem(STORAGE_MAIL_DIGEST);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      if (parsed.date !== todayIso()) return null;
      if (typeof parsed.digest !== "string" || !parsed.digest.trim()) return null;
      return {
        digest: parsed.digest.trim().slice(0, 400),
        summarized: Boolean(parsed.summarized),
      };
    } catch (_) {
      return null;
    }
  }

  function writeCachedMailDigest(digest, summarized) {
    try {
      localStorage.setItem(
        STORAGE_MAIL_DIGEST,
        JSON.stringify({
          date: todayIso(),
          digest: String(digest || "").trim().slice(0, 400),
          summarized: Boolean(summarized),
          at: Date.now(),
        })
      );
      window.dispatchEvent(new CustomEvent("daily-space-mail-digest-updated"));
    } catch (_) {
      /* ignore */
    }
  }

  let mailDigestRefreshPromise = null;

  async function refreshMailDigestCache(options) {
    const force = Boolean(options && options.force);
    const cached = readCachedMailDigest();
    if (cached && !force) {
      try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_MAIL_DIGEST) || "null");
        const age = raw && Number(raw.at) ? Date.now() - Number(raw.at) : Infinity;
        // Reuse a fresh cache for 10 minutes unless forced.
        if (Number.isFinite(age) && age < 10 * 60_000) return cached;
      } catch (_) {
        return cached;
      }
    }
    if (mailDigestRefreshPromise) return mailDigestRefreshPromise;

    mailDigestRefreshPromise = (async () => {
      try {
        if (typeof navigator !== "undefined" && navigator.onLine === false) return cached;
        const meResponse = await fetch("/api/auth/me", { credentials: "same-origin" });
        const me = await meResponse.json().catch(() => ({}));
        if (!meResponse.ok || !me.user) return cached;
        const accountsResponse = await fetch("/api/mail/accounts", { credentials: "same-origin" });
        const accountsPayload = await accountsResponse.json().catch(() => ({}));
        if (!accountsResponse.ok) return cached;
        const accounts = Array.isArray(accountsPayload.accounts) ? accountsPayload.accounts : [];
        const ready = accounts.filter((account) => account && account.hasCredentials && !account.needsMailOAuth);
        if (!ready.length) return cached;
        const preferred =
          ready.find((account) => account.id === localStorage.getItem("daily-space-mail-selected-v1")) || ready[0];
        const lang =
          window.DailySpaceI18n && typeof window.DailySpaceI18n.localeTag === "function"
            ? window.DailySpaceI18n.localeTag()
            : document.documentElement.lang || "en";
        const digestResponse = await fetch(
          `/api/mail/accounts/${encodeURIComponent(preferred.id)}/digest?limit=8&today=${encodeURIComponent(
            todayIso()
          )}&lang=${encodeURIComponent(lang)}`,
          { credentials: "same-origin" }
        );
        const digestPayload = await digestResponse.json().catch(() => ({}));
        if (!digestResponse.ok || typeof digestPayload.digest !== "string") return cached;
        writeCachedMailDigest(digestPayload.digest, Boolean(digestPayload.summarized));
        return readCachedMailDigest();
      } catch (_) {
        return cached;
      } finally {
        mailDigestRefreshPromise = null;
      }
    })();

    return mailDigestRefreshPromise;
  }

  function readTodaySpend() {
    try {
      const raw = localStorage.getItem(STORAGE_TALLY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.records)) return null;
      const today = todayIso();
      const currency =
        typeof parsed.currency === "string" && parsed.currency.trim()
          ? parsed.currency.trim().slice(0, 8)
          : "¥";
      let amount = 0;
      let count = 0;
      for (const record of parsed.records) {
        if (!record || typeof record !== "object") continue;
        if (record.date !== today) continue;
        if (record.scope === "shared") continue;
        const value = Number(record.amount);
        if (!Number.isFinite(value)) continue;
        amount += value * (Number(record.fxRate) > 0 ? Number(record.fxRate) : 1);
        count += 1;
      }
      return { amount, currency, count };
    } catch (_) {
      return null;
    }
  }

  function readFiredMap() {
    try {
      const raw = localStorage.getItem(STORAGE_REMINDER_FIRED);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeFiredMap(map) {
    try {
      localStorage.setItem(STORAGE_REMINDER_FIRED, JSON.stringify(map));
    } catch (_) {
      /* ignore */
    }
  }

  function notificationsSupported() {
    return typeof window.Notification === "function";
  }

  function notificationPermission() {
    if (!notificationsSupported()) return "unsupported";
    return Notification.permission;
  }

  async function requestNotificationPermission() {
    if (!notificationsSupported()) return "unsupported";
    if (Notification.permission === "granted") return "granted";
    if (Notification.permission === "denied") return "denied";
    try {
      return await Notification.requestPermission();
    } catch (_) {
      return Notification.permission;
    }
  }

  function showReminderNotification(reminder) {
    if (!notificationsSupported() || Notification.permission !== "granted") return false;
    const title = "Daily Space reminder";
    const bodyParts = [];
    if (reminder.startTime) bodyParts.push(reminder.startTime);
    bodyParts.push(String(reminder.text || "").trim());
    try {
      const note = new Notification(title, {
        body: bodyParts.filter(Boolean).join(" · ").slice(0, 160),
        tag: `daily-space-reminder-${reminder.id}`,
        renotify: false,
      });
      note.onclick = function () {
        window.focus();
        window.location.href = "calendar.html";
        note.close();
      };
      return true;
    } catch (_) {
      return false;
    }
  }

  function tickReminderNotifications() {
    if (!notificationsSupported() || Notification.permission !== "granted") return;
    const today = todayIso();
    const hm = nowHm();
    const fired = readFiredMap();
    const nextFired = { ...fired };
    // Drop entries from other days
    Object.keys(nextFired).forEach((id) => {
      if (nextFired[id] !== today) delete nextFired[id];
    });

    readReminders().forEach((reminder) => {
      if (reminder.date !== today) return;
      const id = String(reminder.id || "");
      if (!id || nextFired[id] === today) return;
      const start = typeof reminder.startTime === "string" && TIME_24H.test(reminder.startTime)
        ? reminder.startTime
        : null;
      // Timed reminders fire at/after start; untimed fire once in the evening window.
      const shouldFire = start ? start <= hm : isEveningHour();
      if (!shouldFire) return;
      if (showReminderNotification(reminder)) {
        nextFired[id] = today;
      }
    });

    writeFiredMap(nextFired);
  }

  function setupReminderNotifications() {
    if (!notificationsSupported()) return;
    tickReminderNotifications();
    window.setInterval(tickReminderNotifications, 30000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) tickReminderNotifications();
    });
  }

  function setupSidebarTodayStrip() {
    const sidebarInner = document.querySelector(".sidebar-inner");
    if (!sidebarInner) return;

    let strip = document.getElementById("sidebar-today-strip");
    if (!strip) {
      strip = document.createElement("a");
      strip.id = "sidebar-today-strip";
      strip.className = "sidebar-today-strip";
      strip.href = "todo.html#today";
      strip.setAttribute("aria-label", "Open today’s tasks");

      const kicker = document.createElement("span");
      kicker.className = "sidebar-today-kicker";
      kicker.textContent = "Today";

      const line = document.createElement("span");
      line.className = "sidebar-today-line";
      line.id = "sidebar-today-line";

      strip.append(kicker, line);

      // Pages heading lives inside .sidebar-planner-block — insert relative to that block
      // (or auth), never as insertBefore(nestedHeading) on sidebarInner.
      const plannerBlock = sidebarInner.querySelector(".sidebar-planner-block");
      const auth = sidebarInner.querySelector(".sidebar-auth");
      if (plannerBlock && plannerBlock.parentNode === sidebarInner) {
        sidebarInner.insertBefore(strip, plannerBlock);
      } else if (auth && auth.parentNode === sidebarInner) {
        sidebarInner.insertBefore(strip, auth);
      } else {
        sidebarInner.appendChild(strip);
      }
    }

    function refresh() {
      const stats = getTodayStats();
      const line = document.getElementById("sidebar-today-line");
      if (!line) return;
      if (stats.dueTodayOpen === 0 && stats.overdueOpen === 0) {
        line.textContent =
          stats.dueTodayDone > 0 ? `All caught up · ${stats.dueTodayDone} done` : "Nothing due";
      } else if (stats.overdueOpen > 0) {
        line.textContent = `${stats.dueTodayOpen} due · ${stats.overdueOpen} overdue`;
      } else {
        line.textContent = `${stats.dueTodayOpen} due`;
      }
      strip.classList.toggle("has-overdue", stats.overdueOpen > 0);
      strip.classList.toggle("is-clear", stats.dueTodayOpen === 0 && stats.overdueOpen === 0);
    }

    refresh();
    window.addEventListener("storage", (event) => {
      if (event.key === STORAGE_TODO || event.key === STORAGE_CALENDAR) refresh();
    });
    window.addEventListener("daily-space-agent-data-updated", refresh);
    window.addEventListener("daily-space-locale-changed", refresh);
    window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });
  }

  window.DailySpaceLoop = {
    todayIso,
    isEveningHour,
    getTodayStats,
    readCachedMailDigest,
    writeCachedMailDigest,
    refreshMailDigestCache,
    readTodaySpend,
    notificationPermission,
    requestNotificationPermission,
    setupReminderNotifications,
    setupSidebarTodayStrip,
    tickReminderNotifications,
  };
})();
