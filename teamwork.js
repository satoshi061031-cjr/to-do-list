(function () {
  const STORAGE_KEY = "teamwork-page-v1";

  const defaults = {
    kicker: "Teamwork",
    title: "",
    copy: "",
    statusLabel: "",
    statusMain: "",
    statusSub: "",
    focusKicker: "Focus",
    focusTitle: "",
    focusCopy: "",
    notesKicker: "Sync",
    notesTitle: "Team notes",
    notes: "",
    membersKicker: "Local members",
    membersTitle: "Availability",
    tasksKicker: "Tasks",
    tasksTitle: "Member task breakdown",
    members: [],
  };

  let state = loadState();

  const fields = document.querySelectorAll("[data-field]");
  const memberList = document.getElementById("teamwork-member-list");
  const memberForm = document.getElementById("teamwork-member-form");
  const memberNameInput = document.getElementById("teamwork-member-name");
  const memberRoleInput = document.getElementById("teamwork-member-role");
  const taskGrid = document.getElementById("teamwork-task-grid");

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!parsed || typeof parsed !== "object") return cloneDefaults();
      return {
        ...defaults,
        ...parsed,
        members: Array.isArray(parsed.members) ? parsed.members : defaults.members,
      };
    } catch (_) {
      return cloneDefaults();
    }
  }

  function cloneDefaults() {
    return JSON.parse(JSON.stringify(defaults));
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return `member-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function applyFields() {
    fields.forEach((field) => {
      const key = field.dataset.field;
      if (!key) return;
      field.value = state[key] || "";
    });
  }

  function updateField(event) {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
    const key = field.dataset.field;
    if (!key) return;
    state[key] = field.value;
    saveState();
  }

  function renderMembers() {
    if (!memberList) return;
    memberList.innerHTML = "";
    const emptyHint = document.getElementById("teamwork-members-empty");
    if (emptyHint) emptyHint.hidden = state.members.length > 0;
    state.members.forEach((member) => {
      const row = document.createElement("div");
      row.className = "teamwork-member-row";
      row.innerHTML = `
        <input class="teamwork-member-input" aria-label="Member name" value="${escapeHtml(member.name)}" data-member-name="${member.id}" />
        <input class="teamwork-member-input teamwork-member-role" aria-label="Member role" value="${escapeHtml(member.role)}" data-member-role="${member.id}" />
        <button class="teamwork-delete-btn" type="button" data-delete-member="${member.id}" aria-label="Delete ${escapeHtml(member.name)}">×</button>
      `;
      memberList.appendChild(row);
    });
  }

  function renderTasks() {
    if (!taskGrid) return;
    taskGrid.innerHTML = "";
    state.members.forEach((member) => {
      const column = document.createElement("article");
      column.className = "teamwork-task-column";
      column.innerHTML = `
        <div class="teamwork-task-head">
          <div>
            <p class="teamwork-kicker" data-i18n-ignore="true">${escapeHtml(member.role || "Member")}</p>
            <h3 data-i18n-ignore="true">${escapeHtml(member.name || "Unnamed")}</h3>
          </div>
        </div>
        <ul class="teamwork-task-list">
          ${(member.tasks || [])
            .map(
              (task, index) => `
                <li class="teamwork-task-item">
                  <input class="teamwork-task-input" value="${escapeHtml(task)}" data-task-member="${member.id}" data-task-index="${index}" aria-label="Task for ${escapeHtml(member.name)}" />
                  <button class="teamwork-delete-btn" type="button" data-delete-task-member="${member.id}" data-delete-task-index="${index}" aria-label="Delete task">×</button>
                </li>
              `
            )
            .join("")}
        </ul>
        <form class="teamwork-add-task-form" data-add-task="${member.id}" autocomplete="off">
          <input class="teamwork-form-input" placeholder="Add task..." />
          <button class="btn btn-primary" type="submit">Add</button>
        </form>
      `;
      taskGrid.appendChild(column);
    });
  }

  function render() {
    renderMembers();
    renderTasks();
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

  fields.forEach((field) => {
    field.addEventListener("input", updateField);
  });

  if (memberForm && memberNameInput && memberRoleInput) {
    memberForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const name = memberNameInput.value.trim();
      const role = memberRoleInput.value.trim();
      if (!name) {
        memberNameInput.focus();
        return;
      }
      state.members.push({ id: uid(), name, role: role || "Member", tasks: [] });
      memberNameInput.value = "";
      memberRoleInput.value = "";
      saveState();
      render();
    });
  }

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const memberNameId = target.dataset.memberName;
    const memberRoleId = target.dataset.memberRole;
    const taskMemberId = target.dataset.taskMember;
    const taskIndex = Number(target.dataset.taskIndex);

    if (memberNameId || memberRoleId) {
      const member = state.members.find((item) => item.id === (memberNameId || memberRoleId));
      if (!member) return;
      if (memberNameId) member.name = target.value;
      if (memberRoleId) member.role = target.value;
      saveState();
      renderTasks();
      return;
    }

    if (taskMemberId && Number.isInteger(taskIndex)) {
      const member = state.members.find((item) => item.id === taskMemberId);
      if (!member || !member.tasks) return;
      member.tasks[taskIndex] = target.value;
      saveState();
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const deleteMemberId = target.getAttribute("data-delete-member");
    if (deleteMemberId) {
      state.members = state.members.filter((member) => member.id !== deleteMemberId);
      saveState();
      render();
      return;
    }

    const deleteTaskMemberId = target.getAttribute("data-delete-task-member");
    const deleteTaskIndex = Number(target.getAttribute("data-delete-task-index"));
    if (deleteTaskMemberId && Number.isInteger(deleteTaskIndex)) {
      const member = state.members.find((item) => item.id === deleteTaskMemberId);
      if (!member || !member.tasks) return;
      member.tasks.splice(deleteTaskIndex, 1);
      saveState();
      render();
    }
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const memberId = form.dataset.addTask;
    if (!memberId) return;
    event.preventDefault();
    const input = form.querySelector("input");
    if (!(input instanceof HTMLInputElement)) return;
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    const member = state.members.find((item) => item.id === memberId);
    if (!member) return;
    if (!Array.isArray(member.tasks)) member.tasks = [];
    member.tasks.push(text);
    input.value = "";
    saveState();
    render();
  });

  window.addEventListener("daily-space-agent-data-updated", (event) => {
    const domains = Array.isArray(event.detail?.domains) ? event.detail.domains : [];
    if (!domains.includes("teamwork")) return;
    state = loadState();
    applyFields();
    render();
  });

  window.addEventListener("daily-space-locale-changed", () => render());

  applyFields();
  render();
  initWorkspacePanel();
})();

function initWorkspacePanel() {
  const STORAGE_SELECTED = "daily-space-selected-workspace-v1";
  const STORAGE_AUTH = "daily-space-auth-v1";

  const signedOut = document.getElementById("teamwork-workspace-signed-out");
  const signedIn = document.getElementById("teamwork-workspace-signed-in");
  const statusEl = document.getElementById("teamwork-workspace-status");
  const createForm = document.getElementById("teamwork-workspace-create");
  const nameInput = document.getElementById("teamwork-workspace-name");
  const switchWrap = document.getElementById("teamwork-workspace-switch");
  const selectEl = document.getElementById("teamwork-workspace-select");
  const activeWrap = document.getElementById("teamwork-workspace-active");
  const cloudMembers = document.getElementById("teamwork-cloud-members");
  const inviteForm = document.getElementById("teamwork-invite-form");
  const inviteEmail = document.getElementById("teamwork-invite-email");
  const inviteRole = document.getElementById("teamwork-invite-role");
  const inviteLink = document.getElementById("teamwork-invite-link");
  const pendingList = document.getElementById("teamwork-pending-invites");
  const roleLine = document.getElementById("teamwork-role-line");
  const workspaceActions = document.getElementById("teamwork-workspace-actions");
  const leaveBtn = document.getElementById("teamwork-leave-workspace");
  const deleteWorkspaceBtn = document.getElementById("teamwork-delete-workspace");

  let workspaces = [];
  let selectedId = "";
  let sessionUser = null;

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

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.classList.toggle("is-error", Boolean(isError));
  }

  function readSelectedId() {
    try {
      return String(localStorage.getItem(STORAGE_SELECTED) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function writeSelectedId(id) {
    selectedId = String(id || "").trim();
    try {
      if (selectedId) localStorage.setItem(STORAGE_SELECTED, selectedId);
      else localStorage.removeItem(STORAGE_SELECTED);
    } catch (_) {
      /* ignore */
    }
  }

  async function request(path, init) {
    const response = await fetch(path, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }
    return payload;
  }

  async function refreshSession() {
    try {
      const payload = await request("/api/auth/me");
      sessionUser = payload.user || null;
    } catch (_) {
      sessionUser = null;
    }
    if (!sessionUser) {
      try {
        const cached = JSON.parse(localStorage.getItem(STORAGE_AUTH) || "null");
        if (cached && cached.email) {
          /* UI may show signed-in locally, but APIs need cookie session */
        }
      } catch (_) {
        /* ignore */
      }
    }
    return sessionUser;
  }

  function renderWorkspaceShell() {
    const hasSession = Boolean(sessionUser && sessionUser.userId);
    if (signedOut) signedOut.hidden = hasSession;
    if (signedIn) signedIn.hidden = !hasSession;
    if (!hasSession) {
      if (switchWrap) switchWrap.hidden = true;
      if (activeWrap) activeWrap.hidden = true;
    }
  }

  function selectedWorkspace() {
    return workspaces.find((item) => item.id === selectedId) || workspaces[0] || null;
  }

  function renderSelect() {
    if (!selectEl || !switchWrap) return;
    const createForm = document.getElementById("teamwork-workspace-create");
    const showCreateBtn = document.getElementById("teamwork-show-create");
    if (!workspaces.length) {
      switchWrap.hidden = true;
      selectEl.innerHTML = "";
      if (createForm) createForm.classList.remove("is-collapsed");
      if (showCreateBtn) showCreateBtn.hidden = true;
      return;
    }
    switchWrap.hidden = false;
    selectEl.innerHTML = workspaces
      .map((item) => {
        const selected = item.id === selectedId ? " selected" : "";
        return `<option value="${escapeHtml(item.id)}"${selected}>${escapeHtml(item.name)}</option>`;
      })
      .join("");
    if (createForm) createForm.classList.add("is-collapsed");
    if (showCreateBtn) showCreateBtn.hidden = false;
  }

  function capsFor(workspace) {
    return (
      workspace?.capabilities || {
        invite: workspace?.role === "owner" || workspace?.role === "admin",
        inviteAdmin: workspace?.role === "owner",
        manageMembers: workspace?.role === "owner" || workspace?.role === "admin",
        changeRoles: workspace?.role === "owner",
        manageBoards: workspace?.role === "owner" || workspace?.role === "admin",
        deleteWorkspace: workspace?.role === "owner",
      }
    );
  }

  function renderCloudMembers(members) {
    if (!cloudMembers) return;
    const workspace = selectedWorkspace();
    const caps = capsFor(workspace);
    const me = String(sessionUser?.userId || sessionUser?.email || "").trim().toLowerCase();
    const active = (members || []).filter((item) => item.status === "active");
    if (!active.length) {
      cloudMembers.innerHTML = `<p class="teamwork-workspace-hint">No members yet.</p>`;
      return;
    }
    cloudMembers.innerHTML = `
      <p class="teamwork-kicker">Members</p>
      <ul class="teamwork-cloud-member-list">
        ${active
          .map((member) => {
            const isMe = member.userId === me;
            const canRemove =
              caps.manageMembers &&
              !isMe &&
              member.role !== "owner" &&
              (member.role !== "admin" || caps.changeRoles);
            const canChangeRole = caps.changeRoles && !isMe && member.role !== "owner";
            const roleControl = canChangeRole
              ? `<select class="teamwork-role-select" data-member-role="${escapeHtml(member.userId)}" aria-label="Role for ${escapeHtml(member.label || member.userId)}">
                  <option value="member"${member.role === "member" ? " selected" : ""}>Member</option>
                  <option value="admin"${member.role === "admin" ? " selected" : ""}>Admin</option>
                </select>`
              : `<em data-i18n-ignore="true">${escapeHtml(member.role)}</em>`;
            const removeBtn = canRemove
              ? `<button type="button" class="teamwork-member-remove" data-remove-member="${escapeHtml(member.userId)}" aria-label="Remove ${escapeHtml(member.label || member.userId)}">Remove</button>`
              : "";
            return `
              <li class="teamwork-cloud-member-row">
                <div class="teamwork-cloud-member-meta">
                  <strong data-i18n-ignore="true">${escapeHtml(member.label || member.userId)}${isMe ? " (you)" : ""}</strong>
                  <span data-i18n-ignore="true">${escapeHtml(member.userId)}</span>
                </div>
                <div class="teamwork-cloud-member-controls">
                  ${roleControl}
                  ${removeBtn}
                </div>
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }

  function renderPendingInvites(invites) {
    if (!pendingList) return;
    const rows = Array.isArray(invites) ? invites : [];
    if (!rows.length) {
      pendingList.innerHTML = "";
      return;
    }
    pendingList.innerHTML = rows
      .map((invite) => {
        const url = `${window.location.origin}/teamwork.html?invite=${encodeURIComponent(invite.token)}`;
        return `<li>
          <span data-i18n-ignore="true">${escapeHtml(invite.email)} · ${escapeHtml(invite.role || "member")}</span>
          <div class="teamwork-pending-actions">
            <button type="button" class="teamwork-copy-invite" data-invite-url="${escapeHtml(url)}">Copy invite link</button>
            <button type="button" class="teamwork-revoke-invite" data-revoke-invite="${escapeHtml(invite.id)}">Revoke</button>
          </div>
        </li>`;
      })
      .join("");
  }

  function renderAssignmentSummary(summary) {
    const wrap = document.getElementById("teamwork-assignment-summary");
    const list = document.getElementById("teamwork-assignment-list");
    if (!wrap || !list) return;
    const rows = Array.isArray(summary) ? summary : [];
    const totalOpen = rows.reduce((sum, row) => sum + (Array.isArray(row.tasks) ? row.tasks.length : 0), 0);
    wrap.hidden = false;
    if (!totalOpen) {
      list.innerHTML = `<li class="is-empty">
        <strong>No shared board tasks yet</strong>
        <span>0 open</span>
        <em>Open Planner → Team boards, add a card, then pick an assignee.</em>
      </li>`;
      return;
    }
    list.innerHTML = rows
      .filter((row) => (row.tasks || []).length > 0 || row.kind === "unassigned")
      .map((row) => {
        const count = Array.isArray(row.tasks) ? row.tasks.length : 0;
        const titles = (row.tasks || [])
          .slice(0, 4)
          .map((task) => escapeHtml(task.title || "Untitled"))
          .join(" · ");
        return `<li class="${row.kind === "unassigned" ? "is-unassigned" : ""}">
          <strong data-i18n-ignore="true">${escapeHtml(row.label || row.userId || "Unassigned")}</strong>
          <span>${count} open</span>
          <em data-i18n-ignore="true">${titles || "No open assignments"}</em>
        </li>`;
      })
      .join("");
  }

  async function loadActiveWorkspaceDetails() {
    const workspace = selectedWorkspace();
    if (!workspace || !activeWrap) {
      if (activeWrap) activeWrap.hidden = true;
      return;
    }
    activeWrap.hidden = false;
    const caps = capsFor(workspace);
    if (roleLine) {
      roleLine.hidden = false;
      roleLine.textContent = `Your role: ${workspace.role || "member"}`;
    }
    if (inviteForm) inviteForm.hidden = !caps.invite;
    if (inviteRole) {
      inviteRole.hidden = !caps.inviteAdmin;
      if (!caps.inviteAdmin) inviteRole.value = "member";
    }
    if (workspaceActions) {
      workspaceActions.hidden = false;
      if (leaveBtn) leaveBtn.hidden = workspace.role === "owner";
      if (deleteWorkspaceBtn) deleteWorkspaceBtn.hidden = !caps.deleteWorkspace;
    }
    try {
      const membersPayload = await request(`/api/workspaces/${encodeURIComponent(workspace.id)}/members`);
      renderCloudMembers(membersPayload.members || []);
      if (caps.invite) {
        const invitesPayload = await request(`/api/workspaces/${encodeURIComponent(workspace.id)}/invites`);
        renderPendingInvites(invitesPayload.invites || []);
      } else if (pendingList) {
        pendingList.innerHTML = "";
      }
      const summaryPayload = await request(`/api/workspaces/${encodeURIComponent(workspace.id)}/task-summary`);
      renderAssignmentSummary(summaryPayload.summary || []);
    } catch (error) {
      setStatus(error.message || "Failed to load workspace members.", true);
    }
  }

  async function loadWorkspaces() {
    const payload = await request("/api/workspaces");
    workspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
    const preferred = readSelectedId();
    const match = workspaces.find((item) => item.id === preferred);
    writeSelectedId(match ? match.id : workspaces[0]?.id || "");
    renderSelect();
    await loadActiveWorkspaceDetails();
  }

  async function handleInviteFromUrl() {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("invite");
    if (!token) return;
    try {
      const preview = await request(`/api/invites/${encodeURIComponent(token)}`);
      if (!sessionUser) {
        setStatus(`Sign in as ${preview.invite.email} to join ${preview.invite.workspaceName}.`, true);
        return;
      }
      const accepted = await request("/api/invites/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      writeSelectedId(accepted.workspace?.id || "");
      setStatus(`Joined ${accepted.workspace?.name || "workspace"}.`);
      await loadWorkspaces();
    } catch (error) {
      setStatus(error.message || "Unable to accept invite.", true);
    } finally {
      url.searchParams.delete("invite");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }

  if (createForm && nameInput) {
    createForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      setStatus("");
      try {
        const payload = await request("/api/workspaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        nameInput.value = "";
        writeSelectedId(payload.workspace?.id || "");
        setStatus(`Created ${payload.workspace?.name || "workspace"}.`);
        await loadWorkspaces();
      } catch (error) {
        setStatus(error.message || "Failed to create workspace.", true);
      }
    });
  }

  const showCreateBtn = document.getElementById("teamwork-show-create");
  if (showCreateBtn && createForm) {
    showCreateBtn.addEventListener("click", () => {
      createForm.classList.remove("is-collapsed");
      showCreateBtn.hidden = true;
      nameInput?.focus();
    });
  }

  if (selectEl) {
    selectEl.addEventListener("change", async () => {
      writeSelectedId(selectEl.value);
      if (inviteLink) {
        inviteLink.hidden = true;
        inviteLink.textContent = "";
      }
      setStatus("");
      await loadActiveWorkspaceDetails();
    });
  }

  if (inviteForm && inviteEmail) {
    inviteForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const workspace = selectedWorkspace();
      if (!workspace) return;
      const email = inviteEmail.value.trim();
      if (!email) {
        inviteEmail.focus();
        return;
      }
      const role = inviteRole && !inviteRole.hidden ? inviteRole.value : "member";
      setStatus("");
      try {
        const payload = await request(`/api/workspaces/${encodeURIComponent(workspace.id)}/invites`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, role }),
        });
        inviteEmail.value = "";
        if (inviteRole) inviteRole.value = "member";
        const path = payload.invite?.invitePath || `/teamwork.html?invite=${payload.invite?.token || ""}`;
        const full = `${window.location.origin}${path}`;
        if (inviteLink) {
          inviteLink.hidden = false;
          inviteLink.innerHTML = `Invite link for <span data-i18n-ignore="true">${escapeHtml(payload.invite.email)}</span>: <a href="${escapeHtml(full)}" data-i18n-ignore="true">${escapeHtml(full)}</a>`;
        }
        setStatus(`Invite created for ${payload.invite.email}.`);
        await loadActiveWorkspaceDetails();
      } catch (error) {
        setStatus(error.message || "Failed to create invite.", true);
      }
    });
  }

  if (leaveBtn) {
    leaveBtn.addEventListener("click", async () => {
      const workspace = selectedWorkspace();
      if (!workspace) return;
      if (!window.confirm(`Leave “${workspace.name}”?`)) return;
      try {
        await request(`/api/workspaces/${encodeURIComponent(workspace.id)}/leave`, { method: "POST" });
        setStatus(`Left ${workspace.name}.`);
        await loadWorkspaces();
      } catch (error) {
        setStatus(error.message || "Failed to leave workspace.", true);
      }
    });
  }

  if (deleteWorkspaceBtn) {
    deleteWorkspaceBtn.addEventListener("click", async () => {
      const workspace = selectedWorkspace();
      if (!workspace) return;
      if (!window.confirm(`Delete workspace “${workspace.name}”? This cannot be undone.`)) return;
      try {
        await request(`/api/workspaces/${encodeURIComponent(workspace.id)}`, { method: "DELETE" });
        setStatus(`Deleted ${workspace.name}.`);
        writeSelectedId("");
        await loadWorkspaces();
      } catch (error) {
        setStatus(error.message || "Failed to delete workspace.", true);
      }
    });
  }

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const copyBtn = target.closest("[data-invite-url]");
    if (copyBtn) {
      const url = copyBtn.getAttribute("data-invite-url");
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        setStatus("Invite link copied.");
      } catch (_) {
        setStatus(url);
      }
      return;
    }
    const revokeBtn = target.closest("[data-revoke-invite]");
    if (revokeBtn) {
      const workspace = selectedWorkspace();
      const inviteId = revokeBtn.getAttribute("data-revoke-invite");
      if (!workspace || !inviteId) return;
      try {
        await request(
          `/api/workspaces/${encodeURIComponent(workspace.id)}/invites/${encodeURIComponent(inviteId)}`,
          { method: "DELETE" }
        );
        setStatus("Invite revoked.");
        await loadActiveWorkspaceDetails();
      } catch (error) {
        setStatus(error.message || "Failed to revoke invite.", true);
      }
      return;
    }
    const removeBtn = target.closest("[data-remove-member]");
    if (removeBtn) {
      const workspace = selectedWorkspace();
      const userId = removeBtn.getAttribute("data-remove-member");
      if (!workspace || !userId) return;
      if (!window.confirm(`Remove ${userId} from this workspace?`)) return;
      try {
        await request(
          `/api/workspaces/${encodeURIComponent(workspace.id)}/members/${encodeURIComponent(userId)}`,
          { method: "DELETE" }
        );
        setStatus("Member removed.");
        await loadActiveWorkspaceDetails();
      } catch (error) {
        setStatus(error.message || "Failed to remove member.", true);
      }
    }
  });

  document.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) return;
    const userId = target.getAttribute("data-member-role");
    if (!userId) return;
    const workspace = selectedWorkspace();
    if (!workspace) return;
    try {
      await request(
        `/api/workspaces/${encodeURIComponent(workspace.id)}/members/${encodeURIComponent(userId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: target.value }),
        }
      );
      setStatus("Role updated.");
      await loadActiveWorkspaceDetails();
    } catch (error) {
      setStatus(error.message || "Failed to update role.", true);
      await loadActiveWorkspaceDetails();
    }
  });

  window.addEventListener("daily-space-auth-updated", () => {
    boot();
  });

  async function boot() {
    setStatus("");
    await refreshSession();
    renderWorkspaceShell();
    if (!sessionUser) return;
    try {
      await loadWorkspaces();
      await handleInviteFromUrl();
    } catch (error) {
      setStatus(error.message || "Failed to load workspaces.", true);
    }
  }

  boot();
}