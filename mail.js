(function () {
  const STORAGE_AUTH = "daily-space-auth-v1";
  const STORAGE_SELECTED = "daily-space-mail-selected-v1";
  let accounts = [];
  let selectedAccountId = "";
  let messagesRequestId = 0;

  const titleEl = document.getElementById("mail-title");
  const pageStatus = document.getElementById("mail-page-status");
  const emptyConnect = document.getElementById("mail-empty-connect");
  const inboxPanel = document.getElementById("mail-inbox");
  const managePanel = document.getElementById("mail-manage");
  const switcher = document.getElementById("mail-account-switcher");
  const statusEl = document.getElementById("mail-status");
  const messageList = document.getElementById("mail-message-list");
  const accountList = document.getElementById("mail-account-list");
  const digestEl = document.getElementById("mail-digest");
  const refreshBtn = document.getElementById("mail-refresh");
  const aiBanner = document.getElementById("mail-ai-banner");
  const aiBannerCopy = document.getElementById("mail-ai-banner-copy");
  const batchBar = document.getElementById("mail-batch-bar");
  const selectAllEl = document.getElementById("mail-select-all");
  const addSelectedBtn = document.getElementById("mail-add-selected");
  const connectTitle = document.getElementById("mail-connect-title");
  const connectHint = document.getElementById("mail-connect-hint");
  const selectToggle = document.getElementById("mail-select-toggle");
  const selectedCount = document.getElementById("mail-selected-count");
  const refreshMeta = document.getElementById("mail-refresh-meta");
  const tools = document.getElementById("mail-tools");
  const digestSection = document.getElementById("mail-digest-section");
  const digestRest = document.getElementById("mail-digest-rest");
  const digestFull = document.getElementById("mail-digest-full");
  const detailSheet = document.getElementById("mail-detail-sheet");
  const detailTitle = document.getElementById("mail-detail-title");
  const detailFrom = document.getElementById("mail-detail-from");
  const detailTime = document.getElementById("mail-detail-time");
  const detailPreview = document.getElementById("mail-detail-preview");
  const detailSummary = document.getElementById("mail-detail-summary");
  const detailAdd = document.getElementById("mail-detail-add");
  const detailBooking = document.getElementById("mail-detail-booking");
  const detailStatus = document.getElementById("mail-detail-status");
  const signInSpaceBtn = document.getElementById("mail-signin-space");
  const oauthQuick = document.getElementById("mail-oauth-quick");
  const importPdfBtn = document.getElementById("mail-import-pdf");
  const importPdfInput = document.getElementById("mail-import-pdf-input");
  const bookingSheet = document.getElementById("mail-booking-sheet");
  const bookingBackdrop = document.getElementById("mail-booking-backdrop");
  const bookingClose = document.getElementById("mail-booking-close");
  const bookingSource = document.getElementById("mail-booking-source");
  const bookingPreview = document.getElementById("mail-booking-preview");
  const bookingTripSelect = document.getElementById("mail-booking-trip-select");
  const bookingStatus = document.getElementById("mail-booking-status");
  const bookingConfirm = document.getElementById("mail-booking-confirm");

  const POLL_MS = 120000;
  let pollTimer = null;
  let latestMessages = [];
  let selectedMailIds = new Set();
  let signedIn = false;
  let pendingBookingImport = null;
  let selecting = false;
  let detailId = "";
  let latestDigest = "";
  let displayedAccountId = "";
  let lastUpdatedAt = null;
  let authUserId = "";
  let authRequestId = 0;
  let activeController = null;
  let bookingRequestId = 0;
  const inboxCache = new Map();

  function todayIso() {
    if (window.DailySpaceAgentData && typeof window.DailySpaceAgentData.todayIso === "function") {
      return window.DailySpaceAgentData.todayIso();
    }
    return new Date().toISOString().slice(0, 10);
  }

  function isZh() {
    return window.DailySpaceI18n?.locale?.() === "zh";
  }

  function t(en, zh) {
    return isZh() ? zh : en;
  }

  function formatDate(value, compact = false) {
    if (!value) return t("Unknown time", "时间未知");
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return t("Unknown time", "时间未知");
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return date.toLocaleString(window.DailySpaceI18n?.localeTag(), compact
      ? sameDay ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      }[char];
    });
  }

  function readSelectedId() {
    try {
      return String(localStorage.getItem(STORAGE_SELECTED) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function writeSelectedId(id) {
    selectedAccountId = String(id || "").trim();
    try {
      if (selectedAccountId) localStorage.setItem(STORAGE_SELECTED, selectedAccountId);
      else localStorage.removeItem(STORAGE_SELECTED);
    } catch (_) {
      /* ignore */
    }
  }

  function selectedAccount() {
    const ready = readyAccounts();
    return ready.find((account) => account.id === selectedAccountId) || ready[0] || null;
  }

  function setPageStatus(message, isError) {
    if (!pageStatus) return;
    if (!message) {
      pageStatus.hidden = true;
      pageStatus.textContent = "";
      pageStatus.classList.remove("is-error");
      return;
    }
    pageStatus.hidden = false;
    pageStatus.textContent = message;
    pageStatus.classList.toggle("is-error", Boolean(isError));
  }

  function setInboxStatus(message, isError) {
    if (statusEl) {
      statusEl.textContent = message || "";
      statusEl.classList.toggle("is-error", Boolean(isError));
      statusEl.hidden = !message;
    }
    if (detailStatus && detailSheet && !detailSheet.hidden) {
      detailStatus.textContent = message || "";
      detailStatus.hidden = !message;
      detailStatus.classList.toggle("is-error", Boolean(isError));
    }
  }

  function updateHero() {
    const connected = readyAccounts().length > 0;
    if (titleEl) titleEl.textContent = "Mail";
    if (refreshBtn) refreshBtn.hidden = !connected;
    if (tools) tools.hidden = !signedIn;
    if (refreshMeta) {
      refreshMeta.hidden = !lastUpdatedAt || !connected;
      refreshMeta.textContent = lastUpdatedAt
        ? `${t("Updated", "更新于")} ${formatDate(lastUpdatedAt, true)}` : "";
    }
  }

  function setDigest(text) {
    latestDigest = String(text || "").trim();
    if (!digestEl) return;
    const points = latestDigest.split(/\n+|(?<=[。！？])|(?<=[.!?])\s+/)
      .map(line => line.replace(/^\s*(?:[-•*]|\d+[.)、])\s*/, "").trim()).filter(Boolean);
    digestEl.hidden = !points.length;
    digestEl.innerHTML = points.length
      ? `<ul data-i18n-ignore>${points.slice(0, 3).map(point => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : "";
    if (digestFull) digestFull.textContent = latestDigest;
    if (digestRest) digestRest.hidden = points.length <= 3;
    const actions = document.getElementById("mail-digest-actions");
    if (actions) actions.hidden = !latestDigest;
    updateDigestVisibility();
  }

  function updateDigestVisibility() {
    if (digestSection) digestSection.hidden = !latestDigest && (!aiBanner || aiBanner.hidden);
  }

  function askAgentAboutMail() {
    const digest = latestDigest;
    const openCount = latestMessages.length;
    const preferZh =
      window.DailySpaceI18n && typeof window.DailySpaceI18n.locale === "function"
        ? window.DailySpaceI18n.locale() === "zh"
        : String(document.documentElement.lang || "")
            .toLowerCase()
            .startsWith("zh");
    let seed;
    if (preferZh) {
      seed = digest
        ? `根据我的收件箱摘要：${digest}。请把重要的事项变成今天的待办。`
        : openCount
          ? `我有 ${openCount} 封最近邮件。请帮我把重要的变成今天的待办。`
          : "请帮我把重要邮件变成今天的待办。";
    } else {
      seed = digest
        ? `From my inbox digest: ${digest}. Turn the important ones into today’s tasks.`
        : openCount
          ? `I have ${openCount} recent inbox messages. Help me turn the important ones into today’s tasks.`
          : "Help me turn important mail into today’s tasks.";
    }
    if (window.DailySpaceAgentUi && typeof window.DailySpaceAgentUi.focusComposer === "function") {
      window.DailySpaceAgentUi.focusComposer(seed);
      return;
    }
    setInboxStatus("Open the Daily Space Agent to continue.", true);
  }

  function setAiBanner(show) {
    if (aiBanner) aiBanner.hidden = !show;
    if (show && aiBannerCopy) aiBannerCopy.textContent = t(
      "Summary unavailable. You can still read your mail.", "摘要暂不可用，邮件仍可正常查看。");
    updateDigestVisibility();
  }

  function readyAccounts() {
    return accounts.filter((account) => account && account.hasCredentials !== false && !account.needsMailOAuth);
  }

  function mailTaskKey(message) {
    return `mail:${selectedAccountId || "inbox"}:${String(message?.id || "").trim()}`;
  }

  const MAIL_ADDED_KEY = "daily-space-mail-added-v1";

  function readAddedMailIds() {
    try {
      const raw = JSON.parse(localStorage.getItem(MAIL_ADDED_KEY) || "null");
      if (!raw || raw.date !== todayIso() || !Array.isArray(raw.ids)) return new Set();
      return new Set(raw.ids.map(String));
    } catch (_) {
      return new Set();
    }
  }

  function markMailAdded(message) {
    const key = mailTaskKey(message);
    if (!String(message?.id || "").trim()) return;
    const ids = readAddedMailIds();
    ids.add(key);
    try {
      localStorage.setItem(MAIL_ADDED_KEY, JSON.stringify({ date: todayIso(), ids: [...ids] }));
    } catch (_) {
      /* ignore */
    }
  }

  function alreadyAddedMail(message) {
    const key = mailTaskKey(message);
    if (readAddedMailIds().has(key)) return true;
    try {
      if (window.DailySpaceAgentData && typeof window.DailySpaceAgentData.getSnapshot === "function") {
        const snap = window.DailySpaceAgentData.getSnapshot();
        const todos = snap && snap.todo && Array.isArray(snap.todo.todos) ? snap.todo.todos : [];
        return todos.some((item) => item && !item.completed && item.sourceMailId === key);
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  function mailTaskText(message) {
    const subject = String(message?.subject || "").trim() || "(No subject)";
    const summary = String(message?.summary || message?.snippet || "").trim();
    return (summary ? `Mail · ${subject} — ${summary}` : `Mail · ${subject}`).slice(0, 500);
  }

  function showTodayStatus(baseMessage) {
    setInboxStatus(baseMessage);
    if (statusEl) {
      const link = document.createElement("a");
      link.href = "todo.html#today";
      link.className = "mail-today-link";
      link.textContent = "Open Today";
      statusEl.appendChild(document.createTextNode(" "));
      statusEl.appendChild(link);
    }
  }

  function addMailAsTodayTask(message) {
    if (!message) return false;
    if (alreadyAddedMail(message)) {
      showTodayStatus("Already on Today.");
      return false;
    }
    if (window.DailySpaceAgentData && typeof window.DailySpaceAgentData.applyActions === "function") {
      const applied = window.DailySpaceAgentData.applyActions([
        {
          type: "todo_add",
          text: mailTaskText(message),
          dueDate: todayIso(),
          categoryName: null,
          sourceMailId: mailTaskKey(message),
        sourceMailUrl: mailSourceUrl(message),
        },
      ]);
      const ok = Array.isArray(applied) && applied.some((item) => item && item.ok !== false);
      if (!ok) {
        showTodayStatus("Already on Today.");
        markMailAdded(message);
        renderMessages(latestMessages);
        return false;
      }
      markMailAdded(message);
      showTodayStatus("Added to today’s to-do list.");
      renderMessages(latestMessages);
      return true;
    }
    setInboxStatus("Could not add task on this device.", true);
    return false;
  }

  function mailSourceUrl(message) {
    const account = selectedAccount();
    return /gmail|google/i.test(account?.provider || "") ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(account.email)}#all/${encodeURIComponent(message.threadId || message.id)}` : null;
  }

  function addSelectedAsTodayTasks() {
    const selected = latestMessages.filter((item) => selectedMailIds.has(item.id));
    if (!selected.length) {
      setInboxStatus("Select at least one message.", true);
      return;
    }
    if (!(window.DailySpaceAgentData && typeof window.DailySpaceAgentData.applyActions === "function")) {
      setInboxStatus("Could not add tasks on this device.", true);
      return;
    }
    const fresh = selected.filter((message) => !alreadyAddedMail(message));
    if (!fresh.length) {
      showTodayStatus("Selected messages are already on Today.");
      return;
    }
    const applied = window.DailySpaceAgentData.applyActions(
      fresh.map((message) => ({
        type: "todo_add",
        text: mailTaskText(message),
        dueDate: todayIso(),
        categoryName: null,
        sourceMailId: mailTaskKey(message),
        sourceMailUrl: mailSourceUrl(message),
      }))
    );
    const added = Array.isArray(applied) ? applied.filter((item) => item && item.ok !== false).length : 0;
    fresh.forEach(markMailAdded);
    selectedMailIds.clear();
    selecting = false;
    syncBatchBar();
    renderMessages(latestMessages);
    selectToggle?.focus({ preventScroll: true });
    if (!added) {
      showTodayStatus("Selected messages are already on Today.");
      return;
    }
    showTodayStatus(`Added ${added} message${added === 1 ? "" : "s"} to Today.`);
  }

  function setBookingStatus(message, isError) {
    if (!bookingStatus) return;
    bookingStatus.textContent = message || "";
    bookingStatus.classList.toggle("is-error", Boolean(isError));
  }

  function closeBookingSheet() {
    bookingRequestId++;
    if (!bookingSheet) return;
    const wasOpen = !bookingSheet.hidden;
    bookingSheet.hidden = true;
    document.body.classList.remove("mail-booking-open");
    pendingBookingImport = null;
    setBookingStatus("");
    if (wasOpen && detailSheet.hidden) requestAnimationFrame(() => {
      if (!tools.hidden) tools.querySelector("summary")?.focus({ preventScroll: true });
    });
  }

  function bookingMeta(booking) {
    const timing = [booking.startDate, booking.startTime, booking.endDate]
      .filter(Boolean)
      .join(" · ");
    const route =
      booking.kind === "flight"
        ? [booking.origin, booking.destination].filter(Boolean).join(" → ")
        : booking.location;
    return [timing, route, booking.confirmationCode ? `${t("Confirmation", "确认号")} · ${booking.confirmationCode}` : ""]
      .filter(Boolean)
      .join("\n");
  }

  async function openBookingSheet(payload, sourceKey, isCurrent = () => true) {
    if (!bookingSheet || !bookingPreview || !bookingTripSelect || !bookingConfirm) return;
    const bookings = Array.isArray(payload?.bookings) ? payload.bookings : [];
    const pending = { bookings, sourceKey, trips: [] };
    bookingSource.textContent = payload?.source?.subject || t("Booking confirmation", "预订确认");
    bookingPreview.innerHTML = bookings.length
      ? bookings
          .map(
            (booking) => `<article class="mail-booking-card mail-booking-${escapeHtml(booking.kind)}">
              <span class="mail-booking-kind">${escapeHtml(booking.kind)}</span>
              <strong>${escapeHtml(booking.title)}</strong>
              <p>${escapeHtml(bookingMeta(booking))}</p>
            </article>`
          )
          .join("")
      : `<p class="mail-message-empty">${t(
          "No flight, hotel, or restaurant booking was found.",
          "没有识别到航班、酒店或餐厅预订。"
        )}</p>`;

    const travelApi = window.DailySpaceTravelBookings;
    const trips = travelApi?.listTripsForImport
      ? await travelApi.listTripsForImport()
      : travelApi?.listTrips?.() || [];
    if (!isCurrent()) return;
    pending.trips = trips;
    pendingBookingImport = pending;
    bookingTripSelect.innerHTML = trips
      .map((trip) => {
        const suffix = trip.shared ? t("Shared", "共享") : trip.startDate;
        return `<option value="${escapeHtml(trip.id)}">${escapeHtml(trip.name)} · ${escapeHtml(
          suffix
        )}</option>`;
      })
      .join("");
    bookingTripSelect.disabled = trips.length === 0;
    bookingConfirm.disabled = bookings.length === 0 || trips.length === 0;
    if (!trips.length) {
      setBookingStatus(t("Create a trip in Travel first.", "请先在旅行页面创建行程。"), true);
    } else if (!bookings.length) {
      setBookingStatus(t("Nothing to import.", "没有可导入的预订。"), true);
    } else {
      setBookingStatus(
        payload.parsedBy === "fallback"
          ? t("Basic fields found. Review before importing.", "已识别基础信息，请确认后导入。")
          : t("Review the extracted details, then choose a trip.", "请核对识别结果并选择行程。")
      );
    }
    bookingSheet.hidden = false;
    document.body.classList.add("mail-booking-open");
  }

  async function parseMessageBooking(message, button) {
    const account = selectedAccount();
    if (!account || !message?.id) return;
    const requestId = ++bookingRequestId;
    const userId = authUserId;
    const isCurrent = () => requestId === bookingRequestId && userId === authUserId && selectedAccount()?.id === account.id;
    if (button) button.disabled = true;
    setInboxStatus(t("Reading confirmation and PDF attachments…", "正在读取确认邮件与 PDF 附件…"));
    try {
      const lang = window.DailySpaceI18n?.localeTag?.() || document.documentElement.lang || "en";
      const payload = await request(
        `/api/mail/accounts/${encodeURIComponent(account.id)}/messages/${encodeURIComponent(
          message.id
        )}/booking-import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ today: todayIso(), lang }),
        }
      );
      if (!isCurrent()) return;
      await openBookingSheet(payload, `mail-booking:${account.id}:${message.id}`, isCurrent);
      if (isCurrent()) setInboxStatus("");
    } catch (error) {
      if (isCurrent()) setInboxStatus(error.message || t("Booking import failed.", "预订导入失败。"), true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function parseBookingPdf(file) {
    if (!file) return;
    if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setInboxStatus(t("Choose a PDF file.", "请选择 PDF 文件。"), true);
      return;
    }
    if (file.size > 5_000_000) {
      setInboxStatus(t("PDF must be smaller than 5 MB.", "PDF 必须小于 5 MB。"), true);
      return;
    }
    if (importPdfBtn) importPdfBtn.disabled = true;
    const requestId = ++bookingRequestId;
    const userId = authUserId;
    const isCurrent = () => requestId === bookingRequestId && userId === authUserId && signedIn;
    setInboxStatus(t("Reading booking PDF…", "正在读取预订 PDF…"));
    try {
      const pdfBase64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || "").split(",").pop() || "");
        reader.onerror = () => reject(reader.error || new Error("Unable to read PDF."));
        reader.readAsDataURL(file);
      });
      const lang = window.DailySpaceI18n?.localeTag?.() || document.documentElement.lang || "en";
      const payload = await request("/api/mail/booking-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, pdfBase64, today: todayIso(), lang }),
      });
      if (!isCurrent()) return;
      await openBookingSheet(
        payload,
        `pdf-booking:${file.name}:${file.size}:${file.lastModified || 0}`,
        isCurrent
      );
      if (isCurrent()) setInboxStatus("");
    } catch (error) {
      if (isCurrent()) setInboxStatus(error.message || t("PDF import failed.", "PDF 导入失败。"), true);
    } finally {
      if (importPdfBtn) importPdfBtn.disabled = false;
      if (importPdfInput) importPdfInput.value = "";
    }
  }

  async function confirmBookingImport() {
    if (!pendingBookingImport || !bookingTripSelect) return;
    const selected = bookingTripSelect.value;
    const selectedTrip = (pendingBookingImport.trips || []).find((trip) => trip.id === selected);
    const result = await Promise.resolve(
      window.DailySpaceTravelBookings?.importBookings?.({
        tripId: selected,
        bookings: pendingBookingImport.bookings,
        sourceKey: pendingBookingImport.sourceKey,
        trip: selectedTrip,
      })
    );
    if (!result?.ok) {
      setBookingStatus(
        result?.reason && result.reason !== "trip_not_found"
          ? result.reason
          : t("Trip was not found.", "未找到所选行程。"),
        true
      );
      return;
    }
    if (!result.added) {
      setBookingStatus(t("This booking was already imported.", "这条预订已经导入过了。"));
      return;
    }
    setBookingStatus(
      t(
        `Imported ${result.added} booking${result.added === 1 ? "" : "s"} to Travel.`,
        `已导入 ${result.added} 条预订到旅行。`
      )
    );
    bookingConfirm.disabled = true;
  }

  function syncBatchBar() {
    const eligible = latestMessages.filter(message => !alreadyAddedMail(message));
    selectedMailIds = new Set([...selectedMailIds].filter(id => eligible.some(message => message.id === id)));
    if (batchBar) batchBar.hidden = !selecting || !latestMessages.length;
    if (addSelectedBtn) {
      addSelectedBtn.disabled = selectedMailIds.size === 0;
      addSelectedBtn.textContent = t("Add to Today", "添加到今天");
    }
    if (selectedCount) selectedCount.textContent = t(`${selectedMailIds.size} selected`, `已选 ${selectedMailIds.size} 封`);
    if (selectAllEl) {
      selectAllEl.checked = eligible.length > 0 && eligible.every(message => selectedMailIds.has(message.id));
      selectAllEl.indeterminate = selectedMailIds.size > 0 && !selectAllEl.checked;
      selectAllEl.disabled = !eligible.length;
    }
    if (selectToggle) {
      selectToggle.hidden = !latestMessages.length;
      selectToggle.textContent = selecting ? t("Done", "完成") : t("Select", "选择");
      selectToggle.setAttribute("aria-pressed", String(selecting));
    }
    document.body.classList.toggle("mail-selecting", selecting);
  }

  function setSelectionMode(next) {
    selecting = Boolean(next);
    if (!selecting) selectedMailIds.clear();
    renderMessages(latestMessages);
  }

  function renderSwitcher() {
    if (!switcher) return;
    const ready = readyAccounts();
    switcher.hidden = !ready.length;
    switcher.innerHTML = ready.map(account => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.email)}</option>`).join("");
    switcher.value = selectedAccountId;
    switcher.classList.toggle("is-single", ready.length === 1);
  }

  function renderManageAccounts() {
    if (!accountList) return;
    accountList.innerHTML = "";
    accounts.forEach((account) => {
      const ready = account.hasCredentials !== false && !account.needsMailOAuth;
      const row = document.createElement("div");
      row.className = "mail-account-row";
      row.innerHTML = `
        <div>
          <span class="mail-account-provider">${escapeHtml(account.provider)}</span>
          <span class="mail-account-email">${escapeHtml(account.email)}</span>
          <span class="mail-account-meta">${
            ready
              ? `Reading on this device · ${escapeHtml(formatDate(account.connectedAt))}`
              : "Needs mailbox authorization"
          }</span>
        </div>
        <div class="mail-account-actions">
          ${
            ready
              ? ""
              : `<button class="btn mail-reauth-btn" type="button" data-reauth-provider="${escapeHtml(
                  String(account.provider || "").toLowerCase()
                )}" data-reauth-email="${escapeHtml(account.email)}">Authorize reading</button>`
          }
          <button class="mail-disconnect" type="button" data-disconnect="${escapeHtml(account.id)}">Disconnect</button>
        </div>
      `;
      accountList.appendChild(row);
    });
  }

  function renderShell() {
    const ready = readyAccounts();
    const connected = ready.length > 0;
    if (emptyConnect) emptyConnect.hidden = connected;
    if (inboxPanel) inboxPanel.hidden = !connected;
    if (managePanel) managePanel.hidden = !signedIn;
    updateHero();
    renderSwitcher();
    renderManageAccounts();
  }

  function renderMessages(rows) {
    if (!messageList) return;
    const focused = messageList.contains(document.activeElement)
      ? { id: document.activeElement.dataset.openMail || document.activeElement.dataset.mailCheck,
        check: document.activeElement instanceof HTMLInputElement } : null;
    latestMessages = Array.isArray(rows) ? rows : [];
    const validIds = new Set(latestMessages.map(message => message.id));
    selectedMailIds = new Set([...selectedMailIds].filter(id => validIds.has(id)));
    messageList.innerHTML = latestMessages.length ? latestMessages.map(message => {
      const id = escapeHtml(message.id);
      const subject = escapeHtml(message.subject || t("No subject", "无主题"));
      const sender = String(message.from || t("Unknown sender", "未知发件人"));
      const displayName = sender.replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "").trim() || sender;
      const preview = escapeHtml(message.snippet || message.summary || "");
      const added = alreadyAddedMail(message);
      return `<article class="mail-message-item" data-mail-id="${id}">
        <label class="mail-message-check" ${selecting ? "" : "hidden"}>
          <input type="checkbox" data-mail-check="${id}" ${selectedMailIds.has(message.id) ? "checked" : ""} ${added ? "disabled" : ""}
            aria-label="${escapeHtml(t("Select message", "选择邮件"))}: ${subject}" />
        </label>
        <button type="button" class="mail-message-main" data-open-mail="${id}" aria-label="${escapeHtml(t("Open message", "打开邮件"))}: ${subject}">
          <span class="mail-row-meta"><span class="mail-message-from" data-i18n-ignore>${escapeHtml(displayName)}</span>
            <span class="mail-message-time" data-i18n-ignore>${escapeHtml(formatDate(message.receivedAt, true))}</span></span>
          <strong data-i18n-ignore>${subject}</strong>
          ${preview ? `<span class="mail-message-summary" data-i18n-ignore>${preview}</span>` : ""}
          ${added ? `<span class="mail-added-label">${t("On Today", "已在今天")}</span>` : ""}
        </button>
      </article>`;
    }).join("") : `<p class="mail-message-empty">${t("No recent inbox messages.", "暂无最近收件。")}</p>`;
    syncBatchBar();
    syncDetail();
    if (focused?.id) {
      const attribute = focused.check ? "data-mail-check" : "data-open-mail";
      messageList.querySelector(`[${attribute}="${CSS.escape(focused.id)}"]`)?.focus({ preventScroll: true });
    }
  }

  function openDetail(id) {
    if (selecting) {
      const message = latestMessages.find(item => item.id === id);
      if (!message || alreadyAddedMail(message)) return;
      if (selectedMailIds.has(id)) selectedMailIds.delete(id);
      else selectedMailIds.add(id);
      renderMessages(latestMessages);
      return;
    }
    detailId = id;
    syncDetail();
    if (!latestMessages.some(message => message.id === id)) return;
    detailStatus.hidden = true;
    detailSheet.hidden = false;
    document.body.classList.add("mail-detail-open");
  }

  function closeDetail(restore = true) {
    closeBookingSheet();
    const id = detailId;
    detailSheet.hidden = true;
    detailId = "";
    document.body.classList.remove("mail-detail-open");
    if (restore) requestAnimationFrame(() => {
      if (!bookingSheet || bookingSheet.hidden) {
        messageList.querySelector(`[data-open-mail="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      }
    });
  }

  function syncDetail() {
    if (!detailId) return;
    const message = latestMessages.find(item => item.id === detailId);
    if (!message) { closeDetail(); return; }
    detailTitle.textContent = message.subject || t("No subject", "无主题");
    detailFrom.textContent = message.from || t("Unknown sender", "未知发件人");
    detailTime.textContent = formatDate(message.receivedAt);
    detailPreview.textContent = message.snippet || message.summary || t("No preview available.", "暂无邮件预览。");
    const summary = message.summary && message.summary !== message.snippet ? message.summary : "";
    detailSummary.textContent = summary;
    document.getElementById("mail-detail-summary-section").hidden = !summary;
    detailAdd.disabled = alreadyAddedMail(message);
    detailAdd.textContent = detailAdd.disabled ? t("On Today", "已在今天") : t("Add as today’s task", "添加为今日待办");
    detailBooking.hidden = !/(booking|reservation|itinerary|boarding|flight|hotel|airbnb|ticket|预订|預訂|酒店|航班|机票|機票|行程|餐厅|餐廳)/i
      .test(`${message.subject || ""} ${message.snippet || ""}`);
    const original = document.getElementById("mail-detail-original");
    const account = selectedAccount();
    original.hidden = !/gmail|google/i.test(account?.provider || "");
    if (!original.hidden) original.href = `https://mail.google.com/mail/?authuser=${encodeURIComponent(account.email)}#all/${encodeURIComponent(message.threadId || message.id)}`;
    else original.removeAttribute("href");
  }

  async function request(path, init) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const offline = new Error("You’re offline. Connect to refresh mail.");
      offline.code = "offline";
      throw offline;
    }
    const response = await fetch(path, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(payload.error || "Request failed");
      if (payload.code) err.code = payload.code;
      throw err;
    }
    return payload;
  }

  function showMailLoadError(failText, code) {
    const needsReauth = code === "mail_reauth_required" || /reconnect|token missing|not authorized|expired/i.test(failText);
    setInboxStatus(latestMessages.length
      ? t("Could not refresh. Your previous mail and selection are still here.", "刷新失败，已保留原有邮件和选择。")
      : t("Could not load your inbox. Try again.", "暂时无法加载收件箱，请重试。"), true);
    if (!statusEl) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mail-retry-btn";
    button.textContent = needsReauth ? t("Reconnect mailbox", "重新连接邮箱") : t("Retry", "重试");
    button.addEventListener("click", () => {
      if (!needsReauth) return loadMessagesForSelected();
      const account = selectedAccount();
      startOauth(/outlook/i.test(account?.provider || "") ? "outlook" : "gmail", button, account?.email);
    });
    statusEl.appendChild(button);
  }

  async function loadMessagesForSelected(options) {
    const account = selectedAccount();
    if (!account) return;
    if (options?.silent && activeController && displayedAccountId === account.id) return;
    const requestId = ++messagesRequestId;
    activeController?.abort();
    activeController = new AbortController();
    const controller = activeController;
    if (displayedAccountId !== account.id) {
      closeDetail(false);
      selecting = false;
      selectedMailIds.clear();
      displayedAccountId = account.id;
      const cached = inboxCache.get(account.id);
      lastUpdatedAt = cached?.updatedAt || null;
      setAiBanner(Boolean(cached?.unavailable));
      setDigest(cached?.digest || "");
      window.DailySpaceLoop?.writeCachedMailDigest?.(cached?.digest || "", !cached?.unavailable);
      renderMessages(cached?.messages || []);
      updateHero();
      setInboxStatus("");
    }
    if (refreshBtn) { refreshBtn.disabled = true; refreshBtn.classList.add("is-loading"); }
    if (!options?.silent) setInboxStatus(t("Refreshing…", "正在刷新…"));
    try {
      const lang = window.DailySpaceI18n?.localeTag?.() || document.documentElement.lang || "en";
      const payload = await request(`/api/mail/accounts/${encodeURIComponent(account.id)}/digest?limit=12&today=${encodeURIComponent(todayIso())}&lang=${encodeURIComponent(lang)}`, { signal: controller.signal });
      if (requestId !== messagesRequestId || selectedAccount()?.id !== account.id) return;
      const rows = Array.isArray(payload.messages) ? payload.messages : [];
      const unavailable = rows.length > 0 && !payload.summarized;
      lastUpdatedAt = new Date().toISOString();
      inboxCache.set(account.id, { messages: rows, digest: payload.digest || "", unavailable, updatedAt: lastUpdatedAt });
      setAiBanner(unavailable);
      setDigest(payload.digest || "");
      if (window.DailySpaceLoop?.writeCachedMailDigest) {
        window.DailySpaceLoop.writeCachedMailDigest(payload.digest || "", Boolean(payload.summarized));
      }
      renderMessages(rows);
      updateHero();
      setInboxStatus("");
    } catch (error) {
      if (requestId !== messagesRequestId || controller.signal.aborted) return;
      // A failed refresh must not replace a usable inbox, summary or selection.
      showMailLoadError(error.message || "", error.code);
    } finally {
      if (requestId === messagesRequestId) {
        activeController = null;
        if (refreshBtn) { refreshBtn.disabled = false; refreshBtn.classList.remove("is-loading"); }
      }
    }
  }

  function stopMailPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startMailPolling() {
    stopMailPolling();
    if (!readyAccounts().length) return;
    pollTimer = setInterval(() => {
      if (document.hidden) return;
      loadMessagesForSelected({ silent: true });
    }, POLL_MS);
  }

  function ensureSelectedAccount() {
    const ready = readyAccounts();
    if (!ready.length) {
      writeSelectedId("");
      return;
    }
    const preferred = readSelectedId();
    const match = ready.find((account) => account.id === preferred);
    writeSelectedId(match ? match.id : ready[0].id);
  }

  function openDailySpaceSignIn() {
    const entry = document.querySelector(".sidebar-auth-entry");
    if (entry instanceof HTMLElement) {
      entry.click();
      return;
    }
    setPageStatus("Open Menu → Sign in, then come back to Mail.", true);
  }

  function renderSignedOutConnect() {
    signedIn = false;
    accounts = [];
    displayedAccountId = "";
    messagesRequestId++;
    activeController?.abort();
    activeController = null;
    inboxCache.clear();
    lastUpdatedAt = null;
    latestMessages = [];
    selectedMailIds.clear();
    selecting = false;
    closeDetail(false);
    stopMailPolling();
    renderMessages([]);
    for (const element of [detailTitle, detailFrom, detailTime, detailPreview, detailSummary]) element.textContent = "";
    document.getElementById("mail-detail-original")?.removeAttribute("href");
    setAiBanner(false);
    setDigest("");
    window.DailySpaceLoop?.writeCachedMailDigest?.("", false);
    syncBatchBar();
    if (emptyConnect) emptyConnect.hidden = false;
    if (inboxPanel) inboxPanel.hidden = true;
    if (managePanel) managePanel.hidden = true;
    if (connectTitle) connectTitle.textContent = "Connect Gmail";
    if (connectHint) connectHint.textContent = "Connect Gmail to read your inbox and turn messages into tasks.";
    if (signInSpaceBtn) signInSpaceBtn.hidden = false;
    if (oauthQuick) oauthQuick.hidden = true;
    if (switcher) switcher.hidden = true;
    if (tools) tools.open = false;
    updateHero();
    setPageStatus("");
  }

  function renderConnectMailbox() {
    if (connectTitle) connectTitle.textContent = "Connect Gmail";
    if (connectHint) connectHint.textContent = "Connect Gmail to read your inbox and turn messages into tasks.";
    if (signInSpaceBtn) signInSpaceBtn.hidden = true;
    if (oauthQuick) oauthQuick.hidden = false;
  }

  async function loadFromServer() {
    const authId = ++authRequestId;
    const me = await request("/api/auth/me");
    if (authId !== authRequestId) return;
    const nextUser = me?.user?.userId || me?.user?.email || "";
    if (nextUser !== authUserId) {
      renderSignedOutConnect();
      authUserId = nextUser;
    }
    signedIn = Boolean(me?.user);
    if (!signedIn) { renderSignedOutConnect(); return; }
    const payload = await request("/api/mail/accounts");
    if (authId !== authRequestId) return;
    accounts = Array.isArray(payload.accounts) ? payload.accounts : [];
    for (const id of inboxCache.keys()) if (!accounts.some(account => account.id === id)) inboxCache.delete(id);
    ensureSelectedAccount();
    renderConnectMailbox();
    renderShell();
    if (readyAccounts().length) {
      setPageStatus("");
      await loadMessagesForSelected();
      startMailPolling();
    } else {
      stopMailPolling();
      messagesRequestId++;
      activeController?.abort();
      closeDetail(false);
      displayedAccountId = "";
      lastUpdatedAt = null;
      selecting = false;
      selectedMailIds.clear();
      renderMessages([]);
      setAiBanner(false);
      setDigest("");
      setInboxStatus("");
      updateHero();
    }
  }

  function syncGlobalAuth(provider, label, email) {
    const providerLabel = String(provider || "Mail").trim();
    const displayLabel = String(label || email || `${providerLabel} user`).trim();
    const decoratedLabel = email ? `${displayLabel} (${email})` : displayLabel;
    const normalizedProvider = providerLabel.toLowerCase();
    const mailProvider =
      normalizedProvider.includes("gmail") || normalizedProvider.includes("google")
        ? "gmail"
        : normalizedProvider.includes("outlook") || normalizedProvider.includes("microsoft")
          ? "outlook"
          : "";
    try {
      localStorage.setItem(
        STORAGE_AUTH,
        JSON.stringify({
          provider: providerLabel,
          label: decoratedLabel,
          email: String(email || "").trim().toLowerCase(),
          mailProvider,
        })
      );
    } catch (_) {
      /* ignore auth sync failures */
    }
    window.dispatchEvent(new CustomEvent("daily-space-auth-updated"));
  }

  function handleOauthResultFromUrl() {
    const url = new URL(window.location.href);
    const oauth = url.searchParams.get("oauth");
    if (!oauth) return;
    const provider = url.searchParams.get("provider") || "Mail";
    const label = url.searchParams.get("label") || "";
    const email = url.searchParams.get("email") || "";
    const message = url.searchParams.get("message") || "";
    if (oauth === "success") {
      if (provider === "Gmail" || provider === "Outlook") {
        syncGlobalAuth(provider, label, email);
      }
      setPageStatus(`${provider} connected${email ? `: ${email}` : ""}`);
    } else {
      setPageStatus(`${provider} authorization failed${message ? `: ${message}` : ""}`, true);
    }
    url.searchParams.delete("oauth");
    url.searchParams.delete("provider");
    url.searchParams.delete("label");
    url.searchParams.delete("email");
    url.searchParams.delete("message");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  async function startOauth(provider, button, emailHint) {
    if (!(provider === "gmail" || provider === "outlook")) return;
    if (button) button.setAttribute("disabled", "true");
    setPageStatus("");
    try {
      const payload = await request("/api/mail/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          email: emailHint || "",
          returnTo: "/mail.html",
        }),
      });
      if (!payload.authUrl) throw new Error("Authorization URL not returned.");
      window.location.href = payload.authUrl;
    } catch (error) {
      setPageStatus(error.message || "Authorization failed.", true);
    } finally {
      if (button) button.removeAttribute("disabled");
    }
  }

  document.querySelectorAll(".mail-oauth-btn[data-quick-provider]").forEach((button) => {
    button.addEventListener("click", () => {
      const provider = String(button.getAttribute("data-quick-provider") || "")
        .trim()
        .toLowerCase();
      startOauth(provider, button);
    });
  });

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadMessagesForSelected();
    });
  }

  if (selectAllEl) {
    selectAllEl.addEventListener("change", () => {
      if (selectAllEl.checked) {
        latestMessages.forEach((item) => {
          if (item.id) selectedMailIds.add(item.id);
        });
      } else {
        selectedMailIds.clear();
      }
      renderMessages(latestMessages);
    });
  }

  if (addSelectedBtn) {
    addSelectedBtn.addEventListener("click", () => addSelectedAsTodayTasks());
  }

  const askAgentBtn = document.getElementById("mail-ask-agent");
  if (askAgentBtn) {
    askAgentBtn.addEventListener("click", () => askAgentAboutMail());
  }

  importPdfBtn?.addEventListener("click", () => { tools.open = false; importPdfInput?.click(); });
  selectToggle?.addEventListener("click", () => setSelectionMode(!selecting));
  switcher?.addEventListener("change", async () => {
    writeSelectedId(switcher.value);
    updateHero();
    await loadMessagesForSelected();
  });
  detailAdd?.addEventListener("click", () => addMailAsTodayTask(latestMessages.find(message => message.id === detailId)));
  detailBooking?.addEventListener("click", () => parseMessageBooking(latestMessages.find(message => message.id === detailId), detailBooking));
  document.getElementById("mail-detail-close")?.addEventListener("click", () => closeDetail());
  document.getElementById("mail-detail-backdrop")?.addEventListener("click", () => closeDetail());
  importPdfInput?.addEventListener("change", () => parseBookingPdf(importPdfInput.files?.[0]));
  bookingBackdrop?.addEventListener("click", closeBookingSheet);
  bookingClose?.addEventListener("click", closeBookingSheet);
  bookingConfirm?.addEventListener("click", confirmBookingImport);

  if (signInSpaceBtn) {
    signInSpaceBtn.addEventListener("click", async () => {
      if (!window.DailySpaceAuth?.startGoogleSignIn) { openDailySpaceSignIn(); return; }
      signInSpaceBtn.disabled = true;
      try { await window.DailySpaceAuth.startGoogleSignIn(); }
      catch (error) { setPageStatus(error.message || "Google sign-in failed.", true); }
      finally { signInSpaceBtn.disabled = false; }
    });
  }

  window.addEventListener("daily-space-auth-updated", () => {
    messagesRequestId++;
    activeController?.abort();
    activeController = null;
    closeDetail(false);
    loadFromServer().catch(showAccountLoadError);
  });

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (tools?.open && !tools.contains(target)) tools.open = false;
    const openId = target.closest("[data-open-mail]")?.getAttribute("data-open-mail");
    if (openId) { openDetail(openId); return; }

    const reauthBtn = target.closest("[data-mail-reauth], [data-reauth-provider]");
    if (reauthBtn) {
      const providerRaw = reauthBtn.getAttribute("data-reauth-provider") || "";
      const emailHint = reauthBtn.getAttribute("data-reauth-email") || "";
      const provider = providerRaw.includes("outlook")
        ? "outlook"
        : providerRaw.includes("gmail") || providerRaw.includes("google")
          ? "gmail"
          : String(selectedAccount()?.provider || "gmail").toLowerCase().includes("outlook")
            ? "outlook"
            : "gmail";
      const tip = provider === "outlook" ? "outlook" : "gmail";
      const btn = document.querySelector(`.mail-oauth-btn[data-quick-provider="${tip}"]`);
      startOauth(tip, btn, emailHint);
      return;
    }

    const checkId = target.closest("[data-mail-check]")?.getAttribute("data-mail-check");
    if (checkId && target instanceof HTMLInputElement && target.type === "checkbox") {
      if (target.checked) selectedMailIds.add(checkId);
      else selectedMailIds.delete(checkId);
      syncBatchBar();
      return;
    }

    const id = target.closest("[data-disconnect]")?.getAttribute("data-disconnect");
    if (!id) return;
    setPageStatus("");
    try {
      await request(`/api/mail/accounts/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadFromServer();
      setPageStatus("Mailbox disconnected.");
    } catch (error) {
      setPageStatus(error.message || "Failed to disconnect account.", true);
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !readyAccounts().length) return;
    loadMessagesForSelected({ silent: true });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (bookingSheet && !bookingSheet.hidden) closeBookingSheet();
    else if (detailSheet && !detailSheet.hidden) closeDetail();
    else if (tools?.open) tools.open = false;
    else if (selecting) setSelectionMode(false);
  });

  window.addEventListener("daily-space-locale-changed", () => {
    renderShell();
    updateHero();
    setDigest(latestDigest);
    renderMessages(latestMessages);
    if (detailId) syncDetail();
  });

  function showAccountLoadError(error) {
    if (/sign in first/i.test(error.message || "")) { renderSignedOutConnect(); return; }
    setPageStatus(t("Could not check your mailbox. Try again.", "暂时无法连接邮箱，请重试。"), true);
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "mail-retry-btn";
    retry.textContent = t("Retry", "重试");
    retry.addEventListener("click", () => {
      retry.disabled = true;
      loadFromServer().then(() => setPageStatus("")).catch(showAccountLoadError);
    });
    pageStatus?.appendChild(retry);
  }

  renderSignedOutConnect();
  handleOauthResultFromUrl();
  loadFromServer().catch(showAccountLoadError);
})();
