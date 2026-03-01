import type { ReconEvent, ReconEventType, ReconEventHandler } from "./types.js";
import { logger } from "../logger.js";

export class ReconEventEmitter {
  private handlers = new Map<ReconEventType, Set<ReconEventHandler<any>>>();

  on<T extends ReconEventType>(type: T, handler: ReconEventHandler<T>): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  off<T extends ReconEventType>(type: T, handler: ReconEventHandler<T>): void {
    this.handlers.get(type)?.delete(handler);
  }

  async emit(event: ReconEvent): Promise<void> {
    logger.debug({ eventType: event.type }, "event emitted");
    const handlers = this.handlers.get(event.type);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        await handler(event as any);
      } catch (err) {
        logger.error({ err, eventType: event.type }, "event handler error");
      }
    }
  }
}
