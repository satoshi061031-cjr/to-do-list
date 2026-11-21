/**
 * Natural-language quick add, in Chinese and English.
 * "明天下午3点 给妈妈打电话", "dentist fri 9am", "每周一三五 健身 #health !!",
 * "pay rent on the 25th every month". Parsing only suggests: nothing in the
 * title changes until the user applies the suggestion.
 */
(function (global) {
  const iso = (value) =>
    `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const ZH_DIGITS = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  /** "3", "十二", "二十五", "两" → number; NaN when it is not a number. */
  function number(value) {
    const text = String(value || "").trim();
    if (/^\d+$/.test(text)) return Number(text);
    if (!text) return NaN;
    const parts = text.split("十");
    if (parts.length > 2) return NaN;
    if (parts.length === 2) {
      const tens = parts[0] ? ZH_DIGITS[parts[0]] : 1, ones = parts[1] ? ZH_DIGITS[parts[1]] : 0;
      return tens === undefined || ones === undefined ? NaN : tens * 10 + ones;
    }
    return text.length === 1 && ZH_DIGITS[text] !== undefined ? ZH_DIGITS[text] : NaN;
  }
  const ZH_NUM = "[0-9零〇一二两三四五六七八九十]{1,3}";
  const ZH_DAY = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const EN_DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const EN_DAY = "(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday|sday)?";
  const enDay = (word) => EN_DAYS.indexOf(String(word).toLowerCase().slice(0, 3));
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const EN_MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";

  function addDays(date, days) { const next = new Date(date); next.setDate(next.getDate() + days); return next; }
  /** The next date (today included) that falls on one of the weekdays. */
  function nextWeekday(base, days, { includeToday = true } = {}) {
    for (let offset = includeToday ? 0 : 1; offset <= 7; offset += 1) {
      const candidate = addDays(base, offset);
      if (days.includes(candidate.getDay())) return candidate;
    }
    return null;
  }
  /** Day-of-month this month if still ahead (or today), otherwise next month, clamped to month end. */
  function nextMonthDay(base, day) {
    for (let add = 0; add <= 1; add += 1) {
      const last = new Date(base.getFullYear(), base.getMonth() + add + 1, 0).getDate();
      const candidate = new Date(base.getFullYear(), base.getMonth() + add, Math.min(day, last), 12);
      if (candidate >= base) return candidate;
    }
    return null;
  }
  function validCalendarDate(year, month, day) {
    const date = new Date(year, month - 1, day, 12);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
  }
  /** A month/day without a year: this year, or next year if it already passed. */
  function upcomingMonthDay(base, month, day) {
    const thisYear = validCalendarDate(base.getFullYear(), month, day);
    if (thisYear && thisYear >= base) return thisYear;
    return validCalendarDate(base.getFullYear() + 1, month, day);
  }

  /**
   * @param {string} text
   * @param {Date} [now]
   * @param {{ categories?: string[] }} [options] existing category names, so "#Work" can pick a category
   * @returns {null | { text: string, dueDate: string|null, dueTime: string|null, repeat?: string, repeatEvery?: number,
   *   repeatDays?: number[], tags?: string[], priority?: "high"|"low", categoryName?: string }}
   */
  function parse(text, now = new Date(), options = {}) {
    let title = ` ${String(text || "")} `;
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    let dueDate = null, dueTime = null, evening = false;
    const result = {};
    const take = (match) => { title = title.replace(match[0], " "); };

    // Tags and category: "#name" (a name equal to an existing category picks that category).
    const categories = (options.categories || []).map((name) => String(name));
    const tags = [];
    for (const match of [...title.matchAll(/(^|\s)#([^\s#!]{1,30})(?=\s|$)/g)]) {
      const name = match[2];
      const category = categories.find((item) => item.toLocaleLowerCase() === name.toLocaleLowerCase());
      if (category && !result.categoryName) result.categoryName = category;
      else if (!tags.some((tag) => tag.toLocaleLowerCase() === name.toLocaleLowerCase())) tags.push(name);
      title = title.replace(`#${name}`, " ");
    }
    if (tags.length) result.tags = tags.slice(0, 10);

    // Priority: "!!", "!1", "p1" → important; "!3", "p3" → low.
    const priority = title.match(/(^|\s)(!!|!1|p1|!high)(?=\s|$)/i) || title.match(/(^|\s)(!3|p3|!low)(?=\s|$)/i);
    if (priority) { result.priority = /!!|1|high/i.test(priority[2]) ? "high" : "low"; take(priority); }

    // Repeat rules first, because they contain weekdays and dates of their own.
    let match;
    if ((match = title.match(/每(?:个)?工作日|(?:\b|^)(?:every\s+)?weekdays?\b(?!\s*\w*day)|\bevery\s+weekday\b/i))) {
      result.repeat = "weekdays"; take(match);
      dueDate = iso(nextWeekday(base, [1, 2, 3, 4, 5]));
    } else if ((match = title.match(new RegExp(`每(隔)?(${ZH_NUM})?个?(?:周|星期|礼拜)((?:[、，,和及]?[一二三四五六日天])+)?`)))) {
      const every = match[2] ? number(match[2]) + (match[1] ? 1 : 0) : match[1] ? 2 : 1;
      result.repeat = "weekly"; take(match);
      if (every > 1 && every < 100) result.repeatEvery = every;
      if (match[3]) {
        const days = [...new Set([...match[3]].filter((char) => char in ZH_DAY).map((char) => ZH_DAY[char]))];
        if (days.length > 1) result.repeatDays = days;
        dueDate = iso(nextWeekday(base, days));
      }
    } else if ((match = title.match(new RegExp(`\\bevery\\s+(${EN_DAY}(?:\\s*(?:,|and|&)\\s*${EN_DAY})*)\\b`, "i")))) {
      const days = [...new Set(match[1].split(/\s*(?:,|and|&)\s*/i).map(enDay).filter((day) => day >= 0))];
      result.repeat = "weekly"; take(match);
      if (days.length > 1) result.repeatDays = days;
      if (days.length) dueDate = iso(nextWeekday(base, days));
    } else if ((match = title.match(new RegExp(`每(隔)?(${ZH_NUM})?个?月(?:的)?(?:(${ZH_NUM})[号日])?`)))) {
      const every = match[2] ? number(match[2]) + (match[1] ? 1 : 0) : match[1] ? 2 : 1;
      result.repeat = "monthly"; take(match);
      if (every > 1 && every < 100) result.repeatEvery = every;
      const day = match[3] ? number(match[3]) : NaN;
      if (day >= 1 && day <= 31) dueDate = iso(nextMonthDay(base, day));
    } else if ((match = title.match(/每年(?:的)?(?:(\d{1,2})月(\d{1,2})[号日])?/))) {
      result.repeat = "yearly"; take(match);
      if (match[1]) { const date = upcomingMonthDay(base, Number(match[1]), Number(match[2])); if (date) dueDate = iso(date); }
    } else if ((match = title.match(new RegExp(`每(隔)?(${ZH_NUM})?(?:天|日)`)))) {
      const every = match[2] ? number(match[2]) + (match[1] ? 1 : 0) : match[1] ? 2 : 1;
      result.repeat = "daily"; take(match);
      if (every > 1 && every < 100) result.repeatEvery = every;
    } else if ((match = title.match(/\bevery\s+(other\s+|(\d{1,2})\s+)?(day|week|month|year)s?\b|\b(daily|weekly|biweekly|monthly|yearly|annually)\b/i))) {
      const word = (match[3] || match[4]).toLowerCase();
      const unit = { day: "daily", daily: "daily", week: "weekly", weekly: "weekly", biweekly: "weekly", month: "monthly", monthly: "monthly", year: "yearly", yearly: "yearly", annually: "yearly" }[word];
      const every = match[1] && /other/i.test(match[1]) ? 2 : match[2] ? Number(match[2]) : word === "biweekly" ? 2 : 1;
      result.repeat = unit; take(match);
      if (every > 1 && every < 100) result.repeatEvery = every;
    }
    if (!dueDate && (match = title.match(/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/i)) && result.repeat === "monthly") {
      const day = Number(match[1]);
      if (day >= 1 && day <= 31) { dueDate = iso(nextMonthDay(base, day)); take(match); }
    }

    // Dates.
    if (!dueDate) {
      const relativeZh = title.match(/大后天|后天|明天|明晚|明早|今天|今晚|今早/);
      const relativeEn = title.match(/\b(today|tonight|tomorrow|tmrw|tmr)\b/i);
      const later = title.match(new RegExp(`(${ZH_NUM})\\s*(天|日|周|星期|个月)(?:以)?后`)) ||
        title.match(/\bin\s+(\d{1,3}|a|an|one|two|three)\s+(day|week|month)s?\b/i);
      const zhWeekday = title.match(/(下下?周|下个?星期|本周|这周|周|星期|礼拜)([一二三四五六日天])/);
      const enWeekday = title.match(new RegExp(`\\b(next\\s+|this\\s+|on\\s+)?${EN_DAY}\\b`, "i"));
      const zhDate = title.match(/(\d{1,2})月(\d{1,2})[日号]/) || title.match(/(?:^|\s)(\d{1,2})号(?=\s|$|[^\d])/);
      const enDate = title.match(new RegExp(`\\b${EN_MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i")) || title.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${EN_MONTH}\\b`, "i"));
      const isoDate = title.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
      const slashDate = title.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$)/);
      if (relativeZh) {
        const word = relativeZh[0];
        dueDate = iso(addDays(base, word === "大后天" ? 3 : word === "后天" ? 2 : /明/.test(word) ? 1 : 0));
        evening = /晚/.test(word);
        take(relativeZh);
      } else if (relativeEn) {
        const word = relativeEn[1].toLowerCase();
        dueDate = iso(addDays(base, word === "today" || word === "tonight" ? 0 : 1));
        evening = word === "tonight";
        take(relativeEn);
      } else if (later) {
        const amount = /^(a|an|one)$/i.test(later[1]) ? 1 : /^two$/i.test(later[1]) ? 2 : /^three$/i.test(later[1]) ? 3 : number(later[1]);
        const unit = later[2].toLowerCase();
        if (amount > 0 && amount < 1000) {
          const date = /周|星期|week/.test(unit) ? addDays(base, amount * 7)
            : /月|month/.test(unit) ? new Date(base.getFullYear(), base.getMonth() + amount, Math.min(base.getDate(), new Date(base.getFullYear(), base.getMonth() + amount + 1, 0).getDate()), 12)
            : addDays(base, amount);
          dueDate = iso(date);
          take(later);
        }
      } else if (zhWeekday) {
        const target = ZH_DAY[zhWeekday[2]];
        const monday = (base.getDay() + 6) % 7; // days since this week's Monday
        const weekOffset = /下下/.test(zhWeekday[1]) ? 14 : /下/.test(zhWeekday[1]) ? 7 : 0;
        const explicitWeek = /下|本|这/.test(zhWeekday[1]);
        const date = explicitWeek ? addDays(base, -monday + ((target + 6) % 7) + weekOffset) : nextWeekday(base, [target]);
        dueDate = iso(date);
        take(zhWeekday);
      } else if (enWeekday && enDay(enWeekday[2]) >= 0) {
        const target = enDay(enWeekday[2]);
        const next = /next/i.test(enWeekday[1] || "");
        const monday = (base.getDay() + 6) % 7;
        dueDate = iso(next ? addDays(base, -monday + ((target + 6) % 7) + 7) : nextWeekday(base, [target]));
        take(enWeekday);
      } else if (isoDate) {
        const date = validCalendarDate(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
        if (date) { dueDate = iso(date); take(isoDate); }
      } else if (zhDate) {
        const date = zhDate[2] ? upcomingMonthDay(base, Number(zhDate[1]), Number(zhDate[2])) : nextMonthDay(base, Number(zhDate[1]));
        if (date && (!zhDate[2] ? Number(zhDate[1]) <= 31 : true)) { dueDate = iso(date); take(zhDate); }
      } else if (enDate) {
        const monthWord = /\d/.test(enDate[1]) ? enDate[2] : enDate[1];
        const dayNumber = Number(/\d/.test(enDate[1]) ? enDate[1] : enDate[2]);
        const month = MONTHS.indexOf(monthWord.toLowerCase().slice(0, 3)) + 1;
        const date = month ? upcomingMonthDay(base, month, dayNumber) : null;
        if (date) { dueDate = iso(date); take(enDate); }
      } else if (slashDate) {
        const date = upcomingMonthDay(base, Number(slashDate[1]), Number(slashDate[2]));
        if (date) { dueDate = iso(date); take(slashDate); }
      }
    }

    // Times: 下午3点半, 3点15分, 晚上8点, 3pm, 9:30am, 15:30, at 9.
    const clock = title.match(new RegExp(`(上午|下午|晚上|中午|早上|傍晚|凌晨)?\\s*(${ZH_NUM})[点時时](半|一刻|三刻|${ZH_NUM}分?)?`));
    const western = !clock && (title.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) || title.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/) || title.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/i));
    if (clock || western) {
      let hour = clock ? number(clock[2]) : Number(western[1]);
      const minuteText = clock ? clock[3] : western[2];
      const minute = clock
        ? minuteText === "半" ? 30 : minuteText === "一刻" ? 15 : minuteText === "三刻" ? 45 : minuteText ? number(minuteText.replace("分", "")) : 0
        : Number(minuteText || 0);
      const period = clock ? clock[1] || "" : (western[3] || "").toLowerCase();
      const twelveHour = /上午|早上|下午|晚上|中午|傍晚|凌晨|am|pm/.test(period) || evening || (!period && !clock && /\bat\s/i.test(western[0]) && hour <= 12);
      if (Number.isInteger(hour) && hour >= 0 && hour <= (twelveHour ? 12 : 23) && minute >= 0 && minute <= 59) {
        if ((/下午|晚上|傍晚|pm/.test(period) || (evening && !period)) && hour < 12) hour += 12;
        if (/中午/.test(period) && hour < 6) hour += 12;
        if (/上午|早上|凌晨|am/.test(period) && hour === 12) hour = 0;
        dueTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
        take(clock || western);
      }
    } else if (evening && dueDate) {
      dueTime = null; // "tonight" alone keeps the day without inventing a time
    }

    title = title.replace(/\s+/g, " ").trim();
    const found = dueDate || dueTime || Object.keys(result).length;
    if (!title || !found) return null;
    return { text: title, dueDate, dueTime, ...result };
  }

  /** Short, readable pieces of a parse result for the "Apply" suggestion. */
  function describe(result, t) {
    if (!result) return "";
    const parts = [result.dueDate, result.dueTime].filter(Boolean);
    const rule = result.repeat && global.DailySpaceTaskFields?.describeRepeat?.(result);
    if (rule) parts.push(t(rule.en, rule.zh));
    if (result.categoryName) parts.push(`@${result.categoryName}`);
    (result.tags || []).forEach((tag) => parts.push(`#${tag}`));
    if (result.priority === "high") parts.push(t("Important", "重要"));
    if (result.priority === "low") parts.push(t("Low priority", "低优先级"));
    return parts.join(" · ");
  }

  const api = { parse, describe, number };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (!global?.document) return;
  global.DailySpaceQuickTask = api;
  function boot() {
    const t = (en, zh) => global.DailySpaceI18n?.t(en, zh) || en;
    const categoryNames = () => {
      try { return (global.DailySpaceTodo?.getCategories?.() || []).map((category) => category.name); } catch (_) { return []; }
    };
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
      const current = () => parse(input.value, new Date(), { categories: categoryNames() });
      function update() {
        const result = !composing && current();
        suggestion.hidden = !result;
        suggestion.textContent = result ? `${t("Apply", "应用")} · ${describe(result, t)}` : "";
        // Extras applied earlier belong to the text they came from.
        if (!input.value.trim()) delete input.dataset.quickExtras;
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
        const result = current();
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
        const extras = {};
        for (const key of ["repeat", "repeatEvery", "repeatDays", "tags", "priority", "categoryName"]) if (result[key] !== undefined) extras[key] = result[key];
        if (phone) applyToPhoneEditor(input.form || document, extras);
        else if (Object.keys(extras).length) input.dataset.quickExtras = JSON.stringify(extras);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus({ preventScroll: true });
      });
      input.form?.addEventListener("submit", () => setTimeout(update, 0));
      mountVoice(input, phone, t);
    }
  }

  /**
   * Dictation with the browser's own speech recognition (Chrome, Edge, Safari).
   * What was said goes into the input, so the quick-add suggestion applies as usual.
   * Hidden where the browser has no speech recognition.
   */
  function mountVoice(input, phone, t) {
    const Recognition = global.SpeechRecognition || global.webkitSpeechRecognition;
    if (!Recognition) return;
    const mic = document.createElement("button");
    mic.type = "button";
    mic.className = "quick-task-voice";
    mic.dataset.i18nIgnore = "";
    mic.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
    const status = document.createElement("span");
    status.className = "quick-task-voice-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.dataset.i18nIgnore = "";
    const submit = input.form?.querySelector('button[type="submit"]');
    if (!phone && submit) { submit.before(mic); mic.after(status); }
    else {
      // Phone: the microphone sits inside the title field, at its trailing edge.
      const wrap = document.createElement("span");
      wrap.className = "quick-task-input-wrap";
      input.before(wrap);
      wrap.append(input, mic);
      wrap.after(status);
    }
    let recognition = null, prefix = "";
    const label = () => {
      const listening = Boolean(recognition);
      mic.setAttribute("aria-label", listening ? t("Stop dictation", "停止语音输入") : t("Dictate a task", "语音输入任务"));
      mic.title = mic.getAttribute("aria-label");
      mic.setAttribute("aria-pressed", String(listening));
      mic.classList.toggle("is-listening", listening);
    };
    function stop() { try { recognition?.stop(); } catch (_) { /* already stopped */ } }
    mic.addEventListener("click", () => {
      if (recognition) { stop(); return; }
      const zh = (global.DailySpaceI18n?.localeTag?.() || document.documentElement.lang || "").toLowerCase().startsWith("zh");
      recognition = new Recognition();
      recognition.lang = zh ? "zh-CN" : "en-US";
      recognition.interimResults = true;
      recognition.continuous = false;
      prefix = input.value.trim() ? `${input.value.trim()} ` : "";
      recognition.onresult = (event) => {
        let text = "";
        for (const result of event.results) text += result[0]?.transcript || "";
        input.value = `${prefix}${text.trim()}`;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      };
      let failed = false;
      recognition.onerror = (event) => {
        failed = true;
        status.textContent = event.error === "not-allowed" || event.error === "service-not-allowed"
          ? t("Microphone access is blocked for this site.", "此网站的麦克风权限已被关闭。")
          : event.error === "no-speech" ? t("Didn't catch that. Try again.", "没有听清，请再说一次。") : t("Dictation stopped.", "语音输入已停止。");
      };
      recognition.onend = () => { recognition = null; if (!failed) status.textContent = ""; label(); input.focus({ preventScroll: true }); };
      status.textContent = t("Listening…", "正在听…");
      try { recognition.start(); } catch (_) { recognition = null; status.textContent = t("Dictation is unavailable right now.", "暂时无法语音输入。"); }
      label();
    });
    input.addEventListener("input", () => { if (!recognition) status.textContent = ""; });
    global.addEventListener("daily-space-locale-changed", label);
    label();
  }
  /** The phone editor has real fields for every part, so fill them in place. */
  function applyToPhoneEditor(form, extras) {
    const set = (node, value) => { if (!node) return; node.value = value; node.dispatchEvent(new Event("change", { bubbles: true })); };
    if (extras.repeat) {
      document.getElementById("m-task-details")?.setAttribute("open", "");
      set(document.getElementById("m-task-repeat"), extras.repeat);
      queueMicrotask(() => {
        if (extras.repeatEvery) set(form.querySelector("[data-repeat-every]"), String(extras.repeatEvery));
        if (extras.repeatDays) form.querySelectorAll("[data-repeat-day]").forEach((box) => { box.checked = extras.repeatDays.includes(Number(box.value)); });
      });
    }
    if (extras.priority) set(form.querySelector("[data-task-priority]"), extras.priority);
    if (extras.tags) {
      const field = form.querySelector("[data-task-tags]");
      if (field) set(field, [...new Set([...field.value.split(/[,，、]+/).map((tag) => tag.trim()).filter(Boolean), ...extras.tags])].join(", "));
    }
    if (extras.categoryName) {
      const select = document.getElementById("m-task-category");
      const option = select && [...select.options].find((item) => item.textContent.toLocaleLowerCase() === extras.categoryName.toLocaleLowerCase());
      if (option) set(select, option.value);
    }
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window === "object" ? window : globalThis);
