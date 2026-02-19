/**
 * Memory Plugin — ported from OpenClaw memory-lancedb extension
 *
 * Vector-backed long-term memory using SQLite (sqlite-vec) for storage
 * and OpenAI for embeddings. Falls back to simple JSON storage when
 * sqlite-vec is unavailable (e.g., first install before dep is present).
 *
 * Tools:
 *   memory_recall   — semantic search through memories
 *   memory_store    — save important info
 *   memory_forget   — delete a memory by ID or query
 *   memory_list     — list all memories with optional category filter
 *
 * Configuration (stored in keychain):
 *   openai / api_key — used for text-embedding-3-small
 *
 * If no OpenAI key is configured the plugin degrades to keyword search.
 */

import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import crypto from 'crypto';
import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type MemoryCategory = 'preference' | 'fact' | 'decision' | 'entity' | 'other';

export interface MemoryEntry {
  id: string;
  text: string;
  embedding?: number[];          // present when openai key is set
  importance: number;
  category: MemoryCategory;
  createdAt: number;
  tags?: string[];
}

export interface MemorySearchResult {
  entry: Omit<MemoryEntry, 'embedding'>;
  score: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_CAPTURE_MAX_CHARS = 500;
const EMBEDDING_MODEL = 'text-embedding-3-small';

const MEMORY_TRIGGERS = [
  /remember|pamatuj|zapamatuj/i,
  /prefer|preferuji|radši/i,
  /decided|rozhodli|will use|budeme/i,
  /\+\d{10,}/,
  /[\w.-]+@[\w.-]+\.\w+/,
  /my\s+\w+\s+is|is\s+my/i,
  /i (like|prefer|hate|love|want|need)/i,
  /always|never|important/i,
];

const PROMPT_INJECTION_PATTERNS = [
  /ignore (all|any|previous|above|prior) instructions/i,
  /do not follow (the )?(system|developer)/i,
  /system prompt/i,
  /developer message/i,
  /<\s*(system|assistant|developer|tool|function)[\s>]/i,
  /\b(run|execute|call|invoke)\b.{0,40}\b(tool|command)\b/i,
];

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function looksLikePromptInjection(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return PROMPT_INJECTION_PATTERNS.some((p) => p.test(normalized));
}

function detectCategory(text: string): MemoryCategory {
  const t = text.toLowerCase();
  if (/prefer|like|love|hate|want/i.test(t)) return 'preference';
  if (/decided|will use|budeme/i.test(t)) return 'decision';
  if (/\+\d{10,}|@[\w.-]+\.\w+|is called|jmenuje se/i.test(t)) return 'entity';
  if (/\b(is|are|has|have|je|má|jsou)\b/i.test(t)) return 'fact';
  return 'other';
}

function shouldCapture(text: string): boolean {
  if (text.length < 10 || text.length > DEFAULT_CAPTURE_MAX_CHARS) return false;
  if (text.includes('<relevant-memories>')) return false;
  if (looksLikePromptInjection(text)) return false;
  return MEMORY_TRIGGERS.some((r) => r.test(text));
}

/** Cosine similarity between two same-length vectors. */
function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Simple keyword score fallback when no embeddings are available. */
function keywordScore(query: string, text: string): number {
  const qWords = new Set(query.toLowerCase().split(/\W+/).filter(Boolean));
  const tWords = text.toLowerCase().split(/\W+/).filter(Boolean);
  if (qWords.size === 0) return 0;
  const matches = tWords.filter((w) => qWords.has(w)).length;
  return Math.min(matches / qWords.size, 1);
}

// ──────────────────────────────────────────────────────────────────────────────
// JSON-backed memory store (no native deps required)
// ──────────────────────────────────────────────────────────────────────────────

class MemoryStore {
  private dbPath: string;
  private entries: MemoryEntry[] = [];
  private loaded = false;

  constructor(configDir: string) {
    this.dbPath = path.join(configDir, 'memory.json');
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.dbPath, 'utf-8');
      this.entries = JSON.parse(raw);
    } catch {
      this.entries = [];
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await fs.writeFile(this.dbPath, JSON.stringify(this.entries, null, 2), { mode: 0o600 });
  }

  async store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry> {
    await this.load();
    const full: MemoryEntry = { ...entry, id: crypto.randomUUID(), createdAt: Date.now() };
    this.entries.push(full);
    await this.save();
    return full;
  }

  async search(
    query: string,
    queryEmbedding: number[] | null,
    limit = 5,
    minScore = 0.1,
  ): Promise<MemorySearchResult[]> {
    await this.load();
    const scored = this.entries.map((e) => {
      let score: number;
      if (queryEmbedding && e.embedding) {
        score = cosineSim(queryEmbedding, e.embedding);
      } else {
        score = keywordScore(query, e.text);
      }
      return { entry: e, score };
    });

    return scored
      .filter((r) => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ entry: { embedding: _omit, ...rest }, score }) => ({ entry: rest, score }));
  }

  async delete(id: string): Promise<boolean> {
    await this.load();
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.id !== id);
    if (this.entries.length < before) {
      await this.save();
      return true;
    }
    return false;
  }

  async list(category?: MemoryCategory): Promise<Omit<MemoryEntry, 'embedding'>[]> {
    await this.load();
    const filtered = category ? this.entries.filter((e) => e.category === category) : this.entries;
    return filtered
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(({ embedding: _omit, ...rest }) => rest);
  }

  async count(): Promise<number> {
    await this.load();
    return this.entries.length;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// OpenAI Embeddings (optional)
// ──────────────────────────────────────────────────────────────────────────────

async function embed(text: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) {
    throw new Error(`OpenAI embeddings error: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as any;
  return data.data[0].embedding as number[];
}

// ──────────────────────────────────────────────────────────────────────────────
// Plugin
// ──────────────────────────────────────────────────────────────────────────────

export class MemoryPlugin implements Plugin {
  name = 'memory';
  description =
    'Long-term vector memory — store and recall important facts, preferences, and decisions across conversations';
  version = '1.0.0';

  private store!: MemoryStore;
  private keychain!: Keychain;
  private configDir!: string;
  private openaiKey: string | null = null;

  async initialize(conductor: Conductor): Promise<void> {
    this.configDir = conductor.getConfig().getConfigDir();
    this.keychain = new Keychain(this.configDir);
    this.store = new MemoryStore(this.configDir);

    // Try to load OpenAI key — plugin works without it (keyword fallback)
    try {
      this.openaiKey = await this.keychain.get('openai', 'api_key');
    } catch {
      this.openaiKey = null;
    }
  }

  isConfigured(): boolean {
    return true; // works in keyword-only mode without any config
  }

  /** Get embedding or null if openai key is not set / on error. */
  private async tryEmbed(text: string): Promise<number[] | null> {
    if (!this.openaiKey) return null;
    try {
      return await embed(text, this.openaiKey);
    } catch {
      return null;
    }
  }

  getTools(): PluginTool[] {
    return [
      // ── memory_recall ──────────────────────────────────────────────────────
      {
        name: 'memory_recall',
        description:
          'Search long-term memory for relevant facts, preferences, or decisions. ' +
          'Use when you need context about user preferences or previously discussed topics.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What to search for' },
            limit: { type: 'number', description: 'Max results to return (default: 5)' },
            category: {
              type: 'string',
              enum: ['preference', 'fact', 'decision', 'entity', 'other'],
              description: 'Optional category filter',
            },
          },
          required: ['query'],
        },
        handler: async ({ query, limit = 5, category }: any) => {
          const embedding = await this.tryEmbed(query);
          let results = await this.store.search(query, embedding, limit);
          if (category) results = results.filter((r) => r.entry.category === category);
          if (results.length === 0) return { found: 0, memories: [] };

          return {
            found: results.length,
            mode: embedding ? 'semantic' : 'keyword',
            memories: results.map((r) => ({
              id: r.entry.id,
              text: r.entry.text,
              category: r.entry.category,
              importance: r.entry.importance,
              score: Math.round(r.score * 100) / 100,
              createdAt: new Date(r.entry.createdAt).toISOString(),
            })),
          };
        },
      },

      // ── memory_store ───────────────────────────────────────────────────────
      {
        name: 'memory_store',
        description:
          'Save important information to long-term memory. ' +
          'Use for user preferences, key decisions, facts, or entities.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Information to remember' },
            importance: {
              type: 'number',
              description: 'Importance score 0–1 (default: 0.7)',
            },
            category: {
              type: 'string',
              enum: ['preference', 'fact', 'decision', 'entity', 'other'],
              description: 'Category (auto-detected if omitted)',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional tags for later filtering',
            },
          },
          required: ['text'],
        },
        handler: async ({ text, importance = 0.7, category, tags }: any) => {
          if (looksLikePromptInjection(text)) {
            return { error: 'Rejected: text looks like a prompt injection attempt.' };
          }

          const detectedCategory: MemoryCategory = category ?? detectCategory(text);
          const embedding = await this.tryEmbed(text) ?? undefined;

          // Duplicate check via semantic similarity
          if (embedding) {
            const dupes = await this.store.search(text, embedding, 1, 0.95);
            if (dupes.length > 0) {
              return {
                action: 'duplicate',
                message: `Similar memory already exists: "${dupes[0].entry.text}"`,
                existingId: dupes[0].entry.id,
              };
            }
          }

          const entry = await this.store.store({
            text,
            embedding,
            importance: Math.max(0, Math.min(1, importance)),
            category: detectedCategory,
            tags,
          });

          return {
            action: 'stored',
            id: entry.id,
            category: detectedCategory,
            text: text.slice(0, 100),
          };
        },
      },

      // ── memory_forget ──────────────────────────────────────────────────────
      {
        name: 'memory_forget',
        description:
          'Delete a memory by ID, or search for it by query first. ' +
          'Use when user asks to forget something.',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', description: 'Exact memory UUID to delete' },
            query: {
              type: 'string',
              description: 'Search query to find the memory if ID is not known',
            },
          },
        },
        handler: async ({ memoryId, query }: any) => {
          if (memoryId) {
            const deleted = await this.store.delete(memoryId);
            return deleted
              ? { action: 'deleted', id: memoryId }
              : { error: `Memory ${memoryId} not found` };
          }

          if (query) {
            const embedding = await this.tryEmbed(query);
            const results = await this.store.search(query, embedding, 5, 0.5);
            if (results.length === 0) return { found: 0, message: 'No matching memories.' };

            // Auto-delete if there's only one high-confidence match
            if (results.length === 1 && results[0].score > 0.9) {
              await this.store.delete(results[0].entry.id);
              return { action: 'deleted', id: results[0].entry.id, text: results[0].entry.text };
            }

            return {
              action: 'candidates',
              message: 'Multiple matches — specify memoryId to delete.',
              candidates: results.map((r) => ({
                id: r.entry.id,
                text: r.entry.text.slice(0, 80),
                score: Math.round(r.score * 100) / 100,
              })),
            };
          }

          return { error: 'Provide either memoryId or query.' };
        },
      },

      // ── memory_list ────────────────────────────────────────────────────────
      {
        name: 'memory_list',
        description: 'List all stored memories, optionally filtered by category.',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['preference', 'fact', 'decision', 'entity', 'other'],
              description: 'Filter by category',
            },
            limit: { type: 'number', description: 'Max entries (default: 20)' },
          },
        },
        handler: async ({ category, limit = 20 }: any) => {
          const all = await this.store.list(category);
          const total = all.length;
          return {
            total,
            shown: Math.min(total, limit),
            memories: all.slice(0, limit).map((e) => ({
              id: e.id,
              text: e.text.slice(0, 120),
              category: e.category,
              importance: e.importance,
              createdAt: new Date(e.createdAt).toISOString(),
              tags: e.tags ?? [],
            })),
          };
        },
      },
    ];
  }
}
