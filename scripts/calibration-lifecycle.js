#!/usr/bin/env node
'use strict';

/**
 * Behavioral Calibration Lifecycle Manager — AD #16 Phase 5
 *
 * Human-in-the-loop control panel for managing calibration entry lifecycle.
 * Used at the Sunday Blind Spot Audit to promote, suspend, reactivate,
 * and retire calibration entries.
 *
 * Lifecycle: CANDIDATE → ACTIVE → SUSPENDED → ACTIVE (rewritten) or RETIRED
 *
 * Commands:
 *   status              — Show all entries with current status
 *   promote <id>        — CANDIDATE → ACTIVE (entry must have directional_guidance written)
 *   suspend <id>        — ACTIVE → SUSPENDED (overcorrection detected)
 *   reactivate <id>     — SUSPENDED → ACTIVE (guidance rewritten)
 *   retire <id>         — Any → RETIRED (tendency corrected)
 *   decay               — Apply confidence decay based on current measurements
 *   audit-report        — Full Sunday audit report (patterns + candidates + measurements + decay)
 *
 * The Integrity Protocol (Patent Pending) — Timothy Joseph Wrenn
 */

const path = require('path');
const fs   = require('fs');

const DATA_DIR   = path.join(__dirname, '..', 'data');
const CAL_PATH   = path.join(DATA_DIR, 'behavioral-calibration.json');

function log(msg)  { console.log(`[lifecycle] ${msg}`); }
function warn(msg) { console.warn(`[lifecycle] ⚠️ ${msg}`); }
function err(msg)  { console.error(`[lifecycle] 🚨 ${msg}`); }

// ─── Data Access ─────────────────────────────────────────────────────────────

function loadEntries() {
  if (!fs.existsSync(CAL_PATH)) {
    err('behavioral-calibration.json not found');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CAL_PATH, 'utf8'));
}

function saveEntries(entries) {
  fs.writeFileSync(CAL_PATH, JSON.stringify(entries, null, 2));
  log(`Saved ${entries.length} entries to behavioral-calibration.json`);
}

function findEntry(entries, id) {
  const entry = entries.find(e => e.id === id);
  if (!entry) {
    err(`Entry ${id} not found`);
    return null;
  }
  return entry;
}

function today() {
  return new Date().toISOString().substring(0, 10);
}

// ─── Commands ────────────────────────────────────────────────────────────────

function cmdStatus() {
  const entries = loadEntries();
  const grouped = { CANDIDATE: [], ACTIVE: [], SUSPENDED: [], RETIRED: [] };

  for (const e of entries) {
    const group = grouped[e.status] || [];
    group.push(e);
    grouped[e.status] = group;
  }

  console.log('\n=== BEHAVIORAL CALIBRATION STATUS ===\n');
  console.log(`Total entries: ${entries.length}\n`);

  for (const status of ['ACTIVE', 'CANDIDATE', 'SUSPENDED', 'RETIRED']) {
    const group = grouped[status] || [];
    if (group.length === 0) continue;

    console.log(`── ${status} (${group.length}) ──`);
    for (const e of group) {
      const guidance = e.directional_guidance.startsWith('[HUMAN REVIEW')
        ? '⚠️  NEEDS GUIDANCE'
        : '✓';
      console.log(`  ${e.id} | ${e.source_rule} | ${e.frequency} | ${e.confidence} | ${guidance}`);
      console.log(`    ${e.documented_tendency.substring(0, 120)}...`);
    }
    console.log('');
  }
}

function cmdPromote(id) {
  const entries = loadEntries();
  const entry = findEntry(entries, id);
  if (!entry) return;

  if (entry.status !== 'CANDIDATE') {
    err(`Cannot promote ${id}: status is ${entry.status}, must be CANDIDATE`);
    return;
  }

  if (entry.directional_guidance.startsWith('[HUMAN REVIEW')) {
    err(`Cannot promote ${id}: directional_guidance has not been written yet.`);
    err('The Incident Commander must write the corrective guidance before activation.');
    err('Edit behavioral-calibration.json and replace the placeholder text in directional_guidance.');
    return;
  }

  if (!entry.overcorrection_metric) {
    warn(`${id} has no overcorrection_metric set. The Blind Auditor cannot monitor for suppression.`);
    warn('Consider setting overcorrection_metric before promoting.');
  }

  entry.status = 'ACTIVE';
  entry.last_updated = today();

  saveEntries(entries);
  log(`✓ ${id} promoted to ACTIVE`);
  log(`  The Blind Auditor will establish a suppression baseline on the next pipeline run.`);
  log(`  Monitor the first 3-5 runs for overcorrection before assuming stability.`);
}

function cmdSuspend(id) {
  const entries = loadEntries();
  const entry = findEntry(entries, id);
  if (!entry) return;

  if (entry.status !== 'ACTIVE') {
    err(`Cannot suspend ${id}: status is ${entry.status}, must be ACTIVE`);
    return;
  }

  entry.status = 'SUSPENDED';
  entry.last_updated = today();

  // Clear the suppression baseline so it re-records when reactivated
  try {
    const baselinePath = path.join(DATA_DIR, 'calibration-baselines.json');
    if (fs.existsSync(baselinePath)) {
      const baselines = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      if (baselines[id]) {
        delete baselines[id];
        fs.writeFileSync(baselinePath, JSON.stringify(baselines, null, 2));
        log(`Cleared suppression baseline for ${id}`);
      }
    }
  } catch (_) {}

  saveEntries(entries);
  log(`✓ ${id} suspended`);
  log(`  The documented tendency is accurate but the directional guidance caused harm.`);
  log(`  Rewrite the directional_guidance in behavioral-calibration.json before reactivating.`);
}

function cmdReactivate(id) {
  const entries = loadEntries();
  const entry = findEntry(entries, id);
  if (!entry) return;

  if (entry.status !== 'SUSPENDED') {
    err(`Cannot reactivate ${id}: status is ${entry.status}, must be SUSPENDED`);
    return;
  }

  if (entry.directional_guidance.startsWith('[HUMAN REVIEW')) {
    err(`Cannot reactivate ${id}: directional_guidance has not been rewritten.`);
    return;
  }

  entry.status = 'ACTIVE';
  entry.last_updated = today();

  saveEntries(entries);
  log(`✓ ${id} reactivated`);
  log(`  New suppression baseline will be established on the next pipeline run.`);
}

function cmdRetire(id) {
  const entries = loadEntries();
  const entry = findEntry(entries, id);
  if (!entry) return;

  if (entry.status === 'RETIRED') {
    warn(`${id} is already RETIRED`);
    return;
  }

  const previousStatus = entry.status;
  entry.status = 'RETIRED';
  entry.last_updated = today();

  // Clear the suppression baseline
  try {
    const baselinePath = path.join(DATA_DIR, 'calibration-baselines.json');
    if (fs.existsSync(baselinePath)) {
      const baselines = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
      if (baselines[id]) {
        delete baselines[id];
        fs.writeFileSync(baselinePath, JSON.stringify(baselines, null, 2));
        log(`Cleared suppression baseline for ${id}`);
      }
    }
  } catch (_) {}

  saveEntries(entries);
  log(`✓ ${id} retired (was ${previousStatus})`);
}

function cmdDecay() {
  // Import the bridge module for measurement data
  let aggregateViolationPatterns, updateMeasurements;
  try {
    const bridge = require('./behavioral-calibration');
    aggregateViolationPatterns = bridge.aggregateViolationPatterns;
    updateMeasurements = bridge.updateMeasurements;
  } catch (e) {
    err(`Cannot load behavioral-calibration.js: ${e.message}`);
    return;
  }

  log('Running measurement aggregation for decay check...\n');
  const patterns = aggregateViolationPatterns();
  const recommendations = updateMeasurements(patterns);

  if (recommendations.length === 0) {
    console.log('\nNo ACTIVE entries to check for decay.\n');
    return;
  }

  const entries = loadEntries();
  let modified = false;

  console.log('\n=== DECAY ANALYSIS ===\n');
  for (const rec of recommendations) {
    const flag = rec.action === 'DECAY' ? ' ⚠️ DECAY RECOMMENDED'
      : rec.action === 'RETIRE_REVIEW' ? ' 🔴 RETIREMENT REVIEW'
      : '';

    console.log(`${rec.id} | ${rec.source_rule} | ${rec.current_frequency} → ${rec.new_frequency}${flag}`);
    console.log(`  ${rec.reason}`);

    // Apply measurement updates (frequency, magnitude, last_measured)
    const entry = findEntry(entries, rec.id);
    if (entry && rec.new_frequency) {
      entry.frequency = rec.new_frequency;
      if (rec.new_magnitude) entry.magnitude = rec.new_magnitude;
      entry.last_measured = rec.new_last_measured || today();
      entry.last_updated = today();
      modified = true;
    }

    // Apply confidence decay if recommended
    if (rec.action === 'DECAY' && entry) {
      const oldConf = entry.confidence;
      entry.confidence = rec.recommended_confidence;
      entry.last_updated = today();
      console.log(`  → Confidence decayed: ${oldConf} → ${rec.recommended_confidence}`);
      modified = true;
    }

    console.log('');
  }

  if (modified) {
    saveEntries(entries);
    log('Measurements and decay applied.');
  }
}

function cmdAuditReport() {
  let aggregateViolationPatterns, generateCandidates, updateMeasurements;
  try {
    const bridge = require('./behavioral-calibration');
    aggregateViolationPatterns = bridge.aggregateViolationPatterns;
    generateCandidates = bridge.generateCandidates;
    updateMeasurements = bridge.updateMeasurements;
  } catch (e) {
    err(`Cannot load behavioral-calibration.js: ${e.message}`);
    return;
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log('  AD #16 BEHAVIORAL CALIBRATION — SUNDAY AUDIT');
  console.log('══════════════════════════════════════════════════\n');

  // 1. Current status
  cmdStatus();

  // 2. Pattern aggregation + candidates
  console.log('── PATTERN DETECTION ──\n');
  const patterns = aggregateViolationPatterns();

  console.log('\n── NEW CANDIDATES ──\n');
  const candidates = generateCandidates(patterns);
  if (candidates.length > 0) {
    for (const c of candidates) {
      console.log(`${c.id} | ${c.source_rule} | ${c.frequency} | ${c.confidence}`);
      console.log(`  ${c.documented_tendency.substring(0, 200)}`);
      console.log(`  Layers: ${c.target_layers.join(', ')}`);
      console.log('');
    }
    console.log('To add candidates: copy from the candidates JSON output and merge into behavioral-calibration.json');
    console.log('Then write directional_guidance for each and promote with: node calibration-lifecycle.js promote <id>\n');
  } else {
    console.log('No new candidates — all qualifying rules already have entries.\n');
  }

  // 3. Measurement updates + decay
  console.log('── MEASUREMENT UPDATES ──\n');
  const recommendations = updateMeasurements(patterns);
  if (recommendations.length > 0) {
    for (const rec of recommendations) {
      const flag = rec.action === 'DECAY' ? ' ⚠️ DECAY'
        : rec.action === 'RETIRE_REVIEW' ? ' 🔴 RETIRE?'
        : '';
      console.log(`${rec.id} | ${rec.current_frequency} → ${rec.new_frequency}${flag}`);
      console.log(`  ${rec.reason}`);
      console.log('');
    }
  } else {
    console.log('No ACTIVE entries to measure.\n');
  }

  // 4. Suppression check
  console.log('── SUPPRESSION STATUS ──\n');
  try {
    const { loadBaselines } = require('./calibration-suppression-detectors');
    const baselines = loadBaselines();
    const baselineCount = Object.keys(baselines).length;
    if (baselineCount > 0) {
      console.log(`${baselineCount} suppression baseline(s) recorded:`);
      for (const [id, bl] of Object.entries(baselines)) {
        console.log(`  ${id} | ${bl.metric}@${bl.metric_layer} | baseline: ${bl.baseline_value} | recorded: ${bl.recorded_at}`);
      }
    } else {
      console.log('No suppression baselines recorded yet (none promoted to ACTIVE).');
    }
  } catch (_) {
    console.log('Suppression detector not available.');
  }

  console.log('\n══════════════════════════════════════════════════\n');
}

// ─── CLI Router ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] || 'status';
const targetId = args[1];

switch (command) {
  case 'status':
    cmdStatus();
    break;
  case 'promote':
    if (!targetId) { err('Usage: node calibration-lifecycle.js promote <id>'); break; }
    cmdPromote(targetId);
    break;
  case 'suspend':
    if (!targetId) { err('Usage: node calibration-lifecycle.js suspend <id>'); break; }
    cmdSuspend(targetId);
    break;
  case 'reactivate':
    if (!targetId) { err('Usage: node calibration-lifecycle.js reactivate <id>'); break; }
    cmdReactivate(targetId);
    break;
  case 'retire':
    if (!targetId) { err('Usage: node calibration-lifecycle.js retire <id>'); break; }
    cmdRetire(targetId);
    break;
  case 'decay':
    cmdDecay();
    break;
  case 'audit-report':
    cmdAuditReport();
    break;
  default:
    console.log('Behavioral Calibration Lifecycle Manager — AD #16');
    console.log('');
    console.log('Commands:');
    console.log('  status              Show all entries with current status');
    console.log('  promote <id>        CANDIDATE → ACTIVE (requires directional_guidance)');
    console.log('  suspend <id>        ACTIVE → SUSPENDED (overcorrection detected)');
    console.log('  reactivate <id>     SUSPENDED → ACTIVE (guidance rewritten)');
    console.log('  retire <id>         Any → RETIRED (tendency corrected)');
    console.log('  decay               Apply confidence decay from current measurements');
    console.log('  audit-report        Full Sunday audit behavioral calibration report');
    console.log('');
    console.log('Lifecycle: CANDIDATE → ACTIVE → SUSPENDED → ACTIVE (rewritten) or RETIRED');
    break;
}
