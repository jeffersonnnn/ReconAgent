import type { JournalEntry } from "../../../interfaces/output.js";

// NetSuite Journal Entry CSV Import format
export function toNetsuiteCsv(entries: JournalEntry[]): string {
  const headers = [
    "External ID",
    "Date",
    "Memo",
    "Account",
    "Debit",
    "Credit",
    "Name",
    "Class",
    "Department",
  ];

  const rows: string[][] = [headers];

  for (const entry of entries) {
    for (const line of entry.lines) {
      rows.push([
        entry.transactionId,
        entry.date,
        csvEscape(entry.memo),
        `${line.accountCode} ${line.accountName}`,
        line.side === "debit" ? line.amount : "",
        line.side === "credit" ? line.amount : "",
        entry.metadata.wallet.slice(0, 10) + "...",
        entry.metadata.chain,
        entry.metadata.protocol ?? "direct",
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
