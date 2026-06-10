#!/usr/bin/env node
/**
 * Smoke test: parse task + opportunity exports and print key metrics.
 *
 * Usage:
 *   node scripts/smoke-test.mjs
 *   node scripts/smoke-test.mjs /path/to/tasks.xls /path/to/opps.xls
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const defaultTask = path.join(process.env.HOME || '', 'Downloads/report1781020228104.xls');
const defaultOpp = path.join(process.env.HOME || '', 'Downloads/report1781022452222.xls');

const taskPath = process.argv[2] || defaultTask;
const oppPath = process.argv[3] || defaultOpp;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function loadEngine() {
  const enginePath = path.join(root, 'data-engine.js');
  const code = fs.readFileSync(enginePath, 'utf8');
  const sandbox = { global: globalThis };
  const fn = new Function('global', `${code}\nreturn global.PartnerDashboard;`);
  const PD = fn(sandbox.global);
  if (!PD?.parseSpreadsheetBuffer) fail('PartnerDashboard API not found in data-engine.js');
  return PD;
}

function checkAppSyntax() {
  const appPath = path.join(root, 'app.js');
  try {
    require('node:module').Module._compile(fs.readFileSync(appPath, 'utf8'), appPath);
  } catch (err) {
    // Browser IIFE — use vm or node --check instead
  }
  const { execSync } = require('node:child_process');
  execSync(`node --check "${path.join(root, 'app.js')}"`, { stdio: 'pipe' });
}

async function main() {
  console.log('Checking app.js syntax…');
  checkAppSyntax();
  console.log('  app.js OK');

  for (const p of [taskPath, oppPath]) {
    if (!fs.existsSync(p)) fail(`File not found: ${p}`);
  }

  const PD = loadEngine();
  const parsed = [];

  for (const p of [taskPath, oppPath]) {
    const buf = fs.readFileSync(p);
    const row = await PD.parseSpreadsheetBuffer(buf, path.basename(p));
    console.log(`${path.basename(p)}: recognized=${row.recognized}`);
    if (!row.recognized) fail(`Unrecognized layout: ${p}`);
    parsed.push(row);
  }

  PD.state.__parsedFiles = parsed;
  PD.state.model = PD.buildDataModel(parsed);
  const m = PD.state.model;

  const regions = [...new Set(m.opportunities.map((o) => o.region).filter(Boolean))].sort();
  if (!regions.length) fail('No L3 regions found on opportunities — check L3 - Region column mapping');

  const d = PD.getDerivedData();
  const matchPct = d.taskHoursTotal ? (d.taskHoursMatched / d.taskHoursTotal) * 100 : 0;

  console.log('\nModel');
  console.log(`  opportunities: ${m.opportunities.length.toLocaleString()}`);
  console.log(`  tasks: ${m.tasks.length.toLocaleString()}`);
  console.log(`  L3 regions: ${regions.join(', ')}`);

  console.log('\nDerived');
  console.log(`  SC hours: ${Math.round(d.kpis.totalHours).toLocaleString()}h`);
  console.log(`  opps with SC time: ${d.kpis.oppsWithHours.toLocaleString()}`);
  console.log(`  closed win rate: ${d.kpis.winRate !== null ? (d.kpis.winRate * 100).toFixed(1) + '%' : 'n/a'}`);
  console.log(`  task–opp match: ${matchPct.toFixed(1)}%`);
  console.log(`  partners: ${d.partnerSummary.length.toLocaleString()}`);

  const cgiUk = d.partnerSummary.find((p) => /cgi it uk/i.test(p.partnerGroup));
  if (cgiUk) {
    console.log(`\nCGI IT UK Limited: ${Math.round(cgiUk.totalHours)}h on ${cgiUk.opportunityCount} opps`);
    if (cgiUk.totalHours < 500) fail(`Expected CGI IT UK HMRC hours >= 500, got ${cgiUk.totalHours}`);
  }

  const fuzzy = m.fuzzyTaskMatches || [];
  const hmrcFuzzy = fuzzy.find((r) => /hmrc/i.test(r.taskOpportunityName) && /cgi/i.test(r.matchedPartner || ''));
  if (!hmrcFuzzy) fail('Expected fuzzy link for HMRC/CGI task opportunity');
  console.log(`Fuzzy HMRC/CGI link: ${Math.round(hmrcFuzzy.totalHours)}h`);

  PD.state.filters.selections.region = new Set(['EMEA']);
  const emea = PD.getDerivedData();
  console.log('\nEMEA filter');
  console.log(`  opps: ${emea.joined.length.toLocaleString()}, SC hours: ${Math.round(emea.kpis.totalHours).toLocaleString()}h`);

  console.log('\nOK — smoke test passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
