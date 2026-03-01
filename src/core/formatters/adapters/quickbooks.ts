import type { JournalEntry } from "../../../interfaces/output.js";

// QuickBooks Journal Entry JSON format
export interface QBJournalEntry {
  DocNumber: string;
  TxnDate: string;
  PrivateNote: string;
  Line: QBLine[];
}

interface QBLine {
  DetailType: "JournalEntryLineDetail";
  Amount: number;
  Description: string;
  JournalEntryLineDetail: {
    PostingType: "Debit" | "Credit";
    AccountRef: { name: string; value: string };
  };
}

export function toQuickBooksJson(entries: JournalEntry[]): string {
  const qbEntries: QBJournalEntry[] = entries.map((entry) => ({
    DocNumber: entry.id.slice(0, 20),
    TxnDate: entry.date,
    PrivateNote: entry.memo,
    Line: entry.lines.map((line) => ({
      DetailType: "JournalEntryLineDetail" as const,
      Amount: parseFloat(line.amount),
      Description: `${line.tokenAmount ?? ""} ${line.tokenSymbol ?? ""}`.trim(),
      JournalEntryLineDetail: {
        PostingType: line.side === "debit" ? "Debit" as const : "Credit" as const,
        AccountRef: {
          name: line.accountName,
          value: line.accountCode,
        },
      },
    })),
  }));

  return JSON.stringify(qbEntries, null, 2);
}
