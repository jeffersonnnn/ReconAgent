import { ReconciliationStatus } from "../../interfaces/common.js";
import type { ChainId } from "../../interfaces/common.js";
import type { Discrepancy } from "../../interfaces/output.js";
import type { StorageAdapter } from "../../storage/adapter.js";
import type { ChainConnector } from "../connectors/types.js";
import { logger } from "../../logger.js";

export interface ThreeWayResult {
  ledgerBalance: Record<string, string>;
  onChainBalance: Record<string, string>;
  discrepancies: Discrepancy[];
}

export class ThreeWayMatcher {
  constructor(
    private storage: StorageAdapter,
    private connectors: Map<ChainId, ChainConnector>,
    private dustThresholdUsd: number
  ) {}

  async match(wallet: string, chain: ChainId): Promise<ThreeWayResult> {
    // 1. Compute ledger balance from stored transactions
    const ledgerBalance = await this.computeLedgerBalance(wallet, chain);

    // 2. Get on-chain balances
    const onChainBalance = await this.fetchOnChainBalances(wallet, chain, Object.keys(ledgerBalance));

    // 3. Compare
    const discrepancies = this.compareBalances(ledgerBalance, onChainBalance);

    return { ledgerBalance, onChainBalance, discrepancies };
  }

  private async computeLedgerBalance(wallet: string, chain: ChainId): Promise<Record<string, string>> {
    const balances: Record<string, number> = {};
    const txs = await this.storage.getTransactionsByWallet(wallet, chain);

    for (const tx of txs) {
      // Tokens in → add to balance
      for (const token of tx.tokensIn) {
        const key = token.token.address;
        balances[key] = (balances[key] ?? 0) + parseFloat(token.amount);
      }
      // Tokens out → subtract from balance
      for (const token of tx.tokensOut) {
        const key = token.token.address;
        balances[key] = (balances[key] ?? 0) - parseFloat(token.amount);
      }
      // Gas → subtract native
      const gasFee = parseFloat(tx.gasFee.amount);
      if (gasFee > 0) {
        const gasKey = "native";
        balances[gasKey] = (balances[gasKey] ?? 0) - gasFee;
      }
    }

    const result: Record<string, string> = {};
    for (const [token, balance] of Object.entries(balances)) {
      result[token] = balance.toFixed(8);
    }
    return result;
  }

  private async fetchOnChainBalances(
    wallet: string,
    chain: ChainId,
    tokenAddresses: string[]
  ): Promise<Record<string, string>> {
    const connector = this.connectors.get(chain);
    if (!connector) {
      logger.warn({ chain }, "no connector for chain — skipping on-chain balance");
      return {};
    }

    const balances: Record<string, string> = {};
    for (const addr of tokenAddresses) {
      try {
        balances[addr] = await connector.getBalance(wallet, addr);
      } catch (err) {
        logger.warn({ wallet, chain, token: addr, err }, "failed to fetch on-chain balance");
        balances[addr] = "0";
      }
    }
    return balances;
  }

  private compareBalances(
    ledger: Record<string, string>,
    onChain: Record<string, string>
  ): Discrepancy[] {
    const allTokens = new Set([...Object.keys(ledger), ...Object.keys(onChain)]);
    const discrepancies: Discrepancy[] = [];

    for (const token of allTokens) {
      const ledgerBal = parseFloat(ledger[token] ?? "0");
      const onChainBal = parseFloat(onChain[token] ?? "0");
      const diff = Math.abs(ledgerBal - onChainBal);

      if (diff < 0.00000001) continue; // exact match

      let status: ReconciliationStatus;
      let notes: string;

      if (diff < this.dustThresholdUsd) {
        status = ReconciliationStatus.DUST;
        notes = `dust-level difference: ${diff.toFixed(8)}`;
      } else {
        status = ReconciliationStatus.FLAGGED;
        notes = `significant difference: ledger=${ledgerBal.toFixed(8)}, onchain=${onChainBal.toFixed(8)}`;
      }

      discrepancies.push({
        token,
        ledgerBalance: ledgerBal.toFixed(8),
        onChainBalance: onChainBal.toFixed(8),
        differenceUsd: diff.toFixed(8), // this is token amount diff, not USD — would need pricing for USD
        status,
        notes,
      });
    }

    return discrepancies;
  }
}
