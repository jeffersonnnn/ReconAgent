import type { StorageAdapter, TaxLot } from "../../storage/adapter.js";
import type { ChainId } from "../../interfaces/common.js";

export class LotTracker {
  constructor(private storage: StorageAdapter) {}

  async getOpenLotsSummary(wallet: string, tokenAddress: string, chain: ChainId): Promise<{
    totalAmount: string;
    totalCostBasis: string;
    averageCostPerUnit: string;
    lotCount: number;
  }> {
    const lots = await this.storage.getOpenLots(wallet, tokenAddress, chain);

    let totalAmount = 0;
    let totalCostBasis = 0;

    for (const lot of lots) {
      const remaining = parseFloat(lot.remainingAmount);
      totalAmount += remaining;
      totalCostBasis += remaining * parseFloat(lot.costBasisPerUnit);
    }

    return {
      totalAmount: totalAmount.toFixed(8),
      totalCostBasis: totalCostBasis.toFixed(8),
      averageCostPerUnit: totalAmount > 0 ? (totalCostBasis / totalAmount).toFixed(8) : "0",
      lotCount: lots.length,
    };
  }
}
