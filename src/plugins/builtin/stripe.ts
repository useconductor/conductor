/**
 * Stripe Plugin — Conductor
 *
 * Manage customers, payments, subscriptions, invoices, and account balance
 * via the Stripe REST API. Requires a Stripe secret key.
 *
 * Setup: Stripe Dashboard > Developers > API Keys > Secret key
 * Keychain entry: stripe / secret_key
 */

import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

const STRIPE_BASE = 'https://api.stripe.com/v1';

export class StripePlugin implements Plugin {
  name = 'stripe';
  description = 'Manage Stripe customers, payments, subscriptions, invoices, and billing';
  version = '1.0.0';

  private keychain!: Keychain;

  configSchema = {
    fields: [
      {
        key: 'secret_key',
        label: 'Stripe Secret Key',
        type: 'password' as const,
        required: true,
        secret: true,
        service: 'stripe',
        description: 'Starts with sk_live_ or sk_test_. From Dashboard > Developers > API Keys.',
      },
    ],
    setupInstructions:
      'Get your secret key from the Stripe Dashboard at https://dashboard.stripe.com/apikeys. Use a restricted key with only the permissions you need.',
  };

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
  }

  isConfigured(): boolean {
    return true;
  }

  private async getKey(): Promise<string> {
    const k = await this.keychain.get('stripe', 'secret_key');
    if (!k) throw new Error('Stripe secret key not configured. Run: conductor plugins setup stripe');
    return k;
  }

  private async stripeFetch(path: string, params?: Record<string, string>, method = 'GET'): Promise<any> {
    const key = await this.getKey();
    const url = `${STRIPE_BASE}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2024-04-10',
    };

    let body: string | undefined;
    let finalUrl = url;

    if (method === 'GET' && params) {
      const qs = new URLSearchParams(params).toString();
      finalUrl = `${url}?${qs}`;
    } else if (params) {
      body = new URLSearchParams(params).toString();
    }

    const res = await fetch(finalUrl, { method, headers, body });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(`Stripe error: ${(err as any).error?.message ?? res.statusText}`);
    }
    return res.json();
  }

  getTools(): PluginTool[] {
    return [
      // ── Customers ────────────────────────────────────────────────────────
      {
        name: 'stripe_customers',
        description: 'List Stripe customers, optionally filtered by email',
        inputSchema: {
          type: 'object',
          properties: {
            email: { type: 'string', description: 'Filter by exact email address' },
            limit: { type: 'number', description: 'Number of results (default 10, max 100)' },
          },
        },
        handler: async ({ email, limit = 10 }: any) => {
          const params: Record<string, string> = { limit: String(Math.min(limit, 100)) };
          if (email) params.email = email;
          const data = await this.stripeFetch('/customers', params);
          return {
            count: data.data.length,
            hasMore: data.has_more,
            customers: data.data.map((c: any) => ({
              id: c.id,
              email: c.email,
              name: c.name,
              created: new Date(c.created * 1000).toISOString(),
              currency: c.currency,
              balance: c.balance,
              subscriptions: c.subscriptions?.total_count ?? 0,
            })),
          };
        },
      },

      {
        name: 'stripe_customer',
        description: 'Get a Stripe customer by ID',
        inputSchema: {
          type: 'object',
          properties: {
            customer_id: { type: 'string', description: 'Stripe customer ID (cus_...)' },
          },
          required: ['customer_id'],
        },
        handler: async ({ customer_id }: any) => {
          const c = await this.stripeFetch(`/customers/${customer_id}`);
          return {
            id: c.id,
            email: c.email,
            name: c.name,
            phone: c.phone,
            created: new Date(c.created * 1000).toISOString(),
            currency: c.currency,
            balance: c.balance,
            defaultPaymentMethod: c.invoice_settings?.default_payment_method,
            metadata: c.metadata,
            address: c.address,
          };
        },
      },

      // ── Payments ─────────────────────────────────────────────────────────
      {
        name: 'stripe_payments',
        description: 'List recent payment intents',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Number of results (default 10)' },
            customer: { type: 'string', description: 'Filter by customer ID' },
          },
        },
        handler: async ({ limit = 10, customer }: any) => {
          const params: Record<string, string> = { limit: String(Math.min(limit, 100)) };
          if (customer) params.customer = customer;
          const data = await this.stripeFetch('/payment_intents', params);
          return {
            count: data.data.length,
            payments: data.data.map((p: any) => ({
              id: p.id,
              amount: p.amount,
              currency: p.currency,
              status: p.status,
              customer: p.customer,
              created: new Date(p.created * 1000).toISOString(),
              description: p.description,
            })),
          };
        },
      },

      {
        name: 'stripe_payment',
        description: 'Get a single payment intent by ID',
        inputSchema: {
          type: 'object',
          properties: {
            payment_id: { type: 'string', description: 'Payment intent ID (pi_...)' },
          },
          required: ['payment_id'],
        },
        handler: async ({ payment_id }: any) => {
          const p = await this.stripeFetch(`/payment_intents/${payment_id}`);
          return {
            id: p.id,
            amount: p.amount,
            amountReceived: p.amount_received,
            currency: p.currency,
            status: p.status,
            customer: p.customer,
            created: new Date(p.created * 1000).toISOString(),
            description: p.description,
            paymentMethod: p.payment_method,
            metadata: p.metadata,
          };
        },
      },

      // ── Subscriptions ─────────────────────────────────────────────────────
      {
        name: 'stripe_subscriptions',
        description: 'List subscriptions, optionally filtered by status',
        inputSchema: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description: 'Filter by status: active, past_due, canceled, trialing, all',
              enum: ['active', 'past_due', 'canceled', 'trialing', 'all'],
            },
            customer: { type: 'string', description: 'Filter by customer ID' },
            limit: { type: 'number', description: 'Number of results (default 10)' },
          },
        },
        handler: async ({ status = 'active', customer, limit = 10 }: any) => {
          const params: Record<string, string> = { limit: String(Math.min(limit, 100)) };
          if (status !== 'all') params.status = status;
          if (customer) params.customer = customer;
          const data = await this.stripeFetch('/subscriptions', params);
          return {
            count: data.data.length,
            subscriptions: data.data.map((s: any) => ({
              id: s.id,
              customer: s.customer,
              status: s.status,
              currentPeriodEnd: new Date(s.current_period_end * 1000).toISOString(),
              cancelAtPeriodEnd: s.cancel_at_period_end,
              items: s.items.data.map((i: any) => ({
                priceId: i.price.id,
                productId: i.price.product,
                amount: i.price.unit_amount,
                currency: i.price.currency,
                interval: i.price.recurring?.interval,
              })),
            })),
          };
        },
      },

      {
        name: 'stripe_subscription',
        description: 'Get a single subscription by ID',
        inputSchema: {
          type: 'object',
          properties: {
            subscription_id: { type: 'string', description: 'Subscription ID (sub_...)' },
          },
          required: ['subscription_id'],
        },
        handler: async ({ subscription_id }: any) => {
          const s = await this.stripeFetch(`/subscriptions/${subscription_id}`);
          return {
            id: s.id,
            customer: s.customer,
            status: s.status,
            trialEnd: s.trial_end ? new Date(s.trial_end * 1000).toISOString() : null,
            currentPeriodStart: new Date(s.current_period_start * 1000).toISOString(),
            currentPeriodEnd: new Date(s.current_period_end * 1000).toISOString(),
            cancelAtPeriodEnd: s.cancel_at_period_end,
            metadata: s.metadata,
            items: s.items.data.map((i: any) => ({
              priceId: i.price.id,
              amount: i.price.unit_amount,
              currency: i.price.currency,
              interval: `${i.price.recurring?.interval_count}x${i.price.recurring?.interval}`,
            })),
          };
        },
      },

      // ── Invoices ──────────────────────────────────────────────────────────
      {
        name: 'stripe_invoices',
        description: 'List invoices, optionally filtered by customer',
        inputSchema: {
          type: 'object',
          properties: {
            customer: { type: 'string', description: 'Filter by customer ID' },
            status: { type: 'string', description: 'Filter by status: draft, open, paid, uncollectible, void' },
            limit: { type: 'number', description: 'Number of results (default 10)' },
          },
        },
        handler: async ({ customer, status, limit = 10 }: any) => {
          const params: Record<string, string> = { limit: String(Math.min(limit, 100)) };
          if (customer) params.customer = customer;
          if (status) params.status = status;
          const data = await this.stripeFetch('/invoices', params);
          return {
            count: data.data.length,
            invoices: data.data.map((inv: any) => ({
              id: inv.id,
              number: inv.number,
              customer: inv.customer,
              status: inv.status,
              amountDue: inv.amount_due,
              amountPaid: inv.amount_paid,
              currency: inv.currency,
              created: new Date(inv.created * 1000).toISOString(),
              dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
              hostedInvoiceUrl: inv.hosted_invoice_url,
            })),
          };
        },
      },

      // ── Products ──────────────────────────────────────────────────────────
      {
        name: 'stripe_products',
        description: 'List Stripe products with their prices',
        inputSchema: {
          type: 'object',
          properties: {
            active: { type: 'boolean', description: 'Filter by active status (default true)' },
            limit: { type: 'number', description: 'Number of results (default 10)' },
          },
        },
        handler: async ({ active = true, limit = 10 }: any) => {
          const params: Record<string, string> = {
            limit: String(Math.min(limit, 100)),
            active: String(active),
          };
          const data = await this.stripeFetch('/products', params);
          return {
            count: data.data.length,
            products: data.data.map((p: any) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              active: p.active,
              created: new Date(p.created * 1000).toISOString(),
              metadata: p.metadata,
            })),
          };
        },
      },

      // ── Balance ───────────────────────────────────────────────────────────
      {
        name: 'stripe_balance',
        description: 'Get current Stripe account balance (available and pending)',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          const b = await this.stripeFetch('/balance');
          return {
            available: b.available.map((a: any) => ({ amount: a.amount, currency: a.currency })),
            pending: b.pending.map((p: any) => ({ amount: p.amount, currency: p.currency })),
            livemode: b.livemode,
          };
        },
      },

      // ── Refunds ───────────────────────────────────────────────────────────
      {
        name: 'stripe_refund',
        description: 'Create a refund for a payment intent or charge',
        inputSchema: {
          type: 'object',
          properties: {
            payment_intent: { type: 'string', description: 'Payment intent ID to refund' },
            charge: { type: 'string', description: 'Charge ID to refund (alternative to payment_intent)' },
            amount: { type: 'number', description: 'Amount in cents to refund (omit for full refund)' },
            reason: {
              type: 'string',
              description: 'Reason: duplicate, fraudulent, or requested_by_customer',
              enum: ['duplicate', 'fraudulent', 'requested_by_customer'],
            },
          },
        },
        requiresApproval: true,
        handler: async ({ payment_intent, charge, amount, reason }: any) => {
          const params: Record<string, string> = {};
          if (payment_intent) params.payment_intent = payment_intent;
          if (charge) params.charge = charge;
          if (amount) params.amount = String(amount);
          if (reason) params.reason = reason;
          const r = await this.stripeFetch('/refunds', params, 'POST');
          return {
            id: r.id,
            amount: r.amount,
            currency: r.currency,
            status: r.status,
            reason: r.reason,
            created: new Date(r.created * 1000).toISOString(),
          };
        },
      },
    ];
  }
}
