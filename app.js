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
    partnerSortKey: 'totalHours'
  };

  const $ = (sel) => document.querySelector(sel);

  function hasData() {
    return (PD.state?.model?.opportunities || []).length > 0;
  }

  function isNonPartner(name) {
    const n = (name || '').toLowerCase();
    return /direct\s*\/?\s*no partner|indirect\s*\/?\s*no partner|end customer\s*\/?\s*no partner|^direct$|^indirect$|^no partner named$|\(blank partner\)/.test(n);
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

  function effectivenessBubbleSvg(partners) {
    const rows = partners.filter((p) => p.opportunityCount > 0 && (p.totalHours > 0 || p.closedCount > 0));
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
    const points = rows.map((p) => `<circle cx="${x(p.opportunityCount)}" cy="${y(p.totalHours)}" r="${r(p.oppsWithHours)}" fill="${winRateColor(p.winRate)}" fill-opacity="0.72" stroke="#fff" stroke-width="1.5" class="scatter-point"></circle>`).join('');
    const labels = top.map((p) => `<text x="${x(p.opportunityCount) + 8}" y="${y(p.totalHours) - 6}" class="chart-meta">${PD.escapeHtml(p.partnerGroup.length > 22 ? `${p.partnerGroup.slice(0, 20)}…` : p.partnerGroup)}</text>`).join('');
    const legend = `<g transform="translate(${pad.left + plotW - 160} ${pad.top})"><text class="chart-meta">Win rate</text><circle cx="8" cy="22" r="6" fill="#0d7a55"/><text x="20" y="26" class="chart-meta">≥35%</text><circle cx="8" cy="42" r="6" fill="#2563eb"/><text x="20" y="46" class="chart-meta">22–35%</text><circle cx="8" cy="62" r="6" fill="#b45309"/><text x="20" y="66" class="chart-meta">15–22%</text><circle cx="8" cy="82" r="6" fill="#b42318"/><text x="20" y="86" class="chart-meta">&lt;15%</text></g>`;
    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Partner effectiveness matrix">${gridX}${gridY}<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" class="scatter-axis"></line><line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" class="scatter-axis"></line>${points}${labels}${legend}<text x="${pad.left + plotW / 2}" y="${height - 6}" text-anchor="middle" class="axis-label">Opportunity count</text><text x="18" y="${pad.top + plotH / 2}" text-anchor="middle" class="axis-label" transform="rotate(-90 18 ${pad.top + plotH / 2})">SC hours</text></svg>`;
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
    return { key: ui.partnerSortKey, dir: ui.partnerSortKey === 'partnerGroup' ? 'asc' : 'desc' };
  }

  function getWatchlistPartners(d) {
    const partners = filterPartners(d.partnerSummary);
    return PD.sortRows(partners, { key: 'riskScore', dir: 'desc' }).slice(0, 12);
  }

  function directSummary(d) {
    return d.partnerSummary.find((p) => isNonPartner(p.partnerGroup)) || null;
  }

  function getL3Options() {
    return [...new Set((PD.state.model.opportunities || []).map((o) => o.region).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  function getL4Options(l3) {
    let opps = PD.state.model.opportunities || [];
    if (l3 && l3 !== 'all') opps = opps.filter((o) => o.region === l3);
    return [...new Set(opps.map((o) => o.subRegion).filter(Boolean))].sort((a, b) => a.localeCompare(b));
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
    const l3Current = $('#filter-l3').value || 'all';
    const l3Options = getL3Options();
    const l3Html = ['<option value="all">All regions</option>'].concat(l3Options.map((v) => `<option value="${PD.escapeHtml(v)}">${PD.escapeHtml(v)}</option>`)).join('');
    $('#filter-l3').innerHTML = l3Html;
    $('#filter-l3-scorecard').innerHTML = l3Html;
    if (l3Current !== 'all' && l3Options.includes(l3Current)) {
      $('#filter-l3').value = l3Current;
      $('#filter-l3-scorecard').value = l3Current;
    }

    const l3 = $('#filter-l3').value;
    const l4Current = $('#filter-l4').value || 'all';
    const l4Options = getL4Options(l3);
    const l4Html = ['<option value="all">All sub-regions</option>'].concat(l4Options.map((v) => `<option value="${PD.escapeHtml(v)}">${PD.escapeHtml(v)}</option>`)).join('');
    $('#filter-l4').innerHTML = l4Html;
    $('#filter-l4-scorecard').innerHTML = l4Html;
    if (l4Current !== 'all' && l4Options.includes(l4Current)) {
      $('#filter-l4').value = l4Current;
      $('#filter-l4-scorecard').value = l4Current;
    } else {
      $('#filter-l4').value = 'all';
      $('#filter-l4-scorecard').value = 'all';
    }
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
      <article class="kpi"><p class="label">SC hours (filtered)</p><p class="value">${PD.formatHours(d.kpis.totalHours)}</p><p class="sub">${PD.formatInt(d.kpis.opportunities)} opportunities in scope</p></article>
      <article class="kpi"><p class="label">Opps with SC time</p><p class="value">${pctWithHours}%</p><p class="sub">${PD.formatInt(d.kpis.oppsWithHours)} of ${PD.formatInt(d.kpis.opportunities)}</p></article>
      <article class="kpi"><p class="label">Closed win rate</p><p class="value">${d.kpis.winRate !== null ? PD.formatPercent(d.kpis.winRate) : '–'}</p><p class="sub">Won vs lost in filter</p></article>
      <article class="kpi"><p class="label">Active partners</p><p class="value">${PD.formatInt(partners.length)}</p><p class="sub">${PD.formatInt(withHours.length)} with SC hours</p></article>
    `;
    $('#overview-note').textContent = d.taskHoursTotal ? `${PD.formatPercent(d.taskHoursMatched / d.taskHoursTotal)} of task hours matched to opps` : '';
  }

  function renderCharts(d, partners) {
    const medians = computeMedians(partners);
    $('#chart-effectiveness').innerHTML = effectivenessBubbleSvg(partners);

    const hourItems = PD.sortRows(partners.filter((p) => p.totalHours > 0), { key: 'totalHours', dir: 'desc' }).slice(0, 10).map((p) => ({
      label: p.partnerGroup,
      meta: `${PD.formatInt(p.opportunityCount)} opps · ${PD.formatPercent(p.winRate)}`,
      value: p.totalHours,
      valueLabel: PD.formatHours(p.totalHours)
    }));
    $('#chart-partner-hours').innerHTML = barSvg(hourItems, 'Top partners by SC hours');

    const winItems = PD.sortRows(partners.filter((p) => p.closedCount >= 5 && p.winRate !== null), { key: 'winRate', dir: 'desc' }).slice(0, 10).map((p) => ({
      label: p.partnerGroup,
      meta: `${PD.formatInt(p.closedCount)} closed · ${PD.formatHours(p.totalHours)} SC`,
      value: p.winRate,
      valueLabel: PD.formatPercent(p.winRate)
    }));
    $('#chart-win-rate').innerHTML = barSvg(winItems, 'Win rate leaders');

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

    $('#chart-outcome').innerHTML = outcomeSvg(d.outcomeSummary);
    renderQuadrants(partners, medians);
  }

  function renderWatchlist(partners, medians) {
    const body = $('#watchlist-body');
    if (!partners.length) {
      body.innerHTML = '<tr><td colspan="6" class="muted">No partners match the current filter.</td></tr>';
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

  function renderScorecard(partners, medians) {
    const sorted = PD.sortRows(partners, partnerSortState());
    const body = $('#scorecard-body');
    body.innerHTML = sorted.map((p) => {
      const band = effectivenessBand(p, medians);
      return `<tr class="clickable" data-partner-key="${PD.escapeHtml(p.partnerKey)}">
        <td>${PD.escapeHtml(p.partnerGroup)}</td>
        <td>${bandHtml(band)}</td>
        <td>${PD.formatInt(p.opportunityCount)}</td>
        <td>${PD.formatInt(p.oppsWithHours)}</td>
        <td>${PD.formatHours(p.totalHours)}</td>
        <td>${p.avgHoursPerOpp !== null ? PD.formatHours(p.avgHoursPerOpp) : '–'}</td>
        <td>${PD.formatInt(p.wonCount)}</td>
        <td>${PD.formatInt(p.lostCount)}</td>
        <td>${PD.formatInt(p.openCount)}</td>
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
    const band = effectivenessBand(partner, medians);
    const opps = PD.sortRows(
      d.joined.filter((row) => (row.partnerKey || '') === key),
      { key: 'totalHours', dir: 'desc' }
    );
    const stages = PD.sortRows(PD.summarizeStages(opps), { key: 'totalHours', dir: 'desc' });
    const totalStageHrs = stages.reduce((s, r) => s + r.totalHours, 0);
    const activities = PD.sortRows(PD.summarizeActivities(
      (PD.state.model.tasks || []).filter((t) => opps.some((o) => o.opportunityKey === t.opportunityKey))
    ), { key: 'totalHours', dir: 'desc' });

    $('#detail-hero').innerHTML = `
      <h2>${PD.escapeHtml(partner.partnerGroup)} ${bandHtml(band)}</h2>
      <p>${PD.formatHours(partner.totalHours)} across ${PD.formatInt(partner.opportunityCount)} opportunities (${partner.avgHoursPerOpp !== null ? PD.formatHours(partner.avgHoursPerOpp) : '–'} per opp, ${PD.formatInt(partner.oppsWithHours)} with SC time). ${partner.winRate !== null ? `Win rate ${PD.formatPercent(partner.winRate)} (${PD.formatInt(partner.wonCount)} won / ${PD.formatInt(partner.closedCount)} closed).` : ''} ${PD.escapeHtml(partner.signal)}.</p>
    `;

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
      : '<tr><td colspan="3" class="muted">No task rows linked to this partner's opportunities.</td></tr>';

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
    `;
  }

  function renderAdmin() {
    const m = PD.state.model;
    const d = hasData() ? derived() : null;
    const matchRate = d && d.taskHoursTotal ? (d.taskHoursMatched / d.taskHoursTotal) : null;
    const regions = hasData() ? getL3Options().length : 0;

    $('#quality-body').innerHTML = hasData() ? `
      <tr><td>Files loaded</td><td><strong>${PD.formatInt((m.files || []).length)}</strong></td></tr>
      <tr><td>Opportunities</td><td>${PD.formatInt(m.baseStats.opportunitiesImported || m.opportunities.length)}</td></tr>
      <tr><td>Tasks (deduped)</td><td>${PD.formatInt(m.tasks.length)}</td></tr>
      <tr><td>L3 regions in export</td><td>${PD.formatInt(regions)}</td></tr>
      <tr><td>Task–opp match rate</td><td><strong>${matchRate !== null ? PD.formatPercent(matchRate) : '–'}</strong></td></tr>
      <tr><td>Unmatched task names</td><td>${PD.formatInt((m.unmatchedTaskAgg || []).length)}</td></tr>
    ` : '<tr><td colspan="2" class="muted">Load files to see diagnostics.</td></tr>';

    const unmatched = (m.unmatchedTaskAgg || []).slice(0, 15);
    $('#unmatched-body').innerHTML = unmatched.length
      ? unmatched.map((r) => `<tr><td>${PD.escapeHtml(r.opportunityName)}</td><td>${PD.formatHours(r.totalHours)}</td></tr>`).join('')
      : '<tr><td colspan="2" class="muted">None</td></tr>';

    $('#loaded-files').innerHTML = (m.files || []).length
      ? m.files.map((f) => `<li><strong>${PD.escapeHtml(f.fileName)}</strong><br><span class="muted">${PD.formatInt(f.taskRows)} tasks · ${PD.formatInt(f.oppRows + (f.mappedRows || 0))} opps</span></li>`).join('')
      : '<li class="muted">No files loaded yet.</li>';
  }

  function renderAll() {
    renderStatus();
    renderAdmin();

    if (!hasData()) {
      renderEmpty();
      return;
    }

    populateRegionFilters();

    if (ui.page === 'empty') ui.page = 'overview';

    const d = derived();
    const partners = filterPartners(d.partnerSummary);
    const medians = computeMedians(partners);
    const watch = getWatchlistPartners(d);

    if (ui.page === 'overview') {
      renderKpis(d, partners);
      renderInsight(d, watch);
      renderCharts(d, partners);
      renderWatchlist(watch, medians);
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
    renderAll();
  }

  function onRegionChange(fromScorecard) {
    if (!fromScorecard) {
      const l3 = $('#filter-l3').value;
      const l4Options = getL4Options(l3);
      const l4Html = ['<option value="all">All sub-regions</option>'].concat(l4Options.map((v) => `<option value="${PD.escapeHtml(v)}">${PD.escapeHtml(v)}</option>`)).join('');
      $('#filter-l4').innerHTML = l4Html;
      $('#filter-l4-scorecard').innerHTML = l4Html;
      $('#filter-l4').value = 'all';
      $('#filter-l4-scorecard').value = 'all';
      $('#filter-l3-scorecard').value = l3;
    } else {
      const l3 = $('#filter-l3-scorecard').value;
      const l4Options = getL4Options(l3);
      const l4Html = ['<option value="all">All sub-regions</option>'].concat(l4Options.map((v) => `<option value="${PD.escapeHtml(v)}">${PD.escapeHtml(v)}</option>`)).join('');
      $('#filter-l4-scorecard').innerHTML = l4Html;
      $('#filter-l4').innerHTML = l4Html;
      $('#filter-l4-scorecard').value = 'all';
      $('#filter-l4').value = 'all';
      $('#filter-l3').value = l3;
    }
    syncRegionFilters(fromScorecard);
    renderAll();
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
        window.alert('None of the uploaded files matched expected task or opportunity layouts.');
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
    const medians = computeMedians(partners);
    const sorted = PD.sortRows(partners, partnerSortState());
    const rows = sorted.map((p) => ({
      Partner: p.partnerGroup,
      Band: effectivenessBand(p, medians).label,
      Opportunities: p.opportunityCount,
      OppsWithHours: p.oppsWithHours,
      SCHours: p.totalHours,
      SCHoursPerOpp: p.avgHoursPerOpp,
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

    $('#filter-l3').addEventListener('change', () => onRegionChange(false));
    $('#filter-l4').addEventListener('change', () => { syncRegionFilters(false); renderAll(); });
    $('#filter-l3-scorecard').addEventListener('change', () => onRegionChange(true));
    $('#filter-l4-scorecard').addEventListener('change', () => { syncRegionFilters(true); renderAll(); });

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
