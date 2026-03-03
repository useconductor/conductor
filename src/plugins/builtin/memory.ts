/**
 * Memory Plugin
 *
 * Lightning-fast, leak-proof long-term memory using native SQLite.
 * Uses simple text search (LIKE) to completely avoid RAM bloating and context leaks.
 */

import crypto from 'crypto';
import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

export type MemoryCategory = 'preference' | 'fact' | 'decision' | 'entity' | 'other';

const DEFAULT_CAPTURE_MAX_CHARS = 500;

function detectCategory(text: string): MemoryCategory {
  const t = text.toLowerCase();
  if (/prefer|like|love|hate|want/i.test(t)) return 'preference';
  if (/decided|will use|budeme/i.test(t)) return 'decision';
  if (/\+\d{10,}|@[\w.-]+\.\w+|is called|jmenuje se/i.test(t)) return 'entity';
  if (/\b(is|are|has|have|je|má|jsou)\b/i.test(t)) return 'fact';
  return 'other';
}

function looksLikePromptInjection(text: string): boolean {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const patterns = [
    /ignore (all|any|previous|above|prior) instructions/i,
    /do not follow (the )?(system|developer)/i,
    /system prompt/i,
  ];
  return patterns.some((p) => p.test(normalized));
}

export class MemoryPlugin implements Plugin {
  name = 'memory';
  description = 'Long-term memory — store and recall important facts across conversations';
  version = '2.0.0';

  private conductor!: Conductor;

  async initialize(conductor: Conductor): Promise<void> {
    this.conductor = conductor;
  }

  isConfigured(): boolean {
    return true;
  }

  getTools(): PluginTool[] {
    return [
      {
        name: 'memory_recall',
        description: 'Search long-term memory for relevant facts, preferences, or decisions.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What to search for' },
            limit: { type: 'number', description: 'Max results (default: 5)' },
            category: { type: 'string', description: 'Optional category filter' },
          },
          required: ['query'],
        },
        handler: async ({ query, limit = 5, category }: any) => {
          const db = this.conductor.getDatabase();
          const results = await db.searchCoreMemory('global', query, limit, category);

          if (results.length === 0) return { found: 0, memories: [] };

          return {
            found: results.length,
            memories: results.map((r) => ({
              id: r.id,
              text: r.text,
              category: r.category,
              importance: r.importance,
              createdAt: r.timestamp,
            })),
          };
        },
      },
      {
        name: 'memory_store',
        description: 'Save important information to long-term memory.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Information to remember' },
            importance: { type: 'number', description: 'Importance score 0–1 (default: 0.7)' },
            category: { type: 'string', description: 'Category (auto-detected if omitted)' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['text'],
        },
        handler: async ({ text, importance = 0.7, category, tags }: any) => {
          if (looksLikePromptInjection(text)) {
            return { error: 'Rejected: text looks like a prompt injection attempt.' };
          }

          const detectedCategory: MemoryCategory = category ?? detectCategory(text);
          const db = this.conductor.getDatabase();

          const entry = {
            id: crypto.randomUUID(),
            userId: 'global',
            text,
            category: detectedCategory,
            importance: Math.max(0, Math.min(1, importance)),
            tags
          };

          await db.addCoreMemory(entry);

          return {
            action: 'stored',
            id: entry.id,
            category: detectedCategory,
            text: text.slice(0, 100),
          };
        },
      },
      {
        name: 'memory_forget',
        description: 'Delete a memory by ID.',
        inputSchema: {
          type: 'object',
          properties: {
            memoryId: { type: 'string', description: 'Exact memory UUID to delete' },
          },
          required: ['memoryId']
        },
        handler: async ({ memoryId }: any) => {
          const db = this.conductor.getDatabase();
          await db.deleteCoreMemory(memoryId);
          return { action: 'deleted', id: memoryId };
        },
      },
      {
        name: 'memory_list',
        description: 'List all stored memories.',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Filter by category' },
            limit: { type: 'number', description: 'Max entries (default: 20)' },
          },
        },
        handler: async ({ category, limit = 20 }: any) => {
          const db = this.conductor.getDatabase();
          const all = await db.listCoreMemory('global', category, limit);

          return {
            total: all.length,
            memories: all.map((e) => ({
              id: e.id,
              text: e.text.slice(0, 120),
              category: e.category,
              importance: e.importance,
              createdAt: e.timestamp,
            })),
          };
        },
      },
      {
        name: 'search_past_conversations',
        description: 'Search raw past chat logs and conversations without bloating the context window.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'What text to search for' },
            limit: { type: 'number', description: 'Max messages to return (default: 10)' },
          },
          required: ['query'],
        },
        handler: async ({ query, limit = 10 }: any) => {
          const db = this.conductor.getDatabase();
          // We search the exact user 'global' or fallback if it's tied to real user ids.
          // In AIManager, messages are saved per userId (e.g. telegram user id). 
          // Since tools don't receive userId yet, we can do a global LIKE search across all users.
          const results = await db.searchMessages('%', query, limit);

          if (results.length === 0) return { found: 0, messages: [] };

          return {
            found: results.length,
            messages: results.map((r) => ({
              role: r.role,
              content: r.content ? r.content.slice(0, 200) : '',
              timestamp: r.timestamp,
            })),
          };
        },
      },
    ];
  }
}
