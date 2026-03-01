import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { ChainId, TokenCategory } from "../../interfaces/common.js";
import type { ChainConnector, RawTransaction, FetchOptions, TokenTransfer, DecodedLog } from "./types.js";
import { logger } from "../../logger.js";

// Helius Enhanced Transaction types
interface HeliusEnhancedTx {
  signature: string;
  slot: number;
  timestamp: number;
  type: string;
  source: string;
  fee: number;
  feePayer: string;
  nativeTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  tokenTransfers: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    fromTokenAccount: string;
    toTokenAccount: string;
    tokenAmount: number;
    mint: string;
    tokenStandard: string;
  }>;
  accountData: Array<{
    account: string;
    nativeBalanceChange: number;
    tokenBalanceChanges: Array<{
      userAccount: string;
      tokenAccount: string;
      rawTokenAmount: { tokenAmount: string; decimals: number };
      mint: string;
    }>;
  }>;
  description: string;
  events: Record<string, unknown>;
  transactionError: string | null;
}

// Map Helius type to our types
const HELIUS_TYPE_MAP: Record<string, string> = {
  SWAP: "swap",
  TRANSFER: "transfer",
  BURN: "burn",
  MINT: "mint",
  NFT_MINT: "nft_mint",
  NFT_SALE: "nft_sale",
  STAKE_SOL: "stake",
  UNSTAKE_SOL: "unstake",
  COMPRESSED_NFT_MINT: "nft_mint",
  TOKEN: "transfer",
  UNKNOWN: "unknown",
};

// Map Helius source to protocol names
const HELIUS_SOURCE_MAP: Record<string, string> = {
  JUPITER: "jupiter",
  RAYDIUM: "raydium",
  ORCA: "orca",
  MARINADE_FINANCE: "marinade",
  TENSOR: "tensor",
  MAGIC_EDEN: "magic_eden",
  METEORA: "meteora",
  SYSTEM_PROGRAM: "system",
};

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelayMs = 1000): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 500;
      logger.warn({ attempt, delay, err: err?.message }, "retrying Solana request");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

export class SolanaConnector implements ChainConnector {
  chain = ChainId.SOLANA;
  private connection: Connection;
  private heliusApiKey: string;
  private heliusBaseUrl: string;

  constructor(heliusRpcUrl: string, heliusApiKey: string) {
    this.connection = new Connection(heliusRpcUrl, "confirmed");
    this.heliusApiKey = heliusApiKey;
    this.heliusBaseUrl = `https://api.helius.xyz/v0`;
  }

  async fetchTransactions(wallet: string, opts: FetchOptions): Promise<RawTransaction[]> {
    logger.info({ chain: this.chain, wallet, opts }, "fetching Solana transactions");

    const enhancedTxs = await this.getEnhancedTransactions(wallet, opts);
    logger.info({ count: enhancedTxs.length }, "fetched Helius enhanced transactions");

    return enhancedTxs.map((tx) => this.mapHeliusTx(tx, wallet));
  }

  private async getEnhancedTransactions(wallet: string, opts: FetchOptions): Promise<HeliusEnhancedTx[]> {
    // First get signatures, then parse them via Helius
    const signatures = await withRetry(() =>
      this.connection.getSignaturesForAddress(new PublicKey(wallet), {
        limit: opts.limit ?? 100,
        before: opts.fromSignature,
      })
    );

    if (signatures.length === 0) return [];

    const sigList = signatures.map((s) => s.signature);

    // Helius parseTransactions endpoint (batches of 100)
    const allTxs: HeliusEnhancedTx[] = [];
    for (let i = 0; i < sigList.length; i += 100) {
      const batch = sigList.slice(i, i + 100);
      const txs = await withRetry(async () => {
        const res = await fetch(
          `${this.heliusBaseUrl}/transactions?api-key=${this.heliusApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transactions: batch }),
          }
        );
        if (!res.ok) throw new Error(`Helius API error: ${res.status} ${res.statusText}`);
        return (await res.json()) as HeliusEnhancedTx[];
      });
      allTxs.push(...txs);
    }

    return allTxs;
  }

  private mapHeliusTx(tx: HeliusEnhancedTx, wallet: string): RawTransaction {
    const walletLower = wallet.toLowerCase();

    // Map token transfers
    const tokenTransfers: TokenTransfer[] = (tx.tokenTransfers ?? []).map((t, i) => ({
      token: {
        address: t.mint,
        symbol: "UNKNOWN", // enriched later via metadata
        decimals: 0, // will be set from raw token amount
        category: TokenCategory.SPL_TOKEN,
        chain: ChainId.SOLANA,
      },
      from: t.fromUserAccount ?? "",
      to: t.toUserAccount ?? "",
      amount: t.tokenAmount.toString(),
      rawAmount: t.tokenAmount.toString(),
      logIndex: i,
    }));

    // Map native transfers
    const nativeTransfers: TokenTransfer[] = (tx.nativeTransfers ?? []).map((t, i) => ({
      token: {
        address: "native",
        symbol: "SOL",
        decimals: 9,
        category: TokenCategory.NATIVE,
        chain: ChainId.SOLANA,
      },
      from: t.fromUserAccount,
      to: t.toUserAccount,
      amount: (t.amount / LAMPORTS_PER_SOL).toString(),
      rawAmount: t.amount.toString(),
      logIndex: tokenTransfers.length + i,
    }));

    const allTransfers = [...tokenTransfers, ...nativeTransfers];

    return {
      chain: ChainId.SOLANA,
      txHash: tx.signature,
      blockNumber: tx.slot,
      blockTimestamp: tx.timestamp,
      from: tx.feePayer ?? "",
      to: "", // Solana txs don't have a single "to"
      value: "0",
      gasUsed: "0",
      gasPrice: "0",
      gasFeeNative: (tx.fee / LAMPORTS_PER_SOL).toString(),
      success: tx.transactionError === null,
      methodName: tx.type,
      tokenTransfers: allTransfers,
      internalTransactions: [],
      logs: [],
      rawData: {
        heliusType: tx.type,
        heliusSource: tx.source,
        description: tx.description,
        events: tx.events,
        protocol: HELIUS_SOURCE_MAP[tx.source],
        accountData: tx.accountData,
      },
    };
  }

  async getBalance(wallet: string, tokenAddress: string): Promise<string> {
    if (tokenAddress === "native") {
      const balance = await this.connection.getBalance(new PublicKey(wallet));
      return (balance / LAMPORTS_PER_SOL).toString();
    }

    // SPL token balance via getTokenAccountsByOwner
    const accounts = await this.connection.getParsedTokenAccountsByOwner(
      new PublicKey(wallet),
      { mint: new PublicKey(tokenAddress) }
    );

    if (accounts.value.length === 0) return "0";

    let total = 0;
    for (const account of accounts.value) {
      const parsed = account.account.data.parsed;
      total += parsed.info.tokenAmount.uiAmount ?? 0;
    }
    return total.toString();
  }

  async getCurrentBlock(): Promise<number> {
    return await this.connection.getSlot();
  }
}
