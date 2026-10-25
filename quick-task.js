/** Local, explicit date suggestions. Nothing is removed until the user applies it. */
(function (global) {
  const iso = (value) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  function parse(text, now = new Date()) {
    let title = String(text || ""),
      dueDate = null,
      dueTime = null;
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    const relative = title.match(/今天|明天|后天|\b(today|tomorrow)\b/i);
    if (relative) {
      base.setDate(
        base.getDate() +
          (/后天/.test(relative[0])
            ? 2
            : /明天|tomorrow/i.test(relative[0])
              ? 1
              : 0),
      );
      dueDate = iso(base);
      title = title.replace(relative[0], " ");
    } else {
      const date = title.match(/\b(\d{4}-\d{2}-\d{2})\b/);
      if (date) {
        const parsed = new Date(`${date[1]}T12:00:00`);
        if (Number.isFinite(parsed.getTime()) && iso(parsed) === date[1]) {
          dueDate = date[1];
          title = title.replace(date[0], " ");
        }
      }
      const weekday =
        !date && title.match(/(下周|本周|周|星期)([一二三四五六日天])/);
      if (weekday) {
        const target = "日一二三四五六".indexOf(
          weekday[2] === "天" ? "日" : weekday[2],
        );
        let delta = (target - base.getDay() + 7) % 7;
        if (weekday[1] === "下周")
          delta = (target || 7) - (base.getDay() || 7) + 7;
        if (weekday[1] === "本周") delta = (target || 7) - (base.getDay() || 7);
        base.setDate(base.getDate() + delta);
        dueDate = iso(base);
        title = title.replace(weekday[0], " ");
      }
    }
    const clock = title.match(
      /(上午|下午|晚上|中午|早上)?\s*([零〇一二两三四五六七八九十]{1,3}|\d{1,2})[点时](半|\d{1,2}分?)?/,
    );
    const western =
      !clock &&
      title.match(
        /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/i,
      );
    if (clock || western) {
      const number = (value) => {
        if (/^\d+$/.test(value)) return Number(value);
        const digits = {
          零: 0,
          〇: 0,
          一: 1,
          二: 2,
          两: 2,
          三: 3,
          四: 4,
          五: 5,
          六: 6,
          七: 7,
          八: 8,
          九: 9,
        };
        const parts = value.split("十");
        return parts.length === 2
          ? (parts[0] ? digits[parts[0]] : 1) * 10 +
              (parts[1] ? digits[parts[1]] : 0)
          : digits[value];
      };
      let hour = clock ? number(clock[2]) : Number(western[1] || western[4]);
      const minute = clock
        ? clock[3] === "半"
          ? 30
          : Number((clock[3] || "0").replace("分", ""))
        : Number(western[2] || western[5] || 0);
      const period = clock ? clock[1] : western[3]?.toLowerCase();
      const twelve = /上午|早上|下午|晚上|中午|am|pm/.test(period || "");
      if (
        Number.isFinite(hour) &&
        hour >= 0 &&
        hour <= (twelve ? 12 : 23) &&
        minute >= 0 &&
        minute < 60
      ) {
        if (/下午|晚上|中午|pm/.test(period || "") && hour < 12) hour += 12;
        if (/上午|早上|am/.test(period || "") && hour === 12) hour = 0;
        dueTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        title = title.replace((clock || western)[0], " ");
      }
    }
    title = title.replace(/\s+/g, " ").trim();
    return title && (dueDate || dueTime)
      ? { text: title, dueDate, dueTime }
      : null;
  }
  const api = { parse };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (!global?.document) return;
  global.DailySpaceQuickTask = api;
  function boot() {
    const t = (en, zh) => global.DailySpaceI18n?.t(en, zh) || en;
    for (const selector of [
      "#m-task-title",
      "body:not(.todo-mobile) #todo-input",
    ]) {
      const input = document.querySelector(selector);
      if (!input) continue;
      const phone = input.id === "m-task-title";
      const suggestion = document.createElement("button");
      suggestion.type = "button";
      suggestion.className = "quick-task-suggestion";
      suggestion.hidden = true;
      suggestion.dataset.i18nIgnore = "";
      input.closest(".add-form-row")?.after(suggestion);
      if (phone) input.after(suggestion);
      let composing = false;
      function update() {
        const result = !composing && parse(input.value);
        suggestion.hidden = !result;
        suggestion.textContent = result
          ? `${t("Apply", "应用")} · ${[result.dueDate, result.dueTime].filter(Boolean).join(" · ")}`
          : "";
      }
      input.addEventListener("compositionstart", () => {
        composing = true;
        update();
      });
      input.addEventListener("compositionend", () => {
        composing = false;
        update();
      });
      input.addEventListener("input", update);
      input.addEventListener("focus", update);
      suggestion.addEventListener("click", () => {
        const result = parse(input.value);
        if (!result) return;
        input.value = result.text;
        const day = document.getElementById(
          phone ? "m-task-date" : "todo-deadline",
        );
        if (result.dueDate) {
          day.value = result.dueDate;
          if (phone) day.hidden = false;
          day.dispatchEvent(new Event("change", { bubbles: true }));
        }
        let time = document.getElementById(
          phone ? "m-task-time" : "quick-task-time",
        );
        if (!time && result.dueTime) {
          time = document.createElement("input");
          time.type = "time";
          time.id = "quick-task-time";
          time.setAttribute("aria-label", t("Time", "时间"));
          time.className = "quick-task-time";
          suggestion.after(time);
        }
        if (result.dueTime) {
          time.value = result.dueTime;
          time.dispatchEvent(new Event("change", { bubbles: true }));
          if (phone) document.getElementById("m-task-details").open = true;
        }
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus({ preventScroll: true });
      });
      input.form.addEventListener("submit", () => setTimeout(update, 0));
    }
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window === "object" ? window : globalThis);
