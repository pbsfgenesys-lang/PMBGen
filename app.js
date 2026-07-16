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
    partnerSortKey: 'totalHours',
    regionFiltersReady: false,
    renderGen: 0
  };

  let derivedCache = null;

  const DOMAIN_MAP_STORAGE_KEY = 'partner-dashboard-domain-map';
  const $ = (sel) => document.querySelector(sel);

  function hasLearningData() {
    return (PD.state?.model?.learningRows || []).length > 0;
  }

  function loadPersistedDomainMap() {
    if (!PD.setPersistedDomainMap) return;
    try {
      const raw = localStorage.getItem(DOMAIN_MAP_STORAGE_KEY);
      if (raw) PD.setPersistedDomainMap(JSON.parse(raw));
    } catch (err) {
      console.warn('Could not load saved domain map', err);
    }
  }

  function savePersistedDomainMap() {
    if (!PD.getCustomDomainPartnerMap) return;
    try {
      localStorage.setItem(DOMAIN_MAP_STORAGE_KEY, JSON.stringify(PD.getCustomDomainPartnerMap()));
    } catch (err) {
      console.warn('Could not save domain map', err);
    }
  }

  function clearPersistedDomainMap() {
    localStorage.removeItem(DOMAIN_MAP_STORAGE_KEY);
    if (PD.setPersistedDomainMap) PD.setPersistedDomainMap({});
  }

  function hasData() {
    return (PD.state?.model?.opportunities || []).length > 0;
  }

  function isNonPartner(name) {
    const n = (name || '').toLowerCase();
    return /direct\s*\/?\s*no partner|indirect\s*\/?\s*no partner|end customer\s*\/?\s*no partner|^direct$|^indirect$|^no partner named$|\(blank partner\)/.test(n);
  }

  function derivedCacheKey() {
    const s = PD.state.filters;
    const parts = [s.search || '', ui.includeDirect ? '1' : '0'];
    for (const key of ['region', 'subRegion', 'partnerName', 'partnerGroup', 'directIndirect', 'opportunityOwner', 'ownerRole', 'stage', 'outcome', 'oppType', 'fiscalPeriod', 'closeYear', 'accountName', 'assigned', 'activityType', 'taskYear']) {
      parts.push([...(s.selections[key] || new Set())].sort().join('|'));
    }
    return parts.join('::');
  }

  function invalidateDerived() {
    derivedCache = null;
    if (PD.invalidateDerivedCache) PD.invalidateDerivedCache();
  }

  function derived() {
    const key = derivedCacheKey();
    if (derivedCache && derivedCache.key === key) return derivedCache.data;
    const data = PD.getDerivedData();
    derivedCache = { key, data };
    return data;
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


  function computeMedians(partners) {
    return {
      opps: median(partners.map((p) => p.opportunityCount)),
      hours: median(partners.map((p) => p.totalHours).filter((v) => v > 0)),
      win: median(partners.map((p) => p.winRate).filter((v) => v !== null))
    };
  }

  function effectivenessBand(partner, medians) {
    const highVol = medians.opps !== null && partner.opportunityCount >= medians.opps;
    const highHrs = medians.hours !== null && partner.totalHours >= medians.hours;
    const win = partner.winRate;
    if (partner.signalClass === 'signal-alert') return { id: 'investigate', label: 'Review' };
    if (highVol && win !== null && win >= 0.3) return { id: 'strategic', label: 'Strategic' };
    if (highVol && (win === null || win < 0.22)) return { id: 'volume', label: 'High volume' };
    if (highHrs && win !== null && win < 0.2) return { id: 'investigate', label: 'Heavy SC' };
    if (win !== null && win >= 0.35 && partner.closedCount >= 5) return { id: 'efficient', label: 'Efficient' };
    return { id: 'monitor', label: 'Monitor' };
  }

  function quadrantBuckets(partners, medians) {
    const buckets = {
      stars: { title: 'Strategic — high volume & wins', className: 'mature', items: [] },
      volume: { title: 'High volume, weak conversion', className: 'risk', items: [] },
      efficient: { title: 'Efficient — strong win rate', className: 'mature', items: [] },
      light: { title: 'Light touch', className: '', items: [] }
    };
    for (const p of partners) {
      const highVol = medians.opps !== null && p.opportunityCount >= medians.opps;
      const highWin = medians.win !== null && p.winRate !== null && p.winRate >= medians.win;
      if (highVol && highWin) buckets.stars.items.push(p);
      else if (highVol && !highWin) buckets.volume.items.push(p);
      else if (!highVol && highWin) buckets.efficient.items.push(p);
      else buckets.light.items.push(p);
    }
    return buckets;
  }

  function bandHtml(band) {
    return `<span class="band ${PD.escapeHtml(band.id)}">${PD.escapeHtml(band.label)}</span>`;
  }

  function formatEfficiencyHours(value) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '–';
    const n = Number(value);
    return `${n.toLocaleString('en-GB', { minimumFractionDigits: Math.abs(n) >= 100 ? 0 : 1, maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 1 })}h`;
  }

  function outcomePill(outcome) {
    const cls = outcome === 'Won' ? 'won' : outcome === 'Lost' ? 'lost' : 'open';
    return `<span class="pill-outcome ${cls}">${PD.escapeHtml(outcome || 'Open')}</span>`;
  }

  function emptyChart(message) {
    return `<div class="chart-empty">${PD.escapeHtml(message)}</div>`;
  }

  function barSvg(items, aria) {
    if (!items.length) return emptyChart('Nothing to plot for this filter set.');
    const max = Math.max(...items.map((x) => x.value), 1);
    const rowH = 54;
    const width = 980;
    const barX = 370;
    const barW = 520;
    const height = items.length * rowH + 10;
    const rows = items.map((item, i) => {
      const y = i * rowH + 8;
      const w = Math.max(10, (item.value / max) * barW);
      return `<g class="chart-row" transform="translate(0 ${y})"><text x="12" y="16" class="chart-label">${PD.escapeHtml(item.label)}</text><text x="12" y="38" class="chart-meta">${PD.escapeHtml(item.meta || '')}</text><rect x="${barX}" y="2" width="${barW}" height="14" rx="7" class="chart-track"></rect><rect x="${barX}" y="2" width="${w}" height="14" rx="7" class="chart-fill"></rect><text x="${barX + barW}" y="14" text-anchor="end" class="chart-value">${PD.escapeHtml(item.valueLabel)}</text></g>`;
    }).join('');
    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${PD.escapeHtml(aria)}">${rows}</svg>`;
  }

  function winRateColor(rate) {
    if (rate === null || rate === undefined) return '#94a3b8';
    if (rate >= 0.35) return '#0d7a55';
    if (rate >= 0.22) return '#2563eb';
    if (rate >= 0.15) return '#b45309';
    return '#b42318';
  }

  function pearsonCorrelation(xs, ys) {
    const n = xs.length;
    if (n < 3) return null;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < n; i += 1) {
      const a = xs[i] - mx;
      const b = ys[i] - my;
      num += a * b;
      dx += a * a;
      dy += b * b;
    }
    if (!dx || !dy) return null;
    return num / Math.sqrt(dx * dy);
  }

  function medianValue(nums) {
    const vals = nums.filter((n) => n !== null && n !== undefined && Number.isFinite(n)).sort((a, b) => a - b);
    if (!vals.length) return null;
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }

  function avgWinRate(list) {
    const vals = list.map((p) => p.winRate).filter((v) => v !== null);
    if (!vals.length) return null;
    return vals.reduce((s, v) => s + v, 0) / vals.length;
  }

  function learningConversionCohort(partners) {
    return partners.filter((p) => p.closedCount >= 5 && p.winRate !== null && p.learningSeconds > 0 && p.learnerCount > 0);
  }

  function learningConversionAnalysis(partners) {
    const cohort = learningConversionCohort(partners);
    const closed = partners.filter((p) => p.closedCount >= 5 && p.winRate !== null && !isNonPartner(p.partnerGroup));
    const without = closed.filter((p) => !p.learningSeconds);
    const x = cohort.map((p) => p.learningHoursPerLearner || (p.learningSeconds / 3600 / p.learnerCount));
    const y = cohort.map((p) => p.winRate);
    const totalLearning = (PD.state.model.learningRows || []).reduce((s, r) => s + (r.learningSeconds || 0), 0);
    const unmappedLearning = (PD.state.model.learningRows || [])
      .filter((r) => r.partnerGroup === 'Unmapped learning partner')
      .reduce((s, r) => s + (r.learningSeconds || 0), 0);
    return {
      cohort,
      cohortSize: cohort.length,
      withLearningWin: avgWinRate(cohort),
      withoutLearningWin: avgWinRate(without),
      withoutCount: without.length,
      correlation: pearsonCorrelation(x, y),
      unmappedShare: totalLearning ? unmappedLearning / totalLearning : null
    };
  }

  function learningConversionInsightText(analysis) {
    if (!analysis.cohortSize) {
      return 'Need partners with mapped learning, at least 5 closed deals, and learners in scope. Improve domain mapping in Admin, then reload.';
    }
    const r = analysis.correlation;
    const rText = r === null ? 'too few partners to compute' : (r >= 0 ? '+' : '') + r.toFixed(2);
    let strength = 'no meaningful linear relationship';
    if (r !== null) {
      const abs = Math.abs(r);
      if (abs >= 0.4) strength = r > 0 ? 'moderate positive association' : 'moderate negative association';
      else if (abs >= 0.2) strength = r > 0 ? 'weak positive association' : 'weak negative association';
    }
    const withPct = analysis.withLearningWin !== null ? PD.formatPercent(analysis.withLearningWin) : '–';
    const withoutPct = analysis.withoutLearningWin !== null ? PD.formatPercent(analysis.withoutLearningWin) : '–';
    const mapNote = analysis.unmappedShare !== null && analysis.unmappedShare > 0.15
      ? ` ${PD.formatPercent(analysis.unmappedShare)} of learning hours are still unmapped — improve domain mapping before drawing firm conclusions.`
      : '';
    return `<strong>${PD.formatInt(analysis.cohortSize)} partners</strong> with mapped learning and ≥5 closed deals. `
      + `Average win rate: ${withPct} (with learning) vs ${withoutPct} (${PD.formatInt(analysis.withoutCount)} partners without mapped learning). `
      + `Correlation (learning hrs/learner vs win rate): r = ${rText} — ${strength}.${mapNote} `
      + `This shows association, not causation — partners who need more SC help may also log more learning.`;
  }

  function learningConversionScatterSvg(rows) {
    if (!rows.length) return emptyChart('Need partners with mapped learning and at least 5 closed deals.');
    const width = 980;
    const height = 380;
    const pad = { left: 70, right: 40, top: 30, bottom: 60 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const maxX = Math.max(...rows.map((p) => p.learningHoursPerLearner || 0), 0.5);
    const maxClosed = Math.max(...rows.map((p) => p.closedCount), 1);
    const x = (v) => pad.left + (v / maxX) * plotW;
    const y = (v) => pad.top + plotH - v * plotH;
    const r = (v) => 6 + (v / maxClosed) * 18;
    const gridX = [0, 0.25, 0.5, 0.75, 1].map((p) => `<g><line x1="${x(maxX * p)}" y1="${pad.top}" x2="${x(maxX * p)}" y2="${pad.top + plotH}" class="scatter-grid"></line><text x="${x(maxX * p)}" y="${height - 24}" text-anchor="middle" class="chart-meta">${(maxX * p).toFixed(1)}h</text></g>`).join('');
    const gridY = [0, 0.25, 0.5, 0.75, 1].map((p) => `<g><line x1="${pad.left}" y1="${y(p)}" x2="${pad.left + plotW}" y2="${y(p)}" class="scatter-grid"></line><text x="${pad.left - 10}" y="${y(p) + 4}" text-anchor="end" class="chart-meta">${Math.round(p * 100)}%</text></g>`).join('');
    const medX = medianValue(rows.map((p) => p.learningHoursPerLearner || 0));
    const medY = medianValue(rows.map((p) => p.winRate));
    const midLines = (medX !== null && medY !== null)
      ? `<line x1="${x(medX)}" y1="${pad.top}" x2="${x(medX)}" y2="${pad.top + plotH}" class="scatter-mid"></line><line x1="${pad.left}" y1="${y(medY)}" x2="${pad.left + plotW}" y2="${y(medY)}" class="scatter-mid"></line>`
      : '';
    const top = PD.sortRows(rows, { key: 'learningSeconds', dir: 'desc' }).slice(0, 8);
    const points = rows.map((p) => {
      const hrs = p.learningHoursPerLearner || 0;
      return `<circle cx="${x(hrs)}" cy="${y(p.winRate)}" r="${r(p.closedCount)}" fill="${winRateColor(p.winRate)}" fill-opacity="0.72" stroke="#fff" stroke-width="1.5"></circle>`;
    }).join('');
    const labels = top.map((p) => `<text x="${x(p.learningHoursPerLearner || 0) + 8}" y="${y(p.winRate) - 6}" class="chart-meta">${PD.escapeHtml(p.partnerGroup.length > 22 ? `${p.partnerGroup.slice(0, 20)}…` : p.partnerGroup)}</text>`).join('');
    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Learning hours per learner versus win rate">${gridX}${gridY}${midLines}<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" class="scatter-axis"></line><line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" class="scatter-axis"></line>${points}${labels}<text x="${pad.left + plotW / 2}" y="${height - 6}" text-anchor="middle" class="axis-label">Learning hours per learner</text><text x="18" y="${pad.top + plotH / 2}" text-anchor="middle" class="axis-label" transform="rotate(-90 18 ${pad.top + plotH / 2})">Closed win rate</text></svg>`;
  }

  function renderStatus() {
    const m = PD.state.model;
    const pill = $('#status-pill');
    if (!hasData()) {
      pill.textContent = 'No data loaded';
      return;
    }
    const stats = m.baseStats || {};
    const cov = m.dataCoverage;
    const taskSpan = cov?.tasks?.label && cov.tasks.label !== '–' ? ` · tasks ${cov.tasks.label}` : '';
    pill.textContent = `${stats.opportunitiesImported || m.opportunities.length} opps · ${stats.tasksImported || m.tasks.length} tasks${taskSpan}`;
  }

  function renderDataCoverage() {
    const cov = PD.getDataCoverage ? PD.getDataCoverage() : null;
    const banner = $('#data-coverage-banner');
    const summary = $('#coverage-summary');
    const filesBody = $('#coverage-files-body');
    const warningsHost = $('#coverage-warnings');
    if (!cov || !banner) {
      if (banner) banner.classList.add('hidden');
      return;
    }

    const warnCount = (cov.warnings || []).filter((w) => w.level === 'warn').length;
    banner.classList.remove('hidden');
    banner.classList.toggle('warn', warnCount > 0);
    banner.innerHTML = `
      <strong>Data periods in this session</strong>
      <dl class="coverage-grid">
        <div><dt>SC task hours</dt><dd>${PD.escapeHtml(cov.tasks.label)}</dd></div>
        <div><dt>Opportunity close dates</dt><dd>${PD.escapeHtml(cov.opportunities.closeLabel)}</dd></div>
        <div><dt>Opportunity created</dt><dd>${PD.escapeHtml(cov.opportunities.createdLabel)}</dd></div>
        <div><dt>Learning years</dt><dd>${PD.escapeHtml(cov.learning.label)}</dd></div>
        <div><dt>Task–opp match</dt><dd>${cov.taskJoinMatchRate !== null ? PD.formatPercent(cov.taskJoinMatchRate) : '–'}</dd></div>
      </dl>
    `;

    if (summary) {
      summary.innerHTML = `<strong>${PD.formatInt(cov.opportunities.count)}</strong> opportunities (${PD.formatInt(cov.opportunities.openCount)} open · ${PD.formatInt(cov.opportunities.closedCount)} closed) · `
        + `<strong>${PD.formatInt(cov.tasks.count)}</strong> tasks · `
        + (cov.learning.count ? `<strong>${PD.formatInt(cov.learning.count)}</strong> learning rows` : 'no learning file');
    }

    if (filesBody) {
      filesBody.innerHTML = (cov.fileSummaries || []).length
        ? cov.fileSummaries.map((file) => {
          let range = '–';
          if (file.kind === 'Tasks') range = coverageRangeLabel(file.taskRange);
          else if (file.kind === 'Opportunities') range = `Close ${coverageRangeLabel(file.closeRange)} · Created ${coverageRangeLabel(file.createdRange)}`;
          else if (file.kind === 'Learning') range = `Years ${Object.keys(file.learningYears).sort().join(', ') || '–'}`;
          const rows = file.taskRows || file.oppRows || file.learningRows;
          return `<tr><td>${PD.escapeHtml(file.fileName)}</td><td>${PD.escapeHtml(file.kind)}</td><td>${PD.formatInt(rows)}</td><td>${PD.escapeHtml(range)}</td></tr>`;
        }).join('')
        : '<tr><td colspan="4" class="muted">Load exports to see per-file coverage.</td></tr>';
    }

    if (warningsHost) {
      warningsHost.innerHTML = (cov.warnings || []).length
        ? cov.warnings.map((w) => `<li class="${w.level === 'warn' ? 'warn' : ''}">${PD.escapeHtml(w.text)}</li>`).join('')
        : '<li>Task, opportunity, and learning periods look aligned — still confirm Salesforce report filters match.</li>';
    }
  }

  function coverageRangeLabel(range) {
    if (!range?.min || !range?.max) return '–';
    if (range.min.getTime() === range.max.getTime()) return PD.formatShortDate(range.min);
    return `${PD.formatShortDate(range.min)} – ${PD.formatShortDate(range.max)}`;
  }

  function partnerQuarterKey(date) {
    const safe = date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    if (!safe) return null;
    const year = safe.getFullYear();
    if (year < 2000 || year > 2035) return null;
    return `${year}-Q${Math.floor(safe.getMonth() / 3) + 1}`;
  }

  function buildPartnerTrend(partnerKey, opps, tasks, aliases) {
    const oppKeys = new Set(opps.map((o) => o.opportunityKey));
    const buckets = new Map();
    const ensure = (key) => {
      if (!buckets.has(key)) buckets.set(key, { key, scHours: 0, closed: 0, won: 0, lost: 0 });
      return buckets.get(key);
    };
    for (const task of tasks) {
      const mappedKey = aliases[task.opportunityKey] || task.opportunityKey;
      if (!oppKeys.has(mappedKey)) continue;
      const quarter = partnerQuarterKey(task.taskDate);
      if (!quarter) continue;
      ensure(quarter).scHours += task.hours || 0;
    }
    for (const opp of opps) {
      if (opp.outcome !== 'Won' && opp.outcome !== 'Lost') continue;
      const quarter = partnerQuarterKey(opp.closeDate);
      if (!quarter) continue;
      const bucket = ensure(quarter);
      bucket.closed += 1;
      if (opp.outcome === 'Won') bucket.won += 1;
      if (opp.outcome === 'Lost') bucket.lost += 1;
    }
    return [...buckets.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((row) => ({ ...row, winRate: row.closed ? row.won / row.closed : null }));
  }

  function partnerTrendInsight(rows) {
    if (!rows.length) return 'Need dated tasks or closed opportunities for this partner in the current filter.';
    const withClosed = rows.filter((r) => r.closed >= 2);
    const scSeries = rows.filter((r) => r.scHours > 0);
    if (scSeries.length >= 4) {
      const mid = Math.floor(scSeries.length / 2);
      const early = scSeries.slice(0, mid).reduce((s, r) => s + r.scHours, 0) / Math.max(1, mid);
      const late = scSeries.slice(mid).reduce((s, r) => s + r.scHours, 0) / Math.max(1, scSeries.length - mid);
      const scTrend = late > early * 1.15 ? 'increasing' : late < early * 0.85 ? 'decreasing' : 'steady';
      let winTrend = '';
      if (withClosed.length >= 2) {
        const midC = Math.floor(withClosed.length / 2);
        const earlyWr = withClosed.slice(0, midC).reduce((s, r) => s + (r.winRate || 0), 0) / Math.max(1, midC);
        const lateWr = withClosed.slice(midC).reduce((s, r) => s + (r.winRate || 0), 0) / Math.max(1, withClosed.length - midC);
        winTrend = lateWr > earlyWr + 0.05 ? ' Win rate trended up in later quarters.' : lateWr < earlyWr - 0.05 ? ' Win rate trended down in later quarters.' : ' Win rate was relatively stable across quarters with closes.';
      }
      return `SC hours per active quarter are ${scTrend} (early avg ${PD.formatHours(early)} → recent avg ${PD.formatHours(late)}).${winTrend} Compare bars (effort) with the win-rate line (outcomes) — rising SC with falling win rate may signal reliance; falling SC with stable wins may signal maturity.`;
    }
    return 'Limited quarters with data — widen filters or load a longer task export for clearer trends.';
  }

  function partnerTrendSvg(rows) {
    const series = rows.filter((r) => r.scHours > 0 || r.closed > 0);
    if (!series.length) return emptyChart('No quarterly SC hours or closed deals for this partner in the current filter.');
    const width = 980;
    const height = 360;
    const pad = { left: 64, right: 56, top: 28, bottom: 72 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const maxHours = Math.max(...series.map((r) => r.scHours), 1);
    const barW = Math.min(42, plotW / Math.max(series.length, 1) - 8);
    const step = plotW / series.length;
    const bars = series.map((row, i) => {
      const x = pad.left + i * step + (step - barW) / 2;
      const h = (row.scHours / maxHours) * plotH;
      const y = pad.top + plotH - h;
      return `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(1, h)}" rx="4" fill="#2563eb" fill-opacity="0.82"></rect>`;
    }).join('');
    const winPoints = series
      .map((row, i) => (row.winRate !== null ? { x: pad.left + i * step + step / 2, y: pad.top + plotH - row.winRate * plotH, rate: row.winRate } : null))
      .filter(Boolean);
    const winPath = winPoints.length
      ? `<polyline points="${winPoints.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#0d7a55" stroke-width="2.5"></polyline>`
        + winPoints.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4.5" fill="#0d7a55"></circle>`).join('')
      : '';
    const xLabels = series.map((row, i) => {
      const x = pad.left + i * step + step / 2;
      return `<text x="${x}" y="${height - 44}" text-anchor="middle" class="chart-meta">${PD.escapeHtml(row.key)}</text>`;
    }).join('');
    const yHours = [0, 0.5, 1].map((p) => {
      const y = pad.top + plotH - p * plotH;
      return `<g><line x1="${pad.left}" y1="${y}" x2="${pad.left + plotW}" y2="${y}" class="scatter-grid"></line><text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" class="chart-meta">${PD.escapeHtml(PD.formatHours(maxHours * p))}</text></g>`;
    }).join('');
    const yWin = [0, 0.5, 1].map((p) => `<text x="${width - pad.right + 8}" y="${pad.top + plotH - p * plotH + 4}" class="chart-meta">${Math.round(p * 100)}%</text>`).join('');
    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Partner SC hours and win rate by quarter">${yHours}${yWin}${bars}${winPath}${xLabels}<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" class="scatter-axis"></line><text x="${pad.left + plotW / 2}" y="${height - 8}" text-anchor="middle" class="axis-label">Calendar quarter</text><text x="18" y="${pad.top + plotH / 2}" text-anchor="middle" class="axis-label" transform="rotate(-90 18 ${pad.top + plotH / 2})">SC hours</text><text x="${width - 18}" y="${pad.top + plotH / 2}" text-anchor="middle" class="axis-label" transform="rotate(90 ${width - 18} ${pad.top + plotH / 2})">Win rate</text></svg>`;
  }

  function scTrackingFootnote() {
    const cov = PD.getDataCoverage ? PD.getDataCoverage() : null;
    const start = cov?.tasks?.range?.min;
    if (!start) return 'SC task dates are required for trend and heatmap views.';
    const end = cov?.tasks?.range?.max;
    const span = end ? ` (${coverageRangeLabel(cov.tasks.range)})` : '';
    return `SC task logging in this export starts ${PD.formatShortDate(start)}${span}. Older closed deals may show wins without logged SC hours — that is missing data, not zero support. Campaign and initiative time is excluded from opp-aligned quarters.`;
  }

  function quarterLabelShort(key) {
    const m = /^(\d{4})-Q(\d)$/.exec(key || '');
    if (!m) return key || '–';
    return `Q${m[2]} '${m[1].slice(2)}`;
  }

  function globalTaskQuarters() {
    const cov = PD.getDataCoverage ? PD.getDataCoverage() : null;
    const min = cov?.tasks?.range?.min;
    const max = cov?.tasks?.range?.max;
    if (!min || !max) return [];
    const quarters = [];
    const cursor = new Date(min.getFullYear(), Math.floor(min.getMonth() / 3) * 3, 1);
    const end = max.getTime();
    while (cursor.getTime() <= end) {
      const key = partnerQuarterKey(cursor);
      if (key && !quarters.includes(key)) quarters.push(key);
      cursor.setMonth(cursor.getMonth() + 3);
    }
    return quarters.sort();
  }

  function efficiencyHeatClass(hoursPerWon, scHours, won, thresholds) {
    if (scHours > 0 && won === 0) return 'heat-pending';
    if (scHours <= 0 && won <= 0) return 'heat-empty';
    if (won > 0 && (hoursPerWon === null || hoursPerWon === undefined)) return 'heat-mid';
    if (hoursPerWon <= thresholds.low) return 'heat-good';
    if (hoursPerWon <= thresholds.high) return 'heat-mid';
    return 'heat-bad';
  }

  function buildEfficiencyHeatmap(partners, joined, limit = 24) {
    const aliases = PD.state.model.taskKeyAliases || {};
    const tasks = PD.state.model.tasks || [];
    const quarters = globalTaskQuarters();
    if (!quarters.length) return { quarters: [], rows: [], thresholds: { low: 20, high: 60 } };

    const pool = PD.sortRows(partners.filter((p) => p.totalHours > 0), { key: 'totalHours', dir: 'desc' }).slice(0, limit);
    const values = [];
    const rows = pool.map((partner) => {
      const opps = joined.filter((row) => row.partnerKey === partner.partnerKey);
      const trend = buildPartnerTrend(partner.partnerKey, opps, tasks, aliases);
      const byQuarter = Object.fromEntries(trend.map((row) => [row.key, row]));
      const cells = quarters.map((quarter) => {
        const bucket = byQuarter[quarter] || { scHours: 0, won: 0, closed: 0 };
        const hoursPerWon = bucket.won > 0 ? bucket.scHours / bucket.won : null;
        if (hoursPerWon !== null && hoursPerWon >= 0) values.push(hoursPerWon);
        return {
          quarter,
          scHours: bucket.scHours,
          won: bucket.won,
          closed: bucket.closed,
          hoursPerWon
        };
      });
      return { partner, cells };
    });

    const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    const thresholds = sorted.length
      ? {
        low: sorted[Math.floor(sorted.length / 3)] || sorted[0],
        high: sorted[Math.floor((sorted.length * 2) / 3)] || sorted[sorted.length - 1]
      }
      : { low: 20, high: 60 };
    return { quarters, rows, thresholds };
  }

  function renderEfficiencyHeatmap(partners, joined) {
    const host = $('#partner-efficiency-heatmap');
    const note = $('#heatmap-footnote');
    const legendNote = $('#heatmap-legend-note');
    if (!host) return;
    if (note) note.textContent = scTrackingFootnote();

    const data = buildEfficiencyHeatmap(partners, joined);
    if (!data.rows.length || !data.quarters.length) {
      if (legendNote) legendNote.textContent = '';
      host.innerHTML = '<p class="muted">Need dated SC tasks and partners with logged hours in the current filter.</p>';
      return;
    }

    const low = formatEfficiencyHours(data.thresholds.low);
    const high = formatEfficiencyHours(data.thresholds.high);
    if (legendNote) {
      legendNote.textContent = `Colour bands are comparative for this view only — not fixed targets. Among partner-quarters shown here (top 24 partners by SC hours in your current filter), green is the lowest third of SC hours per won (≤${low}), amber is the middle third (${low}–${high}), and red is the highest third (>${high}). Cell numbers are SC hours per won that quarter.`;
    }

    const header = `<tr><th class="heat-sticky">Partner</th>${data.quarters.map((q) => `<th>${PD.escapeHtml(quarterLabelShort(q))}</th>`).join('')}</tr>`;
    const body = data.rows.map(({ partner, cells }) => {
      const tds = cells.map((cell) => {
        const cls = efficiencyHeatClass(cell.hoursPerWon, cell.scHours, cell.won, data.thresholds);
        let label = '–';
        if (cls === 'heat-pending') label = `${PD.formatHours(cell.scHours)}†`;
        else if (cell.won > 0) label = formatEfficiencyHours(cell.hoursPerWon);
        const title = `${cell.scHours ? PD.formatHours(cell.scHours) + ' SC' : 'No SC'} · ${cell.won} won · ${cell.closed} closed`;
        return `<td class="heat-cell ${cls}" title="${PD.escapeHtml(title)}">${label}</td>`;
      }).join('');
      return `<tr class="heat-row clickable" data-partner-key="${PD.escapeHtml(partner.partnerKey)}"><td class="heat-sticky"><strong>${PD.escapeHtml(partner.partnerGroup.length > 28 ? `${partner.partnerGroup.slice(0, 26)}…` : partner.partnerGroup)}</strong></td>${tds}</tr>`;
    }).join('');

    host.innerHTML = `
      <table class="heat-table">
        <thead>${header}</thead>
        <tbody>${body}</tbody>
      </table>
      <div class="heat-legend">
        <span class="heat-good">Green — lowest third (≤${low})</span>
        <span class="heat-mid">Amber — middle third (${low}–${high})</span>
        <span class="heat-bad">Red — highest third (>${high})</span>
        <span class="heat-pending">Blue — SC logged, no wins that quarter (†)</span>
        <span class="heat-empty">Grey — no SC and no closes</span>
      </div>
    `;
  }

  function effectivenessBubbleSvg(partners) {
    const pool = partners.filter((p) => p.opportunityCount > 0 && (p.totalHours > 0 || p.closedCount > 0));
    const rows = PD.sortRows(pool, { key: 'totalHours', dir: 'desc' }).slice(0, 40);
    if (!rows.length) return emptyChart('Upload task and opportunity exports to compare partners.');
    const width = 980;
    const height = 380;
    const pad = { left: 70, right: 40, top: 30, bottom: 60 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const maxX = Math.max(...rows.map((p) => p.opportunityCount), 1);
    const maxY = Math.max(...rows.map((p) => p.totalHours), 1);
    const maxR = Math.max(...rows.map((p) => p.oppsWithHours || 1), 1);
    const x = (v) => pad.left + (v / maxX) * plotW;
    const y = (v) => pad.top + plotH - (v / maxY) * plotH;
    const r = (v) => 6 + ((v || 0) / maxR) * 16;
    const gridX = [0, 0.25, 0.5, 0.75, 1].map((p) => `<g><line x1="${x(maxX * p)}" y1="${pad.top}" x2="${x(maxX * p)}" y2="${pad.top + plotH}" class="scatter-grid"></line><text x="${x(maxX * p)}" y="${height - 24}" text-anchor="middle" class="chart-meta">${Math.round(maxX * p)}</text></g>`).join('');
    const gridY = [0, 0.25, 0.5, 0.75, 1].map((p) => `<g><line x1="${pad.left}" y1="${y(maxY * p)}" x2="${pad.left + plotW}" y2="${y(maxY * p)}" class="scatter-grid"></line><text x="${pad.left - 10}" y="${y(maxY * p) + 4}" text-anchor="end" class="chart-meta">${PD.formatHours(maxY * p)}</text></g>`).join('');
    const top = PD.sortRows(rows, { key: 'totalHours', dir: 'desc' }).slice(0, 10);
    const points = rows.map((p) => {
      const win = p.winRate !== null ? PD.formatPercent(p.winRate) : '–';
      const tip = `${p.partnerGroup} — ${PD.formatInt(p.opportunityCount)} opps, ${PD.formatHours(p.totalHours)} SC, ${win} win rate`;
      return `<circle cx="${x(p.opportunityCount)}" cy="${y(p.totalHours)}" r="${r(p.oppsWithHours)}" fill="${winRateColor(p.winRate)}" fill-opacity="0.72" stroke="#fff" stroke-width="1.5" class="scatter-point"><title>${PD.escapeHtml(tip)}</title></circle>`;
    }).join('');
    const labels = top.map((p) => `<text x="${x(p.opportunityCount) + 8}" y="${y(p.totalHours) - 6}" class="chart-meta">${PD.escapeHtml(p.partnerGroup.length > 22 ? `${p.partnerGroup.slice(0, 20)}…` : p.partnerGroup)}</text>`).join('');
    const legend = `<g transform="translate(${pad.left + plotW - 160} ${pad.top})"><text class="chart-meta">Win rate</text><circle cx="8" cy="22" r="6" fill="#0d7a55"/><text x="20" y="26" class="chart-meta">≥35%</text><circle cx="8" cy="42" r="6" fill="#2563eb"/><text x="20" y="46" class="chart-meta">22–35%</text><circle cx="8" cy="62" r="6" fill="#b45309"/><text x="20" y="66" class="chart-meta">15–22%</text><circle cx="8" cy="82" r="6" fill="#b42318"/><text x="20" y="86" class="chart-meta">&lt;15%</text></g>`;
    const note = pool.length > rows.length ? `<text x="${pad.left}" y="16" class="chart-meta">Top ${rows.length} partners by SC hours (${pool.length} with data in filter)</text>` : '';
    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Partner effectiveness matrix">${note}${gridX}${gridY}<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" class="scatter-axis"></line><line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" class="scatter-axis"></line>${points}${labels}${legend}<text x="${pad.left + plotW / 2}" y="${height - 6}" text-anchor="middle" class="axis-label">Opportunity count</text><text x="18" y="${pad.top + plotH / 2}" text-anchor="middle" class="axis-label" transform="rotate(-90 18 ${pad.top + plotH / 2})">SC hours</text></svg>`;
  }

  function outcomeSvg(items) {
    const rows = items.filter((x) => x.totalHours > 0 || x.opportunityCount > 0);
    if (!rows.length) return emptyChart('No opportunity outcomes available.');
    const total = rows.reduce((s, r) => s + r.totalHours, 0) || 1;
    const classes = { Won: 'outcome-won', Lost: 'outcome-lost', Open: 'outcome-open', Unknown: 'outcome-unknown' };
    let cursor = 0;
    const barX = 70;
    const barW = 830;
    const barY = 40;
    const height = 170;
    const width = 980;
    const segs = rows.map((row) => {
      const w = (row.totalHours / total) * barW;
      const html = `<rect x="${barX + cursor}" y="${barY}" width="${Math.max(2, w)}" height="26" rx="8" class="${classes[row.outcome] || 'outcome-unknown'}"></rect>`;
      cursor += w;
      return html;
    }).join('');
    const legend = rows.map((row, i) => `<g transform="translate(70 ${96 + i * 24})"><rect width="14" height="14" rx="4" class="${classes[row.outcome] || 'outcome-unknown'}"></rect><text x="22" y="12" class="chart-meta">${PD.escapeHtml(row.outcome)} · ${PD.escapeHtml(PD.formatHours(row.totalHours))} · ${PD.escapeHtml(PD.formatInt(row.opportunityCount))} opps</text></g>`).join('');
    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Hours by outcome">${segs}${legend}</svg>`;
  }

  function summarizeRegionHours(joined, useL4) {
    const key = useL4 ? 'subRegion' : 'region';
    const map = new Map();
    for (const row of joined) {
      const label = PD.cleanText(row[key]) || '(blank)';
      if (!map.has(label)) map.set(label, { label, totalHours: 0, opportunityCount: 0 });
      const out = map.get(label);
      out.totalHours += row.totalHours || 0;
      out.opportunityCount += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.totalHours - a.totalHours);
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
    const ascKeys = new Set(['partnerGroup', 'hoursPerWon', 'hoursPer100k', 'avgHoursPerOppWithHours']);
    return { key: ui.partnerSortKey, dir: ascKeys.has(ui.partnerSortKey) ? 'asc' : 'desc' };
  }

  function getWatchlistPartners(d) {
    const partners = filterPartners(d.partnerSummary);
    return PD.sortRows(partners, { key: 'riskScore', dir: 'desc' }).slice(0, 12);
  }

  function directSummary(d) {
    return d.partnerSummary.find((p) => isNonPartner(p.partnerGroup)) || null;
  }

  function getL3Options() {
    const cached = PD.state.model.filterOptionsCache?.region;
    if (cached?.length) return cached;
    return [...new Set((PD.state.model.opportunities || []).map((o) => PD.cleanText(o.region)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  function getL4Options(l3) {
    const cache = PD.state.model.filterOptionsCache;
    if (l3 && l3 !== 'all' && cache?.subRegionByRegion?.[l3]) return cache.subRegionByRegion[l3];
    if ((!l3 || l3 === 'all') && cache?.subRegion?.length) return cache.subRegion;
    let opps = PD.state.model.opportunities || [];
    if (l3 && l3 !== 'all') opps = opps.filter((o) => PD.cleanText(o.region) === l3);
    const fromModel = opps.map((o) => PD.cleanText(o.subRegion)).filter(Boolean);
    return [...new Set(fromModel)].sort((a, b) => a.localeCompare(b));
  }

  function fillSelect(el, labelAll, values, current) {
    if (!el) return;
    el.replaceChildren();
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = labelAll;
    el.appendChild(allOpt);
    for (const value of values) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      el.appendChild(opt);
    }
    el.value = current && values.includes(current) ? current : 'all';
  }

  function syncRegionFilters(fromScorecard) {
    const l3El = fromScorecard ? $('#filter-l3-scorecard') : $('#filter-l3');
    const l4El = fromScorecard ? $('#filter-l4-scorecard') : $('#filter-l4');
    const l3 = l3El.value;
    const l4 = l4El.value;
    PD.state.filters.selections.region = l3 === 'all' ? new Set() : new Set([l3]);
    PD.state.filters.selections.subRegion = l4 === 'all' ? new Set() : new Set([l4]);
    if (!fromScorecard) {
      $('#filter-l3-scorecard').value = l3;
      $('#filter-l4-scorecard').value = l4;
    } else {
      $('#filter-l3').value = l3;
      $('#filter-l4').value = l4;
    }
  }

  function populateRegionFilters() {
    if (!hasData()) return;
    const l3Current = $('#filter-l3')?.value || 'all';
    const l3Options = getL3Options();
    fillSelect($('#filter-l3'), 'All regions', l3Options, l3Current);
    fillSelect($('#filter-l3-scorecard'), 'All regions', l3Options, l3Current);

    const l3 = $('#filter-l3')?.value || 'all';
    const l4Current = $('#filter-l4')?.value || 'all';
    const l4Options = getL4Options(l3);
    fillSelect($('#filter-l4'), 'All sub-regions', l4Options, l4Current);
    fillSelect($('#filter-l4-scorecard'), 'All sub-regions', l4Options, l4Current);
    syncRegionFilters(false);
  }

  function renderStatus() {
    const m = PD.state.model;
    const pill = $('#status-pill');
    if (!hasData()) {
      pill.textContent = 'No data loaded';
      return;
    }
    const stats = m.baseStats || {};
    pill.textContent = `${stats.opportunitiesImported || m.opportunities.length} opps · ${stats.tasksImported || m.tasks.length} tasks`;
  }

  function renderEmpty() {
    renderStatus();
    const banner = $('#data-coverage-banner');
    if (banner) banner.classList.add('hidden');
    setPage(ui.page === 'admin' ? 'admin' : 'empty');
  }

  function renderInsight(d, watch) {
    const host = $('#overview-insight');
    const alert = watch.find((p) => p.signalClass === 'signal-alert');
    const good = watch.find((p) => p.signalClass === 'signal-good' || p.signalClass === 'signal-positive');
    if (alert) {
      host.className = 'insight alert';
      host.innerHTML = `<strong>Needs attention:</strong> ${PD.escapeHtml(alert.partnerGroup)} — ${PD.formatHours(alert.totalHours)} across ${PD.formatInt(alert.opportunityCount)} opps, win rate ${PD.formatPercent(alert.winRate)}. ${PD.escapeHtml(alert.signal)}.`;
      return;
    }
    if (good) {
      host.className = 'insight good';
      host.innerHTML = `<strong>Standout:</strong> ${PD.escapeHtml(good.partnerGroup)} — ${PD.escapeHtml(good.signal)} (${PD.formatPercent(good.winRate)} on ${PD.formatInt(good.closedCount)} closed).`;
      return;
    }
    host.className = 'insight';
    host.innerHTML = '<strong>Snapshot:</strong> Use region filters to slice by L3/L4, then review the effectiveness matrix and focus list.';
  }

  function renderKpis(d, partners) {
    const withHours = partners.filter((p) => p.oppsWithHours > 0);
    const pctWithHours = d.kpis.opportunities ? Math.round((d.kpis.oppsWithHours / d.kpis.opportunities) * 100) : 0;

    $('#overview-kpis').innerHTML = `
      <article class="kpi"><p class="label">SC hours (filtered)</p><p class="value">${PD.formatHours(d.kpis.totalHours)}</p><p class="sub">${PD.formatInt(d.kpis.opportunities)} opps · ${pctWithHours}% with SC time</p></article>
      <article class="kpi"><p class="label">Closed win rate</p><p class="value">${d.kpis.winRate !== null ? PD.formatPercent(d.kpis.winRate) : '–'}</p><p class="sub">Won vs lost in filter</p></article>
      <article class="kpi"><p class="label">SC hours per won</p><p class="value">${formatEfficiencyHours(d.kpis.hoursPerWon)}</p><p class="sub">Portfolio avg · filtered slice</p></article>
      <article class="kpi"><p class="label">SC hours per $100k won</p><p class="value">${formatEfficiencyHours(d.kpis.hoursPer100k)}</p><p class="sub">Uses Gross ACV Booking</p></article>
      ${hasLearningData() ? `<article class="kpi"><p class="label">Partner learning</p><p class="value">${PD.formatDuration(d.kpis.learningSeconds)}</p><p class="sub">${PD.formatInt(d.kpis.engagedLearners)} engaged learners in filter</p></article>` : ''}
      <article class="kpi"><p class="label">Active partners</p><p class="value">${PD.formatInt(partners.length)}</p><p class="sub">${PD.formatInt(withHours.length)} with SC hours</p></article>
    `;
    $('#overview-note').textContent = d.taskHoursTotal
      ? `${PD.formatPercent(d.taskHoursMatched / d.taskHoursTotal)} of task hours matched to opps`
      : '';
  }

  function renderCharts(d, partners, renderGen) {
    const medians = computeMedians(partners);
    const steps = [
      () => { if (renderGen !== ui.renderGen || ui.page !== 'overview') return; $('#chart-effectiveness').innerHTML = effectivenessBubbleSvg(partners); },
      () => {
        if (renderGen !== ui.renderGen || ui.page !== 'overview') return;
        const hourItems = PD.sortRows(partners.filter((p) => p.totalHours > 0), { key: 'totalHours', dir: 'desc' }).slice(0, 10).map((p) => ({
          label: p.partnerGroup,
          meta: `${PD.formatInt(p.opportunityCount)} opps · ${PD.formatPercent(p.winRate)}`,
          value: p.totalHours,
          valueLabel: PD.formatHours(p.totalHours)
        }));
        $('#chart-partner-hours').innerHTML = barSvg(hourItems, 'Top partners by SC hours');
      },
      () => {
        if (renderGen !== ui.renderGen || ui.page !== 'overview') return;
        const winItems = PD.sortRows(partners.filter((p) => p.closedCount >= 5 && p.winRate !== null), { key: 'winRate', dir: 'desc' }).slice(0, 10).map((p) => ({
          label: p.partnerGroup,
          meta: `${PD.formatInt(p.closedCount)} closed · ${PD.formatHours(p.totalHours)} SC`,
          value: p.winRate,
          valueLabel: PD.formatPercent(p.winRate)
        }));
        $('#chart-win-rate').innerHTML = barSvg(winItems, 'Win rate leaders');
      },
      () => {
        if (renderGen !== ui.renderGen || ui.page !== 'overview') return;
        const effItems = PD.sortRows(
          partners.filter((p) => p.wonCount >= 3 && p.hoursPerWon !== null),
          { key: 'hoursPerWon', dir: 'asc' }
        ).slice(0, 10).map((p) => ({
          label: p.partnerGroup,
          meta: `${PD.formatInt(p.wonCount)} won · ${p.winRate !== null ? PD.formatPercent(p.winRate) : '–'} win rate`,
          value: p.hoursPerWon,
          valueLabel: formatEfficiencyHours(p.hoursPerWon)
        }));
        $('#chart-efficiency').innerHTML = effItems.length
          ? barSvg(effItems, 'Lowest SC hours per won deal')
          : emptyChart('Need partners with at least 3 won deals in the filter.');
      },
      () => {
        if (renderGen !== ui.renderGen || ui.page !== 'overview') return;
        const l3 = $('#filter-l3').value;
        const useL4 = l3 && l3 !== 'all';
        const regionRows = summarizeRegionHours(d.joined, useL4);
        $('#region-chart-title').textContent = useL4 ? 'SC hours by sub-region (L4)' : 'SC hours by region (L3)';
        $('#region-chart-sub').textContent = useL4 ? `Within ${l3}` : 'Pick an L3 filter to drill into L4';
        const regionItems = regionRows.slice(0, 12).map((r) => ({
          label: r.label,
          meta: `${PD.formatInt(r.opportunityCount)} opps`,
          value: r.totalHours,
          valueLabel: PD.formatHours(r.totalHours)
        }));
        $('#chart-region-hours').innerHTML = barSvg(regionItems, 'SC hours by region');
      },
      () => {
        if (renderGen !== ui.renderGen || ui.page !== 'overview') return;
        $('#chart-outcome').innerHTML = outcomeSvg(d.outcomeSummary);
        renderQuadrants(partners, medians);
      },
      () => {
        if (renderGen !== ui.renderGen || ui.page !== 'overview') return;
        const panel = $('#learning-overview-panel');
        const host = $('#chart-learning-partners');
        if (!hasLearningData() || !panel || !host) return;
        panel.classList.remove('hidden');
        const items = PD.sortRows(
          partners.filter((p) => p.learningSeconds > 0),
          { key: 'learningSeconds', dir: 'desc' }
        ).slice(0, 10).map((p) => ({
          label: p.partnerGroup,
          meta: `${PD.formatInt(p.engagedLearnerCount || p.learnerCount)} learners · ${PD.formatHours(p.totalHours)} SC`,
          value: p.learningSeconds / 3600,
          valueLabel: PD.formatDuration(p.learningSeconds)
        }));
        host.innerHTML = items.length
          ? barSvg(items, 'Top partners by learning time')
          : emptyChart('Learning rows loaded but none mapped to partners in this filter.');
      },
      () => {
        if (renderGen !== ui.renderGen || ui.page !== 'overview') return;
        const panel = $('#learning-conversion-panel');
        const host = $('#chart-learning-conversion');
        const insight = $('#learning-conversion-insight');
        if (!hasLearningData() || !panel || !host) return;
        panel.classList.remove('hidden');
        const analysis = learningConversionAnalysis(partners);
        if (insight) {
          insight.className = 'join-note';
          insight.innerHTML = learningConversionInsightText(analysis);
        }
        host.innerHTML = learningConversionScatterSvg(analysis.cohort);
      }
    ];
    let step = 0;
    function nextChartFrame() {
      if (step >= steps.length) return;
      steps[step]();
      step += 1;
      if (step < steps.length) requestAnimationFrame(nextChartFrame);
    }
    requestAnimationFrame(nextChartFrame);
  }

  function renderWatchlist(partners, medians) {
    const body = $('#watchlist-body');
    if (!partners.length) {
      body.innerHTML = '<tr><td colspan="8" class="muted">No partners match the current filter.</td></tr>';
      return;
    }
    body.innerHTML = partners.map((p) => {
      const band = effectivenessBand(p, medians);
      return `<tr class="clickable" data-partner-key="${PD.escapeHtml(p.partnerKey)}">
        <td><strong>${PD.escapeHtml(p.partnerGroup)}</strong></td>
        <td>${bandHtml(band)}</td>
        <td>${PD.formatInt(p.opportunityCount)}</td>
        <td>${PD.formatHours(p.totalHours)}</td>
        <td>${p.winRate !== null ? PD.formatPercent(p.winRate) : '–'}</td>
        <td>${p.learningSeconds > 0 ? PD.formatDuration(p.learningSeconds) : '–'}</td>
        <td>${formatEfficiencyHours(p.hoursPerWon)}</td>
        <td class="signal">${PD.escapeHtml(p.signal)}</td>
      </tr>`;
    }).join('');
  }

  function renderQuadrants(partners, medians) {
    const buckets = quadrantBuckets(partners, medians);
    const order = ['stars', 'volume', 'efficient', 'light'];
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
    foot.textContent = `${direct.partnerGroup}: ${PD.formatInt(direct.opportunityCount)} opps · ${PD.formatHours(direct.totalHours)} SC hours — excluded from partner rankings. Toggle view to include.`;
  }

  function scorecardRowHtml(p, medians) {
    const band = effectivenessBand(p, medians);
    return `<tr class="clickable" data-partner-key="${PD.escapeHtml(p.partnerKey)}">
      <td>${PD.escapeHtml(p.partnerGroup)}</td>
      <td>${bandHtml(band)}</td>
      <td>${PD.formatInt(p.opportunityCount)}</td>
      <td>${PD.formatInt(p.oppsWithHours)}</td>
      <td>${PD.formatHours(p.totalHours)}</td>
      <td>${p.avgHoursPerOppWithHours !== null ? PD.formatHours(p.avgHoursPerOppWithHours) : '–'}</td>
      <td>${formatEfficiencyHours(p.hoursPerWon)}</td>
      <td>${formatEfficiencyHours(p.hoursPer100k)}</td>
      <td>${p.learningSeconds > 0 ? PD.formatDuration(p.learningSeconds) : '–'}</td>
      <td>${p.learnerCount > 0 ? PD.formatInt(p.learnerCount) : '–'}</td>
      <td>${PD.formatInt(p.wonCount)}</td>
      <td>${PD.formatInt(p.lostCount)}</td>
      <td>${PD.formatInt(p.openCount)}</td>
      <td>${p.winRate !== null ? PD.formatPercent(p.winRate) : '–'}</td>
      <td class="signal">${PD.escapeHtml(p.signal)}</td>
    </tr>`;
  }

  function renderScorecard(partners, medians, renderGen) {
    const d = derived();
    renderEfficiencyHeatmap(partners, d.joined);
    const sorted = PD.sortRows(partners, partnerSortState());
    const body = $('#scorecard-body');
    if (!sorted.length) {
      body.innerHTML = '<tr><td colspan="15" class="muted">No partners match the current filter.</td></tr>';
      return;
    }
    const chunkSize = 75;
    let index = 0;
    body.innerHTML = scorecardRowHtml(sorted[0], medians);
    index = 1;
    function pump() {
      if (renderGen !== ui.renderGen || ui.page !== 'partners') return;
      const end = Math.min(index + chunkSize, sorted.length);
      if (index >= end) return;
      body.insertAdjacentHTML('beforeend', sorted.slice(index, end).map((p) => scorecardRowHtml(p, medians)).join(''));
      index = end;
      if (index < sorted.length) requestAnimationFrame(pump);
    }
    if (index < sorted.length) requestAnimationFrame(pump);
  }

  function renderDetail(d) {
    const data = d || derived();
    const key = ui.selectedPartnerKey;
    const partner = data.partnerSummary.find((p) => p.partnerKey === key);
    if (!partner) {
      setPage('overview');
      return;
    }
    const medians = computeMedians(filterPartners(data.partnerSummary));
    const band = effectivenessBand(partner, medians);
    const opps = PD.sortRows(
      data.joined.filter((row) => (row.partnerKey || '') === key),
      { key: 'totalHours', dir: 'desc' }
    );
    const stages = PD.sortRows(PD.summarizeStages(opps), { key: 'totalHours', dir: 'desc' });
    const totalStageHrs = stages.reduce((s, r) => s + r.totalHours, 0);
    const oppKeySet = new Set(opps.map((o) => o.opportunityKey));
    const aliases = PD.state.model.taskKeyAliases || {};
    const activities = PD.sortRows(PD.summarizeActivities(
      (PD.state.model.tasks || []).filter((t) => oppKeySet.has(aliases[t.opportunityKey] || t.opportunityKey))
    ), { key: 'totalHours', dir: 'desc' });
    const trendRows = buildPartnerTrend(
      key,
      opps,
      PD.state.model.tasks || [],
      aliases
    );
    const trendInsight = partnerTrendInsight(trendRows);

    $('#detail-hero').innerHTML = `
      <h2>${PD.escapeHtml(partner.partnerGroup)} ${bandHtml(band)}</h2>
      <p>${PD.formatHours(partner.totalHours)} across ${PD.formatInt(partner.opportunityCount)} opportunities (${partner.avgHoursPerOppWithHours !== null ? PD.formatHours(partner.avgHoursPerOppWithHours) : '–'} per opp with SC time, ${PD.formatInt(partner.oppsWithHours)} opps with hours). ${partner.winRate !== null ? `Win rate ${PD.formatPercent(partner.winRate)} (${PD.formatInt(partner.wonCount)} won / ${PD.formatInt(partner.closedCount)} closed).` : ''} SC efficiency: ${formatEfficiencyHours(partner.hoursPerWon)} per won · ${formatEfficiencyHours(partner.hoursPer100k)} per $100k won.${partner.learningSeconds > 0 ? ` Learning: ${PD.formatDuration(partner.learningSeconds)} (${PD.formatInt(partner.learnerCount)} learners).` : ''} ${PD.escapeHtml(partner.signal)}.</p>
    `;

    const learningRows = (PD.state.model.learningRows || []).filter((r) => r.partnerKey === key);
    const courseMap = new Map();
    for (const row of learningRows) {
      const title = row.learningCourse || '(blank)';
      if (!courseMap.has(title)) courseMap.set(title, { title, learningSeconds: 0, learners: new Set() });
      const c = courseMap.get(title);
      c.learningSeconds += row.learningSeconds || 0;
      if (row.email) c.learners.add(row.email);
    }
    const courses = PD.sortRows(
      Array.from(courseMap.values()).map((c) => ({ ...c, learnerCount: c.learners.size })),
      { key: 'learningSeconds', dir: 'desc' }
    );
    const courseRows = courses.length
      ? courses.slice(0, 20).map((c) => `<tr><td>${PD.escapeHtml(c.title)}</td><td>${PD.formatDuration(c.learningSeconds)}</td><td>${PD.formatInt(c.learnerCount)}</td></tr>`).join('')
      : '<tr><td colspan="3" class="muted">No learning activity mapped to this partner.</td></tr>';

    const pipelineRows = opps.length
      ? opps.map((o) => `<tr>
          <td>${PD.escapeHtml(o.opportunityName)}</td>
          <td>${PD.escapeHtml(o.stage || '–')}</td>
          <td>${outcomePill(o.outcome)}</td>
          <td>${PD.formatHours(o.totalHours)}</td>
          <td>${PD.escapeHtml(o.region || '–')}</td>
          <td>${PD.escapeHtml(o.subRegion || '–')}</td>
          <td>${PD.escapeHtml(o.opportunityOwner || '–')}</td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="muted">No opportunities for this partner in the current filter.</td></tr>';

    const stageRows = stages.length
      ? stages.map((s) => `<tr>
          <td>${PD.escapeHtml(s.stage)}</td>
          <td>${PD.formatHours(s.totalHours)}</td>
          <td>${totalStageHrs ? PD.formatPercent(s.totalHours / totalStageHrs) : '–'}</td>
        </tr>`).join('')
      : '<tr><td colspan="3" class="muted">No SC hours on opportunities for this partner.</td></tr>';

    const activityRows = activities.length
      ? activities.slice(0, 15).map((a) => `<tr>
          <td>${PD.escapeHtml(a.activityType)}</td>
          <td>${PD.formatHours(a.totalHours)}</td>
          <td>${PD.formatInt(a.taskCount)}</td>
        </tr>`).join('')
      : `<tr><td colspan="3" class="muted">No task rows linked to this partner's opportunities.</td></tr>`;

    $('#detail-panels').innerHTML = `
      <article class="panel ${ui.detailSub === 'pipeline' ? '' : 'hidden'}" data-sub-panel="pipeline">
        <div class="panel-head"><div><h2>Opportunities</h2><p>${PD.formatInt(opps.length)} in scope</p></div></div>
        <div class="table-scroll"><table><thead><tr><th>Opportunity</th><th>Stage</th><th>Outcome</th><th>SC hrs</th><th>L3</th><th>L4</th><th>Owner</th></tr></thead><tbody>${pipelineRows}</tbody></table></div>
      </article>
      <article class="panel ${ui.detailSub === 'sc' ? '' : 'hidden'}" data-sub-panel="sc">
        <div class="panel-head"><div><h2>SC effort</h2><p>Hours by stage and activity type</p></div></div>
        <div class="grid-2" style="padding:0 16px 16px;gap:16px">
          <div class="table-scroll"><table><thead><tr><th>Stage</th><th>SC hours</th><th>Share</th></tr></thead><tbody>${stageRows}</tbody></table></div>
          <div class="table-scroll"><table><thead><tr><th>Activity type</th><th>SC hours</th><th>Tasks</th></tr></thead><tbody>${activityRows}</tbody></table></div>
        </div>
      </article>
      <article class="panel ${ui.detailSub === 'trends' ? '' : 'hidden'}" data-sub-panel="trends">
        <div class="panel-head"><div><h2>SC effort vs outcomes over time</h2><p>Quarterly SC hours (bars) and closed win rate (line) — uses task dates and opportunity close dates</p></div></div>
        <p class="join-note muted" style="margin:0 16px 8px">${PD.escapeHtml(scTrackingFootnote())}</p>
        <p class="join-note muted" style="margin:0 16px 8px">${PD.escapeHtml(trendInsight)}</p>
        <div class="trend-legend"><span class="sc">SC hours</span><span class="win">Win rate (closed deals)</span></div>
        <div id="chart-partner-trend" class="chart-host">${partnerTrendSvg(trendRows)}</div>
      </article>
      <article class="panel ${ui.detailSub === 'learning' ? '' : 'hidden'}" data-sub-panel="learning">
        <div class="panel-head"><div><h2>Learning activity</h2><p>Genie/Seismic courses mapped via learner email domain</p></div></div>
        <div class="table-scroll"><table><thead><tr><th>Course</th><th>Learning time</th><th>Learners</th></tr></thead><tbody>${courseRows}</tbody></table></div>
      </article>
    `;
  }

  function renderAdmin() {
    const m = PD.state.model;
    const breakdown = hasData() && PD.getTaskJoinBreakdown ? PD.getTaskJoinBreakdown() : null;
    const matchRate = breakdown && breakdown.totalHours ? breakdown.matchedHours / breakdown.totalHours : null;
    const regions = hasData() ? getL3Options().length : 0;

    $('#quality-body').innerHTML = hasData() ? `
      <tr><td>Files loaded</td><td><strong>${PD.formatInt((m.files || []).length)}</strong></td></tr>
      <tr><td>SC task period</td><td>${PD.escapeHtml(m.dataCoverage?.tasks?.label || '–')}</td></tr>
      <tr><td>Opportunity close dates</td><td>${PD.escapeHtml(m.dataCoverage?.opportunities?.closeLabel || '–')}</td></tr>
      <tr><td>Opportunity created</td><td>${PD.escapeHtml(m.dataCoverage?.opportunities?.createdLabel || '–')}</td></tr>
      <tr><td>Learning years</td><td>${PD.escapeHtml(m.dataCoverage?.learning?.label || '–')}</td></tr>
      <tr><td>Opportunities</td><td>${PD.formatInt(m.baseStats.opportunitiesImported || m.opportunities.length)}</td></tr>
      <tr><td>Tasks (deduped)</td><td>${PD.formatInt(m.tasks.length)}</td></tr>
      <tr><td>L3 regions in export</td><td>${PD.formatInt(regions)}</td></tr>
      <tr><td>Fuzzy task–opp links</td><td>${PD.formatInt((m.fuzzyTaskMatches || []).length)}</td></tr>
      <tr><td>Task–opp match rate</td><td><strong>${matchRate !== null ? PD.formatPercent(matchRate) : '–'}</strong></td></tr>
      <tr><td>Unmatched task names</td><td>${PD.formatInt((m.unmatchedTaskAgg || []).length)}</td></tr>
      <tr><td>Learning rows</td><td>${PD.formatInt(m.learningRows?.length || 0)}</td></tr>
      <tr><td>Distinct learners</td><td>${PD.formatInt(m.baseStats.learningLearnersImported || 0)}</td></tr>
      <tr><td>Saved domain mappings</td><td>${PD.formatInt(Object.keys(PD.getCustomDomainPartnerMap ? PD.getCustomDomainPartnerMap() : {}).length)}</td></tr>
    ` : '<tr><td colspan="2" class="muted">Load files to see diagnostics.</td></tr>';

    const domainReport = PD.getDomainMappingReport ? PD.getDomainMappingReport() : null;
    const domainBody = $('#domain-map-body');
    const domainNote = $('#learning-map-note');
    if (domainReport && domainBody) {
      const rows = []
        .concat((domainReport.unmapped || []).map((r) => ({ ...r, status: 'Unmapped' })))
        .concat((domainReport.ambiguous || []).map((r) => ({ ...r, status: 'Ambiguous', partner: r.bestPartner })))
        .sort((a, b) => b.learningSeconds - a.learningSeconds)
        .slice(0, 20);
      domainBody.innerHTML = rows.length
        ? rows.map((r) => `<tr><td>${PD.escapeHtml(r.domain)}</td><td>${PD.formatInt(r.learners)}</td><td>${PD.formatDuration(r.learningSeconds)}</td><td>${PD.escapeHtml(r.status)}</td><td>${PD.escapeHtml(r.partner || r.bestPartner || '–')}${r.runnerUp ? `<span class="muted"> · ${PD.escapeHtml(r.runnerUp)}</span>` : ''}</td></tr>`).join('')
        : '<tr><td colspan="5" class="muted">Load a learning export to review domain mapping.</td></tr>';
      if (domainNote) {
        const auto = (domainReport.autoMapped || []).length;
        const amb = (domainReport.ambiguous || []).length;
        const unmapped = (domainReport.unmapped || []).length;
        domainNote.innerHTML = hasLearningData()
          ? `<strong>Domain mapping:</strong> ${PD.formatInt(auto)} auto-matched · ${PD.formatInt(amb)} ambiguous · ${PD.formatInt(unmapped)} unmapped. Upload <code>partner-domain-map.csv</code> (Email Domain, Partner Name) — stored in your browser only. Template: <a href="partner-domain-map.template.csv">partner-domain-map.template.csv</a>.`
          : '';
      }
    } else if (domainBody) {
      domainBody.innerHTML = '<tr><td colspan="5" class="muted">Load a learning export to review domain mapping.</td></tr>';
    }

    const fuzzy = (m.fuzzyTaskMatches || []).slice(0, 15);
    const fuzzyBody = $('#fuzzy-match-body');
    if (fuzzyBody) {
      fuzzyBody.innerHTML = fuzzy.length
        ? fuzzy.map((r) => `<tr><td>${PD.escapeHtml(r.taskOpportunityName)}</td><td>${PD.escapeHtml(r.matchedOpportunityName)}</td><td>${PD.escapeHtml(r.matchedPartner || '')}</td><td>${PD.formatHours(r.totalHours)}</td></tr>`).join('')
        : '<tr><td colspan="4" class="muted">No fuzzy links needed — all task names matched exactly.</td></tr>';
    }

    const breakdownData = breakdown;
    const joinBody = $('#join-breakdown-body');
    const joinNote = $('#join-breakdown-note');
    if (breakdownData && joinBody) {
      const order = [
        'matched_exact', 'matched_fuzzy', 'unmatched_internal', 'unmatched_sc_initiative',
        'unmatched_marketing', 'unmatched_direct_named', 'unmatched_account_only',
        'unmatched_pipeline_missing', 'unmatched_blank'
      ];
      joinBody.innerHTML = order.map((key) => {
        const b = breakdownData.buckets[key];
        const share = breakdownData.totalHours ? b.hours / breakdownData.totalHours : 0;
        const gapCls = key === 'unmatched_pipeline_missing' ? 'join-row-gap' : '';
        return `<tr class="${gapCls}"><td>${PD.escapeHtml(b.label)}</td><td>${PD.formatHours(b.hours)}</td><td>${PD.formatPercent(share)}</td><td>${PD.formatInt(b.tasks)}</td></tr>`;
      }).join('');
      if (joinNote) {
        const gapPct = breakdownData.totalHours ? breakdownData.partnerGapHours / breakdownData.totalHours : 0;
        joinNote.className = 'join-note gap';
        joinNote.innerHTML = `<strong>Partner-relevant gap:</strong> ${PD.formatHours(breakdownData.partnerGapHours)} (${PD.formatPercent(gapPct)}) — pipeline opportunity names on tasks with no matching row in your opp export. `
          + `Matched total ${PD.formatHours(breakdownData.matchedHours)}; expected non-pipeline unmatched ${PD.formatHours(breakdownData.expectedUnmatched)} (internal, events, direct-named).`;
      }
    } else if (joinBody) {
      joinBody.innerHTML = '<tr><td colspan="4" class="muted">Load files to see breakdown.</td></tr>';
      if (joinNote) joinNote.textContent = '';
    }

    const pipelineMissing = breakdownData?.pipelineMissingList || [];
    $('#unmatched-body').innerHTML = pipelineMissing.length
      ? pipelineMissing.map((r) => `<tr><td>${PD.escapeHtml(r.opportunityName)}</td><td>${PD.formatHours(r.totalHours)}</td></tr>`).join('')
      : '<tr><td colspan="2" class="muted">None — all pipeline task names appear in opp export.</td></tr>';

    $('#loaded-files').innerHTML = (m.files || []).length
      ? m.files.map((f) => {
        const parts = [];
        if (f.taskRows) parts.push(`${PD.formatInt(f.taskRows)} tasks`);
        if (f.oppRows) parts.push(`${PD.formatInt(f.oppRows)} opps`);
        if (f.learningRows) parts.push(`${PD.formatInt(f.learningRows)} learning rows`);
        if (f.partnerMapRows) parts.push(`${PD.formatInt(f.partnerMapRows)} domain maps`);
        return `<li><strong>${PD.escapeHtml(f.fileName)}</strong><br><span class="muted">${parts.join(' · ') || 'recognized'}</span></li>`;
      }).join('')
      : '<li class="muted">No files loaded yet.</li>';

    renderDataCoverage();
  }

  let renderQueued = false;
  let renderSortOnly = false;

  function scheduleRender(sortOnly) {
    if (sortOnly) renderSortOnly = true;
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      setTimeout(() => {
        renderQueued = false;
        const sort = renderSortOnly;
        renderSortOnly = false;
        if (sort && hasData() && ui.page === 'partners') {
          ui.renderGen += 1;
          const d = derived();
          renderScorecard(filterPartners(d.partnerSummary), computeMedians(filterPartners(d.partnerSummary)), ui.renderGen);
          return;
        }
        renderAll();
      }, 0);
    });
  }

  function renderAll() {
    ui.renderGen += 1;
    const renderGen = ui.renderGen;

    renderStatus();

    if (!hasData()) {
      if (ui.page === 'admin') renderAdmin();
      renderEmpty();
      return;
    }

    if (!ui.regionFiltersReady) {
      populateRegionFilters();
      ui.regionFiltersReady = true;
    }

    if (ui.page === 'empty') ui.page = 'overview';

    const d = derived();
    const partners = filterPartners(d.partnerSummary);
    const medians = computeMedians(partners);
    const watch = getWatchlistPartners(d);
    renderDataCoverage();

    if (ui.page === 'overview') {
      renderKpis(d, partners);
      renderInsight(d, watch);
      renderWatchlist(watch, medians);
      renderFootnote(d);
      const learningPanel = $('#learning-overview-panel');
      if (learningPanel && !hasLearningData()) learningPanel.classList.add('hidden');
      const conversionPanel = $('#learning-conversion-panel');
      if (conversionPanel && !hasLearningData()) conversionPanel.classList.add('hidden');
      requestAnimationFrame(() => {
        if (renderGen !== ui.renderGen || ui.page !== 'overview') return;
        renderCharts(d, partners, renderGen);
      });
    } else if (ui.page === 'partners') {
      renderScorecard(partners, medians, renderGen);
    } else if (ui.page === 'detail') {
      renderDetail(d);
    } else if (ui.page === 'admin') {
      renderAdmin();
    }

    setPage(ui.page);
    document.querySelector('.tab[data-page="detail"]').disabled = !ui.selectedPartnerKey;
  }

  function openPartner(key) {
    ui.selectedPartnerKey = key;
    ui.page = 'detail';
    ui.detailSub = 'pipeline';
    document.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('active', b.dataset.sub === 'pipeline'));
    scheduleRender();
  }

  function syncViewMode(value) {
    ui.includeDirect = value === 'all';
    $('#view-mode').value = value;
    $('#view-mode-scorecard').value = value;
    invalidateDerived();
    scheduleRender();
  }

  function onRegionChange(fromScorecard) {
    const l3El = fromScorecard ? $('#filter-l3-scorecard') : $('#filter-l3');
    const l3 = l3El?.value || 'all';
    const l4Options = getL4Options(l3);
    const l4Current = 'all';
    fillSelect($('#filter-l4'), 'All sub-regions', l4Options, l4Current);
    fillSelect($('#filter-l4-scorecard'), 'All sub-regions', l4Options, l4Current);
    if (fromScorecard) $('#filter-l3').value = l3;
    else $('#filter-l3-scorecard').value = l3;
    syncRegionFilters(fromScorecard);
    invalidateDerived();
    scheduleRender();
  }

  let searchTimer = null;

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
      await new Promise((resolve) => setTimeout(resolve, 0));
      PD.state.model = PD.buildDataModel(PD.state.__parsedFiles);
      savePersistedDomainMap();
      invalidateDerived();
      ui.regionFiltersReady = false;
      if (!parsed.length) {
        window.alert('None of the uploaded files matched expected task or opportunity layouts.');
      } else {
        ui.page = 'overview';
      }
    } catch (err) {
      console.error(err);
      window.alert(`Could not parse a file: ${err.message}`);
    } finally {
      $('#loading').classList.remove('active');
      scheduleRender();
    }
  }

  function clearData() {
    clearPersistedDomainMap();
    PD.state.__parsedFiles = [];
    PD.state.model = {
      files: [],
      tasks: [],
      opportunities: [],
      learningRows: [],
      hasRawTasks: false,
      unmatchedTaskAgg: [],
      fuzzyTaskMatches: [],
      taskKeyAliases: {},
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
    invalidateDerived();
    ui.regionFiltersReady = false;
    ui.selectedPartnerKey = null;
    ui.page = 'empty';
    $('#global-search').value = '';
    scheduleRender();
  }

  function exportPartnersCsv() {
    const d = derived();
    const partners = filterPartners(d.partnerSummary);
    const medians = computeMedians(partners);
    const sorted = PD.sortRows(partners, partnerSortState());
    const rows = sorted.map((p) => ({
      Partner: p.partnerGroup,
      Band: effectivenessBand(p, medians).label,
      Opportunities: p.opportunityCount,
      OppsWithHours: p.oppsWithHours,
      SCHours: p.totalHours,
      SCHoursPerOpp: p.avgHoursPerOpp,
      SCHoursPerOppWithHours: p.avgHoursPerOppWithHours,
      HoursPerWon: p.hoursPerWon,
      HoursPer100kWon: p.hoursPer100k,
      LearningSeconds: p.learningSeconds,
      Learners: p.learnerCount,
      WonValue: p.wonValue,
      Won: p.wonCount,
      Lost: p.lostCount,
      Open: p.openCount,
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
        scheduleRender();
      });
    });

    $('#goto-admin').addEventListener('click', () => {
      ui.page = 'admin';
      scheduleRender();
    });

    $('#detail-back').addEventListener('click', () => {
      ui.page = 'overview';
      scheduleRender();
    });

    $('#global-search').addEventListener('input', (e) => {
      PD.state.filters.search = e.target.value || '';
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        invalidateDerived();
        scheduleRender();
      }, 300);
    });

    $('#filter-l3').addEventListener('change', () => { invalidateDerived(); onRegionChange(false); });
    $('#filter-l4').addEventListener('change', () => { syncRegionFilters(false); invalidateDerived(); scheduleRender(); });
    $('#filter-l3-scorecard').addEventListener('change', () => { invalidateDerived(); onRegionChange(true); });
    $('#filter-l4-scorecard').addEventListener('change', () => { syncRegionFilters(true); invalidateDerived(); scheduleRender(); });

    $('#view-mode').addEventListener('change', (e) => syncViewMode(e.target.value));
    $('#view-mode-scorecard').addEventListener('change', (e) => syncViewMode(e.target.value));

    $('#partner-sort').addEventListener('change', (e) => {
      ui.partnerSortKey = e.target.value;
      scheduleRender(true);
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

    async function loadDomainMapFile(fileList) {
      const file = Array.from(fileList || [])[0];
      if (!file) return;
      try {
        const parsed = await PD.parseSpreadsheetBuffer(await file.arrayBuffer(), file.name);
        let count = 0;
        for (const extract of (parsed.extracted || [])) {
          if (extract.type !== 'partnerMap') continue;
          for (const rec of extract.records) {
            const partner = PD.cleanText(rec['Partner Name'] || rec['Partner'] || rec['SFDC Partner Name'] || rec['Sold To/Business Partner'] || '');
            const domain = PD.cleanText(rec['Email Domain'] || rec['Domain'] || rec['EMAIL_DOMAIN'] || '').toLowerCase();
            if (!partner || !domain) continue;
            const current = PD.getCustomDomainPartnerMap();
            current[domain] = partner;
            if (PD.setPersistedDomainMap) PD.setPersistedDomainMap(current);
            count += 1;
          }
        }
        if (!count && parsed.recognized) {
          window.alert('No domain→partner rows found. Use columns: Email Domain, Partner Name.');
          return;
        }
        if (hasData()) {
          PD.state.model = PD.buildDataModel(PD.state.__parsedFiles || []);
          savePersistedDomainMap();
          invalidateDerived();
          scheduleRender();
        } else {
          savePersistedDomainMap();
        }
        window.alert(`Saved ${count} domain mapping${count === 1 ? '' : 's'} to this browser.`);
      } catch (err) {
        console.error(err);
        window.alert(`Could not read domain map: ${err.message}`);
      }
    }

    $('#upload-domain-map').addEventListener('click', () => $('#domain-map-input').click());
    $('#domain-map-input').addEventListener('change', (e) => {
      loadDomainMapFile(e.target.files);
      e.target.value = '';
    });
    $('#download-domain-map').addEventListener('click', () => {
      const map = PD.getCustomDomainPartnerMap ? PD.getCustomDomainPartnerMap() : {};
      const rows = Object.entries(map).map(([domain, partner]) => ({ 'Email Domain': domain, 'Partner Name': partner }));
      if (!rows.length) {
        window.alert('No saved domain mappings yet.');
        return;
      }
      downloadCsv('partner-domain-map.csv', rows);
    });
    $('#clear-domain-map').addEventListener('click', () => {
      if (!window.confirm('Clear saved domain mappings from this browser?')) return;
      clearPersistedDomainMap();
      if (hasData()) {
        PD.state.model = PD.buildDataModel(PD.state.__parsedFiles || []);
        invalidateDerived();
        scheduleRender();
      }
    });

    document.body.addEventListener('click', (e) => {
      const row = e.target.closest('[data-partner-key]');
      if (row)     openPartner(row.getAttribute('data-partner-key'));
    });

    document.querySelectorAll('.subtab').forEach((btn) => {
      btn.addEventListener('click', () => {
        ui.detailSub = btn.dataset.sub;
        document.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('active', b === btn));
        renderDetail();
      });
    });
  }

  loadPersistedDomainMap();
  bindEvents();
  scheduleRender();
})();
