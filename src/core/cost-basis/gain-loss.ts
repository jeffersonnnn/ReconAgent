import type { StorageAdapter, TaxLot } from "../../storage/adapter.js";
import type { ChainId } from "../../interfaces/common.js";

export interface GainLossSummary {
  shortTermGains: string;
  shortTermLosses: string;
  longTermGains: string;
  longTermLosses: string;
  netGainLoss: string;
}

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60;

export class GainLossCalculator {
  constructor(private storage: StorageAdapter) {}

  async calculatePeriod(
    wallet: string,
    chain: ChainId,
    fromTimestamp: number,
    toTimestamp: number
  ): Promise<GainLossSummary> {
    // Get all transactions in period and compute from audit log
    const auditEntries = await this.storage.getAuditLog({
      wallet,
      eventType: "lot_disposal",
      from: fromTimestamp,
      to: toTimestamp,
    });

    let shortTermGains = 0;
    let shortTermLosses = 0;
    let longTermGains = 0;
    let longTermLosses = 0;

    for (const entry of auditEntries) {
      const details = entry.details as {
        gain: number;
        holdingPeriodSeconds: number;
      };

      const gain = details.gain ?? 0;
      const isLongTerm = (details.holdingPeriodSeconds ?? 0) > ONE_YEAR_SECONDS;

      if (isLongTerm) {
        if (gain >= 0) longTermGains += gain;
        else longTermLosses += Math.abs(gain);
      } else {
        if (gain >= 0) shortTermGains += gain;
        else shortTermLosses += Math.abs(gain);
      }
    }

    const netGainLoss = shortTermGains - shortTermLosses + longTermGains - longTermLosses;

    return {
      shortTermGains: shortTermGains.toFixed(2),
      shortTermLosses: shortTermLosses.toFixed(2),
      longTermGains: longTermGains.toFixed(2),
      longTermLosses: longTermLosses.toFixed(2),
      netGainLoss: netGainLoss.toFixed(2),
    };
  }
}
