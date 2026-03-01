import { randomUUID } from "crypto";
import type { ChainId } from "../../interfaces/common.js";
import type { StorageAdapter, BalanceSnapshot } from "../../storage/adapter.js";
import type { ChainConnector } from "../connectors/types.js";
import { logger } from "../../logger.js";

export class BalanceChecker {
  constructor(
    private storage: StorageAdapter,
    private connectors: Map<ChainId, ChainConnector>
  ) {}

  async snapshotBalances(
    wallet: string,
    chain: ChainId,
    tokenAddresses: string[]
  ): Promise<BalanceSnapshot[]> {
    const connector = this.connectors.get(chain);
    if (!connector) return [];

    const snapshots: BalanceSnapshot[] = [];
    const timestamp = Math.floor(Date.now() / 1000);

    for (const tokenAddress of tokenAddresses) {
      try {
        const balance = await connector.getBalance(wallet, tokenAddress);
        const snapshot: BalanceSnapshot = {
          id: randomUUID(),
          wallet,
          chain,
          tokenAddress,
          tokenSymbol: tokenAddress === "native" ? "ETH" : "UNKNOWN",
          balance,
          balanceUsd: "0",
          timestamp,
          source: "onchain",
        };
        await this.storage.saveBalanceSnapshot(snapshot);
        snapshots.push(snapshot);
      } catch (err) {
        logger.warn({ wallet, chain, token: tokenAddress, err }, "balance snapshot failed");
      }
    }

    return snapshots;
  }

  async verifyBalance(
    wallet: string,
    chain: ChainId,
    tokenAddress: string,
    expectedBalance: string
  ): Promise<{ matches: boolean; actual: string; expected: string; diff: string }> {
    const connector = this.connectors.get(chain);
    if (!connector) {
      return { matches: false, actual: "0", expected: expectedBalance, diff: expectedBalance };
    }

    const actual = await connector.getBalance(wallet, tokenAddress);
    const diff = Math.abs(parseFloat(actual) - parseFloat(expectedBalance));

    return {
      matches: diff < 0.00000001,
      actual,
      expected: expectedBalance,
      diff: diff.toFixed(8),
    };
  }
}
