import { createPublicClient, http, formatEther, formatUnits, parseAbiItem, type PublicClient, type Chain } from "viem";
import { mainnet, arbitrum, optimism, base, polygon } from "viem/chains";
import { ChainId, TokenCategory } from "../../interfaces/common.js";
import type { ChainConnector, RawTransaction, FetchOptions, TokenTransfer, InternalTransaction, DecodedLog } from "./types.js";
import { logger } from "../../logger.js";

const CHAIN_MAP: Record<string, Chain> = {
  ethereum: mainnet,
  arbitrum: arbitrum,
  optimism: optimism,
  base: base,
  polygon: polygon,
};

// Alchemy getAssetTransfers categories
const TRANSFER_CATEGORIES = ["external", "internal", "erc20", "erc721", "erc1155"];

// ERC20 Transfer event signature
const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

// Rate limiter: exponential backoff
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelayMs = 1000): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (attempt === maxRetries) throw err;
      const isRateLimit = err?.status === 429 || err?.code === 429 || err?.message?.includes("429");
      const delay = isRateLimit
        ? baseDelayMs * Math.pow(2, attempt) + Math.random() * 500
        : baseDelayMs * (attempt + 1);
      logger.warn({ attempt, delay, err: err?.message }, "retrying after error");
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

export class EvmConnector implements ChainConnector {
  chain: ChainId;
  private client: PublicClient;
  private alchemyUrl: string;

  constructor(chain: ChainId, alchemyUrl: string) {
    if (!CHAIN_MAP[chain]) throw new Error(`unsupported EVM chain: ${chain}`);
    this.chain = chain;
    this.alchemyUrl = alchemyUrl;
    this.client = createPublicClient({
      chain: CHAIN_MAP[chain],
      transport: http(alchemyUrl),
    });
  }

  async fetchTransactions(wallet: string, opts: FetchOptions): Promise<RawTransaction[]> {
    const walletLower = wallet.toLowerCase();
    logger.info({ chain: this.chain, wallet: walletLower, opts }, "fetching EVM transactions");

    // Use Alchemy getAssetTransfers for historical tx discovery
    const [outbound, inbound] = await Promise.all([
      this.getAssetTransfers(walletLower, "from", opts),
      this.getAssetTransfers(walletLower, "to", opts),
    ]);

    // Deduplicate by txHash
    const txHashSet = new Set<string>();
    const allTransfers = [...outbound, ...inbound].filter((t) => {
      if (txHashSet.has(t.hash)) return false;
      txHashSet.add(t.hash);
      return true;
    });

    logger.info({ chain: this.chain, count: allTransfers.length }, "discovered transactions");

    // Enrich each transaction with full receipt data
    const rawTxs: RawTransaction[] = [];
    for (const transfer of allTransfers) {
      try {
        const enriched = await withRetry(() => this.enrichTransaction(transfer.hash, walletLower));
        if (enriched) rawTxs.push(enriched);
      } catch (err) {
        logger.error({ txHash: transfer.hash, err }, "failed to enrich transaction");
      }
    }

    return rawTxs.sort((a, b) => a.blockNumber - b.blockNumber);
  }

  private async getAssetTransfers(
    wallet: string,
    direction: "from" | "to",
    opts: FetchOptions
  ): Promise<Array<{ hash: string }>> {
    const params: any = {
      [direction === "from" ? "fromAddress" : "toAddress"]: wallet,
      category: TRANSFER_CATEGORIES,
      withMetadata: true,
      order: "asc",
      maxCount: "0x3E8", // 1000
    };

    if (opts.fromBlock) params.fromBlock = `0x${opts.fromBlock.toString(16)}`;
    if (opts.toBlock) params.toBlock = `0x${opts.toBlock.toString(16)}`;

    const result = await withRetry(async () => {
      const res = await fetch(this.alchemyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "alchemy_getAssetTransfers",
          params: [params],
        }),
      });
      const json = await res.json() as any;
      if (json.error) throw new Error(`Alchemy error: ${json.error.message}`);
      return json.result;
    });

    return (result?.transfers ?? []).map((t: any) => ({ hash: t.hash }));
  }

  private async enrichTransaction(txHash: string, wallet: string): Promise<RawTransaction | null> {
    const [tx, receipt] = await Promise.all([
      this.client.getTransaction({ hash: txHash as `0x${string}` }),
      this.client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
    ]);

    if (!tx || !receipt) return null;

    const block = await withRetry(() =>
      this.client.getBlock({ blockNumber: tx.blockNumber! })
    );

    // Decode token transfers from logs
    const tokenTransfers: TokenTransfer[] = [];
    const decodedLogs: DecodedLog[] = [];

    for (const log of receipt.logs) {
      const decoded: DecodedLog = {
        address: log.address,
        topics: log.topics as string[],
        data: log.data,
        logIndex: log.logIndex,
      };

      // Try to decode ERC20 Transfer
      if (
        log.topics[0] === "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" &&
        log.topics.length === 3
      ) {
        const from = ("0x" + log.topics[1]!.slice(26)).toLowerCase();
        const to = ("0x" + log.topics[2]!.slice(26)).toLowerCase();
        const rawAmount = BigInt(log.data).toString();

        decoded.eventName = "Transfer";
        decoded.decodedArgs = { from, to, value: rawAmount };

        tokenTransfers.push({
          token: {
            address: log.address.toLowerCase(),
            symbol: "UNKNOWN", // enriched later
            decimals: 18, // default, enriched later
            category: TokenCategory.ERC20,
            chain: this.chain,
          },
          from,
          to,
          amount: rawAmount, // will be formatted after decimal lookup
          rawAmount,
          logIndex: log.logIndex,
        });
      }

      decodedLogs.push(decoded);
    }

    const gasUsed = receipt.gasUsed.toString();
    const gasPrice = receipt.effectiveGasPrice?.toString() ?? tx.gasPrice?.toString() ?? "0";
    const gasFeeWei = (receipt.gasUsed * (receipt.effectiveGasPrice ?? tx.gasPrice ?? 0n)).toString();

    return {
      chain: this.chain,
      txHash: txHash.toLowerCase(),
      blockNumber: Number(tx.blockNumber),
      blockTimestamp: Number(block.timestamp),
      from: tx.from.toLowerCase(),
      to: (tx.to ?? "0x0000000000000000000000000000000000000000").toLowerCase(),
      value: formatEther(tx.value),
      gasUsed,
      gasPrice,
      gasFeeNative: formatEther(BigInt(gasFeeWei)),
      success: receipt.status === "success",
      methodId: tx.input.length >= 10 ? tx.input.slice(0, 10) : undefined,
      contractAddress: receipt.contractAddress?.toLowerCase(),
      tokenTransfers,
      internalTransactions: [], // fetched separately if needed
      logs: decodedLogs,
      rawData: {
        transactionIndex: Number(receipt.transactionIndex),
        nonce: Number(tx.nonce),
        type: tx.type,
        logsBloom: receipt.logsBloom,
      },
    };
  }

  async getBalance(wallet: string, tokenAddress: string): Promise<string> {
    if (tokenAddress === "native") {
      const balance = await this.client.getBalance({ address: wallet as `0x${string}` });
      return formatEther(balance);
    }

    // ERC20 balance
    const balance = await this.client.readContract({
      address: tokenAddress as `0x${string}`,
      abi: [parseAbiItem("function balanceOf(address) view returns (uint256)")],
      functionName: "balanceOf",
      args: [wallet as `0x${string}`],
    });
    return balance.toString(); // raw — caller should format with decimals
  }

  async getCurrentBlock(): Promise<number> {
    const block = await this.client.getBlockNumber();
    return Number(block);
  }
}
