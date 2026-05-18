/* unimaurox-vuelos-internacionales
 * Live air traffic dashboard. Data: OpenSky Network /api/states/all
 * Vanilla JS + Leaflet + markercluster + Chart.js (todo via CDN, sin build).
 */

// OpenSky bloquea CORS desde browsers (ACAO solo permite su propio dominio).
// Solucion: un GitHub Action (.github/workflows/fetch.yml) hace fetch cada 10 min
// desde el runner (sin CORS) y commitea data/states.json. Aqui lo leemos como
// archivo estatico con cache-buster por minuto.
const API_URL = "./data/states.json";
const REFRESH_MS = 30_000;
const STALE_THRESHOLD_S = 20 * 60; // 20 min sin nuevo snapshot = "stale"

// OpenSky states[] index layout
const F = {
  icao24: 0, callsign: 1, origin_country: 2, time_position: 3, last_contact: 4,
  longitude: 5, latitude: 6, baro_altitude: 7, on_ground: 8, velocity: 9,
  true_track: 10, vertical_rate: 11, sensors: 12, geo_altitude: 13,
  squawk: 14, spi: 15, position_source: 16
};

const M_TO_FT = 3.28084;
const MPS_TO_KMH = 3.6;
const MPS_TO_KT = 1.94384;

let map, cluster, countriesChart, altChart;
let refreshTimer = null;
let lastGoodData = null;
let isFetching = false;

// ---------- INIT ----------
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initCharts();
  document.getElementById("btn-refresh").addEventListener("click", () => fetchAndRender(true));
  fetchAndRender(false);
  refreshTimer = setInterval(() => fetchAndRender(false), REFRESH_MS);
});

// ---------- MAP ----------
function initMap() {
  map = L.map("map", {
    center: [15, 0],
    zoom: 2,
    worldCopyJump: true,
    minZoom: 2,
    maxZoom: 12,
    zoomControl: true,
    attributionControl: true
  });

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19
  }).addTo(map);

  cluster = L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 80,
    chunkDelay: 30,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    maxClusterRadius: 55,
    disableClusteringAtZoom: 7
  });
  map.addLayer(cluster);
}

function planeIcon(heading, altClass) {
  // SVG plane pointing up — rotated by heading degrees (0 = north).
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20"
         fill="currentColor" style="transform: rotate(${heading || 0}deg);">
      <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"/>
    </svg>`;
  return L.divIcon({
    className: `plane-icon plane-${altClass}`,
    html: svg,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });
}

function altClass(alt_m) {
  if (alt_m == null) return "mid";
  if (alt_m < 3000) return "low";
  if (alt_m < 9000) return "mid";
  return "high";
}

// ---------- CHARTS ----------
function initCharts() {
  Chart.defaults.color = "#7f8ea8";
  Chart.defaults.font.family = "JetBrains Mono, ui-monospace, monospace";
  Chart.defaults.font.size = 11;
  Chart.defaults.borderColor = "#1f2d4a";

  countriesChart = new Chart(document.getElementById("chart-countries"), {
    type: "bar",
    data: { labels: [], datasets: [{
      label: "vuelos",
      data: [],
      backgroundColor: "rgba(34, 211, 238, 0.65)",
      borderColor: "#22d3ee",
      borderWidth: 1,
      borderRadius: 3
    }]},
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: "#162136", borderColor: "#1f2d4a", borderWidth: 1 } },
      scales: {
        x: { grid: { color: "rgba(31,45,74,0.5)" }, ticks: { precision: 0 } },
        y: { grid: { display: false } }
      }
    }
  });

  altChart = new Chart(document.getElementById("chart-alt"), {
    type: "doughnut",
    data: {
      labels: ["bajo (<3 km)", "medio (3-9 km)", "alto (>9 km)"],
      datasets: [{
        data: [0, 0, 0],
        backgroundColor: ["#34d399", "#22d3ee", "#fbbf24"],
        borderColor: "#0a0e1a",
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "62%",
      plugins: {
        legend: { position: "bottom", labels: { boxWidth: 10, padding: 12 } },
        tooltip: { backgroundColor: "#162136", borderColor: "#1f2d4a", borderWidth: 1 }
      }
    }
  });
}

// ---------- FETCH ----------
async function fetchAndRender(manual) {
  if (isFetching) return;
  isFetching = true;
  const btn = document.getElementById("btn-refresh");
  btn.disabled = true;
  setStatus("loading", manual ? "refrescando…" : "actualizando…");

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    // cache-buster por minuto para que el CDN de GH Pages no sirva cache viejo
    const url = `${API_URL}?t=${Math.floor(Date.now() / 60_000)}`;
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json || !Array.isArray(json.states)) throw new Error("payload inválido");

    lastGoodData = json;
    render(json);

    // Edad del snapshot (no del request) — el cron corre cada 10 min
    const ageS = Math.max(0, Math.floor(Date.now() / 1000) - (json.time || 0));
    if (ageS > STALE_THRESHOLD_S) {
      setStatus("stale", `snapshot viejo (${fmtAge(ageS)})`, json.time);
    } else {
      setStatus("live", `snapshot ${fmtAge(ageS)}`, json.time);
    }
  } catch (err) {
    console.warn("[fetch] error:", err);
    if (lastGoodData) {
      setStatus("stale", `sin red — último OK`, lastGoodData.time);
    } else {
      setStatus("error", "sin datos");
      renderEmpty();
    }
  } finally {
    isFetching = false;
    btn.disabled = false;
  }
}

// ---------- RENDER ----------
function render(payload) {
  const states = (payload.states || []).filter(s =>
    s[F.latitude] != null && s[F.longitude] != null && !s[F.on_ground]
  );

  renderKPIs(states);
  renderMap(states);
  renderCountries(states);
  renderAltitudes(states);
  renderTable(states);
}

function renderEmpty() {
  ["kpi-total","kpi-countries","kpi-alt","kpi-vel","kpi-max-alt","kpi-max-vel"]
    .forEach(id => document.getElementById(id).textContent = "—");
  document.getElementById("table-body").innerHTML =
    `<tr><td colspan="5" class="muted center">sin datos disponibles</td></tr>`;
}

function renderKPIs(states) {
  const total = states.length;
  const countries = new Set(states.map(s => s[F.origin_country]).filter(Boolean));

  let sumAlt = 0, nAlt = 0;
  let sumVel = 0, nVel = 0;
  let maxAlt = -Infinity, maxAltCallsign = "—", maxAltCountry = "";
  let maxVel = -Infinity, maxVelCallsign = "—", maxVelCountry = "";

  for (const s of states) {
    const alt = s[F.geo_altitude] ?? s[F.baro_altitude];
    const vel = s[F.velocity];
    if (alt != null) { sumAlt += alt; nAlt++; if (alt > maxAlt) { maxAlt = alt; maxAltCallsign = cleanCallsign(s[F.callsign]); maxAltCountry = s[F.origin_country] || ""; } }
    if (vel != null) { sumVel += vel; nVel++; if (vel > maxVel) { maxVel = vel; maxVelCallsign = cleanCallsign(s[F.callsign]); maxVelCountry = s[F.origin_country] || ""; } }
  }

  const avgAlt = nAlt ? sumAlt / nAlt : 0;
  const avgVel = nVel ? sumVel / nVel : 0;

  setKpi("kpi-total", fmtInt(total));
  setKpi("kpi-countries", fmtInt(countries.size));
  setKpi("kpi-alt", `${fmtInt(avgAlt)} m`);
  document.getElementById("kpi-alt-sub").textContent = `${fmtInt(avgAlt * M_TO_FT)} ft`;
  setKpi("kpi-vel", `${fmtInt(avgVel * MPS_TO_KMH)} km/h`);
  document.getElementById("kpi-vel-sub").textContent = `${fmtInt(avgVel * MPS_TO_KT)} kt`;
  setKpi("kpi-max-alt", maxAlt > -Infinity ? `${fmtInt(maxAlt)} m` : "—");
  document.getElementById("kpi-max-alt-sub").textContent = maxAltCallsign ? `${maxAltCallsign} · ${maxAltCountry}` : "—";
  setKpi("kpi-max-vel", maxVel > -Infinity ? `${fmtInt(maxVel * MPS_TO_KMH)} km/h` : "—");
  document.getElementById("kpi-max-vel-sub").textContent = maxVelCallsign ? `${maxVelCallsign} · ${maxVelCountry}` : "—";
}

function setKpi(id, value) {
  const el = document.getElementById(id);
  if (el.textContent !== value) {
    el.textContent = value;
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  }
}

function renderMap(states) {
  cluster.clearLayers();
  const markers = [];
  for (const s of states) {
    const lat = s[F.latitude];
    const lon = s[F.longitude];
    const alt = s[F.geo_altitude] ?? s[F.baro_altitude];
    const vel = s[F.velocity];
    const hdg = s[F.true_track];
    const callsign = cleanCallsign(s[F.callsign]);
    const country = s[F.origin_country] || "—";

    const m = L.marker([lat, lon], { icon: planeIcon(hdg, altClass(alt)) });
    m.bindPopup(`
      <strong>${callsign || s[F.icao24] || "—"}</strong><br/>
      ${country}<br/>
      altitud: ${alt != null ? fmtInt(alt) + " m / " + fmtInt(alt * M_TO_FT) + " ft" : "—"}<br/>
      velocidad: ${vel != null ? fmtInt(vel * MPS_TO_KMH) + " km/h / " + fmtInt(vel * MPS_TO_KT) + " kt" : "—"}<br/>
      rumbo: ${hdg != null ? fmtInt(hdg) + "°" : "—"}
    `);
    markers.push(m);
  }
  cluster.addLayers(markers);
}

function renderCountries(states) {
  const counts = new Map();
  for (const s of states) {
    const c = s[F.origin_country];
    if (!c) continue;
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  countriesChart.data.labels = top.map(([c]) => c);
  countriesChart.data.datasets[0].data = top.map(([, n]) => n);
  countriesChart.update("none");
}

function renderAltitudes(states) {
  let low = 0, mid = 0, high = 0;
  for (const s of states) {
    const a = s[F.geo_altitude] ?? s[F.baro_altitude];
    if (a == null) continue;
    if (a < 3000) low++;
    else if (a < 9000) mid++;
    else high++;
  }
  altChart.data.datasets[0].data = [low, mid, high];
  altChart.update("none");
}

function renderTable(states) {
  const withVel = states
    .filter(s => s[F.velocity] != null)
    .sort((a, b) => b[F.velocity] - a[F.velocity])
    .slice(0, 20);

  const tbody = document.getElementById("table-body");
  if (!withVel.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted center">sin datos</td></tr>`;
    return;
  }
  tbody.innerHTML = withVel.map(s => {
    const alt = s[F.geo_altitude] ?? s[F.baro_altitude];
    const vel = s[F.velocity];
    const hdg = s[F.true_track];
    return `<tr>
      <td>${escapeHtml(cleanCallsign(s[F.callsign]) || s[F.icao24] || "—")}</td>
      <td>${escapeHtml(s[F.origin_country] || "—")}</td>
      <td class="num">${alt != null ? fmtInt(alt) + " m" : "—"}</td>
      <td class="num">${vel != null ? fmtInt(vel * MPS_TO_KMH) + " km/h" : "—"}</td>
      <td class="num">${hdg != null ? fmtInt(hdg) + "°" : "—"}</td>
    </tr>`;
  }).join("");
}

// ---------- STATUS ----------
function setStatus(state, label, unixTime) {
  document.getElementById("status-dot").dataset.state = state;
  document.getElementById("status-label").textContent = label;
  const ts = unixTime ? new Date(unixTime * 1000) : new Date();
  document.getElementById("status-time").textContent = ts.toLocaleTimeString();
}

// ---------- HELPERS ----------
function fmtInt(n) {
  if (n == null || !isFinite(n)) return "—";
  return Math.round(n).toLocaleString("es-PE");
}
function cleanCallsign(c) { return (c || "").trim(); }
function fmtAge(s) {
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return `hace ${h} h`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
}
