import { TransactionType, Confidence } from "../../interfaces/common.js";
import type { ClassificationAudit, DataLineage } from "../../interfaces/output.js";
import type { ClassificationRule } from "../../interfaces/input.js";
import type { RawTransaction } from "../connectors/types.js";
import { MODEL_VERSION } from "../../config.js";
import { classifyByRules } from "./rules/index.js";
import { classifyByProtocol } from "./protocols/index.js";
import { logger } from "../../logger.js";

export interface ClassificationResult {
  type: TransactionType;
  subType?: string;
  protocol?: string;
  audit: ClassificationAudit;
}

export class ClassificationEngine {
  private userRules: ClassificationRule[];

  constructor(userRules: ClassificationRule[] = []) {
    this.userRules = userRules.sort((a, b) => a.priority - b.priority);
  }

  classify(raw: RawTransaction): ClassificationResult {
    const lineage: DataLineage = {
      rpcSource: raw.chain === "solana" ? "helius" : "alchemy",
      blockConfirmations: 0,
      priceSource: "defillama" as any,
      enrichmentSteps: (raw.rawData?.enrichmentSteps as string[]) ?? [],
    };

    // 1. User-defined rules (highest priority)
    const userResult = this.classifyWithUserRules(raw, lineage);
    if (userResult) return userResult;

    // 2. Protocol-specific patterns
    const protocolResult = classifyByProtocol(raw, lineage);
    if (protocolResult) return protocolResult;

    // 3. Heuristic rules (generic patterns)
    const heuristicResult = classifyByRules(raw, lineage);
    if (heuristicResult) return heuristicResult;

    // 4. Unknown
    logger.debug({ txHash: raw.txHash, chain: raw.chain }, "classified as UNKNOWN");
    return {
      type: TransactionType.UNKNOWN,
      audit: {
        method: "heuristic",
        confidence: Confidence.LOW,
        rationale: "no matching classification rule or pattern",
        modelVersion: MODEL_VERSION,
        dataLineage: lineage,
        timestamp: Math.floor(Date.now() / 1000),
      },
    };
  }

  private classifyWithUserRules(raw: RawTransaction, lineage: DataLineage): ClassificationResult | null {
    for (const rule of this.userRules) {
      if (this.matchesRule(raw, rule)) {
        return {
          type: rule.classification,
          audit: {
            method: "user_rule",
            ruleId: rule.id,
            confidence: rule.confidence,
            rationale: `matched user rule: ${rule.name}`,
            modelVersion: MODEL_VERSION,
            dataLineage: lineage,
            timestamp: Math.floor(Date.now() / 1000),
          },
        };
      }
    }
    return null;
  }

  private matchesRule(raw: RawTransaction, rule: ClassificationRule): boolean {
    return rule.conditions.every((condition) => {
      const value = this.getFieldValue(raw, condition.field);
      if (value === undefined) return false;

      switch (condition.operator) {
        case "eq": return value === condition.value;
        case "neq": return value !== condition.value;
        case "contains": return typeof value === "string" && typeof condition.value === "string" && value.includes(condition.value);
        case "in": return Array.isArray(condition.value) && condition.value.includes(value as string);
        case "gte": return parseFloat(value as string) >= parseFloat(condition.value as string);
        case "lte": return parseFloat(value as string) <= parseFloat(condition.value as string);
        default: return false;
      }
    });
  }

  private getFieldValue(raw: RawTransaction, field: string): string | undefined {
    switch (field) {
      case "to": return raw.to;
      case "from": return raw.from;
      case "contract": return raw.to;
      case "method_id": return raw.methodId;
      case "chain": return raw.chain;
      case "value_gte":
      case "value_lte": return raw.value;
      case "token_symbol": return raw.tokenTransfers[0]?.token.symbol;
      default: return undefined;
    }
  }
}
