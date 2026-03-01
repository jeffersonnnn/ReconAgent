import { randomUUID } from "crypto";
import { CostBasisMethod, TransactionType } from "../../interfaces/common.js";
import type { ChainId } from "../../interfaces/common.js";
import type { ClassifiedTransaction } from "../../interfaces/output.js";
import type { StorageAdapter, TaxLot } from "../../storage/adapter.js";
import { logger } from "../../logger.js";

export interface GainLossResult {
  realizedGainUsd: string;
  lotsConsumed: Array<{ lotId: string; amountConsumed: string; costBasisConsumed: string }>;
}

export class CostBasisEngine {
  constructor(
    private storage: StorageAdapter,
    private method: CostBasisMethod = CostBasisMethod.FIFO
  ) {}

  async processTransaction(tx: ClassifiedTransaction): Promise<GainLossResult | null> {
    // Determine if this transaction creates or disposes of lots
    const isAcquisition = this.isAcquisition(tx.type);
    const isDisposal = this.isDisposal(tx.type);

    if (!isAcquisition && !isDisposal) return null;

    if (isAcquisition) {
      await this.recordAcquisitions(tx);
    }

    if (isDisposal) {
      return await this.recordDisposals(tx);
    }

    return null;
  }

  private async recordAcquisitions(tx: ClassifiedTransaction): Promise<void> {
    for (const tokenIn of tx.tokensIn) {
      const amount = tokenIn.amount;
      let costBasisUsd = tokenIn.usdValue;

      // Capitalize gas if configured
      if (tx.gasCapitalized && tx.tokensIn.length === 1) {
        const gasCost = parseFloat(tx.gasFee.usdValue);
        costBasisUsd = (parseFloat(costBasisUsd) + gasCost).toFixed(8);
      }

      const costBasisPerUnit = parseFloat(amount) > 0
        ? (parseFloat(costBasisUsd) / parseFloat(amount)).toFixed(8)
        : "0";

      const lot: TaxLot = {
        id: randomUUID(),
        wallet: tx.wallet,
        chain: tx.chain,
        tokenAddress: tokenIn.token.address,
        tokenSymbol: tokenIn.token.symbol,
        acquiredAt: tx.blockTimestamp,
        acquiredTxId: tx.id,
        originalAmount: amount,
        remainingAmount: amount,
        costBasisUsd,
        costBasisPerUnit,
        method: this.method,
        closed: false,
      };

      await this.storage.saveTaxLot(lot);
      logger.debug({ lotId: lot.id, token: lot.tokenSymbol, amount, costBasisUsd }, "tax lot created");
    }
  }

  private async recordDisposals(tx: ClassifiedTransaction): Promise<GainLossResult> {
    let totalGain = 0;
    const lotsConsumed: GainLossResult["lotsConsumed"] = [];

    for (const tokenOut of tx.tokensOut) {
      let remainingToDispose = parseFloat(tokenOut.amount);
      const proceedsPerUnit = parseFloat(tokenOut.amount) > 0
        ? parseFloat(tokenOut.usdValue) / parseFloat(tokenOut.amount)
        : 0;

      // Get open lots (FIFO ordered by acquired_at ASC)
      const openLots = await this.storage.getOpenLots(tx.wallet, tokenOut.token.address, tx.chain);

      for (const lot of openLots) {
        if (remainingToDispose <= 0) break;

        const lotRemaining = parseFloat(lot.remainingAmount);
        const consumeAmount = Math.min(remainingToDispose, lotRemaining);
        const costBasisConsumed = consumeAmount * parseFloat(lot.costBasisPerUnit);
        const proceedsConsumed = consumeAmount * proceedsPerUnit;
        const gain = proceedsConsumed - costBasisConsumed;

        totalGain += gain;
        lotsConsumed.push({
          lotId: lot.id,
          amountConsumed: consumeAmount.toFixed(8),
          costBasisConsumed: costBasisConsumed.toFixed(8),
        });

        const newRemaining = lotRemaining - consumeAmount;
        const isClosed = newRemaining < 0.00000001; // dust threshold

        await this.storage.updateTaxLot(lot.id, {
          remainingAmount: isClosed ? "0" : newRemaining.toFixed(8),
          closed: isClosed,
          closedAt: isClosed ? tx.blockTimestamp : undefined,
          closedTxId: isClosed ? tx.id : undefined,
        });

        remainingToDispose -= consumeAmount;
        logger.debug({ lotId: lot.id, consumed: consumeAmount, gain: gain.toFixed(2) }, "lot partially/fully consumed");
      }

      if (remainingToDispose > 0.00000001) {
        logger.warn(
          { wallet: tx.wallet, token: tokenOut.token.symbol, remaining: remainingToDispose },
          "disposal exceeds available lots — possible missing acquisition"
        );
      }
    }

    return {
      realizedGainUsd: totalGain.toFixed(8),
      lotsConsumed,
    };
  }

  private isAcquisition(type: TransactionType): boolean {
    return [
      TransactionType.SWAP,
      TransactionType.TRANSFER_IN,
      TransactionType.CLAIM_REWARD,
      TransactionType.AIRDROP,
      TransactionType.BRIDGE_IN,
      TransactionType.UNSTAKE,
      TransactionType.WITHDRAW_COLLATERAL,
      TransactionType.LP_REMOVE,
      TransactionType.UNWRAP,
      TransactionType.YIELD_CLAIM,
    ].includes(type);
  }

  private isDisposal(type: TransactionType): boolean {
    return [
      TransactionType.SWAP,
      TransactionType.TRANSFER_OUT,
      TransactionType.BRIDGE_OUT,
      TransactionType.STAKE,
      TransactionType.LEND,
      TransactionType.REPAY,
      TransactionType.LP_ADD,
      TransactionType.WRAP,
    ].includes(type);
  }
}
