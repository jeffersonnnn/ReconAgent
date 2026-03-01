import { writeFileSync } from "fs";
import { loadConfig, MODEL_VERSION } from "./config.js";
import { logger } from "./logger.js";
import { ChainId, ExportFormat } from "./interfaces/common.js";
import { SqliteAdapter } from "./storage/sqlite.js";
import { EvmConnector } from "./core/connectors/evm.js";
import { SolanaConnector } from "./core/connectors/solana.js";
import { PricingService } from "./core/pricing/service.js";
import { ReconPipeline } from "./core/pipeline.js";
import { ReconEventEmitter } from "./events/emitter.js";
import { SlackDelivery } from "./delivery/slack.js";
import { parseCliArgs, printUsage } from "./delivery/cli.js";
import { toCanonicalCsv } from "./core/formatters/adapters/canonical.js";
import { toXeroCsv } from "./core/formatters/adapters/xero.js";
import { toQuickBooksJson } from "./core/formatters/adapters/quickbooks.js";
import { toNetsuiteCsv } from "./core/formatters/adapters/netsuite.js";
import type { ChainConnector } from "./core/connectors/types.js";

async function main() {
  const cliArgs = parseCliArgs(process.argv.slice(2));

  if (cliArgs.mode === "status" && process.argv.includes("--help")) {
    printUsage();
    return;
  }

  logger.info({ mode: cliArgs.mode, version: MODEL_VERSION }, "ReconAgent starting");

  const config = loadConfig();

  // Initialize storage
  const storage = new SqliteAdapter(config.sqlitePath);
  await storage.initialize();

  // Initialize connectors
  const connectors = new Map<ChainId, ChainConnector>();
  const evmChains: ChainId[] = [ChainId.ETHEREUM, ChainId.ARBITRUM, ChainId.OPTIMISM, ChainId.BASE, ChainId.POLYGON];

  for (const chain of evmChains) {
    const url = config.alchemy.urls[chain];
    if (url) {
      connectors.set(chain, new EvmConnector(chain, url));
      logger.info({ chain }, "EVM connector initialized");
    }
  }

  if (config.helius.apiKey && config.helius.rpcUrl) {
    connectors.set(ChainId.SOLANA, new SolanaConnector(config.helius.rpcUrl, config.helius.apiKey));
    logger.info("Solana connector initialized");
  }

  // Initialize services
  const pricing = new PricingService(storage, {
    coingeckoApiKey: config.coingeckoApiKey,
    evmRpcUrl: config.alchemy.urls.ethereum,
  });
  const emitter = new ReconEventEmitter();
  const slack = config.slackWebhookUrl ? new SlackDelivery(config.slackWebhookUrl) : null;

  // Wire event handlers
  if (slack) {
    emitter.on("anomaly_detected", (event) => slack.sendAnomaly(event));
    emitter.on("reconciliation_complete", (event) => slack.sendReconciliationSummary(event.data));
  }

  emitter.on("classification_low_confidence", (event) => {
    logger.warn({ txId: event.data.transactionId, confidence: event.data.confidence }, "low confidence classification");
  });

  // Build pipeline
  const pipeline = new ReconPipeline(
    storage,
    connectors,
    config.input.wallets,
    config.input.accountingConfig,
    config.input.reconciliationConfig,
    pricing,
    emitter,
    config.input.classificationRules
  );

  logger.info(
    { sqlitePath: config.sqlitePath, wallets: config.input.wallets.length, connectors: connectors.size },
    "pipeline initialized"
  );

  // Execute mode
  switch (cliArgs.mode) {
    case "status": {
      const states = await storage.getAllWalletStates();
      if (states.length === 0) {
        logger.info("no wallets configured — ReconAgent ready");
      } else {
        for (const state of states) {
          logger.info(
            { wallet: state.wallet, chain: state.chain, block: state.lastProcessedBlock, txCount: state.transactionCount },
            "wallet state"
          );
        }
      }
      break;
    }

    case "backfill": {
      // If --from is a number, treat as block number and seed wallet state
      const fromBlock = cliArgs.from && /^\d+$/.test(cliArgs.from) ? parseInt(cliArgs.from, 10) : undefined;
      if (fromBlock) {
        for (const wallet of config.input.wallets) {
          if (cliArgs.chain && wallet.chain !== cliArgs.chain) continue;
          if (cliArgs.wallet && wallet.address.toLowerCase() !== cliArgs.wallet.toLowerCase()) continue;
          const existing = await storage.getWalletState(wallet.address, wallet.chain);
          if (!existing) {
            await storage.saveWalletState({
              wallet: wallet.address,
              chain: wallet.chain,
              lastProcessedBlock: fromBlock - 1,
              lastProcessedTimestamp: 0,
              transactionCount: 0,
              errorCount: 0,
            });
          }
        }
      }
      logger.info({ fromBlock }, "starting backfill");
      for (const wallet of config.input.wallets) {
        if (cliArgs.chain && wallet.chain !== cliArgs.chain) continue;
        if (cliArgs.wallet && wallet.address.toLowerCase() !== cliArgs.wallet.toLowerCase()) continue;
        const count = await pipeline.processWallet(wallet);
        logger.info({ wallet: wallet.address, chain: wallet.chain, processed: count }, "backfill complete for wallet");
      }
      break;
    }

    case "recon": {
      logger.info({ intervalMs: config.pollIntervalMs }, "starting continuous recon loop");
      let running = true;
      process.on("SIGINT", () => { running = false; logger.info("shutting down..."); });
      process.on("SIGTERM", () => { running = false; });

      while (running) {
        for (const wallet of config.input.wallets) {
          try {
            await pipeline.processWallet(wallet);
          } catch (err) {
            logger.error({ wallet: wallet.address, err }, "recon cycle error");
          }
        }
        if (running) await new Promise((r) => setTimeout(r, config.pollIntervalMs));
      }
      break;
    }

    case "reconcile": {
      logger.info("running reconciliation");
      for (const wallet of config.input.wallets) {
        if (cliArgs.chain && wallet.chain !== cliArgs.chain) continue;
        if (cliArgs.wallet && wallet.address.toLowerCase() !== cliArgs.wallet.toLowerCase()) continue;
        const report = await pipeline.reconcileWallet(wallet);
        logger.info({ wallet: wallet.address, chain: wallet.chain, status: report.status, summary: report.summary }, "reconciliation result");
        await emitter.emit({ type: "reconciliation_complete", data: report });
      }
      break;
    }

    case "export": {
      const format = cliArgs.format ?? ExportFormat.CANONICAL_CSV;
      const from = cliArgs.from ? Math.floor(new Date(cliArgs.from).getTime() / 1000) : undefined;
      const to = cliArgs.to ? Math.floor(new Date(cliArgs.to).getTime() / 1000) : undefined;

      const entries = await storage.getJournalEntries({ from, to, chain: cliArgs.chain });
      logger.info({ entries: entries.length, format }, "exporting journal entries");

      let output: string;
      switch (format) {
        case "xero": output = toXeroCsv(entries); break;
        case "quickbooks": output = toQuickBooksJson(entries); break;
        case "netsuite": output = toNetsuiteCsv(entries); break;
        default: output = toCanonicalCsv(entries); break;
      }

      if (cliArgs.outputPath) {
        writeFileSync(cliArgs.outputPath, output);
        logger.info({ path: cliArgs.outputPath }, "export written to file");
      } else {
        console.log(output);
      }
      break;
    }

    case "override": {
      if (!cliArgs.transactionId || !cliArgs.newType || !cliArgs.reason) {
        logger.error("override requires --tx=<id> --type=<type> --reason=<text>");
        process.exit(1);
      }
      const tx = await storage.getTransaction(cliArgs.transactionId);
      if (!tx) {
        logger.error({ txId: cliArgs.transactionId }, "transaction not found");
        process.exit(1);
      }
      await storage.saveOverride({
        transactionId: cliArgs.transactionId,
        previousType: tx.type,
        newType: cliArgs.newType as any,
        reason: cliArgs.reason,
        overriddenBy: "cli",
        timestamp: Math.floor(Date.now() / 1000),
      });
      logger.info({ txId: cliArgs.transactionId, from: tx.type, to: cliArgs.newType }, "override saved");
      break;
    }

    default:
      printUsage();
      process.exit(1);
  }

  await storage.close();
  logger.info("ReconAgent done");
}

main().catch((err) => {
  logger.fatal({ err }, "unhandled error");
  process.exit(1);
});
