/* global PartnerDashboard */
(function () {
  'use strict';

  const PD = window.PartnerDashboard;
  if (!PD || !PD.state) {
    console.error('PartnerDashboard data engine not loaded. Ensure data-engine.js is in the same directory as index.html.');
    return;
  }

  const ui = {
    page: 'empty',
    selectedPartnerKey: null,
    detailSub: 'pipeline',
    includeDirect: false,
    partnerSortKey: 'riskScore'
  };

  const $ = (sel) => document.querySelector(sel);

  function hasData() {
    return (PD.state?.model?.opportunities || []).length > 0;
  }

  function isNonPartner(name) {
    const n = (name || '').toLowerCase();
    return /direct\s*\/?\s*no partner|indirect\s*\/?\s*no partner|^direct$|^indirect$/.test(n);
  }

  function derived() {
    return PD.getDerivedData();
  }

  function filterPartners(list) {
    if (ui.includeDirect) return list;
    return list.filter((p) => !isNonPartner(p.partnerGroup));
  }

  function median(nums) {
    const vals = nums.filter((n) => n !== null && n !== undefined && Number.isFinite(n)).sort((a, b) => a - b);
    if (!vals.length) return null;
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }

  function maturityBand(partner, medians) {
    const highSc = medians.sc !== null && partner.avgHoursPerOppWithHours !== null && partner.avgHoursPerOppWithHours >= medians.sc;
    const highLearn = medians.learn !== null && partner.learningSecondsPerLearner !== null && partner.learningSecondsPerLearner >= medians.learn;
    if (partner.signalClass === 'signal-alert') return { id: 'risk', label: 'At risk' };
    if (highLearn && !highSc) return { id: 'mature', label: 'Mature' };
    if (highLearn && highSc) return { id: 'scaling', label: 'Scaling' };
    if (!highLearn && highSc) return { id: 'risk', label: 'At risk' };
    if (partner.learningSeconds > 0) return { id: 'building', label: 'Building' };
    return { id: 'building', label: 'Building' };
  }

  function computeMedians(partners) {
    return {
      sc: median(partners.map((p) => p.avgHoursPerOppWithHours).filter((v) => v > 0)),
      learn: median(partners.map((p) => p.learningSecondsPerLearner).filter((v) => v > 0))
    };
  }

  function quadrantBuckets(partners, medians) {
    const buckets = {
      mature: { title: 'Mature', className: 'mature', items: [] },
      dependent: { title: 'Invested but dependent', className: '', items: [] },
      radar: { title: 'Under the radar', className: '', items: [] },
      risk: { title: 'At risk', className: 'risk', items: [] }
    };
    for (const p of partners) {
      const band = maturityBand(p, medians);
      const highSc = medians.sc !== null && p.avgHoursPerOppWithHours !== null && p.avgHoursPerOppWithHours >= medians.sc;
      const highLearn = medians.learn !== null && p.learningSecondsPerLearner !== null && p.learningSecondsPerLearner >= medians.learn;
      if (band.id === 'mature') buckets.mature.items.push(p);
      else if (highLearn && highSc) buckets.dependent.items.push(p);
      else if (!highLearn && !highSc) buckets.radar.items.push(p);
      else buckets.risk.items.push(p);
    }
    return buckets;
  }

  function formatDuration(seconds) {
    if (!seconds) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h >= 24) {
      const d = Math.floor(h / 24);
      const rh = h % 24;
      return rh ? `${d}d ${rh}h` : `${d}d`;
    }
    if (h) return m ? `${h}h ${m}m` : `${h}h`;
    return m ? `${m}m` : `${Math.round(seconds)}s`;
  }

  function bandHtml(band) {
    return `<span class="band ${PD.escapeHtml(band.id)}">${PD.escapeHtml(band.label)}</span>`;
  }

  function outcomePill(outcome) {
    const cls = outcome === 'Won' ? 'won' : outcome === 'Lost' ? 'lost' : 'open';
    return `<span class="pill-outcome ${cls}">${PD.escapeHtml(outcome || 'Open')}</span>`;
  }

  function setPage(page) {
    ui.page = page;
    const showData = hasData();
    document.querySelectorAll('.tab').forEach((btn) => {
      const match = btn.dataset.page === page;
      btn.classList.toggle('active', match);
      if (btn.dataset.page === 'detail') btn.disabled = !ui.selectedPartnerKey;
    });
    $('#page-empty').classList.toggle('active', !showData && page !== 'admin');
    ['overview', 'partners', 'detail', 'admin'].forEach((id) => {
      const el = document.getElementById(`page-${id}`);
      if (!el) return;
      const active = showData ? page === id : id === 'admin' && page === 'admin';
      el.classList.toggle('active', active);
    });
  }

  function partnerSortState() {
    return { key: ui.partnerSortKey, dir: ui.partnerSortKey === 'partnerGroup' ? 'asc' : 'desc' };
  }

  function getWatchlistPartners(d) {
    const partners = filterPartners(d.partnerSummary);
    const sorted = PD.sortRows(partners, { key: 'riskScore', dir: 'desc' });
    return sorted.slice(0, 12);
  }

  function directSummary(d) {
    const direct = d.partnerSummary.find((p) => isNonPartner(p.partnerGroup));
    if (!direct) return null;
    return direct;
  }

  function renderStatus() {
    const m = PD.state.model;
    const pill = $('#status-pill');
    if (!hasData()) {
      pill.textContent = 'No data loaded';
      return;
    }
    const stats = m.baseStats || {};
    pill.textContent = `${stats.opportunitiesImported || m.opportunities.length} opps · ${stats.tasksImported || m.tasks.length} tasks · ${stats.learningImported || (m.learningRows || []).length} learning rows`;
  }

  function renderEmpty() {
    renderStatus();
    setPage(ui.page === 'admin' ? 'admin' : 'empty');
  }

  function renderInsight(d, watch) {
    const host = $('#overview-insight');
    const alert = watch.find((p) => p.signalClass === 'signal-alert');
    const good = watch.find((p) => p.signalClass === 'signal-good');
    if (alert) {
      host.className = 'insight alert';
      host.innerHTML = `<strong>Needs attention:</strong> ${PD.escapeHtml(alert.partnerGroup)} — ${PD.formatHours(alert.totalHours)} across ${PD.formatInt(alert.opportunityCount)} opps (${PD.formatHours(alert.avgHoursPerOpp)} avg), ${formatDuration(alert.learningSeconds)} learning. ${PD.escapeHtml(alert.signal)}.`;
      return;
    }
    if (good) {
      host.className = 'insight good';
      host.innerHTML = `<strong>Standout:</strong> ${PD.escapeHtml(good.partnerGroup)} — ${PD.escapeHtml(good.signal)}.`;
      return;
    }
    host.className = 'insight';
    host.innerHTML = '<strong>Snapshot:</strong> Review the watchlist for partners with high SC hours and limited learning activity.';
  }

  function renderKpis(d, partners) {
    const closed = partners.filter((p) => p.closedCount > 0);
    const winRates = closed.map((p) => p.winRate).filter((v) => v !== null);
    const regionWin = winRates.length ? winRates.reduce((a, b) => a + b, 0) / winRates.length : d.kpis.winRate;
    const hrsPerOpp = partners.map((p) => p.avgHoursPerOppWithHours).filter((v) => v !== null && v > 0);
    const medHrs = median(hrsPerOpp);
    const learners = d.kpis.totalLearners || 0;
    const engaged = d.kpis.engagedLearners || 0;
    const pctLearn = learners ? Math.round((engaged / learners) * 100) : 0;

    $('#overview-kpis').innerHTML = `
      <article class="kpi"><p class="label">Active partners</p><p class="value">${PD.formatInt(partners.length)}</p><p class="sub">In current filter</p></article>
      <article class="kpi"><p class="label">Median SC hrs / opp</p><p class="value">${medHrs !== null ? PD.formatHours(medHrs) : '–'}</p><p class="sub">Among opps with SC time</p></article>
      <article class="kpi"><p class="label">Partner win rate</p><p class="value">${regionWin !== null ? PD.formatPercent(regionWin) : '–'}</p><p class="sub">Closed won vs lost (filtered)</p></article>
      <article class="kpi"><p class="label">Pre-sales learning active</p><p class="value">${learners ? `${pctLearn}%` : '–'}</p><p class="sub">${PD.formatInt(engaged)} of ${PD.formatInt(learners)} learners</p></article>
    `;
    $('#overview-note').textContent = `${PD.formatInt(d.kpis.opportunities)} opportunities in scope`;
  }

  function renderWatchlist(partners, medians) {
    const body = $('#watchlist-body');
    if (!partners.length) {
      body.innerHTML = '<tr><td colspan="6" class="muted">No partners match the current filter.</td></tr>';
      return;
    }
    body.innerHTML = partners.map((p) => {
      const band = maturityBand(p, medians);
      return `<tr class="clickable" data-partner-key="${PD.escapeHtml(p.partnerKey)}">
        <td><strong>${PD.escapeHtml(p.partnerGroup)}</strong></td>
        <td>${bandHtml(band)}</td>
        <td>${PD.formatInt(p.opportunityCount)}</td>
        <td>${PD.formatHours(p.totalHours)}</td>
        <td>${formatDuration(p.learningSeconds)}</td>
        <td class="signal">${PD.escapeHtml(p.signal)}</td>
      </tr>`;
    }).join('');
  }

  function renderQuadrants(partners, medians) {
    const buckets = quadrantBuckets(partners, medians);
    const order = ['mature', 'dependent', 'radar', 'risk'];
    const host = $('#quadrants');
    host.innerHTML = order.map((key) => {
      const b = buckets[key];
      const top = b.items.slice(0, 5);
      const more = b.items.length - top.length;
      const lis = top.map((p) => `<li>${PD.escapeHtml(p.partnerGroup)}</li>`).join('');
      const moreLi = more > 0 ? `<li class="more">+${more} more</li>` : '';
      return `<div class="quad ${PD.escapeHtml(b.className)}"><h3>${PD.escapeHtml(b.title)}</h3><ul>${lis}${moreLi}</ul></div>`;
    }).join('');
  }

  function renderFootnote(d) {
    const direct = directSummary(d);
    const foot = $('#direct-footnote');
    if (!direct || ui.includeDirect) {
      foot.classList.add('hidden');
      return;
    }
    foot.classList.remove('hidden');
    foot.textContent = `Genesys-direct pipeline (${direct.partnerGroup}): ${PD.formatInt(direct.opportunityCount)} opps · ${PD.formatHours(direct.totalHours)} SC hours — excluded from partner rankings. Toggle view to include.`;
  }

  function renderScorecard(partners, medians) {
    const sorted = PD.sortRows(partners, partnerSortState());
    const body = $('#scorecard-body');
    body.innerHTML = sorted.map((p) => {
      const band = maturityBand(p, medians);
      return `<tr class="clickable" data-partner-key="${PD.escapeHtml(p.partnerKey)}">
        <td>${PD.escapeHtml(p.partnerGroup)}</td>
        <td>${bandHtml(band)}</td>
        <td>${PD.formatInt(p.opportunityCount)}</td>
        <td>${PD.formatHours(p.totalHours)}</td>
        <td>${p.avgHoursPerOpp !== null ? PD.formatHours(p.avgHoursPerOpp) : '–'}</td>
        <td>${formatDuration(p.learningSeconds)}</td>
        <td>${p.winRate !== null ? PD.formatPercent(p.winRate) : '–'}</td>
        <td class="signal">${PD.escapeHtml(p.signal)}</td>
      </tr>`;
    }).join('');
  }

  function renderDetail() {
    const d = derived();
    const key = ui.selectedPartnerKey;
    const partner = d.partnerSummary.find((p) => p.partnerKey === key);
    if (!partner) {
      setPage('overview');
      return;
    }
    const medians = computeMedians(filterPartners(d.partnerSummary));
    const band = maturityBand(partner, medians);
    const opps = PD.sortRows(
      d.joined.filter((row) => (row.partnerKey || '') === key),
      { key: 'totalHours', dir: 'desc' }
    );
    const learners = PD.sortRows(
      d.learnerSummary.filter((l) => PD.cleanText(l.partnerGroup) === PD.cleanText(partner.partnerGroup)),
      { key: 'learningSeconds', dir: 'desc' }
    );
    const stages = PD.sortRows(
      PD.summarizeStages(opps),
      { key: 'totalHours', dir: 'desc' }
    );
    const totalStageHrs = stages.reduce((s, r) => s + r.totalHours, 0);

    $('#detail-hero').innerHTML = `
      <h2>${PD.escapeHtml(partner.partnerGroup)} ${bandHtml(band)}</h2>
      <p>${PD.formatHours(partner.totalHours)} across ${PD.formatInt(partner.opportunityCount)} opportunities (${partner.avgHoursPerOpp !== null ? PD.formatHours(partner.avgHoursPerOpp) : '–'} per opp). ${formatDuration(partner.learningSeconds)} partner learning recorded. ${partner.winRate !== null ? `Win rate ${PD.formatPercent(partner.winRate)} on closed opps.` : ''} ${PD.escapeHtml(partner.signal)}.</p>
    `;

    const pipelineRows = opps.length
      ? opps.map((o) => `<tr>
          <td>${PD.escapeHtml(o.opportunityName)}</td>
          <td>${PD.escapeHtml(o.stage || '–')}</td>
          <td>${outcomePill(o.outcome)}</td>
          <td>${PD.formatHours(o.totalHours)}</td>
          <td>${PD.escapeHtml(o.opportunityOwner || '–')}</td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="muted">No opportunities for this partner in the current filter.</td></tr>';

    const learnerRows = learners.length
      ? learners.map((l) => `<tr>
          <td>${PD.escapeHtml(l.fullName || l.learnerEmail)}<br><span class="muted">${PD.escapeHtml(l.learnerEmail)}</span></td>
          <td>${formatDuration(l.learningSeconds)}</td>
          <td>${PD.formatInt(l.courseCount)}</td>
          <td>${PD.escapeHtml(l.topCourse || '–')}</td>
        </tr>`).join('')
      : '<tr><td colspan="4" class="muted">No Seismic learning mapped to this partner in the current filter.</td></tr>';

    const stageRows = stages.length
      ? stages.map((s) => `<tr>
          <td>${PD.escapeHtml(s.stage)}</td>
          <td>${PD.formatHours(s.totalHours)}</td>
          <td>${totalStageHrs ? PD.formatPercent(s.totalHours / totalStageHrs) : '–'}</td>
        </tr>`).join('')
      : '<tr><td colspan="3" class="muted">No SC hours on opportunities for this partner.</td></tr>';

    $('#detail-panels').innerHTML = `
      <article class="panel ${ui.detailSub === 'pipeline' ? '' : 'hidden'}" data-sub-panel="pipeline">
        <div class="panel-head"><div><h2>Opportunities</h2><p>${PD.formatInt(opps.length)} in scope</p></div></div>
        <div class="table-scroll"><table><thead><tr><th>Opportunity</th><th>Stage</th><th>Outcome</th><th>SC hrs</th><th>Owner</th></tr></thead><tbody>${pipelineRows}</tbody></table></div>
      </article>
      <article class="panel ${ui.detailSub === 'learning' ? '' : 'hidden'}" data-sub-panel="learning">
        <div class="panel-head"><div><h2>Learners</h2><p>Seismic time at this partner</p></div></div>
        <div class="table-scroll"><table><thead><tr><th>Learner</th><th>Learning time</th><th>Courses</th><th>Top course</th></tr></thead><tbody>${learnerRows}</tbody></table></div>
      </article>
      <article class="panel ${ui.detailSub === 'sc' ? '' : 'hidden'}" data-sub-panel="sc">
        <div class="panel-head"><div><h2>SC hours by stage</h2><p>Where Genesys time lands on this partner's opps</p></div></div>
        <div class="table-scroll"><table><thead><tr><th>Stage</th><th>SC hours</th><th>Share</th></tr></thead><tbody>${stageRows}</tbody></table></div>
      </article>
    `;
  }

  function renderAdmin() {
    const m = PD.state.model;
    const d = hasData() ? derived() : null;
    const matchRate = d && d.taskHoursTotal ? (d.taskHoursMatched / d.taskHoursTotal) : null;

    $('#quality-body').innerHTML = hasData() ? `
      <tr><td>Files loaded</td><td><strong>${PD.formatInt((m.files || []).length)}</strong></td></tr>
      <tr><td>Opportunities</td><td>${PD.formatInt(m.baseStats.opportunitiesImported || m.opportunities.length)}</td></tr>
      <tr><td>Tasks (deduped)</td><td>${PD.formatInt(m.tasks.length)}</td></tr>
      <tr><td>Learning rows (deduped)</td><td>${PD.formatInt((m.learningRows || []).length)}</td></tr>
      <tr><td>Task–opp match rate</td><td><strong>${matchRate !== null ? PD.formatPercent(matchRate) : '–'}</strong></td></tr>
      <tr><td>Unmatched task names</td><td>${PD.formatInt((m.unmatchedTaskAgg || []).length)}</td></tr>
    ` : '<tr><td colspan="2" class="muted">Load files to see diagnostics.</td></tr>';

    const unmatched = (m.unmatchedTaskAgg || []).slice(0, 12);
    $('#unmatched-body').innerHTML = unmatched.length
      ? unmatched.map((r) => `<tr><td>${PD.escapeHtml(r.opportunityName)}</td><td>${PD.formatHours(r.totalHours)}</td></tr>`).join('')
      : '<tr><td colspan="2" class="muted">None</td></tr>';

    $('#loaded-files').innerHTML = (m.files || []).length
      ? m.files.map((f) => `<li><strong>${PD.escapeHtml(f.fileName)}</strong><br><span class="muted">${PD.formatInt(f.taskRows)} tasks · ${PD.formatInt(f.oppRows + (f.mappedRows || 0))} opps · ${PD.formatInt(f.learningRows || 0)} learning</span></li>`).join('')
      : '<li class="muted">No files loaded yet.</li>';
  }

  function renderAll() {
    renderStatus();
    renderAdmin();

    if (!hasData()) {
      renderEmpty();
      return;
    }

    if (ui.page === 'empty') ui.page = 'overview';

    const d = derived();
    const partners = filterPartners(d.partnerSummary);
    const medians = computeMedians(partners);
    const watch = getWatchlistPartners(d);

    if (ui.page === 'overview') {
      renderKpis(d, partners);
      renderInsight(d, watch);
      renderWatchlist(watch, medians);
      renderQuadrants(partners, medians);
      renderFootnote(d);
    } else if (ui.page === 'partners') {
      renderScorecard(partners, medians);
    } else if (ui.page === 'detail') {
      renderDetail();
    }

    setPage(ui.page);
    document.querySelector('.tab[data-page="detail"]').disabled = !ui.selectedPartnerKey;
  }

  function openPartner(key) {
    ui.selectedPartnerKey = key;
    ui.page = 'detail';
    ui.detailSub = 'pipeline';
    document.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('active', b.dataset.sub === 'pipeline'));
    renderAll();
  }

  function syncViewMode(value) {
    ui.includeDirect = value === 'all';
    $('#view-mode').value = value;
    $('#view-mode-scorecard').value = value;
  }

  async function loadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    $('#loading').classList.add('active');
    try {
      const parsed = [];
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const parsedFile = await PD.parseSpreadsheetBuffer(buffer, file.name);
        if (parsedFile.recognized) parsed.push(parsedFile);
      }
      PD.state.__parsedFiles = (PD.state.__parsedFiles || []).concat(parsed);
      PD.state.model = PD.buildDataModel(PD.state.__parsedFiles);
      if (!parsed.length) {
        window.alert('None of the uploaded files matched expected task, opportunity, or learning layouts.');
      } else {
        ui.page = 'overview';
      }
    } catch (err) {
      console.error(err);
      window.alert(`Could not parse a file: ${err.message}`);
    } finally {
      $('#loading').classList.remove('active');
      renderAll();
    }
  }

  function clearData() {
    PD.state.__parsedFiles = [];
    PD.state.model = {
      files: [],
      tasks: [],
      opportunities: [],
      learningRows: [],
      hasRawTasks: false,
      unmatchedTaskAgg: [],
      unmatchedLearningPartners: [],
      baseStats: {
        filesLoaded: 0,
        tasksImported: 0,
        tasksBeforeDedup: 0,
        duplicateTasksRemoved: 0,
        opportunitiesImported: 0,
        learningImported: 0,
        learningBeforeDedup: 0,
        duplicateLearningRemoved: 0,
        learningLearnersImported: 0
      }
    };
    PD.state.filters.search = '';
    PD.state.filters.selections = Object.fromEntries(
      ['region', 'subRegion', 'partnerName', 'partnerGroup', 'directIndirect', 'opportunityOwner', 'ownerRole', 'stage', 'outcome', 'oppType', 'fiscalPeriod', 'closeYear', 'accountName', 'assigned', 'activityType', 'taskYear', 'learnerEmail', 'learningCourse', 'learningState'].map((k) => [k, new Set()])
    );
    ui.selectedPartnerKey = null;
    ui.page = 'empty';
    $('#global-search').value = '';
    renderAll();
  }

  function exportPartnersCsv() {
    const d = derived();
    const partners = filterPartners(d.partnerSummary);
    const sorted = PD.sortRows(partners, partnerSortState());
    const rows = sorted.map((p) => ({
      Partner: p.partnerGroup,
      Band: maturityBand(p, computeMedians(partners)).label,
      Opportunities: p.opportunityCount,
      SCHours: p.totalHours,
      SCHoursPerOpp: p.avgHoursPerOpp,
      LearningSeconds: p.learningSeconds,
      WinRate: p.winRate,
      Signal: p.signal
    }));
    downloadCsv('partner-scorecard.csv', rows);
  }

  function downloadCsv(filename, rows) {
    if (!rows.length) return;
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(',')].concat(rows.map((row) => headers.map((key) => {
      const value = row[key];
      const text = String(value === null || value === undefined ? '' : value).replace(/"/g, '""');
      return /[",\n]/.test(text) ? `"${text}"` : text;
    }).join(','))).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function bindEvents() {
    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        ui.page = btn.dataset.page;
        renderAll();
      });
    });

    $('#goto-admin').addEventListener('click', () => {
      ui.page = 'admin';
      renderAll();
    });

    $('#detail-back').addEventListener('click', () => {
      ui.page = 'overview';
      renderAll();
    });

    $('#global-search').addEventListener('input', (e) => {
      PD.state.filters.search = e.target.value || '';
      renderAll();
    });

    $('#view-mode').addEventListener('change', (e) => syncViewMode(e.target.value));
    $('#view-mode-scorecard').addEventListener('change', (e) => syncViewMode(e.target.value));

    $('#partner-sort').addEventListener('change', (e) => {
      ui.partnerSortKey = e.target.value;
      renderAll();
    });

    $('#export-partners').addEventListener('click', exportPartnersCsv);
    $('#clear-data').addEventListener('click', () => {
      if (window.confirm('Clear all loaded data from this session?')) clearData();
    });

    const input = $('#file-input');
    const drop = $('#drop-zone');
    drop.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
      loadFiles(e.target.files);
      e.target.value = '';
    });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('drag-active');
    }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('drag-active');
    }));
    drop.addEventListener('drop', (e) => loadFiles(e.dataTransfer.files));

    document.body.addEventListener('click', (e) => {
      const row = e.target.closest('[data-partner-key]');
      if (row) openPartner(row.getAttribute('data-partner-key'));
    });

    document.querySelectorAll('.subtab').forEach((btn) => {
      btn.addEventListener('click', () => {
        ui.detailSub = btn.dataset.sub;
        document.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('active', b === btn));
        renderDetail();
      });
    });
  }

  bindEvents();
  renderAll();
})();
