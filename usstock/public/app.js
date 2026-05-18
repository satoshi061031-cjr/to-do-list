const symbolsInput = document.getElementById("symbolsInput");
const analyzeBtn = document.getElementById("analyzeBtn");
const statusEl = document.getElementById("status");
const resultList = document.getElementById("resultList");
const cardTemplate = document.getElementById("cardTemplate");

function fmtNumber(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  return Number(n).toLocaleString("en-US");
}

function fmtPrice(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  return `$${Number(n).toFixed(2)}`;
}

function fmtPercent(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  const v = Number(n);
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function status(text, isError = false) {
  statusEl.classList.remove("hidden");
  statusEl.textContent = text;
  statusEl.style.borderColor = isError ? "rgba(255,107,107,0.7)" : "#3b4c8a";
  statusEl.style.background = isError ? "rgba(255,107,107,0.15)" : "#1b2850";
}

function clearStatus() {
  statusEl.classList.add("hidden");
  statusEl.textContent = "";
}

function signalClass(label) {
  const l = (label || "").toLowerCase();
  if (l.includes("bullish")) return "signal-bullish";
  if (l.includes("bearish")) return "signal-bearish";
  return "signal-neutral";
}

function renderCard(stock) {
  const frag = cardTemplate.content.cloneNode(true);
  frag.querySelector(".symbol").textContent = stock.symbol;
  frag.querySelector(".company").textContent = stock.company || "-";

  const badge = frag.querySelector(".signal-badge");
  badge.textContent = `${stock.signal.label} (${stock.signal.totalScore})`;
  badge.classList.add(signalClass(stock.signal.label));

  frag.querySelector(".price").textContent = fmtPrice(stock.market.price);
  frag.querySelector(".change").textContent = fmtPercent(stock.market.changePercent);
  frag.querySelector(".volume").textContent = fmtNumber(stock.market.volume);
  frag.querySelector(".avg-volume").textContent = fmtNumber(stock.market.avgVolume3m);

  frag.querySelector(".score-summary").textContent = [
    `新闻评分: ${stock.signal.parts.newsScore}`,
    `SEC评分: ${stock.signal.parts.secScore}`,
    `成交量评分: ${stock.signal.parts.volumeScore}`,
    stock.signal.note,
  ].join(" | ");

  const src = stock.sourceStatus || {};
  frag.querySelector(".source-status").textContent = [
    `数据源状态`,
    `Polygon: ${src.polygon?.ok ? "OK" : "失败"}`,
    `SEC: ${src.sec?.ok ? "OK" : "失败"}`,
  ].join(" | ");

  const newsList = frag.querySelector(".news-list");
  if (!stock.news.length) {
    const li = document.createElement("li");
    li.textContent = "暂无新闻";
    newsList.appendChild(li);
  } else {
    for (const n of stock.news.slice(0, 6)) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = n.link || "#";
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = n.title || "无标题";
      li.appendChild(a);
      const meta = document.createElement("small");
      meta.style.display = "block";
      meta.style.color = "var(--muted)";
      const dt = n.publishedAt ? new Date(n.publishedAt).toLocaleString() : "未知时间";
      meta.textContent = `${n.publisher || "未知来源"} · ${dt}`;
      li.appendChild(meta);
      newsList.appendChild(li);
    }
  }

  const secList = frag.querySelector(".sec-list");
  if (!stock.secFilings.length) {
    const li = document.createElement("li");
    li.textContent = "暂无 SEC 文件";
    secList.appendChild(li);
  } else {
    for (const s of stock.secFilings.slice(0, 5)) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = s.secUrl || "#";
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = `${s.form || "-"} (${s.filingDate || "未知日期"})`;
      li.appendChild(a);
      secList.appendChild(li);
    }
  }

  return frag;
}

async function runAnalysis() {
  const raw = symbolsInput.value.trim();
  if (!raw) {
    status("请至少输入一个股票代码", true);
    return;
  }

  const symbols = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  status(`正在抓取 ${symbols.length} 只股票的数据...`);
  analyzeBtn.disabled = true;
  resultList.innerHTML = "";

  try {
    const response = await fetch("/api/signal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols }),
    });
    if (!response.ok) {
      throw new Error(`请求失败: ${response.status}`);
    }
    const data = await response.json();
    for (const stock of data.results) {
      resultList.appendChild(renderCard(stock));
    }
    clearStatus();
  } catch (err) {
    status(`抓取失败：${err.message}`, true);
  } finally {
    analyzeBtn.disabled = false;
  }
}

analyzeBtn.addEventListener("click", runAnalysis);
window.addEventListener("DOMContentLoaded", runAnalysis);
