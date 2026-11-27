(() => {
  const panel = document.getElementById("watch-pairing");
  const pair = document.getElementById("watch-pair");
  const revoke = document.getElementById("watch-revoke");
  const status = document.getElementById("watch-status");
  const t = (en, zh) => window.DailySpaceI18n?.t(en, zh) || en;
  let revision = 0, expires;
  let previousOwner = window.DailySpaceView.owner();
  function clear() {
    revision++;
    clearTimeout(expires);
    status.textContent = "";
    pair.disabled = revoke.disabled = false;
  }
  async function update(method) {
    clear();
    const request = revision, owner = window.DailySpaceView.owner();
    pair.disabled = revoke.disabled = true;
    const current = () => request === revision && owner === window.DailySpaceView.owner();
    try {
      const response = await fetch("/api/watch/pairing", { method, credentials: "same-origin", cache: "no-store" });
      if (!current()) return;
      if (response.status === 401) {
        status.textContent = t("Sign in to your dayfly account first.", "请先登录 dayfly 账户。");
        return;
      }
      if (!response.ok) throw new Error();
      if (method === "DELETE") {
        status.textContent = t("Watch access and pending codes removed.", "已解除手表配对，未使用的配对码也已失效。");
        return;
      }
      const { code, expiresAt } = await response.json();
      if (!current()) return;
      status.textContent = t(`Enter ${code} in dayfly on your watch within 10 minutes.`, `请在 10 分钟内打开手表上的 dayfly，输入 ${code}。`);
      expires = setTimeout(() => {
        if (current()) status.textContent = t("Code expired. Generate a new one if needed.", "配对码已过期，可重新生成。");
      }, Math.max(0, expiresAt - Date.now()));
    } catch {
      if (current()) status.textContent = t("Could not contact dayfly. Try again.", "未能连接 dayfly，请重试。");
    } finally {
      if (current()) pair.disabled = revoke.disabled = false;
    }
  }
  pair.addEventListener("click", () => update("POST"));
  revoke.addEventListener("click", () => update("DELETE"));
  panel.addEventListener("toggle", () => { if (!panel.open) clear(); });
  window.addEventListener("daily-space-auth-updated", () => {
    const owner = window.DailySpaceView.owner();
    if (owner !== previousOwner) clear();
    previousOwner = owner;
  });
  window.addEventListener("pagehide", clear);
})();
