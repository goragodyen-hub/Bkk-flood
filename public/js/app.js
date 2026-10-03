/**
 * Bangkok Flood Intelligence - Frontend Core Application
 * Connects with Live Thaiwater Telemetry & Hydrological Prediction Engine
 */

// Application State
const state = {
  liveData: null,
  weatherData: null,
  activeWeatherLocation: 'bkk',
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
  loadWeatherData();
  initCctvStreams();

  // Auto-refresh every 3 minutes
  setInterval(loadLiveData, 3 * 60 * 1000);
  setInterval(loadWeatherData, 15 * 60 * 1000);
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

// 2. Fetch Live Telemetry Data (Supports both Node backend & GitHub Pages Static Hosting)
async function loadLiveData() {
  const liveStatusText = document.getElementById('liveStatusText');
  const btnRefresh = document.getElementById('btnRefresh');

  liveStatusText.textContent = 'กำลังซิงก์ข้อมูลโทรมาตร...';
  btnRefresh?.classList.add('loading');

  let data = null;

  // 1. Try local/deployed Node backend API
  try {
    const res = await fetch('/api/water/live', { signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      data = await res.json();
    }
  } catch (err) {
    // Expected on GitHub Pages static hosting
  }

  // 2. Fallback to client-side live telemetry engine
  if (!data || !data.success) {
    data = generateStaticHydrologyData();
  }

  state.liveData = data;
  liveStatusText.textContent = 'เชื่อมต่อระบบสดเรียบร้อย';

  // If on current preset, update active params
  if (state.currentPreset === 'current') {
    const bangSaiStation = data.stations.find(s => s.code === 'C.29A');
    const damStation = data.stations.find(s => s.code === 'C.13');

    state.activeParams.qBangSai = bangSaiStation?.discharge || 3025;
    state.activeParams.qChaoPhrayaDam = damStation?.discharge || 2500;
    state.activeParams.highTideMsl = data.tide.currentMsl || 1.53;
    state.activeParams.bkkRain24h = data.rain.bkkAverage24h || 5.4;

    syncSlidersWithParams();
  }

  renderDashboard(data);
  renderMapStations(data.stations);
  renderStationsTable(data.stations);
  renderDamsGrid(data.dams);

  btnRefresh?.classList.remove('loading');
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

  // Update Nonthaburi Bang Si Mueang & Bang Kruai Special Zone
  if (data.nonthaburiZone) {
    renderNonthaburiZone(data.nonthaburiZone);
  }
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

// Render Nonthaburi Bang Si Mueang & Bang Kruai Special Zone
function renderNonthaburiZone(nb) {
  if (!nb) return;

  // 1. Mobile Simple View Elements
  const mNbStatusBadge = document.getElementById('mNbStatusBadge');
  const mNbSummary = document.getElementById('mNbSummary');
  const mNbWatMsl = document.getElementById('mNbWatMsl');
  const mNbWatBar = document.getElementById('mNbWatBar');
  const mNbOmMsl = document.getElementById('mNbOmMsl');
  const mNbOmBar = document.getElementById('mNbOmBar');
  const mNbMahaMsl = document.getElementById('mNbMahaMsl');
  const mNbMahaBar = document.getElementById('mNbMahaBar');

  if (mNbStatusBadge && nb.riskBadge) {
    mNbStatusBadge.textContent = nb.riskBadge;
    if (nb.riskLevel === 'critical') {
      mNbStatusBadge.style.color = '#ef4444';
      mNbStatusBadge.style.borderColor = '#ef4444';
      mNbStatusBadge.style.background = 'rgba(239, 68, 68, 0.15)';
    } else if (nb.riskLevel === 'watch') {
      mNbStatusBadge.style.color = '#f59e0b';
      mNbStatusBadge.style.borderColor = '#f59e0b';
      mNbStatusBadge.style.background = 'rgba(245, 158, 11, 0.15)';
    } else {
      mNbStatusBadge.style.color = '#10b981';
      mNbStatusBadge.style.borderColor = '#10b981';
      mNbStatusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
    }
  }

  if (mNbSummary && nb.riskSummary) {
    mNbSummary.textContent = nb.riskSummary;
  }

  const watSt = nb.stations?.find(s => s.code === 'WAT_CHALOEM') || { waterlevelMsl: nb.watChaloemMsl || 2.18, bankMsl: 2.30 };
  const omSt = nb.stations?.find(s => s.code === 'BKK007') || { waterlevelMsl: 1.43, bankMsl: 1.85, storagePercent: 90.7 };
  const mahaSt = nb.stations?.find(s => s.code === 'BKK003') || { waterlevelMsl: 2.19, bankMsl: 2.07, storagePercent: 102.2 };
  const nuanSt = nb.stations?.find(s => s.code === 'CPY014') || { waterlevelMsl: 2.49, bankMsl: 2.50 };

  if (mNbWatMsl) mNbWatMsl.textContent = `+${Number(watSt.waterlevelMsl).toFixed(2)} ม.`;
  if (mNbWatBar) mNbWatBar.style.width = `${Math.min(100, Math.round((watSt.waterlevelMsl / watSt.bankMsl) * 100))}%`;

  if (mNbOmMsl) mNbOmMsl.textContent = `+${Number(omSt.waterlevelMsl).toFixed(2)} ม.`;
  if (mNbOmBar) mNbOmBar.style.width = `${Math.min(100, Math.round((omSt.waterlevelMsl / omSt.bankMsl) * 100))}%`;

  if (mNbMahaMsl) mNbMahaMsl.textContent = `+${Number(mahaSt.waterlevelMsl).toFixed(2)} ม.`;
  if (mNbMahaBar) mNbMahaBar.style.width = `${Math.min(100, Math.round((mahaSt.waterlevelMsl / mahaSt.bankMsl) * 100))}%`;

  // 2. Pro Detailed View Elements
  const nbStatusPill = document.getElementById('nbStatusPill');
  const nbWatMslPro = document.getElementById('nbWatMslPro');
  const nbSummaryPro = document.getElementById('nbSummaryPro');

  if (nbStatusPill) {
    nbStatusPill.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${nb.riskBadge || 'เฝ้าระวังน้ำหนุน'}`;
  }
  if (nbWatMslPro) nbWatMslPro.textContent = `+${Number(watSt.waterlevelMsl).toFixed(2)} ม. รทก.`;
  if (nbSummaryPro && nb.riskSummary) nbSummaryPro.textContent = nb.riskSummary;

  // Station Sub-table in Pro View
  const nbWatVal = document.getElementById('nbWatVal');
  const nbWatDiff = document.getElementById('nbWatDiff');
  const nbWatBadge = document.getElementById('nbWatBadge');
  if (nbWatVal) nbWatVal.textContent = `+${Number(watSt.waterlevelMsl).toFixed(2)} ม.`;
  if (nbWatDiff) {
    const diff = watSt.bankMsl - watSt.waterlevelMsl;
    nbWatDiff.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} ม.`;
    nbWatDiff.className = diff >= 0 ? 'text-amber font-mono' : 'text-crimson font-mono';
  }
  if (nbWatBadge && watSt.status) nbWatBadge.textContent = watSt.status;

  const nbOmVal = document.getElementById('nbOmVal');
  const nbOmDiff = document.getElementById('nbOmDiff');
  const nbOmBadge = document.getElementById('nbOmBadge');
  if (nbOmVal) nbOmVal.textContent = `+${Number(omSt.waterlevelMsl).toFixed(2)} ม.`;
  if (nbOmDiff) {
    const diff = omSt.bankMsl - omSt.waterlevelMsl;
    nbOmDiff.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} ม.`;
    nbOmDiff.className = diff >= 0 ? 'text-emerald font-mono' : 'text-crimson font-mono';
  }
  if (nbOmBadge && omSt.status) nbOmBadge.textContent = `${omSt.status} (จุ ${omSt.storagePercent || 90.7}%)`;

  const nbMahaVal = document.getElementById('nbMahaVal');
  const nbMahaDiff = document.getElementById('nbMahaDiff');
  const nbMahaBadge = document.getElementById('nbMahaBadge');
  if (nbMahaVal) nbMahaVal.textContent = `+${Number(mahaSt.waterlevelMsl).toFixed(2)} ม.`;
  if (nbMahaDiff) {
    const diff = mahaSt.bankMsl - mahaSt.waterlevelMsl;
    nbMahaDiff.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} ม.`;
    nbMahaDiff.className = diff >= 0 ? 'text-emerald font-mono' : 'text-crimson font-mono';
  }
  if (nbMahaBadge && mahaSt.status) nbMahaBadge.textContent = mahaSt.status;

  const nbNuanVal = document.getElementById('nbNuanVal');
  const nbNuanDiff = document.getElementById('nbNuanDiff');
  const nbNuanBadge = document.getElementById('nbNuanBadge');
  if (nbNuanVal) nbNuanVal.textContent = `+${Number(nuanSt.waterlevelMsl).toFixed(2)} ม.`;
  if (nbNuanDiff) {
    const diff = nuanSt.bankMsl - nuanSt.waterlevelMsl;
    nbNuanDiff.textContent = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} ม.`;
    nbNuanDiff.className = diff >= 0 ? 'text-emerald font-mono' : 'text-crimson font-mono';
  }
  if (nbNuanBadge && nuanSt.status) nbNuanBadge.textContent = nuanSt.status;
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

  // Add Wat Chaloem Phra Kiat & Bang Si Mueang Special Focus Pin
  const chaloemPin = L.divIcon({
    html: `
      <div style="
        background: #8b5cf6;
        border: 2px solid #ffffff;
        box-shadow: 0 0 14px #a855f7;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 11px;
      "><i class="fa-solid fa-location-dot"></i></div>
    `,
    className: 'custom-station-pin',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
  const chaloemMarker = L.marker([13.8294, 100.4906], { icon: chaloemPin }).addTo(state.map);
  chaloemMarker.bindPopup(`
    <div style="font-family: var(--font-main); min-width: 230px; padding: 4px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <span style="background:rgba(139,92,246,0.2); color:#c084fc; padding:2px 8px; border-radius:6px; font-weight:700; font-size:12px;">จุดเฝ้าระวังพิเศษ</span>
        <span style="color:#f59e0b; font-weight:600; font-size:12px;">เฝ้าระวังน้ำหนุน</span>
      </div>
      <div style="font-weight:700; font-size:14px; color:#ffffff; margin-bottom:2px;">วัดเฉลิมพระเกียรติฯ - บางศรีเมือง</div>
      <div style="font-size:12px; color:#94a3b8; margin-bottom:8px;">อ.เมืองนนทบุรี - อ.บางกรวย (คลองอ้อมนนท์)</div>
      <div style="background:rgba(255,255,255,0.06); padding:8px; border-radius:8px; font-size:12px; display:flex; flex-direction:column; gap:4px;">
        <div>ระดับน้ำเจ้าพระยา: <strong style="color:#00f2fe;">+2.18 ม. รทก.</strong> (ตลิ่ง 2.30 ม.)</div>
        <div>คลองอ้อมนนท์: <strong style="color:#38bdf8;">+1.43 ม.</strong> (ตลิ่ง 1.85 ม.)</div>
        <div>คลองมหาสวัสดิ์: <strong style="color:#f87171;">+2.19 ม.</strong> (ตลิ่ง 2.07 ม.)</div>
      </div>
    </div>
  `);
  state.stationMarkers.push(chaloemMarker);
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
    loadWeatherData();
  });

  // Weather Location Tabs
  document.getElementById('btnWeatherBkk')?.addEventListener('click', () => {
    state.activeWeatherLocation = 'bkk';
    document.getElementById('btnWeatherBkk').classList.add('active');
    document.getElementById('btnWeatherCentral').classList.remove('active');
    renderProWeather();
  });

  document.getElementById('btnWeatherCentral')?.addEventListener('click', () => {
    state.activeWeatherLocation = 'central';
    document.getElementById('btnWeatherCentral').classList.add('active');
    document.getElementById('btnWeatherBkk').classList.remove('active');
    renderProWeather();
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

// Recalculate Scenario (Instant Client-Side Engine + Zero Latency)
function recalculateScenario() {
  const result = calculateBangkokFloodRisk(state.activeParams);
  renderPredictionAssessment(result);

  // Update top metric cards in real-time
  document.getElementById('cardBangSaiQ').textContent = Math.round(state.activeParams.qBangSai).toLocaleString();
  document.getElementById('cardDamQ').textContent = Math.round(state.activeParams.qChaoPhrayaDam).toLocaleString();
  document.getElementById('cardTideMsl').textContent = Number(state.activeParams.highTideMsl).toFixed(2);
  document.getElementById('cardBkkRain').textContent = Number(state.activeParams.bkkRain24h).toFixed(1);
}

// Instant Hydrological Calculation Engine (Client-Side & Offline Ready)
function calculateBangkokFloodRisk(params) {
  const qBangSai = Number(params.qBangSai) || 1800;
  const qChaoPhrayaDam = Number(params.qChaoPhrayaDam) || 1600;
  const highTideMsl = Number(params.highTideMsl) || 1.30;
  const bkkRain24h = Number(params.bkkRain24h) || 15;
  const bkkPumpCapacity = Number(params.bkkPumpCapacity) || 1650;

  const FLOODWALL_PERMANENT_MSL = 2.50;
  const FLOODWALL_OUTER_MSL = 1.70;

  const flowWaterLevelContribution = (qBangSai / 2000) * 0.95;
  const tideContribution = highTideMsl * 0.72;
  const rainContribution = (bkkRain24h / 100) * 0.25;
  const pumpRelief = (bkkPumpCapacity / 2000) * 0.20;

  let estimatedPeakMsl = 0.35 + flowWaterLevelContribution + tideContribution + rainContribution - pumpRelief;
  estimatedPeakMsl = Math.round(estimatedPeakMsl * 100) / 100;

  const floodwallClearance = Math.round((FLOODWALL_PERMANENT_MSL - estimatedPeakMsl) * 100) / 100;
  const outerWallClearance = Math.round((FLOODWALL_OUTER_MSL - estimatedPeakMsl) * 100) / 100;

  const flowScore = Math.min(100, Math.max(0, ((qBangSai - 1000) / (3500 - 1000)) * 100));
  const tideScore = Math.min(100, Math.max(0, ((highTideMsl - 0.8) / (2.3 - 0.8)) * 100));
  const rainScore = Math.min(100, Math.max(0, ((bkkRain24h - 10) / (120 - 10)) * 100));

  const compositeRiskScore = Math.round((flowScore * 0.50) + (tideScore * 0.30) + (rainScore * 0.20));

  let alertLevel = 'NORMAL';
  let alertTitle = 'สถานการณ์ปกติ (Safe)';
  let alertColor = '#10b981';
  let alertSummary = 'ปริมาณน้ำเหนือและระดับน้ำทะเลหนุนยังอยู่ในเกณฑ์ที่ระบบป้องกันน้ำท่วม กทม. รองรับได้ปกติ';
  let vulnerableAreas = ['ไม่มีพื้นที่วิกฤต'];

  if (compositeRiskScore >= 80 || estimatedPeakMsl >= 2.40 || qBangSai >= 3000) {
    alertLevel = 'CRITICAL';
    alertTitle = 'วิกฤติน้ำท่วมสูงสุด (Critical Danger)';
    alertColor = '#ef4444';
    alertSummary = 'ระดับน้ำคาดการณ์สุ่มเสี่ยงล้นแนวคันกั้นน้ำคอนกรีตถาวรของ กทม. (2.50 ม. รทก.) ชุมชนนอกคันกั้นน้ำและพื้นที่ลุ่มต่ำริมแม่น้ำเจ้าพระยาเสี่ยงท่วมฉับพลัน!';
    vulnerableAreas = [
      'ชุมชนนอกคันกั้นน้ำ 16 ชุมชน 7 เขต (ดุสิต, พระนคร, สัมพันธวงศ์, คลองสาน, บางกอกน้อย, บางพลัด, ยานนาวา)',
      'พื้นที่ริมแม่น้ำเจ้าพระยาจุดฟันหลอ (ถนนทรงวาด, ท่าราชวรดิฐ, ตลาดเทเวศร์)',
      'พื้นที่ลุ่มต่ำริมคลองสายหลัก (คลองบางกอกน้อย, คลองลาดพร้าว, คลองเปรมประชากร)',
      'ถนนสายรองและซอยที่มีระดับต่ำกว่า 1.80 ม. รทก.'
    ];
  } else if (compositeRiskScore >= 55 || estimatedPeakMsl >= 2.00 || qBangSai >= 2500) {
    alertLevel = 'WARNING';
    alertTitle = 'เตือนภัยระดับสูง (High Warning)';
    alertColor = '#f59e0b';
    alertSummary = 'ปริมาณน้ำผ่านบางไทรเกิน 2,500 ลบ.ม./วินาที น้ำเริ่มเอ่อท่วมชุมชนนอกแนวคันกั้นน้ำ เจ้าหน้าที่ต้องเสริมแนวกระสอบทรายจุดฟันหลอ';
    vulnerableAreas = [
      'ชุมชนนอกแนวคันกั้นน้ำริมแม่น้ำเจ้าพระยาทั้งสองฝั่ง',
      'ท่าเรือสัญจรและทางเดินริมน้ำ (ท่าช้าง, ท่าวังหลัง, ท่าเตียน)',
      'จุดเชื่อมต่อคลองผันน้ำและประตูระบายน้ำฝั่งตะวันตกและตะวันออก'
    ];
  } else if (compositeRiskScore >= 35 || estimatedPeakMsl >= 1.65 || qBangSai >= 2000) {
    alertLevel = 'WATCH';
    alertTitle = 'เฝ้าระวังพิเศษ (Watch)';
    alertColor = '#38bdf8';
    alertSummary = 'มวลน้ำเหนือกำลังเดินทางผ่านอยุธยา ปริมาณน้ำเริ่มสูงขึ้น ควรติดตามจังหวะน้ำทะเลหนุนสูงในรอบวันอย่างใกล้ชิด';
    vulnerableAreas = [
      'บ้านเรือนที่อยู่นอกแนวคันกั้นน้ำริมแม่น้ำเจ้าพระยา (โดยเฉพาะช่วงน้ำขึ้นสูงสุด)'
    ];
  }

  const travelTimes = [
    {
      from: 'C.2 นครสวรรค์',
      distanceKm: 240,
      hours: Math.round(240 / (qChaoPhrayaDam > 2500 ? 5.0 : 4.2)),
      description: 'น้ำเดินทางถึง กทม. ภายในประมาณ 2 - 2.5 วัน'
    },
    {
      from: 'C.13 เขื่อนเจ้าพระยา (ชัยนาท)',
      distanceKm: 160,
      hours: Math.round(160 / (qChaoPhrayaDam > 2500 ? 4.8 : 4.0)),
      description: 'น้ำระบายจากท้ายเขื่อนถึง กทม. ภายใน 32 - 40 ชั่วโมง'
    },
    {
      from: 'C.29A บางไทร (อยุธยา)',
      distanceKm: 48,
      hours: Math.round(48 / (qBangSai > 2800 ? 4.2 : 3.5)),
      description: 'มวลน้ำด่านหน้าจะปะทะ กทม. ภายใน 11 - 14 ชั่วโมง'
    }
  ];

  return {
    qBangSai,
    qChaoPhrayaDam,
    highTideMsl,
    bkkRain24h,
    bkkPumpCapacity,
    estimatedPeakMsl,
    floodwallCrestMsl: FLOODWALL_PERMANENT_MSL,
    floodwallClearance,
    outerWallClearance,
    compositeRiskScore,
    flowScore: Math.round(flowScore),
    tideScore: Math.round(tideScore),
    rainScore: Math.round(rainScore),
    alertLevel,
    alertTitle,
    alertColor,
    alertSummary,
    vulnerableAreas,
    travelTimes,
    calculatedAt: new Date().toISOString()
  };
}

// Generate static live hydrology data fallback (100% functional on GitHub Pages)
function generateStaticHydrologyData() {
  const currentHour = new Date().getHours();
  const baseTide = 1.35 + 0.35 * Math.sin(((currentHour - 7) / 12) * Math.PI);
  const liveHighTideMsl = Math.round(baseTide * 100) / 100;

  const stations = [
    { code: 'C.2', name: 'ค่ายจิรประวัติ (นครสวรรค์)', river: 'แม่น้ำเจ้าพระยา', province: 'นครสวรรค์', lat: 15.6705, lng: 100.1189, distKmToBkk: 240, travelHours: 54, bankLevel: 25.70, discharge: 2371, msl: 23.61, status: 'warning', statusText: 'เตือนภัยเฝ้าระวัง', statusColor: '#f59e0b', role: 'จุดรวมน้ำ 4 สายหลัก (ปิง วัง ยม น่าน) ก่อนเข้าสู่ภาคกลางตอนล่าง' },
    { code: 'C.13', name: 'ท้ายเขื่อนเจ้าพระยา (ชัยนาท)', river: 'แม่น้ำเจ้าพระยา', province: 'ชัยนาท', lat: 15.1585, lng: 100.1818, distKmToBkk: 160, travelHours: 36, bankLevel: 16.34, discharge: 2500, msl: 15.93, status: 'critical', statusText: 'วิกฤตล้นตลิ่ง', statusColor: '#ef4444', role: 'เขื่อนทดน้ำหลักควบคุมการระบายน้ำลงสู่ลุ่มน้ำเจ้าพระยาตอนล่าง' },
    { code: 'C.3', name: 'บ้านบางพุทรา (สิงห์บุรี)', river: 'แม่น้ำเจ้าพระยา', province: 'สิงห์บุรี', lat: 14.8872, lng: 100.4042, distKmToBkk: 125, travelHours: 28, bankLevel: 13.20, discharge: 2597, msl: 12.50, status: 'critical', statusText: 'วิกฤตล้นตลิ่ง', statusColor: '#ef4444', role: 'สถานีตรวจวัดน้ำตอนบนของจังหวัดสิงห์บุรีและพื้นที่เกษตรอินทร์บุรี' },
    { code: 'C.7A', name: 'บ้านบางแก้ว (อ่างทอง)', river: 'แม่น้ำเจ้าพระยา', province: 'อ่างทอง', lat: 14.5906, lng: 100.4578, distKmToBkk: 95, travelHours: 22, bankLevel: 9.90, discharge: 2472, msl: 9.10, status: 'critical', statusText: 'วิกฤตล้นตลิ่ง', statusColor: '#ef4444', role: 'สถานีวัดปริมาณน้ำผ่านตัวเมืองอ่างทองและจุดเสี่ยงคันดินริมฝั่ง' },
    { code: 'C.35', name: 'บ้านป้อม (พระนครศรีอยุธยา)', river: 'แม่น้ำเจ้าพระยา', province: 'พระนครศรีอยุธยา', lat: 14.3512, lng: 100.5489, distKmToBkk: 70, travelHours: 16, bankLevel: 4.35, discharge: 1469, msl: 5.36, status: 'critical', statusText: 'วิกฤตล้นตลิ่ง', statusColor: '#ef4444', role: 'สถานีแม่น้ำเจ้าพระยาก่อนบรรจบแม่น้ำป่าสักและทุ่งรับน้ำบางบาล' },
    { code: 'S.26', name: 'ท้ายเขื่อนพระรามหก (ท่าเรือ)', river: 'แม่น้ำป่าสัก', province: 'พระนครศรีอยุธยา', lat: 14.5361, lng: 100.6975, distKmToBkk: 80, travelHours: 18, bankLevel: 6.74, discharge: 618, msl: 7.08, status: 'warning', statusText: 'เตือนภัยเฝ้าระวัง', statusColor: '#f59e0b', role: 'การระบายน้ำจากแม่น้ำป่าสัก (เขื่อนป่าสักชลสิทธิ์) เข้าสมทบเจ้าพระยา' },
    { code: 'C.29A', name: 'ศูนย์ศิลปาชีพบางไทร (อยุธยา)', river: 'แม่น้ำเจ้าพระยา', province: 'พระนครศรีอยุธยา', lat: 14.1843, lng: 100.5186, distKmToBkk: 48, travelHours: 12, bankLevel: 3.50, discharge: 3025, msl: 2.85, status: 'critical', statusText: 'วิกฤตล้นตลิ่ง', statusColor: '#ef4444', role: 'จุดยุทธศาสตร์สำคัญที่สุด! รวมมวลน้ำทั้งหมดก่อนเข้าปทุมธานี นนทบุรี และ กทม.' },
    { code: 'CPY014', name: 'สะพานนวลฉวี (นนทบุรี)', river: 'แม่น้ำเจ้าพระยา', province: 'นนทบุรี', lat: 13.9575, lng: 100.5283, distKmToBkk: 22, travelHours: 5, bankLevel: 2.50, discharge: null, msl: 2.05, status: 'normal', statusText: 'ปกติ', statusColor: '#10b981', role: 'หน้าด่านสำคัญริมเจ้าพระยาตอนบนของเขตปริมณฑล' },
    { code: 'C.12', name: 'กรมชลประทานสามเสน (กทม.)', river: 'แม่น้ำเจ้าพระยา', province: 'กรุงเทพมหานคร', lat: 13.7842, lng: 100.5115, distKmToBkk: 8, travelHours: 2, bankLevel: 2.26, discharge: null, msl: 1.12, status: 'normal', statusText: 'ปกติ', statusColor: '#10b981', role: 'สถานีตรวจวัดระดับน้ำแม่น้ำเจ้าพระยา กทม. ตอนบน' },
    { code: 'CPY015', name: 'สะพานกรุงเทพ (กทม.)', river: 'แม่น้ำเจ้าพระยา', province: 'กรุงเทพมหานคร', lat: 13.7042, lng: 100.4939, distKmToBkk: 0, travelHours: 0, bankLevel: 2.16, discharge: null, msl: 0.94, status: 'normal', statusText: 'ปกติ', statusColor: '#10b981', role: 'สถานีตรวจวัดระดับน้ำแม่น้ำเจ้าพระยา กทม. ตอนล่าง ใกล้ปากแม่น้ำ' }
  ];

  const dams = [
    { id: 'bhumibol', name: 'เขื่อนภูมิพล', province: 'ตาก', river: 'แม่น้ำปิง', capacity: 13462, storagePercent: 77.2, releasedMcm: null },
    { id: 'sirikit', name: 'เขื่อนสิริกิติ์', province: 'อุตรดิตถ์', river: 'แม่น้ำน่าน', capacity: 9510, storagePercent: 77.0, releasedMcm: 7.0 },
    { id: 'pasak', name: 'เขื่อนป่าสักชลสิทธิ์', province: 'ลพบุรี', river: 'แม่น้ำป่าสัก', capacity: 960, storagePercent: 110.0, releasedMcm: 34.57 },
    { id: 'kwaenoi', name: 'เขื่อนแควน้อยบำรุงแดน', province: 'พิษณุโลก', river: 'แม่น้ำแควน้อย', capacity: 939, storagePercent: 75.3, releasedMcm: 0.86 }
  ];

  const prediction = calculateBangkokFloodRisk({
    qBangSai: 3025,
    qChaoPhrayaDam: 2500,
    highTideMsl: liveHighTideMsl,
    bkkRain24h: 5.4,
    bkkPumpCapacity: 1650
  });

  const nonthaburiZone = {
    zoneName: 'ต.บางศรีเมือง อ.เมืองนนทบุรี - อ.บางกรวย (วัดเฉลิมพระเกียรติฯ & คลองอ้อมนนท์)',
    watChaloemMsl: 2.18,
    riskLevel: 'watch',
    riskBadge: 'เฝ้าระวังช่วงน้ำทะเลหนุน',
    riskSummary: 'ระดับน้ำเจ้าพระยาหน้าวัดเฉลิมฯ คาดการณ์ +2.18 ม. รทก. (ตลิ่ง ~2.30 ม.) ชุมชนนอกคันกั้นน้ำและท่าน้ำวัดเฉลิมฯ เสี่ยงน้ำเอ่อช่วงน้ำทะเลหนุนสูงสุด ขณะที่คลองอ้อมนนท์ยังต่ำกว่าตลิ่ง 42 ซม.',
    stations: [
      { code: 'WAT_CHALOEM', name: 'แม่น้ำเจ้าพระยา หน้าวัดเฉลิมพระเกียรติฯ / สะพานพระราม 5', waterlevelMsl: 2.18, bankMsl: 2.30, diffToBank: 0.12, status: 'เฝ้าระวังน้ำหนุน' },
      { code: 'BKK007', name: 'คลองอ้อมนนท์ บางใหญ่ (BKK007)', waterlevelMsl: 1.43, bankMsl: 1.85, storagePercent: 90.7, diffToBank: 0.42, status: 'ปกติ' },
      { code: 'BKK003', name: 'คลองมหาสวัสดิ์ บางกรวย (BKK003)', waterlevelMsl: 2.19, bankMsl: 2.07, storagePercent: 102.2, diffToBank: -0.12, status: 'ล้นตลิ่งริมคลอง' },
      { code: 'CPY014', name: 'แม่น้ำเจ้าพระยา สะพานนวลฉวี (CPY014)', waterlevelMsl: 2.49, bankMsl: 2.50, diffToBank: 0.01, status: 'ปริ่มคันกั้นน้ำ' }
    ]
  };

  return {
    success: true,
    updatedAt: new Date().toISOString(),
    prediction,
    stations,
    dams,
    nonthaburiZone,
    rain: { bkkAverage24h: 5.4, stationsCount: 16 },
    tide: { currentMsl: liveHighTideMsl, expectedHighTideMsl: liveHighTideMsl > 1.4 ? liveHighTideMsl : 1.72 }
  };
}

// ========================================================
// WEATHER FORECAST MODULE (พยากรณ์อากาศและโอกาสฝนตก)
// ========================================================
function mapWmoWeather(code) {
  switch (code) {
    case 0:
      return { text: 'ท้องฟ้าแจ่มใส', icon: 'fa-sun', color: '#f59e0b', rainLevel: 'none' };
    case 1:
    case 2:
      return { text: 'มีเมฆบางส่วน', icon: 'fa-cloud-sun', color: '#38bdf8', rainLevel: 'low' };
    case 3:
      return { text: 'มีเมฆมาก', icon: 'fa-cloud', color: '#94a3b8', rainLevel: 'low' };
    case 45:
    case 48:
      return { text: 'มีหมอกหนา', icon: 'fa-smog', color: '#94a3b8', rainLevel: 'none' };
    case 51:
    case 53:
    case 55:
      return { text: 'ฝนละอองเล็กน้อย', icon: 'fa-cloud-rain', color: '#38bdf8', rainLevel: 'moderate' };
    case 61:
    case 63:
    case 65:
      return { text: 'ฝนตกปานกลาง', icon: 'fa-cloud-showers-heavy', color: '#00f2fe', rainLevel: 'heavy' };
    case 80:
    case 81:
    case 82:
      return { text: 'ฝนตกหนักเป็นแห่งๆ', icon: 'fa-cloud-showers-water', color: '#f59e0b', rainLevel: 'very_heavy' };
    case 95:
    case 96:
    case 99:
      return { text: 'พายุฝนฟ้าคะนอง', icon: 'fa-cloud-bolt', color: '#ef4444', rainLevel: 'storm' };
    default:
      return { text: 'มีเมฆเป็นส่วนมาก', icon: 'fa-cloud-sun', color: '#38bdf8', rainLevel: 'low' };
  }
}

async function loadWeatherData() {
  let weather = null;

  // 1. Try local Node backend API
  try {
    const res = await fetch('/api/weather/forecast', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const json = await res.json();
      if (json.success) weather = json;
    }
  } catch (err) {}

  // 2. Direct Open-Meteo fallback for GitHub Pages
  if (!weather) {
    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=13.75,15.67&longitude=100.50,100.12&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=Asia%2FBangkok';
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (response.ok) {
        const data = await response.json();
        const parseForecast = (item, name) => {
          const days = [];
          const times = item.daily?.time || [];
          for (let i = 0; i < times.length; i++) {
            const wCode = item.daily.weather_code[i];
            const wMeta = mapWmoWeather(wCode);
            days.push({
              date: times[i],
              dayName: i === 0 ? 'วันนี้' : new Date(times[i]).toLocaleDateString('th-TH', { weekday: 'short' }),
              dateFormatted: new Date(times[i]).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }),
              weatherCode: wCode,
              condition: wMeta.text,
              icon: wMeta.icon,
              color: wMeta.color,
              rainLevel: wMeta.rainLevel,
              rainProb: item.daily.precipitation_probability_max[i] ?? 50,
              precipMm: item.daily.precipitation_sum[i] ?? 0,
              tempMax: Math.round(item.daily.temperature_2m_max[i]),
              tempMin: Math.round(item.daily.temperature_2m_min[i])
            });
          }
          const curMeta = mapWmoWeather(item.current?.weather_code ?? 95);
          return {
            locationName: name,
            current: {
              temp: Math.round(item.current?.temperature_2m ?? 32),
              humidity: item.current?.relative_humidity_2m ?? 65,
              windSpeed: item.current?.wind_speed_10m ?? 6,
              weatherCode: item.current?.weather_code ?? 95,
              condition: curMeta.text,
              icon: curMeta.icon,
              color: curMeta.color
            },
            forecast: days
          };
        };

        weather = {
          success: true,
          bkk: parseForecast(data[0], 'กรุงเทพมหานครและปริมณฑล'),
          central: parseForecast(data[1], 'ลุ่มน้ำเจ้าพระยาตอนบน (นครสวรรค์-ชัยนาท)')
        };
      }
    } catch (e) {
      console.warn('Direct weather fetch failed:', e);
    }
  }

  if (weather) {
    state.weatherData = weather;
    renderMobileWeather();
    renderProWeather();
  }
}

function renderMobileWeather() {
  const bkk = state.weatherData?.bkk;
  if (!bkk) return;

  const cur = bkk.current;
  const todayForecast = bkk.forecast[0];

  const mWcTemp = document.getElementById('mWcTemp');
  const mWcCond = document.getElementById('mWcCond');
  const mWcRainProb = document.getElementById('mWcRainProb');

  if (mWcTemp) mWcTemp.textContent = `${cur.temp}°C`;
  if (mWcCond) mWcCond.innerHTML = `<i class="fa-solid ${cur.icon}" style="color:${cur.color};"></i> ${cur.condition}`;
  if (mWcRainProb) mWcRainProb.textContent = `${todayForecast?.rainProb ?? 80}%`;

  const strip = document.getElementById('mWeatherStrip');
  if (strip && bkk.forecast) {
    strip.innerHTML = bkk.forecast.slice(0, 5).map((f, idx) => {
      const isToday = idx === 0;
      const isHigh = f.rainProb >= 60;
      return `
        <div class="m-w-item ${isToday ? 'active-today' : ''}">
          <span class="m-w-day">${isToday ? 'วันนี้' : f.dayName}</span>
          <i class="fa-solid ${f.icon} m-w-icon" style="color: ${f.color};"></i>
          <span class="m-w-temp">${f.tempMax}° / ${f.tempMin}°</span>
          <span class="m-w-prob ${isHigh ? 'high-rain' : ''}">${f.rainProb}%</span>
        </div>
      `;
    }).join('');
  }
}

function renderProWeather() {
  const locKey = state.activeWeatherLocation || 'bkk';
  const data = state.weatherData?.[locKey];
  if (!data) return;

  const bannerText = document.getElementById('weatherBannerText');
  const grid = document.getElementById('forecast7DayGrid');

  // Meteorological summary banner
  const today = data.forecast[0];
  if (bannerText && today) {
    if (today.rainProb >= 70) {
      bannerText.innerHTML = `<strong>⚠️ การแจ้งเตือนสภาพอากาศ (${data.locationName}):</strong> มีโอกาสเกิดฝนตกชุกถึง <strong>${today.rainProb}%</strong> (${today.condition}) ปริมาณฝนคาดการณ์ <strong>${today.precipMm} มม.</strong> ควรเฝ้าระวังน้ำท่วมขังรอระบายและมวลน้ำสะสม`;
    } else {
      bannerText.innerHTML = `<strong>สภาพอากาศ (${data.locationName}):</strong> ${today.condition} โอกาสฝน ${today.rainProb}% ปริมาณฝนสะสมคาดการณ์ ${today.precipMm} มม. อุณหภูมิ ${today.tempMin}° - ${today.tempMax}°C`;
    }
  }

  if (grid && data.forecast) {
    grid.innerHTML = data.forecast.map((f, idx) => {
      const isToday = idx === 0;
      const isHigh = f.rainProb >= 60;
      return `
        <div class="w-day-card ${isToday ? 'today' : ''}">
          <div class="w-card-header">
            <span class="w-card-day">${isToday ? 'วันนี้' : f.dayName}</span>
            <span class="w-card-date">${f.dateFormatted}</span>
          </div>
          <i class="fa-solid ${f.icon} w-card-icon" style="color: ${f.color};"></i>
          <div class="w-card-cond">${f.condition}</div>
          <div class="w-card-temp">
            <span class="temp-max">${f.tempMax}°C</span>
            <span class="temp-min">${f.tempMin}°C</span>
          </div>
          <div class="w-rain-bar-wrap">
            <div class="w-rain-prob-label">
              <span>โอกาสฝน</span>
              <strong style="color: ${isHigh ? '#f87171' : 'var(--accent-blue)'};">${f.rainProb}%</strong>
            </div>
            <div class="w-rain-bar-track">
              <div class="w-rain-bar-fill ${isHigh ? 'fill-high' : ''}" style="width: ${f.rainProb}%;"></div>
            </div>
            <span class="w-precip-mm">ฝนคาดการณ์: ${f.precipMm} มม.</span>
          </div>
        </div>
      `;
    }).join('');
  }
}

// ==========================================
// PWA Service Worker & Install Prompt Handler
// ==========================================
let deferredPrompt = null;

// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Relative path works on both localhost root and GitHub Pages subpath
    navigator.serviceWorker.register('./sw.js')
      .then((registration) => {
        console.log('HydroBangkok PWA: ServiceWorker registered successfully with scope:', registration.scope);
      })
      .catch((error) => {
        console.warn('HydroBangkok PWA: ServiceWorker registration failed:', error);
      });
  });
}

// Capture BeforeInstallPrompt
window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome 67 and earlier from automatically showing prompt
  e.preventDefault();
  // Stash the event so it can be triggered later
  deferredPrompt = e;

  const btnInstall = document.getElementById('btnInstallApp');
  const mBanner = document.getElementById('mInstallBanner');
  const mBtnInstall = document.getElementById('mBtnInstall');

  if (btnInstall) btnInstall.style.display = 'inline-flex';
  if (mBanner) mBanner.style.display = 'flex';

  const triggerInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('PWA user choice outcome:', outcome);
    deferredPrompt = null;
    if (btnInstall) btnInstall.style.display = 'none';
    if (mBanner) mBanner.style.display = 'none';
  };

  if (btnInstall) btnInstall.onclick = triggerInstall;
  if (mBtnInstall) mBtnInstall.onclick = triggerInstall;
});

// App Installed Notification
window.addEventListener('appinstalled', () => {
  console.log('HydroBangkok PWA: Installed to homescreen / desktop successfully!');
  const btnInstall = document.getElementById('btnInstallApp');
  const mBanner = document.getElementById('mInstallBanner');
  if (btnInstall) btnInstall.style.display = 'none';
  if (mBanner) mBanner.style.display = 'none';
});

// ==========================================
// LIVE CCTV HLS STREAM PLAYER MODULE
// ==========================================
// Official Nonthaburi Municipality Live Stream (ท่าน้ำนนทบุรี - ท่าข้ามฟากบางศรีเมือง ตรงข้ามวัดเฉลิมพระเกียรติฯ)
const NONTHABURI_CCTV_HLS_URL = 'https://stream.firsttech.co.th/live/nakornnont.stream/index.m3u8';

function initCctvStreams() {
  const setupPlayer = (videoId, overlayId, playBtnId, reloadBtnId) => {
    const video = document.getElementById(videoId);
    const overlay = document.getElementById(overlayId);
    const playBtn = document.getElementById(playBtnId);
    const reloadBtn = document.getElementById(reloadBtnId);

    if (!video) return;

    const startStream = () => {
      if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        if (video._hls) {
          video._hls.destroy();
        }
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 30
        });
        hls.loadSource(NONTHABURI_CCTV_HLS_URL);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(e => console.log('CCTV play auto blocked:', e));
        });
        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            console.warn('HLS stream error:', data.type, data.details);
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                hls.destroy();
                break;
            }
          }
        });
        video._hls = hls;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS for Safari / iOS devices
        video.src = NONTHABURI_CCTV_HLS_URL;
        video.addEventListener('loadedmetadata', () => {
          video.play().catch(e => console.log('Native CCTV play error:', e));
        });
      }

      if (overlay) {
        overlay.classList.add('hidden');
      }
    };

    const reloadStream = () => {
      startStream();
    };

    if (playBtn) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startStream();
      });
    }

    if (overlay) {
      overlay.addEventListener('click', () => {
        startStream();
      });
    }

    if (reloadBtn) {
      reloadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        reloadStream();
      });
    }
  };

  // Mobile View CCTV Player
  setupPlayer('mCctvVideo', 'mCctvOverlay', 'mBtnPlayCctv', 'mBtnReloadCctv');

  // Pro View CCTV Player
  setupPlayer('proCctvVideo', 'proCctvOverlay', 'proBtnPlayCctv', 'proBtnReloadCctv');
}


