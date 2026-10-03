/**
 * Bangkok Flood Intelligence - Frontend Core Application
 * Connects with Live Thaiwater Telemetry & Hydrological Prediction Engine
 */

// Application State
const state = {
  liveData: null,
  activeParams: {
    qBangSai: 2600,
    qChaoPhrayaDam: 2500,
    highTideMsl: 1.55,
    bkkRain24h: 21,
    bkkPumpCapacity: 1650
  },
  currentPreset: 'current',
  map: null,
  stationMarkers: [],
  riverPolyline: null
};

// River Route Coordinates (Chao Phraya Basin Main Stem to Gulf of Thailand)
const RIVER_FLOW_PATH = [
  [15.6705, 100.1189], // C.2 Nakhon Sawan
  [15.3500, 100.1400], // Manorom
  [15.1585, 100.1818], // C.13 Chao Phraya Dam, Chai Nat
  [14.9800, 100.2800], // In Buri
  [14.8872, 100.4042], // C.3 Sing Buri
  [14.7200, 100.4300], // Phrom Buri
  [14.5906, 100.4578], // C.7A Ang Thong
  [14.4700, 100.5100], // Pa Mok
  [14.3512, 100.5489], // C.35 Ayutthaya (Chao Phraya)
  [14.1843, 100.5186], // C.29A Bang Sai (Confluence Gateway)
  [14.0200, 100.5300], // Pathum Thani Town
  [13.9575, 100.5283], // CPY014 Nonthaburi (Nuan Chawi)
  [13.8500, 100.5050], // Rama 7 Bridge
  [13.7842, 100.5115], // C.12 Samsen BKK
  [13.7460, 100.4930], // Memorial Bridge (Pak Khlong Talat)
  [13.7042, 100.4939], // CPY015 Krungthep Bridge
  [13.6300, 100.5800], // Phra Pradaeng
  [13.5600, 100.5900], // Samut Prakan Port
  [13.5200, 100.5950]  // Gulf of Thailand Estuary
];

// Tributary Pasak River to Chao Phraya Confluence
const PASAK_FLOW_PATH = [
  [14.7990, 101.1200], // Pasak Jolasid Dam
  [14.5361, 100.6975], // S.26 Rama VI Dam
  [14.3500, 100.5800], // Ayutthaya Pasak
  [14.3400, 100.5700]  // Confluence with Chao Phraya
];

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  initViewMode();
  initMap();
  setupEventListeners();
  loadLiveData();

  // Auto-refresh every 3 minutes
  setInterval(loadLiveData, 3 * 60 * 1000);
});

// View Mode Management (Simple Mobile vs Pro Detailed)
function initViewMode() {
  // If mobile width or small screen, default to Simple mode
  const isSmallScreen = window.innerWidth <= 850;
  const savedMode = localStorage.getItem('floodViewMode');
  const initialMode = savedMode || (isSmallScreen ? 'simple' : 'pro');

  setViewMode(initialMode);
}

function setViewMode(mode) {
  state.viewMode = mode;
  localStorage.setItem('floodViewMode', mode);

  if (mode === 'simple') {
    document.body.classList.remove('mode-pro');
    document.body.classList.add('mode-simple');
    document.getElementById('btnModeSimple')?.classList.add('active');
    document.getElementById('btnModePro')?.classList.remove('active');
  } else {
    document.body.classList.remove('mode-simple');
    document.body.classList.add('mode-pro');
    document.getElementById('btnModePro')?.classList.add('active');
    document.getElementById('btnModeSimple')?.classList.remove('active');

    // Invalidate map size so Leaflet renders smoothly when unhidden
    setTimeout(() => {
      if (state.map) state.map.invalidateSize();
    }, 200);
  }
}

// 1. Initialize Interactive Leaflet Map
function initMap() {
  // Center between Nakhon Sawan and Gulf of Thailand
  state.map = L.map('riverMap', {
    zoomControl: true,
    attributionControl: false
  }).setView([14.65, 100.45], 8);

  // Esri World Dark Gray Base (Clean, high-performance dark hydrology tiles, no watermark)
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 16,
    attribution: 'Esri, DeLorme, NAVTEQ'
  }).addTo(state.map);

  // Draw Glow River Polyline
  // Background wider glow line
  L.polyline(RIVER_FLOW_PATH, {
    color: '#00f2fe',
    weight: 7,
    opacity: 0.25,
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(state.map);

  // Foreground crisp river line
  state.riverPolyline = L.polyline(RIVER_FLOW_PATH, {
    color: '#38bdf8',
    weight: 3.5,
    opacity: 0.85,
    dashArray: '10, 8',
    lineCap: 'round'
  }).addTo(state.map);

  // Draw Pasak Tributary Line
  L.polyline(PASAK_FLOW_PATH, {
    color: '#818cf8',
    weight: 3,
    opacity: 0.7,
    dashArray: '6, 6'
  }).addTo(state.map);
}

// 2. Fetch Live Telemetry Data from API
async function loadLiveData() {
  const liveStatusText = document.getElementById('liveStatusText');
  const btnRefresh = document.getElementById('btnRefresh');

  try {
    liveStatusText.textContent = 'กำลังเชื่อมต่อและซิงก์ข้อมูล...';
    btnRefresh.classList.add('loading');

    const res = await fetch('/api/water/live');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.success) {
      state.liveData = data;
      liveStatusText.textContent = 'เชื่อมต่อระบบสดเรียบร้อย';

      // If on current preset, update active params
      if (state.currentPreset === 'current') {
        const bangSaiStation = data.stations.find(s => s.code === 'C.29A');
        const damStation = data.stations.find(s => s.code === 'C.13');

        state.activeParams.qBangSai = bangSaiStation?.discharge || 2600;
        state.activeParams.qChaoPhrayaDam = damStation?.discharge || 2500;
        state.activeParams.highTideMsl = data.tide.currentMsl || 1.55;
        state.activeParams.bkkRain24h = data.rain.bkkAverage24h || 20;

        syncSlidersWithParams();
      }

      renderDashboard(data);
      renderMapStations(data.stations);
      renderStationsTable(data.stations);
      renderDamsGrid(data.dams);
    }
  } catch (err) {
    console.error('Failed to load live data:', err);
    liveStatusText.textContent = 'ใช้โหมดจำลองออฟไลน์';
  } finally {
    btnRefresh.classList.remove('loading');
  }
}

// 3. Render Top Metrics, Prediction, and Analysis
function renderDashboard(data) {
  const pred = data.prediction;

  // Ribbon Cards
  const cardBangSaiQ = document.getElementById('cardBangSaiQ');
  const badgeBangSai = document.getElementById('badgeBangSai');
  const cardBangSaiStatus = document.getElementById('cardBangSaiStatus');

  const cardDamQ = document.getElementById('cardDamQ');
  const badgeDam = document.getElementById('badgeDam');

  const cardTideMsl = document.getElementById('cardTideMsl');
  const cardBkkRain = document.getElementById('cardBkkRain');
  const calcTimestamp = document.getElementById('calcTimestamp');

  cardBangSaiQ.textContent = Math.round(pred.qBangSai).toLocaleString();
  cardDamQ.textContent = Math.round(pred.qChaoPhrayaDam).toLocaleString();
  cardTideMsl.textContent = Number(pred.highTideMsl).toFixed(2);
  cardBkkRain.textContent = Number(pred.bkkRain24h).toFixed(1);

  calcTimestamp.textContent = `คำนวณล่าสุด: ${new Date(pred.calculatedAt).toLocaleTimeString('th-TH')}`;

  // Bang Sai Badge status
  if (pred.qBangSai >= 3000) {
    badgeBangSai.className = 'metric-badge bg-danger';
    badgeBangSai.textContent = 'วิกฤติต่อ กทม.';
    cardBangSaiStatus.textContent = 'มวลน้ำเกินความจุปกติ เสี่ยงน้ำล้นคันกั้น';
  } else if (pred.qBangSai >= 2500) {
    badgeBangSai.className = 'metric-badge bg-warn';
    badgeBangSai.textContent = 'เฝ้าระวังเข้มงวด';
    cardBangSaiStatus.textContent = 'น้ำเริ่มเอ่อท่วมชุมชนนอกคันกั้นน้ำ';
  } else {
    badgeBangSai.className = 'metric-badge bg-safe';
    badgeBangSai.textContent = 'อยู่ในเกณฑ์รับได้';
    cardBangSaiStatus.textContent = 'ระบบคันกั้นน้ำ กทม. รองรับได้ปกติ';
  }

  // Dam Badge status
  if (pred.qChaoPhrayaDam >= 2700) {
    badgeDam.className = 'metric-badge bg-danger';
    badgeDam.textContent = 'ระบายวิกฤต';
  } else if (pred.qChaoPhrayaDam >= 2000) {
    badgeDam.className = 'metric-badge bg-warn';
    badgeDam.textContent = 'ระบายสูง';
  } else {
    badgeDam.className = 'metric-badge bg-safe';
    badgeDam.textContent = 'ระบายปกติ';
  }

  // Update Prediction Hero Box
  renderPredictionAssessment(pred);
}

// Render Prediction Assessment & Floodwall Visualizer
function renderPredictionAssessment(pred) {
  const score = pred.compositeRiskScore;
  const gaugeArc = document.getElementById('gaugeProgressArc');
  const gaugeScoreText = document.getElementById('gaugeScoreText');
  const riskStatusPill = document.getElementById('riskStatusPill');
  const riskDot = document.getElementById('riskDot');
  const riskStatusTitle = document.getElementById('riskStatusTitle');
  const riskExplanation = document.getElementById('riskExplanation');

  // SVG Gauge Arc Calculation (Max arc perimeter = 251.2)
  const maxDash = 251.2;
  const targetOffset = maxDash - (score / 100) * maxDash;
  gaugeArc.style.strokeDashoffset = targetOffset;
  gaugeScoreText.textContent = `${score}%`;

  // Status Styling
  riskStatusTitle.textContent = pred.alertTitle;
  riskExplanation.textContent = pred.alertSummary;
  riskStatusPill.style.color = pred.alertColor;
  riskStatusPill.style.borderColor = pred.alertColor;
  riskDot.style.background = pred.alertColor;
  riskDot.style.boxShadow = `0 0 12px ${pred.alertColor}`;

  // Floodwall Visualizer Bar
  const estPeakMsl = document.getElementById('estPeakMsl');
  const fwWaterLevel = document.getElementById('fwWaterLevel');
  const fwWaterLevelText = document.getElementById('fwWaterLevelText');
  const clearanceWall = document.getElementById('clearanceWall');
  const clearanceOuter = document.getElementById('clearanceOuter');

  estPeakMsl.textContent = `+${Number(pred.estimatedPeakMsl).toFixed(2)}`;
  fwWaterLevelText.textContent = `+${Number(pred.estimatedPeakMsl).toFixed(2)} ม.`;

  // Scale: 0 to 2.80 m MSL
  const pctWidth = Math.min(100, Math.max(10, (pred.estimatedPeakMsl / 2.80) * 100));
  fwWaterLevel.style.width = `${pctWidth}%`;

  if (pred.estimatedPeakMsl >= 2.50) {
    fwWaterLevel.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)';
  } else if (pred.estimatedPeakMsl >= 2.00) {
    fwWaterLevel.style.background = 'linear-gradient(90deg, #38bdf8, #f59e0b)';
  } else {
    fwWaterLevel.style.background = 'linear-gradient(90deg, #0284c7, #00f2fe)';
  }

  // Clearances
  if (pred.floodwallClearance > 0) {
    clearanceWall.textContent = `เหลืออีก +${pred.floodwallClearance.toFixed(2)} ม.`;
    clearanceWall.className = 'stat-val text-emerald';
  } else {
    clearanceWall.textContent = `ล้นคันกั้นน้ำ ${Math.abs(pred.floodwallClearance).toFixed(2)} ม.!`;
    clearanceWall.className = 'stat-val text-danger';
  }

  if (pred.outerWallClearance > 0) {
    clearanceOuter.textContent = `เหลืออีก +${pred.outerWallClearance.toFixed(2)} ม.`;
    clearanceOuter.className = 'stat-val text-blue';
  } else {
    clearanceOuter.textContent = `น้ำล้นตลิ่งชุมชนนอกคันแล้ว!`;
    clearanceOuter.className = 'stat-val text-amber';
  }

  // Three Waters Breakdown
  document.getElementById('wFlowVal').textContent = `${pred.flowScore}%`;
  document.getElementById('barFlow').style.width = `${pred.flowScore}%`;

  document.getElementById('wTideVal').textContent = `${pred.tideScore}%`;
  document.getElementById('barTide').style.width = `${pred.tideScore}%`;

  document.getElementById('wRainVal').textContent = `${pred.rainScore}%`;
  document.getElementById('barRain').style.width = `${pred.rainScore}%`;

  // Vulnerable list
  const vulnerableList = document.getElementById('vulnerableList');
  vulnerableList.innerHTML = pred.vulnerableAreas.map(item => `<li>${item}</li>`).join('');

  // Travel Times
  if (pred.travelTimes && pred.travelTimes.length >= 3) {
    document.getElementById('etaC2').textContent = `ประมาณ ${pred.travelTimes[0].hours} ชม.`;
    document.getElementById('etaC13').textContent = `ประมาณ ${pred.travelTimes[1].hours} ชม.`;
    document.getElementById('etaC29A').textContent = `ประมาณ ${pred.travelTimes[2].hours} ชม.`;
  }

  // Also render Simple Mobile View
  renderSimpleMobileView(pred);
}

// Render Simple Mobile View (ดูอย่างง่าย - สรุปสั้น กระชับ สำหรับมือถือ)
function renderSimpleMobileView(pred) {
  const mStatusText = document.getElementById('mStatusText');
  const mHeroBadge = document.getElementById('mHeroBadge');
  const mStatusDot = document.getElementById('mStatusDot');
  const mHeroAnswer = document.getElementById('mHeroAnswer');
  const mCalcTime = document.getElementById('mCalcTime');
  const mEstPeak = document.getElementById('mEstPeak');
  const mClearanceBar = document.getElementById('mClearanceBar');
  const mClearanceSummary = document.getElementById('mClearanceSummary');

  if (!mStatusText) return;

  mCalcTime.textContent = `อัปเดต ${new Date().toLocaleTimeString('th-TH')}`;
  mStatusText.textContent = pred.alertTitle;
  mHeroBadge.style.color = pred.alertColor;
  mHeroBadge.style.borderColor = pred.alertColor;
  mStatusDot.style.background = pred.alertColor;
  mStatusDot.style.boxShadow = `0 0 10px ${pred.alertColor}`;

  // Simple, direct answer in everyday Thai
  if (pred.alertLevel === 'CRITICAL') {
    mHeroAnswer.innerHTML = `<span style="color:#f87171; font-weight:700;">🚨 กทม. เสี่ยงน้ำท่วมชุมชนริมฝั่งและจุดฟันหลอ!</span> ระดับน้ำคาดการณ์ (${pred.estimatedPeakMsl.toFixed(2)} ม.) มีแนวโน้มปริ่มหรือล้นแนวคันกั้นน้ำ 2.50 ม. แนะนำชุมชนนอกคันกั้นน้ำและพื้นที่ลุ่มต่ำยกของขึ้นที่สูงทันที`;
  } else if (pred.alertLevel === 'WARNING') {
    mHeroAnswer.innerHTML = `<span style="color:#fbbf24; font-weight:700;">⚠️ เฝ้าระวัง 16 ชุมชนนอกคันกั้นน้ำ!</span> น้ำเหนือผ่านบางไทรสูง (${Math.round(pred.qBangSai).toLocaleString()} ลบ.ม./วิ) จะเริ่มเอ่อท่วมชุมชนที่อยู่นอกแนวคันกั้นน้ำริมแม่น้ำเจ้าพระยาช่วงน้ำหนุน แต่พื้นที่ กทม. ชั้นในที่มีคันกั้นน้ำคอนกรีตยังปลอดภัย`;
  } else if (pred.alertLevel === 'WATCH') {
    mHeroAnswer.innerHTML = `<span style="color:#38bdf8; font-weight:700;">🟡 กทม. ชั้นในยังปลอดภัย / เฝ้าระวังช่วงน้ำหนุน:</span> มวลน้ำเหนือกำลังเดินทางผ่านอยุธยา ให้ติดตามรอบน้ำทะเลหนุนสูงในแต่ละวันอย่างใกล้ชิด`;
  } else {
    mHeroAnswer.innerHTML = `<span style="color:#34d399; font-weight:700;">✅ กทม. ปลอดภัย ไม่มีความเสี่ยงน้ำท่วม:</span> ระดับน้ำเจ้าพระยายังต่ำกว่าแนวคันกั้นน้ำอย่างมาก ระบบระบายน้ำและสถานีสูบน้ำของ กทม. รับมือได้ปกติ`;
  }

  // Clearance Bar
  mEstPeak.textContent = `+${Number(pred.estimatedPeakMsl).toFixed(2)} ม. รทก.`;
  const pctWidth = Math.min(100, Math.max(10, (pred.estimatedPeakMsl / 2.80) * 100));
  mClearanceBar.style.width = `${pctWidth}%`;

  if (pred.floodwallClearance > 0) {
    mClearanceSummary.innerHTML = `ระยะปลอดภัยถึงยอดคันกั้นน้ำ 2.50 ม.: <strong style="color:var(--accent-emerald);">เหลืออีก +${pred.floodwallClearance.toFixed(2)} ม.</strong>`;
    mClearanceBar.style.background = 'linear-gradient(90deg, #0284c7, #00f2fe)';
  } else {
    mClearanceSummary.innerHTML = `ระดับน้ำคาดการณ์: <strong style="color:var(--accent-crimson);">ล้นคันกั้นน้ำ กทม. ${Math.abs(pred.floodwallClearance).toFixed(2)} ม.!</strong>`;
    mClearanceBar.style.background = 'linear-gradient(90deg, #f59e0b, #ef4444)';
  }

  // 3 Vitals
  document.getElementById('mVitalFlowVal').textContent = Math.round(pred.qBangSai).toLocaleString();
  const flowTag = document.getElementById('mVitalFlowTag');
  if (pred.qBangSai >= 3000) {
    flowTag.textContent = 'วิกฤติต่อ กทม.';
    flowTag.style.color = '#ef4444';
  } else if (pred.qBangSai >= 2500) {
    flowTag.textContent = 'เฝ้าระวังเข้มงวด';
    flowTag.style.color = '#f59e0b';
  } else {
    flowTag.textContent = 'ปกติ';
    flowTag.style.color = '#10b981';
  }

  document.getElementById('mVitalTideVal').textContent = Number(pred.highTideMsl).toFixed(2);
  const tideTag = document.getElementById('mVitalTideTag');
  if (pred.highTideMsl >= 1.90) {
    tideTag.textContent = 'หนุนสูงมาก';
    tideTag.style.color = '#ef4444';
  } else if (pred.highTideMsl >= 1.50) {
    tideTag.textContent = 'หนุนปานกลาง';
    tideTag.style.color = '#f59e0b';
  } else {
    tideTag.textContent = 'หนุนต่ำ/ปกติ';
    tideTag.style.color = '#10b981';
  }

  document.getElementById('mVitalRainVal').textContent = Number(pred.bkkRain24h).toFixed(1);
  const rainTag = document.getElementById('mVitalRainTag');
  if (pred.bkkRain24h >= 60) {
    rainTag.textContent = 'ตกหนักมาก';
    rainTag.style.color = '#ef4444';
  } else if (pred.bkkRain24h >= 30) {
    rainTag.textContent = 'ฝนปานกลาง';
    rainTag.style.color = '#f59e0b';
  } else {
    rainTag.textContent = 'ปกติ/เล็กน้อย';
    rainTag.style.color = '#10b981';
  }

  // ETA Countdown
  if (pred.travelTimes && pred.travelTimes.length >= 3) {
    document.getElementById('mEtaBangSai').textContent = `~${pred.travelTimes[2].hours} ชม.`;
    document.getElementById('mEtaDam').textContent = `~${pred.travelTimes[1].hours} ชม.`;
    document.getElementById('mEtaNakhonSawan').textContent = `~${pred.travelTimes[0].hours} ชม.`;
  }
}

// 4. Render Map Markers for Hydrological Stations
function renderMapStations(stations) {
  // Clear existing markers
  state.stationMarkers.forEach(m => state.map.removeLayer(m));
  state.stationMarkers = [];

  stations.forEach(st => {
    let color = '#10b981';
    if (st.status === 'critical') color = '#ef4444';
    else if (st.status === 'warning') color = '#f59e0b';

    // Highlight Bang Sai gateway
    const isGateway = st.code === 'C.29A';
    const radius = isGateway ? 12 : 9;

    const iconHtml = `
      <div style="
        width: ${radius * 2}px;
        height: ${radius * 2}px;
        background: ${color};
        border-radius: 50%;
        border: 2px solid #ffffff;
        box-shadow: 0 0 12px ${color};
        display: flex;
        align-items: center;
        justify-content: center;
        color: #080d19;
        font-size: 10px;
        font-weight: 800;
      ">
      </div>
    `;

    const customIcon = L.divIcon({
      html: iconHtml,
      className: 'custom-station-pin',
      iconSize: [radius * 2, radius * 2],
      iconAnchor: [radius, radius]
    });

    const marker = L.marker([st.lat, st.lng], { icon: customIcon }).addTo(state.map);

    const popupContent = `
      <div style="font-family: var(--font-main); min-width: 220px; padding: 4px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="background:rgba(0,242,254,0.15); color:#00f2fe; padding:2px 8px; border-radius:6px; font-weight:700; font-size:12px;">
            ${st.code}
          </span>
          <span style="color:${color}; font-weight:600; font-size:12px;">${st.statusText}</span>
        </div>
        <div style="font-weight:700; font-size:14px; color:#ffffff; margin-bottom:2px;">${st.name}</div>
        <div style="font-size:12px; color:#94a3b8; margin-bottom:8px;">${st.province} (${st.river})</div>
        <div style="background:rgba(255,255,255,0.06); padding:8px; border-radius:8px; font-size:12px; display:flex; flex-direction:column; gap:4px;">
          <div>อัตราการไหล (Q): <strong style="color:#00f2fe;">${st.discharge ? st.discharge.toLocaleString() + ' ลบ.ม./วิ' : 'N/A'}</strong></div>
          <div>ระดับน้ำ: <strong>${st.msl ? st.msl + ' ม. รทก.' : 'N/A'}</strong> (ตลิ่ง: ${st.bankLevel} ม.)</div>
          <div>ระยะทางถึง กทม.: <strong>~${st.distKmToBkk} กม.</strong></div>
          <div>เวลาเดินทางสู่ กทม.: <strong style="color:#f59e0b;">~${st.travelHours} ชั่วโมง</strong></div>
        </div>
        <div style="font-size:11px; color:#64748b; margin-top:6px; font-style:italic;">
          ${st.role}
        </div>
      </div>
    `;

    marker.bindPopup(popupContent);
    state.stationMarkers.push(marker);
  });
}

// 5. Render Stations Telemetry Table
function renderStationsTable(stations) {
  const tbody = document.getElementById('stationsTableBody');
  const countBadge = document.getElementById('badgeStationCount');

  countBadge.textContent = `${stations.length} สถานีตรวจวัดหลักลุ่มน้ำเจ้าพระยา`;

  tbody.innerHTML = stations.map(st => {
    let chipClass = 'status-chip-normal';
    if (st.status === 'critical') chipClass = 'status-chip-critical';
    else if (st.status === 'warning') chipClass = 'status-chip-warning';

    const isBangSai = st.code === 'C.29A';
    const rowClass = isBangSai ? 'style="background: rgba(0, 242, 254, 0.05); font-weight: 600;"' : '';

    return `
      <tr ${rowClass}>
        <td><span class="station-code-chip">${st.code}</span></td>
        <td>
          <div style="font-weight: 600;">${st.name}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted);">${st.river}</div>
        </td>
        <td>${st.province}</td>
        <td>~${st.distKmToBkk} กม.</td>
        <td style="color: var(--accent-amber); font-weight: 600;">~${st.travelHours} ชม.</td>
        <td>
          <strong style="color: var(--accent-cyan); font-family: var(--font-mono);">
            ${st.discharge ? Math.round(st.discharge).toLocaleString() : '--'}
          </strong>
          <span style="font-size: 0.7rem; color: var(--text-muted);"> ลบ.ม./วิ</span>
        </td>
        <td>${st.msl ? st.msl.toFixed(2) : '--'}</td>
        <td>${st.bankLevel ? st.bankLevel.toFixed(2) : '--'}</td>
        <td>
          <span class="table-status-pill ${chipClass}">
            <i class="fa-solid fa-circle" style="font-size: 6px;"></i> ${st.statusText}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

// 6. Render Major Dams Grid
function renderDamsGrid(dams) {
  const container = document.getElementById('damsGrid');
  if (!dams || dams.length === 0) return;

  container.innerHTML = dams.map(dam => {
    const pct = Math.round(dam.storagePercent);
    let colorGradient = 'linear-gradient(90deg, #0284c7, #00f2fe)';
    let badgeColor = 'var(--accent-cyan)';

    if (pct >= 85) {
      colorGradient = 'linear-gradient(90deg, #f59e0b, #ef4444)';
      badgeColor = '#ef4444';
    } else if (pct >= 70) {
      colorGradient = 'linear-gradient(90deg, #38bdf8, #f59e0b)';
      badgeColor = '#f59e0b';
    }

    return `
      <div class="dam-card">
        <div class="dam-header">
          <div>
            <div class="dam-name">${dam.name}</div>
            <div class="dam-river">${dam.province} | ${dam.river}</div>
          </div>
          <span class="dam-percent-badge" style="color: ${badgeColor};">${pct}%</span>
        </div>
        <div class="dam-storage-bar">
          <div class="dam-storage-fill" style="width: ${Math.min(100, pct)}%; background: ${colorGradient};"></div>
        </div>
        <div class="dam-metrics-row">
          <span>ความจุอ่าง: ${dam.capacity.toLocaleString()} ล้าน ลบ.ม.</span>
          <span>ระบาย: ${dam.releasedMcm ? dam.releasedMcm + ' ล้าน ลบ.ม./วัน' : 'N/A'}</span>
        </div>
      </div>
    `;
  }).join('');
}

// 7. Event Listeners & Simulator Controls
function setupEventListeners() {
  // Refresh Button
  document.getElementById('btnRefresh').addEventListener('click', () => {
    loadLiveData();
  });

  // View Mode Switch Buttons
  document.getElementById('btnModeSimple')?.addEventListener('click', () => setViewMode('simple'));
  document.getElementById('btnModePro')?.addEventListener('click', () => setViewMode('pro'));
  document.getElementById('btnSwitchToPro')?.addEventListener('click', () => {
    setViewMode('pro');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Simulator Sliders
  const sliderBangSai = document.getElementById('sliderBangSai');
  const sliderDam = document.getElementById('sliderDam');
  const sliderTide = document.getElementById('sliderTide');
  const sliderRain = document.getElementById('sliderRain');

  const onSliderChange = () => {
    state.activeParams.qBangSai = Number(sliderBangSai.value);
    state.activeParams.qChaoPhrayaDam = Number(sliderDam.value);
    state.activeParams.highTideMsl = Number(sliderTide.value);
    state.activeParams.bkkRain24h = Number(sliderRain.value);

    // Update label values
    document.getElementById('valSliderBangSai').textContent = `${state.activeParams.qBangSai.toLocaleString()} ลบ.ม./วินาที`;
    document.getElementById('valSliderDam').textContent = `${state.activeParams.qChaoPhrayaDam.toLocaleString()} ลบ.ม./วินาที`;
    document.getElementById('valSliderTide').textContent = `${state.activeParams.highTideMsl.toFixed(2)} ม. รทก.`;
    document.getElementById('valSliderRain').textContent = `${state.activeParams.bkkRain24h} มม.`;

    recalculateScenario();
  };

  sliderBangSai.addEventListener('input', onSliderChange);
  sliderDam.addEventListener('input', onSliderChange);
  sliderTide.addEventListener('input', onSliderChange);
  sliderRain.addEventListener('input', onSliderChange);

  // Preset Buttons
  document.querySelectorAll('.btn-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const presetId = btn.dataset.preset;
      state.currentPreset = presetId;

      applyPreset(presetId);
    });
  });
}

// Apply Preset Scenarios
function applyPreset(presetId) {
  if (presetId === 'current') {
    if (state.liveData) {
      const bangSai = state.liveData.stations.find(s => s.code === 'C.29A');
      const dam = state.liveData.stations.find(s => s.code === 'C.13');
      state.activeParams.qBangSai = bangSai?.discharge || 2600;
      state.activeParams.qChaoPhrayaDam = dam?.discharge || 2500;
      state.activeParams.highTideMsl = state.liveData.tide.currentMsl || 1.55;
      state.activeParams.bkkRain24h = state.liveData.rain.bkkAverage24h || 20;
    }
  } else if (presetId === 'flood2011') {
    // 2011 Historic Mega Flood
    state.activeParams.qChaoPhrayaDam = 3700;
    state.activeParams.qBangSai = 4200;
    state.activeParams.highTideMsl = 2.30;
    state.activeParams.bkkRain24h = 95;
  } else if (presetId === 'flood2022') {
    // 2022 Warning
    state.activeParams.qChaoPhrayaDam = 2750;
    state.activeParams.qBangSai = 3100;
    state.activeParams.highTideMsl = 1.95;
    state.activeParams.bkkRain24h = 45;
  } else if (presetId === 'dryseason') {
    // Normal Dry
    state.activeParams.qChaoPhrayaDam = 300;
    state.activeParams.qBangSai = 450;
    state.activeParams.highTideMsl = 1.10;
    state.activeParams.bkkRain24h = 0;
  }

  syncSlidersWithParams();
  recalculateScenario();
}

// Synchronize Sliders UI with State Params
function syncSlidersWithParams() {
  document.getElementById('sliderBangSai').value = state.activeParams.qBangSai;
  document.getElementById('sliderDam').value = state.activeParams.qChaoPhrayaDam;
  document.getElementById('sliderTide').value = state.activeParams.highTideMsl;
  document.getElementById('sliderRain').value = state.activeParams.bkkRain24h;

  document.getElementById('valSliderBangSai').textContent = `${state.activeParams.qBangSai.toLocaleString()} ลบ.ม./วินาที`;
  document.getElementById('valSliderDam').textContent = `${state.activeParams.qChaoPhrayaDam.toLocaleString()} ลบ.ม./วินาที`;
  document.getElementById('valSliderTide').textContent = `${Number(state.activeParams.highTideMsl).toFixed(2)} ม. รทก.`;
  document.getElementById('valSliderRain').textContent = `${state.activeParams.bkkRain24h} มม.`;
}

// Recalculate Scenario (Client-Side Instant Calculation with Server Sync)
async function recalculateScenario() {
  try {
    const res = await fetch('/api/water/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.activeParams)
    });
    const json = await res.json();
    if (json.success) {
      renderPredictionAssessment(json.result);

      // Also update top metric cards in real-time
      document.getElementById('cardBangSaiQ').textContent = Math.round(state.activeParams.qBangSai).toLocaleString();
      document.getElementById('cardDamQ').textContent = Math.round(state.activeParams.qChaoPhrayaDam).toLocaleString();
      document.getElementById('cardTideMsl').textContent = Number(state.activeParams.highTideMsl).toFixed(2);
      document.getElementById('cardBkkRain').textContent = Number(state.activeParams.bkkRain24h).toFixed(1);
    }
  } catch (err) {
    console.error('Recalculate error:', err);
  }
}
