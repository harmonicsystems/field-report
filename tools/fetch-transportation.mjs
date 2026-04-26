#!/usr/bin/env node
/*
 * fetch-transportation.mjs
 *
 * Snapshots the NYS Department of Transportation's two most useful
 * civic-infrastructure datasets, from data.ny.gov:
 *
 *   AADT      — Annual Average Daily Traffic by roadway segment
 *               (Socrata 6amx-2pbv). 18 stations in Kinderhook for
 *               the most-recent vintage (2019); ~770 historical rows
 *               going back to 1977. We capture the most-recent year
 *               only — the historical depth is in the source, not here.
 *
 *   Bridges   — NYSDOT Bridge Conditions list (Socrata wpyb-cjy8).
 *               Includes BIN, owner, last-inspection date, and a
 *               "poor_status" flag.
 *
 * The Town and Village of Kinderhook are listed separately as
 * municipality values; we capture both.
 *
 * Output:
 *   data/snapshots/transportation/{date,latest}-aadt.json
 *   data/snapshots/transportation/{date,latest}-bridges.json
 *
 * Usage:   node tools/fetch-transportation.mjs
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT_DIR = resolve(REPO_ROOT, 'data/snapshots/transportation');
const UA = 'HarmonicFieldReport/0.1 (+https://fieldreports.harmonic-systems.org; civic legibility project)';
const COUNTY = 'Columbia';
const today = new Date().toISOString().slice(0, 10);

const AADT_SRC    = 'https://data.ny.gov/resource/6amx-2pbv.json';
const BRIDGES_SRC = 'https://data.ny.gov/resource/wpyb-cjy8.json';

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function fetchAADT() {
  // Get the most recent year present for Kinderhook.
  const yearRow = await getJson(`${AADT_SRC}?$select=max(aadt_year)&$where=municipality='Kinderhook'`);
  const latestYear = yearRow[0]?.max_aadt_year;
  if (!latestYear) return { latestYear: null, stations: [] };

  const rows = await getJson(`${AADT_SRC}?$where=municipality='Kinderhook'+AND+aadt_year='${latestYear}'&$order=count+DESC`);
  const stations = rows.map(r => ({
    stationId: r.station_id,
    year: r.aadt_year,
    signing: r.signing,
    route: r.state_route,
    roadName: r.road_name || null,
    from: r.beginning_description,
    to: r.ending_description,
    aadt: r.count ? +r.count : null,
    lengthHundredsFt: r.length ? +r.length : null,
    bridge: r.bridge === 'Y',
    fc: r.fc,                          // functional class
    municipality: r.municipality,
    county: r.county,
  }));

  return { latestYear, stations, countMunicipality: stations.length };
}

async function fetchBridges() {
  // Town + Village of Kinderhook are listed separately.
  const filter = encodeURIComponent("county='Columbia' AND (municipality='Kinderhook (Town)' OR municipality='Kinderhook (Village)')");
  const rows = await getJson(`${BRIDGES_SRC}?$where=${filter}&$order=year_built_or_replaced+ASC`);
  return rows.map(r => ({
    bin: r.bin,
    municipality: r.municipality,
    yearBuilt: r.year_built_or_replaced ? +r.year_built_or_replaced : null,
    lastInspection: (r.date_of_last_inspection || '').slice(0, 10) || null,
    feature: r.feature_carried,
    crosses: r.feature_crossed,
    owner: r.owner,
    poor: String(r.poor_status || '').trim().toLowerCase() === 'yes',
    location: r.location || null,
  }));
}

async function main() {
  console.log('[aadt] Kinderhook stations…');
  const aadt = await fetchAADT();
  console.log(`  ${aadt.stations.length} stations (year ${aadt.latestYear})`);

  console.log('[bridges] Kinderhook (town + village)…');
  const bridges = await fetchBridges();
  console.log(`  ${bridges.length} bridges (${bridges.filter(b => b.poor).length} flagged poor)`);

  await mkdir(OUT_DIR, { recursive: true });
  const meta = { fetchedAt: new Date().toISOString(), fetcher: 'tools/fetch-transportation.mjs' };

  const aadtPayload = JSON.stringify({
    ...meta,
    source: AADT_SRC,
    municipality: 'Kinderhook',
    latestYear: aadt.latestYear,
    stations: aadt.stations,
  }, null, 2) + '\n';
  await writeFile(resolve(OUT_DIR, `${today}-aadt.json`), aadtPayload);
  await writeFile(resolve(OUT_DIR, 'latest-aadt.json'), aadtPayload);

  const bridgePayload = JSON.stringify({
    ...meta,
    source: BRIDGES_SRC,
    bridges,
    counts: { total: bridges.length, poor: bridges.filter(b => b.poor).length },
  }, null, 2) + '\n';
  await writeFile(resolve(OUT_DIR, `${today}-bridges.json`), bridgePayload);
  await writeFile(resolve(OUT_DIR, 'latest-bridges.json'), bridgePayload);

  console.log('[done]');
}

main().catch(err => { console.error(err); process.exit(1); });
