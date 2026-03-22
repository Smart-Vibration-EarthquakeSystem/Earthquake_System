import {
  ref,
  onValue,
  push,
  set
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const LIVE_CHART_MAX_POINTS = 48;
const DEVICE_ID = "esp32_01";

function normalizeDeviceField(data) {
  const d =
    data?.device ??
    data?.deviceId ??
    data?.sensorId ??
    data?.nodeId ??
    data?.node;
  if (d == null || String(d).trim() === "") return DEVICE_ID;
  return String(d).trim();
}

function deviceIdsMatch(a, b) {
  return (
    String(a || "")
      .trim()
      .toLowerCase() ===
    String(b || "")
      .trim()
      .toLowerCase()
  );
}

function looksLikeHistoryMap(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const vals = Object.values(obj);
  if (vals.length === 0) return false;
  return vals.every(
    (v) =>
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      ("currentLevel" in v ||
        "triggerCount" in v ||
        "triggerCount5s" in v ||
        "updatedAt" in v ||
        "timestamp" in v ||
        "vibration" in v ||
        "status" in v)
  );
}

/**
 * RTDB history is often a flat map of push IDs → payloads. Some firmware nests
 * that map under `records`, `events`, `logs`, etc.
 */
function coerceHistoryObject(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  if (looksLikeHistoryMap(raw)) return raw;
  const nestedKeys = ["records", "events", "items", "logs", "entries"];
  for (const k of nestedKeys) {
    const inner = raw[k];
    if (
      inner &&
      typeof inner === "object" &&
      !Array.isArray(inner) &&
      looksLikeHistoryMap(inner)
    ) {
      return inner;
    }
  }
  return raw;
}

const liveSeries = [];
let liveChart = null;
let levelDistChart = null;
let vibrationStateChart = null;
let historyTriggersChart = null;
let db = null;
let lastHistorySnapshot = null;
let lastSavedHistoryKey = "";

window.addEventListener("dashboard-theme", () => {
  queueMicrotask(() => {
    applyLiveChartTheme();
    applyAnalyticsChartsTheme();
  });
});

function getEl(id) {
  return document.getElementById(id);
}

function setConnectionStatus(text, type = "") {
  const el = getEl("connectionStatus");
  if (el) {
    el.textContent = text;
    el.className = "connection-status";
    if (type) el.classList.add(type);
  }

  const dot = getEl("headerConnectionDot");
  const label = getEl("headerConnectionLabel");
  if (dot) {
    dot.className = "header-bar__conn-dot";
    if (type === "ok") dot.classList.add("header-bar__conn-dot--ok");
    else if (type === "warn") dot.classList.add("header-bar__conn-dot--warn");
    else if (type === "error") dot.classList.add("header-bar__conn-dot--error");
    else dot.classList.add("header-bar__conn-dot--pending");
  }
  if (label) {
    const short = text.length > 28 ? `${text.slice(0, 26)}…` : text;
    label.textContent = short;
    label.title = text;
  }
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

function withAlpha(color, alpha) {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${alpha})`;

  if (color.startsWith("#")) {
    let h = color.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  return color;
}

function getLiveChartColors() {
  return {
    accent: cssVar("--accent", "#16a34a"),
    grid: cssVar("--chart-grid", "rgba(100, 116, 139, 0.18)"),
    muted: cssVar("--text-muted", "#64748b"),
    vibration: cssVar("--chart-vibration", "#d97706"),
  };
}

function syncLiveChartData() {
  if (!liveChart) return;

  liveChart.data.datasets[0].data = liveSeries.map((p) => ({
    x: p.t,
    y: p.trigger,
  }));

  liveChart.data.datasets[1].data = liveSeries.map((p) => ({
    x: p.t,
    y: p.vib,
  }));
}

function applyLiveChartTheme() {
  if (!liveChart) return;

  const { accent, grid, muted, vibration } = getLiveChartColors();

  const ds0 = liveChart.data.datasets[0];
  ds0.borderColor = accent;
  ds0.backgroundColor = withAlpha(accent, 0.14);
  ds0.pointBackgroundColor = accent;
  ds0.pointBorderColor = accent;

  const ds1 = liveChart.data.datasets[1];
  ds1.borderColor = vibration;
  ds1.pointBackgroundColor = vibration;
  ds1.pointBorderColor = vibration;

  const scales = liveChart.options.scales;
  scales.x.grid.color = grid;
  scales.y.grid.color = grid;
  scales.x.ticks.color = muted;
  scales.y.ticks.color = muted;
  scales.y1.ticks.color = muted;
  scales.x.title.color = muted;
  scales.y.title.color = muted;
  scales.y1.title.color = muted;
  liveChart.options.plugins.legend.labels.color = muted;

  liveChart.update("none");
}

function getLevelDoughnutColors() {
  const safe = cssVar("--green-600", "#16a34a");
  const low = cssVar("--amber-600", "#d97706");
  const medium = cssVar("--orange-500", "#f97316");
  const high = cssVar("--red-500", "#ef4444");
  const muted = cssVar("--text-muted", "#64748b");
  return {
    SAFE: document.documentElement.getAttribute("data-theme") === "dark" ? "#34d399" : safe,
    LOW: low,
    MEDIUM: medium,
    HIGH: high,
    muted,
  };
}

function bucketHistoryLevel(level) {
  const v = String(level || "").toUpperCase();
  if (v === "HIGH" || v === "ALERT") return "HIGH";
  if (v === "MEDIUM") return "MEDIUM";
  if (v === "LOW") return "LOW";
  return "SAFE";
}

function getDeviceHistoryEntries(historyData, max = 120) {
  const map = coerceHistoryObject(historyData);
  if (!map || typeof map !== "object") return [];
  return Object.entries(map)
    .map(([key, value]) => ({
      key,
      ...normalizeHistoryRecord(value),
    }))
    .filter((item) => deviceIdsMatch(item.device, DEVICE_ID))
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))
    .slice(0, max);
}

function applyAnalyticsChartsTheme() {
  const muted = cssVar("--text-muted", "#64748b");
  const grid = cssVar("--chart-grid", "rgba(100, 116, 139, 0.18)");

  [levelDistChart, vibrationStateChart].forEach((ch) => {
    if (ch?.options?.plugins?.legend?.labels) {
      ch.options.plugins.legend.labels.color = muted;
    }
  });

  if (historyTriggersChart) {
    const opts = historyTriggersChart.options;
    if (opts.plugins?.legend?.labels) opts.plugins.legend.labels.color = muted;
    const y = opts.scales?.y;
    const x = opts.scales?.x;
    if (y) {
      y.grid.color = grid;
      y.ticks.color = muted;
      if (y.title) y.title.color = muted;
    }
    if (x) {
      x.grid.color = grid;
      x.ticks.color = muted;
      if (x.title) x.title.color = muted;
    }
  }

  updateAnalyticsCharts(lastHistorySnapshot ?? undefined);
}

function updateAnalyticsCharts(historyData) {
  const entries = getDeviceHistoryEntries(historyData, 120);
  const cols = getLevelDoughnutColors();

  const levelOrder = ["SAFE", "LOW", "MEDIUM", "HIGH"];
  const levelCounts = { SAFE: 0, LOW: 0, MEDIUM: 0, HIGH: 0 };
  let vibOn = 0;
  let vibOff = 0;

  entries.forEach((e) => {
    levelCounts[bucketHistoryLevel(e.level)] += 1;
    if (Number(e.vibrationBinary) === 1) vibOn += 1;
    else vibOff += 1;
  });

  const levelLabels = ["Safe", "Low", "Medium", "High / Alert"];
  const levelData = levelOrder.map((k) => levelCounts[k]);
  const levelColors = levelOrder.map((k) => cols[k]);
  const levelSum = levelData.reduce((a, b) => a + b, 0);

  if (levelDistChart) {
    if (levelSum === 0) {
      levelDistChart.data.labels = ["No history yet"];
      levelDistChart.data.datasets[0].data = [1];
      levelDistChart.data.datasets[0].backgroundColor = [cols.muted];
      levelDistChart.data.datasets[0].borderColor = cssVar("--border", "rgba(0,0,0,0.1)");
    } else {
      const filtered = levelLabels
        .map((label, i) => ({ label, v: levelData[i], c: levelColors[i] }))
        .filter((x) => x.v > 0);
      levelDistChart.data.labels = filtered.map((x) => x.label);
      levelDistChart.data.datasets[0].data = filtered.map((x) => x.v);
      levelDistChart.data.datasets[0].backgroundColor = filtered.map((x) => x.c);
      levelDistChart.data.datasets[0].borderColor = filtered.map((x) =>
        withAlpha(x.c, 0.95)
      );
    }
    levelDistChart.update();
  }

  if (vibrationStateChart) {
    const totalV = vibOn + vibOff;
    if (totalV === 0) {
      vibrationStateChart.data.labels = ["No data"];
      vibrationStateChart.data.datasets[0].data = [1];
      vibrationStateChart.data.datasets[0].backgroundColor = [cols.muted];
      vibrationStateChart.data.datasets[0].borderColor = [cssVar("--border", "rgba(0,0,0,0.1)")];
    } else {
      vibrationStateChart.data.labels = ["Vibration on", "Vibration off"];
      vibrationStateChart.data.datasets[0].data = [vibOn, vibOff];
      const accent = cssVar("--accent", "#16a34a");
      const vibration = cssVar("--chart-vibration", "#d97706");
      vibrationStateChart.data.datasets[0].backgroundColor = [
        withAlpha(accent, 0.75),
        withAlpha(vibration, 0.8),
      ];
      vibrationStateChart.data.datasets[0].borderColor = [accent, vibration];
    }
    vibrationStateChart.update();
  }

  if (historyTriggersChart) {
    const recent = entries.slice(0, 10).reverse();
    if (recent.length === 0) {
      historyTriggersChart.data.labels = ["—"];
      historyTriggersChart.data.datasets[0].data = [0];
    } else {
      historyTriggersChart.data.labels = recent.map((e) => {
        const t = Number(e.updatedAt ?? 0);
        if (!t) return "—";
        return new Date(t * 1000).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      });
      historyTriggersChart.data.datasets[0].data = recent.map((e) =>
        Number(e.triggerCount ?? 0)
      );
    }
    historyTriggersChart.update();
  }
}

function createAnalyticsCharts(Chart) {
  const muted = cssVar("--text-muted", "#64748b");
  const grid = cssVar("--chart-grid", "rgba(100, 116, 139, 0.18)");
  const accent = cssVar("--accent", "#16a34a");
  const cols = getLevelDoughnutColors();
  const legendLabels = {
    color: muted,
    boxWidth: 10,
    boxHeight: 10,
    usePointStyle: true,
    padding: 12,
    font: { size: 11, family: "'DM Sans', system-ui, sans-serif" },
  };

  const doughnutOpts = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "58%",
    plugins: {
      legend: {
        position: "bottom",
        labels: legendLabels,
      },
    },
  };

  const levelCanvas = getEl("levelDistributionChart");
  if (levelCanvas && typeof Chart === "function") {
    levelDistChart = new Chart(levelCanvas, {
      type: "doughnut",
      data: {
        labels: ["No history yet"],
        datasets: [
          {
            data: [1],
            backgroundColor: [cols.muted],
            borderColor: [cssVar("--border", "rgba(0,0,0,0.12)")],
            borderWidth: 1,
            hoverOffset: 6,
          },
        ],
      },
      options: doughnutOpts,
    });
  }

  const vibCanvas = getEl("vibrationStateChart");
  if (vibCanvas && typeof Chart === "function") {
    vibrationStateChart = new Chart(vibCanvas, {
      type: "doughnut",
      data: {
        labels: ["No data"],
        datasets: [
          {
            data: [1],
            backgroundColor: [cols.muted],
            borderColor: [cssVar("--border", "rgba(0,0,0,0.12)")],
            borderWidth: 1,
            hoverOffset: 6,
          },
        ],
      },
      options: doughnutOpts,
    });
  }

  const barCanvas = getEl("historyTriggersChart");
  if (barCanvas && typeof Chart === "function") {
    historyTriggersChart = new Chart(barCanvas, {
      type: "bar",
      data: {
        labels: ["—"],
        datasets: [
          {
            label: "Trigger count",
            data: [0],
            backgroundColor: withAlpha(accent, 0.55),
            borderColor: accent,
            borderWidth: 1,
            borderRadius: 6,
            maxBarThickness: 36,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            position: "top",
            align: "end",
            labels: {
              ...legendLabels,
              font: { size: 12, family: "'DM Sans', system-ui, sans-serif" },
            },
          },
        },
        scales: {
          x: {
            grid: { color: grid },
            ticks: { color: muted, maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 12 },
            title: {
              display: true,
              text: "Event time",
              color: muted,
              font: { size: 11, weight: "600" },
            },
          },
          y: {
            beginAtZero: true,
            grace: "8%",
            grid: { color: grid },
            ticks: { color: muted, precision: 0 },
            title: {
              display: true,
              text: "Triggers",
              color: muted,
              font: { size: 11, weight: "600" },
            },
          },
        },
      },
    });
  }
}

function createLiveChart(Chart) {
  const canvas = getEl("liveChart");
  if (!canvas || typeof Chart !== "function") return;

  const { accent, grid, muted, vibration } = getLiveChartColors();

  liveChart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Trigger Count",
          data: [],
          yAxisID: "y",
          tension: 0.28,
          fill: true,
          pointRadius: 3,
          pointHoverRadius: 6,
          borderWidth: 2,
          borderColor: accent,
          backgroundColor: withAlpha(accent, 0.14),
          pointBackgroundColor: accent,
          pointBorderColor: accent,
        },
        {
          label: "Vibration",
          data: [],
          yAxisID: "y1",
          stepped: "before",
          fill: false,
          pointRadius: 2,
          pointHoverRadius: 5,
          borderWidth: 2,
          borderDash: [6, 4],
          borderColor: vibration,
          pointBackgroundColor: vibration,
          pointBorderColor: vibration,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "top",
          align: "end",
          labels: {
            color: muted,
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            padding: 16,
            font: { size: 12, family: "'DM Sans', system-ui, sans-serif" },
          },
        },
        tooltip: {
          callbacks: {
            title(items) {
              const x = items[0]?.parsed?.x;
              return x != null ? new Date(x).toLocaleString() : "";
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          title: {
            display: true,
            text: "Time",
            color: muted,
            font: { size: 11, weight: "600" },
          },
          grid: { color: grid },
          ticks: {
            color: muted,
            maxTicksLimit: 7,
            maxRotation: 0,
            callback(value) {
              return new Date(value).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              });
            },
          },
        },
        y: {
          position: "left",
          beginAtZero: true,
          grace: "10%",
          title: {
            display: true,
            text: "Trigger Count",
            color: muted,
            font: { size: 11, weight: "600" },
          },
          grid: { color: grid },
          ticks: {
            color: muted,
            precision: 0,
          },
        },
        y1: {
          position: "right",
          min: 0,
          max: 1,
          offset: true,
          title: {
            display: true,
            text: "Vibration",
            color: muted,
            font: { size: 11, weight: "600" },
          },
          grid: { drawOnChartArea: false },
          ticks: {
            color: muted,
            stepSize: 1,
            callback(v) {
              if (v === 1) return "On";
              if (v === 0) return "Off";
              return "";
            },
          },
        },
      },
    },
  });
}

function formatUnixTime(unixTime) {
  if (!unixTime || Number(unixTime) === 0) return "-";
  const date = new Date(Number(unixTime) * 1000);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function getLevelClass(level) {
  if (level === "HIGH" || level === "ALERT") return "high";
  if (level === "MEDIUM") return "medium";
  if (level === "LOW") return "low";
  return "safe";
}

function getBadgeClass(level) {
  if (level === "HIGH" || level === "ALERT") return "badge badge-high";
  if (level === "MEDIUM") return "badge badge-medium";
  if (level === "LOW") return "badge badge-low";
  return "badge badge-safe";
}

function updateAlert(level, status) {
  const alertBox = getEl("mainAlert");
  const alertTitle = getEl("alertTitle");
  const alertMessage = getEl("alertMessage");

  if (!alertBox || !alertTitle || !alertMessage) return;

  alertBox.className = "main-alert";
  alertTitle.textContent = level;
  alertMessage.textContent = status;

  if (level === "HIGH" || level === "ALERT") {
    alertBox.classList.add("high-alert");
  } else if (level === "MEDIUM") {
    alertBox.classList.add("medium-alert");
  } else if (level === "LOW") {
    alertBox.classList.add("low-alert");
  } else {
    alertBox.classList.add("safe-alert");
  }
}

function normalizeLevel(value) {
  const v = String(value || "").toUpperCase().trim();
  if (v === "HIGH" || v === "MEDIUM" || v === "LOW" || v === "SAFE" || v === "ALERT") {
    return v;
  }
  return "SAFE";
}

function vibrationToText(vibration, level) {
  const v = String(vibration || "").toUpperCase().trim();
  if (v === "HIGH" || v === "MEDIUM" || v === "LOW" || v === "ALERT") return v;
  if (level === "HIGH" || level === "MEDIUM" || level === "LOW" || level === "ALERT") return level;
  return "SAFE";
}

function vibrationToBinary(vibration, level) {
  const v = String(vibration || "").toUpperCase().trim();
  if (v === "HIGH" || v === "MEDIUM" || v === "LOW" || v === "ALERT") return 1;
  if (level === "HIGH" || level === "MEDIUM" || level === "LOW" || level === "ALERT") return 1;
  return 0;
}

function normalizeLiveRecord(data) {
  const level = normalizeLevel(data?.currentLevel);
  return {
    device: normalizeDeviceField(data),
    level,
    status: data?.status || "NO VIBRATION",
    vibrationText: vibrationToText(data?.vibration, level),
    vibrationBinary: vibrationToBinary(data?.vibration, level),
    triggerCount: Number(data?.triggerCount5s ?? data?.triggerCount ?? 0),
    totalCount: Number(data?.totalEventCount ?? data?.totalCount ?? 0),
    updatedAt: Number(data?.updatedAt ?? data?.timestamp ?? 0),
    vibrationValue: Number(data?.vibrationValue ?? 0),
  };
}

function normalizeHistoryRecord(data) {
  const level = normalizeLevel(data?.currentLevel);
  return {
    device: normalizeDeviceField(data),
    level,
    status: data?.status || "NO VIBRATION",
    vibrationText: vibrationToText(data?.vibration, level),
    vibrationBinary: vibrationToBinary(data?.vibration, level),
    triggerCount: Number(data?.triggerCount5s ?? data?.triggerCount ?? 0),
    totalCount: Number(data?.totalEventCount ?? data?.totalCount ?? 0),
    updatedAt: Number(data?.updatedAt ?? data?.timestamp ?? 0),
    vibrationValue: Number(data?.vibrationValue ?? 0),
  };
}

function appendLiveSample(item) {
  if (!liveChart) return;

  const updatedSec = Number(item.updatedAt ?? 0);
  const t = updatedSec > 0 ? updatedSec * 1000 : Date.now();
  const trigger = Number(item.triggerCount ?? 0);
  const vib = Number(item.vibrationBinary) === 1 ? 1 : 0;
  const last = liveSeries[liveSeries.length - 1];

  if (last) {
    const sameReading = updatedSec > 0 && last.updatedSec === updatedSec;
    const rapidLocal = updatedSec === 0 && Math.abs(t - last.t) < 800;

    if (sameReading || rapidLocal) {
      last.t = t;
      last.updatedSec = updatedSec;
      last.trigger = trigger;
      last.vib = vib;
      syncLiveChartData();
      liveChart?.update("none");
      return;
    }
  }

  liveSeries.push({
    t,
    updatedSec,
    trigger,
    vib,
  });

  while (liveSeries.length > LIVE_CHART_MAX_POINTS) {
    liveSeries.shift();
  }

  syncLiveChartData();
  liveChart?.update();
}

function makeHistoryKey(item) {
  return [
    item.device || DEVICE_ID,
    Number(item.updatedAt || 0),
    Number(item.triggerCount || 0),
    Number(item.totalCount || 0),
    String(item.level || ""),
    String(item.status || ""),
    Number(item.vibrationValue || 0),
  ].join("|");
}

async function saveLiveRecordToHistory(item) {
  if (!db) return;

  const key = makeHistoryKey(item);
  if (key === lastSavedHistoryKey) return;

  lastSavedHistoryKey = key;

  try {
    const historyRef = ref(db, "earthquake_monitor/history");
    const newRowRef = push(historyRef);

    await set(newRowRef, {
      device: item.device || DEVICE_ID,
      currentLevel: item.level || "SAFE",
      status: item.status || "NO VIBRATION",
      vibration: item.vibrationText || "SAFE",
      triggerCount5s: Number(item.triggerCount || 0),
      totalEventCount: Number(item.totalCount || 0),
      updatedAt: Number(item.updatedAt || Math.floor(Date.now() / 1000)),
      vibrationValue: Number(item.vibrationValue || 0),
      source: "web-live-sync",
    });
  } catch (error) {
    console.error("Failed to save live record into history:", error);
  }
}

function renderLatest(item) {
  const deviceEl = getEl("deviceId");
  const levelEl = getEl("level");
  const statusEl = getEl("status");
  const vibrationEl = getEl("vibration");
  const triggerEl = getEl("triggerCount");
  const totalEl = getEl("totalCount");
  const updatedEl = getEl("updatedAt");

  if (deviceEl) deviceEl.textContent = item.device || DEVICE_ID;

  if (levelEl) {
    levelEl.textContent = item.level;
    levelEl.className = `value ${getLevelClass(item.level)}`;
  }

  if (statusEl) statusEl.textContent = item.status;
  if (vibrationEl) vibrationEl.textContent = item.vibrationText;
  if (triggerEl) triggerEl.textContent = item.triggerCount;
  if (totalEl) totalEl.textContent = item.totalCount;
  if (updatedEl) updatedEl.textContent = formatUnixTime(item.updatedAt);

  const aboutDev = getEl("aboutDeviceId");
  if (aboutDev) aboutDev.textContent = item.device || DEVICE_ID;

  updateAlert(item.level, item.status);
  appendLiveSample(item);
  saveLiveRecordToHistory(item);
}

function renderHistory(historyData) {
  lastHistorySnapshot = historyData ?? null;

  const table = getEl("historyTable");
  if (!table) {
    updateAnalyticsCharts(historyData);
    return;
  }

  table.innerHTML = "";

  const map = coerceHistoryObject(historyData);
  if (!map || typeof map !== "object") {
    table.innerHTML = `<tr><td colspan="7">No history available</td></tr>`;
    updateAnalyticsCharts(historyData);
    return;
  }

  const entries = Object.entries(map)
    .map(([key, value]) => ({
      key,
      ...normalizeHistoryRecord(value),
    }))
    .filter((item) => deviceIdsMatch(item.device, DEVICE_ID))
    .sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0))
    .slice(0, 10);

  if (entries.length === 0) {
    table.innerHTML = `<tr><td colspan="7">No history available</td></tr>`;
    updateAnalyticsCharts(historyData);
    return;
  }

  entries.forEach((item, index) => {
    const row = `
      <tr>
        <td>${index + 1}</td>
        <td><span class="${getBadgeClass(item.level)}">${item.level}</span></td>
        <td>${item.status}</td>
        <td>${item.vibrationText}</td>
        <td>${item.triggerCount}</td>
        <td>${item.totalCount}</td>
        <td>${formatUnixTime(item.updatedAt)}</td>
      </tr>
    `;
    table.innerHTML += row;
  });

  updateAnalyticsCharts(historyData);
}

async function initChart() {
  try {
    const { default: Chart } = await import(
      "https://cdn.jsdelivr.net/npm/chart.js@4.4.8/auto/+esm"
    );
    createLiveChart(Chart);
    createAnalyticsCharts(Chart);
    applyLiveChartTheme();
    applyAnalyticsChartsTheme();
  } catch (err) {
    console.warn("Chart.js could not load; charts disabled.", err);
  }
}

function initHeaderChrome() {
  const header = document.querySelector("[data-header-bar]");
  const toggle = getEl("headerMenuToggle");
  const nav = getEl("headerPrimaryNav");

  if (header && toggle) {
    toggle.addEventListener("click", () => {
      const open = header.classList.toggle("is-menu-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  nav?.querySelectorAll("a.header-bar__nav-link").forEach((a) => {
    a.addEventListener("click", () => {
      header?.classList.remove("is-menu-open");
      toggle?.setAttribute("aria-expanded", "false");
    });
  });

  function tickClock() {
    const clock = getEl("headerClock");
    if (!clock) return;
    const now = new Date();
    try {
      clock.dateTime = now.toISOString();
    } catch (e) {
      /* ignore */
    }
    clock.textContent = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  tickClock();
  setInterval(tickClock, 1000);

  const navLinks = [...document.querySelectorAll("[data-nav-target]")];
  if (navLinks.length === 0) return;

  function setActiveNav(target) {
    navLinks.forEach((link) => {
      link.classList.toggle("is-active", link.dataset.navTarget === target);
    });
  }

  const page = document.body?.dataset?.page;
  const pageToNavTarget = {
    dashboard: "top",
    "live-data": "live-data",
    analytics: "analytics",
    alerts: "alerts",
    history: "history",
    about: "about",
  };

  if (page && pageToNavTarget[page]) {
    setActiveNav(pageToNavTarget[page]);
    return;
  }

  const spyIds = ["alerts", "live-data", "analytics", "history", "about"];
  const observed = spyIds.map((id) => getEl(id)).filter(Boolean);

  if (observed.length > 0) {
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) {
          setActiveNav(visible[0].target.id);
        }
      },
      { rootMargin: "-10% 0px -45% 0px", threshold: [0, 0.12, 0.25, 0.5] }
    );
    observed.forEach((el) => io.observe(el));
  }

  window.addEventListener(
    "scroll",
    () => {
      if (window.scrollY < 48) setActiveNav("top");
    },
    { passive: true }
  );
}

function startFirebaseListeners() {
  db = window.firebaseDB;

  if (!db) {
    setConnectionStatus("Firebase is not ready.", "error");
    return;
  }

  const liveRef = ref(db, "earthquake_monitor/live");
  const historyRef = ref(db, "earthquake_monitor/history");

  onValue(
    liveRef,
    (snapshot) => {
      const data = snapshot.val();

      if (!data) {
        setConnectionStatus("No live data found in Firebase.", "warn");
        return;
      }

      const item = normalizeLiveRecord(data);

      if (!deviceIdsMatch(item.device, DEVICE_ID)) {
        setConnectionStatus(`Live data found, but not for ${DEVICE_ID}.`, "warn");
        return;
      }

      setConnectionStatus("Connected to Firebase live data.", "ok");
      renderLatest(item);
    },
    (error) => {
      console.error("Live listener error:", error);
      setConnectionStatus("Cannot read live data. Check Firebase rules.", "error");
    }
  );

  onValue(
    historyRef,
    (snapshot) => {
      const historyData = snapshot.val();

      if (!historyData) {
        console.warn("No history data found in Firebase.");
      }

      renderHistory(historyData);
    },
    (error) => {
      console.error("History listener error:", error);
      setConnectionStatus("Cannot read history data. Check Firebase rules.", "error");
    }
  );
}

(async function initDashboard() {
  initHeaderChrome();
  await initChart();

  if (window.firebaseInitError) {
    setConnectionStatus("Firebase initialization failed. Check your config.", "error");
    return;
  }

  if (window.firebaseDB) {
    startFirebaseListeners();
  } else {
    window.addEventListener(
      "firebase-ready",
      () => {
        startFirebaseListeners();
      },
      { once: true }
    );

    window.addEventListener(
      "firebase-init-error",
      () => {
        setConnectionStatus("Firebase initialization failed. Check your config.", "error");
      },
      { once: true }
    );
  }
})();