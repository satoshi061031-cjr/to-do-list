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
    membersKicker: "Members",
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
})();
