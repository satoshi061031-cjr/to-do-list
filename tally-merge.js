(function () {
  const core = window.DailySpaceTallyCore, sync = window.DailySpaceLedgerSync;
  const el = id => document.getElementById("tally-merge-" + id);
  const tr = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
  const dialog = el("dialog"), body = el("body"), apply = el("apply"), status = el("status");
  let session, preview, serial = 0, saving = false;
  const choices = new Map(), rates = new Map();
  const node = (tag, text) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const names = {
    amount: ["Amount", "金额"], currency: ["Currency", "币种"], date: ["Date", "日期"], fxRate: ["Exchange rate", "汇率"],
    category: ["Category", "类别"], note: ["Note", "备注"], scope: ["Expense type", "支出类型"],
    paidById: ["Paid by", "付款人"], splitAmongIds: ["Split among", "分摊人"], tripId: ["Trip ID", "行程编号"],
    tripName: ["Trip", "行程"], recurringBillId: ["Recurring bill", "周期账单"], recurringDate: ["Bill date", "账单日期"],
    budget: ["Budget", "预算"], people: ["People", "成员"], tripBudgets: ["Trip budgets", "行程预算"],
    categoryBudgets: ["Category budgets", "分类预算"], recurringBills: ["Recurring bills", "周期账单"],
    settlements: ["Settlements", "结算"], quickAddKeyId: ["Quick entry connection", "快捷记账连接"],
    dismissedSubscriptions: ["Dismissed subscriptions", "已忽略的订阅"]
  };
  const name = key => Object.hasOwn(names, key) ? tr(...names[key]) : key;
  const kinds = {
    changed: ["Different versions", "两端不同"], local: ["Only on this device", "仅本机"],
    cloud: ["Only in the cloud", "仅云端"], same: ["Identical", "两端相同"]
  };

  function display(record, key, side) {
    const value = record[key];
    if (key === "fxRate") return `1 ${record.currency} = ${value} ${side.state.baseCurrency}`;
    const person = id => side.state.people.find(p => p.id === id)?.name || id;
    if (key === "paidById") return person(value);
    if (key === "splitAmongIds") return value.map(person).join(", ");
    if (key === "scope") return value === "shared" ? tr("Shared", "分摊") : tr("Personal", "个人");
    return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "—");
  }

  function recordRow(row) {
    const li = node("li"), entry = row.cloud || row.local;
    const title = [entry.date, entry.amount + " " + entry.currency, entry.category, entry.note].filter(Boolean).join(" · ");
    li.append(node("strong", title));
    if (row.kind === "same") return li;
    if (row.fields.length) {
      const list = node("dl");
      for (const key of row.fields) {
        list.append(node("dt", name(key)), node("dd", tr("Device", "本机") + " · " + display(row.local, key, preview.local)),
          node("dd", tr("Cloud", "云端") + " · " + display(row.cloud, key, preview.cloud)));
      }
      li.append(list);
    }
    const select = node("select");
    select.setAttribute("aria-label", tr("Version for ", "选择版本：") + title);
    if (row.kind === "changed") select.add(new Option(tr("Choose a version", "请选择版本"), ""));
    if (row.local) select.add(new Option(tr("Keep device entry", "保留本机记录"), "local"));
    if (row.cloud) select.add(new Option(tr("Keep cloud entry", "保留云端记录"), "cloud"));
    select.add(new Option(tr("Omit entry", "不计入合并结果"), "omit"));
    const label = node("label"), unit = node("span"), rate = node("input");
    rate.type = "number"; rate.step = "any"; rate.min = "0"; rate.inputMode = "decimal";
    label.append(unit, rate);
    const update = () => {
      const side = select.value;
      choices.set(row.id, side);
      const convert = row[side] && core.needsMergeRate(preview[side], preview.target, row[side]);
      label.hidden = !convert;
      if (convert) unit.textContent = tr("Exchange rate", "换算汇率") + ` · 1 ${row[side].currency} → ${preview.target.state.baseCurrency}`;
      rates.delete(row.id); rate.value = "";
    };
    select.addEventListener("change", update);
    rate.addEventListener("input", () => rates.set(row.id, rate.value));
    update(); li.append(select, label);
    return li;
  }

  async function refresh() {
    const ticket = ++serial;
    choices.clear(); rates.clear(); session = preview = null;
    apply.hidden = true; body.replaceChildren(); status.textContent = tr("Loading cloud ledger…", "正在读取云端账本…");
    try {
      const current = await sync.preview();
      if (ticket !== serial || !dialog.open) return;
      session = current;
      if (current.local === current.cloud) {
        status.textContent = tr("The two ledgers match. Any remaining conflict is elsewhere in the workspace.", "两端账本已一致。其余冲突来自工作区的其他数据。");
        return;
      }
      preview = core.compareLedgers(current.local, current.cloud);
      const base = preview.target.state.baseCurrency;
      const targetName = preview.target === preview.cloud ? tr("cloud", "云端") : tr("device", "本机");
      body.append(node("p", tr(`Keep the ${targetName} ledger settings and use ${base} for totals.`, `合并后沿用${targetName}账本设置，合计以 ${base} 显示。`)));
      if (current.guest) body.append(node("p", tr("The original guest workspace stays on this device. After merging, this page opens the signed-in workspace.", "原访客工作区保留在本机。合并后将打开已登录账户的工作区。")));
      const settings = Object.keys(names).filter(key => key in preview.target.state && JSON.stringify(preview.local.state[key]) !== JSON.stringify(preview.cloud.state[key]));
      body.append(node("p", tr("Device", "本机") + " · " + preview.local.state.baseCurrency + " / " + tr("Cloud", "云端") + " · " + preview.cloud.state.baseCurrency +
        (settings.length ? tr(" · Other settings that differ: ", " · 其他有差异的设置：") + settings.map(name).join("、") : "")));
      for (const kind of Object.keys(kinds)) {
        const rows = preview.rows.filter(row => row.kind === kind);
        const group = node("details"), list = node("ul");
        group.append(node("summary", tr(...kinds[kind]) + " (" + rows.length + ")"));
        group.open = kind === "changed" && rows.length > 0;
        if (rows.length) { for (const row of rows) list.append(recordRow(row)); group.append(list); }
        body.append(group);
      }
      status.textContent = tr("Confirming downloads both original ledgers as a JSON backup.", "确认时将下载两份原账本的 JSON 备份。");
      apply.hidden = false;
    } catch (error) {
      if (ticket === serial) status.textContent = error.message === "invalid-ledger" || error instanceof SyntaxError
        ? tr("A ledger contains unreadable or duplicate entries. Export the originals from Account before editing.", "账本中有无法读取或编号重复的记录。请先从账户页导出原始数据。")
        : tr("Could not load this preview. Refresh to try again.", "无法读取当前预览，请刷新重试。");
    }
  }

  function backup() {
    const originals = { exportedAt: new Date().toISOString(), local: JSON.parse(session.local), cloud: JSON.parse(session.cloud) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(originals, null, 2)], { type: "application/json" }));
    const link = node("a"); link.href = url;
    link.download = "dayfly-ledgers-" + originals.exportedAt.replace(/[:.]/g, "-") + ".json";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  apply.addEventListener("click", async () => {
    if (!session || !preview || saving) return;
    let ledger;
    try { ledger = core.mergeLedgerRecords(preview, choices, rates); }
    catch (error) {
      const messages = {
        "missing-choice": ["Choose a version for every differing entry.", "请为每笔有差异的记录选择版本。"],
        "missing-rate": ["Enter a positive exchange rate for each selected foreign entry.", "请为所选外币记录填写大于零的换算汇率。"],
        "people-conflict": ["These shared entries have incompatible participant lists. Review the selected versions.", "所选分摊记录的成员列表存在冲突，请检查所选版本。"]
      };
      status.textContent = tr(...(messages[error.message] || ["Could not merge these entries.", "无法合并所选记录。"])); return;
    }
    const ticket = serial;
    saving = true;
    apply.disabled = el("refresh").disabled = el("close").disabled = true;
    body.inert = true;
    status.textContent = tr("Saving merged ledger…", "正在保存合并后的账本…");
    try {
      backup();
      const { remaining } = await session.apply(ledger);
      if (ticket !== serial) return;
      dialog.close();
      const result = el("result");
      result.textContent = tr(`Merged and synced ${ledger.records.length} expenses.`, `已合并并同步 ${ledger.records.length} 笔支出。`) +
        (remaining ? tr(" Other workspace conflicts still need review.", " 工作区其他数据仍有冲突待处理。") : "");
      result.hidden = false;
    } catch (error) {
      if (ticket !== serial) return;
      apply.hidden = true;
      status.textContent = error.status === 409 ? tr("Cloud data changed. Refresh and review the latest entries.", "云端数据已变化，请刷新后重新核对。")
        : tr("Merge could not be confirmed on both sides. Refresh to check the latest copies.", "未能确认两端均已保存，请刷新查看最新账本。");
    } finally {
      body.inert = false; saving = false;
      apply.disabled = el("refresh").disabled = el("close").disabled = false;
    }
  });

  function open() {
    if (!sync.available() || dialog.open) return;
    el("title").textContent = tr("Merge expenses", "逐笔合并账本");
    el("close").textContent = tr("Close", "关闭"); el("refresh").textContent = tr("Refresh preview", "刷新预览");
    apply.textContent = tr("Back up and merge", "备份并合并");
    dialog.showModal(); refresh();
  }
  function syncEntry() {
    el("open").hidden = !sync.available();
    if (location.hash === "#merge-expenses" && sync.available()) {
      history.replaceState(history.state, "", location.pathname + location.search);
      open();
    }
  }
  dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });
  dialog.addEventListener("close", () => { serial++; session = preview = null; body.replaceChildren(); status.textContent = ""; });
  el("open").addEventListener("click", open); el("refresh").addEventListener("click", refresh);
  el("close").addEventListener("click", () => dialog.close());
  window.addEventListener("hashchange", syncEntry);
  window.addEventListener("daily-space-user-sync-updated", syncEntry);
  window.addEventListener("daily-space-auth-updated", () => { if (dialog.open) dialog.close(); el("result").hidden = true; syncEntry(); });
  syncEntry();
})();
