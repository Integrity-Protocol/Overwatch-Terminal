#!/usr/bin/env node
'use strict';

/**
 * Behavioral Calibration Bridge — AD #16 Phase 2
 *
 * Reads cognitive trace data and gate review ledger to detect recurring
 * reasoning patterns. Outputs candidate calibration entries for human
 * review at the Sunday Blind Spot Audit.
 *
 * Three functions:
 *   aggregateViolationPatterns — Two-pass pattern detection
 *     Pass 1: Gate review ledger as index (which rules, layers, runs)
 *     Pass 2: Targeted trace extraction (actual reasoning evidence)
 *   generateCandidates — Output BC schema candidates for human review
 *   updateMeasurements — Refresh active entry frequency/magnitude
 *
 * This module does NOT write to production files.
 * Output is to console or a staging file for Sunday audit review.
 *
 * The Integrity Protocol (Patent Pending) — Timothy Joseph Wrenn
 */

const path = require('path');
const fs   = require('fs');

const DATA_DIR    = path.join(__dirname, '..', 'data');
const CONFIG_DIR  = path.join(__dirname, '..', 'config');

function log(msg)  { console.log(`[calibration] ${msg}`); }
function warn(msg) { console.warn(`[calibration] ⚠️ ${msg}`); }

// ─── Configuration Loading ───────────────────────────────────────────────────

function loadDomainConfig() {
  const configPath = path.join(CONFIG_DIR, 'domain.json');
  if (!fs.existsSync(configPath)) {
    warn('domain.json not found — using defaults');
    return {};
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function loadCalibrationEntries() {
  const calPath = path.join(DATA_DIR, 'behavioral-calibration.json');
  if (!fs.existsSync(calPath)) {
    warn('behavioral-calibration.json not found — returning empty');
    return [];
  }
  return JSON.parse(fs.readFileSync(calPath, 'utf8'));
}

function loadGateReviewLedger() {
  const ledgerPath = path.join(DATA_DIR, 'gate-review-ledger.json');
  if (!fs.existsSync(ledgerPath)) {
    warn('gate-review-ledger.json not found');
    return [];
  }
  return JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
}

/**
 * Discover and load trace files sorted by recency.
 * Uses trace-index.json if available, falls back to directory scan.
 */
function discoverTraceFiles(maxFiles) {
  const indexPath = path.join(DATA_DIR, 'trace-index.json');
  let fileList;

  if (fs.existsSync(indexPath)) {
    fileList = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  } else {
    fileList = fs.readdirSync(DATA_DIR)
      .filter(f => f.startsWith('cognitive-trace-') && f.endsWith('.json'))
      .sort()
      .reverse();
  }

  return fileList.slice(0, maxFiles);
}

// ─── Pass 1: Gate Review Ledger as Index ─────────────────────────────────────

/**
 * Builds an index from the gate review ledger:
 *   - Which rules fire most frequently
 *   - Which layers they concentrate in
 *   - Which runs (by timestamp) contain them
 *
 * Returns: {
 *   ruleIndex: { 'LZ-RC-001': { total: N, byLayer: { L1: N, ... }, runs: Set, examples: [] } },
 *   runTimestamps: Set of all run timestamps in window
 * }
 */
function buildLedgerIndex(gateLedger, measurementWindow) {
  // Take only the most recent entries within the measurement window
  // Each run produces ~4 entries (one per layer)
  const entriesNeeded = measurementWindow * 4;
  const windowEntries = gateLedger.slice(-entriesNeeded);

  const ruleIndex = {};
  const runTimestamps = new Set();

  for (const entry of windowEntries) {
    const layer = `L${entry.layer}`;
    // Group runs by the hour to cluster the 4 layer entries from one pipeline run
    const runKey = entry.timestamp.substring(0, 13); // YYYY-MM-DDTHH
    runTimestamps.add(runKey);

    if (!entry.gate_result || !Array.isArray(entry.gate_result.violations)) continue;

    for (const v of entry.gate_result.violations) {
      const rule = v.rule_violated;
      if (!rule) continue;

      if (!ruleIndex[rule]) {
        ruleIndex[rule] = { total: 0, byLayer: {}, runs: new Set(), examples: [] };
      }

      ruleIndex[rule].total++;
      ruleIndex[rule].byLayer[layer] = (ruleIndex[rule].byLayer[layer] || 0) + 1;
      ruleIndex[rule].runs.add(runKey);

      // Collect up to 10 examples for pattern evidence
      if (ruleIndex[rule].examples.length < 10) {
        ruleIndex[rule].examples.push({
          timestamp: entry.timestamp,
          layer,
          finding: v.finding,
          violation: v.violation,
          severity: v.severity
        });
      }
    }
  }

  return { ruleIndex, runTimestamps };
}

// ─── Pass 2: Targeted Trace Extraction ───────────────────────────────────────

/**
 * For high-frequency rules identified by Pass 1, extract deeper reasoning
 * context from the cognitive trace files.
 *
 * Only opens trace files for runs where the target rules fired.
 * Only examines the specific layer gates where violations occurred.
 *
 * @param {Object} ruleIndex — output from buildLedgerIndex
 * @param {string[]} traceFiles — list of trace filenames (most recent first)
 * @param {number} minFrequencyPct — minimum run frequency to qualify (0-1)
 * @param {number} totalRuns — total runs in the measurement window
 */
function extractTraceEvidence(ruleIndex, traceFiles, minFrequencyPct, totalRuns) {
  // Identify which rules qualify for deeper extraction
  const qualifyingRules = {};
  for (const [rule, data] of Object.entries(ruleIndex)) {
    const runFreq = data.runs.size / totalRuns;
    if (runFreq >= minFrequencyPct) {
      qualifyingRules[rule] = {
        ...data,
        runFrequency: data.runs.size,
        totalRuns,
        frequencyPct: runFreq,
        // Determine primary layer (highest concentration)
        primaryLayer: Object.entries(data.byLayer)
          .sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown',
        // Trace-extracted evidence (populated below)
        traceExamples: []
      };
    }
  }

  if (Object.keys(qualifyingRules).length === 0) {
    log('No rules exceed minimum frequency threshold — no trace extraction needed');
    return qualifyingRules;
  }

  log(`Pass 2: ${Object.keys(qualifyingRules).length} rules qualify for trace extraction`);

  // Map which layers to examine per rule
  const ruleLayers = {};
  for (const [rule, data] of Object.entries(qualifyingRules)) {
    ruleLayers[rule] = Object.keys(data.byLayer);
  }

  // Gate name mapping for trace file structure
  const layerGateNames = {
    'L1': 'perception_gate',
    'L2': 'contextualization_gate',
    'L3': 'inference_gate',
    'L4': 'judgment_gate'
  };

  // Open trace files and extract targeted evidence
  let tracesRead = 0;
  const maxTraceExamples = 5; // Per rule, from trace files

  for (const traceFile of traceFiles) {
    const tracePath = path.join(DATA_DIR, traceFile);
    if (!fs.existsSync(tracePath)) continue;

    let trace;
    try {
      trace = JSON.parse(fs.readFileSync(tracePath, 'utf8'));
    } catch (e) {
      warn(`Failed to read trace ${traceFile}: ${e.message}`);
      continue;
    }

    tracesRead++;

    if (!Array.isArray(trace.signals)) continue;

    // For each qualifying rule, check only the relevant layer gates
    for (const [rule, data] of Object.entries(qualifyingRules)) {
      if (data.traceExamples.length >= maxTraceExamples) continue;

      const targetLayers = ruleLayers[rule];

      for (const signal of trace.signals) {
        if (data.traceExamples.length >= maxTraceExamples) break;

        for (const layer of targetLayers) {
          const gateName = layerGateNames[layer];
          const gate = signal[gateName];
          if (!gate || !Array.isArray(gate.violations)) continue;

          for (const v of gate.violations) {
            if (v.rule_violated !== rule) continue;
            if (data.traceExamples.length >= maxTraceExamples) break;

            data.traceExamples.push({
              run_timestamp: trace._run_timestamp,
              signal_id: signal.signal_ids?.[0] || 'unknown',
              signal_name: signal.perception?.signal || 'unknown',
              signal_category: signal.perception?.category || 'unknown',
              layer,
              finding: v.finding,
              violation: v.violation,
              severity: v.severity
            });
          }
        }
      }
    }
  }

  log(`Pass 2 complete: read ${tracesRead} trace files`);
  return qualifyingRules;
}

// ─── Function 1: aggregateViolationPatterns ──────────────────────────────────

/**
 * Two-pass pattern detection:
 *   Pass 1: Gate review ledger → rule frequency index
 *   Pass 2: Cognitive trace files → reasoning evidence extraction
 *
 * @param {Object} options
 * @param {number} options.measurementWindow — runs to analyze (default from config)
 * @param {number} options.minFrequencyPct — minimum run frequency (default 0.5 = 50%)
 * @returns {Object} Pattern data keyed by rule ID
 */
function aggregateViolationPatterns(options = {}) {
  const config = loadDomainConfig();
  const measurementWindow = options.measurementWindow
    || config.calibration_measurement_window_default
    || 25;
  const minFrequencyPct = options.minFrequencyPct || 0.5;

  log(`=== Behavioral Calibration: Pattern Aggregation ===`);
  log(`Measurement window: ${measurementWindow} runs`);
  log(`Minimum frequency: ${(minFrequencyPct * 100).toFixed(0)}% of runs`);

  // Pass 1: Build index from gate review ledger
  const gateLedger = loadGateReviewLedger();
  if (gateLedger.length === 0) {
    warn('Gate review ledger is empty — cannot aggregate patterns');
    return {};
  }

  const { ruleIndex, runTimestamps } = buildLedgerIndex(gateLedger, measurementWindow);
  const totalRuns = runTimestamps.size;

  log(`Pass 1 complete: ${Object.keys(ruleIndex).length} rules found across ${totalRuns} runs`);

  // Report top rules from ledger index
  const sortedRules = Object.entries(ruleIndex)
    .map(([rule, data]) => ({ rule, runCount: data.runs.size, total: data.total }))
    .sort((a, b) => b.runCount - a.runCount);

  log('Top rules by run frequency:');
  for (const r of sortedRules.slice(0, 10)) {
    log(`  ${r.rule}: ${r.runCount}/${totalRuns} runs (${r.total} total occurrences)`);
  }

  // Pass 2: Extract trace evidence for qualifying rules
  const traceFiles = discoverTraceFiles(measurementWindow);
  log(`Found ${traceFiles.length} trace files for Pass 2`);

  const patterns = extractTraceEvidence(ruleIndex, traceFiles, minFrequencyPct, totalRuns);

  return patterns;
}

// ─── Function 2: generateCandidates ──────────────────────────────────────────

/**
 * Generate CANDIDATE calibration entries from detected patterns.
 *
 * - Filters out rules that already have ACTIVE or CANDIDATE entries
 * - Outputs BC schema with documented_tendency from trace evidence
 * - directional_guidance is a PLACEHOLDER — human must write the prescription
 *
 * @param {Object} patterns — output from aggregateViolationPatterns
 * @returns {Array} Candidate calibration entries
 */
function generateCandidates(patterns) {
  const existing = loadCalibrationEntries();
  const config = loadDomainConfig();

  // Rules that already have ACTIVE or CANDIDATE entries
  const coveredRules = new Set(
    existing
      .filter(e => e.status === 'ACTIVE' || e.status === 'CANDIDATE')
      .map(e => e.source_rule)
  );

  // Find the next BC ID number
  const existingIds = existing.map(e => parseInt(e.id.replace('BC-', ''), 10)).filter(n => !isNaN(n));
  let nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;

  const candidates = [];

  for (const [rule, data] of Object.entries(patterns)) {
    if (coveredRules.has(rule)) {
      log(`Skipping ${rule} — already has ACTIVE or CANDIDATE entry`);
      continue;
    }

    // Build documented_tendency from trace examples
    const exampleFindings = (data.traceExamples || data.examples || [])
      .slice(0, 3)
      .map(ex => `"${ex.finding.substring(0, 150)}${ex.finding.length > 150 ? '...' : ''}"`)
      .join('; ');

    // Determine target layers (all layers where the rule fires)
    const targetLayers = Object.entries(data.byLayer)
      .sort((a, b) => b[1] - a[1])
      .map(([layer]) => layer);

    // Determine signal categories from trace examples
    const categories = new Set(
      (data.traceExamples || []).map(ex => ex.signal_category).filter(Boolean)
    );
    const signalCategories = categories.size > 0 ? [...categories] : ['all'];

    const candidate = {
      id: `BC-${String(nextId).padStart(3, '0')}`,
      created: new Date().toISOString().substring(0, 10),
      last_updated: new Date().toISOString().substring(0, 10),
      calibration_type: 'TENDENCY_CORRECTION',
      status: 'CANDIDATE',

      source_rule: rule,
      target_layers: targetLayers,
      signal_categories: signalCategories,
      pattern_type: 'RECURRING_VIOLATION',

      frequency: `${data.runFrequency}/${data.totalRuns} runs`,
      magnitude: `${data.total} occurrences (${targetLayers.map(l => `${l}: ${data.byLayer[l] || 0}`).join(', ')})`,
      last_measured: new Date().toISOString().substring(0, 10),
      measurement_window: `${data.totalRuns} runs`,

      documented_tendency: `[AUTO-DETECTED] Rule ${rule} fires in ${data.runFrequency}/${data.totalRuns} runs. Primary layer: ${data.primaryLayer}. Example findings: ${exampleFindings || 'See gate review ledger.'}`,

      directional_guidance: '[HUMAN REVIEW REQUIRED] The system detected the pattern. The Incident Commander must write the corrective guidance. What should the system do differently when it encounters this reasoning pattern?',

      confidence: data.frequencyPct >= 0.8 ? 'HIGH' : data.frequencyPct >= 0.6 ? 'MEDIUM' : 'LOW',

      decay_trigger: `If frequency drops below ${Math.round(data.totalRuns * (config.calibration_decay_high_to_medium || 0.4))}/${data.totalRuns} runs, reduce confidence. If below ${Math.round(data.totalRuns * (config.calibration_decay_medium_to_retire || 0.2))}/${data.totalRuns}, flag for retirement.`,

      overcorrection_watch: '[HUMAN REVIEW REQUIRED] Define what suppression would look like for this specific tendency.',
      overcorrection_metric: null,
      overcorrection_metric_layer: data.primaryLayer,
      overcorrection_threshold_override: null,

      source_corrections: [],
      falsification_criteria: null,
      notes: `Auto-generated candidate from behavioral calibration bridge. ${(data.traceExamples || []).length} trace examples extracted. Requires human review before activation.`
    };

    candidates.push(candidate);
    nextId++;
  }

  log(`Generated ${candidates.length} new candidate(s)`);
  return candidates;
}

// ─── Function 3: updateMeasurements ──────────────────────────────────────────

/**
 * Refresh frequency and magnitude for ACTIVE calibration entries
 * using current gate review ledger and trace data.
 *
 * Detects decay: flags entries whose frequency has dropped below
 * configured thresholds.
 *
 * Does NOT modify behavioral-calibration.json — outputs recommendations
 * for Sunday audit review.
 *
 * @param {Object} patterns — output from aggregateViolationPatterns
 * @returns {Array} Update recommendations
 */
function updateMeasurements(patterns) {
  const existing = loadCalibrationEntries();
  const config = loadDomainConfig();

  const decayHighToMedium = config.calibration_decay_high_to_medium || 0.4;
  const decayMediumToRetire = config.calibration_decay_medium_to_retire || 0.2;

  const recommendations = [];

  for (const entry of existing) {
    if (entry.status !== 'ACTIVE') continue;

    const rule = entry.source_rule;
    const pattern = patterns[rule];

    if (!pattern) {
      // Rule not found in current measurement window
      recommendations.push({
        id: entry.id,
        source_rule: rule,
        action: 'REVIEW',
        reason: `Rule ${rule} did not appear in current measurement window. May need retirement or the measurement window may be too narrow.`,
        current_confidence: entry.confidence,
        recommended_confidence: null,
        current_frequency: entry.frequency,
        new_frequency: '0/? runs'
      });
      continue;
    }

    const frequencyRatio = pattern.runFrequency / pattern.totalRuns;
    const newFrequency = `${pattern.runFrequency}/${pattern.totalRuns} runs`;
    const newMagnitude = `${pattern.total} occurrences (${Object.entries(pattern.byLayer).map(([l, c]) => `${l}: ${c}`).join(', ')})`;

    let recommendedConfidence = entry.confidence;
    let action = 'UPDATE';
    let reason = `Refreshed measurements: ${newFrequency}, ${newMagnitude}`;

    if (entry.confidence === 'HIGH' && frequencyRatio < decayHighToMedium) {
      recommendedConfidence = 'MEDIUM';
      action = 'DECAY';
      reason = `Frequency ratio ${(frequencyRatio * 100).toFixed(0)}% is below HIGH→MEDIUM threshold (${(decayHighToMedium * 100).toFixed(0)}%). Recommend confidence decay.`;
    } else if (frequencyRatio < decayMediumToRetire) {
      recommendedConfidence = 'RETIRE_REVIEW';
      action = 'RETIRE_REVIEW';
      reason = `Frequency ratio ${(frequencyRatio * 100).toFixed(0)}% is below retirement threshold (${(decayMediumToRetire * 100).toFixed(0)}%). Recommend retirement review.`;
    }

    recommendations.push({
      id: entry.id,
      source_rule: rule,
      action,
      reason,
      current_confidence: entry.confidence,
      recommended_confidence: recommendedConfidence,
      current_frequency: entry.frequency,
      new_frequency: newFrequency,
      new_magnitude: newMagnitude,
      new_last_measured: new Date().toISOString().substring(0, 10)
    });
  }

  log(`Measurement update: ${recommendations.length} active entries reviewed`);
  return recommendations;
}

// ─── CLI Entry Point ─────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0] || 'report';

  if (command === 'report') {
    // Full report: aggregate patterns, show candidates, show measurement updates
    log('Running full behavioral calibration report...\n');

    const patterns = aggregateViolationPatterns();
    console.log('');

    const candidates = generateCandidates(patterns);
    if (candidates.length > 0) {
      console.log('\n=== NEW CANDIDATE ENTRIES ===\n');
      for (const c of candidates) {
        console.log(`${c.id} | ${c.source_rule} | ${c.frequency} | ${c.confidence}`);
        console.log(`  Tendency: ${c.documented_tendency.substring(0, 200)}...`);
        console.log(`  Layers: ${c.target_layers.join(', ')}`);
        console.log('');
      }
    } else {
      console.log('\nNo new candidates — all qualifying rules already have entries.\n');
    }

    const updates = updateMeasurements(patterns);
    if (updates.length > 0) {
      console.log('=== MEASUREMENT UPDATES (ACTIVE ENTRIES) ===\n');
      for (const u of updates) {
        const flag = u.action === 'DECAY' ? ' ⚠️ DECAY' : u.action === 'RETIRE_REVIEW' ? ' 🔴 RETIRE?' : '';
        console.log(`${u.id} | ${u.source_rule} | ${u.current_frequency} → ${u.new_frequency}${flag}`);
        console.log(`  ${u.reason}`);
        console.log('');
      }
    }

  } else if (command === 'candidates') {
    // Just generate candidates
    const patterns = aggregateViolationPatterns();
    const candidates = generateCandidates(patterns);
    console.log(JSON.stringify(candidates, null, 2));

  } else if (command === 'measurements') {
    // Just update measurements
    const patterns = aggregateViolationPatterns();
    const updates = updateMeasurements(patterns);
    console.log(JSON.stringify(updates, null, 2));

  } else {
    console.log('Usage: node behavioral-calibration.js [report|candidates|measurements]');
    console.log('  report       — Full report (default). Shows patterns, candidates, and measurement updates.');
    console.log('  candidates   — Generate new candidate entries as JSON.');
    console.log('  measurements — Update measurements for active entries as JSON.');
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  aggregateViolationPatterns,
  generateCandidates,
  updateMeasurements,
  // Exposed for testing/evolution library
  buildLedgerIndex,
  extractTraceEvidence
};
