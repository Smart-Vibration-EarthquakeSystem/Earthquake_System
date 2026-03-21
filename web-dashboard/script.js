import {
  ref,
  onValue
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const LIVE_CHART_MAX_POINTS = 48;
const DEVICE_ID = "esp32_01";

const liveSeries = [];
let liveChart = null;
let db = null;

window.addEventListener("dashboard-theme", () => {
  queueMicrotask(() => applyLiveChartTheme());
});

function getEl(id) {
  return document.getElementById(id);
}

function setConnectionStatus(text, type = "") {
  const el = getEl("connectionStatus");
  if (!el) return;
  el.textContent = text;
  el.className = "connection-status";
  if (type) el.classList.add(type);
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

function createLiveChart(Chart) {
  const canvas = getEl("liveChart");
  if (!canvas || typeof Chart !== "function") return;

  const { accent, grid, muted, vibration } = getLiveChartColors();

  liveChart = new Chart(canvas, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Trigger count (5s)",
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
            text: "Triggers (5s)",
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

function appendLiveSample(data) {
  const updatedSec = Number(data.updatedAt ?? 0);
  const t = updatedSec > 0 ? updatedSec * 1000 : Date.now();
  const trigger = Number(data.triggerCountWindow ?? 0);
  const vib = Number(data.vibration) === 1 ? 1 : 0;
  const last = liveSeries[liveSeries.length - 1];

  if (last) {
    const sameDeviceReading = updatedSec > 0 && last.updatedSec === updatedSec;
    const rapidLocal = updatedSec === 0 && Math.abs(t - last.t) < 800;

    if (sameDeviceReading || rapidLocal) {
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

function formatUnixTime(unixTime) {
  if (!unixTime || Number(unixTime) === 0) return "-";
  const date = new Date(Number(unixTime) * 1000);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function getLevelClass(level) {
  if (level === "HIGH") return "high";
  if (level === "MEDIUM") return "medium";
  if (level === "LOW") return "low";
  return "safe";
}

function getBadgeClass(level) {
  if (level === "HIGH") return "badge badge-high";
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

  if (level === "HIGH") {
    alertBox.classList.add("high-alert");
  } else if (level === "MEDIUM") {
    alertBox.classList.add("medium-alert");
  } else if (level === "LOW") {
    alertBox.classList.add("low-alert");
  } else {
    alertBox.classList.add("safe-alert");
  }
}

function renderLatest(data) {
  const level = data?.level || "SAFE";
  const status = data?.status || "NO VIBRATION";

  const deviceEl = getEl("deviceId");
  const levelEl = getEl("level");
  const statusEl = getEl("status");
  const vibrationEl = getEl("vibration");
  const triggerEl = getEl("triggerCount");
  const totalEl = getEl("totalCount");
  const updatedEl = getEl("updatedAt");

  if (deviceEl) deviceEl.textContent = DEVICE_ID;

  if (levelEl) {
    levelEl.textContent = level;
    levelEl.className = `value ${getLevelClass(level)}`;
  }

  if (statusEl) statusEl.textContent = status;
  if (vibrationEl) vibrationEl.textContent = Number(data?.vibration) === 1 ? "DETECTED" : "SAFE";
  if (triggerEl) triggerEl.textContent = data?.triggerCountWindow ?? 0;
  if (totalEl) totalEl.textContent = data?.totalEventCount ?? 0;
  if (updatedEl) updatedEl.textContent = formatUnixTime(data?.updatedAt);

  updateAlert(level, status);
  appendLiveSample(data);
}

function renderHistory(data) {
  const table = getEl("historyTable");
  if (!table) return;

  table.innerHTML = "";

  if (!data || typeof data !== "object") {
    table.innerHTML = `<tr><td colspan="7">No data available</td></tr>`;
    return;
  }

  const entries = Object.entries(data)
    .sort((a, b) => Number(b[1]?.updatedAt ?? 0) - Number(a[1]?.updatedAt ?? 0))
    .slice(0, 10);

  if (entries.length === 0) {
    table.innerHTML = `<tr><td colspan="7">No history available</td></tr>`;
    return;
  }

  entries.forEach(([, item], index) => {
    const row = `
      <tr>
        <td>${index + 1}</td>
        <td><span class="${getBadgeClass(item?.level || "SAFE")}">${item?.level || "SAFE"}</span></td>
        <td>${item?.status || "-"}</td>
        <td>${Number(item?.vibration) === 1 ? "YES" : "NO"}</td>
        <td>${item?.triggerCountWindow ?? 0}</td>
        <td>${item?.totalEventCount ?? 0}</td>
        <td>${formatUnixTime(item?.updatedAt)}</td>
      </tr>
    `;
    table.innerHTML += row;
  });
}

async function initChart() {
  try {
    const { default: Chart } = await import(
      "https://cdn.jsdelivr.net/npm/chart.js@4.4.8/auto/+esm"
    );
    createLiveChart(Chart);
    applyLiveChartTheme();
  } catch (err) {
    console.warn("Chart.js could not load; live chart disabled.", err);
  }
}

function startFirebaseListeners() {
  db = window.firebaseDB;

  if (!db) {
    setConnectionStatus("Firebase is not ready.", "error");
    return;
  }

  const latestRef = ref(db, `devices/${DEVICE_ID}/latest`);
  const historyRef = ref(db, `devices/${DEVICE_ID}/history`);

  onValue(
    latestRef,
    (snapshot) => {
      const data = snapshot.val();

      if (!data) {
        setConnectionStatus("No latest data found in Firebase.", "warn");
        return;
      }

      setConnectionStatus("Connected to Firebase live data.", "ok");
      renderLatest(data);
    },
    (error) => {
      console.error("Latest listener error:", error);
      setConnectionStatus("Cannot read latest data. Check Firebase rules.", "error");
    }
  );

  onValue(
    historyRef,
    (snapshot) => {
      renderHistory(snapshot.val());
    },
    (error) => {
      console.error("History listener error:", error);
    }
  );
}

(async function initDashboard() {
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