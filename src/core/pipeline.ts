import { randomUUID } from "crypto";
import { ChainId, TransactionType, Confidence } from "../interfaces/common.js";
import type { ClassifiedTransaction, PricedTokenAmount } from "../interfaces/output.js";
import type { WalletConfig, AccountingConfig, ReconciliationConfig } from "../interfaces/input.js";
import type { StorageAdapter } from "../storage/adapter.js";
import type { RawTransaction, ChainConnector } from "./connectors/types.js";
import { ClassificationEngine } from "./classifiers/engine.js";
import { PricingService } from "./pricing/service.js";
import { JournalEntryGenerator } from "./formatters/journal.js";
import { CostBasisEngine } from "./cost-basis/engine.js";
import { ReconciliationEngine } from "./reconciliation/engine.js";
import { ReconEventEmitter } from "../events/emitter.js";
import { MODEL_VERSION } from "../config.js";
import { logger } from "../logger.js";

export class ReconPipeline {
  private classifier: ClassificationEngine;
  private pricing: PricingService;
  private journal: JournalEntryGenerator;
  private costBasis: CostBasisEngine;
  private reconciliation: ReconciliationEngine;
  private emitter: ReconEventEmitter;

  constructor(
    private storage: StorageAdapter,
    private connectors: Map<ChainId, ChainConnector>,
    private wallets: WalletConfig[],
    accountingConfig: AccountingConfig,
    reconciliationConfig: ReconciliationConfig,
    pricing: PricingService,
    emitter: ReconEventEmitter,
    userRules: any[] = []
  ) {
    this.classifier = new ClassificationEngine(userRules);
    this.pricing = pricing;
    this.journal = new JournalEntryGenerator(accountingConfig);
    this.costBasis = new CostBasisEngine(storage, accountingConfig.costBasisMethod === "specific_id" ? "specific_id" as any : "fifo" as any);
    this.reconciliation = new ReconciliationEngine(storage, connectors, {
      dustThresholdUsd: reconciliationConfig.dustThresholdUsd,
      bridgeWindowSeconds: reconciliationConfig.bridgeMatchWindowSeconds,
      rebasingTokens: reconciliationConfig.rebasingTokens,
    });
    this.emitter = emitter;
  }

  // Full pipeline: fetch → classify → price → journal → cost basis → store
  async processWallet(wallet: WalletConfig): Promise<number> {
    const connector = this.connectors.get(wallet.chain);
    if (!connector) {
      logger.warn({ chain: wallet.chain }, "no connector available");
      return 0;
    }

    // Get last processed state
    const state = await this.storage.getWalletState(wallet.address, wallet.chain);
    const fromBlock = state ? state.lastProcessedBlock + 1 : undefined;

    logger.info({ wallet: wallet.address, chain: wallet.chain, fromBlock }, "processing wallet");

    // 1. Fetch raw transactions
    let rawTxs: RawTransaction[];
    try {
      rawTxs = await connector.fetchTransactions(wallet.address, { fromBlock });
    } catch (err) {
      logger.error({ wallet: wallet.address, chain: wallet.chain, err }, "fetch failed");
      await this.storage.saveWalletState({
        wallet: wallet.address,
        chain: wallet.chain,
        lastProcessedBlock: state?.lastProcessedBlock ?? 0,
        lastProcessedTimestamp: state?.lastProcessedTimestamp ?? 0,
        transactionCount: state?.transactionCount ?? 0,
        errorCount: (state?.errorCount ?? 0) + 1,
        lastError: String(err),
      });
      return 0;
    }

    let processed = 0;

    for (const raw of rawTxs) {
      try {
        // Deduplicate
        const txId = `${raw.chain}:${raw.txHash}:0`;
        if (await this.storage.transactionExists(txId)) continue;

        // 2. Classify
        const result = this.classifier.classify(raw);

        // 3. Price tokens
        const tokensIn = await this.priceTokens(raw, wallet, "in");
        const tokensOut = await this.priceTokens(raw, wallet, "out");
        const gasFee = await this.priceGas(raw);

        // Determine gas capitalization
        const isAcquisition = [
          TransactionType.SWAP, TransactionType.TRANSFER_IN,
          TransactionType.BRIDGE_IN, TransactionType.CLAIM_REWARD,
          TransactionType.AIRDROP, TransactionType.UNSTAKE,
        ].includes(result.type);
        const gasCapitalized = isAcquisition && tokensIn.length > 0;

        // 4. Build classified transaction
        const classified: ClassifiedTransaction = {
          id: txId,
          chain: raw.chain,
          txHash: raw.txHash,
          blockNumber: raw.blockNumber,
          blockTimestamp: raw.blockTimestamp,
          from: raw.from,
          to: raw.to,
          wallet: wallet.address,
          type: result.type,
          subType: result.subType,
          protocol: result.protocol,
          tokensIn,
          tokensOut,
          gasFee,
          gasCapitalized,
          classification: result.audit,
          rawData: raw.rawData,
        };

        // 5. Store
        await this.storage.saveTransaction(classified);

        // 6. Generate journal entry
        try {
          const je = this.journal.generate(classified);
          await this.storage.saveJournalEntry(je);
        } catch (err) {
          logger.warn({ txId, err }, "journal entry generation failed");
        }

        // 7. Cost basis
        await this.costBasis.processTransaction(classified);

        // 8. Audit log
        await this.storage.appendAuditLog({
          id: randomUUID(),
          timestamp: Math.floor(Date.now() / 1000),
          eventType: "transaction_classified",
          transactionId: txId,
          wallet: wallet.address,
          chain: wallet.chain,
          details: {
            type: result.type,
            confidence: result.audit.confidence,
            method: result.audit.method,
            protocol: result.protocol,
          },
          modelVersion: MODEL_VERSION,
        });

        // 9. Emit events
        await this.emitter.emit({ type: "transaction_classified", data: classified });

        if (result.audit.confidence === Confidence.LOW) {
          await this.emitter.emit({
            type: "classification_low_confidence",
            data: { transactionId: txId, confidence: result.audit.confidence, rationale: result.audit.rationale },
          });
        }

        processed++;
      } catch (err) {
        logger.error({ txHash: raw.txHash, err }, "pipeline error for transaction");
      }
    }

    // Update wallet state
    if (rawTxs.length > 0) {
      const lastTx = rawTxs[rawTxs.length - 1];
      await this.storage.saveWalletState({
        wallet: wallet.address,
        chain: wallet.chain,
        lastProcessedBlock: lastTx.blockNumber,
        lastProcessedTimestamp: lastTx.blockTimestamp,
        lastProcessedSignature: wallet.chain === ChainId.SOLANA ? lastTx.txHash : undefined,
        transactionCount: (state?.transactionCount ?? 0) + processed,
        errorCount: state?.errorCount ?? 0,
      });
    }

    logger.info({ wallet: wallet.address, chain: wallet.chain, processed, total: rawTxs.length }, "wallet processing complete");
    return processed;
  }

  async reconcileWallet(wallet: WalletConfig) {
    return this.reconciliation.reconcile(wallet.address, wallet.chain);
  }

  private async priceTokens(raw: RawTransaction, wallet: WalletConfig, direction: "in" | "out"): Promise<PricedTokenAmount[]> {
    const walletAddr = wallet.address.toLowerCase();
    const transfers = direction === "in"
      ? raw.tokenTransfers.filter((t) => t.to.toLowerCase() === walletAddr)
      : raw.tokenTransfers.filter((t) => t.from.toLowerCase() === walletAddr);

    const priced: PricedTokenAmount[] = [];
    for (const transfer of transfers) {
      const price = await this.pricing.getPrice(raw.chain, transfer.token.address, raw.blockTimestamp);
      const usdValue = (parseFloat(transfer.amount) * parseFloat(price.usdPrice)).toFixed(8);
      priced.push({
        token: transfer.token,
        amount: transfer.amount,
        rawAmount: transfer.rawAmount,
        usdValue,
        price,
      });
    }

    // Also handle native value transfers
    if (direction === "in" && parseFloat(raw.value) > 0 && raw.to.toLowerCase() === walletAddr) {
      const price = await this.pricing.getPrice(raw.chain, "native", raw.blockTimestamp);
      priced.push({
        token: { address: "native", symbol: this.getNativeSymbol(raw.chain), decimals: 18, category: "native" as any, chain: raw.chain },
        amount: raw.value,
        rawAmount: raw.value,
        usdValue: (parseFloat(raw.value) * parseFloat(price.usdPrice)).toFixed(8),
        price,
      });
    }
    if (direction === "out" && parseFloat(raw.value) > 0 && raw.from.toLowerCase() === walletAddr) {
      const price = await this.pricing.getPrice(raw.chain, "native", raw.blockTimestamp);
      priced.push({
        token: { address: "native", symbol: this.getNativeSymbol(raw.chain), decimals: 18, category: "native" as any, chain: raw.chain },
        amount: raw.value,
        rawAmount: raw.value,
        usdValue: (parseFloat(raw.value) * parseFloat(price.usdPrice)).toFixed(8),
        price,
      });
    }

    return priced;
  }

  private async priceGas(raw: RawTransaction): Promise<PricedTokenAmount> {
    const price = await this.pricing.getPrice(raw.chain, "native", raw.blockTimestamp);
    return {
      token: { address: "native", symbol: this.getNativeSymbol(raw.chain), decimals: 18, category: "native" as any, chain: raw.chain },
      amount: raw.gasFeeNative,
      rawAmount: raw.gasFeeNative,
      usdValue: (parseFloat(raw.gasFeeNative) * parseFloat(price.usdPrice)).toFixed(8),
      price,
    };
  }

  private getNativeSymbol(chain: ChainId): string {
    switch (chain) {
      case ChainId.POLYGON: return "MATIC";
      case ChainId.SOLANA: return "SOL";
      default: return "ETH";
    }
  }
}
