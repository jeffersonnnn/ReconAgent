import { ReconciliationStatus } from "../../interfaces/common.js";
import type { ChainId } from "../../interfaces/common.js";
import type { ReconciliationReport, Discrepancy, RebasingAdjustment } from "../../interfaces/output.js";
import type { StorageAdapter } from "../../storage/adapter.js";
import type { ChainConnector } from "../connectors/types.js";
import { ThreeWayMatcher } from "./three-way.js";
import { BridgeMatcher } from "./bridge-matcher.js";
import { RebasingTracker } from "./rebasing.js";
import { logger } from "../../logger.js";

export class ReconciliationEngine {
  private threeWay: ThreeWayMatcher;
  private bridgeMatcher: BridgeMatcher;
  private rebasingTracker: RebasingTracker;

  constructor(
    private storage: StorageAdapter,
    private connectors: Map<ChainId, ChainConnector>,
    opts: { dustThresholdUsd: string; bridgeWindowSeconds: number; rebasingTokens: string[] }
  ) {
    this.threeWay = new ThreeWayMatcher(storage, connectors, parseFloat(opts.dustThresholdUsd));
    this.bridgeMatcher = new BridgeMatcher(storage, opts.bridgeWindowSeconds);
    this.rebasingTracker = new RebasingTracker(storage, connectors, opts.rebasingTokens);
  }

  async reconcile(wallet: string, chain: ChainId): Promise<ReconciliationReport> {
    logger.info({ wallet, chain }, "starting reconciliation");

    // 1. Three-way match
    const threeWayResult = await this.threeWay.match(wallet, chain);

    // 2. Bridge leg matching
    const bridgeResult = await this.bridgeMatcher.matchLegs(wallet);

    // 3. Rebasing check
    const rebasingResult = await this.rebasingTracker.checkAdjustments(wallet, chain);

    // Determine overall status
    const hasDiscrepancies = threeWayResult.discrepancies.some(
      (d) => d.status === ReconciliationStatus.UNMATCHED || d.status === ReconciliationStatus.FLAGGED
    );
    const status = hasDiscrepancies ? ReconciliationStatus.FLAGGED : ReconciliationStatus.MATCHED;

    const report: ReconciliationReport = {
      timestamp: Math.floor(Date.now() / 1000),
      wallet,
      chain,
      ledgerBalance: threeWayResult.ledgerBalance,
      onChainBalance: threeWayResult.onChainBalance,
      discrepancies: threeWayResult.discrepancies,
      bridgeLegsMatched: bridgeResult.matched,
      bridgeLegsUnmatched: bridgeResult.unmatched,
      rebasingAdjustments: rebasingResult,
      status,
      summary: this.buildSummary(threeWayResult.discrepancies, bridgeResult, rebasingResult),
    };

    await this.storage.saveReconciliationReport(report);
    logger.info({ wallet, chain, status, discrepancies: threeWayResult.discrepancies.length }, "reconciliation complete");

    return report;
  }

  private buildSummary(
    discrepancies: Discrepancy[],
    bridgeResult: { matched: number; unmatched: number },
    rebasingAdjustments: RebasingAdjustment[]
  ): string {
    const parts: string[] = [];
    const matched = discrepancies.filter((d) => d.status === ReconciliationStatus.MATCHED).length;
    const flagged = discrepancies.filter((d) => d.status === ReconciliationStatus.FLAGGED).length;
    const dust = discrepancies.filter((d) => d.status === ReconciliationStatus.DUST).length;

    parts.push(`${matched} tokens matched`);
    if (flagged > 0) parts.push(`${flagged} tokens flagged`);
    if (dust > 0) parts.push(`${dust} dust-level differences`);
    if (bridgeResult.unmatched > 0) parts.push(`${bridgeResult.unmatched} unmatched bridge legs`);
    if (rebasingAdjustments.length > 0) parts.push(`${rebasingAdjustments.length} rebasing adjustments`);

    return parts.join(", ");
  }
}
