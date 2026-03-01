import { ExportFormat } from "../interfaces/common.js";
import type { ChainId } from "../interfaces/common.js";

export interface CliArgs {
  mode: "recon" | "backfill" | "reconcile" | "export" | "status" | "override";
  chain?: ChainId;
  wallet?: string;
  from?: string; // ISO date or block number
  to?: string;
  format?: ExportFormat;
  transactionId?: string;
  newType?: string;
  reason?: string;
  outputPath?: string;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { mode: "status" };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--mode=")) {
      args.mode = arg.split("=")[1] as CliArgs["mode"];
    } else if (arg.startsWith("--chain=")) {
      args.chain = arg.split("=")[1] as ChainId;
    } else if (arg.startsWith("--wallet=")) {
      args.wallet = arg.split("=")[1];
    } else if (arg.startsWith("--from=")) {
      args.from = arg.split("=")[1];
    } else if (arg.startsWith("--to=")) {
      args.to = arg.split("=")[1];
    } else if (arg.startsWith("--format=")) {
      args.format = arg.split("=")[1] as ExportFormat;
    } else if (arg.startsWith("--tx=")) {
      args.transactionId = arg.split("=")[1];
    } else if (arg.startsWith("--type=")) {
      args.newType = arg.split("=")[1];
    } else if (arg.startsWith("--reason=")) {
      args.reason = arg.split("=")[1];
    } else if (arg.startsWith("--output=")) {
      args.outputPath = arg.split("=")[1];
    }
  }

  return args;
}

export function printUsage(): void {
  console.log(`
ReconAgent v1.0.0 — Multi-chain DeFi Reconciliation Agent

USAGE:
  bun run src/index.ts --mode=<mode> [options]

MODES:
  status      Show agent status and wallet states
  recon       Continuous monitoring (poll for new transactions)
  backfill    Process historical transactions
  reconcile   Run one-shot reconciliation
  export      Export journal entries to accounting format
  override    Manually override a transaction classification

OPTIONS:
  --chain=<chain>     Chain: ethereum, arbitrum, optimism, base, polygon, solana
  --wallet=<addr>     Wallet address to process
  --from=<date>       Start date (YYYY-MM-DD) or block number
  --to=<date>         End date (YYYY-MM-DD) or block number
  --format=<fmt>      Export format: canonical, xero, quickbooks, netsuite
  --output=<path>     Output file path for export
  --tx=<id>           Transaction ID (for override mode)
  --type=<type>       New transaction type (for override mode)
  --reason=<text>     Override reason (for override mode)

EXAMPLES:
  bun run src/index.ts --mode=status
  bun run src/index.ts --mode=backfill --chain=ethereum --from=2026-01-01
  bun run src/index.ts --mode=reconcile --wallet=0x1234...
  bun run src/index.ts --mode=export --format=xero --from=2026-01-01 --to=2026-02-18
  bun run src/index.ts --mode=recon
`);
}
