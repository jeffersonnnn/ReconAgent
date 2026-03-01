import type { JournalEntry } from "../../../interfaces/output.js";

// Canonical CSV export format
export function toCanonicalCsv(entries: JournalEntry[]): string {
  const headers = [
    "JournalEntryId",
    "TransactionId",
    "Date",
    "Memo",
    "AccountCode",
    "AccountName",
    "Debit",
    "Credit",
    "TokenAmount",
    "TokenSymbol",
    "Chain",
    "TxHash",
    "TransactionType",
    "Protocol",
  ];

  const rows: string[][] = [headers];

  for (const entry of entries) {
    for (const line of entry.lines) {
      rows.push([
        entry.id,
        entry.transactionId,
        entry.date,
        csvEscape(entry.memo),
        line.accountCode,
        csvEscape(line.accountName),
        line.side === "debit" ? line.amount : "",
        line.side === "credit" ? line.amount : "",
        line.tokenAmount ?? "",
        line.tokenSymbol ?? "",
        entry.metadata.chain,
        entry.metadata.txHash,
        entry.metadata.transactionType,
        entry.metadata.protocol ?? "",
      ]);
    }
  }

  return rows.map((r) => r.join(",")).join("\n");
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
