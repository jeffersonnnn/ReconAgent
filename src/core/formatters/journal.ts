import { randomUUID } from "crypto";
import { TransactionType, JournalSide, TokenCategory } from "../../interfaces/common.js";
import type { ClassifiedTransaction, JournalEntry, JournalLine } from "../../interfaces/output.js";
import type { AccountingConfig } from "../../interfaces/input.js";
import { getAccount } from "./chart-of-accounts.js";
import { logger } from "../../logger.js";

export class JournalEntryGenerator {
  private config: AccountingConfig;
  private overrides?: Record<string, string>;

  constructor(config: AccountingConfig) {
    this.config = config;
    this.overrides = config.chartOfAccountsOverrides;
  }

  generate(tx: ClassifiedTransaction): JournalEntry {
    const lines = this.generateLines(tx);
    this.validateBalance(lines, tx.id);

    const date = new Date(tx.blockTimestamp * 1000).toISOString().split("T")[0];

    return {
      id: randomUUID(),
      transactionId: tx.id,
      date,
      timestamp: tx.blockTimestamp,
      memo: this.buildMemo(tx),
      lines,
      metadata: {
        chain: tx.chain,
        txHash: tx.txHash,
        wallet: tx.wallet,
        transactionType: tx.type,
        protocol: tx.protocol,
      },
    };
  }

  private generateLines(tx: ClassifiedTransaction): JournalLine[] {
    switch (tx.type) {
      case TransactionType.SWAP: return this.swapLines(tx);
      case TransactionType.TRANSFER_IN: return this.transferInLines(tx);
      case TransactionType.TRANSFER_OUT: return this.transferOutLines(tx);
      case TransactionType.STAKE: return this.stakeLines(tx);
      case TransactionType.UNSTAKE: return this.unstakeLines(tx);
      case TransactionType.CLAIM_REWARD: return this.claimRewardLines(tx);
      case TransactionType.LEND: return this.lendLines(tx);
      case TransactionType.WITHDRAW_COLLATERAL: return this.withdrawLines(tx);
      case TransactionType.BORROW: return this.borrowLines(tx);
      case TransactionType.REPAY: return this.repayLines(tx);
      case TransactionType.LP_ADD: return this.lpAddLines(tx);
      case TransactionType.LP_REMOVE: return this.lpRemoveLines(tx);
      case TransactionType.BRIDGE_OUT: return this.bridgeOutLines(tx);
      case TransactionType.BRIDGE_IN: return this.bridgeInLines(tx);
      case TransactionType.WRAP: return this.wrapLines(tx);
      case TransactionType.UNWRAP: return this.unwrapLines(tx);
      case TransactionType.AIRDROP: return this.airdropLines(tx);
      case TransactionType.YIELD_CLAIM: return this.yieldClaimLines(tx);
      case TransactionType.GAS:
      case TransactionType.APPROVAL: return this.gasOnlyLines(tx);
      default: return this.unknownLines(tx);
    }
  }

  // --- Swap: DR Asset Received, CR Asset Sent, gain/loss plug, gas ---
  private swapLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenIn of tx.tokensIn) {
      const acct = this.tokenToAssetAccount(tokenIn.token.category);
      lines.push(this.line(acct, JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    for (const tokenOut of tx.tokensOut) {
      const acct = this.tokenToAssetAccount(tokenOut.token.category);
      lines.push(this.line(acct, JournalSide.CREDIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
    }
    lines.push(...this.gasLines(tx));
    this.balanceWithGainLoss(lines);
    return lines;
  }

  private transferInLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenIn of tx.tokensIn) {
      const acct = this.tokenToAssetAccount(tokenIn.token.category);
      lines.push(this.line(acct, JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
      lines.push(this.line("1000", JournalSide.CREDIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    return lines;
  }

  private transferOutLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenOut of tx.tokensOut) {
      const acct = this.tokenToAssetAccount(tokenOut.token.category);
      lines.push(this.line(acct, JournalSide.CREDIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
      lines.push(this.line("1000", JournalSide.DEBIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
    }
    lines.push(...this.gasLines(tx));
    return lines;
  }

  private stakeLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenOut of tx.tokensOut) {
      lines.push(this.line("1000", JournalSide.CREDIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
    }
    for (const tokenIn of tx.tokensIn) {
      lines.push(this.line("1020", JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    // If no receipt token received, just move to staked
    if (tx.tokensIn.length === 0 && tx.tokensOut.length > 0) {
      lines.push(this.line("1020", JournalSide.DEBIT, tx.tokensOut[0].usdValue, tx.tokensOut[0].amount, tx.tokensOut[0].token.symbol));
    }
    lines.push(...this.gasLines(tx));
    this.balanceWithGainLoss(lines);
    return lines;
  }

  private unstakeLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenOut of tx.tokensOut) {
      lines.push(this.line("1020", JournalSide.CREDIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
    }
    for (const tokenIn of tx.tokensIn) {
      lines.push(this.line("1000", JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    lines.push(...this.gasLines(tx));
    this.balanceWithGainLoss(lines);
    return lines;
  }

  private claimRewardLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    const revenueAccount = this.config.stakingIncomeTreatment === "revenue" ? "4000" : "7000";
    for (const tokenIn of tx.tokensIn) {
      const acct = this.tokenToAssetAccount(tokenIn.token.category);
      lines.push(this.line(acct, JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
      lines.push(this.line(revenueAccount, JournalSide.CREDIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    lines.push(...this.gasLines(tx));
    return lines;
  }

  private lendLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenOut of tx.tokensOut) {
      lines.push(this.line("1000", JournalSide.CREDIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
    }
    for (const tokenIn of tx.tokensIn) {
      lines.push(this.line("1100", JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    if (tx.tokensIn.length === 0 && tx.tokensOut.length > 0) {
      lines.push(this.line("1100", JournalSide.DEBIT, tx.tokensOut[0].usdValue, tx.tokensOut[0].amount, tx.tokensOut[0].token.symbol));
    }
    lines.push(...this.gasLines(tx));
    this.balanceWithGainLoss(lines);
    return lines;
  }

  private withdrawLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenOut of tx.tokensOut) {
      lines.push(this.line("1100", JournalSide.CREDIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
    }
    for (const tokenIn of tx.tokensIn) {
      lines.push(this.line("1000", JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    lines.push(...this.gasLines(tx));
    this.balanceWithGainLoss(lines);
    return lines;
  }

  private borrowLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenIn of tx.tokensIn) {
      lines.push(this.line("1000", JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
      lines.push(this.line("2000", JournalSide.CREDIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    lines.push(...this.gasLines(tx));
    return lines;
  }

  private repayLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenOut of tx.tokensOut) {
      lines.push(this.line("2000", JournalSide.DEBIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
      lines.push(this.line("1000", JournalSide.CREDIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
    }
    lines.push(...this.gasLines(tx));
    return lines;
  }

  private lpAddLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenOut of tx.tokensOut) {
      lines.push(this.line("1000", JournalSide.CREDIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
    }
    for (const tokenIn of tx.tokensIn) {
      lines.push(this.line("1030", JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    lines.push(...this.gasLines(tx));
    this.balanceWithGainLoss(lines);
    return lines;
  }

  private lpRemoveLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenOut of tx.tokensOut) {
      lines.push(this.line("1030", JournalSide.CREDIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
    }
    for (const tokenIn of tx.tokensIn) {
      lines.push(this.line("1000", JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    lines.push(...this.gasLines(tx));
    this.balanceWithGainLoss(lines);
    return lines;
  }

  private bridgeOutLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    if (this.config.bridgeTreatment === "transfer") {
      for (const tokenOut of tx.tokensOut) {
        lines.push(this.line("1000", JournalSide.CREDIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
        lines.push(this.line("1060", JournalSide.DEBIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
      }
    } else {
      for (const tokenOut of tx.tokensOut) {
        lines.push(this.line("1000", JournalSide.CREDIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
        lines.push(this.line("5000", JournalSide.DEBIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
      }
    }
    lines.push(...this.gasLines(tx));
    return lines;
  }

  private bridgeInLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    if (this.config.bridgeTreatment === "transfer") {
      for (const tokenIn of tx.tokensIn) {
        lines.push(this.line("1060", JournalSide.CREDIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
        lines.push(this.line("1000", JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
      }
    } else {
      for (const tokenIn of tx.tokensIn) {
        lines.push(this.line("1000", JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
        lines.push(this.line("5000", JournalSide.CREDIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
      }
    }
    return lines;
  }

  private wrapLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenOut of tx.tokensOut) {
      lines.push(this.line("1000", JournalSide.CREDIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
    }
    for (const tokenIn of tx.tokensIn) {
      lines.push(this.line("1050", JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    lines.push(...this.gasLines(tx));
    this.balanceWithGainLoss(lines);
    return lines;
  }

  private unwrapLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenOut of tx.tokensOut) {
      lines.push(this.line("1050", JournalSide.CREDIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
    }
    for (const tokenIn of tx.tokensIn) {
      lines.push(this.line("1000", JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    lines.push(...this.gasLines(tx));
    this.balanceWithGainLoss(lines);
    return lines;
  }

  private airdropLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenIn of tx.tokensIn) {
      const acct = this.tokenToAssetAccount(tokenIn.token.category);
      lines.push(this.line(acct, JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
      lines.push(this.line("4030", JournalSide.CREDIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    return lines;
  }

  private yieldClaimLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenIn of tx.tokensIn) {
      const acct = this.tokenToAssetAccount(tokenIn.token.category);
      lines.push(this.line(acct, JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
      lines.push(this.line("7010", JournalSide.CREDIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    return lines;
  }

  private gasOnlyLines(tx: ClassifiedTransaction): JournalLine[] {
    return this.gasLines(tx);
  }

  private unknownLines(tx: ClassifiedTransaction): JournalLine[] {
    const lines: JournalLine[] = [];
    for (const tokenIn of tx.tokensIn) {
      lines.push(this.line("1000", JournalSide.DEBIT, tokenIn.usdValue, tokenIn.amount, tokenIn.token.symbol));
    }
    for (const tokenOut of tx.tokensOut) {
      lines.push(this.line("1000", JournalSide.CREDIT, tokenOut.usdValue, tokenOut.amount, tokenOut.token.symbol));
    }
    lines.push(...this.gasLines(tx));
    this.balanceWithGainLoss(lines);
    return lines;
  }

  // --- Gas line generation ---
  private gasLines(tx: ClassifiedTransaction): JournalLine[] {
    const gasUsd = parseFloat(tx.gasFee.usdValue);
    if (gasUsd <= 0) return [];

    if (tx.gasCapitalized) {
      return []; // gas is rolled into acquisition cost basis, not expensed
    }

    return [
      this.line("6000", JournalSide.DEBIT, tx.gasFee.usdValue, tx.gasFee.amount, tx.gasFee.token.symbol),
      this.line("1000", JournalSide.CREDIT, tx.gasFee.usdValue, tx.gasFee.amount, tx.gasFee.token.symbol),
    ];
  }

  // --- Helpers ---
  private line(accountCode: string, side: JournalSide, amount: string, tokenAmount?: string, tokenSymbol?: string): JournalLine {
    const acct = getAccount(accountCode, this.overrides);
    return {
      accountCode: acct.code,
      accountName: acct.name,
      side,
      amount: parseFloat(amount).toFixed(2),
      tokenAmount,
      tokenSymbol,
    };
  }

  private tokenToAssetAccount(category: TokenCategory): string {
    switch (category) {
      case TokenCategory.STABLECOIN: return "1010";
      case TokenCategory.RECEIPT_TOKEN: return "1040";
      case TokenCategory.LP_TOKEN: return "1030";
      case TokenCategory.WRAPPED_NATIVE: return "1050";
      default: return "1000";
    }
  }

  // Insert a gain or loss line to force debit = credit balance.
  // Positive imbalance (debits > credits) → realized gain (credit 5000)
  // Negative imbalance (credits > debits) → realized loss (debit 5010)
  private balanceWithGainLoss(lines: JournalLine[]): void {
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      if (line.side === JournalSide.DEBIT) totalDebit += parseFloat(line.amount);
      else totalCredit += parseFloat(line.amount);
    }
    const imbalance = totalDebit - totalCredit;
    if (Math.abs(imbalance) <= 0.01) return; // already balanced

    if (imbalance > 0) {
      // Debits exceed credits → we gained value → credit Realized Gain
      lines.push(this.line("5000", JournalSide.CREDIT, imbalance.toFixed(2)));
    } else {
      // Credits exceed debits → we lost value → debit Realized Loss
      lines.push(this.line("5010", JournalSide.DEBIT, Math.abs(imbalance).toFixed(2)));
    }
  }

  private validateBalance(lines: JournalLine[], txId: string): void {
    let totalDebit = 0;
    let totalCredit = 0;
    for (const line of lines) {
      if (line.side === JournalSide.DEBIT) totalDebit += parseFloat(line.amount);
      else totalCredit += parseFloat(line.amount);
    }
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`JE for tx ${txId}: debit (${totalDebit.toFixed(2)}) != credit (${totalCredit.toFixed(2)})`);
    }
  }

  private buildMemo(tx: ClassifiedTransaction): string {
    const parts: string[] = [tx.type.replace(/_/g, " ")];
    if (tx.protocol) parts.push(`via ${tx.protocol}`);
    if (tx.tokensIn.length > 0) parts.push(`in: ${tx.tokensIn.map((t) => `${t.amount} ${t.token.symbol}`).join(", ")}`);
    if (tx.tokensOut.length > 0) parts.push(`out: ${tx.tokensOut.map((t) => `${t.amount} ${t.token.symbol}`).join(", ")}`);
    return parts.join(" | ");
  }
}
