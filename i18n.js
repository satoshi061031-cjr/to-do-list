(function () {
  const STORAGE_KEY = "daily-space-language-v1";
  const SUPPORTED = new Set(["en", "zh"]);
  const originalText = new WeakMap();
  const translatedText = new WeakMap();
  const originalAttributes = new WeakMap();
  const translatedAttributes = new WeakMap();
  let originalTitle = "";

  const ZH = {
    "A new era of focus is here.": "专注的新纪元已经到来。",
    "A new era of": "专注的新纪元",
    "focus is here.": "已经到来。",
    "Meet Daily Space.": "认识 Daily Space。",
    "Your personal productivity space.": "你的个人效率空间。",
    "Continue with Google": "使用 Google 继续",
    "Continue with Outlook": "使用 Outlook 继续",
    "Enter Daily Space": "进入 Daily Space",
    "Swipe up to enter": "向上滑动进入",
    Pages: "页面",
    Categories: "分类",
    Planners: "计划空间",
    "To-do list": "待办清单",
    Planner: "计划",
    Calendar: "日历",
    "Tally book": "记账本",
    "Tally Book": "记账本",
    Teamwork: "团队协作",
    Mail: "邮箱",
    Add: "添加",
    "This month": "本月",
    Today: "今天",
    Mon: "周一",
    Tue: "周二",
    Wed: "周三",
    Thu: "周四",
    Fri: "周五",
    Sat: "周六",
    Sun: "周日",
    Mo: "一",
    Tu: "二",
    We: "三",
    Th: "四",
    Fr: "五",
    Sa: "六",
    Su: "日",
    "Quiet tasks for today—check them off when done.": "安静地安排今天，完成后逐项勾选。",
    "Pick a date…": "选择日期…",
    "Clear completed": "清除已完成",
    "Clear day": "清除日期筛选",
    "No tasks yet—add your first one above.": "还没有任务，在上方添加第一项吧。",
    "All caught up": "全部完成",
    "No active tasks.": "没有进行中的任务。",
    "No completed tasks yet.": "还没有已完成的任务。",
    "No tasks in this category.": "这个分类中还没有任务。",
    "No tasks due on this day.": "当天没有到期任务。",
    "All tasks": "全部任务",
    "+ New category": "+ 新建分类",
    "+ New planner": "+ 新建计划空间",
    "← Back": "← 返回",
    All: "全部",
    Active: "进行中",
    Done: "已完成",
    "New category": "新建分类",
    "New planner": "新建计划空间",
    "Add column": "添加分栏",
    "+ Add column": "+ 添加分栏",
    "+ Add entry": "+ 添加卡片",
    "Selected day": "已选日期",
    "Add reminder": "添加提醒",
    Start: "开始",
    End: "结束",
    Priority: "优先级",
    High: "高",
    Medium: "中",
    Low: "低",
    Reminders: "提醒",
    "Active tasks": "进行中的任务",
    "Unscheduled active tasks": "未安排日期的任务",
    Expense: "支出",
    Budget: "预算",
    Monthly: "每月",
    Week: "本周",
    "Spent this week": "本周支出",
    Transactions: "交易记录",
    "this month": "本月",
    "Monthly budget": "月度预算",
    "Currency symbol": "货币符号",
    "New transaction": "新交易",
    "Add transaction": "添加交易",
    Date: "日期",
    Yesterday: "昨天",
    "Add expense": "添加支出",
    "Daily expense": "每日支出",
    "No expense data yet.": "还没有支出数据。",
    "No note": "无备注",
    "No expenses for this day.": "当天没有支出。",
    "No expenses this month.": "本月还没有支出。",
    "Page label": "页面标签",
    Title: "标题",
    Description: "描述",
    "Status label": "状态标签",
    "Main status": "主要状态",
    "Status note": "状态说明",
    "Card label": "卡片标签",
    "Card title": "卡片标题",
    "Card content": "卡片内容",
    Notes: "备注",
    "Section label": "区域标签",
    "Section title": "区域标题",
    "Connect your inboxes": "连接你的邮箱",
    "Connected accounts": "已连接账户",
    "No mailbox connected yet": "尚未连接邮箱",
    Authorize: "授权",
    "Sign in to your mailbox": "登录你的邮箱",
    "Sign in with Google": "使用 Google 登录",
    "Sign in with Outlook": "使用 Outlook 登录",
    Accounts: "账户",
    "Authorized mailboxes": "已授权邮箱",
    "No accounts yet. Choose a provider above to begin.": "尚无账户，请在上方选择服务商开始连接。",
    "Add Gmail, Outlook, iCloud, or another mailbox so your workflow can include mail context.":
      "连接 Gmail、Outlook、iCloud 或其他邮箱，让工作流程也能使用邮件信息。",
    "Gmail/Outlook use real OAuth. iCloud uses real IMAP verification with your Apple app-specific password.":
      "Gmail 和 Outlook 使用 OAuth；iCloud 使用 Apple 专用密码进行 IMAP 验证。",
    Dark: "深色",
    Light: "浅色",
    Account: "账户",
    "Sign in": "登录",
    "Sign out": "退出登录",
    "Phone number": "手机号码",
    "Google, Outlook, phone": "Google、Outlook、手机",
    Continue: "继续",
    OR: "或",
    Sync: "同步",
    Upload: "上传",
    Download: "下载",
    Never: "从未",
    "Last sync: Never": "上次同步：从未",
    Guest: "访客",
    "Daily Space Agent": "Daily Space 助手",
    Send: "发送",
    "Works across Todo, Planner, Calendar, Tally and Teamwork.": "可操作待办、计划、日历、记账和团队协作。",
    "Working…": "处理中…",
    "Cancelled. No changes were applied.": "已取消，没有应用任何更改。",
    "No reminders on this day.": "当天没有提醒。",
    "Every active task has a due date.": "所有进行中的任务都已设置日期。",
    "Add columns, then add cards below each title.": "先添加分栏，再在每个标题下添加卡片。",
    "My planner": "我的计划",
    "New column": "新分栏",
    Member: "成员",
    Unnamed: "未命名",
    "Add task...": "添加任务…",
    "Continue with a provider to keep your workspace synced.": "选择服务商登录，以保持工作空间同步。",
    "OAuth needs a backend or auth service before these providers can become real sign-ins.":
      "OAuth 需要后端或认证服务才能完成真实登录。",
  };

  const ATTR_ZH = {
    Menu: "菜单",
    "+ New category": "+ 新建分类",
    "+ New planner": "+ 新建计划空间",
    "Sign in Google, Outlook, phone": "登录：Google、Outlook 或手机",
    "Sync code": "同步代码",
    "sync code (e.g. team-2026)": "同步代码（例如 team-2026）",
    "Upload illustration": "上传插图",
    "Delete illustration": "删除插图",
    "New task": "新任务",
    "Due date": "截止日期",
    "Clear due date": "清除截止日期",
    "Mark as done": "标记为已完成",
    "Mark as active": "标记为进行中",
    "Delete task": "删除任务",
    "User greeting": "用户问候",
    "Header illustration": "头部插图",
    "To-do tasks": "待办任务",
    "Member role": "成员角色",
    "Mark task as done": "将任务标记为已完成",
    "Month calendar": "月历",
    "Monthly summary": "月度汇总",
    "Expense calendar": "支出日历",
    "Daily expense chart": "每日支出图表",
    "Expense records": "支出记录",
    "Teamwork overview": "团队协作概览",
    "Quick authorization": "快捷授权",
    "Close agent": "关闭助手",
    "Add a task…": "添加任务…",
    "Category name": "分类名称",
    "Planner name": "计划空间名称",
    "Reminder text...": "提醒内容…",
    Amount: "金额",
    Category: "分类",
    Note: "备注",
    "Member name": "成员姓名",
    Role: "角色",
    "Add task...": "添加任务…",
    "Add a task, expense, reminder...": "添加任务、支出或提醒…",
    "Previous month": "上个月",
    "Next month": "下个月",
    "Switch to dark mode": "切换到深色模式",
    "Switch to light mode": "切换到浅色模式",
    "Open Daily Space Agent": "打开 Daily Space 助手",
    "Close Daily Space Agent": "关闭 Daily Space 助手",
    "Message for Daily Space Agent": "给 Daily Space 助手发送消息",
    "Delete record": "删除记录",
    "Add reminder": "添加提醒",
    "Budget settings": "预算设置",
    "Month navigation": "月份导航",
    "Return to this month": "返回本月",
    "Weekly expense summary": "每周支出汇总",
    "Close add expense": "关闭添加支出",
    "Coffee, groceries...": "咖啡、杂货…",
    "Optional note": "可选备注",
  };

  const PATTERNS_ZH = [
    [/^Good morning,\s*Guest$/i, "早上好，访客"],
    [/^Good afternoon,\s*Guest$/i, "下午好，访客"],
    [/^Good evening,\s*Guest$/i, "晚上好，访客"],
    [/^Good morning,\s*(.+)$/i, "早上好，$1"],
    [/^Good afternoon,\s*(.+)$/i, "下午好，$1"],
    [/^Good evening,\s*(.+)$/i, "晚上好，$1"],
    [/^All tasks\s+(\d+)$/i, "全部任务 $1"],
    [/^(\d+) tasks? left$/i, "剩余 $1 项任务"],
    [/^(\d+) tasks?$/i, "$1 项任务"],
    [/^(\d+) completed · (\d+) open$/i, "已完成 $1 项 · 进行中 $2 项"],
    [/^(.+) · Add columns, then add cards below each title\.$/i, "$1 · 先添加分栏，再在每个标题下添加卡片。"],
    [/^(\d+) records? · (\d+)% of budget used$/i, "$1 条记录 · 已使用预算 $2%"],
    [/^(.+) remaining · (.+) spent$/i, "剩余 $1 · 已支出 $2"],
    [/^(\d+) reminders? · (\d+) active tasks?$/i, "$1 个提醒 · $2 项进行中任务"],
    [
      /^(\d+) reminders? · (\d+) scheduled active tasks? · (\d+) active total$/i,
      "$1 个提醒 · $2 项已安排 · 共 $3 项进行中",
    ],
    [/^Starts (.+)$/i, "开始于 $1"],
    [/^Due (.+)$/i, "截止 $1"],
    [/^High priority$/i, "高优先级"],
    [/^Medium priority$/i, "中优先级"],
    [/^Low priority$/i, "低优先级"],
    [/^\+(\d+) more$/i, "还有 $1 项"],
    [/^Last sync:\s*(.+)$/i, "上次同步：$1"],
    [/^Applied (\d+) change\(s\)\.$/i, "已应用 $1 项更改。"],
    [/^View tasks due (.+)$/i, "查看 $1 到期的任务"],
    [/^(.+)\. (\d+) reminders?, (\d+) active tasks?\.$/i, "$1，$2 个提醒，$3 项进行中任务。"],
    [/^Delete category (.+)$/i, "删除分类 $1"],
    [/^Delete planner (.+)$/i, "删除计划空间 $1"],
    [/^Planner (.+)$/i, "计划 $1"],
    [/^Delete reminder$/i, "删除提醒"],
    [/^Delete record$/i, "删除记录"],
    [/^Delete member (.+)$/i, "删除成员 $1"],
    [/^Delete (.+)$/i, "删除 $1"],
    [/^(\d+) records?$/i, "$1 条记录"],
    [/^Cloud sync:\s*(.+)$/i, "云同步：$1"],
    [/^(.+) connected$/i, "已连接 $1"],
    [/^Task for (.+)$/i, "$1 的任务"],
  ];

  function locale() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED.has(saved) ? saved : "en";
  }

  function localeTag() {
    return locale() === "zh" ? "zh-CN" : "en-US";
  }

  function translateString(value, attribute) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return value;
    const translatedExact = (attribute && ATTR_ZH[trimmed]) || ZH[trimmed];
    if (translatedExact) return String(value).replace(trimmed, translatedExact);
    for (const [pattern, replacement] of PATTERNS_ZH) {
      if (pattern.test(trimmed)) return String(value).replace(trimmed, trimmed.replace(pattern, replacement));
    }
    return value;
  }

  function ignored(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(
      element &&
        element.closest(
          "[data-i18n-ignore], .todo-agent-msg-user, .todo-text, .todo-item-text, .tally-record-category, .tally-record-note"
        )
    );
  }

  function translateTextNode(node) {
    if (ignored(node) || !node.nodeValue || !node.nodeValue.trim()) return;
    const current = node.nodeValue;
    if (locale() === "en") {
      if (originalText.has(node)) node.nodeValue = originalText.get(node);
      translatedText.delete(node);
      return;
    }
    if (translatedText.get(node) !== current) originalText.set(node, current);
    const source = originalText.get(node) || current;
    const translated = translateString(source, false);
    if (translated !== current) node.nodeValue = translated;
    translatedText.set(node, translated);
  }

  function translateElementAttributes(element) {
    if (ignored(element)) return;
    const attributes = ["placeholder", "aria-label", "title"];
    let originals = originalAttributes.get(element);
    let translatedValues = translatedAttributes.get(element);
    if (!originals) {
      originals = {};
      originalAttributes.set(element, originals);
    }
    if (!translatedValues) {
      translatedValues = {};
      translatedAttributes.set(element, translatedValues);
    }
    attributes.forEach((name) => {
      if (!element.hasAttribute(name)) return;
      const current = element.getAttribute(name) || "";
      if (
        !Object.prototype.hasOwnProperty.call(originals, name) ||
        (translatedValues[name] !== undefined && current !== translatedValues[name])
      ) {
        originals[name] = current;
      }
      const desired = locale() === "zh" ? translateString(originals[name], true) : originals[name];
      if (desired !== current) element.setAttribute(name, desired);
      translatedValues[name] = desired;
    });
  }

  function apply(root) {
    document.documentElement.lang = locale() === "zh" ? "zh-CN" : "en";
    if (!originalTitle) originalTitle = document.title;
    document.title = locale() === "zh" ? translateString(originalTitle, false) : originalTitle;
    const target = root || document.body;
    if (!target) return;
    if (target.nodeType === Node.TEXT_NODE) {
      translateTextNode(target);
      return;
    }
    if (target.nodeType === Node.ELEMENT_NODE) translateElementAttributes(target);
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
      else translateElementAttributes(node);
      node = walker.nextNode();
    }
    updateToggle();
  }

  function updateToggle() {
    const button = document.getElementById("language-toggle");
    if (!button) return;
    const isZh = locale() === "zh";
    button.textContent = isZh ? "EN" : "中文";
    button.setAttribute("aria-label", isZh ? "Switch to English" : "切换到中文");
    button.setAttribute("title", isZh ? "Switch to English" : "切换到中文");
  }

  function setLocale(next) {
    if (!SUPPORTED.has(next) || next === locale()) return;
    localStorage.setItem(STORAGE_KEY, next);
    apply(document.body);
    window.dispatchEvent(new CustomEvent("daily-space-locale-changed", { detail: { locale: next } }));
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => apply(document.body)));
  }

  function setupToggle() {
    const page = window.location.pathname.split("/").pop() || "index.html";
    if (page !== "todo.html" || document.getElementById("language-toggle")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.id = "language-toggle";
    button.className = "language-toggle";
    button.dataset.i18nIgnore = "true";
    button.addEventListener("click", () => setLocale(locale() === "zh" ? "en" : "zh"));
    document.body.appendChild(button);
    updateToggle();
  }

  function observe() {
    const observer = new MutationObserver((mutations) => {
      if (locale() !== "zh") return;
      mutations.forEach((mutation) => {
        if (mutation.type === "characterData") translateTextNode(mutation.target);
        mutation.addedNodes.forEach((node) => apply(node));
        if (mutation.type === "attributes") translateElementAttributes(mutation.target);
      });
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["placeholder", "aria-label", "title"],
    });
  }

  window.DailySpaceI18n = {
    locale,
    localeTag,
    setLocale,
    apply,
  };

  document.addEventListener("DOMContentLoaded", () => {
    setupToggle();
    apply(document.body);
    observe();
  });
})();
