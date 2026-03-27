#!/usr/bin/env node
'use strict';

/**
 * Overwatch Terminal — x402 Base Agent Module
 * AD #19 Phase 2: Base/EVM payment path for multi-chain acquisition
 *
 * Executes x402 payments on Base (EVM) using USDC via the @x402/fetch library.
 * First channel: Firecrawl x402 search endpoint.
 *
 * This module is a library — imported by x402-constrained-acquisition.js
 * when the routing engine selects a Base channel. It is NOT a standalone
 * script like x402-agent.js (the XRPL manual-trigger agent).
 *
 * The @x402/fetch library handles the entire 402→pay→200 flow automatically:
 *   1. POST to endpoint → receive 402 with payment requirements
 *   2. Library signs USDC transfer authorization (EIP-3009)
 *   3. Library retries with PAYMENT-SIGNATURE header
 *   4. Facilitator settles on Base mainnet
 *   5. Endpoint returns 200 with data
 *
 * paper_trade_only: When true (default), logs what WOULD be purchased
 * without executing any payment. No wallet key required for paper trading.
 *
 * The Integrity Protocol (Patent Pending) — Timothy Joseph Wrenn
 */

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`[x402-base] ${msg}`); }
function warn(msg) { console.warn(`[x402-base] WARN: ${msg}`); }
function err(msg)  { console.error(`[x402-base] ERROR: ${msg}`); }

// ─── executeBaseAcquisition ───────────────────────────────────────────────────

/**
 * Execute (or paper trade) a data acquisition request on a Base/EVM channel.
 *
 * @param {object} channel    — Channel config from domain.json acquisition_channels[]
 * @param {string} query      — The falsifiable question / search query
 * @param {object} [opts]     — Optional overrides
 * @param {string} [opts.baseWalletKey]  — Private key (hex, 0x-prefixed). Falls back to env.
 * @param {number} [opts.limit]          — Max search results (default: 5, max: 10)
 * @param {boolean} [opts.scrapeContent] — Include markdown content (default: true)
 * @returns {object} Structured result for paper trade logger / outcome tracking
 */
async function executeBaseAcquisition(channel, query, opts = {}) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  // ── Build result skeleton ─────────────────────────────────────────────────
  const result = {
    channel_id: channel.id,
    channel_name: channel.name,
    settlement_network: channel.network,
    settlement_asset: channel.settlement_asset,
    query: query,
    status: null,
    paper_trade: channel.paper_trade_only !== false,
    cost_usd: channel.cost_per_request_usd || 0,
    data: null,
    error: null,
    duration_ms: null,
    timestamp: timestamp
  };

  // ── Paper trade path ──────────────────────────────────────────────────────
  if (channel.paper_trade_only !== false) {
    log(`PAPER TRADE: Would query "${query.slice(0, 80)}..." via ${channel.name}`);
    log(`  Channel: ${channel.id} | Network: ${channel.network} | Cost: ${channel.cost_per_request_usd}`);
    log(`  Endpoint: ${channel.facilitator}`);
    result.status = 'PAPER_TRADE';
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  // ── Live acquisition path ─────────────────────────────────────────────────
  // Lazy-load x402 packages — only needed for live execution
  let wrapFetchWithPayment, x402Client, registerExactEvmScheme, privateKeyToAccount;
  try {
    const fetchMod = require('@x402/fetch');
    wrapFetchWithPayment = fetchMod.wrapFetchWithPayment;

    const coreMod = require('@x402/core/client');
    x402Client = coreMod.x402Client;

    const evmMod = require('@x402/evm/exact/client');
    registerExactEvmScheme = evmMod.registerExactEvmScheme;

    const viemMod = require('viem/accounts');
    privateKeyToAccount = viemMod.privateKeyToAccount;
  } catch (e) {
    err(`Failed to load x402 Base dependencies: ${e.message}`);
    err('Run: cd scripts && npm install');
    result.status = 'ERROR';
    result.error = `Missing dependencies: ${e.message}`;
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  // ── Wallet setup ──────────────────────────────────────────────────────────
  const walletKey = opts.baseWalletKey || process.env.BASE_WALLET_PRIVATE_KEY;
  if (!walletKey) {
    err('No BASE_WALLET_PRIVATE_KEY — cannot execute live acquisition');
    result.status = 'ERROR';
    result.error = 'Missing BASE_WALLET_PRIVATE_KEY';
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  let signer;
  try {
    // Ensure 0x prefix
    const key = walletKey.startsWith('0x') ? walletKey : `0x${walletKey}`;
    signer = privateKeyToAccount(key);
    log(`Base wallet: ${signer.address}`);
  } catch (e) {
    err(`Invalid BASE_WALLET_PRIVATE_KEY: ${e.message}`);
    result.status = 'ERROR';
    result.error = `Invalid wallet key: ${e.message}`;
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  // ── Build x402 client ─────────────────────────────────────────────────────
  let fetchWithPayment;
  try {
    const client = new x402Client();
    registerExactEvmScheme(client, { signer });
    fetchWithPayment = wrapFetchWithPayment(fetch, client);
    log('x402 Base client initialized');
  } catch (e) {
    err(`Failed to initialize x402 client: ${e.message}`);
    result.status = 'ERROR';
    result.error = `x402 client init failed: ${e.message}`;
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  // ── Execute Firecrawl search ──────────────────────────────────────────────
  const endpoint = channel.facilitator;
  const limit = Math.min(opts.limit || 5, 10);
  const body = {
    query: query,
    limit: limit
  };

  // Include scrape options for markdown content by default
  if (opts.scrapeContent !== false) {
    body.scrapeOptions = {
      formats: ['markdown'],
      onlyMainContent: true
    };
  }

  log(`Executing: POST ${endpoint}`);
  log(`  Query: "${query.slice(0, 100)}"`);
  log(`  Limit: ${limit} | Scrape: ${opts.scrapeContent !== false}`);

  try {
    const response = await fetchWithPayment(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const data = await response.json();
    const resultCount = Array.isArray(data.data) ? data.data.length : 0;

    log(`Success: ${resultCount} result(s) returned`);

    result.status = 'SUCCESS';
    result.data = {
      result_count: resultCount,
      results: (data.data || []).map(item => ({
        title: item.title || null,
        description: item.description || null,
        url: item.url || null,
        has_markdown: !!(item.markdown && item.markdown.length > 0),
        markdown_length: item.markdown ? item.markdown.length : 0
      }))
    };
    result.duration_ms = Date.now() - startTime;
    return result;

  } catch (e) {
    err(`Firecrawl search failed: ${e.message}`);
    result.status = 'ERROR';
    result.error = e.message;
    result.duration_ms = Date.now() - startTime;
    return result;
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { executeBaseAcquisition };
