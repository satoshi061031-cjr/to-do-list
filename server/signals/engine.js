const DAY_MS = 24 * 60 * 60 * 1000;

function generateSignal(summary) {
  const reasons = [];
  const sourceTimestamps = {};
  let score = 0;
  let confidence = 0.25;

  if (summary.quote?.fetchedAt) {
    sourceTimestamps.quote = summary.quote.fetchedAt;
    confidence += 0.25;
    const ageDays = ageInDays(summary.quote.fetchedAt);
    if (ageDays > 3) {
      score -= 10;
      reasons.push(`Quote data is ${Math.round(ageDays)} days old, so confidence is lower.`);
      confidence -= 0.15;
    }

    const changePercent = number(summary.quote.changePercent);
    if (changePercent != null) {
      if (changePercent >= 3) {
        score += 24;
        reasons.push(`Price momentum is strong at ${formatPercent(changePercent)} today.`);
      } else if (changePercent <= -3) {
        score -= 24;
        reasons.push(`Price momentum is weak at ${formatPercent(changePercent)} today.`);
      } else if (changePercent >= 1) {
        score += 10;
        reasons.push(`Price is modestly higher at ${formatPercent(changePercent)}.`);
      } else if (changePercent <= -1) {
        score -= 10;
        reasons.push(`Price is modestly lower at ${formatPercent(changePercent)}.`);
      } else {
        reasons.push("Price action is close to flat.");
      }
    }
  } else {
    reasons.push("No recent quote is cached yet.");
  }

  if (summary.fundamentals?.fetchedAt) {
    sourceTimestamps.fundamentals = summary.fundamentals.fetchedAt;
    confidence += 0.15;
    if (number(summary.fundamentals.revenueGrowth) >= 10) {
      score += 12;
      reasons.push(`Latest annual revenue growth is ${formatPercent(summary.fundamentals.revenueGrowth)}.`);
    } else if (number(summary.fundamentals.revenueGrowth) <= -10) {
      score -= 12;
      reasons.push(`Latest annual revenue declined ${formatPercent(Math.abs(summary.fundamentals.revenueGrowth))}.`);
    }
    if (number(summary.fundamentals.epsGrowth) >= 10) {
      score += 10;
      reasons.push(`Diluted EPS growth is ${formatPercent(summary.fundamentals.epsGrowth)}.`);
    } else if (number(summary.fundamentals.epsGrowth) <= -10) {
      score -= 10;
      reasons.push(`Diluted EPS declined ${formatPercent(Math.abs(summary.fundamentals.epsGrowth))}.`);
    }
  }

  const recentFiling = (summary.filings || [])[0];
  if (recentFiling?.fetchedAt) {
    sourceTimestamps.filings = recentFiling.fetchedAt;
    confidence += 0.1;
    if (recentFiling.form === "8-K") {
      score -= 3;
      reasons.push("A recent 8-K filing may indicate a material event worth reviewing.");
    } else {
      reasons.push(`Latest SEC filing is ${recentFiling.form} from ${recentFiling.filingDate || "recent data"}.`);
    }
  }

  const upcomingEarnings = (summary.events || []).find((event) => {
    if (event.type !== "earnings" || !event.eventTime) return false;
    const diff = new Date(event.eventTime).getTime() - Date.now();
    return diff >= 0 && diff <= 14 * DAY_MS;
  });
  if (upcomingEarnings) {
    sourceTimestamps.events = upcomingEarnings.fetchedAt;
    score -= 5;
    confidence += 0.1;
    reasons.push(`Earnings are expected soon (${upcomingEarnings.eventTime}), which can increase volatility.`);
  }

  const eventStatus = (summary.events || []).find((event) => event.status === "sourceUnavailable");
  if (eventStatus) {
    confidence -= 0.05;
    reasons.push("Earnings calendar source is not configured, so event coverage is incomplete.");
  }

  score = clamp(score, -100, 100);
  confidence = clamp(confidence, 0.1, 0.95);
  const label = labelForScore(score, confidence);

  if (!reasons.length) {
    reasons.push("Not enough market or filing data is available yet.");
  }

  return {
    label,
    score,
    confidence,
    reasons,
    sourceTimestamps,
    generatedAt: new Date().toISOString(),
  };
}

function labelForScore(score, confidence) {
  if (confidence < 0.35) return "watch";
  if (score >= 18) return "bullish";
  if (score <= -18) return "bearish";
  return "neutral";
}

function ageInDays(iso) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return 999;
  return (Date.now() - timestamp) / DAY_MS;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatPercent(value) {
  return `${Number(value).toFixed(2)}%`;
}

module.exports = {
  generateSignal,
};
