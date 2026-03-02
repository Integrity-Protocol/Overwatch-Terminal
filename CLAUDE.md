# Overwatch Terminal — Claude Code Context

## What This Is
Autonomous AI intelligence system monitoring an institutional adoption thesis. Four-layer cognitive architecture (SWEEP → CONTEXTUALIZE → INFER → RECONCILE) with epistemological guardrails, circuit breakers, and a corrections ledger. Running in production on GitHub Actions, twice daily. Built entirely by directing AI tools — the builder has zero coding background.

## Critical Build Rules
- NEVER modify a file without stating: what changes, what it affects downstream, what could break
- One change at a time. Verify before moving to next.
- After ANY commit touching fetch-data.js, analyze-thesis.js, index.html, or dashboard-data.json: trace the change forward AND backward
- No silent failures. Every error must surface. No empty catch blocks.
- If restoring a file from a prior commit, validate the FULL data contract between that file and everything it connects to
- Tim cannot read code. Provide complete file replacements, not diffs. Explain changes in plain language.
- Do NOT recalibrate thresholds without explicit instruction.
- Comments explain WHY, not WHAT. Reference architectural decision documents.

## File Map
- scripts/fetch-data.js — Data pipeline, 7 active API sources, writes dashboard-data.json, runs data contract validation
- scripts/analyze-thesis.js — Claude API analyst (currently 2-layer: SWEEP + ASSESS), writes 360-report.json + 360-history.json, sends Telegram briefing with pipeline health line
- scripts/apply-analysis.js — Merges analysis results into dashboard-data.json (etf, supply, xrpl_metrics, bear_case, probability, stress fields)
- scripts/x402-agent.js — XRPL mainnet payment agent (manual trigger only)
- scripts/thesis-context.md — Thesis context fed to Claude API analyst. Lives in scripts/, NOT repo root.
- scripts/pipeline-health.json — Written by fetch-data.js validation, read by analyze-thesis.js for Telegram heartbeat
- data-contract.json — Lists every field index.html expects from dashboard-data.json. Source of truth for validation.
- data/360-report.json — Latest analysis output
- data/360-history.json — Archive of all assessments (last 60 entries)
- index.html — Dashboard frontend, reads dashboard-data.json on load

## Data Flow
fetch-data.js writes dashboard-data.json (partial: macro, rlusd, xrp, thesis_scores) → validates against data-contract.json → writes pipeline-health.json → analyze-thesis.js runs Claude API → writes 360-report.json + 360-history.json → sends Telegram with pipeline health appended → apply-analysis.js merges analysis into dashboard-data.json (etf, supply, xrpl_metrics, bear_case, probability, stress) → git commit + push

## GitHub Actions
- Cron: 12:00 UTC and 00:00 UTC daily
- Workflow: .github/workflows/analyze-thesis.yml
- Steps: checkout → setup node → npm install → fetch-data.js → analyze-thesis.js → apply-analysis.js → git commit/push

## Key Field Names
- index.html reads thesis_scores (NOT thesis). Bug fixed March 3, 2026.
- fetch-data.js owns 18 fields. analyze-thesis.js/apply-analysis.js own 73 fields. x402-agent.js owns 23 fields. See data-contract.json for full list.
- kill_switches in dashboard-data.json is written by fetch-data.js but NOT read by index.html. Kill switch display comes from data/360-report.json.

## What's Built and Running
- Layer 1 SWEEP + Layer 2 ASSESS (current two-layer system)
- Automated twice-daily analysis via GitHub Actions
- Telegram briefing with pipeline health heartbeat
- Data contract validation (18 fetch fields checked every run)
- Dashboard on GitHub Pages
- x402 agent (12 mainnet transactions, 9,000 drops lifetime spend)

## What's Being Built (March 3-7, 2026)
- Layer 2 CONTEXTUALIZE (replaces current ASSESS — adds knowledge audit phase)
- Layer 3 INFER (new — strategic game theory with circuit breakers)
- Layer 4 RECONCILE (new — final judgment with burden of proof)
- Corrections ledger (data/corrections-ledger.json + data/rejection-log.json)
- Compound stress matrix integration into Layer 2

## Architectural Authority
If code contradicts an architectural decision document, the document wins. The code has a bug. Architectural documents live in the Claude.ai project files, not in this repo. Key documents:
- OVERWATCH-4-LAYER-ARCHITECTURE.md
- OVERWATCH-CIRCUIT-BREAKERS.md
- ARCHITECTURE-DECISION-CORRECTIONS-LEDGER.md
- ARCHITECTURE-DECISION-LAYER2-CONTEXTUALIZE.md
- LAYER-2-3-4-PROMPTS-DRAFT.md (PRIVATE — never commit to public repo)
