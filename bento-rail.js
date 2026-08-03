/**
 * Persistent left rail / mobile dock — same primary pages as sidebar (theme.js):
 * Todo / Calendar / Planner / Mail / Tally + Menu. Teamwork stays under More.
 */
(function () {
  const ICON = {
    todo:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    calendar:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    planner:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 6h16M4 12h10M4 18h14"/></svg>',
    mail:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 7 9-7"/></svg>',
    tally:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 19V5M4 19h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/></svg>',
    menu:
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M4 12h10M4 17h14"/><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>',
  };

  function isNarrow() {
    return window.matchMedia("(max-width: 819px)").matches;
  }

  function todoHref() {
    const file = ((location.pathname || "").split("/").pop() || "").toLowerCase();
    const onMobileTodo = file.includes("todo-m");
    return isNarrow() || onMobileTodo ? "todo-m.html#today" : "todo.html#today";
  }

  const LINKS = [
    { id: "todo", href: "todo.html#today", title: "Todo", icon: ICON.todo },
    { id: "calendar", href: "calendar.html", title: "Calendar", icon: ICON.calendar },
    { id: "planner", href: "planner.html", title: "Planner", icon: ICON.planner },
    { id: "mail", href: "mail.html", title: "Mail", icon: ICON.mail },
    { id: "tally", href: "tally.html", title: "Tally book", icon: ICON.tally },
  ];
  const RAIL_PAGES_KEY = `${LINKS.map((item) => item.id).join(",")}|v3`;

  function pageId() {
    const path = (location.pathname || "").toLowerCase();
    const file = path.split("/").pop() || "";
    if (file.includes("calendar")) return "calendar";
    if (file.includes("planner")) return "planner";
    if (file.includes("mail")) return "mail";
    if (file.includes("tally")) return "tally";
    if (file.includes("teamwork")) return "teamwork";
    if (file.includes("todo-m") || file.includes("todo") || file === "" || file === "index.html") {
      return "todo";
    }
    return "";
  }

  function readAuthLabel() {
    try {
      const parsed = JSON.parse(localStorage.getItem("daily-space-auth-v1") || "null");
      if (!parsed || typeof parsed !== "object") return { letter: "S", title: "Daily Space" };
      let name = typeof parsed.label === "string" ? parsed.label.trim() : "";
      name = name.replace(/\s*\([^)]*@[^)]*\)\s*$/, "").trim();
      if (!name && typeof parsed.email === "string") {
        name = String(parsed.email).split("@")[0].trim();
      }
      const ch = name ? Array.from(name)[0] : "";
      if (!ch) return { letter: "S", title: "Daily Space" };
      const letter = /[a-z]/i.test(ch) ? ch.toUpperCase() : ch;
      return { letter, title: name || "Daily Space" };
    } catch (_) {
      return { letter: "S", title: "Daily Space" };
    }
  }

  function syncBrandMark(rail) {
    const brand = (rail || document).querySelector(".bento-rail-brand");
    if (!brand) return;
    const { letter, title } = readAuthLabel();
    let mark = brand.querySelector("[data-rail-brand-letter]");
    if (!mark) {
      mark = document.createElement("span");
      mark.setAttribute("data-rail-brand-letter", "");
      mark.setAttribute("aria-hidden", "true");
      brand.replaceChildren(mark);
    }
    mark.textContent = letter;
    brand.title = title;
    brand.setAttribute("aria-label", title);
  }

  /** Pin EN/中 beside theme on the rail — never inside page links (matches desktop). */
  function dockLanguageToggle(rail) {
    const hostRail = rail || document.querySelector(".bento-rail");
    if (!hostRail) return;
    const lang = document.getElementById("language-toggle");
    if (!lang) return;
    lang.classList.add("bento-rail-lang");
    if (!hostRail.contains(lang)) {
      const theme = hostRail.querySelector(".bento-rail-theme, #theme-toggle");
      if (theme) hostRail.insertBefore(lang, theme);
      else hostRail.appendChild(lang);
    }
  }

  function syncNavLinks(nav) {
    if (!(nav instanceof HTMLElement)) return;
    const needsRebuild =
      nav.dataset.railPages !== RAIL_PAGES_KEY ||
      !nav.querySelector("#bento-menu-toggle") ||
      LINKS.some((item) => !nav.querySelector(`[data-rail-page="${item.id}"]`));
    if (!needsRebuild) {
      const todoLink = nav.querySelector('.bento-rail-link[data-rail-page="todo"]');
      if (todoLink) todoLink.setAttribute("href", todoHref());
      return;
    }
    nav.innerHTML = buildNavHtml();
    nav.dataset.railPages = RAIL_PAGES_KEY;
    const menuBtn = nav.querySelector("#bento-menu-toggle");
    if (menuBtn) delete menuBtn.dataset.railWired;
  }

  function syncExpanded(open) {
    const expanded = open ? "true" : "false";
    const trigger = document.getElementById("sidebar-trigger");
    const menuBtn = document.getElementById("bento-menu-toggle");
    if (trigger) trigger.setAttribute("aria-expanded", expanded);
    if (menuBtn) menuBtn.setAttribute("aria-expanded", expanded);
  }

  function setSidebarOpen(open) {
    const sidebar = document.getElementById("sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (!sidebar) return;
    sidebar.classList.toggle("is-open", open);
    sidebar.classList.remove("is-auto-open");
    if (backdrop) {
      backdrop.hidden = !open;
      backdrop.classList.toggle("is-visible", open);
    }
    document.body.classList.toggle("sidebar-drawer-open", open);
    syncExpanded(open);
  }

  function toggleSidebar() {
    const sidebar = document.getElementById("sidebar");
    if (!sidebar) return;
    setSidebarOpen(!sidebar.classList.contains("is-open"));
  }

  function markCurrent(rail) {
    const current = pageId();
    rail.querySelectorAll(".bento-rail-link[data-rail-page]").forEach((link) => {
      const active = link.getAttribute("data-rail-page") === current;
      link.classList.toggle("is-current", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function buildNavHtml() {
    const links = LINKS.map((item) => {
      const href = item.id === "todo" ? todoHref() : item.href;
      return (
        `<a href="${href}" class="bento-rail-link" data-rail-page="${item.id}" title="${item.title}">` +
        item.icon +
        `<span class="bento-rail-sr">${item.title}</span></a>`
      );
    }).join("");
    const menuBtn =
      `<button type="button" class="bento-rail-link" id="bento-menu-toggle" aria-controls="sidebar" aria-expanded="false" title="Menu">` +
      ICON.menu +
      `<span class="bento-rail-sr">Menu</span></button>`;
    return links + menuBtn;
  }

  function ensureRail() {
    const layout = document.querySelector(".layout");
    if (!layout || !document.getElementById("sidebar")) return null;

    document.body.classList.add("has-bento-rail");

    let rail = document.querySelector(".bento-rail");
    if (!rail) {
      rail = document.createElement("nav");
      rail.className = "bento-rail";
      rail.setAttribute("aria-label", "Pages");
      rail.innerHTML =
        `<a class="bento-rail-brand" href="${todoHref()}" title="Daily Space" aria-label="Daily Space"><span data-rail-brand-letter aria-hidden="true">S</span></a>` +
        `<div class="bento-rail-nav" data-rail-pages="${RAIL_PAGES_KEY}">${buildNavHtml()}</div>`;
      layout.insertBefore(rail, layout.firstChild);
    } else {
      let nav = rail.querySelector(".bento-rail-nav");
      if (!nav) {
        nav = document.createElement("div");
        nav.className = "bento-rail-nav";
        rail.appendChild(nav);
      }
      syncNavLinks(nav);
      const brand = rail.querySelector(".bento-rail-brand");
      if (brand) brand.setAttribute("href", todoHref());
      // Prefer stable menu id
      const legacy = document.getElementById("bento-cat-toggle");
      if (legacy && !document.getElementById("bento-menu-toggle")) {
        legacy.id = "bento-menu-toggle";
      }
    }

    syncBrandMark(rail);

    let toggle = document.getElementById("theme-toggle");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "theme-toggle";
      toggle.id = "theme-toggle";
      toggle.setAttribute("aria-pressed", "false");
      toggle.innerHTML =
        `<span class="theme-toggle-icon" aria-hidden="true">D</span>` +
        `<span class="theme-toggle-label">Dark</span>`;
      document.body.appendChild(toggle);
    }

    toggle.classList.remove("m-theme-float");
    toggle.classList.add("bento-rail-theme");
    // Theme sits on the rail (sibling of nav), same as desktop — not inside page links.
    if (!rail.contains(toggle)) rail.appendChild(toggle);

    dockLanguageToggle(rail);

    markCurrent(rail);
    if (window.DailySpaceAgentUi && typeof window.DailySpaceAgentUi.mountFabUnderBrand === "function") {
      window.DailySpaceAgentUi.mountFabUnderBrand();
    } else {
      document.dispatchEvent(new CustomEvent("dailyspace:bento-rail-ready"));
    }
    return rail;
  }

  function wire() {
    const rail = ensureRail();
    if (!rail) return;

    const menuBtn = document.getElementById("bento-menu-toggle");
    if (menuBtn && !menuBtn.dataset.railWired) {
      menuBtn.dataset.railWired = "1";
      menuBtn.addEventListener("click", (event) => {
        event.preventDefault();
        toggleSidebar();
      });
    }

    const backdrop = document.getElementById("sidebar-backdrop");
    if (backdrop && !backdrop.dataset.railWired) {
      backdrop.dataset.railWired = "1";
      backdrop.addEventListener("click", () => setSidebarOpen(false));
    }

    if (!document.documentElement.dataset.bentoRailAuthWired) {
      document.documentElement.dataset.bentoRailAuthWired = "1";
      window.addEventListener("daily-space-auth-updated", () => {
        syncBrandMark(document.querySelector(".bento-rail"));
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const sidebar = document.getElementById("sidebar");
      if (sidebar && sidebar.classList.contains("is-open")) setSidebarOpen(false);
    });
  }

  function wireLanguageWhenReady() {
    dockLanguageToggle(document.querySelector(".bento-rail"));
    if (document.getElementById("language-toggle")) return;
    const observer = new MutationObserver(() => {
      if (!document.getElementById("language-toggle")) return;
      dockLanguageToggle(document.querySelector(".bento-rail"));
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      wire();
      wireLanguageWhenReady();
    });
  } else {
    wire();
    wireLanguageWhenReady();
  }

  window.addEventListener("resize", () => {
    dockLanguageToggle(document.querySelector(".bento-rail"));
  });

  window.DailySpaceBentoRail = {
    toggleSidebar,
    setSidebarOpen,
    pageId,
    syncBrandMark,
    dockLanguageToggle,
  };
})();
