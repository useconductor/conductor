import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StripePlugin } from '../src/plugins/builtin/stripe.js';
import { Keychain } from '../src/security/keychain.js';

// Helper: get a tool's handler by name
function tool(plugin: StripePlugin, name: string) {
  const t = plugin.getTools().find((t) => t.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t.handler as (args: Record<string, unknown>) => Promise<unknown>;
}

// Minimal conductor mock
function makeConductor(configDir = '/tmp/conductor-test-stripe') {
  return {
    getConfig: () => ({
      getConfigDir: () => configDir,
      get: (_key: string) => null,
    }),
  } as any;
}

let plugin: StripePlugin;

beforeEach(async () => {
  plugin = new StripePlugin();
  await plugin.initialize(makeConductor());
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Structure ────────────────────────────────────────────────────────────────

describe('StripePlugin structure', () => {
  it('has correct name and version', () => {
    expect(plugin.name).toBe('stripe');
    expect(plugin.version).toBeTruthy();
  });

  it('registers expected tools', () => {
    const names = plugin.getTools().map((t) => t.name);
    expect(names).toContain('stripe_customers');
    expect(names).toContain('stripe_customer');
    expect(names).toContain('stripe_payments');
    expect(names).toContain('stripe_balance');
    expect(names).toContain('stripe_subscriptions');
    expect(names).toContain('stripe_invoices');
    expect(names).toContain('stripe_products');
    expect(names).toContain('stripe_refund');
  });

  it('marks stripe_refund as requiresApproval', () => {
    const t = plugin.getTools().find((t) => t.name === 'stripe_refund');
    expect(t?.requiresApproval).toBe(true);
  });
});

// ── isConfigured ─────────────────────────────────────────────────────────────

// Note: isConfigured() returns true by design - real check at tool invocation

// ── Unconfigured error messages ───────────────────────────────────────────────

describe('Stripe tools — unconfigured', () => {
  beforeEach(() => {
    vi.spyOn(Keychain.prototype, 'get').mockResolvedValue(null);
  });

  it('stripe_customers throws/errors with actionable message when not configured', async () => {
    await expect(tool(plugin, 'stripe_customers')({})).rejects.toThrow(/stripe/i);
  });

  it('stripe_customer throws with actionable message when not configured', async () => {
    await expect(
      tool(plugin, 'stripe_customer')({ customer_id: 'cus_123' }),
    ).rejects.toThrow(/stripe/i);
  });

  it('stripe_balance throws with actionable message when not configured', async () => {
    await expect(tool(plugin, 'stripe_balance')({})).rejects.toThrow(/stripe/i);
  });

  it('stripe_payments throws with actionable message when not configured', async () => {
    await expect(tool(plugin, 'stripe_payments')({})).rejects.toThrow(/stripe/i);
  });
});

// ── Configured — mocked fetch calls ──────────────────────────────────────────

describe('Stripe tools — configured', () => {
  beforeEach(() => {
    vi.spyOn(Keychain.prototype, 'get').mockResolvedValue('sk_test_fake_key_1234567890');
  });

  it('stripe_customers returns customer list from API', async () => {
    const mockCustomers = {
      data: [
        {
          id: 'cus_abc',
          email: 'test@example.com',
          name: 'Test User',
          created: 1700000000,
          currency: 'usd',
          balance: 0,
          subscriptions: { total_count: 1 },
        },
      ],
      has_more: false,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockCustomers),
    }));

    const result = await tool(plugin, 'stripe_customers')({}) as any;
    expect(result.count).toBe(1);
    expect(result.customers[0].id).toBe('cus_abc');
    expect(result.customers[0].email).toBe('test@example.com');
    expect(result.hasMore).toBe(false);
  });

  it('stripe_customers filters by email', async () => {
    const mockCustomers = {
      data: [
        {
          id: 'cus_def',
          email: 'filtered@example.com',
          name: 'Filtered User',
          created: 1700000000,
          currency: 'usd',
          balance: 0,
          subscriptions: { total_count: 0 },
        },
      ],
      has_more: false,
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockCustomers),
    });
    vi.stubGlobal('fetch', fetchMock);

    await tool(plugin, 'stripe_customers')({ email: 'filtered@example.com' });

    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('email=filtered%40example.com');
  });

  it('stripe_customer fetches a customer by ID', async () => {
    const mockCustomer = {
      id: 'cus_xyz',
      email: 'foo@bar.com',
      name: 'Foo Bar',
      phone: null,
      created: 1700000000,
      currency: 'usd',
      balance: 500,
      invoice_settings: { default_payment_method: 'pm_123' },
      metadata: {},
      address: null,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockCustomer),
    }));

    const result = await tool(plugin, 'stripe_customer')({ customer_id: 'cus_xyz' }) as any;
    expect(result.id).toBe('cus_xyz');
    expect(result.email).toBe('foo@bar.com');
    expect(result.balance).toBe(500);
    expect(result.defaultPaymentMethod).toBe('pm_123');
  });

  it('stripe_balance returns available and pending balances', async () => {
    const mockBalance = {
      available: [{ amount: 10000, currency: 'usd' }],
      pending: [{ amount: 2500, currency: 'usd' }],
      livemode: false,
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockBalance),
    }));

    const result = await tool(plugin, 'stripe_balance')({}) as any;
    expect(result.available[0].amount).toBe(10000);
    expect(result.available[0].currency).toBe('usd');
    expect(result.pending[0].amount).toBe(2500);
    expect(result.livemode).toBe(false);
  });

  it('stripe_payments returns list of payment intents', async () => {
    const mockPayments = {
      data: [
        {
          id: 'pi_abc',
          amount: 5000,
          currency: 'usd',
          status: 'succeeded',
          customer: 'cus_abc',
          created: 1700000000,
          description: 'Test payment',
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockPayments),
    }));

    const result = await tool(plugin, 'stripe_payments')({}) as any;
    expect(result.count).toBe(1);
    expect(result.payments[0].id).toBe('pi_abc');
    expect(result.payments[0].amount).toBe(5000);
    expect(result.payments[0].status).toBe('succeeded');
  });

  it('stripe_subscriptions returns subscription list', async () => {
    const mockSubs = {
      data: [
        {
          id: 'sub_abc',
          customer: 'cus_abc',
          status: 'active',
          current_period_end: 1730000000,
          cancel_at_period_end: false,
          items: {
            data: [
              {
                price: {
                  id: 'price_123',
                  product: 'prod_123',
                  unit_amount: 2900,
                  currency: 'usd',
                  recurring: { interval: 'month' },
                },
              },
            ],
          },
        },
      ],
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockSubs),
    }));

    const result = await tool(plugin, 'stripe_subscriptions')({}) as any;
    expect(result.count).toBe(1);
    expect(result.subscriptions[0].id).toBe('sub_abc');
    expect(result.subscriptions[0].status).toBe('active');
    expect(result.subscriptions[0].items[0].priceId).toBe('price_123');
  });

  it('stripe throws when API returns error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ error: { message: 'Invalid API key' } }),
    }));

    await expect(tool(plugin, 'stripe_balance')({})).rejects.toThrow(/Invalid API key/);
  });
});
