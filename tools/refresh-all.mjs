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

// Fetchers pull external sources; builders assemble published artifacts from
// whatever snapshots are on disk. The distinction drives the failure policy
// below: a fetcher failing is tolerable (we keep last-known data and still
// publish), a builder failing is not (the artifact is wrong).
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
  { name: 'Build kinderhook.json',    script: 'tools/build-jsonld.mjs',      builder: true },
  { name: 'AI surface audit page',    script: 'tools/build-audit-page.mjs',  builder: true },
];

// Resolves with an exit code rather than rejecting, so the driver — not an
// exception — decides what a failure means.
function run(scriptPath) {
  return new Promise((resolveP) => {
    const child = spawn('node', [scriptPath], { stdio: 'inherit', cwd: REPO_ROOT });
    child.on('exit', code => resolveP(code ?? 1));
    child.on('error', () => resolveP(1));
  });
}

async function main() {
  const start = Date.now();
  const fetcherFails = [];
  const builderFails = [];
  let fetchersRun = 0;

  for (const t of tools) {
    if (t.slow && skipBusinesses) {
      console.log(`\n--- SKIP  ${t.name}\n`);
      continue;
    }
    console.log(`\n--- RUN   ${t.name}  (${t.script})\n`);
    const code = await run(t.script);
    if (t.builder) {
      if (code !== 0) builderFails.push(t.name);
    } else {
      fetchersRun++;
      if (code !== 0) {
        // Tolerate it: the fetcher leaves its last-known snapshot in place,
        // and one flaky external source must never freeze the whole corpus
        // (an unguarded LoC 403 silently did exactly that for weeks).
        fetcherFails.push(t.name);
        console.warn(`\n--- WARN  ${t.name} exited ${code} — continuing; last-known snapshot retained.\n`);
      }
    }
  }

  const dur = Math.round((Date.now() - start) / 1000);
  console.log(`\n[refresh-all] complete in ${dur}s`);
  if (fetcherFails.length) console.warn(`[refresh-all] fetchers skipped (${fetcherFails.length}): ${fetcherFails.join(', ')}`);
  if (builderFails.length) console.error(`[refresh-all] builders FAILED (${builderFails.length}): ${builderFails.join(', ')}`);
  console.log(`[refresh-all] commit data/snapshots/ to publish.`);

  // Fail the run only when an artifact is actually broken: a builder failed,
  // or every fetcher failed (total outage). Partial fetcher failure is a
  // healthy refresh of whatever was reachable.
  if (builderFails.length) process.exit(1);
  if (fetchersRun > 0 && fetcherFails.length === fetchersRun) {
    console.error('[refresh-all] every fetcher failed — treating as fatal.');
    process.exit(1);
  }
}

main().catch(err => { console.error('\n[refresh-all] FAILED:', err.message); process.exit(1); });
