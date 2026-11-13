(function () {
  const RECENT_PREFIX = 'dayfly-command-recent:';
  const owner = () => String(window.DailySpaceView?.owner?.() || 'guest').trim().toLowerCase();
  const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
  const KEYS = {
    todo: "todo-app-v2",
    planner: "planner-app-v1",
    calendar: "calendar-app-v1",
    tally: "tally-book-v1",
    travel: "travel-book-v1",
    notes: "dayfly-notes-v1",
  };

  const JUMPS = [
    { id: "jump-tools", label: "Toolbox", hint: "All your tools", href: "tools.html", aliases: ["tool", "tools", "toolbox", "工具", "工具箱"] },
    { id: "jump-notes", label: "Notes", hint: "Private notebook", href: "notes.html", aliases: ["notes", "笔记"] },
    { id: "jump-review", label: "Weekly review", hint: "Recorded progress", href: "review.html", aliases: ["review", "复盘"] },
    { id: "jump-today", label: "Workbench", hint: "Personal workspace", href: "todo.html#today", aliases: ["today", "todo", "workbench", "工作台", "今天"] },
    { id: "jump-calendar", label: "Calendar", hint: "Month", href: "calendar.html", aliases: ["calendar"] },
    { id: "jump-planner", label: "Projects", hint: "Boards", href: "planner.html", aliases: ["planner", "projects", "项目"] },
    { id: "jump-mail", label: "Mail", hint: "Inbox", href: "mail.html", aliases: ["mail", "inbox"] },
    { id: "jump-tally", label: "Tally book", hint: "Spend", href: "tally.html", aliases: ["tally", "money"] },
    { id: "jump-travel", label: "Travel", hint: "Trips", href: "travel.html", aliases: ["travel", "trip"] },
    { id: "jump-teamwork", label: "Teamwork", hint: "Notes", href: "teamwork.html", aliases: ["teamwork"] },
  ];
  const PAGE_ZH = {
    'jump-tools':['工具箱','全部工具'],'jump-notes':['笔记','私人笔记'],'jump-review':['每周复盘','查看实际进展'],
    'jump-today':['工作台','个人工作空间'],'jump-calendar':['日历','日程'],
    'jump-planner':['项目','看板'],'jump-mail':['邮箱','收件箱'],
    'jump-tally':['记账','消费记录'],'jump-travel':['旅行','行程'],'jump-teamwork':['协作','团队工具'],
  };
  function pages(){return JUMPS.map(item=>({...item,label:t(item.label,PAGE_ZH[item.id]?.[0]||item.label),hint:t(item.hint,PAGE_ZH[item.id]?.[1]||item.hint),aliases:[...item.aliases,...(PAGE_ZH[item.id]||[])],kind:'jump',group:'pages'}));}
  const ACTIONS = [
    { id:'action:new-task', command:'new-task', en:'Add task', zh:'新建任务', hintEn:'Open task entry', hintZh:'打开任务录入', page:'todo.html', aliases:['new','add','create','task','新建','添加','待办','任务'] },
    { id:'action:capture-inbox', command:'capture-inbox', en:'Capture to Inbox', zh:'记录到收集箱', hintEn:'Save an idea or link later', hintZh:'先记录想法或链接', page:'todo.html', aliases:['capture','inbox','idea','link','收集箱','记录','想法','链接'] },
    { id:'action:add-expense', command:'add-expense', en:'Add expense', zh:'记一笔消费', hintEn:'Open expense entry', hintZh:'打开消费录入', page:'tally.html', aliases:['add','new','expense','spend','money','记账','消费','支出'] },
    { id:'action:start-focus', command:'start-focus', en:'Start focus', zh:'开始专注', hintEn:'Choose a task and timer', hintZh:'选择任务和计时方式', page:'todo.html', aliases:['start','focus','timer','pomodoro','专注','计时','番茄'] },
    { id:'action:notes', command:'notes', en:'Open notes', zh:'打开笔记', hintEn:'Your private notebook', hintZh:'查看私人笔记', page:'notes.html', aliases:['note','notes','write','笔记','资料'] },
    { id:'action:templates', command:'templates', en:'Task templates', zh:'任务模板', hintEn:'Start from a saved template', hintZh:'从已保存的模板新建任务', page:'todo.html', aliases:['template','templates','模板'] },
    { id:'action:filters', command:'filters', en:'Filter tasks', zh:'筛选任务', hintEn:'Date, status and saved views', hintZh:'日期、状态和保存视图', page:'todo.html', aliases:['filter','views','priority','筛选','视图','优先级'] },
  ];

  function ready() {
    if (typeof window.DailySpaceWorkbenchPreferences?.ready === 'function') return window.DailySpaceWorkbenchPreferences.ready();
    if (typeof document !== 'undefined' && (document.documentElement?.dataset?.workspaceLocked === 'true' || document.documentElement?.dataset?.workspaceReady === 'false')) return false;
    return true;
  }

  function actions() {
    if (!ready()) return [];
    return ACTIONS.map(item => ({ id:item.id, command:item.command, label:t(item.en,item.zh), hint:t(item.hintEn,item.hintZh),
      href:`${item.page}?command=${encodeURIComponent(item.command)}`, aliases:item.aliases, kind:'action', group:'actions' }));
  }

  function read(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function hay() {
    return Array.from(arguments)
      .flat()
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function targetHref(page, focus, id, extra = {}) {
    const params = { focus, id, ...extra };
    return `${page}?${Object.entries(params).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`).join("&")}`;
  }

  function target() {
    const params = new URLSearchParams(window.location.search);
    const focus = params.get("focus") || "";
    if (!["todo", "reminder", "expense", "card", "trip", "note"].includes(focus)) return null;
    return { focus, id: (params.get("id") || "").slice(0, 200), board: (params.get("board") || "").slice(0, 200) };
  }

  function highlight(node) {
    if (!node) return;
    node.classList.add("workspace-target");
    node.scrollIntoView({ behavior: "instant", block: "center" });
    if (!node.hasAttribute("tabindex")) node.tabIndex = -1;
    node.focus({ preventScroll: true });
  }

  function missing() {
    const existing = document.getElementById("workspace-target-status");
    if (existing) return;
    const status = document.createElement("p");
    status.id = "workspace-target-status";
    status.className = "workspace-target-status";
    status.setAttribute("role", "status");
    status.textContent = window.DailySpaceI18n?.t("This item is no longer available. Search again to find another.", "这条内容已不存在，可以重新搜索。") || "This item is no longer available. Search again to find another.";
    document.querySelector("[data-page-header]")?.insertAdjacentElement("afterend", status);
  }

  function collectEntries() {
    if (!ready()) return [];
    const entries = [];
    const todo = read(KEYS.todo);
    const calendar = read(KEYS.calendar);
    const planner = read(KEYS.planner);
    const travel = read(KEYS.travel);
    const trips = Array.isArray(travel.trips) ? travel.trips : [];
    const reminders = Array.isArray(calendar.reminders) ? calendar.reminders : [];
    const cards = Object.values(planner.boards || {}).flatMap(board => Array.isArray(board?.entries) ? board.entries : []);
    (Array.isArray(todo.todos) ? todo.todos : []).forEach((item) => {
      if (!item || typeof item.text !== "string") return;
      if (item.sourceReminderId && reminders.some(reminder => reminder.id === item.sourceReminderId)) return;
      if (item.sourcePlannerId && cards.some(entry => entry.id === item.sourcePlannerId)) return;
      if (item.sourceTripId && trips.some(trip => trip.id === item.sourceTripId)) return;
      entries.push({
        id: `todo:${item.id}`,
        label: item.text,
        hint: item.completed ? "Todo · done" : item.dueDate ? `Todo · ${item.dueDate}` : "Todo",
        href: targetHref("todo.html", "todo", item.id),
        hay: hay(item.text, item.dueDate, item.dueTime),
      });
    });

    (Array.isArray(calendar.reminders) ? calendar.reminders : []).forEach((item) => {
      if (!item || typeof item.text !== "string") return;
      entries.push({
        id: `cal:${item.id}`,
        label: item.text,
        hint: item.date ? `Reminder · ${item.date}` : "Reminder",
        href: targetHref("calendar.html", "reminder", item.id),
        hay: hay(item.text, item.date, item.startTime),
      });
    });

    const boards = planner.boards && typeof planner.boards === "object" ? planner.boards : {};
    Object.keys(boards).forEach((plannerId) => {
      const board = boards[plannerId] || {};
      const workspace = (Array.isArray(planner.planners) ? planner.planners : []).find(
        (item) => item && item.id === plannerId
      );
      (Array.isArray(board.entries) ? board.entries : []).forEach((entry) => {
        if (!entry || typeof entry.title !== "string") return;
        entries.push({
          id: `planner:${entry.id}`,
          label: entry.title,
          hint: workspace && workspace.name ? `Planner · ${workspace.name}` : "Planner",
          href: targetHref("planner.html", "card", entry.id, { board: plannerId }),
          hay: hay(entry.title, entry.note, workspace && workspace.name),
        });
      });
    });

    const tally = read(KEYS.tally);
    (Array.isArray(tally.records) ? tally.records : []).forEach((record) => {
      if (!record || typeof record !== "object") return;
      const label = [record.category, record.note].filter(Boolean).join(" · ") || "Expense";
      entries.push({
        id: `tally:${record.id}`,
        label,
        hint: record.date ? `Tally · ${record.date}` : "Tally",
        href: targetHref("tally.html", "expense", record.id),
        hay: hay(record.category, record.note, record.date, record.amount),
      });
    });

    trips.forEach((trip) => {
      if (!trip || typeof trip.name !== "string") return;
      entries.push({
        id: `travel:${trip.id}`,
        label: trip.name,
        hint: trip.destination ? `Travel · ${trip.destination}` : "Travel",
        href: targetHref("travel.html", "trip", trip.id),
        hay: hay(trip.name, trip.destination, trip.startDate, trip.endDate),
      });
    });
    const notes = window.DailySpaceWorkbenchPreferences?.ready() === true ? read(KEYS.notes).notes : [];
    (Array.isArray(notes) ? notes : []).forEach(note => {
      if (!note || typeof note.id !== 'string' || typeof note.title !== 'string') return;
      entries.push({ id: `note:${note.id}`, label: note.title, hint: 'Notes',
        href: targetHref('notes.html', 'note', note.id),
        hay: hay(note.title, note.body, ...(Array.isArray(note.tags) ? note.tags : []), note.sourceUrl),
      });
    });
    for (const bookmark of window.DailySpaceWorkbenchPreferences?.searchBookmarks?.('') || []) {
      entries.push({ id:`bookmark:${bookmark.id}`,label:bookmark.title,hint:bookmark.group||'Website',href:bookmark.url,
        external:true,hay:hay(bookmark.title,bookmark.url,bookmark.group,...bookmark.tags) });
    }
    return entries;
  }

  function matches(item, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    const blob = hay(item.label, item.hint, item.hay, ...(item.aliases || []));
    return blob.includes(q);
  }

  function searchWorkspace(query, limit) {
    const capped = Math.max(1, Math.min(20, Number(limit) || 12));
    const q = String(query || "").trim();
    const jumps = pages().filter((item) => matches(item, q));
    const commands = actions().filter(item => matches(item,q));
    if (!q) return [...jumps,...commands].slice(0,capped);
    const content = collectEntries()
      .filter((item) => matches(item, q))
      .slice(0, capped)
      .map((item) => ({ ...item, kind: "item", group:'records' }));
    return [...jumps, ...content, ...commands].slice(0, capped);
  }

  function resolve(id) {
    if (!ready() || typeof id !== 'string') return null;
    const page=pages().find(item=>item.id===id);if(page)return page;
    const action=actions().find(item=>item.id===id);if(action)return action;
    const record=collectEntries().find(item=>item.id===id);return record?{...record,kind:'item',group:'records'}:null;
  }
  function recent(limit=5) {
    if(!ready())return[];
    try {
      const ids=JSON.parse(sessionStorage.getItem(RECENT_PREFIX+owner())||'null');
      if(!Array.isArray(ids))return[];
      return [...new Set(ids.filter(id=>typeof id==='string'))].slice(0,8).map(resolve).filter(Boolean).slice(0,Math.max(0,Math.min(8,Number(limit)||5)));
    } catch(_){return[];}
  }
  function remember(entry) {
    const current=resolve(typeof entry==='string'?entry:entry?.id);if(!current)return false;
    try {
      // Store identities only. Renames/deletions and account boundaries are
      // reflected by resolving each entry from its current private store.
      sessionStorage.setItem(RECENT_PREFIX+owner(),JSON.stringify([current.id,...recent(8).map(item=>item.id).filter(id=>id!==current.id)].slice(0,8)));
      return true;
    }catch(_){return false;}
  }

  window.DailySpaceSearch = {
    search: searchWorkspace,
    collectEntries,
    target,
    highlight,
    missing,
    JUMPS,
    ready,
    actions,
    resolve,
    recent,
    remember,
  };
})();
