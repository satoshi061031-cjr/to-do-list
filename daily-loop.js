(function () {
  const STORAGE_TODO = "todo-app-v2";
  const STORAGE_CALENDAR = "calendar-app-v1";
  const STORAGE_MAIL_DIGEST = "daily-space-mail-digest-v1";
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
    } catch (_) {
      /* ignore */
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

      const pagesHeading = Array.from(sidebarInner.querySelectorAll(".sidebar-heading")).find(
        (el) => /pages/i.test(el.textContent || "")
      );
      if (pagesHeading) sidebarInner.insertBefore(strip, pagesHeading);
      else {
        const auth = sidebarInner.querySelector(".sidebar-auth");
        if (auth) sidebarInner.insertBefore(strip, auth);
        else sidebarInner.appendChild(strip);
      }
    }

    function refresh() {
      const stats = getTodayStats();
      const line = document.getElementById("sidebar-today-line");
      if (!line) return;
      if (stats.dueTodayOpen === 0 && stats.overdueOpen === 0) {
        line.textContent =
          stats.dueTodayDone > 0 ? `Cleared · ${stats.dueTodayDone} done` : "Nothing due";
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
    notificationPermission,
    requestNotificationPermission,
    setupReminderNotifications,
    setupSidebarTodayStrip,
    tickReminderNotifications,
  };
})();
