(function (global) {
  'use strict';

  const TEXT_DECODER = new TextDecoder('utf-8');

  const FILTERS = [
    { key: 'region', label: 'Region', level: 'opp' },
    { key: 'subRegion', label: 'Sub-region', level: 'opp' },
    { key: 'partnerName', label: 'Partner name', level: 'opp' },
    { key: 'partnerGroup', label: 'Partner grouping', level: 'opp' },
    { key: 'directIndirect', label: 'Direct / indirect', level: 'opp' },
    { key: 'opportunityOwner', label: 'Opportunity owner', level: 'opp' },
    { key: 'ownerRole', label: 'Owner role', level: 'opp' },
    { key: 'stage', label: 'Stage', level: 'opp' },
    { key: 'outcome', label: 'Outcome', level: 'opp' },
    { key: 'oppType', label: 'Opportunity type', level: 'opp' },
    { key: 'fiscalPeriod', label: 'Fiscal period', level: 'opp' },
    { key: 'closeYear', label: 'Close year', level: 'opp' },
    { key: 'accountName', label: 'Account', level: 'opp' },
    { key: 'assigned', label: 'Assigned consultant', level: 'task' },
    { key: 'activityType', label: 'Activity type', level: 'task' },
    { key: 'taskYear', label: 'Task year', level: 'task' },
    { key: 'learnerEmail', label: 'Learner email', level: 'learning' },
    { key: 'learningCourse', label: 'Learning course', level: 'learning' },
    { key: 'learningState', label: 'Learning state', level: 'learning' }
  ];


  const EMPTY_MODEL = {
    files: [],
    tasks: [],
    opportunities: [],
    learningRows: [],
    hasRawTasks: false,
    unmatchedTaskAgg: [],
    fuzzyTaskMatches: [],
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


  const state = {
    model: EMPTY_MODEL,
    derived: null,
    filters: {
      search: '',
      selections: Object.fromEntries(FILTERS.map((f) => [f.key, new Set()]))
    },
    ui: {
      loading: false,
      filterSearch: {},
      filterOpen: {},
      partnerSort: { key: 'totalHours', dir: 'desc' },
      oppSort: { key: 'totalHours', dir: 'desc' },
      learnerSort: { key: 'learningSeconds', dir: 'desc' }
    },
    __parsedFiles: []
  };

  function cleanText(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function keyify(value) {
    return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function slug(value) {
    return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  }
  function escapeHtml(value) {
    return cleanText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function formatInt(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '0';
    return Math.round(value).toLocaleString('en-GB');
  }
  function formatNumber(value, decimals) {
    if (value === null || value === undefined || Number.isNaN(value)) return '–';
    return Number(value).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
  function formatHours(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '–';
    return `${formatNumber(value, Math.abs(value) >= 100 ? 0 : 1)}h`;
  }
  function formatDuration(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '–';
    const seconds = Math.max(0, Math.round(Number(value) || 0));
    if (!seconds) return '0s';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (secs && parts.length < 2) parts.push(`${secs}s`);
    return parts.slice(0, 2).join(' ');
  }
  function formatPercent(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '–';
    return `${formatNumber(value * 100, 1)}%`;
  }
  function formatCurrency(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '–';
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(value);
  }
  function formatShortDate(value) {
    if (!value) return '–';
    const date = value instanceof Date ? value : parseDateValue(value);
    if (!date) return cleanText(value) || '–';
    return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  function percentile(values, p) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = (sorted.length - 1) * p;
    const low = Math.floor(idx);
    const high = Math.ceil(idx);
    if (low === high) return sorted[low];
    return sorted[low] + (sorted[high] - sorted[low]) * (idx - low);
  }
  function excelSerialToDate(serial) {
    const base = Date.UTC(1899, 11, 30);
    return new Date(base + Number(serial) * 86400000);
  }
  function parseDateValue(value) {
    if (!value && value !== 0) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 20000 && value < 60000) return excelSerialToDate(value);
      return null;
    }
    const text = cleanText(value);
    if (!text) return null;
    const direct = new Date(text);
    if (!Number.isNaN(direct.getTime())) return direct;
    const mdY = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (mdY) {
      const month = Number(mdY[1]) - 1;
      const day = Number(mdY[2]);
      const year = Number(mdY[3].length === 2 ? `20${mdY[3]}` : mdY[3]);
      const d = new Date(year, month, day);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }
  function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = cleanText(value);
    if (!text) return null;
    const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
    const normalised = text.replace(/[£$,()%\s]/g, '').replace(/,/g, '');
    if (!normalised) return null;
    const num = Number(normalised);
    if (Number.isNaN(num)) return null;
    return negative && num > 0 ? -num : num;
  }
  function parseBoolean(value) {
    const text = keyify(value);
    if (!text) return null;
    if (['true', 'yes', 'y', '1'].includes(text)) return true;
    if (['false', 'no', 'n', '0'].includes(text)) return false;
    return null;
  }
  function canonicalKey(value) {
    return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  const PARTNER_NAME_STOP_WORDS = new Set(['limited', 'ltd', 'plc', 'uk', 'holdings', 'business', 'services', 'service', 'group', 'inc', 'llc', 'gmbh', 'sa', 'bv', 'the', 'and', 'europe', 'international', 'solutions', 'technology', 'technologies', 'consulting', 'communications', 'telecommunications']);

  const INTERNAL_LEARNING_DOMAINS = new Set([
    'genesys.com',
    'seismic.com',
    'genesyslab.com'
  ]);

  const PARTNER_ALIASES = [
    { label: 'Accenture UK Limited', keys: ['accenture uk limited', 'accenture'] },
    { label: 'British Telecommunications PLC', keys: ['british telecommunications plc', 'bt', 'bt plc'] },
    { label: 'Sabio Ltd', keys: ['sabio ltd', 'sabio'] },
    { label: 'IP Integration Limited', keys: ['ip integration limited', 'ip integration'] },
    { label: 'Kerv Experience Limited', keys: ['kerv experience limited', 'kerv', 'kerv group'] },
    { label: 'Maintel Europe Limited', keys: ['maintel europe limited', 'maintel'] },
    { label: 'Connect Managed Services (UK) Limited', keys: ['connect managed services uk limited', 'connect managed services', 'connect', 'weconnect'] },
    { label: 'Capgemini UK PLC', keys: ['capgemini uk plc', 'capgemini'] }
  ];

  const customDomainPartnerMap = {};
  let autoDomainPartnerMap = {};
  let domainMappingReport = { autoMapped: [], ambiguous: [], unmapped: [] };

  function isNonPartnerGroup(name) {
    const n = cleanText(name).toLowerCase();
    return !n || /direct\s*\/?\s*no partner|indirect\s*\/?\s*no partner|end customer\s*\/?\s*no partner|^direct$|^indirect$|^no partner named$/.test(n);
  }

  function isChannelPartnerOpportunity(opp) {
    const partner = normalizePartnerLabel(opp.partnerName);
    if (!partner) return false;
    const route = saleRouteKind(opp.directIndirect);
    if (route === 'direct') return false;
    if (route === 'indirect') return true;
    const account = normalizePartnerLabel(opp.accountName);
    return Boolean(account && partner !== account);
  }

  function partnerCatalogFromOpportunities(opportunities) {
    const names = new Set();
    for (const opp of opportunities) {
      if (!isChannelPartnerOpportunity(opp)) continue;
      const label = normalizePartnerLabel(opp.partnerGroup || opp.partnerName);
      if (!label || isNonPartnerGroup(label)) continue;
      names.add(label);
    }
    return Array.from(names);
  }

  function significantPartnerTokens(partnerName) {
    return keyify(partnerName).split(' ').filter((token) => token.length >= 2 && !PARTNER_NAME_STOP_WORDS.has(token));
  }

  function domainStems(domain) {
    const parts = cleanText(domain).toLowerCase().split('.').filter((p) => p.length >= 2);
    const stems = new Set();
    if (parts[0]) stems.add(parts[0]);
    if (parts.length > 2 && parts[1].length >= 3) stems.add(parts[1]);
    return Array.from(stems);
  }

  function stemTokenScore(stem, partnerName) {
    const tokens = keyify(partnerName).split(' ').filter((t) => t.length >= 2);
    const sigTokens = significantPartnerTokens(partnerName);
    let score = 0;

    for (const token of tokens) {
      if (stem === token) score = Math.max(score, 95);
      else if (token.startsWith(stem) && stem.length >= 4) score = Math.max(score, 75 + Math.min(stem.length, 12));
      else if (stem.startsWith(token) && token.length >= 4) score = Math.max(score, 65 + Math.min(token.length, 10));
    }

    for (const token of sigTokens) {
      if (stem === token) score = Math.max(score, 90);
      else if (token.startsWith(stem) && stem.length >= 4) score = Math.max(score, 70 + Math.min(stem.length, 10));
      else if (stem.startsWith(token) && token.length >= 4) score = Math.max(score, 60 + Math.min(token.length, 8));
      else if (token.length >= 5 && stem.includes(token)) score = Math.max(score, 58 + Math.min(token.length, 10));
    }

    return score;
  }

  function scoreDomainToPartner(domain, partnerName) {
    const stems = domainStems(domain);
    if (!stems.length || !partnerName) return 0;
    return Math.max(...stems.map((stem) => stemTokenScore(stem, partnerName)));
  }

  function buildAutoDomainPartnerMap(opportunities, learningRows) {
    const partners = partnerCatalogFromOpportunities(opportunities);
    const domainStats = new Map();

    for (const row of learningRows) {
      const domain = cleanText(row.emailDomain).toLowerCase();
      if (!domain || INTERNAL_LEARNING_DOMAINS.has(domain)) continue;
      if (!domainStats.has(domain)) domainStats.set(domain, { learners: new Set(), learningSeconds: 0 });
      const stat = domainStats.get(domain);
      stat.learners.add(row.email);
      stat.learningSeconds += row.learningSeconds || 0;
    }

    const autoMapped = [];
    const ambiguous = [];
    const unmapped = [];
    const map = {};

    for (const [domain, stat] of domainStats.entries()) {
      const ranked = partners
        .map((partner) => ({ partner, score: scoreDomainToPartner(domain, partner) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);

      const entry = {
        domain,
        learners: stat.learners.size,
        learningSeconds: stat.learningSeconds,
        bestPartner: ranked[0] ? ranked[0].partner : '',
        bestScore: ranked[0] ? ranked[0].score : 0,
        runnerUp: ranked[1] ? `${ranked[1].partner} (${ranked[1].score})` : ''
      };

      if (!ranked.length) {
        unmapped.push(entry);
        continue;
      }

      const best = ranked[0];
      const second = ranked[1];
      const clearWinner = !second || (best.score >= 75 && best.score >= second.score + 15);

      if (clearWinner && best.score >= 60) {
        map[domain] = best.partner;
        autoMapped.push({ ...entry, partner: best.partner, confidence: best.score >= 85 ? 'high' : 'medium' });
      } else if (best.score >= 50) {
        ambiguous.push({ ...entry, alternatives: ranked.slice(0, 3).map((r) => `${r.partner} (${r.score})`).join('; ') });
        unmapped.push(entry);
      } else {
        unmapped.push(entry);
      }
    }

    autoMapped.sort((a, b) => b.learningSeconds - a.learningSeconds);
    ambiguous.sort((a, b) => b.learningSeconds - a.learningSeconds);
    unmapped.sort((a, b) => b.learningSeconds - a.learningSeconds);

    return { map, autoMapped, ambiguous, unmapped };
  }

  function resolvePartnerFromDomain(domain) {
    const key = cleanText(domain).toLowerCase();
    if (!key || INTERNAL_LEARNING_DOMAINS.has(key)) return '';
    if (customDomainPartnerMap[key]) return customDomainPartnerMap[key];
    if (autoDomainPartnerMap[key]) return autoDomainPartnerMap[key];
    return '';
  }

  function applyPartnerMappingRecord(record) {
    const partner = cleanText(pick(record, ['Partner Name', 'Partner', 'SFDC Partner Name', 'Sold To/Business Partner']));
    const domain = cleanText(pick(record, ['Email Domain', 'Domain', 'EMAIL_DOMAIN'])).toLowerCase();
    if (!partner || !domain) return false;
    customDomainPartnerMap[domain] = normalizePartnerLabel(partner);
    return true;
  }

  function remapLearningToPartners(learningRows, opportunities) {
    const catalog = partnerCatalogFromOpportunities(opportunities);
    for (const row of learningRows) {
      if (INTERNAL_LEARNING_DOMAINS.has(cleanText(row.emailDomain).toLowerCase())) {
        row.partnerGroup = 'Internal / Genesys or Seismic';
        row.partnerKey = partnerJoinKey(row.partnerGroup);
        row.mappedPartner = row.partnerGroup;
        row.mappingSource = 'internal-domain';
        continue;
      }

      const explicit = normalizePartnerLabel(row.mappedPartner || '');
      if (explicit && catalog.includes(explicit)) {
        row.partnerGroup = explicit;
        row.partnerKey = partnerJoinKey(explicit);
        row.mappingSource = row.mappingSource || 'learning-export';
        continue;
      }

      const inferred = resolvePartnerFromDomain(row.emailDomain);
      if (inferred) {
        row.partnerGroup = inferred;
        row.partnerKey = partnerJoinKey(inferred);
        row.mappedPartner = inferred;
        row.mappingSource = customDomainPartnerMap[row.emailDomain] ? 'manual-domain-map' : 'auto-domain-map';
        continue;
      }

      row.partnerGroup = 'Unmapped learning partner';
      row.partnerKey = partnerJoinKey(row.partnerGroup);
      row.mappingSource = 'unmapped';
    }
  }
  function normalizePartnerLabel(value) {
    const text = cleanText(value);
    if (!text) return '';
    const key = keyify(text);
    for (const alias of PARTNER_ALIASES) {
      if (alias.keys.some((candidate) => key === candidate || key.includes(candidate) || candidate.includes(key))) return alias.label;
    }
    return text;
  }
  function partnerJoinKey(value) {
    return canonicalKey(normalizePartnerLabel(value));
  }

  function pick(record, candidates) {
    if (!record || typeof record !== 'object') return '';
    if (!record.__keyMap) {
      const map = new Map();
      for (const key of Object.keys(record)) map.set(canonicalKey(key), key);
      Object.defineProperty(record, '__keyMap', { value: map, enumerable: false, configurable: true });
    }
    for (const candidate of candidates) {
      const realKey = record.__keyMap.get(canonicalKey(candidate));
      if (!realKey) continue;
      const value = record[realKey];
      if (cleanText(value) !== '') return value;
    }
    return '';
  }
  function saleRouteKind(directIndirect) {
    const di = keyify(directIndirect);
    if (di.includes('indirect')) return 'indirect';
    if (di.includes('direct')) return 'direct';
    return '';
  }

  function partnerGroup(partnerName, directIndirect, accountName) {
    const partner = normalizePartnerLabel(partnerName);
    const route = saleRouteKind(directIndirect);
    const account = normalizePartnerLabel(accountName);

    if (route === 'direct') return 'Direct / No partner';

    if (route === 'indirect') {
      if (partner) return partner;
      return 'Indirect / No partner named';
    }

    if (partner) {
      if (account && partner === account) return 'End customer / No partner';
      return partner;
    }

    return 'No partner named';
  }
  function outcomeFromStage(stage, probability) {
    const s = keyify(stage);
    const p = toNumber(probability);
    if (!s) return 'Unknown';
    if (s.includes('won')) return 'Won';
    if (s.includes('lost')) return 'Lost';
    if (s === 'closed' || s.startsWith('closed ')) {
      if (p !== null && p >= 1) return 'Won';
      if (p !== null && p <= 0) return 'Lost';
      return 'Unknown';
    }
    return 'Open';
  }
  function normaliseOpportunityKey(value) {
    return cleanText(value).toLowerCase();
  }

  const OPPORTUNITY_TOKEN_STOP = new Set([
    'the', 'and', 'for', 'with', 'new', 'all', 'dev', 'phase', 'tender', 'ccaa', 'saas', 'opp', 'opportunity'
  ]);

  function opportunityTokens(name) {
    return new Set(
      cleanText(name).toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((token) => token.length >= 3 && !OPPORTUNITY_TOKEN_STOP.has(token))
    );
  }

  function scoreOpportunityMatch(taskName, oppName, oppPartner) {
    const taskTokens = opportunityTokens(taskName);
    const oppTokens = opportunityTokens(oppName);
    if (!taskTokens.size || !oppTokens.size) return 0;
    let shared = 0;
    for (const token of taskTokens) {
      if (oppTokens.has(token)) shared += 1;
    }
    if (shared < 2) return 0;
    const union = new Set([...taskTokens, ...oppTokens]).size;
    let score = shared / union;
    const taskLower = cleanText(taskName).toLowerCase();
    const partnerLower = cleanText(oppPartner).toLowerCase();
    if (partnerLower) {
      for (const part of partnerLower.split(/[^a-z0-9]+/)) {
        if (part.length >= 3 && taskLower.includes(part)) score += 0.12;
      }
    }
    const anchor = [...taskTokens][0];
    if (anchor && oppTokens.has(anchor) && anchor.length >= 4) score += 0.08;
    return score;
  }

  function buildOpportunityTokenIndex(opportunities) {
    const index = new Map();
    for (const opp of opportunities) {
      const tokens = opportunityTokens(opp.opportunityName);
      for (const token of tokens) {
        if (!index.has(token)) index.set(token, []);
        index.get(token).push(opp);
      }
    }
    return index;
  }

  function findFuzzyOpportunityMatch(taskName, opportunities, tokenIndex) {
    const taskTokens = opportunityTokens(taskName);
    if (!taskTokens.size) return null;
    const candidates = new Map();
    for (const token of taskTokens) {
      for (const opp of (tokenIndex?.get(token) || [])) {
        candidates.set(opp.opportunityKey, opp);
      }
    }
    const pool = candidates.size ? Array.from(candidates.values()) : opportunities;
    let best = null;
    let bestScore = 0;
    for (const opp of pool) {
      const score = scoreOpportunityMatch(taskName, opp.opportunityName, opp.partnerGroup || opp.partnerName);
      if (score > bestScore) {
        bestScore = score;
        best = opp;
      }
    }
    if (best && bestScore >= 0.35) return { opp: best, score: bestScore };
    return null;
  }

  function mergeTaskAggRow(target, source) {
    target.totalHours += source.totalHours || 0;
    target.taskCount += source.taskCount || 0;
    for (const name of source.consultants || []) target.consultants.add(name);
    for (const [activity, hours] of (source.activityHours || new Map()).entries()) {
      target.activityHours.set(activity, (target.activityHours.get(activity) || 0) + hours);
    }
    if (source.latestTaskDate && (!target.latestTaskDate || source.latestTaskDate > target.latestTaskDate)) {
      target.latestTaskDate = source.latestTaskDate;
    }
    if (source.earliestTaskDate && (!target.earliestTaskDate || source.earliestTaskDate < target.earliestTaskDate)) {
      target.earliestTaskDate = source.earliestTaskDate;
    }
  }

  function reconcileTaskAggregation(taskAgg, opportunities) {
    const oppKeys = new Set(opportunities.map((o) => o.opportunityKey));
    const tokenIndex = buildOpportunityTokenIndex(opportunities);
    const remapped = new Map();
    const fuzzyMatches = [];
    const taskKeyAliases = new Map();

    function ensureRow(key, name) {
      if (!remapped.has(key)) {
        remapped.set(key, {
          opportunityKey: key,
          opportunityName: name,
          totalHours: 0,
          taskCount: 0,
          consultants: new Set(),
          activityHours: new Map(),
          latestTaskDate: null,
          earliestTaskDate: null
        });
      }
      return remapped.get(key);
    }

    for (const agg of taskAgg.values()) {
      if (oppKeys.has(agg.opportunityKey)) {
        taskKeyAliases.set(agg.opportunityKey, agg.opportunityKey);
        const row = ensureRow(agg.opportunityKey, agg.opportunityName);
        mergeTaskAggRow(row, agg);
        continue;
      }
      const match = findFuzzyOpportunityMatch(agg.opportunityName, opportunities, tokenIndex);
      if (match) {
        taskKeyAliases.set(agg.opportunityKey, match.opp.opportunityKey);
        fuzzyMatches.push({
          taskOpportunityName: agg.opportunityName,
          matchedOpportunityName: match.opp.opportunityName,
          matchedPartner: match.opp.partnerGroup,
          totalHours: agg.totalHours,
          taskCount: agg.taskCount,
          score: match.score
        });
        const row = ensureRow(match.opp.opportunityKey, match.opp.opportunityName);
        mergeTaskAggRow(row, agg);
        continue;
      }
      taskKeyAliases.set(agg.opportunityKey, agg.opportunityKey);
      const row = ensureRow(agg.opportunityKey, agg.opportunityName);
      mergeTaskAggRow(row, agg);
    }

    for (const opp of opportunities) {
      if (!remapped.has(opp.opportunityKey)) {
        remapped.set(opp.opportunityKey, {
          opportunityKey: opp.opportunityKey,
          opportunityName: opp.opportunityName,
          totalHours: 0,
          taskCount: 0,
          consultants: new Set(),
          activityHours: new Map(),
          latestTaskDate: null,
          earliestTaskDate: null
        });
      } else {
        remapped.get(opp.opportunityKey).opportunityName = opp.opportunityName;
      }
    }

    fuzzyMatches.sort((a, b) => b.totalHours - a.totalHours);
    return { taskAgg: remapped, fuzzyMatches, taskKeyAliases };
  }

  function readText(bytes) {
    const list = ['utf-8', 'windows-1252'];
    for (const enc of list) {
      try {
        const decoder = new TextDecoder(enc);
        const text = decoder.decode(bytes);
        if (/<(?:html|table|worksheet|workbook|sheetData|workbook)/i.test(text) || /<\?xml/i.test(text)) return text;
      } catch (err) {
      }
    }
    return TEXT_DECODER.decode(bytes);
  }

  function isZip(bytes) {
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  }
  function uint16(view, offset) { return view.getUint16(offset, true); }
  function uint32(view, offset) { return view.getUint32(offset, true); }
  function resolveZipPath(base, target) {
    if (!target) return '';
    const cleanTarget = String(target).replace(/^\/+/, '');
    if (/^[A-Za-z]:/.test(cleanTarget)) return cleanTarget;
    if (cleanTarget.startsWith('xl/')) return cleanTarget;
    const parts = base.split('/').slice(0, -1);
    for (const part of cleanTarget.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/');
  }
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'undefined') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const out = await new Response(stream).arrayBuffer();
      return new Uint8Array(out);
    }
    if (typeof require !== 'undefined') {
      try {
        const zlib = require('zlib');
        return new Uint8Array(zlib.inflateRawSync(Buffer.from(bytes)));
      } catch (err) {
      }
    }
    throw new Error('Offline XLSX decompression is not available in this browser. Please use a current Chromium-based browser.');
  }
  async function unzipEntries(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocdOffset = -1;
    for (let i = bytes.byteLength - 22; i >= Math.max(0, bytes.byteLength - 66000); i -= 1) {
      if (uint32(view, i) === 0x06054b50) { eocdOffset = i; break; }
    }
    if (eocdOffset < 0) throw new Error('Could not locate the XLSX ZIP directory.');
    const totalEntries = uint16(view, eocdOffset + 10);
    const cdOffset = uint32(view, eocdOffset + 16);
    let ptr = cdOffset;
    const entries = [];
    for (let i = 0; i < totalEntries; i += 1) {
      if (uint32(view, ptr) !== 0x02014b50) throw new Error('Corrupt ZIP entry inside the XLSX file.');
      const compression = uint16(view, ptr + 10);
      const compressedSize = uint32(view, ptr + 20);
      const nameLength = uint16(view, ptr + 28);
      const extraLength = uint16(view, ptr + 30);
      const commentLength = uint16(view, ptr + 32);
      const localHeaderOffset = uint32(view, ptr + 42);
      const name = TEXT_DECODER.decode(bytes.slice(ptr + 46, ptr + 46 + nameLength));
      entries.push({ name, compression, compressedSize, localHeaderOffset });
      ptr += 46 + nameLength + extraLength + commentLength;
    }
    const out = new Map();
    for (const entry of entries) {
      const local = entry.localHeaderOffset;
      if (uint32(view, local) !== 0x04034b50) continue;
      const nameLength = uint16(view, local + 26);
      const extraLength = uint16(view, local + 28);
      const dataStart = local + 30 + nameLength + extraLength;
      const compressed = bytes.slice(dataStart, dataStart + entry.compressedSize);
      if (entry.compression === 0) out.set(entry.name, compressed);
      else if (entry.compression === 8) out.set(entry.name, await inflateRaw(compressed));
    }
    return out;
  }
  function decodeXmlEntities(text) {
    return String(text || '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
  }
  function attrValue(attrs, name) {
    const pattern = new RegExp(`${name}="([^"]*)"`, 'i');
    const match = String(attrs || '').match(pattern);
    return match ? decodeXmlEntities(match[1]) : '';
  }
  function columnIndexFromRef(ref) {
    const match = String(ref || '').match(/[A-Z]+/i);
    if (!match) return 0;
    let out = 0;
    const letters = match[0].toUpperCase();
    for (let i = 0; i < letters.length; i += 1) out = (out * 26) + (letters.charCodeAt(i) - 64);
    return out - 1;
  }
  function trimRow(row) {
    const out = Array.isArray(row) ? [...row] : [];
    while (out.length && (out[out.length - 1] === '' || out[out.length - 1] === null || out[out.length - 1] === undefined)) out.pop();
    return out;
  }
  function parseSharedStrings(xmlText) {
    if (!xmlText) return [];
    const matches = xmlText.match(/<si[\s\S]*?<\/si>/g) || [];
    return matches.map((node) => {
      const chunks = [];
      const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
      let m;
      while ((m = re.exec(node))) chunks.push(decodeXmlEntities(m[1]));
      return chunks.join('');
    });
  }
  function parseWorkbookSheetDefs(xmlText) {
    const sheets = [];
    const re = /<sheet\b([^>]*)\/?>(?:<\/sheet>)?/g;
    let match;
    while ((match = re.exec(xmlText))) {
      const attrs = match[1] || '';
      sheets.push({ name: attrValue(attrs, 'name') || 'Sheet', rid: attrValue(attrs, 'r:id') || attrValue(attrs, 'id') });
    }
    return sheets;
  }
  function parseRelationships(xmlText) {
    const map = new Map();
    const re = /<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g;
    let match;
    while ((match = re.exec(xmlText))) {
      const attrs = match[1] || '';
      map.set(attrValue(attrs, 'Id') || attrValue(attrs, 'id'), attrValue(attrs, 'Target'));
    }
    return map;
  }
  function parseSheetRows(xmlText, sharedStrings) {
    const rows = [];
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rowMatch;
    while ((rowMatch = rowRe.exec(xmlText))) {
      const rowXml = rowMatch[1] || '';
      const row = [];
      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowXml))) {
        const attrs = cellMatch[1] || '';
        const inner = cellMatch[2] || '';
        const index = columnIndexFromRef(attrValue(attrs, 'r'));
        const type = attrValue(attrs, 't');
        let value = '';
        if (type === 's') {
          const m = inner.match(/<v>([\s\S]*?)<\/v>/);
          const idx = m ? Number(m[1]) : NaN;
          value = Number.isFinite(idx) ? (sharedStrings[idx] || '') : '';
        } else if (type === 'inlineStr') {
          const chunks = [];
          const reT = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
          let t;
          while ((t = reT.exec(inner))) chunks.push(decodeXmlEntities(t[1]));
          value = chunks.join('');
        } else if (type === 'b') {
          const m = inner.match(/<v>([\s\S]*?)<\/v>/);
          value = !!m && m[1] === '1';
        } else {
          const m = inner.match(/<v>([\s\S]*?)<\/v>/);
          value = m ? decodeXmlEntities(m[1]) : '';
        }
        row[index] = value;
      }
      rows.push(trimRow(row));
    }
    return rows;
  }
  function uniqueHeaders(headers) {
    const seen = new Map();
    return headers.map((header, i) => {
      const text = cleanText(header) || `__col_${i + 1}`;
      const key = canonicalKey(text) || `col_${i + 1}`;
      const count = (seen.get(key) || 0) + 1;
      seen.set(key, count);
      return count === 1 ? text : `${text} ${count}`;
    });
  }
  function rowToRecord(headers, row) {
    const record = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i];
      if (!key || key.startsWith('__col_')) continue;
      record[key] = row[i] === undefined ? '' : row[i];
    }
    return record;
  }
  function isMeaningfulRecord(record) {
    return Object.values(record).some((value) => cleanText(value) !== '');
  }
  function detectExtractType(rows, sheetName, fileName) {
    const limit = Math.min(rows.length, 30);
    for (let i = 0; i < limit; i += 1) {
      const keys = rows[i].map((cell) => keyify(cell)).filter(Boolean);
      if (!keys.length) continue;
      if (keys.includes('opportunity') && keys.includes('duration in hours') && keys.includes('assigned')) {
        return { type: 'tasks', headerRowIndex: i };
      }
      if ((keys.includes('opportunity name') || keys.includes('opportunity')) && keys.includes('total hours')) {
        return { type: 'mapped', headerRowIndex: i };
      }
      if ((keys.includes('opportunity name') || keys.includes('opportunity')) && keys.includes('stage') && (keys.includes('opportunity owner') || keys.includes('owner role') || keys.includes('account name'))) {
        return { type: 'opportunities', headerRowIndex: i };
      }
      if (keys.includes('email') && keys.includes('timespent') && (keys.includes('lessontitle') || keys.includes('lesson title'))) {
        return { type: 'learning', headerRowIndex: i };
      }
      if ((keys.includes('email domain') || keys.includes('domain')) && (keys.includes('partner name') || keys.includes('partner'))) {
        return { type: 'partnerMap', headerRowIndex: i };
      }
    }
    const name = `${fileName} ${sheetName}`.toLowerCase();
    if (name.includes('tasks')) return { type: 'tasks', headerRowIndex: 0 };
    if (name.includes('opportunit')) return { type: 'opportunities', headerRowIndex: 0 };
    if (name.includes('learning') || name.includes('seismic') || name.includes('lesson')) return { type: 'learning', headerRowIndex: 0 };
    if (name.includes('partner') && name.includes('map')) return { type: 'partnerMap', headerRowIndex: 0 };
    return null;
  }

  function extractRecordsFromRows(rows, sheetName, fileName) {
    const detected = detectExtractType(rows, sheetName, fileName);
    if (!detected) return null;
    const headerRow = uniqueHeaders(rows[detected.headerRowIndex] || []);
    const records = [];
    for (let i = detected.headerRowIndex + 1; i < rows.length; i += 1) {
      const record = rowToRecord(headerRow, rows[i] || []);
      if (!isMeaningfulRecord(record)) continue;
      records.push(record);
    }
    return { type: detected.type, sheetName, records };
  }
  async function parseXlsxBuffer(buffer, fileName) {
    const entries = await unzipEntries(buffer);
    const workbookXml = readText(entries.get('xl/workbook.xml') || new Uint8Array());
    const relsXml = readText(entries.get('xl/_rels/workbook.xml.rels') || new Uint8Array());
    if (!workbookXml || !relsXml) throw new Error('This XLSX file is missing workbook metadata.');
    const sharedStrings = parseSharedStrings(entries.has('xl/sharedStrings.xml') ? readText(entries.get('xl/sharedStrings.xml')) : '');
    const relMap = parseRelationships(relsXml);
    const sheets = [];
    for (const sheet of parseWorkbookSheetDefs(workbookXml)) {
      const target = relMap.get(sheet.rid);
      if (!target) continue;
      const path = resolveZipPath('xl/workbook.xml', target);
      if (!entries.has(path)) continue;
      const rows = parseSheetRows(readText(entries.get(path)), sharedStrings);
      sheets.push({ sheetName: sheet.name, rows });
    }
    const extracted = sheets.map((sheet) => extractRecordsFromRows(sheet.rows, sheet.sheetName, fileName)).filter(Boolean);
    return { fileName, sheetsParsed: sheets.length, extracted, recognized: extracted.length > 0 };
  }
  function stripTags(html) {
    return decodeXmlEntities(String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '));
  }
  function parseHtmlWorkbook(buffer, fileName) {
    const html = readText(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
    const sheets = [];
    if (typeof DOMParser !== 'undefined') {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const tables = Array.from(doc.querySelectorAll('table'));
      for (let idx = 0; idx < tables.length; idx += 1) {
        const table = tables[idx];
        sheets.push({
          sheetName: table.getAttribute('data-sheet-name') || table.getAttribute('name') || `Sheet ${idx + 1}`,
          rows: Array.from(table.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((td) => cleanText(td.textContent || '')))
        });
      }
    } else {
      const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
      let tableMatch; let idx = 0;
      while ((tableMatch = tableRe.exec(html))) {
        idx += 1;
        const tableHtml = tableMatch[1] || '';
        const rows = [];
        const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
        let rowMatch;
        while ((rowMatch = rowRe.exec(tableHtml))) {
          const cellHtml = rowMatch[1] || '';
          const cells = [];
          const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
          let cellMatch;
          while ((cellMatch = cellRe.exec(cellHtml))) cells.push(cleanText(stripTags(cellMatch[1])));
          rows.push(cells);
        }
        sheets.push({ sheetName: `Sheet ${idx}`, rows });
      }
    }
    const extracted = sheets.map((sheet) => extractRecordsFromRows(sheet.rows, sheet.sheetName, fileName)).filter(Boolean);
    return { fileName, sheetsParsed: sheets.length, extracted, recognized: extracted.length > 0 };
  }
  function parseCsvText(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 1; }
          else inQuotes = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell); cell = '';
      } else if (ch === '\n') {
        row.push(cell); rows.push(row); row = []; cell = '';
      } else if (ch === '\r') {
        if (text[i + 1] === '\n') continue;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    if (row.length > 1 || cleanText(row[0])) rows.push(row);
    if (rows.length && typeof rows[0][0] === 'string') rows[0][0] = rows[0][0].replace(/^\ufeff/, '');
    return rows.map((r) => trimRow(r));
  }
  function parseCsvBuffer(buffer, fileName) {
    const text = readText(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));
    const rows = parseCsvText(text);
    const extract = extractRecordsFromRows(rows, 'CSV', fileName);
    return { fileName, sheetsParsed: 1, extracted: extract ? [extract] : [], recognized: !!extract };
  }
  async function parseSpreadsheetBuffer(buffer, fileName) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (isZip(bytes)) return parseXlsxBuffer(bytes, fileName);
    const text = readText(bytes);
    if (/\.csv$/i.test(fileName || '')) return parseCsvBuffer(bytes, fileName);
    if (/<table/i.test(text) || /<html/i.test(text)) return parseHtmlWorkbook(bytes, fileName);
    if (/,/.test(text) && /\n/.test(text)) return parseCsvBuffer(bytes, fileName);
    throw new Error(`Unsupported file format for ${fileName}.`);
  }


  function normalizeTask(record, extract) {
    const opportunityName = cleanText(pick(record, ['Opportunity', 'Opportunity Name', 'Related To']));
    if (!opportunityName) return null;
    const taskDate = parseDateValue(pick(record, ['Date', 'Activity Date', 'Task Date']));
    const hours = toNumber(pick(record, ['Duration in Hours', 'Hours', 'Total Hours'])) || 0;
    const assigned = cleanText(pick(record, ['Assigned', 'Task Owner', 'Owner', 'Assigned To']));
    const subject = cleanText(pick(record, ['Subject', 'Task Subject']));
    const activityType = cleanText(pick(record, ['Activity Type', 'Type', 'Task Type']));
    const accountName = cleanText(pick(record, ['Company / Account', 'Account Name', 'Account']));
    const opportunityKey = normaliseOpportunityKey(opportunityName);
    return {
      sourceFile: extract.fileName,
      opportunityName,
      opportunityKey,
      accountName,
      assigned,
      subject,
      activityType,
      relatedTo: cleanText(pick(record, ['Related To'])),
      taskDate,
      taskYear: taskDate ? String(taskDate.getFullYear()) : '',
      hours,
      dedupe: [
        opportunityKey,
        assigned.toLowerCase(),
        subject.toLowerCase(),
        activityType.toLowerCase(),
        hours,
        taskDate ? taskDate.toISOString().slice(0, 10) : '',
        accountName.toLowerCase()
      ].join('|')
    };
  }
  function normalizeOpportunity(record, extract) {
    const opportunityName = cleanText(pick(record, ['Opportunity Name', 'Opportunity', 'Opp Name', 'OpportunityName']));
    if (!opportunityName) return null;
    const probability = toNumber(pick(record, ['Probability (%)', 'Probability']));
    const directIndirect = cleanText(pick(record, ['Direct/Indirect Sale', 'Direct / Indirect Sale', 'DirectIndirect', 'Direct/Indirect']));
    const rawPartnerName = cleanText(pick(record, ['Sold To/Business Partner', 'Sold To / Business Partner', 'Business Partner', 'Partner', 'Partner Name']));
    const partnerName = normalizePartnerLabel(rawPartnerName);
    const bookingValue = toNumber(pick(record, ['Gross ACV Booking', 'Booking Value', 'Gross ACV', 'ACV Booking']));
    const totalAmount = toNumber(pick(record, ['Total Amount', 'Amount', 'Value']));
    const closeDate = parseDateValue(pick(record, ['Close Date', 'CloseDate']));
    const createdDate = parseDateValue(pick(record, ['Created Date', 'CreatedDate']));
    const stage = cleanText(pick(record, ['Stage', 'Stage Name']));
    const accountName = cleanText(pick(record, ['Account Name', 'Company / Account', 'Account']));
    const groupedPartner = partnerGroup(partnerName, directIndirect, accountName);
    return {
      sourceFile: extract.fileName,
      opportunityKey: normaliseOpportunityKey(opportunityName),
      opportunityName,
      accountName,
      ownerRole: cleanText(pick(record, ['Owner Role', 'Opp Owner Role'])),
      opportunityOwner: cleanText(pick(record, ['Opportunity Owner', 'Owner', 'Opp Owner'])),
      stage,
      outcome: outcomeFromStage(stage, probability),
      fiscalPeriod: cleanText(pick(record, ['Fiscal Period', 'Fiscal Quarter'])),
      closeDate,
      closeYear: closeDate ? String(closeDate.getFullYear()) : '',
      createdDate,
      oppType: cleanText(pick(record, ['Type'])),
      leadSource: cleanText(pick(record, ['Lead Source'])),
      nextStep: cleanText(pick(record, ['Next Step'])),
      directIndirect,
      partnerName,
      partnerGroup: groupedPartner,
      partnerKey: partnerJoinKey(groupedPartner),
      region: cleanText(pick(record, ['L3 - Region', 'Region', 'Sales Region', 'Geo', 'Area'])),
      subRegion: cleanText(pick(record, ['Subregion L4', 'Sub-Region', 'Sub Region', 'Subregion', 'Territory'])),
      industrySector: cleanText(pick(record, ['Industry Sector', 'Industry'])),
      industryVertical: cleanText(pick(record, ['Industry Vertical', 'Vertical'])),
      partnerTier: cleanText(pick(record, ['Partner Tier', 'Tier'])),
      solutionConsultant: cleanText(pick(record, ['Solution Consultant', 'SC'])),
      probability,
      age: toNumber(pick(record, ['Age'])),
      totalAmount,
      bookingValue,
      seedHours: toNumber(pick(record, ['Total Hours'])) || 0
    };
  }
  function normalizeLearning(record, extract) {
    const email = cleanText(pick(record, ['EMAIL', 'Email', 'User Email'])).toLowerCase();
    if (!email) return null;
    const courseTitle = cleanText(pick(record, ['LESSONTITLE', 'Lesson Title', 'Course', 'Course Title', 'Title']));
    const emailDomain = (cleanText(pick(record, ['EMAIL_DOMAIN', 'Email Domain'])) || (email.includes('@') ? email.split('@').pop() : '')).toLowerCase();
    const explicitPartner = cleanText(pick(record, ['MAPPED_PARTNER', 'SFDC_PARTNER_NAME', 'Partner', 'Partner Name']));
    const mappedPartnerRaw = explicitPartner;
    const partnerGroupName = explicitPartner ? normalizePartnerLabel(explicitPartner) : 'Unmapped learning partner';
    const partnerKey = partnerJoinKey(partnerGroupName) || canonicalKey(partnerGroupName);
    const seconds = Math.max(0, toNumber(pick(record, ['TIMESPENT_SECONDS', 'TIMESPENT', 'Time Spent Seconds', 'Time Spent'])) || 0);
    const engagedFlag = seconds > 0 || parseBoolean(pick(record, ['ENGAGED_FLAG'])) === true;
    const openedOnlyFlag = parseBoolean(pick(record, ['OPENED_ONLY_FLAG'])) === true || !engagedFlag;
    const fullName = cleanText(pick(record, ['FULLNAME', 'Full Name', 'Name', 'Learner']));
    const occurredYear = cleanText(pick(record, ['Years in OCCURREDAT', 'Occurred Year', 'Year']));
    return {
      sourceFile: extract.fileName,
      fullName,
      email,
      learnerEmail: email,
      emailDomain,
      courseTitle,
      learningCourse: courseTitle,
      learningSeconds: seconds,
      learningState: engagedFlag ? 'Engaged' : 'Opened only',
      engagedFlag,
      openedOnlyFlag,
      partnerGroup: partnerGroupName,
      partnerKey,
      mappedPartner: normalizePartnerLabel(mappedPartnerRaw),
      mappingConfidence: cleanText(pick(record, ['MAPPING_CONFIDENCE', 'Mapping Confidence'])),
      mappingNote: cleanText(pick(record, ['MAPPING_NOTE', 'Mapping Note'])),
      partnerInOppExport: parseBoolean(pick(record, ['PARTNER_IN_OPP_EXPORT'])) === true,
      occurredYear,
      dedupe: [email, courseTitle.toLowerCase(), occurredYear, Math.round(seconds), partnerKey].join('|')
    };
  }
  function mergeOpportunity(a, b) {
    if (!a) return { ...b, sourceFiles: [b.sourceFile] };
    const out = { ...a };
    const files = new Set([...(a.sourceFiles || [a.sourceFile]), b.sourceFile]);
    for (const [k, v] of Object.entries(b)) {
      if (v === null || v === undefined || v === '') continue;
      if (out[k] === null || out[k] === undefined || out[k] === '') out[k] = v;
      else if ((k === 'bookingValue' || k === 'totalAmount') && Math.abs(v) > Math.abs(out[k])) out[k] = v;
      else if (k === 'seedHours' && v > out[k]) out[k] = v;
    }
    out.sourceFiles = Array.from(files);
    return out;
  }

  function aggregateTasks(tasks) {
    const map = new Map();
    for (const task of tasks) {
      if (!map.has(task.opportunityKey)) {
        map.set(task.opportunityKey, {
          opportunityKey: task.opportunityKey,
          opportunityName: task.opportunityName,
          totalHours: 0,
          taskCount: 0,
          consultants: new Set(),
          activityHours: new Map(),
          latestTaskDate: null,
          earliestTaskDate: null
        });
      }
      const row = map.get(task.opportunityKey);
      row.totalHours += task.hours || 0;
      row.taskCount += 1;
      if (task.assigned) row.consultants.add(task.assigned);
      if (task.activityType) row.activityHours.set(task.activityType, (row.activityHours.get(task.activityType) || 0) + (task.hours || 0));
      if (task.taskDate) {
        if (!row.latestTaskDate || task.taskDate > row.latestTaskDate) row.latestTaskDate = task.taskDate;
        if (!row.earliestTaskDate || task.taskDate < row.earliestTaskDate) row.earliestTaskDate = task.taskDate;
      }
    }
    return map;
  }
  function aggregateSeed(opportunities) {
    const map = new Map();
    for (const opp of opportunities) {
      map.set(opp.opportunityKey, {
        opportunityKey: opp.opportunityKey,
        opportunityName: opp.opportunityName,
        totalHours: opp.seedHours || 0,
        taskCount: opp.seedHours ? 1 : 0,
        consultants: new Set(),
        activityHours: new Map(),
        latestTaskDate: null,
        earliestTaskDate: null
      });
    }
    return map;
  }
  function aggregateLearningByPartner(rows) {
    const map = new Map();
    for (const row of rows) {
      const key = row.partnerKey || canonicalKey(row.partnerGroup || 'Unmapped learning partner');
      if (!map.has(key)) {
        map.set(key, {
          partnerKey: key,
          partnerGroup: row.partnerGroup || 'Unmapped learning partner',
          learningSeconds: 0,
          recordCount: 0,
          learners: new Set(),
          engagedLearners: new Set(),
          courses: new Set()
        });
      }
      const out = map.get(key);
      out.learningSeconds += row.learningSeconds || 0;
      out.recordCount += 1;
      if (row.email) out.learners.add(row.email);
      if (row.engagedFlag && row.email) out.engagedLearners.add(row.email);
      if (row.courseTitle) out.courses.add(row.courseTitle);
    }
    const finalMap = new Map();
    for (const [key, row] of map.entries()) {
      finalMap.set(key, {
        partnerKey: key,
        partnerGroup: row.partnerGroup,
        learningSeconds: row.learningSeconds,
        recordCount: row.recordCount,
        learnerCount: row.learners.size,
        engagedLearnerCount: row.engagedLearners.size,
        courseCount: row.courses.size,
        openedOnlyLearnerCount: Math.max(0, row.learners.size - row.engagedLearners.size)
      });
    }
    return finalMap;
  }

  function buildDataModel(parsedFiles) {
    Object.keys(customDomainPartnerMap).forEach((key) => { delete customDomainPartnerMap[key]; });
    autoDomainPartnerMap = {};
    domainMappingReport = { autoMapped: [], ambiguous: [], unmapped: [] };
    const rawTasks = [];
    const rawOpps = [];
    const rawLearning = [];
    const mapped = [];
    const files = [];
    let mappingRows = 0;
    let tasksBeforeDedup = 0;
    let learningBeforeDedup = 0;
    for (const file of parsedFiles) {
      let taskRows = 0, oppRows = 0, mappedRows = 0, learningRows = 0, partnerMapRows = 0;
      for (const extract of file.extracted) {
        extract.fileName = file.fileName;
        if (extract.type === 'tasks') {
          taskRows += extract.records.length;
          for (const rec of extract.records) {
            const t = normalizeTask(rec, extract);
            if (t) rawTasks.push(t);
          }
        } else if (extract.type === 'opportunities') {
          oppRows += extract.records.length;
          for (const rec of extract.records) {
            const o = normalizeOpportunity(rec, extract);
            if (o) rawOpps.push(o);
          }
        } else if (extract.type === 'mapped') {
          mappedRows += extract.records.length;
          for (const rec of extract.records) {
            const o = normalizeOpportunity(rec, extract);
            if (o) mapped.push(o);
          }
        } else if (extract.type === 'learning') {
          learningRows += extract.records.length;
          for (const rec of extract.records) {
            const row = normalizeLearning(rec, extract);
            if (row) rawLearning.push(row);
          }
        } else if (extract.type === 'partnerMap') {
          partnerMapRows += extract.records.length;
          for (const rec of extract.records) {
            if (applyPartnerMappingRecord(rec)) mappingRows += 1;
          }
        }
      }
      files.push({ fileName: file.fileName, sheetsParsed: file.sheetsParsed, taskRows, oppRows, mappedRows, learningRows, partnerMapRows });
    }
    tasksBeforeDedup = rawTasks.length;
    learningBeforeDedup = rawLearning.length;
    const dedupedTasks = Array.from(new Map(rawTasks.map((task) => [task.dedupe, task])).values());
    const dedupedLearning = Array.from(new Map(rawLearning.map((row) => [row.dedupe, row])).values());
    const oppMap = new Map();
    for (const row of rawOpps.concat(mapped)) oppMap.set(row.opportunityKey, mergeOpportunity(oppMap.get(row.opportunityKey), row));
    const opportunities = Array.from(oppMap.values());
    const autoResult = buildAutoDomainPartnerMap(opportunities, dedupedLearning);
    autoDomainPartnerMap = { ...autoResult.map };
    domainMappingReport = {
      autoMapped: autoResult.autoMapped,
      ambiguous: autoResult.ambiguous,
      unmapped: autoResult.unmapped
    };
    remapLearningToPartners(dedupedLearning, opportunities);
    const hasRawTasks = dedupedTasks.length > 0;
    const rawTaskAgg = hasRawTasks ? aggregateTasks(dedupedTasks) : aggregateSeed(opportunities);
    const reconciled = reconcileTaskAggregation(rawTaskAgg, opportunities);
    const taskAgg = reconciled.taskAgg;
    const fuzzyTaskMatches = reconciled.fuzzyMatches;
    const taskKeyAliases = Object.fromEntries(reconciled.taskKeyAliases);
    const oppKeys = new Set(opportunities.map((o) => o.opportunityKey));
    const unmatchedTaskAgg = Array.from(taskAgg.values()).filter((row) => !oppKeys.has(row.opportunityKey) && row.totalHours > 0).map((row) => ({
      opportunityName: row.opportunityName,
      totalHours: row.totalHours,
      taskCount: row.taskCount,
      consultantCount: row.consultants.size
    })).sort((a, b) => b.totalHours - a.totalHours);
    const oppPartnerKeys = new Set(opportunities.map((o) => o.partnerKey).filter(Boolean));
    const learningAgg = aggregateLearningByPartner(dedupedLearning);
    const unmatchedLearningPartners = Array.from(learningAgg.values()).filter((row) => row.partnerKey && !oppPartnerKeys.has(row.partnerKey)).map((row) => ({
      partnerGroup: row.partnerGroup,
      learningSeconds: row.learningSeconds,
      learnerCount: row.learnerCount
    })).sort((a, b) => b.learningSeconds - a.learningSeconds);
    return {
      files,
      tasks: dedupedTasks,
      opportunities,
      learningRows: dedupedLearning,
      hasRawTasks,
      unmatchedTaskAgg,
      fuzzyTaskMatches,
      taskKeyAliases,
      unmatchedLearningPartners,
      domainMappingReport,
      baseStats: {
        filesLoaded: parsedFiles.length,
        tasksImported: dedupedTasks.length,
        tasksBeforeDedup,
        duplicateTasksRemoved: tasksBeforeDedup - dedupedTasks.length,
        opportunitiesImported: opportunities.length,
        learningImported: dedupedLearning.length,
        learningBeforeDedup,
        duplicateLearningRemoved: learningBeforeDedup - dedupedLearning.length,
        learningLearnersImported: new Set(dedupedLearning.map((row) => row.email)).size,
        partnerMappingsImported: mappingRows,
        autoDomainMappings: Object.keys(autoDomainPartnerMap).length
      }
    };
  }


  function taskFiltersActive() {
    return FILTERS.some((f) => f.level === 'task' && state.filters.selections[f.key].size > 0);
  }
  function learningFiltersActive() {
    return FILTERS.some((f) => f.level === 'learning' && state.filters.selections[f.key].size > 0);
  }
  function applyTaskFilters(tasks) {
    return tasks.filter((task) => {
      if (state.filters.selections.assigned.size && !state.filters.selections.assigned.has(task.assigned || '')) return false;
      if (state.filters.selections.activityType.size && !state.filters.selections.activityType.has(task.activityType || '')) return false;
      if (state.filters.selections.taskYear.size && !state.filters.selections.taskYear.has(task.taskYear || '')) return false;
      return true;
    });
  }
  function applyLearningFilters(rows) {
    return rows.filter((row) => {
      if (state.filters.selections.learnerEmail.size && !state.filters.selections.learnerEmail.has(row.learnerEmail || '')) return false;
      if (state.filters.selections.learningCourse.size && !state.filters.selections.learningCourse.has(row.learningCourse || '')) return false;
      if (state.filters.selections.learningState.size && !state.filters.selections.learningState.has(row.learningState || '')) return false;
      return true;
    });
  }

  function searchMatch(row) {
    const q = keyify(state.filters.search);
    if (!q) return true;
    const haystack = [row.opportunityName, row.accountName, row.partnerName, row.partnerGroup, row.opportunityOwner, row.stage, row.region, row.subRegion].map(keyify).join('|');
    return haystack.includes(q);
  }
  function applyOppFilters(rows) {
    return rows.filter((row) => {
      if (!searchMatch(row)) return false;
      for (const filter of FILTERS) {
        if (filter.level !== 'opp') continue;
        const selected = state.filters.selections[filter.key];
        if (selected.size && !selected.has(cleanText(row[filter.key]))) return false;
      }
      return true;
    });
  }
  function joinOpps(opportunities, taskAgg, useSeed, learningAgg) {
    return opportunities.map((opp) => {
      const agg = taskAgg.get(opp.opportunityKey);
      const learning = learningAgg.get(opp.partnerKey || '');
      const totalHours = agg ? agg.totalHours : (useSeed ? (opp.seedHours || 0) : 0);
      const taskCount = agg ? agg.taskCount : (useSeed && opp.seedHours ? 1 : 0);
      const consultants = agg ? Array.from(agg.consultants) : [];
      const topActivity = agg && agg.activityHours.size ? Array.from(agg.activityHours.entries()).sort((a, b) => b[1] - a[1])[0][0] : '';
      return {
        ...opp,
        totalHours,
        taskCount,
        consultantCount: consultants.length,
        consultants,
        latestTaskDate: agg ? agg.latestTaskDate : null,
        earliestTaskDate: agg ? agg.earliestTaskDate : null,
        topActivity,
        hasTaskHours: totalHours > 0,
        learningSeconds: learning ? learning.learningSeconds : 0,
        learnerCount: learning ? learning.learnerCount : 0,
        engagedLearnerCount: learning ? learning.engagedLearnerCount : 0,
        learningCourseCount: learning ? learning.courseCount : 0,
        openedOnlyLearnerCount: learning ? learning.openedOnlyLearnerCount : 0,
        learningHoursPerEngagedLearner: learning && learning.engagedLearnerCount ? learning.learningSeconds / learning.engagedLearnerCount / 3600 : null
      };
    });
  }
  function summarizePartners(rows, learningAgg) {
    const map = new Map();
    for (const row of rows) {
      const key = row.partnerKey || canonicalKey(row.partnerGroup || 'No partner named');
      if (!map.has(key)) map.set(key, { partnerKey: key, partnerGroup: row.partnerGroup || 'No partner named', opportunityCount: 0, oppsWithHours: 0, totalHours: 0, wonCount: 0, lostCount: 0, openCount: 0, closedCount: 0, totalValue: 0, wonValue: 0 });
      const p = map.get(key);
      p.opportunityCount += 1;
      if (row.totalHours > 0) p.oppsWithHours += 1;
      p.totalHours += row.totalHours || 0;
      if (row.outcome === 'Won') p.wonCount += 1;
      if (row.outcome === 'Lost') p.lostCount += 1;
      if (row.outcome === 'Open') p.openCount += 1;
      if (row.outcome === 'Won' || row.outcome === 'Lost') p.closedCount += 1;
      const value = Math.max(0, row.bookingValue || row.totalAmount || 0);
      p.totalValue += value;
      if (row.outcome === 'Won') p.wonValue += value;
    }
    const list = Array.from(map.values()).map((p) => {
      const learning = learningAgg.get(p.partnerKey) || { learningSeconds: 0, learnerCount: 0, engagedLearnerCount: 0, courseCount: 0, openedOnlyLearnerCount: 0, recordCount: 0 };
      const learningSeconds = learning.learningSeconds || 0;
      const learnerCount = learning.learnerCount || 0;
      const engagedLearnerCount = learning.engagedLearnerCount || 0;
      return {
        ...p,
        learningSeconds,
        learnerCount,
        engagedLearnerCount,
        learningCourseCount: learning.courseCount || 0,
        openedOnlyLearnerCount: learning.openedOnlyLearnerCount || 0,
        learningRecordCount: learning.recordCount || 0,
        learningHours: learningSeconds / 3600,
        winRate: p.closedCount ? p.wonCount / p.closedCount : null,
        avgHoursPerOpp: p.opportunityCount ? p.totalHours / p.opportunityCount : null,
        avgHoursPerOppWithHours: p.oppsWithHours ? p.totalHours / p.oppsWithHours : null,
        hoursPerWon: p.wonCount ? p.totalHours / p.wonCount : null,
        hoursPer100k: p.wonValue > 0 ? p.totalHours / (p.wonValue / 100000) : null,
        learningSecondsPerLearner: learnerCount ? learningSeconds / learnerCount : null,
        learningSecondsPerEngagedLearner: engagedLearnerCount ? learningSeconds / engagedLearnerCount : null,
        learningHoursPerLearner: learnerCount ? (learningSeconds / learnerCount) / 3600 : null,
        scHoursPerEngagedLearner: engagedLearnerCount ? p.totalHours / engagedLearnerCount : null,
        learningVsScRatio: p.totalHours > 0 ? (learningSeconds / 3600) / p.totalHours : null
      };
    });
    const hours = list.map((x) => x.totalHours).filter((x) => x > 0).sort((a, b) => a - b);
    const winRates = list.map((x) => x.winRate).filter((x) => x !== null).sort((a, b) => a - b);
    const hoursPerOpp = list.map((x) => x.avgHoursPerOppWithHours).filter((x) => x !== null).sort((a, b) => a - b);
    const hoursPer100k = list.map((x) => x.hoursPer100k).filter((x) => x !== null).sort((a, b) => a - b);
    const learningPerLearner = list.map((x) => x.learningSecondsPerLearner).filter((x) => x !== null && x > 0).sort((a, b) => a - b);
    const benchmarks = {
      hours75: percentile(hours, 0.75),
      winMedian: percentile(winRates, 0.5),
      hoursPerOpp75: percentile(hoursPerOpp, 0.75),
      hoursPer100k50: percentile(hoursPer100k, 0.5),
      learningPerLearner50: percentile(learningPerLearner, 0.5)
    };
    list.forEach((p) => {
      p.signal = 'Monitor'; p.signalClass = 'signal-neutral'; p.riskScore = 0;
      if (p.totalHours > 0 && p.winRate !== null && benchmarks.hours75 !== null && benchmarks.winMedian !== null && p.totalHours >= benchmarks.hours75 && p.winRate < benchmarks.winMedian) {
        p.signal = 'High SC demand, weak win rate'; p.signalClass = 'signal-alert'; p.riskScore = 5;
      } else if (p.opportunityCount >= 15 && p.winRate !== null && p.winRate < 0.2 && p.closedCount >= 5) {
        p.signal = 'High volume, low conversion'; p.signalClass = 'signal-watch'; p.riskScore = 4;
      } else if (p.totalHours > 0 && p.openCount > 0 && benchmarks.hoursPerOpp75 !== null && p.avgHoursPerOppWithHours !== null && p.avgHoursPerOppWithHours >= benchmarks.hoursPerOpp75 && p.closedCount === 0) {
        p.signal = 'Heavy support on open deals'; p.signalClass = 'signal-watch'; p.riskScore = 3;
      } else if (p.wonCount > 0 && p.hoursPer100k !== null && benchmarks.hoursPer100k50 !== null && p.hoursPer100k <= benchmarks.hoursPer100k50) {
        p.signal = 'Efficient conversion'; p.signalClass = 'signal-positive'; p.riskScore = 1;
      } else if (p.winRate !== null && benchmarks.winMedian !== null && p.winRate >= benchmarks.winMedian && p.closedCount >= 5) {
        p.signal = 'Strong conversion'; p.signalClass = 'signal-good'; p.riskScore = 1;
      } else if (p.totalHours > 0 && p.winRate !== null && benchmarks.hours75 !== null && benchmarks.winMedian !== null && p.totalHours >= benchmarks.hours75 && p.winRate >= benchmarks.winMedian) {
        p.signal = 'Strategic — high effort & converting'; p.signalClass = 'signal-positive'; p.riskScore = 2;
      }
    });
    return list;
  }


  function summarizeConsultants(tasks) {
    const map = new Map();
    for (const task of tasks) {
      const key = task.assigned || 'Unassigned';
      if (!map.has(key)) map.set(key, { assigned: key, totalHours: 0, taskCount: 0, opps: new Set() });
      const row = map.get(key);
      row.totalHours += task.hours || 0;
      row.taskCount += 1;
      row.opps.add(task.opportunityKey);
    }
    return Array.from(map.values()).map((row) => ({ assigned: row.assigned, totalHours: row.totalHours, taskCount: row.taskCount, opportunityCount: row.opps.size }));
  }
  function summarizeLearners(rows) {
    const map = new Map();
    for (const row of rows) {
      const key = row.email || row.learnerEmail;
      if (!key) continue;
      if (!map.has(key)) map.set(key, { learnerEmail: key, fullName: row.fullName || '', partnerGroup: row.partnerGroup || 'Unmapped learning partner', emailDomain: row.emailDomain || '', learningSeconds: 0, courseCountSet: new Set(), engagedCount: 0, openedOnlyCount: 0, topCourseMap: new Map() });
      const out = map.get(key);
      out.learningSeconds += row.learningSeconds || 0;
      if (row.courseTitle) out.courseCountSet.add(row.courseTitle);
      if (row.engagedFlag) out.engagedCount += 1;
      if (row.openedOnlyFlag) out.openedOnlyCount += 1;
      if (row.courseTitle) out.topCourseMap.set(row.courseTitle, (out.topCourseMap.get(row.courseTitle) || 0) + (row.learningSeconds || 0));
    }
    return Array.from(map.values()).map((row) => ({
      learnerEmail: row.learnerEmail,
      fullName: row.fullName,
      partnerGroup: row.partnerGroup,
      emailDomain: row.emailDomain,
      learningSeconds: row.learningSeconds,
      courseCount: row.courseCountSet.size,
      engagedCount: row.engagedCount,
      openedOnlyCount: row.openedOnlyCount,
      topCourse: row.topCourseMap.size ? Array.from(row.topCourseMap.entries()).sort((a, b) => b[1] - a[1])[0][0] : ''
    }));
  }

  function summarizeActivities(tasks) {
    const map = new Map();
    for (const task of tasks) {
      const key = task.activityType || 'Unspecified';
      if (!map.has(key)) map.set(key, { activityType: key, totalHours: 0, taskCount: 0 });
      const row = map.get(key);
      row.totalHours += task.hours || 0;
      row.taskCount += 1;
    }
    return Array.from(map.values());
  }
  function summarizeStages(rows) {
    const map = new Map();
    for (const row of rows) {
      const key = row.stage || 'Unknown';
      if (!map.has(key)) map.set(key, { stage: key, totalHours: 0, opportunityCount: 0, value: 0 });
      const out = map.get(key);
      out.totalHours += row.totalHours || 0;
      out.opportunityCount += 1;
      out.value += Math.max(0, row.bookingValue || row.totalAmount || 0);
    }
    return Array.from(map.values());
  }
  function summarizeOutcomes(rows) {
    const map = new Map([['Won', { outcome: 'Won', totalHours: 0, opportunityCount: 0 }], ['Lost', { outcome: 'Lost', totalHours: 0, opportunityCount: 0 }], ['Open', { outcome: 'Open', totalHours: 0, opportunityCount: 0 }], ['Unknown', { outcome: 'Unknown', totalHours: 0, opportunityCount: 0 }]]);
    for (const row of rows) {
      const out = map.get(row.outcome || 'Unknown') || { outcome: row.outcome || 'Unknown', totalHours: 0, opportunityCount: 0 };
      out.totalHours += row.totalHours || 0;
      out.opportunityCount += 1;
      map.set(out.outcome, out);
    }
    return Array.from(map.values());
  }
  function sortRows(rows, sortState) {
    const dir = sortState.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortState.key];
      const bv = b[sortState.key];
      if (av === bv) return cleanText(a.partnerGroup || a.opportunityName || '').localeCompare(cleanText(b.partnerGroup || b.opportunityName || ''));
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return cleanText(av).localeCompare(cleanText(bv)) * dir;
    });
  }
  function resolvedTaskOpportunityKey(task) {
    const aliases = state.model.taskKeyAliases || {};
    return aliases[task.opportunityKey] || task.opportunityKey;
  }

  function getDerivedData() {
    const filteredTasks = state.model.hasRawTasks ? applyTaskFilters(state.model.tasks) : [];
    const filteredLearning = applyLearningFilters(state.model.learningRows || []);
    const rawTaskAgg = state.model.hasRawTasks ? aggregateTasks(filteredTasks) : aggregateSeed(state.model.opportunities);
    const reconciled = reconcileTaskAggregation(rawTaskAgg, state.model.opportunities);
    const taskAgg = reconciled.taskAgg;
    const learningAgg = aggregateLearningByPartner(filteredLearning);
    let joined = joinOpps(state.model.opportunities, taskAgg, !state.model.hasRawTasks, learningAgg);
    if (taskFiltersActive()) joined = joined.filter((row) => row.totalHours > 0);
    if (learningFiltersActive()) joined = joined.filter((row) => row.learningSeconds > 0 || row.learnerCount > 0);
    joined = applyOppFilters(joined);
    const oppKeys = new Set(joined.map((row) => row.opportunityKey));
    const partnerKeys = new Set(joined.map((row) => row.partnerKey));
    const tasksInScope = state.model.hasRawTasks ? filteredTasks.filter((task) => oppKeys.has(resolvedTaskOpportunityKey(task))) : [];
    const learningInScope = filteredLearning.filter((row) => partnerKeys.has(row.partnerKey));
    const learningAggInScope = aggregateLearningByPartner(learningInScope);
    const partnerSummary = summarizePartners(joined, learningAggInScope);
    const consultantSummary = summarizeConsultants(tasksInScope);
    const activitySummary = summarizeActivities(tasksInScope);
    const learnerSummary = summarizeLearners(learningInScope);
    const stageSummary = summarizeStages(joined);
    const outcomeSummary = summarizeOutcomes(joined);
    const totalHours = joined.reduce((sum, row) => sum + (row.totalHours || 0), 0);
    const oppsWithHours = joined.filter((row) => row.totalHours > 0).length;
    const closedCount = joined.filter((row) => row.outcome === 'Won' || row.outcome === 'Lost').length;
    const wonCount = joined.filter((row) => row.outcome === 'Won').length;
    const winRate = closedCount ? wonCount / closedCount : null;
    const wonValue = joined.reduce((sum, row) => sum + (row.outcome === 'Won' ? Math.max(0, row.bookingValue || row.totalAmount || 0) : 0), 0);
    const learningSeconds = learningInScope.reduce((sum, row) => sum + (row.learningSeconds || 0), 0);
    const engagedLearners = new Set(learningInScope.filter((row) => row.engagedFlag).map((row) => row.email)).size;
    const totalLearners = new Set(learningInScope.map((row) => row.email)).size;
    return {
      joined,
      tasksInScope,
      learningInScope,
      partnerSummary,
      consultantSummary,
      activitySummary,
      learnerSummary,
      stageSummary,
      outcomeSummary,
      kpis: {
        totalHours,
        opportunities: joined.length,
        oppsWithHours,
        partners: new Set(joined.map((row) => row.partnerGroup)).size,
        winRate,
        hoursPerWon: wonCount ? totalHours / wonCount : null,
        hoursPer100k: wonValue > 0 ? totalHours / (wonValue / 100000) : null,
        learningSeconds,
        engagedLearners,
        totalLearners,
        learningSecondsPerEngagedLearner: engagedLearners ? learningSeconds / engagedLearners : null,
        scHoursPerEngagedLearner: engagedLearners ? totalHours / engagedLearners : null
      },
      topPartner: sortRows(partnerSummary.filter((row) => row.totalHours > 0), { key: 'totalHours', dir: 'desc' })[0] || null,
      learningLeader: sortRows(partnerSummary.filter((row) => row.learningSeconds > 0), { key: 'learningSeconds', dir: 'desc' })[0] || null,
      topOpportunity: sortRows(joined.filter((row) => row.totalHours > 0), { key: 'totalHours', dir: 'desc' })[0] || null,
      topLearner: sortRows(learnerSummary.filter((row) => row.learningSeconds > 0), { key: 'learningSeconds', dir: 'desc' })[0] || null,
      watchPartner: sortRows(partnerSummary.filter((row) => row.signalClass === 'signal-alert' || row.signalClass === 'signal-watch'), { key: 'riskScore', dir: 'desc' })[0] || null,
      taskHoursMatched: Array.from(taskAgg.values()).filter((row) => joined.some((j) => j.opportunityKey === row.opportunityKey)).reduce((sum, row) => sum + row.totalHours, 0),
      taskHoursTotal: Array.from(taskAgg.values()).reduce((sum, row) => sum + row.totalHours, 0)
    };
  }


  function filterOptions() {
    const out = {};
    for (const filter of FILTERS) {
      const source = filter.level === 'opp' ? state.model.opportunities : (filter.level === 'task' ? state.model.tasks : state.model.learningRows || []);
      out[filter.key] = [...new Set(source.map((row) => cleanText(row[filter.key])).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    }
    return out;
  }


  function insightHtml(derived) {
    const cards = [];
    if (derived.topPartner) cards.push({ label: 'Largest SC consumer', body: `${derived.topPartner.partnerGroup} with ${formatHours(derived.topPartner.totalHours)} across ${formatInt(derived.topPartner.opportunityCount)} opportunities.` });
    if (derived.learningLeader) cards.push({ label: 'Learning leader', body: `${derived.learningLeader.partnerGroup} has logged ${formatDuration(derived.learningLeader.learningSeconds)} of Seismic learning.` });
    if (derived.watchPartner) cards.push({ label: 'Watch signal', body: `${derived.watchPartner.partnerGroup} is flagged as “${derived.watchPartner.signal}”.` });
    if (derived.topLearner) cards.push({ label: 'Most active learner', body: `${derived.topLearner.learnerEmail} has spent ${formatDuration(derived.topLearner.learningSeconds)} in learning content.` });
    if (derived.topOpportunity) cards.push({ label: 'Highest-effort opportunity', body: `${derived.topOpportunity.opportunityName} has ${formatHours(derived.topOpportunity.totalHours)} logged so far.` });
    if (!cards.length) cards.push({ label: 'Ready', body: 'Upload task, opportunity, and Seismic learning files to start the analysis.' });
    return cards.slice(0, 4).map((c) => `<article class="insight-card"><p class="insight-label">${escapeHtml(c.label)}</p><p class="insight-body">${escapeHtml(c.body)}</p></article>`).join('');
  }

  function kpiCard(label, value, note, cls) {
    return `<article class="kpi-card ${cls}"><p class="kpi-label">${escapeHtml(label)}</p><p class="kpi-value">${escapeHtml(value)}</p><p class="kpi-note">${escapeHtml(note)}</p></article>`;
  }
  function emptyChart(message) { return `<div class="chart-empty">${escapeHtml(message)}</div>`; }
  function barSvg(items, aria) {
    if (!items.length) return emptyChart('Nothing to plot for this filter set.');
    const max = Math.max(...items.map((x) => x.value), 1);
    const rowH = 54, width = 980, barX = 370, barW = 520, height = items.length * rowH + 10;
    const rows = items.map((item, i) => {
      const y = i * rowH + 8;
      const w = Math.max(10, (item.value / max) * barW);
      return `<g class="chart-row" transform="translate(0 ${y})"><text x="12" y="16" class="chart-label">${escapeHtml(item.label)}</text><text x="12" y="38" class="chart-meta">${escapeHtml(item.meta || '')}</text><rect x="${barX}" y="2" width="${barW}" height="14" rx="7" class="chart-track"></rect><rect x="${barX}" y="2" width="${w}" height="14" rx="7" class="chart-fill"></rect><text x="${barX + barW}" y="14" text-anchor="end" class="chart-value">${escapeHtml(item.valueLabel)}</text></g>`;
    }).join('');
    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(aria)}">${rows}</svg>`;
  }
  function scatterSvg(items) {
    const rows = items.filter((x) => x.totalHours > 0 && x.avgHoursPerOppWithHours !== null && x.winRate !== null);
    if (!rows.length) return emptyChart('You need closed opportunities and SC time to build the efficiency matrix.');
    const width = 980, height = 360, pad = { left: 90, right: 40, top: 30, bottom: 60 };
    const plotW = width - pad.left - pad.right, plotH = height - pad.top - pad.bottom;
    const maxY = Math.max(...rows.map((x) => x.avgHoursPerOppWithHours), 1);
    const maxSize = Math.max(...rows.map((x) => x.totalHours), 1);
    const x = (v) => pad.left + v * plotW;
    const y = (v) => pad.top + plotH - (v / maxY) * plotH;
    const r = (v) => 8 + (v / maxSize) * 14;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((p) => `<g><line x1="${x(p)}" y1="${pad.top}" x2="${x(p)}" y2="${pad.top + plotH}" class="scatter-grid"></line><text x="${x(p)}" y="${height - 24}" text-anchor="middle" class="chart-meta">${Math.round(p * 100)}%</text></g>`).join('') + [0, 0.25, 0.5, 0.75, 1].map((p) => `<g><line x1="${pad.left}" y1="${y(maxY * p)}" x2="${pad.left + plotW}" y2="${y(maxY * p)}" class="scatter-grid"></line><text x="${pad.left - 12}" y="${y(maxY * p) + 4}" text-anchor="end" class="chart-meta">${escapeHtml(formatNumber(maxY * p, 1))}h</text></g>`).join('');
    const topLabels = sortRows(rows, { key: 'totalHours', dir: 'desc' }).slice(0, 8);
    const points = rows.map((row) => `<circle cx="${x(row.winRate)}" cy="${y(row.avgHoursPerOppWithHours)}" r="${r(row.totalHours)}" class="scatter-point ${escapeHtml(row.signalClass)}"></circle>`).join('');
    const labels = topLabels.map((row) => `<text x="${x(row.winRate) + 10}" y="${y(row.avgHoursPerOppWithHours) - 10}" class="chart-meta">${escapeHtml(row.partnerGroup)}</text>`).join('');
    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Partner efficiency matrix">${grid}<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" class="scatter-axis"></line><line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" class="scatter-axis"></line>${points}${labels}<text x="${pad.left + plotW / 2}" y="${height - 6}" text-anchor="middle" class="axis-label">Win rate</text><text x="20" y="${pad.top + plotH / 2}" text-anchor="middle" class="axis-label" transform="rotate(-90 20 ${pad.top + plotH / 2})">Average hours per opportunity with SC time</text></svg>`;
  }
  function learningScatterSvg(items) {
    const rows = items.filter((x) => x.engagedLearnerCount > 0 && x.learningHoursPerLearner !== null && x.winRate !== null);
    if (!rows.length) return emptyChart('Upload Seismic learning data and closed opportunities to compare learning with partner effectiveness.');
    const width = 980, height = 360, pad = { left: 90, right: 40, top: 30, bottom: 60 };
    const plotW = width - pad.left - pad.right, plotH = height - pad.top - pad.bottom;
    const maxX = Math.max(...rows.map((x) => x.learningHoursPerLearner), 1);
    const maxSize = Math.max(...rows.map((x) => x.totalHours), 1);
    const x = (v) => pad.left + (v / maxX) * plotW;
    const y = (v) => pad.top + plotH - v * plotH;
    const r = (v) => 8 + (v / maxSize) * 14;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((p) => `<g><line x1="${x(maxX * p)}" y1="${pad.top}" x2="${x(maxX * p)}" y2="${pad.top + plotH}" class="scatter-grid"></line><text x="${x(maxX * p)}" y="${height - 24}" text-anchor="middle" class="chart-meta">${escapeHtml(formatNumber(maxX * p, 1))}h</text></g>`).join('') + [0, 0.25, 0.5, 0.75, 1].map((p) => `<g><line x1="${pad.left}" y1="${y(p)}" x2="${pad.left + plotW}" y2="${y(p)}" class="scatter-grid"></line><text x="${pad.left - 12}" y="${y(p) + 4}" text-anchor="end" class="chart-meta">${Math.round(p * 100)}%</text></g>`).join('');
    const topLabels = sortRows(rows, { key: 'learningSeconds', dir: 'desc' }).slice(0, 8);
    const points = rows.map((row) => `<circle cx="${x(row.learningHoursPerLearner)}" cy="${y(row.winRate)}" r="${r(row.totalHours)}" class="scatter-point ${escapeHtml(row.signalClass)}"></circle>`).join('');
    const labels = topLabels.map((row) => `<text x="${x(row.learningHoursPerLearner) + 10}" y="${y(row.winRate) - 10}" class="chart-meta">${escapeHtml(row.partnerGroup)}</text>`).join('');
    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Learning impact matrix">${grid}<line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" class="scatter-axis"></line><line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" class="scatter-axis"></line>${points}${labels}<text x="${pad.left + plotW / 2}" y="${height - 6}" text-anchor="middle" class="axis-label">Learning hours per learner</text><text x="20" y="${pad.top + plotH / 2}" text-anchor="middle" class="axis-label" transform="rotate(-90 20 ${pad.top + plotH / 2})">Win rate</text></svg>`;
  }

  function outcomeSvg(items) {
    const rows = items.filter((x) => x.totalHours > 0 || x.opportunityCount > 0);
    if (!rows.length) return emptyChart('No opportunity outcomes available.');
    const total = rows.reduce((s, r) => s + r.totalHours, 0) || 1;
    const classes = { Won: 'outcome-won', Lost: 'outcome-lost', Open: 'outcome-open', Unknown: 'outcome-unknown' };
    let cursor = 0;
    const barX = 70, barW = 830, barY = 40, height = 170, width = 980;
    const segs = rows.map((row) => {
      const w = (row.totalHours / total) * barW;
      const html = `<rect x="${barX + cursor}" y="${barY}" width="${Math.max(2, w)}" height="26" rx="8" class="${classes[row.outcome] || 'outcome-unknown'}"></rect>`;
      cursor += w; return html;
    }).join('');
    const legend = rows.map((row, i) => `<g transform="translate(70 ${96 + i * 24})"><rect width="14" height="14" rx="4" class="${classes[row.outcome] || 'outcome-unknown'}"></rect><text x="22" y="12" class="chart-meta">${escapeHtml(row.outcome)} · ${escapeHtml(formatHours(row.totalHours))} · ${escapeHtml(formatInt(row.opportunityCount))} opps</text></g>`).join('');
    return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Hours by outcome">${segs}${legend}</svg>`;
  }

  function renderKpis(derived) {
    const host = document.getElementById('kpi-grid');
    if (!host) return;
    host.innerHTML = [
      kpiCard('Total SC hours', formatHours(derived.kpis.totalHours), 'Hours attached to the filtered opportunity set.', 'accent-teal'),
      kpiCard('Opportunities with SC time', formatInt(derived.kpis.oppsWithHours), `${formatInt(derived.kpis.opportunities)} opportunities in scope.`, 'accent-blue'),
      kpiCard('Closed win rate', formatPercent(derived.kpis.winRate), 'Closed won vs closed lost.', 'accent-green'),
      kpiCard('Hours per £100k won', derived.kpis.hoursPer100k === null ? '–' : `${formatNumber(derived.kpis.hoursPer100k, 1)}h`, 'Uses Gross ACV Booking where available, otherwise Amount.', 'accent-gold'),
      kpiCard('Partner learning time', formatDuration(derived.kpis.learningSeconds), `${formatInt(derived.kpis.totalLearners)} learners in the current slice.`, 'accent-purple'),
      kpiCard('Engaged learners', formatInt(derived.kpis.engagedLearners), 'Learners with non-zero Seismic time spent.', 'accent-red'),
      kpiCard('Learning time / engaged learner', derived.kpis.learningSecondsPerEngagedLearner === null ? '–' : formatDuration(derived.kpis.learningSecondsPerEngagedLearner), 'Average Seismic time among active learners.', 'accent-teal'),
      kpiCard('SC hours / engaged learner', derived.kpis.scHoursPerEngagedLearner === null ? '–' : formatHours(derived.kpis.scHoursPerEngagedLearner), 'Useful for judging enablement leverage.', 'accent-blue')
    ].join('');
  }

  function renderCharts(derived) {
    const partnerItems = sortRows(derived.partnerSummary.filter((x) => x.totalHours > 0), { key: 'totalHours', dir: 'desc' }).slice(0, 8).map((row) => ({ label: row.partnerGroup, meta: `${formatInt(row.opportunityCount)} opps · ${formatPercent(row.winRate)}`, value: row.totalHours, valueLabel: formatHours(row.totalHours) }));
    const learningPartnerItems = sortRows(derived.partnerSummary.filter((x) => x.learningSeconds > 0), { key: 'learningSeconds', dir: 'desc' }).slice(0, 8).map((row) => ({ label: row.partnerGroup, meta: `${formatInt(row.engagedLearnerCount)} engaged learners · ${formatPercent(row.winRate)}`, value: row.learningSeconds, valueLabel: formatDuration(row.learningSeconds) }));
    const stageItems = sortRows(derived.stageSummary.filter((x) => x.totalHours > 0 || x.opportunityCount > 0), { key: 'totalHours', dir: 'desc' }).slice(0, 8).map((row) => ({ label: row.stage, meta: `${formatInt(row.opportunityCount)} opps · ${formatCurrency(row.value)}`, value: row.totalHours, valueLabel: formatHours(row.totalHours) }));
    const consultantItems = sortRows(derived.consultantSummary.filter((x) => x.totalHours > 0), { key: 'totalHours', dir: 'desc' }).slice(0, 8).map((row) => ({ label: row.assigned, meta: `${formatInt(row.taskCount)} tasks · ${formatInt(row.opportunityCount)} opps`, value: row.totalHours, valueLabel: formatHours(row.totalHours) }));
    const learnerItems = sortRows(derived.learnerSummary.filter((x) => x.learningSeconds > 0), { key: 'learningSeconds', dir: 'desc' }).slice(0, 8).map((row) => ({ label: row.learnerEmail, meta: `${row.partnerGroup} · ${formatInt(row.courseCount)} courses`, value: row.learningSeconds, valueLabel: formatDuration(row.learningSeconds) }));
    document.getElementById('chart-partner-hours').innerHTML = barSvg(partnerItems, 'Top partners by SC hours');
    document.getElementById('chart-partner-learning').innerHTML = barSvg(learningPartnerItems, 'Top partners by learning time');
    document.getElementById('chart-efficiency-matrix').innerHTML = scatterSvg(derived.partnerSummary);
    document.getElementById('chart-learning-impact').innerHTML = learningScatterSvg(derived.partnerSummary);
    document.getElementById('chart-stage-hours').innerHTML = barSvg(stageItems, 'SC hours by stage');
    document.getElementById('chart-consultant-hours').innerHTML = barSvg(consultantItems, 'SC hours by consultant');
    document.getElementById('chart-top-learners').innerHTML = barSvg(learnerItems, 'Top learner emails');
    document.getElementById('chart-outcome-hours').innerHTML = outcomeSvg(derived.outcomeSummary);
  }

  function renderTable(containerId, rows, columns, sortState, tableName) {
    const host = document.getElementById(containerId);
    if (!host) return;
    if (!rows.length) { host.innerHTML = '<div class="table-empty">No rows match the current filters.</div>'; return; }
    const sorted = sortRows(rows, sortState);
    host.innerHTML = `<div class="table-scroll"><table class="data-table"><thead><tr>${columns.map((col) => `<th><button type="button" class="table-sort ${sortState.key === col.key ? `sorted-${sortState.dir}` : ''}" data-table="${escapeHtml(tableName)}" data-key="${escapeHtml(col.key)}">${escapeHtml(col.label)}</button></th>`).join('')}</tr></thead><tbody>${sorted.slice(0, 25).map((row) => `<tr>${columns.map((col) => `<td>${col.render(row)}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="table-footnote">Showing ${formatInt(Math.min(sorted.length, 25))} of ${formatInt(sorted.length)} rows.</p>`;
  }
  function renderTables(derived) {
    renderTable('partner-table', derived.partnerSummary, [
      { key: 'partnerGroup', label: 'Partner', render: (row) => `${escapeHtml(row.partnerGroup)}<div class="table-subtext">${escapeHtml(row.signal)}</div>` },
      { key: 'opportunityCount', label: 'Opps', render: (row) => escapeHtml(formatInt(row.opportunityCount)) },
      { key: 'totalHours', label: 'SC hours', render: (row) => `${escapeHtml(formatHours(row.totalHours))}<div class="table-subtext">${escapeHtml(formatInt(row.oppsWithHours))} opps with hours</div>` },
      { key: 'learningSeconds', label: 'Learning time', render: (row) => `${escapeHtml(formatDuration(row.learningSeconds))}<div class="table-subtext">${escapeHtml(formatInt(row.learningSeconds))}s</div>` },
      { key: 'engagedLearnerCount', label: 'Engaged learners', render: (row) => row.learningTracked ? `${escapeHtml(formatInt(row.engagedLearnerCount))}<div class="table-subtext">${escapeHtml(formatInt(row.learnerCount))} total learners</div>` : '<span class="muted">Not tracked</span>' },
      { key: 'winRate', label: 'Win rate', render: (row) => escapeHtml(formatPercent(row.winRate)) },
      { key: 'hoursPerWon', label: 'Hours / won', render: (row) => escapeHtml(formatHours(row.hoursPerWon)) },
      { key: 'scHoursPerEngagedLearner', label: 'SC hrs / engaged learner', render: (row) => escapeHtml(formatHours(row.scHoursPerEngagedLearner)) }
    ], state.ui.partnerSort, 'partner');
    renderTable('opportunity-table', derived.joined, [
      { key: 'opportunityName', label: 'Opportunity', render: (row) => `${escapeHtml(row.opportunityName)}<div class="table-subtext">${escapeHtml(row.accountName || '')}</div>` },
      { key: 'partnerGroup', label: 'Partner', render: (row) => escapeHtml(row.partnerGroup || 'No partner named') },
      { key: 'stage', label: 'Stage', render: (row) => `<span class="badge ${escapeHtml(slug(row.outcome))}">${escapeHtml(row.stage || row.outcome)}</span>` },
      { key: 'opportunityOwner', label: 'Owner', render: (row) => escapeHtml(row.opportunityOwner || '–') },
      { key: 'totalHours', label: 'SC hours', render: (row) => `${escapeHtml(formatHours(row.totalHours))}<div class="table-subtext">${escapeHtml(formatInt(row.taskCount))} tasks</div>` },
      { key: 'learningSeconds', label: 'Partner learning', render: (row) => `${escapeHtml(formatDuration(row.learningSeconds))}<div class="table-subtext">${escapeHtml(formatInt(row.engagedLearnerCount))} engaged learners</div>` },
      { key: 'bookingValue', label: 'Value', render: (row) => escapeHtml(formatCurrency(row.bookingValue || row.totalAmount)) },
      { key: 'latestTaskDate', label: 'Latest task', render: (row) => escapeHtml(formatShortDate(row.latestTaskDate)) }
    ], state.ui.oppSort, 'opportunity');
    renderTable('learner-table', derived.learnerSummary, [
      { key: 'learnerEmail', label: 'Learner', render: (row) => `${escapeHtml(row.learnerEmail)}<div class="table-subtext">${escapeHtml(row.fullName || '')}</div>` },
      { key: 'partnerGroup', label: 'Partner', render: (row) => escapeHtml(row.partnerGroup || 'Unmapped learning partner') },
      { key: 'learningSeconds', label: 'Learning time', render: (row) => `${escapeHtml(formatDuration(row.learningSeconds))}<div class="table-subtext">${escapeHtml(formatInt(row.learningSeconds))}s</div>` },
      { key: 'courseCount', label: 'Courses', render: (row) => escapeHtml(formatInt(row.courseCount)) },
      { key: 'engagedCount', label: 'Engaged opens', render: (row) => `${escapeHtml(formatInt(row.engagedCount))}<div class="table-subtext">${escapeHtml(formatInt(row.openedOnlyCount))} opened only</div>` },
      { key: 'topCourse', label: 'Top course', render: (row) => escapeHtml(row.topCourse || '–') }
    ], state.ui.learnerSort, 'learner');
  }

  function renderFilters() {
    const options = filterOptions();
    const host = document.getElementById('filters-container');
    const chips = document.getElementById('active-filter-chips');
    if (!host || !chips) return;
    host.innerHTML = FILTERS.filter((filter) => options[filter.key].length > 0).map((filter) => {
      const selected = state.filters.selections[filter.key];
      const search = keyify(state.ui.filterSearch[filter.key]);
      const list = options[filter.key].filter((value) => !search || value.toLowerCase().includes(search));
      const open = state.ui.filterOpen[filter.key] || selected.size > 0 || !!state.ui.filterSearch[filter.key];
      return `<details class="filter-group" data-filter-group="${escapeHtml(filter.key)}" ${open ? 'open' : ''}><summary><span>${escapeHtml(filter.label)}</span><span class="filter-summary">${selected.size ? `${selected.size} selected` : 'All'}</span></summary><div class="filter-search-wrap"><input type="search" class="filter-search-input" data-filter-search="${escapeHtml(filter.key)}" placeholder="Search ${escapeHtml(filter.label.toLowerCase())}" value="${escapeHtml(state.ui.filterSearch[filter.key] || '')}"></div><div class="filter-actions"><button type="button" class="filter-mini-button" data-select-all="${escapeHtml(filter.key)}">All</button><button type="button" class="filter-mini-button" data-clear-filter="${escapeHtml(filter.key)}">Clear</button></div><div class="filter-options">${list.length ? list.map((value) => `<label class="filter-option"><input type="checkbox" data-filter-key="${escapeHtml(filter.key)}" value="${escapeHtml(value)}" ${selected.has(value) ? 'checked' : ''}><span>${escapeHtml(value)}</span></label>`).join('') : '<p class="muted">No values match this filter search.</p>'}</div></details>`;
    }).join('') || '<p class="muted">Filters will appear once compatible files are loaded.</p>';
    const chipHtml = [];
    for (const filter of FILTERS) {
      for (const value of state.filters.selections[filter.key]) chipHtml.push(`<button type="button" class="filter-chip" data-chip-key="${escapeHtml(filter.key)}" data-chip-value="${escapeHtml(value)}">${escapeHtml(filter.label)}: ${escapeHtml(value)}</button>`);
    }
    if (state.filters.search) chipHtml.push(`<button type="button" class="filter-chip" data-clear-search="1">Search: ${escapeHtml(state.filters.search)}</button>`);
    chips.innerHTML = chipHtml.join('');
  }
  function renderStatus() {
    const host = document.getElementById('status-badges');
    if (!host) return;
    if (!state.model.baseStats.filesLoaded) { host.innerHTML = '<span class="status-pill">Awaiting files</span>'; return; }
    host.innerHTML = `<span class="status-pill">${escapeHtml(formatInt(state.model.baseStats.filesLoaded))} files loaded</span><span class="status-pill">${escapeHtml(formatInt(state.model.baseStats.opportunitiesImported))} opportunities</span><span class="status-pill">${escapeHtml(formatInt(state.model.baseStats.tasksImported))} tasks</span><span class="status-pill">${escapeHtml(formatInt(state.model.baseStats.learningImported))} learning rows</span>`;
  }
  function renderQuality(derived) {
    const statsHost = document.getElementById('quality-stats');
    const unmatchedHost = document.getElementById('unmatched-list');
    const unmatchedLearningHost = document.getElementById('unmatched-learning-list');
    const filesHost = document.getElementById('loaded-files');
    if (statsHost) {
      const matchRate = derived.taskHoursTotal ? derived.taskHoursMatched / derived.taskHoursTotal : null;
      statsHost.innerHTML = `<div class="quality-metric"><span>Files loaded</span><strong>${escapeHtml(formatInt(state.model.baseStats.filesLoaded))}</strong></div><div class="quality-metric"><span>Opportunities imported</span><strong>${escapeHtml(formatInt(state.model.baseStats.opportunitiesImported))}</strong></div><div class="quality-metric"><span>Tasks imported</span><strong>${escapeHtml(formatInt(state.model.baseStats.tasksImported))}</strong></div><div class="quality-metric"><span>Learning rows imported</span><strong>${escapeHtml(formatInt(state.model.baseStats.learningImported))}</strong></div><div class="quality-metric"><span>Distinct learners imported</span><strong>${escapeHtml(formatInt(state.model.baseStats.learningLearnersImported))}</strong></div><div class="quality-metric"><span>Duplicate tasks removed</span><strong>${escapeHtml(formatInt(state.model.baseStats.duplicateTasksRemoved))}</strong></div><div class="quality-metric"><span>Duplicate learning rows removed</span><strong>${escapeHtml(formatInt(state.model.baseStats.duplicateLearningRemoved))}</strong></div><div class="quality-metric"><span>Task-hour match rate</span><strong>${escapeHtml(formatPercent(matchRate))}</strong></div>`;
    }
    if (unmatchedHost) {
      unmatchedHost.innerHTML = state.model.unmatchedTaskAgg.slice(0, 8).map((row) => `<li><span>${escapeHtml(row.opportunityName)}</span><strong>${escapeHtml(formatHours(row.totalHours))}</strong></li>`).join('') || '<li class="muted">All task opportunity names matched an opportunity row.</li>';
    }
    if (unmatchedLearningHost) {
      unmatchedLearningHost.innerHTML = state.model.unmatchedLearningPartners.slice(0, 8).map((row) => `<li><span>${escapeHtml(row.partnerGroup)}</span><strong>${escapeHtml(formatDuration(row.learningSeconds))}</strong></li>`).join('') || '<li class="muted">All mapped learning partners matched an opportunity partner.</li>';
    }
    if (filesHost) {
      filesHost.innerHTML = state.model.files.map((file) => `<li><div><strong>${escapeHtml(file.fileName)}</strong><span>${escapeHtml(`${file.sheetsParsed} sheet${file.sheetsParsed === 1 ? '' : 's'}`)}</span></div><div class="file-metrics"><span>${escapeHtml(`${formatInt(file.taskRows)} task rows`)}</span><span>${escapeHtml(`${formatInt(file.oppRows + file.mappedRows)} opportunity rows`)}</span><span>${escapeHtml(`${formatInt(file.learningRows || 0)} learning rows`)}</span></div></li>`).join('') || '<li class="muted">No files loaded yet.</li>';
    }
  }

  function renderAll() {
    const empty = document.getElementById('empty-state');
    const dash = document.getElementById('dashboard-content');
    const loading = document.getElementById('loading-state');
    renderStatus();
    renderFilters();
    if (loading) loading.classList.toggle('hidden', !state.ui.loading);
    if (!state.model.baseStats.filesLoaded) {
      if (empty) empty.classList.remove('hidden');
      if (dash) dash.classList.add('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');
    if (dash) dash.classList.remove('hidden');
    state.derived = getDerivedData();
    const insights = document.getElementById('insight-strip');
    if (insights) insights.innerHTML = insightHtml(state.derived);
    renderKpis(state.derived);
    renderCharts(state.derived);
    renderTables(state.derived);
    renderQuality(state.derived);
  }
  function resetFilters() {
    state.filters.search = '';
    state.filters.selections = Object.fromEntries(FILTERS.map((f) => [f.key, new Set()]));
    state.ui.filterSearch = {};
    state.ui.filterOpen = {};
    const search = document.getElementById('global-search');
    if (search) search.value = '';
  }
  function clearData() {
    state.model = EMPTY_MODEL;
    resetFilters();
    renderAll();
  }
  async function loadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    state.ui.loading = true;
    renderAll();
    try {
      const parsed = [];
      for (const file of files) {
        const buffer = await file.arrayBuffer();
        const parsedFile = await parseSpreadsheetBuffer(buffer, file.name);
        if (parsedFile.recognized) parsed.push(parsedFile);
      }
      state.__parsedFiles = (state.__parsedFiles || []).concat(parsed);
      state.model = buildDataModel(state.__parsedFiles);
      if (!parsed.length) global.alert('None of the uploaded files matched the expected task, opportunity, or Seismic learning layouts.');
    } catch (err) {
      console.error(err);
      global.alert(`Could not parse one of the uploaded files. ${err.message}`);
    } finally {
      state.ui.loading = false;
      renderAll();
    }
  }
  function downloadCsv(filename, rows) {
    if (!rows.length) { global.alert('There is no filtered data to export right now.'); return; }
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(',')].concat(rows.map((row) => headers.map((key) => {
      const value = row[key] instanceof Date ? row[key].toISOString().slice(0, 10) : row[key];
      const text = String(value === null || value === undefined ? '' : value).replace(/"/g, '""');
      return /[",\n]/.test(text) ? `"${text}"` : text;
    }).join(','))).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }
  function exportPartners() {
    if (!state.derived) return;
    downloadCsv('partner-summary.csv', sortRows(state.derived.partnerSummary, state.ui.partnerSort).map((row) => ({ Partner: row.partnerGroup, Opportunities: row.opportunityCount, OpportunitiesWithHours: row.oppsWithHours, SCHours: row.totalHours, Won: row.wonCount, Lost: row.lostCount, Open: row.openCount, WinRate: row.winRate, WonValue: row.wonValue, HoursPerWon: row.hoursPerWon, HoursPer100kWon: row.hoursPer100k, LearningSeconds: row.learningSeconds, LearningHours: row.learningHours, Learners: row.learnerCount, EngagedLearners: row.engagedLearnerCount, LearningHoursPerLearner: row.learningHoursPerLearner, SCHoursPerEngagedLearner: row.scHoursPerEngagedLearner, Signal: row.signal })));
  }
  function exportOpportunities() {
    if (!state.derived) return;
    downloadCsv('opportunity-detail.csv', sortRows(state.derived.joined, state.ui.oppSort).map((row) => ({ OpportunityName: row.opportunityName, AccountName: row.accountName, PartnerName: row.partnerName, PartnerGroup: row.partnerGroup, Stage: row.stage, Outcome: row.outcome, OpportunityOwner: row.opportunityOwner, OwnerRole: row.ownerRole, Region: row.region, SubRegion: row.subRegion, DirectIndirect: row.directIndirect, TotalHours: row.totalHours, TaskCount: row.taskCount, ConsultantCount: row.consultantCount, LatestTaskDate: row.latestTaskDate ? row.latestTaskDate.toISOString().slice(0, 10) : '', BookingValue: row.bookingValue || row.totalAmount || '', CloseDate: row.closeDate ? row.closeDate.toISOString().slice(0, 10) : '', PartnerLearningSeconds: row.learningSeconds, PartnerLearners: row.learnerCount, PartnerEngagedLearners: row.engagedLearnerCount })));
  }
  function exportLearners() {
    if (!state.derived) return;
    downloadCsv('learner-detail.csv', sortRows(state.derived.learnerSummary, state.ui.learnerSort).map((row) => ({ LearnerEmail: row.learnerEmail, FullName: row.fullName, PartnerGroup: row.partnerGroup, EmailDomain: row.emailDomain, LearningSeconds: row.learningSeconds, LearningDuration: formatDuration(row.learningSeconds), CourseCount: row.courseCount, EngagedOpens: row.engagedCount, OpenedOnly: row.openedOnlyCount, TopCourse: row.topCourse })));
  }
  function bindEvents() {
    const input = document.getElementById('file-input');
    const drop = document.getElementById('drop-zone');
    const clear = document.getElementById('clear-data-button');
    const reset = document.getElementById('reset-filters-button');
    const search = document.getElementById('global-search');
    const exportPartnerBtn = document.getElementById('export-partner-button');
    const exportOppBtn = document.getElementById('export-opportunity-button');
    const exportLearnerBtn = document.getElementById('export-learner-button');
    if (input) input.addEventListener('change', (e) => { loadFiles(e.target.files); e.target.value = ''; });
    if (drop) {
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag-active'); }));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag-active'); }));
      drop.addEventListener('drop', (e) => loadFiles(e.dataTransfer.files));
      drop.addEventListener('click', () => input && input.click());
    }
    if (clear) clear.addEventListener('click', () => { state.__parsedFiles = []; clearData(); });
    if (reset) reset.addEventListener('click', () => { resetFilters(); renderAll(); });
    if (search) search.addEventListener('input', (e) => { state.filters.search = e.target.value || ''; renderAll(); });
    if (exportPartnerBtn) exportPartnerBtn.addEventListener('click', exportPartners);
    if (exportOppBtn) exportOppBtn.addEventListener('click', exportOpportunities);
    if (exportLearnerBtn) exportLearnerBtn.addEventListener('click', exportLearners);
    document.addEventListener('toggle', (e) => {
      if (e.target && e.target.matches && e.target.matches('.filter-group')) {
        const key = e.target.getAttribute('data-filter-group');
        if (key) state.ui.filterOpen[key] = e.target.open;
      }
    }, true);
    document.addEventListener('input', (e) => {
      const filterSearch = e.target.getAttribute('data-filter-search');
      if (filterSearch) { state.ui.filterSearch[filterSearch] = e.target.value || ''; renderFilters(); }
    });
    document.addEventListener('change', (e) => {
      const key = e.target.getAttribute('data-filter-key');
      if (!key) return;
      if (e.target.checked) state.filters.selections[key].add(e.target.value); else state.filters.selections[key].delete(e.target.value);
      renderAll();
    });
    document.addEventListener('click', (e) => {
      const selectAll = e.target.getAttribute('data-select-all');
      const clearFilter = e.target.getAttribute('data-clear-filter');
      const chipKey = e.target.getAttribute('data-chip-key');
      const chipValue = e.target.getAttribute('data-chip-value');
      const clearSearch = e.target.getAttribute('data-clear-search');
      const table = e.target.getAttribute('data-table');
      const key = e.target.getAttribute('data-key');
      if (selectAll) { state.filters.selections[selectAll] = new Set(filterOptions()[selectAll] || []); renderAll(); return; }
      if (clearFilter) { state.filters.selections[clearFilter] = new Set(); renderAll(); return; }
      if (chipKey && chipValue) { state.filters.selections[chipKey].delete(chipValue); renderAll(); return; }
      if (clearSearch) { state.filters.search = ''; if (search) search.value = ''; renderAll(); return; }
      if (table && key) {
        const sortState = table === 'partner' ? state.ui.partnerSort : (table === 'learner' ? state.ui.learnerSort : state.ui.oppSort);
        if (sortState.key === key) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc'; else { sortState.key = key; sortState.dir = 'desc'; }
        renderAll();
      }
    });
  }
  function init() {
    bindEvents();
    renderAll();
  }



  const api = {
    parseSpreadsheetBuffer,
    buildDataModel,
    getDerivedData,
    state,
    formatHours,
    formatDuration,
    formatPercent,
    formatInt,
    escapeHtml,
    cleanText,
    sortRows,
    summarizeStages,
    summarizeLearners,
    summarizeActivities,
    filterOptions
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.PartnerDashboard = api;
}(typeof globalThis !== 'undefined' ? globalThis : window));
