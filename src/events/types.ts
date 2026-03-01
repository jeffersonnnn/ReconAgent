import type { ClassifiedTransaction, ReconciliationReport, HumanOverride } from "../interfaces/output.js";
import type { BridgeLeg } from "../storage/adapter.js";

export type ReconEvent =
  | { type: "transaction_classified"; data: ClassifiedTransaction }
  | { type: "anomaly_detected"; data: { transactionId: string; reason: string; severity: "low" | "medium" | "high" } }
  | { type: "reconciliation_complete"; data: ReconciliationReport }
  | { type: "bridge_matched"; data: { outbound: BridgeLeg; inbound: BridgeLeg } }
  | { type: "manual_override"; data: HumanOverride }
  | { type: "price_missing"; data: { chain: string; tokenAddress: string; timestamp: number } }
  | { type: "classification_low_confidence"; data: { transactionId: string; confidence: string; rationale: string } };

export type ReconEventType = ReconEvent["type"];

export type ReconEventHandler<T extends ReconEventType = ReconEventType> = (
  event: Extract<ReconEvent, { type: T }>
) => void | Promise<void>;
