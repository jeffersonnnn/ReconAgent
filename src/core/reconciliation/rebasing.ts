import { randomUUID } from "crypto";
import type { ChainId } from "../../interfaces/common.js";
import type { RebasingAdjustment } from "../../interfaces/output.js";
import type { StorageAdapter } from "../../storage/adapter.js";
import type { ChainConnector } from "../connectors/types.js";
import { logger } from "../../logger.js";

export class RebasingTracker {
  constructor(
    private storage: StorageAdapter,
    private connectors: Map<ChainId, ChainConnector>,
    private rebasingTokens: string[]
  ) {}

  async checkAdjustments(wallet: string, chain: ChainId): Promise<RebasingAdjustment[]> {
    if (this.rebasingTokens.length === 0) return [];

    const connector = this.connectors.get(chain);
    if (!connector) return [];

    const adjustments: RebasingAdjustment[] = [];

    for (const tokenAddress of this.rebasingTokens) {
      try {
        // Get previous snapshot
        const prevSnapshot = await this.storage.getLatestSnapshot(wallet, chain, tokenAddress);
        if (!prevSnapshot) continue;

        // Get current on-chain balance
        const currentBalance = await connector.getBalance(wallet, tokenAddress);
        const prevBalance = parseFloat(prevSnapshot.balance);
        const currBalance = parseFloat(currentBalance);
        const delta = currBalance - prevBalance;

        if (Math.abs(delta) < 0.00000001) continue;

        // Save new snapshot
        await this.storage.saveBalanceSnapshot({
          id: randomUUID(),
          wallet,
          chain,
          tokenAddress,
          tokenSymbol: prevSnapshot.tokenSymbol,
          balance: currentBalance,
          balanceUsd: "0", // will be priced later
          timestamp: Math.floor(Date.now() / 1000),
          source: "onchain",
        });

        const syntheticTxId = `synthetic:yield:${chain}:${tokenAddress}:${Date.now()}`;

        adjustments.push({
          token: tokenAddress,
          previousBalance: prevBalance.toFixed(8),
          currentBalance: currBalance.toFixed(8),
          delta: delta.toFixed(8),
          deltaUsd: "0", // will be priced later
          syntheticTxId,
        });

        logger.info(
          { wallet, token: tokenAddress, delta: delta.toFixed(8) },
          "rebasing adjustment detected"
        );
      } catch (err) {
        logger.warn({ wallet, chain, token: tokenAddress, err }, "rebasing check failed");
      }
    }

    return adjustments;
  }
}
