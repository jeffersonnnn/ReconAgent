import type { ReconciliationReport } from "../interfaces/output.js";
import type { ReconEvent } from "../events/types.js";
import { logger } from "../logger.js";

export class SlackDelivery {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  async sendReconciliationSummary(report: ReconciliationReport): Promise<void> {
    const emoji = report.status === "matched" ? ":white_check_mark:" : ":warning:";
    const color = report.status === "matched" ? "#36a64f" : "#ff9900";

    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: `${emoji} Reconciliation Report` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Wallet:*\n\`${report.wallet.slice(0, 10)}...\`` },
          { type: "mrkdwn", text: `*Chain:*\n${report.chain}` },
          { type: "mrkdwn", text: `*Status:*\n${report.status.toUpperCase()}` },
          { type: "mrkdwn", text: `*Timestamp:*\n${new Date(report.timestamp * 1000).toISOString()}` },
        ],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Summary:* ${report.summary}` },
      },
    ];

    if (report.discrepancies.length > 0) {
      const discrepancyText = report.discrepancies
        .slice(0, 5) // limit to 5
        .map((d) => `• \`${d.token.slice(0, 10)}\`: ledger=${d.ledgerBalance}, onchain=${d.onChainBalance} (${d.status})`)
        .join("\n");

      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*Discrepancies:*\n${discrepancyText}` },
      } as any);
    }

    await this.send({ blocks });
  }

  async sendAnomaly(event: Extract<ReconEvent, { type: "anomaly_detected" }>): Promise<void> {
    const severity = event.data.severity;
    const emoji = severity === "high" ? ":rotating_light:" : severity === "medium" ? ":warning:" : ":information_source:";

    await this.send({
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `${emoji} Anomaly Detected` },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Transaction:*\n\`${event.data.transactionId}\`` },
            { type: "mrkdwn", text: `*Severity:*\n${severity.toUpperCase()}` },
            { type: "mrkdwn", text: `*Reason:*\n${event.data.reason}` },
          ],
        },
      ],
    });
  }

  async sendDailyDigest(stats: {
    transactionsProcessed: number;
    classificationsHigh: number;
    classificationsLow: number;
    reconciliationsRun: number;
    discrepanciesFound: number;
  }): Promise<void> {
    await this.send({
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: ":bar_chart: Daily Recon Digest" },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Transactions:*\n${stats.transactionsProcessed}` },
            { type: "mrkdwn", text: `*High Confidence:*\n${stats.classificationsHigh}` },
            { type: "mrkdwn", text: `*Low Confidence:*\n${stats.classificationsLow}` },
            { type: "mrkdwn", text: `*Reconciliations:*\n${stats.reconciliationsRun}` },
            { type: "mrkdwn", text: `*Discrepancies:*\n${stats.discrepanciesFound}` },
          ],
        },
      ],
    });
  }

  private async send(payload: Record<string, unknown>): Promise<void> {
    if (!this.webhookUrl) {
      logger.debug("slack webhook not configured — skipping");
      return;
    }

    try {
      const res = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        logger.warn({ status: res.status }, "slack webhook failed");
      }
    } catch (err) {
      logger.warn({ err }, "slack delivery error");
    }
  }
}
