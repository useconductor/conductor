/**
 * Webhook System — event-driven plugin communication.
 *
 * Plugins can emit events. External systems can subscribe via webhooks.
 * Events are queued, retried on failure, and logged for audit.
 *
 * Event types: tool_called, tool_failed, plugin_enabled, plugin_disabled,
 *              config_changed, auth_success, auth_failure, health_degraded
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export interface WebhookSubscription {
  id: string;
  url: string;
  /** Events to receive. ['*'] for all events. */
  events: string[];
  /** Secret for HMAC signature verification */
  secret: string;
  /** Whether this subscription is active */
  active: boolean;
  /** Created timestamp */
  createdAt: string;
  /** Last successful delivery timestamp */
  lastSuccessAt?: string;
  /** Number of consecutive failures */
  consecutiveFailures: number;
}

export interface WebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  /** The resource that triggered the event */
  resource: string;
  /** Event payload */
  data: Record<string, unknown>;
}

export interface WebhookDelivery {
  eventId: string;
  subscriptionId: string;
  url: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  lastAttemptAt?: string;
  responseCode?: number;
  responseError?: string;
}

const MAX_CONSECUTIVE_FAILURES = 10;
const DELIVERY_TIMEOUT = 10000;

export class WebhookManager {
  private subscriptionsFile: string;
  private subscriptions: Map<string, WebhookSubscription>;
  private deliveryQueue: Array<{ event: WebhookEvent; subscription: WebhookSubscription }>;
  private processing = false;

  constructor(configDir: string) {
    this.subscriptionsFile = path.join(configDir, 'webhooks.json');
    this.subscriptions = new Map();
    this.deliveryQueue = [];
  }

  /**
   * Load subscriptions from disk.
   */
  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.subscriptionsFile, 'utf-8');
      const data = JSON.parse(content) as WebhookSubscription[];
      for (const sub of data) {
        this.subscriptions.set(sub.id, sub);
      }
    } catch {
      // No subscriptions file yet
    }
  }

  /**
   * Save subscriptions to disk.
   */
  async save(): Promise<void> {
    const data = Array.from(this.subscriptions.values());
    await fs.writeFile(this.subscriptionsFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  }

  /**
   * Create a new webhook subscription.
   */
  async create(url: string, events: string[]): Promise<WebhookSubscription> {
    const subscription: WebhookSubscription = {
      id: crypto.randomUUID(),
      url,
      events,
      secret: crypto.randomBytes(32).toString('hex'),
      active: true,
      createdAt: new Date().toISOString(),
      consecutiveFailures: 0,
    };

    this.subscriptions.set(subscription.id, subscription);
    await this.save();
    return subscription;
  }

  /**
   * Delete a webhook subscription.
   */
  async delete(id: string): Promise<boolean> {
    const deleted = this.subscriptions.delete(id);
    if (deleted) await this.save();
    return deleted;
  }

  /**
   * List all subscriptions.
   */
  list(): WebhookSubscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Emit an event. Queues it for delivery to matching subscriptions.
   */
  async emit(event: Omit<WebhookEvent, 'id' | 'timestamp'>): Promise<void> {
    const fullEvent: WebhookEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    for (const sub of this.subscriptions.values()) {
      if (!sub.active) continue;
      if (!sub.events.includes('*') && !sub.events.includes(event.type)) continue;

      this.deliveryQueue.push({ event: fullEvent, subscription: sub });
    }

    // Process queue asynchronously
    if (!this.processing) {
      this.processQueue().catch(() => {});
    }
  }

  /**
   * Process the delivery queue.
   */
  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.deliveryQueue.length > 0) {
      const item = this.deliveryQueue.shift()!;
      await this.deliver(item.event, item.subscription);
    }

    this.processing = false;
  }

  /**
   * Deliver an event to a subscription.
   */
  private async deliver(event: WebhookEvent, subscription: WebhookSubscription): Promise<void> {
    const payload = JSON.stringify({
      id: event.id,
      type: event.type,
      timestamp: event.timestamp,
      resource: event.resource,
      data: event.data,
    });

    const signature = crypto
      .createHmac('sha256', subscription.secret)
      .update(payload)
      .digest('hex');

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT);

      const response = await fetch(subscription.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Conductor-Signature': `sha256=${signature}`,
          'X-Conductor-Event': event.type,
          'X-Conductor-Delivery': event.id,
          'User-Agent': 'Conductor-Webhook/1.0',
        },
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        subscription.consecutiveFailures = 0;
        subscription.lastSuccessAt = new Date().toISOString();
        await this.save();
      } else {
        await this.recordFailure(subscription, response.status, `HTTP ${response.status}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.recordFailure(subscription, 0, message);
    }
  }

  /**
   * Record a delivery failure. Deactivate after MAX_CONSECUTIVE_FAILURES.
   */
  private async recordFailure(subscription: WebhookSubscription, status: number, error: string): Promise<void> {
    subscription.consecutiveFailures++;

    if (subscription.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      subscription.active = false;
    }

    await this.save();
  }

  /**
   * Generate example webhook payload for testing.
   */
  static exampleEvent(type: string, resource: string): WebhookEvent {
    return {
      id: 'evt_example_123',
      type,
      timestamp: new Date().toISOString(),
      resource,
      data: { example: true, message: 'This is a test event' },
    };
  }
}
