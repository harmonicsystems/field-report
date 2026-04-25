#!/usr/bin/env node
/*
 * fetch-fema.mjs
 *
 * Snapshots OpenFEMA disaster declaration history for Columbia County, NY
 * (FIPS 36-021). Two slices, both from the public OpenFEMA v2 API:
 *
 *   1. DisasterDeclarationsSummaries — every federal declaration that
 *      designated this county. One record per (declaration × county).
 *
 *   2. FemaWebDisasterSummaries — running totals (IA approved, PA obligated)
 *      keyed by disasterNumber, joined to the declarations above.
 *
 * Source:  https://www.fema.gov/api/open/v2/   (public, no key required)
 * Output:  data/snapshots/fema/{date,latest}-disasters.json
 *
 * Usage:   node tools/fetch-fema.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT_DIR   = resolve(REPO_ROOT, 'data/snapshots/fema');
const UA        = 'HarmonicFieldReport/0.1 (+https://fieldreports.harmonic-systems.org; civic legibility project)';
const today     = new Date().toISOString().slice(0, 10);

// Columbia County, NY: state=NY, fipsStateCode=36, fipsCountyCode=021.
const STATE = 'NY';
const COUNTY_FIPS = '021';

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function getAllPages(baseUrl, key) {
  // OpenFEMA v2 supports $top + $skip. metadata.count is total.
  const out = [];
  const page = 1000;
  for (let skip = 0; skip < 50000; skip += page) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const url = `${baseUrl}${sep}$top=${page}&$skip=${skip}&$metadata=off`;
    const data = await getJson(url);
    const rows = data[key] || [];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

async function writeSnap(name, data) {
  await mkdir(OUT_DIR, { recursive: true });
  const payload = JSON.stringify(data, null, 2) + '\n';
  await writeFile(resolve(OUT_DIR, `${today}-${name}.json`),  payload);
  await writeFile(resolve(OUT_DIR, `latest-${name}.json`),    payload);
}

async function main() {
  console.log('[start] FEMA disaster snapshot');

  // --- 1. Declarations for Columbia County ---
  const declUrl = `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=state eq '${STATE}' and fipsCountyCode eq '${COUNTY_FIPS}'&$orderby=declarationDate desc`;
  const declarations = await getAllPages(declUrl, 'DisasterDeclarationsSummaries');
  console.log(`  ${declarations.length} county-level declarations`);

  // --- 2. Per-disaster summaries (IA approved, PA obligated) ---
  // Pull a unique list of disasterNumbers, then get summary per.
  const numbers = [...new Set(declarations.map(d => d.disasterNumber))];
  const sumUrl = `https://www.fema.gov/api/open/v2/FemaWebDisasterSummaries?$filter=${encodeURIComponent(`disasterNumber in (${numbers.join(',')})`)}`;
  let summaries = [];
  try {
    summaries = await getAllPages(sumUrl, 'FemaWebDisasterSummaries');
    console.log(`  ${summaries.length} disaster summaries joined`);
  } catch (e) {
    console.warn(`  summaries fetch failed: ${e.message}`);
  }
  const sumByNum = Object.fromEntries(summaries.map(s => [s.disasterNumber, s]));

  // --- Roll up by incident type for the section header ---
  const byIncidentType = {};
  for (const d of declarations) {
    const t = d.incidentType || 'Unknown';
    byIncidentType[t] = (byIncidentType[t] || 0) + 1;
  }

  // --- One row per declaration with merged summary fields ---
  const merged = declarations.map(d => ({
    disasterNumber:   d.disasterNumber,
    declarationType:  d.declarationType,
    declarationTitle: d.declarationTitle,
    incidentType:     d.incidentType,
    declarationDate:  d.declarationDate,
    incidentBeginDate: d.incidentBeginDate,
    incidentEndDate:  d.incidentEndDate,
    state:            d.state,
    designatedArea:   d.designatedArea,
    iaProgramDeclared: d.iaProgramDeclared,
    paProgramDeclared: d.paProgramDeclared,
    hmProgramDeclared: d.hmProgramDeclared,
    summary: sumByNum[d.disasterNumber] ? {
      totalNumberIaApproved: sumByNum[d.disasterNumber].totalNumberIaApproved ?? null,
      totalAmountIhpApproved: sumByNum[d.disasterNumber].totalAmountIhpApproved ?? null,
      totalAmountHaApproved:  sumByNum[d.disasterNumber].totalAmountHaApproved ?? null,
      totalAmountOnaApproved: sumByNum[d.disasterNumber].totalAmountOnaApproved ?? null,
      totalObligatedAmountPa: sumByNum[d.disasterNumber].totalObligatedAmountPa ?? null,
      totalObligatedAmountHmgp: sumByNum[d.disasterNumber].totalObligatedAmountHmgp ?? null,
    } : null,
  }));

  await writeSnap('disasters', {
    fetchedAt: new Date().toISOString(),
    fetcher: 'tools/fetch-fema.mjs',
    source: declUrl,
    geography: { state: STATE, fipsCountyCode: COUNTY_FIPS, name: 'Columbia County, NY' },
    counts: {
      declarationsTotal: declarations.length,
      uniqueDisasters: numbers.length,
      summariesJoined: summaries.length,
    },
    byIncidentType,
    declarations: merged,
  });

  console.log(`[done] FEMA snapshot — ${declarations.length} declarations across ${Object.keys(byIncidentType).length} incident types`);
}

main().catch(err => { console.error(err); process.exit(1); });
