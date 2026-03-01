/**
 * Demo: exercises the full internal pipeline with synthetic transactions.
 * No API keys required — prices are mocked.
 */

import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";
import { MODEL_VERSION } from "./config.js";
import { ChainId, TransactionType, TokenCategory, PriceSource, Confidence, JournalSide, CostBasisMethod } from "./interfaces/common.js";
import type { ClassifiedTransaction, PricedTokenAmount } from "./interfaces/output.js";
import { SqliteAdapter } from "./storage/sqlite.js";
import { ClassificationEngine } from "./core/classifiers/engine.js";
import { JournalEntryGenerator } from "./core/formatters/journal.js";
import { CostBasisEngine } from "./core/cost-basis/engine.js";
import { LotTracker } from "./core/cost-basis/lot-tracker.js";
import { ReconEventEmitter } from "./events/emitter.js";
import { toCanonicalCsv } from "./core/formatters/adapters/canonical.js";
import { toXeroCsv } from "./core/formatters/adapters/xero.js";
import type { RawTransaction } from "./core/connectors/types.js";

const DEMO_WALLET = "0x1234567890abcdef1234567890abcdef12345678";
const DEMO_CHAIN = ChainId.ETHEREUM;

// Synthetic raw transactions simulating real wallet activity
function makeSyntheticTransactions(): RawTransaction[] {
  const now = Math.floor(Date.now() / 1000);
  const hour = 3600;

  return [
    // 1. Receive 2 ETH (transfer in)
    {
      chain: DEMO_CHAIN,
      txHash: "0xaaa1111111111111111111111111111111111111111111111111111111111111",
      blockNumber: 19000001,
      blockTimestamp: now - 24 * hour,
      from: "0xfeedfeedfeedfeedfeedfeedfeedfeedfeedfeed",
      to: DEMO_WALLET,
      value: "2.0",
      gasUsed: "21000",
      gasPrice: "30000000000",
      gasFeeNative: "0.00063",
      success: true,
      tokenTransfers: [],
      internalTransactions: [],
      logs: [],
      rawData: {},
    },

    // 2. Swap 1 ETH → 3000 USDC on Uniswap V3
    {
      chain: DEMO_CHAIN,
      txHash: "0xbbb2222222222222222222222222222222222222222222222222222222222222",
      blockNumber: 19000050,
      blockTimestamp: now - 20 * hour,
      from: DEMO_WALLET,
      to: "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", // Uniswap V3 SwapRouter02
      value: "1.0",
      gasUsed: "150000",
      gasPrice: "25000000000",
      gasFeeNative: "0.00375",
      success: true,
      methodId: "0x5ae401dc", // multicall_deadline (Uniswap V3)
      tokenTransfers: [
        {
          token: { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6, category: TokenCategory.STABLECOIN, chain: DEMO_CHAIN },
          from: "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
          to: DEMO_WALLET,
          amount: "3000.00",
          rawAmount: "3000000000",
          logIndex: 0,
        },
      ],
      internalTransactions: [],
      logs: [],
      rawData: {},
    },

    // 3. Supply 2000 USDC to Aave V3
    {
      chain: DEMO_CHAIN,
      txHash: "0xccc3333333333333333333333333333333333333333333333333333333333333",
      blockNumber: 19000100,
      blockTimestamp: now - 16 * hour,
      from: DEMO_WALLET,
      to: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2", // Aave V3 Pool
      value: "0",
      gasUsed: "200000",
      gasPrice: "20000000000",
      gasFeeNative: "0.004",
      success: true,
      methodId: "0x617ba037", // supply
      tokenTransfers: [
        {
          token: { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6, category: TokenCategory.STABLECOIN, chain: DEMO_CHAIN },
          from: DEMO_WALLET,
          to: "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2",
          amount: "2000.00",
          rawAmount: "2000000000",
          logIndex: 0,
        },
        {
          token: { address: "0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c", symbol: "aEthUSDC", decimals: 6, category: TokenCategory.RECEIPT_TOKEN, chain: DEMO_CHAIN },
          from: "0x0000000000000000000000000000000000000000",
          to: DEMO_WALLET,
          amount: "2000.00",
          rawAmount: "2000000000",
          logIndex: 1,
        },
      ],
      internalTransactions: [],
      logs: [],
      rawData: {},
    },

    // 4. Stake 0.5 ETH with Lido
    {
      chain: DEMO_CHAIN,
      txHash: "0xddd4444444444444444444444444444444444444444444444444444444444444",
      blockNumber: 19000150,
      blockTimestamp: now - 12 * hour,
      from: DEMO_WALLET,
      to: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", // Lido stETH
      value: "0.5",
      gasUsed: "180000",
      gasPrice: "22000000000",
      gasFeeNative: "0.00396",
      success: true,
      methodId: "0xa1903eab", // submit
      tokenTransfers: [
        {
          token: { address: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84", symbol: "stETH", decimals: 18, category: TokenCategory.RECEIPT_TOKEN, chain: DEMO_CHAIN },
          from: "0x0000000000000000000000000000000000000000",
          to: DEMO_WALLET,
          amount: "0.5",
          rawAmount: "500000000000000000",
          logIndex: 0,
        },
      ],
      internalTransactions: [],
      logs: [],
      rawData: {},
    },

    // 5. Failed transaction (gas only)
    {
      chain: DEMO_CHAIN,
      txHash: "0xeee5555555555555555555555555555555555555555555555555555555555555",
      blockNumber: 19000200,
      blockTimestamp: now - 8 * hour,
      from: DEMO_WALLET,
      to: "0xdeaddeaddeaddeaddeaddeaddeaddeaddeaddead",
      value: "0",
      gasUsed: "50000",
      gasPrice: "30000000000",
      gasFeeNative: "0.0015",
      success: false,
      methodId: "0x12345678",
      tokenTransfers: [],
      internalTransactions: [],
      logs: [],
      rawData: {},
    },

    // 6. Claim staking rewards (0.01 ETH)
    {
      chain: DEMO_CHAIN,
      txHash: "0xfff6666666666666666666666666666666666666666666666666666666666666",
      blockNumber: 19000250,
      blockTimestamp: now - 4 * hour,
      from: DEMO_WALLET,
      to: "0xrewardscontract000000000000000000000000000",
      value: "0",
      gasUsed: "100000",
      gasPrice: "18000000000",
      gasFeeNative: "0.0018",
      success: true,
      methodId: "0x4e71d92d", // claim
      tokenTransfers: [
        {
          token: { address: "native", symbol: "ETH", decimals: 18, category: TokenCategory.NATIVE, chain: DEMO_CHAIN },
          from: "0xrewardscontract000000000000000000000000000",
          to: DEMO_WALLET,
          amount: "0.01",
          rawAmount: "10000000000000000",
          logIndex: 0,
        },
      ],
      internalTransactions: [],
      logs: [],
      rawData: {},
    },

    // 7. WETH wrap
    {
      chain: DEMO_CHAIN,
      txHash: "0x0007777777777777777777777777777777777777777777777777777777777777",
      blockNumber: 19000300,
      blockTimestamp: now - 2 * hour,
      from: DEMO_WALLET,
      to: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
      value: "0.25",
      gasUsed: "45000",
      gasPrice: "20000000000",
      gasFeeNative: "0.0009",
      success: true,
      methodId: "0xd0e30db0", // deposit (wrap)
      tokenTransfers: [
        {
          token: { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", decimals: 18, category: TokenCategory.WRAPPED_NATIVE, chain: DEMO_CHAIN },
          from: "0x0000000000000000000000000000000000000000",
          to: DEMO_WALLET,
          amount: "0.25",
          rawAmount: "250000000000000000",
          logIndex: 0,
        },
      ],
      internalTransactions: [],
      logs: [],
      rawData: {},
    },
  ];
}

// Mock pricing — returns hardcoded prices since we have no API key
function mockPrice(tokenAddress: string, timestamp: number): PricedTokenAmount["price"] {
  const prices: Record<string, string> = {
    native: "2800.00",
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "1.00", // USDC
    "0xae7ab96520de3a18e5e111b5eaab095312d7fe84": "2810.00", // stETH
    "0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c": "1.00", // aEthUSDC
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "2800.00", // WETH
  };
  return {
    usdPrice: prices[tokenAddress.toLowerCase()] ?? "0",
    timestamp,
    source: PriceSource.MANUAL,
    confidence: Confidence.HIGH,
  };
}

function priceToken(transfer: RawTransaction["tokenTransfers"][0], timestamp: number): PricedTokenAmount {
  const price = mockPrice(transfer.token.address, timestamp);
  const usdValue = (parseFloat(transfer.amount) * parseFloat(price.usdPrice)).toFixed(2);
  return {
    token: transfer.token,
    amount: transfer.amount,
    rawAmount: transfer.rawAmount,
    usdValue,
    price,
  };
}

async function demo() {
  logger.info("=== ReconAgent Demo — Full Pipeline ===");
  logger.info("Using synthetic transactions with mock pricing (no API keys needed)\n");

  // 1. Initialize storage
  const dbPath = "./demo-recon.db";
  const storage = new SqliteAdapter(dbPath);
  await storage.initialize();
  logger.info("storage initialized");

  // 2. Initialize components
  const classifier = new ClassificationEngine();
  const journal = new JournalEntryGenerator({
    baseCurrency: "USD",
    bridgeTreatment: "transfer",
    stakingIncomeTreatment: "other_income",
    gasTreatment: "capitalize_on_acquisition",
    costBasisMethod: "fifo",
    dustThresholdUsd: "0.01",
  });
  const costBasis = new CostBasisEngine(storage, CostBasisMethod.FIFO);
  const lotTracker = new LotTracker(storage);
  const emitter = new ReconEventEmitter();

  // Wire event handlers
  let classifiedCount = 0;
  let lowConfidenceCount = 0;
  emitter.on("transaction_classified", () => { classifiedCount++; });
  emitter.on("classification_low_confidence", (e) => {
    lowConfidenceCount++;
    logger.warn({ txId: e.data.transactionId, rationale: e.data.rationale }, "LOW CONFIDENCE");
  });

  // 3. Process synthetic transactions
  const rawTxs = makeSyntheticTransactions();
  logger.info({ count: rawTxs.length }, "processing synthetic transactions\n");

  console.log("─".repeat(100));
  console.log("  TX  │  BLOCK    │  TYPE               │  PROTOCOL    │  CONFIDENCE  │  IN                  │  OUT");
  console.log("─".repeat(100));

  for (let i = 0; i < rawTxs.length; i++) {
    const raw = rawTxs[i];
    const txId = `${raw.chain}:${raw.txHash}:0`;

    // Classify
    const result = classifier.classify(raw);

    // Price tokens
    const tokensIn = raw.tokenTransfers
      .filter((t) => t.to.toLowerCase() === DEMO_WALLET)
      .map((t) => priceToken(t, raw.blockTimestamp));

    const tokensOut = raw.tokenTransfers
      .filter((t) => t.from.toLowerCase() === DEMO_WALLET)
      .map((t) => priceToken(t, raw.blockTimestamp));

    // Handle native value
    if (parseFloat(raw.value) > 0 && raw.to.toLowerCase() === DEMO_WALLET) {
      const price = mockPrice("native", raw.blockTimestamp);
      tokensIn.push({
        token: { address: "native", symbol: "ETH", decimals: 18, category: TokenCategory.NATIVE, chain: DEMO_CHAIN },
        amount: raw.value,
        rawAmount: raw.value,
        usdValue: (parseFloat(raw.value) * parseFloat(price.usdPrice)).toFixed(2),
        price,
      });
    }
    if (parseFloat(raw.value) > 0 && raw.from.toLowerCase() === DEMO_WALLET) {
      const price = mockPrice("native", raw.blockTimestamp);
      tokensOut.push({
        token: { address: "native", symbol: "ETH", decimals: 18, category: TokenCategory.NATIVE, chain: DEMO_CHAIN },
        amount: raw.value,
        rawAmount: raw.value,
        usdValue: (parseFloat(raw.value) * parseFloat(price.usdPrice)).toFixed(2),
        price,
      });
    }

    const gasPrice = mockPrice("native", raw.blockTimestamp);
    const gasFee: PricedTokenAmount = {
      token: { address: "native", symbol: "ETH", decimals: 18, category: TokenCategory.NATIVE, chain: DEMO_CHAIN },
      amount: raw.gasFeeNative,
      rawAmount: raw.gasFeeNative,
      usdValue: (parseFloat(raw.gasFeeNative) * parseFloat(gasPrice.usdPrice)).toFixed(2),
      price: gasPrice,
    };

    const isAcquisition = [TransactionType.SWAP, TransactionType.TRANSFER_IN, TransactionType.CLAIM_REWARD].includes(result.type);

    // Build classified tx
    const classified: ClassifiedTransaction = {
      id: txId,
      chain: raw.chain,
      txHash: raw.txHash,
      blockNumber: raw.blockNumber,
      blockTimestamp: raw.blockTimestamp,
      from: raw.from,
      to: raw.to,
      wallet: DEMO_WALLET,
      type: result.type,
      subType: result.subType,
      protocol: result.protocol,
      tokensIn,
      tokensOut,
      gasFee,
      gasCapitalized: isAcquisition && tokensIn.length > 0,
      classification: result.audit,
      rawData: raw.rawData,
    };

    // Store
    await storage.saveTransaction(classified);

    // Journal entry
    try {
      const je = journal.generate(classified);
      await storage.saveJournalEntry(je);
    } catch (err: any) {
      logger.warn({ txId, err: err.message }, "journal entry skipped");
    }

    // Cost basis
    await costBasis.processTransaction(classified);

    // Audit log
    await storage.appendAuditLog({
      id: randomUUID(),
      timestamp: Math.floor(Date.now() / 1000),
      eventType: "transaction_classified",
      transactionId: txId,
      wallet: DEMO_WALLET,
      chain: DEMO_CHAIN,
      details: { type: result.type, confidence: result.audit.confidence, method: result.audit.method },
      modelVersion: MODEL_VERSION,
    });

    // Events
    await emitter.emit({ type: "transaction_classified", data: classified });
    if (result.audit.confidence === Confidence.LOW) {
      await emitter.emit({ type: "classification_low_confidence", data: { transactionId: txId, confidence: result.audit.confidence, rationale: result.audit.rationale } });
    }

    // Print row
    const inStr = tokensIn.map((t) => `${t.amount} ${t.token.symbol} ($${t.usdValue})`).join(", ") || "—";
    const outStr = tokensOut.map((t) => `${t.amount} ${t.token.symbol} ($${t.usdValue})`).join(", ") || "—";
    console.log(
      `  ${(i + 1).toString().padStart(2)}  │  ${raw.blockNumber}  │  ${result.type.padEnd(18)}  │  ${(result.protocol ?? "—").padEnd(11)}  │  ${result.audit.confidence.padEnd(11)}  │  ${inStr.slice(0, 20).padEnd(20)}  │  ${outStr.slice(0, 20)}`
    );
  }

  console.log("─".repeat(100));
  console.log();

  // 4. Print cost basis summary
  logger.info("=== Cost Basis Summary ===");
  const ethLots = await lotTracker.getOpenLotsSummary(DEMO_WALLET, "native", DEMO_CHAIN);
  const usdcLots = await lotTracker.getOpenLotsSummary(DEMO_WALLET, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", DEMO_CHAIN);
  console.log(`  ETH lots: ${ethLots.lotCount} open | total: ${ethLots.totalAmount} ETH | cost basis: $${ethLots.totalCostBasis} | avg: $${ethLots.averageCostPerUnit}/ETH`);
  console.log(`  USDC lots: ${usdcLots.lotCount} open | total: ${usdcLots.totalAmount} USDC | cost basis: $${usdcLots.totalCostBasis}`);
  console.log();

  // 5. Export journal entries
  const entries = await storage.getJournalEntries({});
  logger.info({ count: entries.length }, "=== Journal Entries ===");
  console.log();

  for (const entry of entries) {
    console.log(`  ${entry.date} | ${entry.memo.slice(0, 70)}`);
    for (const line of entry.lines) {
      const side = line.side === "debit" ? "DR" : "CR";
      console.log(`    ${side}  ${line.accountCode} ${line.accountName.padEnd(40)}  $${line.amount.padStart(12)}  ${line.tokenAmount ?? ""} ${line.tokenSymbol ?? ""}`);
    }
    console.log();
  }

  // 6. Export to Xero CSV
  const xeroCsv = toXeroCsv(entries);
  console.log("─".repeat(100));
  logger.info("=== Xero CSV Export (first 15 lines) ===");
  console.log(xeroCsv.split("\n").slice(0, 15).join("\n"));
  console.log("...");
  console.log();

  // 7. Audit log
  const auditEntries = await storage.getAuditLog({});
  logger.info({ count: auditEntries.length }, "=== Audit Log ===");
  for (const entry of auditEntries) {
    const d = entry.details as any;
    console.log(`  ${entry.eventType} | ${d.type} | ${d.confidence} | ${d.method}`);
  }
  console.log();

  // 8. Stats
  console.log("─".repeat(100));
  logger.info({
    transactionsClassified: classifiedCount,
    lowConfidence: lowConfidenceCount,
    journalEntries: entries.length,
    auditLogEntries: auditEntries.length,
    ethLots: ethLots.lotCount,
    usdcLots: usdcLots.lotCount,
  }, "=== Demo Complete ===");

  // Cleanup
  await storage.close();
  // Remove demo DB
  const { unlinkSync } = await import("fs");
  try { unlinkSync(dbPath); } catch {}
}

demo().catch((err) => {
  logger.fatal({ err }, "demo error");
  process.exit(1);
});
