import type { StorageAdapter, BridgeLeg } from "../../storage/adapter.js";
import { logger } from "../../logger.js";

export interface BridgeMatchResult {
  matched: number;
  unmatched: number;
  pairs: Array<{ outbound: BridgeLeg; inbound: BridgeLeg }>;
}

export class BridgeMatcher {
  constructor(
    private storage: StorageAdapter,
    private windowSeconds: number
  ) {}

  async matchLegs(wallet: string): Promise<BridgeMatchResult> {
    const unmatched = await this.storage.getUnmatchedBridgeLegs(wallet);
    const outbound = unmatched.filter((l) => l.direction === "outbound");
    const inbound = unmatched.filter((l) => l.direction === "inbound");

    const pairs: BridgeMatchResult["pairs"] = [];
    const matchedIds = new Set<string>();

    for (const out of outbound) {
      // Find best matching inbound leg
      const candidate = inbound.find((inn) => {
        if (matchedIds.has(inn.id)) return false;
        if (inn.tokenSymbol !== out.tokenSymbol) return false;
        if (inn.wallet !== out.wallet) return false;

        // Amount should be close (bridges may deduct fees)
        const outAmt = parseFloat(out.amount);
        const inAmt = parseFloat(inn.amount);
        const pctDiff = Math.abs(outAmt - inAmt) / Math.max(outAmt, 0.001);
        if (pctDiff > 0.05) return false; // allow 5% fee

        // Time window
        const timeDiff = inn.timestamp - out.timestamp;
        if (timeDiff < 0 || timeDiff > this.windowSeconds) return false;

        // Protocol match (optional but preferred)
        if (inn.protocol !== out.protocol) return false;

        return true;
      });

      if (candidate) {
        matchedIds.add(out.id);
        matchedIds.add(candidate.id);
        pairs.push({ outbound: out, inbound: candidate });

        await this.storage.matchBridgeLegs(out.id, candidate.id);
        logger.info({ outbound: out.id, inbound: candidate.id, token: out.tokenSymbol }, "bridge legs matched");
      }
    }

    return {
      matched: pairs.length,
      unmatched: unmatched.length - pairs.length * 2,
      pairs,
    };
  }
}
