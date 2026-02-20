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
  assetsSearch: ''
};

const $ = (id) => document.getElementById(id);
const assetsTbody = document.querySelector('#assetsTable tbody');
const buTbody = document.querySelector('#buTable tbody');
const projectsTbody = document.querySelector('#pentestProjectsTable tbody');
const findingsTbody = document.querySelector('#findingsTable tbody');
const reportsTbody = document.querySelector('#reportsTable tbody');
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
    cyberTierDefinedYear: payload.cyberTierDefinedYear || '',
    cyberTierCurrentYear: payload.cyberTierCurrentYear || '',
    cyberTierPreviousYear: payload.cyberTierPreviousYear || '',
    pentestStatus: payload.pentestStatus || 'No schedule',
    pentestDone: Boolean(payload.pentestDone)
  };
  asset.calc = computePriority(asset);
  return asset;
}

function createBusinessUnit(payload = {}) {
  return { id: payload.id || crypto.randomUUID(), name: payload.name || '', mainContact: payload.mainContact || '' };
}

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

function renderBuTable() {
  buTbody.innerHTML = '';
  state.businessUnits.forEach((bu) => {
    const buAssets = state.assets.filter((a) => a.buId === bu.id);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input data-k="name" value="${escapeHtml(bu.name)}" /></td>
      <td><input data-k="mainContact" value="${escapeHtml(bu.mainContact)}" /></td>
      <td>${escapeHtml(buAssets.map((a) => a.name).join(', ') || '—')}</td>
      <td>${buAssets.length}</td>
      <td>${formatMetric(buAssets, 'P0')}</td>
      <td>${formatMetric(buAssets, 'P1')}</td>
      <td>${formatMetric(buAssets, 'P2')}</td>
      <td><button class="small-btn" data-del="1">Remove</button></td>`;

    tr.querySelectorAll('input').forEach((input) => input.addEventListener('change', (e) => { bu[e.target.dataset.k] = e.target.value; queuePersist('Business Unit updated and saved.'); }));
    tr.querySelector('[data-del]').addEventListener('click', () => {
      state.businessUnits = state.businessUnits.filter((x) => x.id !== bu.id);
      state.assets.forEach((a) => { if (a.buId === bu.id) a.buId = ''; });
      state.pentestProjects.forEach((p) => { if (p.buId === bu.id) p.buId = ''; });
      renderAll();
      queuePersist('Business Unit removed and saved.');
    });
    buTbody.appendChild(tr);
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

    tr.querySelector('[data-open]').addEventListener('click', () => {
      state.selectedProjectId = project.id;
      renderProjectWorkbench();
      setStatus(`Loaded project: ${project.name}`);
    });
    tr.querySelector('[data-del]').addEventListener('click', () => {
      state.pentestProjects = state.pentestProjects.filter((p) => p.id !== project.id);
      if (state.selectedProjectId === project.id) state.selectedProjectId = '';
      renderPentests();
      queuePersist('Project removed and saved.');
    });
    projectsTbody.appendChild(tr);
  });
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

  findingsTbody.innerHTML = '';
  if (!project.findings.length) {
    findingsTbody.innerHTML = '<tr><td colspan="7">No findings logged yet.</td></tr>';
  } else {
    project.findings.forEach((f, idx) => {
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
  $('buAssetSelect').innerHTML = state.assets.map((a) => `<option value="${a.id}">${escapeHtml(a.name || '(unnamed)')}</option>`).join('');
  $('assetsBuFilter').innerHTML = state.businessUnits.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
  Array.from($('assetsBuFilter').options).forEach((o) => { o.selected = state.assetsFilterBuIds.includes(o.value); });
  $('assetsSearch').value = state.assetsSearch;

  $('projectAssetSelect').innerHTML = ['<option value="">No linked asset</option>', ...state.assets.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`)].join('');
  $('projectBuSelect').innerHTML = ['<option value="">No BU</option>', ...state.businessUnits.map((b) => `<option value="${b.id}">${escapeHtml(b.name)}</option>`)].join('');
}

function renderPentests() {
  renderProjectKpis();
  renderProjectsTable();
  renderProjectWorkbench();
}

function renderAll() {
  renderBuSelectors();
  renderDashboard();
  renderAssetsOverview();
  renderAssetsTable();
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

function openAssetEditor(asset = null) {
  const form = $('assetEditorForm');
  form.reset();
  renderBuSelectors();

  if (asset) {
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

$('addProjectBtn').addEventListener('click', () => {
  const project = createProject({ name: `Pentest Project ${state.pentestProjects.length + 1}` });
  state.pentestProjects.push(project);
  state.selectedProjectId = project.id;
  renderPentests();
  queuePersist('Project created and saved.');
});

$('projectForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData($('projectForm'));
  const payload = Object.fromEntries(fd.entries());
  const project = state.pentestProjects.find((p) => p.id === payload.id);
  if (!project) return;

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
