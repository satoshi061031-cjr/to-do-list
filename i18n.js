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
    "Start each day": "每天从",
    "in Daily Loop.": "Daily Loop 开始。",
    "One habit.": "一个习惯。",
    "See what’s due today, clear overdue, and close the day — Todo is the hub.":
      "看清今天到期、清理逾期、收尾一天——待办是中枢。",
    "See what’s due today, clear overdue, and close the day — Todo is the hub. Google or Outlook sign-in connects mail and calendar for that account.":
      "看清今天到期、清理逾期、收尾一天——待办是中枢。用 Google 或 Outlook 登录后，邮件和日历都会接到这个账号。",
    "Meet Daily Space.": "认识 Daily Space。",
    "Your personal productivity space.": "你的个人效率空间。",
    "Your workspace for personal focus and team assignment.": "兼顾个人专注与团队分派的工作空间。",
    "Continue with Google": "使用 Google 继续",
    "Continue with Outlook": "使用 Outlook 继续",
    "Continue with WeChat": "使用微信继续",
    "Enter Daily Space": "进入 Daily Space",
    "Open Daily Loop": "打开 Daily Loop",
    "Continue as guest": "以访客身份继续",
    "Download my data": "下载我的数据",
    "Delete account": "删除账号",
    Account: "账户",
    "Download a copy, fix sync conflicts from the Account row, or delete your cloud account.":
      "可下载副本、在账户行处理同步冲突，或删除云端账号。",
    "Export your data, resolve sync conflicts from the Account row, or delete this cloud account.":
      "可导出数据、在账户行解决同步冲突，或删除此云端账号。",
    "Install tip: use your browser’s “Install app” or “Add to Home Screen” for a Daily Loop shortcut.":
      "安装提示：用浏览器的「安装应用」或「添加到主屏幕」，快捷打开 Daily Loop。",
    "Your data stays on this device and in your cloud snapshot while signed in.":
      "登录期间，数据保存在本机，并同步到云端快照。",
    "Signed in with Google or Outlook, Mail and Calendar use that same account.":
      "用 Google 或 Outlook 登录后，邮件和日历使用同一账号。",
    "Signed in with Google or Outlook, Mail and Calendar use that same account. WeChat keeps a cloud snapshot on this workspace.":
      "用 Google 或 Outlook 登录后，邮件和日历使用同一账号。微信登录只同步本工作区的云快照。",
    "Sign in to keep this work": "登录以保存这些内容",
    "You have tasks on this device. Connect Google or Outlook to save them to your account.":
      "这台设备上已有任务。连接 Google 或 Outlook，即可保存到你的账号。",
    "You have tasks on this device. Connect Google, Outlook, or WeChat to save them to your account.":
      "这台设备上已有任务。连接 Google、Outlook 或微信，即可保存到你的账号。",
    Later: "稍后再说",
    "Keep this device": "保留本机",
    "Keep local": "保留本机",
    "Use cloud": "使用云端",
    "Offline — saved on this device": "离线 — 已保存在本机",
    "Syncing…": "同步中…",
    "Sync failed — will retry": "同步失败 — 将重试",
    "Ready to sync": "可以同步",
    More: "更多",
    "⌘K · ?": "⌘K · ?",
    "All caught up.": "今天都做完了。",
    "Nothing due today — add one with the agent above.": "今天没有到期任务——用上方的助手加一项。",
    "Nothing due today — type a task below.": "今天没有到期任务——在下方输入一项。",
    "Type a task above, or ask the agent — works even offline.": "在上方输入任务，或问助手——离线也能加。",
    "Type a task below, or ask the agent — works even offline.": "在下方输入任务，或问助手——离线也能加。",
    "No due-today tasks yet — type one above, ask the agent, or mark the day closed.":
      "今天还没有到期任务——在上方加一项、问助手，或直接收尾。",
    "Google and Outlook sign-in already open that mailbox. Use these buttons only to add another account.":
      "用 Google 或 Outlook 登录后邮箱已经打开。只有要加另一个邮箱时才用这些按钮。",
    "Mail digest uses the Google or Outlook account you signed in with. Add another mailbox only if you need a second inbox.":
      "邮件摘要使用你登录的 Google 或 Outlook 账号。只有需要第二个收件箱时再添加邮箱。",
    "Stay up to date": "保持同步",
    Schedule: "日程",
    "Today’s tasks": "今天的任务",
    "Today's tasks": "今天的任务",
    "Add task": "添加任务",
    "+ Add reminder": "+ 添加提醒",
    "Open in Todo": "在待办中打开",
    Tasks: "任务",
    Menu: "菜单",
    Amount: "金额",
    Category: "分类",
    Note: "备注",
    "Search schedule": "搜索日程",
    "Search cards": "搜索卡片",
    Upcoming: "即将开始",
    "AI digest": "AI 摘要",
    Completed: "已完成",
    Pending: "待处理",
    "To do": "待办",
    Ask: "问",
    "What to do?": "做什么？",
    "Type a task above.": "在上方输入任务。",
    Theme: "主题",
    "No matches.": "没有匹配结果。",
    "Hey there": "你好",
    "Let's make progress today!": "今天也来点进展吧！",
    "Today · Agent": "今天 · 助手",
    "Today · Daily Space": "今天 · Daily Space",
    "Landing Page": "计划空间",
    Trip: "行程",
    "Search place": "搜索地点",
    "Open in Google Maps": "在 Google 地图中打开",
    "Add two stops, then open transit directions.": "添加两个停靠点后，可打开公交路线。",
    "Add a task above.": "在上方添加任务。",
    "Nothing active.": "没有进行中的任务。",
    "No completed tasks.": "还没有已完成任务。",
    "What’s left — then stop.": "清完今天剩下的，就可以停。",
    "Keyboard shortcuts": "键盘快捷键",
    "Press ? anytime to open this list. Keys are ignored while typing.":
      "随时按 ? 打开此列表。输入时不会触发快捷键。",
    "Press anytime to open this list. Keys are ignored while typing.":
      "随时打开此列表。输入时不会触发快捷键。",
    Go: "跳转",
    Anywhere: "全局",
    "Todo · Today": "待办 · 今天",
    "New task": "新建任务",
    "Jump palette": "跳转面板",
    "Slash commands": "斜杠命令",
    "This help": "本说明",
    "Toggle theme": "切换主题",
    "Close panels": "关闭面板",
    "Close shortcuts": "关闭快捷键",
    "Enter to add · / commands · ⌘K jump · ? shortcuts":
      "回车添加 · / 命令 · ⌘K 跳转 · ? 快捷键",
    "Swipe up to enter": "向上滑动进入",
    "Swipe up to continue": "向上滑动继续",
    "Move to the left edge to open the menu": "移到左边缘即可打开菜单",
    "Google or Outlook": "Google 或 Outlook",
    "Google, Outlook, or WeChat": "Google、Outlook 或微信",
    "On this device": "仅本机",
    "Device only": "仅本机",
    "Private notes": "私人备注",
    "Never synced to workspace members": "不会同步给工作空间成员",
    "This block stays on this device. Use the workspace above only to invite people and assign from Planner.":
      "此区域只保存在本机。上方工作空间仅用于邀请同事，并在 Planner 团队看板指派。",
    "This block stays on this device. For real collaboration use the workspace above and Planner team boards.": "此区域只保存在本机。真正协作请用上方工作空间和「计划」的团队看板。",
    "Spent today": "今日支出",
    "What for?": "记一笔？",
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
    "To-do list": "待办清单",
    Planner: "计划",
    Calendar: "日历",
    "Tally book": "记账本",
    "Tally Book": "记账本",
    Travel: "旅行",
    Teamwork: "指派与笔记",
    "Notes & light assign": "笔记与轻量指派",
    "Invite people so you can assign cards from Planner team boards — not a full team suite.":
      "邀请同事后，可在 Planner 团队看板指派卡片——不是完整协作套件。",
    Mail: "邮箱",
    Add: "添加",
    Clock: "时钟",
    "Month atmosphere": "月历氛围",
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
    "Ask agent": "问助手",
    "Ask agent to finish": "让助手收尾",
    "Ask the agent": "问助手",
    "Mark day closed": "标记今天收工",
    "Day closed.": "今天收工了。",
    "Close the day": "收工",
    "Nice work — see you tomorrow. Open the agent anytime if something comes up.": "不错 — 明天见。有事随时找助手。",
    "Due today is done and nothing is overdue. Mark the day closed when you’re ready.": "今日到期已完成，也没有逾期。准备好了就标记收工。",
    "No due-today tasks yet — ask the agent above for a light close, or mark the day closed.":
      "还没有今日到期任务 — 让上方助手帮你轻量收尾，或直接标记收工。",
    "No due-today tasks yet — add one if you want a light close.": "还没有今日到期任务 — 想轻量收尾的话加一项。",
    "Ask the agent to add tasks — works offline too": "让助手添加任务——离线也能用",
    "Type a task in the agent above — works even offline.": "在上方助手里输入任务——离线也能加。",
    "Travel is a preview — not in the main Daily Space loop yet.": "旅行还是预览版 — 暂不在 Daily Space 主循环里。",
    "Personal trip board — map your stops and days.": "个人行程板 — 规划停靠点与行程日。",
    "Back to Today": "回到今天",
    "Due left": "剩余到期",
    "Done today": "今日完成",
    Reminders: "提醒",
    "Add a task for today": "加一项今天的任务",
    "Ask to add a task": "让助手加任务",
    "Tell the agent what to add, complete, or reschedule. Your list updates below.":
      "告诉助手要添加、完成或改期的事。列表会在下方更新。",
    "Primary capture for Todo — also reaches Planner, Calendar, and Tally.":
      "待办的主入口 — 也可改计划、日历和记账。",
    "Offline mode: type a task (e.g. “buy milk today”). Add GROQ_API_KEY for full agent.":
      "离线模式：直接输入任务（如「今天买牛奶」）。配置 GROQ_API_KEY 可启用完整助手。",
    "Offline mode adds Todo items locally. Add GROQ_API_KEY for the full agent.":
      "离线模式会在本地添加待办。配置 GROQ_API_KEY 可启用完整助手。",
    "Connect Gmail": "连接 Gmail",
    "Connect Outlook": "连接 Outlook",
    "Authorize reading": "授权读信",
    "Needs mailbox authorization": "需要邮箱授权",
    "Reconnect mailbox": "重新连接邮箱",
    "Smart digest is off right now. Inbox still works with short snippets.":
      "智能摘要暂未开启。收件箱仍可用短摘要片段。",
    "Smart digest failed this time — showing message snippets. Refresh to retry.":
      "这次智能摘要失败了 — 先显示邮件片段。可刷新重试。",
    "Already on Today.": "已经在今天了。",
    "Ask agent to finish from mail": "让 Agent 根据邮件收尾",
    "This is your Todo agent. Try: “Add buy milk today” or “Remind me tomorrow at 9:00.”":
      "这是你的待办助手。试试：“今天买牛奶”或“明天 9 点提醒我”。",
    "No columns yet": "还没有分栏",
    "Ask the Daily Space agent to set up a board, or add columns here.": "让 Daily Space 助手搭一个看板，或在这里添加分栏。",
    "Open the Daily Space Agent to continue.": "请打开 Daily Space Agent 继续。",
    "Ask about your inbox": "聊聊你的收件箱",
    "e.g. Turn the digest into today’s tasks…": "例如：把摘要变成今天的待办…",
    "e.g. Turn the digest into today's tasks…": "例如：把摘要变成今天的待办…",
    "Use the digest or ask the agent to turn important mail into Today.":
      "用摘要，或让 Agent 把重要邮件变成今天的待办。",
    "Offline mode still adds Todo locally. Connect mail + agent for digest help.":
      "离线仍可本地加待办。连接邮箱和 Agent 可获得摘要帮助。",
    "On Today": "已在今天",
    "You’re offline. Connect to refresh mail.": "当前离线。联网后再刷新邮件。",
    "Mailbox needs authorization — connect Gmail or Outlook to read mail.":
      "邮箱需要授权 — 连接 Gmail 或 Outlook 才能读信。",
    "Selected messages are already on Today.": "所选邮件已在今天。",
    "Reading on this device": "本机可读",
    "Add selected to Today": "把所选加到今天",
    "Select all": "全选",
    "Open Today": "打开今天",
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
    "Base currency": "本位币",
    "New transaction": "新交易",
    "Edit transaction": "编辑交易",
    "Add transaction": "添加交易",
    "Save changes": "保存修改",
    Date: "日期",
    Yesterday: "昨天",
    "Add expense": "添加支出",
    "Edit expense": "编辑支出",
    "Close edit expense": "关闭编辑支出",
    "Close expense sheet": "关闭支出面板",
    "Daily expense": "每日支出",
    "No expense data yet.": "还没有支出数据。",
    "No note": "无备注",
    "No expenses for this day.": "当天没有支出。",
    "No expenses this month.": "本月还没有支出。",
    "No shared expenses this month.": "本月还没有共同支出。",
    "Keep today’s spend quiet and clear.": "把今天的花费记清楚就好。",
    "No spend logged yet. Tap + to add the first one.": "本周还没有记录。点 + 记第一笔。",
    "Shared expenses": "多人分账",
    People: "参与人",
    "Add everyone who can pay or share an expense.": "添加所有可能付款或参与分摊的人。",
    "Person name": "姓名",
    "Add person": "添加成员",
    "Shared balance": "共同余额",
    "Shared balances": "共同余额",
    "Ledger view": "账本视图",
    "Who owes whom": "谁该付给谁",
    "Expense type": "支出类型",
    Currency: "币种",
    "Rate to base currency": "兑本位币汇率",
    "Paid by": "付款人",
    "Split among": "参与分摊",
    "Suggested settlement": "建议结算",
    "Everyone is settled up.": "目前所有人都已结清。",
    Settled: "已结清",
    owes: "应付",
    "gets back": "应收",
    "Fetching rate…": "正在获取汇率…",
    "Rate unavailable — enter it manually.": "无法获取汇率，请手动输入。",
    Unknown: "未知成员",
    JPY: "JPY",
    CNY: "CNY",
    USD: "USD",
    EUR: "EUR",
    GBP: "GBP",
    KRW: "KRW",
    HKD: "HKD",
    SGD: "SGD",
    "of budget used": "预算已用",
    "over budget": "超出预算",
    "No timed reminders this week — add one below.": "本周还没有定时提醒——在下方添加一条。",
    "Plan trips on the map.": "在地图上规划行程。",
    "Trip map": "行程地图",
    "One map, with stops listed beside it.": "一张地图，旁边列出停靠点。",
    "New trip": "新建行程",
    Places: "地点库",
    Itinerary: "行程安排",
    "Itinerary by day": "按天查看行程",
    "Add to itinerary": "添加到行程",
    "Import booking PDF": "导入预订 PDF",
    "Import booking": "导入预订",
    "Travel import": "导入到旅行",
    "Review booking": "核对预订",
    "Close booking import": "关闭预订导入",
    "Add to trip": "添加到行程",
    "Open Travel": "打开旅行",
    "Personal trips stay on this device and in your cloud snapshot. Shared trips live with Google collaborators.":
      "个人行程保存在本机并同步到云端快照。共享行程由 Google 协作者共同维护。",
    "Export CSV": "导出 CSV",
    Repeat: "重复",
    Once: "一次",
    Daily: "每天",
    Weekly: "每周",
    "Search Daily Space": "搜索 Daily Space",
    "Search tasks, trips, spend…": "搜索任务、行程、支出…",
    "Shared trip invitation": "共享行程邀请",
    "Opening invitation…": "正在打开邀请…",
    "Checking this invitation.": "正在检查这份邀请。",
    Collaboration: "协作",
    "Share trip": "共享行程",
    Share: "共享",
    "Personal · saved on this device": "个人 · 保存在此设备",
    "Share this trip": "共享此行程",
    "Invite type": "邀请类型",
    "One-time": "一次性",
    Reusable: "可重复",
    "Google email (optional)": "Google 邮箱（可选）",
    Expires: "有效期",
    "24 hours": "24 小时",
    "7 days": "7 天",
    "30 days": "30 天",
    "Create invite": "创建邀请",
    Shared: "共享",
    "Delete booking": "删除预订",
    Stops: "停靠点",
    "No trip yet. Tap Add to set a destination — the map and stop list will show here.":
      "还没有行程。点「添加」设定目的地——地图和停靠点列表会显示在这里。",
    "Good morning": "早上好",
    "Good noon": "中午好",
    "Good afternoon": "下午好",
    "Good evening": "晚上好",
    "Where's your destination?": "你的目的地是哪里？",
    "Where’s your destination?": "你的目的地是哪里？",
    "No trip yet. Tap Add to set a destination — the map fills the screen with stops overlaid beside it.":
      "还没有行程。点「添加」设定目的地——地图铺满屏幕，停靠点叠在侧边。",
    "No stops on this day yet.": "这一天还没有停靠点。",
    "Search a place, or click the map to drop a stop.": "搜索地点，或点击地图落下停靠点。",
    "Search, or click the map to drop a stop.": "搜索，或点击地图落下停靠点。",
    "Where are you going?": "去哪里？",
    "Trip name": "行程名称",
    Destination: "目的地",
    "Japan spring": "日本春日",
    "Tokyo, Japan": "日本东京",
    "Create trip": "创建行程",
    "Search a place to see options, then pick one to add.": "先搜索看结果，选中后再加入行程。",
    "places found. Pick one to add — the map stays put until then.": "个结果。先选一个再加入，地图不会立刻跳转。",
    Search: "搜索",
    "Search places": "搜索地点",
    "Hide search": "收起搜索",
    "Cafe, museum, park…": "咖啡店、博物馆、公园…",
    "Find places near your destination.": "在目的地附近找地点。",
    "No places found nearby. Try another keyword.": "附近没有找到。换个关键词试试。",
    "Back to trips": "返回行程列表",
    "Delete trip": "删除行程",
    "Delete stop": "删除停靠点",
    "Looking up destination…": "正在查找目的地…",
    "Couldn’t find that place. Try a clearer city name.": "找不到这个地方。试试更清楚的城市名。",
    "End date must be on or after the start date.": "结束日期不能早于开始日期。",
    "Lookup failed. Check your connection and try again.": "查找失败。请检查网络后重试。",
    "Searching…": "搜索中…",
    "No place found. Try another search.": "没有找到地点。换个关键词试试。",
    "Stop added. Search again or click the map.": "已添加停靠点。可继续搜索或点击地图。",
    "Search failed. Check your connection.": "搜索失败。请检查网络。",
    stop: "个停靠点",
    stops: "个停靠点",
    days: "天",
    "Work the list that matters for today. Add a task below when you’re ready.":
      "先做今天真正重要的事。准备好了就在下方添加任务。",
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
    "Works across Todo, Planner, Calendar, Tally and Teamwork.": "可操作待办、计划、日历、记账和私人笔记。",
    "Optional helper — best for Todo / today. Also reaches Planner, Calendar, Tally, and private notes.":
      "可选助手——最适合待办 / 今天，也可改计划、日历、记账和私人笔记。",
    "Agent needs a server LLM key. You can still use Todo, Planner, and the rest without it.":
      "Agent 需要服务端 LLM 密钥。没有密钥也能正常使用待办、计划等页面。",
    "I can help with today’s tasks. Try: “Add buy milk today” or “Remind me tomorrow at 9:00.”":
      "我可以帮你处理今天的待办。试试：“今天买牛奶”或“明天 9 点提醒我”。",
    "Working…": "处理中…",
    "Agent request timed out. Please try again.": "助手响应超时，请重试。",
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
    "Invite people, then assign work from Planner team boards.": "邀请成员，然后在「计划」的团队看板上分派工作。",
    "Sign in to create or join a shared workspace.": "登录后即可创建或加入共享工作空间。",
    "Local draft": "本机草稿",
    "Optional notes and local-only names on this device": "可选备注与仅本机的名字",
    "New workspace": "新建工作空间",
    "From Planner → Team boards.": "来自「计划」→ 团队看板。",
    "Add local names for personal planning only.": "仅添加用于个人规划的本机名字。",
    Personal: "个人",
    "Assigned to me": "指派给我",
    "Shared tasks assigned to you from Planner team boards.": "来自「计划」团队看板、指派给你的共享任务。",
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
    Admin: "管理员",
    Owner: "所有者",
    "Your role: owner": "你的角色：所有者",
    "Your role: admin": "你的角色：管理员",
    "Your role: member": "你的角色：成员",
    Remove: "移除",
    Revoke: "撤销",
    "Leave workspace": "离开工作空间",
    "Delete workspace": "删除工作空间",
    "+ New team board": "+ 新建团队看板",
    "No team boards yet. Create one below.": "还没有团队看板。在下方创建一个。",
    "No team boards yet. Ask an owner or admin to create one.":
      "还没有团队看板。请让所有者或管理员创建。",
    "Invite revoked.": "邀请已撤销。",
    "Member removed.": "成员已移除。",
    "Role updated.": "角色已更新。",
    "Team boards": "团队看板",
    Assignments: "分派",
    "Open cards live on the shared Planner team board.": "打开的卡片在「计划」的共享团队看板上。",
    "Assignments come from Planner → Team boards (not the personal planner, and not local members below).":
      "分派来自「计划」→ 团队看板（不是个人看板，也不是下方本机成员）。",
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
    "New card": "新卡片",
    "Nothing blocking": "暂无阻塞",
    Aligned: "已对齐",
  };

  const ATTR_ZH = {
    Menu: "菜单",
    "Save your workspace": "保存你的工作区",
    "+ New category": "+ 新建分类",
    "+ New planner": "+ 新建计划空间",
    "Sign in Google, Outlook, phone": "登录：Google、Outlook 或手机",
    "New task": "新任务",
    "Due date": "截止日期",
    "Clear due date": "清除截止日期",
    "Mark as done": "标记为已完成",
    "Mark as active": "标记为进行中",
    "Delete task": "删除任务",
    "User greeting": "用户问候",
    "To-do tasks": "待办任务",
    "Member role": "成员角色",
    "Mark task as done": "将任务标记为已完成",
    "Month calendar": "月历",
    "Monthly summary": "月度汇总",
    "Expense calendar": "支出日历",
    "Daily expense chart": "每日支出图表",
    "Expense records": "支出记录",
    "Teamwork overview": "指派与笔记概览",
    "Quick authorization": "快捷授权",
    "Add another mailbox": "添加其他邮箱",
    Mailboxes: "邮箱账户",
    "Close agent": "关闭助手",
    "Add a task…": "添加任务…",
    "e.g. Turn the digest into today’s tasks…": "例如：把摘要变成今天的待办…",
    "e.g. Turn the digest into today's tasks…": "例如：把摘要变成今天的待办…",
    "e.g. Add buy milk today…": "例如：今天 买牛奶…",
    "Search anything…": "搜索任何内容…",
    "Search cards": "搜索卡片",
    "Column title": "分栏标题",
    "Search tasks & reminders…": "搜索任务和提醒…",
    "Search schedule": "搜索日程",
    "Add a timed reminder…": "添加定时提醒…",
    "New task for selected day": "为所选日期添加任务",
    "Previous week": "上一周",
    "Next week": "下一周",
    "Open today’s tasks": "打开今天的任务",
    "Open today's tasks": "打开今天的任务",
    "Click to delete reminder": "点击删除提醒",
    "Week calendar": "周历",
    Navigation: "导航",
    "Search filters": "搜索筛选",
    "Calendar controls": "日历控件",
    "Week range": "周范围",
    "Drag up to enter": "向上拖动进入",
    "Refresh inbox": "刷新收件箱",
    "Name…": "名称…",
    "New planner name": "新计划空间名称",
    "Expense summary": "支出汇总",
    "Name these private notes…": "给这些私人笔记起个名字…",
    "Optional private description…": "可选的私人描述…",
    Focus: "重点",
    "Private notes on this device…": "仅存本机的私人笔记…",
    "Shared workspace": "共享工作空间",
    "Invite role": "邀请角色",
    "What do you need to do?": "你需要做什么？",
    "Search Daily Space": "搜索 Daily Space",
    "Search tasks, trips, spend…": "搜索任务、行程、支出…",
    "Jump to a page or action…": "跳转到页面或操作…",
    "New category name": "新分类名称",
    "Filter tasks": "筛选任务",
    "Task source": "任务来源",
    "Pick a due date": "选择截止日期",
    Commands: "命令",
    "Add task": "添加任务",
    "Export CSV": "导出 CSV",
    Jump: "跳转",
    "Jump search": "跳转搜索",
    "Type a task, or / for commands": "输入任务，或用 / 唤出命令",
    "Search a place…": "搜索地点…",
    "Select trip": "选择行程",
    "Zoom in": "放大",
    "Zoom out": "缩小",
    "Trip days": "行程天数",
    "Close new trip": "关闭新建行程",
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
    "Edit record": "编辑记录",
    "Add reminder": "添加提醒",
    "Budget settings": "预算设置",
    "Month navigation": "月份导航",
    "Return to this month": "返回本月",
    "Weekly expense summary": "每周支出汇总",
    "Close add expense": "关闭添加支出",
    "Close edit expense": "关闭编辑支出",
    "Close expense sheet": "关闭支出面板",
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
    [/^(\d+) due left$/i, "剩余 $1 项到期"],
    [/^(\d+) overdue$/i, "$1 项逾期"],
    [/^(\d+) reminders$/i, "$1 个提醒"],
    [/^(.+)\. Ask the agent to finish, or clear what you can\.$/i, "$1。让助手帮你收尾，或清掉能清的。"],
    [/^Mail · (.+)$/i, "邮件 · $1"],
    [/^Tally · (.+) today$/i, "记账 · 今日 $1"],
    [/^Added (\d+) messages? to Today\.$/i, "已将 $1 封邮件加到今天。"],
    [/^Add (\d+) selected to Today$/i, "把所选 $1 封加到今天"],
    [/^Reading on this device · (.+)$/i, "本机可读 · $1"],
    [/^(\d+) recent messages in your inbox\. Focus: (.+)$/i, "收件箱有 $1 封最近邮件。重点：$2"],
    [/^1 recent message in your inbox\. Focus: (.+)$/i, "收件箱有 1 封最近邮件。重点：$1"],
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
    [/^(\d+) shared records? · converted to (.+)$/i, "$1 条共同支出 · 已换算为 $2"],
    [/^(.+) paid · split (\d+)$/i, "$1 付款 · $2 人分摊"],
    [/^(.+) pays (.+) (.+)$/i, "$1 支付给 $2 $3"],
    [/^1 (.+) = (.+) (.+)$/i, "1 $1 = $2 $3"],
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
    [/^Synced (.+)$/i, "已同步 $1"],
    [/^You edited offline —$/i, "你离线时改过 —"],
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
    [/^(\d+) trips?$/i, "$1 个行程"],
    [/^(\d+) days?$/i, "$1 天"],
    [/^(\d+) stops?$/i, "$1 个停靠点"],
    [/^Day (\d+)$/i, "第 $1 天"],
    [/^Day (\d+) · (.+)$/i, "第 $1 天 · $2"],
    [/^Day (\d+) stops$/i, "第 $1 天的停靠点"],
    [/^(.+) · (\d+) days?$/i, "$1 · $2 天"],
    [/^Added “(.+)” to Day (\d+)\.$/i, "已把「$1」添加到第 $2 天。"],
    [/^Stay up to date, (.+)$/i, "保持同步，$1"],
    [/^(\d+) tasks? left$/i, "还剩 $1 项任务"],
    [/^Done today (\d+) \/ (\d+)$/i, "今日完成 $1 / $2"],
    [/^Filtered · (\d+) tasks? · (\d+) reminders?$/i, "已筛选 · $1 项任务 · $2 个提醒"],
    [/^(\d+) tasks? · (\d+) reminders? this week$/i, "本周 $1 项任务 · $2 个提醒"],
    [/^(\d+) tasks? · (\d+) reminders?$/i, "$1 项任务 · $2 个提醒"],
    [/^(\d+) tasks? due$/i, "$1 项任务到期"],
    [/^(\d+) overdue still open\.$/i, "还有 $1 项逾期未完成。"],
    [/^\+(\d+) more in Today$/i, "今天还有 $1 项"],
    [/^No tasks match this view for (.+)\.$/i, "$1 没有符合当前视图的任务。"],
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
