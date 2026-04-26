#!/usr/bin/env node
/*
 * refresh-all.mjs
 *
 * Single entry point that re-runs every snapshot fetcher in sequence.
 * The page reads only from data/snapshots/, so this is the only thing
 * standing between us and a fresh corpus.
 *
 * Usage:
 *   node tools/refresh-all.mjs                # everything
 *   node tools/refresh-all.mjs --skip-cct-businesses
 *                                             # skip the 10-min CCT scrape
 *
 * After a refresh, commit the data/snapshots/ changes. The git diff is
 * the village's machine-readable history.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const args = process.argv.slice(2);
const skipBusinesses = args.includes('--skip-cct-businesses');

const tools = [
  { name: 'CCT REST snapshots',       script: 'tools/fetch-cct.mjs' },
  { name: 'CCT business index',       script: 'tools/fetch-cct-business-index.mjs' },
  { name: 'CCT business detail x594', script: 'tools/fetch-cct-businesses.mjs', slow: true },
  { name: 'Village of Kinderhook',    script: 'tools/fetch-village-directory.mjs' },
  { name: 'Wikidata + OSM crossrefs', script: 'tools/fetch-crossrefs.mjs' },
  { name: 'Historical (WD/Wiki/LoC)', script: 'tools/fetch-historical.mjs' },
  { name: 'ORPTS assessments',        script: 'tools/fetch-orpts.mjs' },
  { name: 'NY market equity stats',   script: 'tools/fetch-ny-sales.mjs' },
  { name: 'Census ACS 5-Year',        script: 'tools/fetch-acs.mjs' },
  { name: 'OpenFEMA disasters',       script: 'tools/fetch-fema.mjs' },
  { name: 'Climate Smart (data.ny.gov)', script: 'tools/fetch-climate-smart.mjs' },
  { name: 'Farmers Markets (data.ny.gov)', script: 'tools/fetch-farmers-markets.mjs' },
  { name: 'Transportation: AADT + Bridges', script: 'tools/fetch-transportation.mjs' },
  { name: 'Build kinderhook.json',    script: 'tools/build-jsonld.mjs' },
];

function run(scriptPath) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn('node', [scriptPath], { stdio: 'inherit', cwd: REPO_ROOT });
    child.on('exit', code => code === 0 ? resolveP() : rejectP(new Error(`${scriptPath} exit ${code}`)));
    child.on('error', rejectP);
  });
}

async function main() {
  const start = Date.now();
  for (const t of tools) {
    if (t.slow && skipBusinesses) {
      console.log(`\n--- SKIP  ${t.name}\n`);
      continue;
    }
    console.log(`\n--- RUN   ${t.name}  (${t.script})\n`);
    await run(t.script);
  }
  const dur = Math.round((Date.now() - start) / 1000);
  console.log(`\n[refresh-all] complete in ${dur}s`);
  console.log(`[refresh-all] commit data/snapshots/ to publish.`);
}

main().catch(err => { console.error('\n[refresh-all] FAILED:', err.message); process.exit(1); });
