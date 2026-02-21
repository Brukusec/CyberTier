const SCORING_CONFIG = {
  impact_score_map: { 'Material/Severe': 100, High: 70, Medium: 40, Low: 10 },
  exposure_weights: {
    internet_facing: 25,
    partner_or_public_api: 15,
    weak_auth_no_mfa_legacy_shared: 20,
    recent_major_change_90d: 10,
    bad_history_critical_findings_or_incidents_18m: 15,
    many_users_enterprise_wide: 15
  },
  crown_jewel_multiplier: 0.10,
  tier_thresholds: [
    { tier: 'P0', min_score: 170 },
    { tier: 'P1', min_score: 150 },
    { tier: 'P2', min_score: 120 },
    { tier: 'P3', min_score: 90 },
    { tier: 'P4', min_score: 0 }
  ]
};

const state = {
  settings: { dataDir: '' },
  assets: [],
  businessUnits: [],
  pentestProjects: [],
  selectedProjectId: '',
  assetsFilterBuIds: [],
  assetsSearch: '',
  owner: localStorage.getItem('cyberdel-owner') || `user-${crypto.randomUUID().slice(0,8)}`,
  ownedLocks: [],
  projectEditMode: false,
  selectedBuId: ''
};
localStorage.setItem('cyberdel-owner', state.owner);
  projectEditMode: false
};
localStorage.setItem('cyberdel-owner', state.owner);
  assetsSearch: ''
};

const $ = (id) => document.getElementById(id);
const assetsTbody = document.querySelector('#assetsTable tbody');
const buTbody = document.querySelector('#buTable tbody');
const projectsTbody = document.querySelector('#pentestProjectsTable tbody');
const findingsTbody = document.querySelector('#findingsTable tbody');
const reportsTbody = document.querySelector('#reportsTable tbody');
const closeProjectWorkbenchBtn = $('closeProjectWorkbenchBtn');
const projectSubfolder = $('projectSubfolder');
const buSubfolder = $('buSubfolder');
const projectEditBtn = $('projectEditBtn');
const findingWorkbench = $('findingWorkbench');
const openFindingEditorBtn = $('openFindingEditorBtn');
const closeFindingWorkbenchBtn = $('closeFindingWorkbenchBtn');
const cvssScoreInput = $('cvssScore');
const cvssSeverityInput = $('cvssSeverity');
const openReportEditorBtn = $('openReportEditorBtn');
const cancelReportEditorBtn = $('cancelReportEditorBtn');
const reportFormEl = $('reportForm');
const buEditorModal = $('buEditorModal');
let persistTimer = null;

function setStatus(msg) { $('status').textContent = msg; }
function sanitiseText(value, max = 240) {
  return String(value || '')
    .replace(/[<>\`]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function sanitiseDate(value) {
  const v = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

async function acquireLock(resourceType, resourceId) {
  if (!resourceId) return true;
  const res = await fetch('/api/locks/acquire', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceType, resourceId, owner: state.owner, ttlSeconds: 120 })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const owner = data?.lock?.owner || 'another user';
    setStatus(`Record is locked by ${owner}. Please try again later.`);
    return false;
  }
  const key = `${resourceType}:${resourceId}`;
  if (!state.ownedLocks.includes(key)) state.ownedLocks.push(key);
  return true;
}

async function releaseLock(resourceType, resourceId) {
  if (!resourceId) return;
  await fetch('/api/locks/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceType, resourceId, owner: state.owner })
  }).catch(() => {});
  state.ownedLocks = state.ownedLocks.filter((k) => k !== `${resourceType}:${resourceId}`);
}


function hasOwnedLock(resourceType, resourceId) {
  return state.ownedLocks.includes(`${resourceType}:${resourceId}`);
}

function releaseAllLocks() {
  state.ownedLocks.forEach((key) => {
    const [resourceType, ...rest] = key.split(':');
    const resourceId = rest.join(':');
    navigator.sendBeacon?.('/api/locks/release', JSON.stringify({ resourceType, resourceId, owner: state.owner }));
  });
}

window.addEventListener('beforeunload', releaseAllLocks);


let persistTimer = null;

function setStatus(msg) { $('status').textContent = msg; }
function escapeHtml(text) { return String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;'); }


async function persistState(message = 'Changes saved automatically.') {
  try {
    const [assetsRes, buRes, pentestsRes] = await Promise.all([
      fetch('/api/assets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.assets) }),
      fetch('/api/business-units', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.businessUnits) }),
      fetch('/api/pentests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state.pentestProjects) })
    ]);
    if (!assetsRes.ok || !buRes.ok || !pentestsRes.ok) return setStatus('Unable to save changes.');
    setStatus(message);
  } catch (error) {
    setStatus('Unable to save changes.');
  }
}

function queuePersist(message = 'Changes saved automatically.') {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { persistTimer = null; persistState(message); }, 250);
}

function normalizeExposureFactors(exposure = {}) {
  return {
    internet_facing: Number(exposure.internet_facing) ? 1 : 0,
    partner_or_public_api: Number(exposure.partner_or_public_api) ? 1 : 0,
    weak_auth_no_mfa_legacy_shared: Number(exposure.weak_auth_no_mfa_legacy_shared) ? 1 : 0,
    recent_major_change_90d: Number(exposure.recent_major_change_90d) ? 1 : 0,
    bad_history_critical_findings_or_incidents_18m: Number(exposure.bad_history_critical_findings_or_incidents_18m) ? 1 : 0,
    many_users_enterprise_wide: Number(exposure.many_users_enterprise_wide) ? 1 : 0
  };
}

function computePriority(asset, config = SCORING_CONFIG) {
  const impact = config.impact_score_map[asset.riskImpactRating] ?? 10;
  const exposure = Object.entries(config.exposure_weights).reduce((sum, [k, w]) => sum + ((asset.exposureFactors?.[k] || 0) * w), 0);
  const priority = impact * (1 + exposure / 100);
  const adjusted = priority * (1 + config.crown_jewel_multiplier * (asset.crownJewelAdjacency ? 1 : 0));
  const tier = config.tier_thresholds.find(rule => adjusted >= rule.min_score)?.tier || 'P4';
  return {
    impact_score: impact,
    exposure_score: exposure,
    priority_score: Number(priority.toFixed(2)),
    adjusted_priority_score: Number(adjusted.toFixed(2)),
    pentest_priority_tier: tier
  };
}

function createAsset(payload = {}) {
  const asset = {
    id: payload.id || crypto.randomUUID(),
    assetId: sanitiseText(payload.assetId || payload.asset_id || '', 80),
    name: sanitiseText(payload.name || payload.asset_name || '', 140),
    assetType: payload.assetType || payload.asset_type || 'WebApp',
    buId: payload.buId || '',
    businessOwner: sanitiseText(payload.businessOwner || payload.business_owner || '', 120),
    techOwner: sanitiseText(payload.techOwner || payload.tech_owner || '', 120),
    mainContact: sanitiseText(payload.mainContact || '', 120),
    otherContacts: sanitiseText(payload.otherContacts || '', 180),
    assetId: payload.assetId || payload.asset_id || '',
    name: payload.name || payload.asset_name || '',
    assetType: payload.assetType || payload.asset_type || 'WebApp',
    buId: payload.buId || '',
    businessOwner: payload.businessOwner || payload.business_owner || '',
    techOwner: payload.techOwner || payload.tech_owner || '',
    mainContact: payload.mainContact || '',
    otherContacts: payload.otherContacts || '',
    environment: payload.environment || 'Prod',
    externalFacing: Boolean(payload.externalFacing),
    riskImpactRating: payload.riskImpactRating || payload.risk_impact_rating || 'Medium',
    exposureFactors: normalizeExposureFactors(payload.exposureFactors || {}),
    crownJewelAdjacency: Number(payload.crownJewelAdjacency) ? 1 : 0,
    cyberTierDefinedYear: sanitiseText(payload.cyberTierDefinedYear || '', 20),
    cyberTierCurrentYear: sanitiseText(payload.cyberTierCurrentYear || '', 20),
    cyberTierPreviousYear: sanitiseText(payload.cyberTierPreviousYear || '', 20),
    pentestDate: sanitiseDate(payload.pentestDate || ''),
    cyberTierDefinedYear: payload.cyberTierDefinedYear || '',
    cyberTierCurrentYear: payload.cyberTierCurrentYear || '',
    cyberTierPreviousYear: payload.cyberTierPreviousYear || '',
    pentestStatus: payload.pentestStatus || 'No schedule',
    pentestDone: Boolean(payload.pentestDone)
  };
  asset.calc = computePriority(asset);
  return asset;
}

function parseContacts(value) {
  if (Array.isArray(value)) return value.map((v) => sanitiseText(v, 120)).filter(Boolean);
  return String(value || '').split(/\r?\n|,/).map((v) => sanitiseText(v, 120)).filter(Boolean);
}

function createBusinessUnit(payload = {}) {
  return {
    id: payload.id || crypto.randomUUID(),
    buId: sanitiseText(payload.buId || payload.code || '', 80),
    name: sanitiseText(payload.name || '', 120),
    mainContact: sanitiseText(payload.mainContact || '', 120),
    otherContacts: parseContacts(payload.otherContacts || payload.contacts || [])
  };
function createBusinessUnit(payload = {}) {
  return { id: payload.id || crypto.randomUUID(), name: payload.name || '', mainContact: payload.mainContact || '' };
}

function calculateCvssFromMetrics(m) {
  const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.av] || 0.85;
  const AC = { L: 0.77, H: 0.44 }[m.ac] || 0.77;
  const UI = { N: 0.85, R: 0.62 }[m.ui] || 0.85;
  const S = m.s || 'U';
  const PRU = { N: 0.85, L: 0.62, H: 0.27 };
  const PRC = { N: 0.85, L: 0.68, H: 0.5 };
  const PR = (S === 'C' ? PRC : PRU)[m.pr] || 0.85;
  const C = { N: 0, L: 0.22, H: 0.56 }[m.c] || 0;
  const I = { N: 0, L: 0.22, H: 0.56 }[m.i] || 0;
  const A = { N: 0, L: 0.22, H: 0.56 }[m.a] || 0;

  const impactBase = 1 - ((1 - C) * (1 - I) * (1 - A));
  const impact = S === 'U' ? 6.42 * impactBase : 7.52 * (impactBase - 0.029) - 3.25 * Math.pow(impactBase - 0.02, 15);
  const exploitability = 8.22 * AV * AC * PR * UI;
  let score = 0;
  if (impact > 0) {
    score = S === 'U' ? Math.min(impact + exploitability, 10) : Math.min(1.08 * (impact + exploitability), 10);
  }
  score = Math.ceil(score * 10) / 10;
  let severity = 'None';
  if (score >= 9) severity = 'Critical';
  else if (score >= 7) severity = 'High';
  else if (score >= 4) severity = 'Medium';
  else if (score > 0) severity = 'Low';
  return { score, severity };
}

function normaliseFinding(f = {}) {
  return {
    id: f.id || crypto.randomUUID(),
    title: sanitiseText(f.title || '', 180),
    description: sanitiseText(f.description || '', 2000),
    reproSteps: sanitiseText(f.reproSteps || '', 2000),
    impact: sanitiseText(f.impact || '', 1500),
    cvssScore: Number(f.cvssScore || f.cvss || 0) || 0,
    severity: sanitiseText(f.severity || 'Low', 20),
    cwe: sanitiseText(f.cwe || '', 120),
    owasp: sanitiseText(f.owasp || '', 120),
    ttp: sanitiseText(f.ttp || 'Not applicable', 120),
    dateFound: sanitiseDate(f.dateFound || f.discoveredAt || ''),
    status: sanitiseText(f.status || 'Open', 40)
  };
}


function normaliseReport(r = {}) {
  return {
    id: r.id || crypto.randomUUID(),
    name: sanitiseText(r.name || '', 140),
    type: r.type || 'Technical report',
    status: r.status || 'Draft',
    version: sanitiseText(r.version || '', 20),
    reference: sanitiseText(r.reference || '', 220),
    deliveredAt: sanitiseDate(r.deliveredAt || ''),
    attachmentName: sanitiseText(r.attachmentName || '', 220),
    attachmentType: sanitiseText(r.attachmentType || '', 80)
function normaliseFinding(f = {}) {
  return {
    id: f.id || crypto.randomUUID(),
    title: f.title || '',
    severity: f.severity || 'Medium',
    status: f.status || 'Open',
    cvss: f.cvss || '',
    cwe: f.cwe || '',
    owasp: f.owasp || '',
    affectedEndpoint: f.affectedEndpoint || '',
    ttp: f.ttp || '',
    description: f.description || '',
    recommendation: f.recommendation || ''
  };
}

function normaliseReport(r = {}) {
  return {
    id: r.id || crypto.randomUUID(),
    name: r.name || '',
    type: r.type || 'Technical report',
    status: r.status || 'Draft',
    version: r.version || '',
    reference: r.reference || '',
    deliveredAt: r.deliveredAt || ''
  };
}

function createProject(payload = {}) {
  return {
    id: payload.id || crypto.randomUUID(),
    name: sanitiseText(payload.name || 'Untitled project', 140),
    clientName: sanitiseText(payload.clientName || '', 140),
    assetId: payload.assetId || '',
    buId: payload.buId || '',
    phase: payload.phase || 'Planning',
    testLead: sanitiseText(payload.testLead || '', 120),
    clientContact: sanitiseText(payload.clientContact || '', 120),
    startDate: sanitiseDate(payload.startDate || ''),
    endDate: sanitiseDate(payload.endDate || ''),
    methodology: sanitiseText(payload.methodology || '', 120),
    retestRequired: Boolean(payload.retestRequired),
    scope: sanitiseText(payload.scope || '', 1200),
    attackSurface: sanitiseText(payload.attackSurface || '', 1200),
    executiveSummary: sanitiseText(payload.executiveSummary || '', 1200),
    name: payload.name || 'Untitled project',
    clientName: payload.clientName || '',
    assetId: payload.assetId || '',
    buId: payload.buId || '',
    phase: payload.phase || 'Planning',
    testLead: payload.testLead || '',
    clientContact: payload.clientContact || '',
    startDate: payload.startDate || '',
    endDate: payload.endDate || '',
    methodology: payload.methodology || '',
    retestRequired: Boolean(payload.retestRequired),
    scope: payload.scope || '',
    attackSurface: payload.attackSurface || '',
    executiveSummary: payload.executiveSummary || '',
    findings: (payload.findings || []).map(normaliseFinding),
    reports: (payload.reports || []).map(normaliseReport)
  };
}

function getBuName(buId) { return state.businessUnits.find((b) => b.id === buId)?.name || '—'; }
function getAssetName(id) { return state.assets.find((a) => a.id === id)?.name || '—'; }
function getPriorityTier(asset) { return asset.calc?.pentest_priority_tier || 'P4'; }

function formatMetric(assets, tier) {
  const set = assets.filter((a) => getPriorityTier(a) === tier);
  if (!set.length) return '0% (0/0)';
  const done = set.filter((a) => a.pentestDone).length;
  return `${Math.round((done / set.length) * 100)}% (${done}/${set.length})`;
}

function tierBadge(tier) { return `<span class="badge badge-tier badge-${String(tier).toLowerCase()}">${escapeHtml(tier)}</span>`; }
function statusBadge(status) {
  const key = String(status || '').toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
  return `<span class="badge badge-status status-${key}">${escapeHtml(status || 'No schedule')}</span>`;
}

function renderDashboard() {
  $('kpiTotalAssets').textContent = String(state.assets.length);
  $('kpiTotalBu').textContent = String(state.businessUnits.length);
  $('kpiP0').textContent = formatMetric(state.assets, 'P0');
  $('kpiP1').textContent = formatMetric(state.assets, 'P1');
  $('kpiP2').textContent = formatMetric(state.assets, 'P2');
}

function getVisibleAssets() {
  const byBu = state.assetsFilterBuIds.length ? state.assets.filter((a) => state.assetsFilterBuIds.includes(a.buId)) : state.assets;
  const query = state.assetsSearch.trim().toLowerCase();
  return query ? byBu.filter((a) => [a.name, a.assetId, a.businessOwner, a.techOwner, getBuName(a.buId)].join(' ').toLowerCase().includes(query)) : byBu;
}

function renderAssetsOverview() {
  const assets = getVisibleAssets();
  const tiers = ['P0', 'P1', 'P2', 'P3', 'P4'];
  const counts = Object.fromEntries(tiers.map((t) => [t, 0]));
  const done = Object.fromEntries(tiers.map((t) => [t, 0]));

  assets.forEach((a) => {
    const tier = getPriorityTier(a);
    counts[tier] += 1;
    if (a.pentestDone) done[tier] += 1;
  });

  $('assetsTotalCount').textContent = String(assets.length);
  $('assetsSeveritySummary').textContent = tiers.map((t) => `${t}:${counts[t]}`).join(' • ');
  $('tierDistributionChart').innerHTML = tiers.map((t) => {
    const pct = assets.length ? Math.round((counts[t] / assets.length) * 100) : 0;
    return `<div class="mini-row"><span>${t}</span><div class="mini-bar"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>`;
  }).join('');
  $('tierCoverageChart').innerHTML = tiers.map((t) => {
    const pct = counts[t] ? Math.round((done[t] / counts[t]) * 100) : 0;
    return `<div class="mini-row"><span>${t}</span><div class="mini-bar cov"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>`;
  }).join('');
}

function renderAssetsTable() {
  assetsTbody.innerHTML = '';
  getVisibleAssets().forEach((asset) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(asset.name)}</td>
      <td>${escapeHtml(getBuName(asset.buId))}</td>
      <td>${tierBadge(getPriorityTier(asset))} <span class="risk-text">${escapeHtml(asset.riskImpactRating)}</span></td>
      <td>${escapeHtml(asset.cyberTierDefinedYear || getPriorityTier(asset))}</td>
      <td>${statusBadge(asset.pentestStatus)}</td>
      <td><button class="small-btn" data-show="1">Show</button> <button class="small-btn" data-edit="1">Edit</button> <button class="small-btn" data-del="1">Remove</button></td>`;

    tr.querySelector('[data-show]').addEventListener('click', () => openAssetShow(asset));
    tr.querySelector('[data-edit]').addEventListener('click', () => openAssetEditor(asset));
    tr.querySelector('[data-del]').addEventListener('click', () => {
      state.assets = state.assets.filter((a) => a.id !== asset.id);
      state.pentestProjects.forEach((p) => { if (p.assetId === asset.id) p.assetId = ''; });
      renderAll();
      queuePersist('Asset removed and saved.');
    });
    assetsTbody.appendChild(tr);
  });
}

function openBusinessUnit(buId) {
  if (!state.businessUnits.some((b) => b.id === buId)) return;
  state.selectedBuId = buId;
  openTab('buTab');
  syncBuPanels();
  renderBuTable();
  renderBuDetail();
  renderBuSubfolder();
}

function renderBuOverview() {
  $('buTotalUnits').textContent = String(state.businessUnits.length);
  $('buTotalAssets').textContent = String(state.assets.length);
  $('buP0').textContent = formatMetric(state.assets, 'P0');
  $('buP1').textContent = formatMetric(state.assets, 'P1');
  $('buP2').textContent = formatMetric(state.assets, 'P2');
}


function syncBuPanels() {
  const overview = $('buOverviewPanel');
  const metrics = $('buMetricsPanel');
  const detail = $('buDetailPanel');
  const hasSelection = !!state.selectedBuId;
  overview?.classList.toggle('hidden', hasSelection);
  metrics?.classList.toggle('hidden', hasSelection);
  detail?.classList.toggle('hidden', !hasSelection);
}

function renderBuTable() {
  buTbody.innerHTML = '';
  state.businessUnits.forEach((bu) => {
    const buAssets = state.assets.filter((a) => a.buId === bu.id);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(bu.buId || '—')}</td>
      <td>${escapeHtml(bu.name)}</td>
      <td>${escapeHtml(bu.mainContact || '—')}</td>
      <td><input data-k="name" value="${escapeHtml(bu.name)}" /></td>
      <td><input data-k="mainContact" value="${escapeHtml(bu.mainContact)}" /></td>
      <td>${escapeHtml(buAssets.map((a) => a.name).join(', ') || '—')}</td>
      <td>${buAssets.length}</td>
      <td>${formatMetric(buAssets, 'P0')}</td>
      <td>${formatMetric(buAssets, 'P1')}</td>
      <td>${formatMetric(buAssets, 'P2')}</td>
      <td><button class="small-btn" data-open="1">Open</button> <button class="small-btn" data-del="1">Remove</button></td>`;

    tr.querySelector('[data-open]').addEventListener('click', () => openBusinessUnit(bu.id));
      <td><button class="small-btn" data-del="1">Remove</button></td>`;

    tr.querySelectorAll('input').forEach((input) => input.addEventListener('change', (e) => { bu[e.target.dataset.k] = e.target.value; queuePersist('Business Unit updated and saved.'); }));
    tr.querySelector('[data-del]').addEventListener('click', () => {
      state.businessUnits = state.businessUnits.filter((x) => x.id !== bu.id);
      state.assets.forEach((a) => { if (a.buId === bu.id) a.buId = ''; });
      state.pentestProjects.forEach((p) => { if (p.buId === bu.id) p.buId = ''; });
      if (state.selectedBuId === bu.id) state.selectedBuId = '';
      renderAll();
      queuePersist('Business Unit removed and saved.');
    });
    buTbody.appendChild(tr);
  });
}

function renderBuDetail() {
  const container = $('buDetailContent');
  const title = $('buDetailTitle');
  const bu = state.businessUnits.find((b) => b.id === state.selectedBuId) || null;
  if (!bu) {
    if (title) title.textContent = 'BU details';
    if (container) {
      container.className = 'bu-detail-empty';
      container.textContent = 'Select a Business Unit to view linked assets and pentests.';
    }
    return;
  }

  const buAssets = state.assets.filter((a) => a.buId === bu.id);
  const buProjects = state.pentestProjects.filter((p) => p.buId === bu.id);
  if (title) title.textContent = `BU details: ${bu.name}`;
  container.className = 'bu-detail-grid';
  container.innerHTML = `
    <div class="bu-detail-meta">
      <div class="bu-meta-item"><span>BU ID</span><strong>${escapeHtml(bu.buId || '—')}</strong></div>
      <div class="bu-meta-item"><span>Main contact</span><strong>${escapeHtml(bu.mainContact || '—')}</strong></div>
      <div class="bu-meta-item"><span>Other contacts</span><strong>${escapeHtml((bu.otherContacts || []).join(', ') || '—')}</strong></div>
      <div class="bu-meta-item"><span>P0 / P1 / P2</span><strong>${escapeHtml(formatMetric(buAssets, 'P0'))} • ${escapeHtml(formatMetric(buAssets, 'P1'))} • ${escapeHtml(formatMetric(buAssets, 'P2'))}</strong></div>
    </div>
    <div>
      <h4>Associated assets</h4>
      <div class="bu-related-list" id="buAssetsList"></div>
    </div>
    <div>
      <h4>Associated pentests</h4>
      <div class="bu-related-list" id="buPentestsList"></div>
    </div>`;

  const assetsList = $('buAssetsList');
  if (!buAssets.length) {
    assetsList.innerHTML = '<div class="bu-related-item"><div><strong>No linked assets</strong></div></div>';
  } else {
    buAssets.forEach((asset) => {
      const row = document.createElement('div');
      row.className = 'bu-related-item';
      row.innerHTML = `<div><strong>${escapeHtml(asset.name || 'Unnamed asset')}</strong><small>${escapeHtml(getPriorityTier(asset))} • ${escapeHtml(asset.pentestStatus || 'No schedule')}</small></div><button class="small-btn" type="button">Open</button>`;
      row.querySelector('button').addEventListener('click', () => {
        openTab('assetsTab');
        openAssetShow(asset);
      });
      assetsList.appendChild(row);
    });
  }

  const pentestsList = $('buPentestsList');
  if (!buProjects.length) {
    pentestsList.innerHTML = '<div class="bu-related-item"><div><strong>No linked pentest projects</strong></div></div>';
  } else {
    buProjects.forEach((project) => {
      const row = document.createElement('div');
      row.className = 'bu-related-item';
      row.innerHTML = `<div><strong>${escapeHtml(project.name)}</strong><small>${escapeHtml(project.phase || 'Planning')}</small></div><button class="small-btn" type="button">Open</button>`;
      row.querySelector('button').addEventListener('click', async () => {
        openTab('pentestsTab');
        const ok = await acquireLock('project', project.id);
        if (!ok) return;
        state.selectedProjectId = project.id;
        state.projectEditMode = false;
        renderPentests();
      });
      pentestsList.appendChild(row);
    });
  }
}

function renderBuSubfolder() {
  if (!buSubfolder) return;
  if (!state.businessUnits.length) {
    buSubfolder.innerHTML = '';
    buSubfolder.classList.add('hidden');
    return;
  }

  buSubfolder.innerHTML = state.businessUnits.map((bu) => `<button type="button" class="menu-sub-item" data-bu-id="${bu.id}">${escapeHtml(bu.buId || bu.name || 'BU')}</button>`).join('');
  buSubfolder.classList.remove('hidden');
  buSubfolder.querySelectorAll('[data-bu-id]').forEach((el) => {
    el.addEventListener('click', () => openBusinessUnit(el.dataset.buId));
  });
}


function getSelectedProject() {
  return state.pentestProjects.find((p) => p.id === state.selectedProjectId) || null;
}

function renderProjectKpis() {
  const projects = state.pentestProjects;
  $('kpiProjects').textContent = String(projects.length);
  $('kpiProjectsInProgress').textContent = String(projects.filter((p) => ['Testing', 'Reporting', 'Retest'].includes(p.phase)).length);
  $('kpiFindingsOpen').textContent = String(projects.flatMap((p) => p.findings).filter((f) => f.status !== 'Closed').length);
  $('kpiReportsIssued').textContent = String(projects.flatMap((p) => p.reports).filter((r) => r.status === 'Issued').length);
}

function renderProjectsTable() {
  projectsTbody.innerHTML = '';
  state.pentestProjects.forEach((project) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(project.name)}</td>
      <td>${escapeHtml(project.clientName || '—')}</td>
      <td>${escapeHtml(getAssetName(project.assetId))}</td>
      <td>${escapeHtml(project.phase)}</td>
      <td>${escapeHtml(project.testLead || '—')}</td>
      <td>${project.findings.length}</td>
      <td>${project.reports.length}</td>
      <td><button class="small-btn" data-open="1">Open</button> <button class="small-btn" data-del="1">Remove</button></td>`;

    tr.querySelector('[data-open]').addEventListener('click', async () => {
      const ok = await acquireLock('project', project.id);
      if (!ok) return;
      state.selectedProjectId = project.id;
      state.projectEditMode = false;
    tr.querySelector('[data-open]').addEventListener('click', () => {
      state.selectedProjectId = project.id;
      renderProjectWorkbench();
      setStatus(`Loaded project: ${project.name}`);
    });
    tr.querySelector('[data-del]').addEventListener('click', () => {
      releaseLock('project', project.id);
      state.pentestProjects = state.pentestProjects.filter((p) => p.id !== project.id);
      if (state.selectedProjectId === project.id) state.selectedProjectId = '';
      renderPentests();
      queuePersist('Project removed and saved.');
    });
    projectsTbody.appendChild(tr);
  });
}


function setProjectFormEditable(editable) {
  const form = $('projectForm');
  if (!form) return;
  form.querySelectorAll('input, select, textarea, button[type="submit"]').forEach((el) => {
    if (el.name === 'id') return;
    el.disabled = !editable;
  });
  if (projectEditBtn) projectEditBtn.textContent = editable ? 'Editing enabled' : 'Edit project';
}

function renderProjectWorkbench() {
  const project = getSelectedProject();
  const form = $('projectForm');

  $('projectWorkbenchTitle').textContent = project ? `Project workbench: ${project.name}` : 'Project workbench';
  $('projectWorkbench').classList.toggle('hidden', !project);
  if (!project) {
    form.reset();
    form.id.value = '';
    findingsTbody.innerHTML = '<tr><td colspan="7">Select a project to manage findings.</td></tr>';
    reportsTbody.innerHTML = '<tr><td colspan="6">Select a project to manage reports.</td></tr>';
    state.projectEditMode = false;
    setProjectFormEditable(false);
    closeFindingWorkbench();
    closeReportEditor();
    return;
  }

  form.id.value = project.id;
  form.name.value = project.name;
  form.clientName.value = project.clientName;
  form.assetId.value = project.assetId;
  form.buId.value = project.buId;
  form.phase.value = project.phase;
  form.testLead.value = project.testLead;
  form.clientContact.value = project.clientContact;
  form.startDate.value = project.startDate;
  form.endDate.value = project.endDate;
  form.methodology.value = project.methodology;
  form.retestRequired.checked = !!project.retestRequired;
  form.scope.value = project.scope;
  form.attackSurface.value = project.attackSurface;
  form.executiveSummary.value = project.executiveSummary;
  setProjectFormEditable(state.projectEditMode);

  findingsTbody.innerHTML = '';
  if (!project.findings.length) {
    findingsTbody.innerHTML = '<tr><td colspan="7">No findings logged yet.</td></tr>';
  } else {
    project.findings.forEach((f, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(f.title)}</td><td>${escapeHtml(f.cvssScore || '—')}</td><td>${escapeHtml(f.severity || '—')}</td><td>${escapeHtml(f.cwe || '—')}</td><td>${escapeHtml(f.owasp || '—')}</td><td>${escapeHtml(f.dateFound || '—')}</td><td><button class="small-btn" data-del="1">Remove</button></td>`;
      const issueType = [f.cwe, f.owasp].filter(Boolean).join(' / ') || '—';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(f.title)}</td><td>${escapeHtml(f.severity)}</td><td>${escapeHtml(f.status)}</td><td>${escapeHtml(f.cvss || '—')}</td><td>${escapeHtml(f.ttp || '—')}</td><td>${escapeHtml(issueType)}</td><td><button class="small-btn" data-del="1">Remove</button></td>`;
      tr.querySelector('[data-del]').addEventListener('click', () => {
        project.findings.splice(idx, 1);
        renderPentests();
        queuePersist('Finding removed and saved.');
      });
      findingsTbody.appendChild(tr);
    });
  }

  reportsTbody.innerHTML = '';
  if (!project.reports.length) {
    reportsTbody.innerHTML = '<tr><td colspan="6">No reports logged yet.</td></tr>';
  } else {
    project.reports.forEach((r, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.type)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.version || '—')}</td><td>${escapeHtml(r.deliveredAt || '—')}</td><td>${escapeHtml(r.attachmentName || '—')}</td><td><button class="small-btn" data-del="1">Remove</button></td>`;
      tr.innerHTML = `<td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.type)}</td><td>${escapeHtml(r.status)}</td><td>${escapeHtml(r.version || '—')}</td><td>${escapeHtml(r.reference || '—')}</td><td><button class="small-btn" data-del="1">Remove</button></td>`;
      tr.querySelector('[data-del]').addEventListener('click', () => {
        project.reports.splice(idx, 1);
        renderPentests();
        queuePersist('Report removed and saved.');
      });
      reportsTbody.appendChild(tr);
    });
  }
}

function renderBuSelectors() {
  $('editorBuSelect').innerHTML = ['<option value="">No BU</option>', ...state.businessUnits.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`)].join('');
  const buAssetSelect = $('buAssetSelect');
  if (buAssetSelect) buAssetSelect.innerHTML = state.assets.map((a) => `<option value="${a.id}">${escapeHtml(a.name || '(unnamed)')}</option>`).join('');
  $('buAssetSelect').innerHTML = state.assets.map((a) => `<option value="${a.id}">${escapeHtml(a.name || '(unnamed)')}</option>`).join('');
  $('assetsBuFilter').innerHTML = state.businessUnits.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  Array.from($('assetsBuFilter').options).forEach((o) => { o.selected = state.assetsFilterBuIds.includes(o.value); });
  $('assetsSearch').value = state.assetsSearch;

  $('projectAssetSelect').innerHTML = ['<option value="">No linked asset</option>', ...state.assets.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`)].join('');
  $('projectBuSelect').innerHTML = ['<option value="">No BU</option>', ...state.businessUnits.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`)].join('');
}


function openTab(tabId) {
  document.querySelectorAll('.menu-item').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  const menuBtn = document.querySelector(`.menu-item[data-tab="${tabId}"]`);
  if (menuBtn) menuBtn.classList.add('active');
  const panel = document.getElementById(tabId);
  if (panel) panel.classList.add('active');
}

function renderProjectSubfolder() {
  if (!projectSubfolder) return;
  const project = getSelectedProject();
  if (!project) {
    projectSubfolder.innerHTML = '';
    projectSubfolder.classList.add('hidden');
    return;
  }

  const label = sanitiseText(project.id || '', 32) || 'project';
  projectSubfolder.innerHTML = `<button type="button" class="menu-sub-item" data-target="project">/${escapeHtml(label)}</button><button type="button" class="menu-sub-item" data-target="finding">/${escapeHtml(label)}/finding</button>`;
  projectSubfolder.classList.remove('hidden');
  projectSubfolder.querySelector('[data-target="project"]').addEventListener('click', () => {
    openTab('pentestsTab');
    findingWorkbench?.classList.add('hidden');
    renderProjectWorkbench();
  });
  projectSubfolder.querySelector('[data-target="finding"]').addEventListener('click', () => {
    openTab('pentestsTab');
    openFindingWorkbench();
  });
}

function openFindingWorkbench() {
  const project = getSelectedProject();
  if (!project) return setStatus('Open a project first.');
  if (findingWorkbench) findingWorkbench.classList.remove('hidden');
}

function closeFindingWorkbench() {
  if (findingWorkbench) findingWorkbench.classList.add('hidden');
}


function openReportEditor() {
  if (!reportFormEl) return;
  reportFormEl.classList.remove('hidden');
}

function closeReportEditor() {
  if (!reportFormEl) return;
  reportFormEl.reset();
  reportFormEl.classList.add('hidden');
}

function renderPentests() {
  renderProjectKpis();
  renderProjectsTable();
  renderProjectWorkbench();
  renderProjectSubfolder();
}

function renderAll() {
  renderBuSelectors();
  renderDashboard();
  renderAssetsOverview();
  renderAssetsTable();
  renderBuOverview();
  renderBuTable();
  syncBuPanels();
  renderBuDetail();
  renderBuSubfolder();
  renderBuTable();
  renderPentests();
}

async function loadBootstrap() {
  const data = await (await fetch('/api/bootstrap')).json();
  state.settings = data.settings || { dataDir: '' };
  state.assets = (data.assets || []).map(createAsset);
  state.businessUnits = (data.businessUnits || []).map(createBusinessUnit);
  state.pentestProjects = (data.pentestProjects || []).map(createProject);
  $('dataDirInput').value = state.settings.dataDir || '';
  renderAll();
}

async function openAssetEditor(asset = null) {
function openAssetEditor(asset = null) {
  const form = $('assetEditorForm');
  form.reset();
  renderBuSelectors();

  if (asset) {
    const ok = await acquireLock('asset', asset.id);
    if (!ok) return;
    $('assetEditorTitle').textContent = 'Edit asset';
    form.id.value = asset.id;
    form.assetId.value = asset.assetId;
    form.name.value = asset.name;
    form.assetType.value = asset.assetType;
    form.buId.value = asset.buId;
    form.businessOwner.value = asset.businessOwner;
    form.techOwner.value = asset.techOwner;
    form.mainContact.value = asset.mainContact;
    form.otherContacts.value = asset.otherContacts;
    form.environment.value = asset.environment;
    form.externalFacing.checked = !!asset.externalFacing;
    form.riskImpactRating.value = asset.riskImpactRating;
    form.cyberTierDefinedYear.value = asset.cyberTierDefinedYear;
    form.cyberTierCurrentYear.value = asset.cyberTierCurrentYear;
    form.cyberTierPreviousYear.value = asset.cyberTierPreviousYear;
    form.pentestDate.value = asset.pentestDate || '';
    form.pentestStatus.value = asset.pentestStatus;
    form.pentestDone.checked = !!asset.pentestDone;
    Object.keys(SCORING_CONFIG.exposure_weights).forEach((k) => { form[k].checked = !!asset.exposureFactors[k]; });
    form.crownJewelAdjacency.checked = !!asset.crownJewelAdjacency;
  } else {
    $('assetEditorTitle').textContent = 'New asset';
  }
  $('assetEditorModal').showModal();
}

function openAssetShow(asset) {
  const rows = [
    ['Asset ID', asset.assetId], ['Asset', asset.name], ['Type', asset.assetType], ['BU', getBuName(asset.buId)],
    ['Business owner', asset.businessOwner], ['Technical owner', asset.techOwner], ['Main contact', asset.mainContact], ['Other contacts', asset.otherContacts],
    ['Environment', asset.environment], ['External facing', asset.externalFacing ? 'Yes' : 'No'], ['Risk impact rating', asset.riskImpactRating],
    ['Defined tier', asset.cyberTierDefinedYear], ['Current year tier', asset.cyberTierCurrentYear], ['Previous year tier', asset.cyberTierPreviousYear],
    ['Current pentest status', asset.pentestStatus], ['Pentest date', asset.pentestDate], ['Pentest complete', asset.pentestDone ? 'Yes' : 'No'],
    ['Current pentest status', asset.pentestStatus], ['Pentest complete', asset.pentestDone ? 'Yes' : 'No'],
    ['Calculated priority tier', asset.calc.pentest_priority_tier], ['Impact score', asset.calc.impact_score], ['Exposure score', asset.calc.exposure_score], ['Adjusted priority score', asset.calc.adjusted_priority_score]
  ];
  $('assetShowContent').innerHTML = rows.map(([k, v]) => `<div class="asset-show-row"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v || '—')}</strong></div>`).join('');
  $('assetShowModal').showModal();
}

function normalizeKey(k) { return String(k || '').trim().toLowerCase(); }
function findValue(row, aliases) {
  const map = new Map(Object.entries(row).map(([k, v]) => [normalizeKey(k), v]));
  for (const alias of aliases) if (map.has(normalizeKey(alias))) return map.get(normalizeKey(alias));
  return '';
}

function getOrCreateBuByName(nameRaw) {
  const name = String(nameRaw || '').trim();
  if (!name) return '';
  const existing = state.businessUnits.find((b) => b.name.trim().toLowerCase() === name.toLowerCase());
  if (existing) return existing.id;
  const bu = createBusinessUnit({ name });
  state.businessUnits.push(bu);
  return bu.id;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const row = {};
    headers.forEach((h, i) => { row[h] = (values[i] || '').trim(); });
    return row;
  });
}

$('addAssetBtn').addEventListener('click', () => openAssetEditor());
$('assetsBuFilter').addEventListener('change', () => {
  state.assetsFilterBuIds = Array.from($('assetsBuFilter').selectedOptions).map((o) => o.value);
  renderAssetsOverview();
  renderAssetsTable();
});
$('assetsSearch').addEventListener('input', () => {
  state.assetsSearch = $('assetsSearch').value;
  renderAssetsOverview();
  renderAssetsTable();
});
$('cancelAssetEditorBtn').addEventListener('click', async () => {
  const id = $('assetEditorForm').id.value;
  if (id) await releaseLock('asset', id);
  $('assetEditorModal').close();
});
$('assetEditorModal').addEventListener('close', async () => {
  const id = $('assetEditorForm').id.value;
  if (id) await releaseLock('asset', id);
});
$('closeAssetShowBtn').addEventListener('click', () => $('assetShowModal').close());

$('assetEditorForm').addEventListener('submit', async (e) => {
$('cancelAssetEditorBtn').addEventListener('click', () => $('assetEditorModal').close());
$('closeAssetShowBtn').addEventListener('click', () => $('assetShowModal').close());

$('assetEditorForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData($('assetEditorForm'));
  const payload = Object.fromEntries(fd.entries());
  payload.externalFacing = fd.get('externalFacing') === 'on';
  payload.pentestDone = fd.get('pentestDone') === 'on';
  payload.crownJewelAdjacency = fd.get('crownJewelAdjacency') === 'on' ? 1 : 0;
  payload.exposureFactors = Object.fromEntries(Object.keys(SCORING_CONFIG.exposure_weights).map((k) => [k, fd.get(k) === 'on' ? 1 : 0]));

  const asset = createAsset(payload);
  if (payload.id) {
    const idx = state.assets.findIndex((a) => a.id === payload.id);
    if (idx >= 0) state.assets[idx] = asset;
    queuePersist('Asset updated and saved.');
  } else {
    state.assets.push(asset);
    queuePersist('Asset created and saved.');
  }
  const previousId = payload.id;
  $('assetEditorModal').close();
  if (previousId) await releaseLock('asset', previousId);
  renderAll();
});

$('openBuModalBtn').addEventListener('click', () => {
  $('buEditorForm').reset();
  renderBuSelectors();
  buEditorModal?.showModal();
});

$('cancelBuEditorBtn').addEventListener('click', () => buEditorModal?.close());

$('buEditorForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData($('buEditorForm'));
  const bu = createBusinessUnit({
    buId: fd.get('buId'),
    name: fd.get('name'),
    mainContact: fd.get('mainContact'),
    otherContacts: fd.get('otherContacts')
  });
  if (!bu.buId || !bu.name) return setStatus('BU ID and BU name are required.');
  if (state.businessUnits.some((x) => x.buId.toLowerCase() === bu.buId.toLowerCase())) return setStatus('BU ID already exists.');
  state.businessUnits.push(bu);
  const buSelect = $('buAssetSelect');
  if (buSelect) {
    Array.from(buSelect.selectedOptions).forEach((opt) => {
      const asset = state.assets.find((a) => a.id === opt.value);
      if (asset) asset.buId = bu.id;
    });
  }
  state.selectedBuId = bu.id;
  buEditorModal?.close();
  $('assetEditorModal').close();
  renderAll();
});

$('buForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData($('buForm'));
  const bu = createBusinessUnit({ name: fd.get('name'), mainContact: fd.get('mainContact') });
  state.businessUnits.push(bu);
  Array.from($('buAssetSelect').selectedOptions).forEach((opt) => {
    const asset = state.assets.find((a) => a.id === opt.value);
    if (asset) asset.buId = bu.id;
  });
  $('buForm').reset();
  renderAll();
  queuePersist('Business Unit created and saved.');
});

$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const dataDir = $('dataDirInput').value.trim();
  if (!dataDir) return setStatus('Set a valid data folder path.');
  const res = await fetch('/api/settings', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataDir })
  });
  if (!res.ok) return setStatus('Unable to update settings.');
  setStatus('Data folder updated. Reloading data from the new location...');
  await loadBootstrap();
});

$('addProjectBtn').addEventListener('click', async () => {
  const project = createProject({ name: `Pentest Project ${state.pentestProjects.length + 1}` });
  state.pentestProjects.push(project);
  await acquireLock('project', project.id);
  state.selectedProjectId = project.id;
  state.projectEditMode = true;
$('addProjectBtn').addEventListener('click', () => {
  const project = createProject({ name: `Pentest Project ${state.pentestProjects.length + 1}` });
  state.pentestProjects.push(project);
  state.selectedProjectId = project.id;
  renderPentests();
  queuePersist('Project created and saved.');
});

$('projectForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.projectEditMode) return setStatus('Click Edit project to enable editing.');
$('projectForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData($('projectForm'));
  const payload = Object.fromEntries(fd.entries());
  const project = state.pentestProjects.find((p) => p.id === payload.id);
  if (!project) return;
  if (!hasOwnedLock('project', project.id)) {
    const ok = await acquireLock('project', project.id);
    if (!ok) return;
  }

  Object.assign(project, {
    name: sanitiseText(payload.name, 140),
    clientName: sanitiseText(payload.clientName, 140),
    assetId: payload.assetId,
    buId: payload.buId,
    phase: payload.phase,
    testLead: sanitiseText(payload.testLead, 120),
    clientContact: sanitiseText(payload.clientContact, 120),
    startDate: sanitiseDate(payload.startDate),
    endDate: sanitiseDate(payload.endDate),
    methodology: sanitiseText(payload.methodology, 120),
    retestRequired: fd.get('retestRequired') === 'on',
    scope: sanitiseText(payload.scope, 1200),
    attackSurface: sanitiseText(payload.attackSurface, 1200),
    executiveSummary: sanitiseText(payload.executiveSummary, 1200)
  });

  state.projectEditMode = false;

  Object.assign(project, {
    name: payload.name,
    clientName: payload.clientName,
    assetId: payload.assetId,
    buId: payload.buId,
    phase: payload.phase,
    testLead: payload.testLead,
    clientContact: payload.clientContact,
    startDate: payload.startDate,
    endDate: payload.endDate,
    methodology: payload.methodology,
    retestRequired: fd.get('retestRequired') === 'on',
    scope: payload.scope,
    attackSurface: payload.attackSurface,
    executiveSummary: payload.executiveSummary
  });

  renderPentests();
  queuePersist('Project updated and saved.');
});

$('findingForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const project = getSelectedProject();
  if (!project) return setStatus('Select or create a project first.');
  if (!hasOwnedLock('project', project.id)) {
    const ok = await acquireLock('project', project.id);
    if (!ok) return;
  }
  const fd = new FormData($('findingForm'));
  const payload = Object.fromEntries(fd.entries());
  const finding = normaliseFinding(payload);
  if (!finding.title.trim()) return setStatus('Finding title is required.');
  project.findings.push(finding);
  $('findingForm').reset();
  closeFindingWorkbench();
$('findingForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const project = getSelectedProject();
  if (!project) return setStatus('Select or create a project first.');
  const fd = new FormData($('findingForm'));
  const finding = normaliseFinding(Object.fromEntries(fd.entries()));
  if (!finding.title.trim()) return setStatus('Finding title is required.');
  project.findings.push(finding);
  $('findingForm').reset();
  renderPentests();
  queuePersist('Finding added and saved.');
});

$('reportForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const project = getSelectedProject();
  if (!project) return setStatus('Select or create a project first.');
  if (!hasOwnedLock('project', project.id)) {
    const ok = await acquireLock('project', project.id);
    if (!ok) return;
  }
  const fd = new FormData($('reportForm'));
  const payload = Object.fromEntries(fd.entries());
  const file = fd.get('reportFile');
  if (file && file.name) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'doc', 'docx'].includes(ext)) return setStatus('Only PDF/DOC/DOCX files are allowed.');
    payload.attachmentName = file.name;
    payload.attachmentType = file.type || ext;
  }
  const report = normaliseReport(payload);
  if (!report.name.trim()) return setStatus('Report name is required.');
  project.reports.push(report);
  closeReportEditor();
$('reportForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const project = getSelectedProject();
  if (!project) return setStatus('Select or create a project first.');
  const fd = new FormData($('reportForm'));
  const report = normaliseReport(Object.fromEntries(fd.entries()));
  if (!report.name.trim()) return setStatus('Report name is required.');
  project.reports.push(report);
  $('reportForm').reset();
  renderPentests();
  queuePersist('Report added and saved.');
});


$('csvInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const rows = parseCsv(await file.text());
  if (!rows.length) { setStatus('CSV has no rows.'); $('csvInput').value = ''; return; }

  const headers = Object.keys(rows[0]).map(normalizeKey);
  const required = { name: ['name', 'asset_name', 'asset'], bu: ['bu', 'business_unit'], rank: ['rank', 'risk_impact_rating'] };
  const missing = Object.entries(required)
    .filter(([, aliases]) => !aliases.some((a) => headers.includes(normalizeKey(a))))
    .map(([k]) => k.toUpperCase());
  if (missing.length) { setStatus(`CSV is invalid. Missing required columns: ${missing.join(', ')}.`); $('csvInput').value = ''; return; }

  let count = 0;
  rows.forEach((row) => {
    const name = String(findValue(row, required.name)).trim();
    const buName = String(findValue(row, required.bu)).trim();
    if (!name || !buName) return;

    state.assets.push(createAsset({
      assetId: findValue(row, ['asset_id']),
      name,
      buId: getOrCreateBuByName(buName),
      assetType: findValue(row, ['asset_type', 'type']) || 'WebApp',
      businessOwner: findValue(row, ['business_owner']),
      techOwner: findValue(row, ['tech_owner']),
      mainContact: findValue(row, ['mainContact', 'main_contact']),
      otherContacts: findValue(row, ['otherContacts', 'other_contacts']),
      environment: findValue(row, ['environment']) || 'Prod',
      externalFacing: ['1', 'true', 'yes'].includes(String(findValue(row, ['external_facing'])).toLowerCase()),
      riskImpactRating: findValue(row, ['risk_impact_rating', 'rank']) || 'Medium',
      crownJewelAdjacency: ['1', 'true', 'yes'].includes(String(findValue(row, ['crown_jewel_adjacency'])).toLowerCase()) ? 1 : 0,
      pentestStatus: findValue(row, ['pentestStatus', 'pentest_status']) || 'No schedule',
      pentestDone: ['1', 'true', 'yes'].includes(String(findValue(row, ['pentestDone', 'pentest_done'])).toLowerCase()),
      cyberTierDefinedYear: findValue(row, ['cyberTierDefinedYear', 'cyber_tier_defined_year']),
      cyberTierCurrentYear: findValue(row, ['cyberTierCurrentYear', 'cyber_tier_current_year']),
      cyberTierPreviousYear: findValue(row, ['cyberTierPreviousYear', 'cyber_tier_previous_year']),
      pentestDate: findValue(row, ['pentestDate', 'pentest_date']),
      exposureFactors: {
        internet_facing: Number(findValue(row, ['internet_facing']) || 0),
        partner_or_public_api: Number(findValue(row, ['partner_or_public_api']) || 0),
        weak_auth_no_mfa_legacy_shared: Number(findValue(row, ['weak_auth_no_mfa_legacy_shared']) || 0),
        recent_major_change_90d: Number(findValue(row, ['recent_major_change_90d']) || 0),
        bad_history_critical_findings_or_incidents_18m: Number(findValue(row, ['bad_history_critical_findings_or_incidents_18m']) || 0),
        many_users_enterprise_wide: Number(findValue(row, ['many_users_enterprise_wide']) || 0)
      }
    }));
    count += 1;
  });

  renderAll();
  queuePersist(`CSV import complete: ${count} assets added and saved.`);
  $('csvInput').value = '';
});



function refreshCvssCalculator() {
  const form = $('findingForm');
  if (!form) return;
  const metrics = {
    av: form.cvss_av.value,
    ac: form.cvss_ac.value,
    pr: form.cvss_pr.value,
    ui: form.cvss_ui.value,
    s: form.cvss_s.value,
    c: form.cvss_c.value,
    i: form.cvss_i.value,
    a: form.cvss_a.value
  };
  const out = calculateCvssFromMetrics(metrics);
  if (cvssScoreInput) cvssScoreInput.value = String(out.score.toFixed(1));
  if (cvssSeverityInput) cvssSeverityInput.value = out.severity;
}

['cvss_av','cvss_ac','cvss_pr','cvss_ui','cvss_s','cvss_c','cvss_i','cvss_a'].forEach((n) => {
  const el = $('findingForm')?.querySelector(`[name="${n}"]`);
  if (el) el.addEventListener('change', refreshCvssCalculator);
});
refreshCvssCalculator();

if (openFindingEditorBtn) {
  openFindingEditorBtn.addEventListener('click', () => {
    openFindingWorkbench();
  });
}
if (closeFindingWorkbenchBtn) {
  closeFindingWorkbenchBtn.addEventListener('click', () => closeFindingWorkbench());
}
if (openReportEditorBtn) {
  openReportEditorBtn.addEventListener('click', () => openReportEditor());
}
if (cancelReportEditorBtn) {
  cancelReportEditorBtn.addEventListener('click', () => closeReportEditor());
}

if (projectEditBtn) {
  projectEditBtn.addEventListener('click', async () => {
    const project = getSelectedProject();
    if (!project) return;
    const ok = hasOwnedLock('project', project.id) || await acquireLock('project', project.id);
    if (!ok) return;
    state.projectEditMode = true;
    setProjectFormEditable(true);
    setStatus('Project editing enabled.');
  });
}

if (closeProjectWorkbenchBtn) {
  closeProjectWorkbenchBtn.addEventListener('click', async () => {
    const pid = state.selectedProjectId;
    if (pid) await releaseLock('project', pid);
    state.selectedProjectId = '';
    state.projectEditMode = false;
    closeFindingWorkbench();
    closeReportEditor();
    renderPentests();
    setStatus('Project workbench closed.');
  });
}

document.querySelectorAll('.menu-item').forEach((btn) => btn.addEventListener('click', () => {
  openTab(btn.dataset.tab);
  if (btn.dataset.tab === 'buTab') {
    state.selectedBuId = '';
    syncBuPanels();
    renderBuDetail();
    renderBuSubfolder();
  }
document.querySelectorAll('.menu-item').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('.menu-item').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(btn.dataset.tab).classList.add('active');
}));

loadBootstrap().catch((err) => {
  console.error(err);
  setStatus('Failed to load initial data.');
});
