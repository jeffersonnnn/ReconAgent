import type { JournalEntry } from "../../../interfaces/output.js";

// Xero Manual Journal CSV format
// Xero expects: *Date, *Description, *AccountCode, *AccountName, Debit, Credit, TaxType, Tracking1Name, Tracking1Value
export function toXeroCsv(entries: JournalEntry[]): string {
  const headers = [
    "*Date",
    "*Description",
    "*AccountCode",
    "*AccountName",
    "Debit",
    "Credit",
    "TaxType",
    "Tracking1Name",
    "Tracking1Value",
  ];

  const rows: string[][] = [headers];

  for (const entry of entries) {
    for (const line of entry.lines) {
      rows.push([
        formatXeroDate(entry.date), // DD/MM/YYYY
        csvEscape(entry.memo),
        line.accountCode,
        csvEscape(line.accountName),
        line.side === "debit" ? line.amount : "",
        line.side === "credit" ? line.amount : "",
        "No Tax", // crypto transactions typically not subject to VAT/GST
        "Chain",
        entry.metadata.chain,
      ]);
    }
  }

  return rows.map((r) => r.join(",")).join("\n");
}

function formatXeroDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
