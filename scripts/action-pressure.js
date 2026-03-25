#!/usr/bin/env node
'use strict';

/**
 * Action Pressure Calculator — AD #18: Action Epistemology Decoupling
 *
 * Deterministic module. No AI calls. No randomness.
 * Reads 360-history.json and domain config.
 * Outputs:
 *   - Sanitized context for Layer 4 (tier + signals + directive)
 *   - Full telemetry for gates and Blind Auditor
 *
 * INFORMATION ASYMMETRY (Anti-Gaming):
 *   Layer 4 sees: pressure_tier, persistence_signals, trajectory_signals, directive.
 *   Layer 4 NEVER sees: raw_index, component weights, formulas, tier boundaries.
 *   Gates/Auditor see: everything.
 *
 * Three instruments:
 *   1. Action Pressure Index (accumulated stress over time)
 *      - Tension duration pressure
 *      - Sustained directional divergence
 *      - Status-action divergence duration
 *   2. Tension Persistence Escalation (unanswered radio calls)
 *   3. Trajectory Anticipation (the softening floor)
 */

const path = require('path');
const fs   = require('fs');

function log(msg)  { console.log(`[action-pressure] ${msg}`); }
function warn(msg) { console.warn(`[action-pressure] WARN: ${msg}`); }

// ─── Action-Direction Mapping ─────────────────────────────────────────────────

const STATUS_DIRECTION = {
  STRENGTHENING: 1,
  STABLE: 0,
  WEAKENING: -1,
  CONTESTED: 0,    // No directional signal
  INSUFFICIENT_EVIDENCE: 0,
  FALSIFIED: -1,
};

const ACTION_ESCALATION = {
  HOLD_POSITION: 0,
  INCREASE_MONITORING: 1,
  REDUCE_EXPOSURE: 2,
  EXIT_SIGNAL: 3,
  // Water domain equivalents
  MAINTAIN_OPERATIONS: 0,
  INCREASE_INSPECTION: 1,
  REDUCE_LOAD: 2,
  EMERGENCY_SHUTDOWN: 3,
};

// ─── Instrument 1: Action Pressure Index ──────────────────────────────────────

/**
 * Compute tension duration pressure.
 * For each active tension past its resolution window, contribute pressure
 * proportional to how far overdue it is, weighted by impact score.
 */
function computeTensionDurationPressure(currentTensions, domainConfig) {
  if (!currentTensions || currentTensions.length === 0) return 0;

  const cap = (domainConfig && domainConfig.active_tension_cap) || 8;

  // Map resolution windows to approximate run counts (2 runs/day)
  const windowToRuns = { hours: 1, days: 4, weeks: 14, months: 60 };

  let totalPressure = 0;
  const activeTensions = currentTensions.filter(t =>
    t.classification === 'ACTIVE' || !t.classification // backward compat
  );

  for (const tension of activeTensions) {
    const runsPersisted = tension.runs_persisted || 0;
    const window = tension.expected_resolution_window || 'weeks';
    const expectedRuns = windowToRuns[window] || 14;
    const impactScore = tension.impact_score || 3;

    // Only overdue tensions contribute
    const overdue = Math.max(0, (runsPersisted - expectedRuns) / expectedRuns);
    const contribution = overdue * (impactScore / 5);
    totalPressure += contribution;
  }

  // Normalize by cap
  return Math.min(1.0, totalPressure / cap);
}

/**
 * Compute sustained directional divergence.
 * For each compound index, check if convergence_direction has been
 * consistently directional across lookback window AND diverges from
 * current action.
 */
function computeSustainedDivergence(history, currentAction, domainConfig) {
  const lookback = (domainConfig && domainConfig.action_pressure && domainConfig.action_pressure.lookback_window) || 5;

  if (!history || history.length < 2) return 0;

  const recentHistory = history.slice(-lookback);
  if (recentHistory.length < 2) return 0;

  // Get compound indices from most recent entry
  const latestEntry = recentHistory[recentHistory.length - 1];
  const indices = latestEntry.compound_indices || [];
  if (indices.length === 0) return 0;

  const totalIndices = indices.length;
  let divergentCount = 0;

  for (const idx of indices) {
    const indexId = idx.id;
    const isInverse = idx.inverse || false;

    // Collect directions across lookback window
    const directions = [];
    for (const entry of recentHistory) {
      const entryIndices = entry.compound_indices || [];
      const match = entryIndices.find(ci => ci.id === indexId);
      if (match && match.convergence_direction) {
        let dir = match.convergence_direction;
        // Flip inverse indices
        if (isInverse) {
          if (dir === 'POSITIVE') dir = 'NEGATIVE';
          else if (dir === 'NEGATIVE') dir = 'POSITIVE';
        }
        directions.push(dir);
      }
    }

    // Check for sustained directional consistency
    if (directions.length < 2) continue;

    const allPositive = directions.every(d => d === 'POSITIVE');
    const allNegative = directions.every(d => d === 'NEGATIVE');

    if (!allPositive && !allNegative) continue; // Not sustained or CONTESTED/UNDETERMINED

    // Check if direction diverges from current action
    const actionLevel = ACTION_ESCALATION[currentAction] ?? null;
    if (actionLevel === null) continue;

    if (allNegative && actionLevel <= 1) {
      // Indices say negative, action is passive (HOLD or MONITOR) → divergence
      divergentCount++;
    } else if (allPositive && actionLevel >= 1) {
      // Indices say positive, action is elevated (MONITOR or higher) → divergence
      divergentCount++;
    }
  }

  return Math.min(1.0, divergentCount / totalIndices);
}

/**
 * Compute status-action divergence duration.
 * Count consecutive runs where thesis_status is directional but action
 * has not changed.
 */
function computeStatusActionDivergence(history, domainConfig) {
  const maxDivergence = (domainConfig && domainConfig.action_pressure && domainConfig.action_pressure.max_divergence_runs) || 8;

  if (!history || history.length < 2) return 0;

  // Walk backward from most recent entry
  let consecutiveDivergent = 0;

  for (let i = history.length - 1; i >= 1; i--) {
    const current = history[i];
    const previous = history[i - 1];

    const statusDir = STATUS_DIRECTION[current.thesis_status] ?? 0;
    const currentAction = current.action_recommendation || current.tactical_recommendation;
    const previousAction = previous.action_recommendation || previous.tactical_recommendation;

    // Status is directional AND action hasn't changed
    if (statusDir !== 0 && currentAction === previousAction) {
      // Check if action is misaligned with status direction
      const actionLevel = ACTION_ESCALATION[currentAction] ?? 0;
      // WEAKENING (dir=-1) but action is passive (HOLD=0 or MONITOR=1)
      // STRENGTHENING (dir=1) but action is elevated (MONITOR=1 or higher)
      if ((statusDir === -1 && actionLevel <= 1) || (statusDir === 1 && actionLevel >= 1)) {
        consecutiveDivergent++;
      } else {
        break;
      }
    } else {
      break;
    }
  }

  return Math.min(1.0, consecutiveDivergent / maxDivergence);
}

/**
 * Compute the composite Action Pressure Index (0.0 - 1.0).
 */
function computeActionPressureIndex(history, currentTensions, currentAction, domainConfig) {
  const weights = {
    tension_duration: (domainConfig && domainConfig.action_pressure && domainConfig.action_pressure.tension_duration_weight) || 0.40,
    sustained_divergence: (domainConfig && domainConfig.action_pressure && domainConfig.action_pressure.index_trajectory_weight) || 0.35,
    status_action: (domainConfig && domainConfig.action_pressure && domainConfig.action_pressure.status_divergence_weight) || 0.25,
  };

  const tensionPressure = computeTensionDurationPressure(currentTensions, domainConfig);
  const divergencePressure = computeSustainedDivergence(history, currentAction, domainConfig);
  const statusPressure = computeStatusActionDivergence(history, domainConfig);

  const rawIndex = (tensionPressure * weights.tension_duration) +
                   (divergencePressure * weights.sustained_divergence) +
                   (statusPressure * weights.status_action);

  const index = Math.min(1.0, Math.max(0.0, rawIndex));

  return {
    raw_index: Math.round(index * 1000) / 1000,
    components: {
      tension_duration: Math.round(tensionPressure * 1000) / 1000,
      sustained_divergence: Math.round(divergencePressure * 1000) / 1000,
      status_action_divergence: Math.round(statusPressure * 1000) / 1000,
    },
    weights,
  };
}

/**
 * Map raw index to pressure tier.
 */
function getPressureTier(rawIndex, domainConfig) {
  const boundaries = (domainConfig && domainConfig.action_pressure && domainConfig.action_pressure.tier_boundaries) || [0.25, 0.50, 0.75];

  if (rawIndex <= boundaries[0]) return 'LOW_PRESSURE';
  if (rawIndex <= boundaries[1]) return 'MODERATE_PRESSURE';
  if (rawIndex <= boundaries[2]) return 'HIGH_PRESSURE';
  return 'CRITICAL_PRESSURE';
}

// ─── Instrument 2: Tension Persistence Escalation ─────────────────────────────

function computePersistenceSignals(currentTensions, history, domainConfig) {
  const signals = [];

  const criticalThreshold = (domainConfig && domainConfig.critical_persistence_threshold) || 10;
  const saturationAvgThreshold = (domainConfig && domainConfig.tension_persistence && domainConfig.tension_persistence.saturated_avg_threshold) || 3.5;
  const resolutionFloor = (domainConfig && domainConfig.tension_persistence && domainConfig.tension_persistence.resolution_rate_floor) || 0.20;
  const resolutionLookback = (domainConfig && domainConfig.tension_persistence && domainConfig.tension_persistence.resolution_lookback) || 10;
  const cap = (domainConfig && domainConfig.active_tension_cap) || 8;

  if (!currentTensions || currentTensions.length === 0) return signals;

  const activeTensions = currentTensions.filter(t =>
    t.classification === 'ACTIVE' || !t.classification
  );

  // Critical persistence: score 4-5 tensions past threshold
  for (const t of activeTensions) {
    const score = t.impact_score || 0;
    const runs = t.runs_persisted || 0;
    if (score >= 4 && runs >= criticalThreshold) {
      const name = t.tension || t.tension_id || 'unknown';
      signals.push(`Tension ${t.tension_id || 'unknown'} (${name.substring(0, 80)}) has remained unresolved at impact score ${score} for ${runs} consecutive cycles, exceeding the critical persistence threshold of ${criticalThreshold}.`);
    }
  }

  // Saturated tension field
  if (activeTensions.length >= cap) {
    const avgImpact = activeTensions.reduce((sum, t) => sum + (t.impact_score || 0), 0) / activeTensions.length;
    if (avgImpact >= saturationAvgThreshold) {
      signals.push(`Tension field is saturated: ${activeTensions.length}/${cap} active tensions, average impact score ${avgImpact.toFixed(1)}. Maximum analytical load with uniformly high-impact unresolved questions.`);
    }
  }

  // Resolution failure rate
  if (history && history.length >= 3) {
    const lookbackEntries = history.slice(-resolutionLookback);
    let totalResolved = 0;
    let totalDispositions = 0;

    for (const entry of lookbackEntries) {
      const dispositions = entry.previous_tension_dispositions || entry._layer4_raw?.previous_tension_dispositions || [];
      if (Array.isArray(dispositions)) {
        for (const d of dispositions) {
          totalDispositions++;
          if (d.disposition === 'RESOLVE') totalResolved++;
        }
      }
    }

    if (totalDispositions > 0) {
      const resolveRate = totalResolved / totalDispositions;
      if (resolveRate < resolutionFloor) {
        signals.push(`Resolution rate over last ${lookbackEntries.length} runs: ${resolveRate.toFixed(2)} (${totalResolved} of ${totalDispositions} tension dispositions resolved). Below floor of ${resolutionFloor}.`);
      }
    }
  }

  return signals;
}

// ─── Instrument 3: Trajectory Anticipation ────────────────────────────────────

function computeTrajectorySignals(history, pressureIndex, domainConfig) {
  const signals = [];

  const proximityRuns = (domainConfig && domainConfig.trajectory && domainConfig.trajectory.falsification_proximity_runs) || 2;
  const velocityLookback = (domainConfig && domainConfig.trajectory && domainConfig.trajectory.velocity_lookback) || 3;
  const observabilityLookback = (domainConfig && domainConfig.trajectory && domainConfig.trajectory.observability_lookback) || 5;

  if (!history || history.length < 2) return signals;

  // Falsification proximity rate
  const recentForFalsification = history.slice(-proximityRuns);
  if (recentForFalsification.length >= proximityRuns) {
    let consecutiveNearFalsification = 0;
    for (const entry of recentForFalsification) {
      const indices = entry.compound_indices || [];
      // Count indices at CONVERGING + NEGATIVE (or inverse at CONVERGING + POSITIVE)
      let negativeConvergingCount = 0;
      for (const idx of indices) {
        const isInverse = idx.inverse || false;
        const status = idx.convergence_status;
        const direction = idx.convergence_direction;
        if (status === 'CONVERGING') {
          if (!isInverse && direction === 'NEGATIVE') negativeConvergingCount++;
          if (isInverse && direction === 'POSITIVE') negativeConvergingCount++;
        }
      }
      if (negativeConvergingCount >= 2) {
        consecutiveNearFalsification++;
      }
    }

    if (consecutiveNearFalsification >= proximityRuns) {
      signals.push(`Falsification proximity: 2+ indices at CONVERGING_NEGATIVE for ${consecutiveNearFalsification} consecutive runs. One additional index triggers formal falsification review.`);
    }
  }

  // Action Pressure Index velocity
  // We can't compute previous API values without storing them, but we CAN
  // report the current value's trajectory from the status-action history
  if (history.length >= velocityLookback) {
    const recentStatuses = history.slice(-velocityLookback);
    const statusChanges = [];
    for (let i = 1; i < recentStatuses.length; i++) {
      const prev = recentStatuses[i - 1];
      const curr = recentStatuses[i];
      const prevDir = STATUS_DIRECTION[prev.thesis_status] ?? 0;
      const currDir = STATUS_DIRECTION[curr.thesis_status] ?? 0;
      statusChanges.push(currDir);
    }
    // Check if trajectory is consistently directional and accelerating
    const allNegative = statusChanges.every(d => d === -1);
    const allPositive = statusChanges.every(d => d === 1);
    if (allNegative) {
      signals.push(`Status trajectory: WEAKENING for ${statusChanges.length} consecutive runs. Sustained negative direction without interruption.`);
    } else if (allPositive) {
      signals.push(`Status trajectory: STRENGTHENING for ${statusChanges.length} consecutive runs. Sustained positive direction without interruption.`);
    }
  }

  // Redundancy erosion: observability declining
  if (history.length >= observabilityLookback) {
    const oldEntry = history[history.length - observabilityLookback];
    const newEntry = history[history.length - 1];

    const countAssessable = (entry) => {
      const indices = entry.compound_indices || [];
      let assessable = 0, total = 0;
      for (const idx of indices) {
        total += idx.total || 0;
        assessable += idx.assessable || 0;
      }
      return { assessable, total };
    };

    const oldObs = countAssessable(oldEntry);
    const newObs = countAssessable(newEntry);

    if (oldObs.total > 0 && newObs.total > 0 && newObs.assessable < oldObs.assessable) {
      signals.push(`Observability declining: ${newObs.assessable}/${newObs.total} components assessable, down from ${oldObs.assessable}/${oldObs.total} over the last ${observabilityLookback} runs.`);
    }
  }

  return signals;
}

// ─── Pressure Tier Directive ──────────────────────────────────────────────────

function getDirective(tier) {
  switch (tier) {
    case 'LOW_PRESSURE':
      return 'Standard analytical reasoning applies. No additional justification required for current action posture.';
    case 'MODERATE_PRESSURE':
      return 'Accumulated pressure detected. Acknowledge the pressure context and explain why your current action recommendation remains appropriate despite accumulated stress.';
    case 'HIGH_PRESSURE':
      return 'Burden of proof is inverted. You must provide explicit, verifiable evidence to justify continued inaction. Cite what specific development you expect and when it will resolve the pressure. Vague justifications are insufficient.';
    case 'CRITICAL_PRESSURE':
      return 'Extraordinary justification required for inaction. If you cannot cite specific imminent evidence that will resolve the accumulated pressure, you must change your action recommendation. The Blind Auditor has been notified.';
    default:
      return '';
  }
}

// ─── Main Calculation ─────────────────────────────────────────────────────────

/**
 * Calculate action pressure from history and current state.
 *
 * @param {object} opts
 * @param {Array}  opts.history          — 360-history.json entries
 * @param {Array}  opts.currentTensions  — Current run's unresolved tensions
 * @param {string} opts.currentAction    — Current action_recommendation
 * @param {object} opts.domainConfig     — domain.json
 *
 * @returns {{ layer4Context: object, telemetry: object }}
 *   - layer4Context: sanitized for Layer 4 (NO raw index, NO weights, NO formulas)
 *   - telemetry: full data for gates and Blind Auditor
 */
function calculateActionPressure(opts) {
  const { history, currentTensions, currentAction, domainConfig } = opts || {};

  // Compute Instrument 1: Action Pressure Index
  const pressureResult = computeActionPressureIndex(
    history || [], currentTensions || [], currentAction || 'HOLD_POSITION', domainConfig || {}
  );
  const tier = getPressureTier(pressureResult.raw_index, domainConfig);

  // Compute Instrument 2: Persistence Signals
  const persistenceSignals = computePersistenceSignals(
    currentTensions || [], history || [], domainConfig || {}
  );

  // Compute Instrument 3: Trajectory Signals
  const trajectorySignals = computeTrajectorySignals(
    history || [], pressureResult, domainConfig || {}
  );

  // Build directive
  const directive = getDirective(tier);

  // ── INFORMATION ASYMMETRY BOUNDARY ──
  // Layer 4 sees ONLY the sanitized context below.
  // It never sees raw_index, components, weights, or tier_boundaries.

  const layer4Context = {
    action_environment: {
      pressure_tier: tier,
      persistence_signals: persistenceSignals,
      trajectory_signals: trajectorySignals,
      directive: directive,
    }
  };

  // Gates and Auditor see everything.
  const telemetry = {
    pressure_telemetry: {
      raw_index: pressureResult.raw_index,
      tier: tier,
      components: pressureResult.components,
      weights: pressureResult.weights,
      tier_boundaries: (domainConfig && domainConfig.action_pressure && domainConfig.action_pressure.tier_boundaries) || [0.25, 0.50, 0.75],
    },
    persistence_signals: persistenceSignals,
    trajectory_signals: trajectorySignals,
  };

  log(`Pressure: ${pressureResult.raw_index.toFixed(3)} → ${tier} | Persistence: ${persistenceSignals.length} signals | Trajectory: ${trajectorySignals.length} signals`);

  return { layer4Context, telemetry };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  calculateActionPressure,
  // Exported for testing/auditing only — not for Layer 4
  computeActionPressureIndex,
  computeTensionDurationPressure,
  computeSustainedDivergence,
  computeStatusActionDivergence,
  computePersistenceSignals,
  computeTrajectorySignals,
  getPressureTier,
};
