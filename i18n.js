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
    "Your workspace for personal focus and team assignment.": "兼顾个人专注与团队分派的工作空间。",
    "Continue with Google": "使用 Google 继续",
    "Continue with Outlook": "使用 Outlook 继续",
    "Continue with WeChat": "使用微信继续",
    "Enter Daily Space": "进入 Daily Space",
    "Swipe up to enter": "向上滑动进入",
    "Swipe up to continue": "向上滑动继续",
    "Move to the left edge to open the menu": "移到左边缘即可打开菜单",
    "Google or Outlook": "Google 或 Outlook",
    "Google, Outlook, or WeChat": "Google、Outlook 或微信",
    "Add cover": "添加封面",
    "On this device": "仅本机",
    "Device only": "仅本机",
    "Private notes": "私人备注",
    "Never synced to workspace members": "不会同步给工作空间成员",
    "This block stays on this device. For real collaboration use the workspace above and Planner team boards.": "此区域只保存在本机。真正协作请用上方工作空间和 Planner 团队看板。",
    "Spent today": "今日支出",
    "Private scratchpad": "私人草稿本",
    "Not shared with workspace members — local notes only": "不会同步给工作空间成员 — 仅本机备注",
    "Delete category": "删除分类",
    Pages: "页面",
    Categories: "分类",
    Planners: "计划空间",
    Todo: "待办",
    Plan: "计划",
    Cal: "日历",
    Tally: "记账",
    Team: "团队",
    Mail: "邮件",
    Pages: "页面",
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
    "Focus today": "专注今天",
    "Due today": "今日到期",
    Overdue: "已逾期",
    Assigned: "已指派",
    "Nothing due today.": "今天没有到期任务。",
    "All caught up for today.": "今天的任务都完成了。",
    "Open calendar": "打开日历",
    "Today summary": "今日概览",
    "Daily loop": "今日循环",
    "Inbox digest": "收件箱摘要",
    Refresh: "刷新",
    "Add as today’s task": "加为今日任务",
    "Add as today's task": "加为今日任务",
    "Open Today in Todo": "在待办中打开今天",
    "Add a task for this day": "为这一天添加任务",
    "Add a task for this day…": "为这一天添加任务…",
    "Due soon": "即将到期",
    "This week": "本周",
    None: "无",
    "Pull your inbox, get a short digest, and turn mail into today’s tasks.": "主动拉取邮箱、生成摘要，并把邮件变成今天的任务。",
    "Pull your inbox, get a short digest, and turn mail into today's tasks.": "主动拉取邮箱、生成摘要，并把邮件变成今天的任务。",
    "Evening review": "晚间回顾",
    "How did today go?": "今天过得怎么样？",
    "Today so far": "今天目前",
    "Today looks clear.": "今天看起来清爽。",
    "Nice — due today is done and nothing is overdue.": "很好 — 今日到期已完成，也没有逾期。",
    "No due-today tasks yet — add one above if you want a light close.": "还没有今日到期任务 — 想轻量收尾的话，在上方加一项。",
    "Focus remaining": "处理剩余",
    "Enable reminder alerts": "开启提醒通知",
    "Reminder alerts on": "提醒通知已开启",
    "Alerts blocked in browser": "浏览器已拦截通知",
    "Nothing due": "暂无到期",
    "Sign in to Daily Space first": "请先登录 Daily Space",
    "Sign in to Daily Space": "登录 Daily Space",
    "Connect your mailbox": "连接邮箱",
    "Mail digest needs a Daily Space account. Sign in, then connect Gmail or Outlook.": "邮件摘要需要先登录 Daily Space。登录后再连接 Gmail 或 Outlook。",
    "Connect Gmail or Outlook to pull recent mail and build today’s digest.": "连接 Gmail 或 Outlook，拉取最近邮件并生成今日摘要。",
    "Connect Gmail or Outlook to pull recent mail and build today's digest.": "连接 Gmail 或 Outlook，拉取最近邮件并生成今日摘要。",
    "Sign in to Daily Space to pull your inbox.": "登录 Daily Space 后即可拉取收件箱。",
    "No mailbox yet — connect Gmail or Outlook below.": "还没有邮箱 — 请在下方连接 Gmail 或 Outlook。",
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
    "+ Add card": "+ 添加卡片",
    "Start with a column": "先添加一个分栏",
    "Columns hold cards. Add one to begin organizing this board.": "分栏用来放卡片。先加一个分栏开始整理。",
    "Shared columns hold assignable cards. Add a column to begin.": "共享分栏里可以放可指派的卡片。先加一个分栏开始。",
    Column: "分栏",
    "Move to column": "移动到分栏",
    "Column icon": "分栏图标",
    "Remove card": "删除卡片",
    "Team board": "团队看板",
    "Selected day": "已选日期",
    "Tasks due this day": "当天到期任务",
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
    "No reminders on this day.": "当天没有提醒。",
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
    Connect: "连接",
    Inbox: "收件箱",
    Settings: "设置",
    "Recent messages will show up here.": "最近的邮件会出现在这里。",
    "Your recent messages": "你的最近邮件",
    "Sign in to your mailbox": "登录你的邮箱",
    "Sign in with Google": "使用 Google 登录",
    "Sign in with Outlook": "使用 Outlook 登录",
    "Sign in with WeChat": "使用微信登录",
    "Recent messages": "最近邮件",
    "Manage mailboxes": "管理邮箱",
    "Gmail and Outlook use OAuth to authorize this device.": "Gmail 和 Outlook 使用 OAuth 授权此设备。",
    "Loading messages…": "正在加载邮件…",
    "No recent inbox messages.": "暂无最近收件。",
    "Mailbox disconnected.": "邮箱已断开。",
    Disconnect: "断开连接",
    "(No subject)": "（无主题）",
    "Unknown sender": "未知发件人",
    "Unknown time": "未知时间",
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
    Never: "从未",
    Guest: "访客",
    "Daily Space Agent": "Daily Space 助手",
    Send: "发送",
    "Works across Todo, Planner, Calendar, Tally and Teamwork.": "可操作待办、计划、日历、记账和团队协作。",
    "Working…": "处理中…",
    "Cancelled. No changes were applied.": "已取消，没有应用任何更改。",
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
    "Name this space…": "给这个空间起个名字…",
    "One quiet sentence about the team…": "用一句话安静地介绍这个团队…",
    "This week’s focus…": "本周重点…",
    "What matters most right now…": "此刻最重要的事…",
    "Shared notes for the team…": "写给团队的共享备注…",
    "Add teammates to start assigning work.": "添加成员后，就可以开始分配任务。",
    Workspace: "工作空间",
    "Shared team space": "共享团队空间",
    "Create or join a workspace to invite people. Your personal draft below stays on this device.":
      "创建或加入工作空间以邀请成员。下方的个人草稿仍保存在本设备。",
    "Sign in to create a shared workspace. Personal planning below still works without an account.":
      "登录后可创建共享工作空间；下方个人规划无需账号也能继续使用。",
    "Workspace name": "工作空间名称",
    "Create workspace": "创建工作空间",
    "Active workspace": "当前工作空间",
    "Personal draft · saved on this device and in your cloud snapshot":
      "个人草稿 · 保存在本设备，并同步到你的云快照",
    "Local-only names for personal planning. Invite real accounts above to collaborate.":
      "仅用于个人规划的本机名字。要协作请在上方邀请真实账号。",
    "Copy invite link": "复制邀请链接",
    "Invite link copied.": "邀请链接已复制。",
    Invite: "邀请",
    Members: "成员",
    "No members yet.": "暂无成员。",
    "Local members": "本机成员",
    "Invite people, then assign work from Planner team boards.": "邀请成员，然后在 Planner 团队看板上分派工作。",
    "Sign in to create or join a shared workspace.": "登录后即可创建或加入共享工作空间。",
    "Local draft": "本机草稿",
    "Optional notes and local-only names on this device": "可选备注与仅本机的名字",
    "New workspace": "新建工作空间",
    "From Planner → Team boards.": "来自 Planner → Team boards。",
    "Add local names for personal planning only.": "仅添加用于个人规划的本机名字。",
    Personal: "个人",
    "Assigned to me": "指派给我",
    "Shared tasks assigned to you from Planner team boards.": "来自 Planner 团队看板、指派给你的共享任务。",
    "Sign in to see tasks assigned to you.": "登录后即可查看指派给你的任务。",
    "Loading assigned tasks…": "正在加载指派任务…",
    "No open assignments. Assign cards to yourself in Planner → Team boards.":
      "暂无未完成分派。在 Planner → Team boards 把卡片指派给自己。",
    "Loading…": "加载中…",
    Notifications: "通知",
    "Mark all read": "全部标为已读",
    "No notifications yet.": "暂无通知。",
    Notification: "通知",
    "just now": "刚刚",
    owner: "所有者",
    admin: "管理员",
    member: "成员",
    Member: "成员",
    Admin: "管理员",
    Owner: "所有者",
    "Your role: owner": "你的角色：所有者",
    "Your role: admin": "你的角色：管理员",
    "Your role: member": "你的角色：成员",
    Remove: "移除",
    Revoke: "撤销",
    "Leave workspace": "离开工作空间",
    "Delete workspace": "删除工作空间",
    "Copy invite link": "复制邀请链接",
    "+ New team board": "+ 新建团队看板",
    "No team boards yet. Create one below.": "还没有团队看板。在下方创建一个。",
    "No team boards yet. Ask an owner or admin to create one.":
      "还没有团队看板。请让所有者或管理员创建。",
    "Invite link copied.": "邀请链接已复制。",
    "Invite revoked.": "邀请已撤销。",
    "Member removed.": "成员已移除。",
    "Role updated.": "角色已更新。",
    Workspace: "工作空间",
    "Team boards": "团队看板",
    Assignments: "分派",
    "Open cards live on the shared Planner team board.": "打开的卡片在 Planner 共享看板上。",
    "Assignments come from Planner → Team boards (not the personal planner, and not local members below).":
      "分派来自 Planner → Team boards（不是个人看板，也不是下方本机成员）。",
    "No shared board tasks yet": "共享看板还没有任务",
    "Open Planner → Team boards, add a card, then pick an assignee.":
      "打开 Planner → Team boards，添加卡片并选择负责人。",
    Unassigned: "未指派",
    "No open assignments": "暂无未完成分派",
    "Sign in and create a workspace in Teamwork to open shared boards.":
      "登录并在 Teamwork 创建工作空间后，即可打开共享看板。",
    "Create a workspace in Teamwork to unlock shared boards.": "在 Teamwork 创建工作空间后即可解锁共享看板。",
    "Shared board · assign people on each card.": "共享看板 · 可在卡片上指派成员。",
    "Due date": "截止日期",
    Assignee: "负责人",
    "Loading board…": "正在加载看板…",
    "Team board": "团队看板",
    "New card": "新卡片",
    "Nothing blocking": "暂无阻塞",
    Aligned: "已对齐",
  };

  const ATTR_ZH = {
    Menu: "菜单",
    "+ New category": "+ 新建分类",
    "+ New planner": "+ 新建计划空间",
    "Sign in Google, Outlook, phone": "登录：Google、Outlook 或手机",
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
    "Add another mailbox": "添加其他邮箱",
    Mailboxes: "邮箱账户",
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
    "Name this space…": "给这个空间起个名字…",
    "One quiet sentence about the team…": "用一句话安静地介绍这个团队…",
    "This week’s focus…": "本周重点…",
    "What matters most right now…": "此刻最重要的事…",
    "Shared notes for the team…": "写给团队的共享备注…",
    "Nothing blocking": "暂无阻塞",
    Aligned: "已对齐",
  };

  const PATTERNS_ZH = [
    [/^Good morning,\s*Guest$/i, "早上好，访客"],
    [/^Good noon,\s*Guest$/i, "中午好，访客"],
    [/^Good afternoon,\s*Guest$/i, "下午好，访客"],
    [/^Good evening,\s*Guest$/i, "晚上好，访客"],
    [/^Good morning,\s*(.+)$/i, "早上好，$1"],
    [/^Good noon,\s*(.+)$/i, "中午好，$1"],
    [/^Good afternoon,\s*(.+)$/i, "下午好，$1"],
    [/^Good evening,\s*(.+)$/i, "晚上好，$1"],
    [/^Your role:\s*(.+)$/i, "你的角色：$1"],
    [/^Invite created for (.+)\.$/i, "已为 $1 创建邀请。"],
    [/^Joined (.+)\.$/i, "已加入 $1。"],
    [/^Created (.+)\.$/i, "已创建 $1。"],
    [/^Left (.+)\.$/i, "已离开 $1。"],
    [/^Deleted (.+)\.$/i, "已删除 $1。"],
    [/^Delete category “(.+)”\? Tasks in it stay, without a category\.$/i, "删除分类「$1」？其中的任务会保留，但不再属于该分类。"],
    [/^Delete planner “(.+)”\?$/i, "删除计划空间「$1」？"],
    [/^Delete column “(.+)”\?$/i, "删除分栏「$1」？"],
    [/^All tasks\s+(\d+)$/i, "全部任务 $1"],
    [/^(.+) assigned you a task$/i, "$1 给你指派了任务"],
    [/^"(.+)" on (.+) · (.+)$/i, "「$1」· $2 · $3"],
    [/^Notifications,\s*(\d+) unread$/i, "通知，$1 条未读"],
    [/^(\d+)m ago$/i, "$1 分钟前"],
    [/^(\d+)h ago$/i, "$1 小时前"],
    [/^(\d+)d ago$/i, "$1 天前"],
    [/^(\d+) tasks? left$/i, "剩余 $1 项任务"],
    [/^(\d+) tasks?$/i, "$1 项任务"],
    [/^(\d+) completed · (\d+) open$/i, "已完成 $1 项 · 进行中 $2 项"],
    [/^(.+) · Add columns, then add cards below each title\.$/i, "$1 · 先添加分栏，再在每个标题下添加卡片。"],
    [/^(.+) · Add a column, then put cards inside it\.$/i, "$1 · 先添加分栏，再把卡片放进去。"],
    [/^(.+) · Add cards under each column\.$/i, "$1 · 在每个分栏下添加卡片。"],
    [/^(.+) · Shared board · add a column, then cards with assignees\.$/i, "$1 · 共享看板 · 先加分栏，再添加可指派卡片。"],
    [/^(.+) · Shared board · add cards and assign people\.$/i, "$1 · 共享看板 · 添加卡片并指派成员。"],
    [/^Team · (.+)$/i, "团队 · $1"],
    [/^(.+) · (\d+) completed · (\d+) open$/i, "$1 · 已完成 $2 项 · 进行中 $3 项"],
    [/^(\d+) records? · (\d+)% of budget used$/i, "$1 条记录 · 已使用预算 $2%"],
    [/^(.+) remaining · (.+) spent$/i, "剩余 $1 · 已支出 $2"],
    [/^(\d+) reminders? · (\d+) active tasks?$/i, "$1 个提醒 · $2 项进行中任务"],
    [
      /^(\d+) reminders? · (\d+) scheduled active tasks? · (\d+) active total$/i,
      "$1 个提醒 · $2 项已安排 · 共 $3 项进行中",
    ],
    [/^(\d+) tasks? due · (\d+) reminders?$/i, "$1 项到期任务 · $2 个提醒"],
    [/^Done today (\d+) \/ (\d+)$/i, "今日完成 $1 / $2"],
    [/^(\d+) today · (\d+) this week$/i, "今天 $1 项 · 本周 $2 项"],
    [/^(\d+) due · (\d+) overdue$/i, "$1 项到期 · $2 项逾期"],
    [/^(\d+) due$/i, "$1 项到期"],
    [/^Cleared · (\d+) done$/i, "已清完 · 完成 $1 项"],
    [/^(\d+) open items? still need attention before you close the day\.$/i, "还有 $1 项待处理，收工前值得看一眼。"],
    [/^Done (\d+)\/(\d+)$/i, "完成 $1/$2"],
    [/^(\d+) due left$/i, "剩余到期 $1"],
    [/^(\d+) overdue$/i, "逾期 $1"],
    [/^(\d+) reminders$/i, "提醒 $1"],
    [/^Mail · (.+)$/i, "邮件 · $1"],
    [/^Today · (.+)$/i, "今天 · $1"],
    [/^Added to today’s to-do list\.$/i, "已加入今天的待办。"],
    [/^Added to today's to-do list\.$/i, "已加入今天的待办。"],
    [/^Inbox updated with AI digest\.$/i, "收件箱已更新，并生成 AI 摘要。"],
    [/^Inbox updated\.$/i, "收件箱已更新。"],
    [/^Inbox updated\. Set GROQ_API_KEY for richer AI digests\.$/i, "收件箱已更新。配置 GROQ_API_KEY 可获得更完整的 AI 摘要。"],
    [/^Pulling inbox and summarizing…$/i, "正在拉取收件箱并生成摘要…"],
    [/^(.+) · auto-refreshes while this page is open$/i, "$1 · 本页打开时会自动刷新"],
    [/^Tasks due (.+)$/i, "$1 到期的任务"],
    [/^No tasks due on (.+)\.$/i, "$1 没有到期任务。"],
    [/^Starts (.+)$/i, "开始于 $1"],
    [/^Due (.+)$/i, "截止 $1"],
    [/^Overdue · (.+)$/i, "已逾期 · $1"],
    [/^High priority$/i, "高优先级"],
    [/^Medium priority$/i, "中优先级"],
    [/^Low priority$/i, "低优先级"],
    [/^\+(\d+) more$/i, "还有 $1 项"],
    [/^Applied (\d+) change\(s\)\.$/i, "已应用 $1 项更改。"],
    [/^View tasks due (.+)$/i, "查看 $1 到期的任务"],
    [/^(.+)\. (\d+) reminders?, (\d+) tasks?\.$/i, "$1，$2 个提醒，$3 项任务。"],
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
    [/^(.+) connected: (.+)$/i, "已连接 $1：$2"],
    [/^(.+) connected$/i, "已连接 $1"],
    [/^(.+) authorization failed: (.+)$/i, "$1 授权失败：$2"],
    [/^(.+) authorization failed$/i, "$1 授权失败"],
    [/^Authorized on this device · (.+)$/i, "已在此设备授权 · $1"],
    [/^(\d+) open$/i, "$1 项进行中"],
    [/^Created (.+)\.$/i, "已创建 $1。"],
    [/^Joined (.+)\.$/i, "已加入 $1。"],
    [/^Invite created for (.+)\.$/i, "已为 $1 创建邀请。"],
    [/^Sign in as (.+) to join (.+)\.$/i, "请使用 $1 登录以加入 $2。"],
    [/^Invite link for $/i, "邀请链接："],
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
    const skip = page === "index.html" || page === "" || page === "/";
    if (skip || document.getElementById("language-toggle")) return;
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
