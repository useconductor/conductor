/**
 * Conductor Core Interfaces
 *
 * Narrow interfaces that break the God-object dependency.
 * Consumers should depend on these interfaces, not on concrete classes.
 */

import { AIMessage } from '../ai/base.js';

// ── IConfig ───────────────────────────────────────────────────────────────────

export interface IConfig {
  /** Read a value by dot-notation key, e.g. "ai.provider" */
  get<T>(key: string): T | undefined;
  /** Persist a value by dot-notation key */
  set(key: string, value: unknown): Promise<void>;
  /** Absolute path to the config directory (~/.conductor by default) */
  getConfigDir(): string;
  /** The full config object as a plain record */
  getConfig(): Record<string, unknown>;
}

// ── IDatabase ─────────────────────────────────────────────────────────────────

export interface IDatabase {
  /** Persist a full AIMessage for a user */
  addMessage(userId: string, message: AIMessage): Promise<void>;
  /** Retrieve conversation history for a user */
  getHistory(userId: string, limit?: number): Promise<AIMessage[]>;
  /** Full-text search across a user's messages */
  searchMessages(userId: string, query: string, limit?: number): Promise<AIMessage[]>;
  /** Record an activity log entry */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  logActivity(userId: string, action: string, plugin?: string, details?: string, success?: boolean): Promise<void>;
  /** Recent activity entries for the dashboard / proactive context */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRecentActivity(limit?: number): Promise<any[]>;
}

// ── IPluginRegistry ───────────────────────────────────────────────────────────

import { Plugin } from '../plugins/manager.js';

export interface IPluginRegistry {
  getPlugin(name: string): Promise<Plugin | undefined>;
  listPlugins(): Array<{ name: string; enabled: boolean; description: string; version: string }>;
  getEnabledTools(): Promise<import('../plugins/manager.js').PluginTool[]>;
  isPluginEnabled(name: string): boolean;
  enablePlugin(name: string): Promise<void>;
  disablePlugin(name: string): Promise<void>;
}

// ── ToolContext ───────────────────────────────────────────────────────────────

export interface ToolContext {
  /** User ID of the person running the conversation (Telegram ID, 'system', etc.) */
  userId: string;
  /** Channel the conversation is happening in: 'telegram', 'slack', 'cli', 'mcp' */
  channel: string;
  /** Config interface for tool handlers that need to read settings */
  conductorConfig: IConfig;
}

// ── ConductorNotification ─────────────────────────────────────────────────────

/**
 * Structured notification type for proactive cycle alerts.
 * Replaces hard-coded Telegram Markdown strings so each runtime can format
 * appropriately (Telegram Markdown, Slack Block Kit, plain text, etc.).
 */
export interface ConductorNotification {
  title: string;
  body: string;
  codeBlock?: string;
}
