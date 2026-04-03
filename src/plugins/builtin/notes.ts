/**
 * Notes Plugin — TheAlxLabs / Conductor
 *
 * Local markdown notes that the AI can read, write, and search.
 * Zero API dependencies — works completely offline.
 *
 * Features:
 * - Full-text search across all notes
 * - Tag system with auto-detection
 * - Daily journal with automatic dating
 * - Note templates (meeting, todo, idea, project)
 * - Pinning, archiving
 * - Link detection between notes (wiki-style [[note-name]])
 * - Automatic backlinks
 *
 * Stored at: ~/.conductor/notes/  (plain .md files)
 *
 * No setup required — just use it.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';

interface NoteMetadata {
  id: string;
  title: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  wordCount: number;
  backlinks: string[]; // IDs of notes that link to this one
}

interface Note extends NoteMetadata {
  content: string;
}

const TEMPLATES: Record<string, string> = {
  meeting: `# Meeting: {title}

**Date:** {date}
**Attendees:**

## Agenda
- 

## Notes


## Action Items
- [ ] 

## Decisions Made

`,
  todo: `# {title}

## To Do
- [ ] 
- [ ] 
- [ ] 

## In Progress


## Done

`,
  idea: `# Idea: {title}

**Date:** {date}

## The Concept


## Why It Matters


## How It Could Work


## Next Steps
- [ ] 

`,
  project: `# Project: {title}

**Started:** {date}
**Status:** Planning

## Goal


## Technical Approach


## Tasks
- [ ] 

## Notes


## Links & Resources

`,
  daily: `# {date}

## What I'm Working On


## Notes


## Ideas


## End of Day Reflection

`,
};

export class NotesPlugin implements Plugin {
  name = 'notes';
  description = 'Local markdown notes — create, search, tag, link, and manage notes entirely offline';
  version = '1.0.0';

  private notesDir!: string;
  private indexPath!: string;
  private index: Map<string, NoteMetadata> = new Map();
  private indexLoaded = false;

  async initialize(conductor: Conductor): Promise<void> {
    const configDir = conductor.getConfig().getConfigDir();
    this.notesDir = path.join(configDir, 'notes');
    this.indexPath = path.join(this.notesDir, '.index.json');
    await fs.mkdir(this.notesDir, { recursive: true });
    await this.loadIndex();
  }

  isConfigured(): boolean {
    return true;
  }

  // ── Index management ────────────────────────────────────────────────────────

  private async loadIndex(): Promise<void> {
    if (this.indexLoaded) return;
    try {
      const raw = await fs.readFile(this.indexPath, 'utf-8');
      const arr: NoteMetadata[] = JSON.parse(raw);
      this.index = new Map(arr.map((n) => [n.id, n]));
    } catch {
      this.index = new Map();
    }
    this.indexLoaded = true;
  }

  private async saveIndex(): Promise<void> {
    const arr = Array.from(this.index.values());
    const tmp = this.indexPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(arr, null, 2));
    await fs.rename(tmp, this.indexPath);
  }

  private noteFilePath(id: string): string {
    return path.join(this.notesDir, `${id}.md`);
  }

  private async readNote(id: string): Promise<Note | null> {
    const meta = this.index.get(id);
    if (!meta) return null;
    try {
      const content = await fs.readFile(this.noteFilePath(id), 'utf-8');
      return { ...meta, content };
    } catch {
      return null;
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private extractTags(content: string): string[] {
    const matches = content.match(/#([a-zA-Z][a-zA-Z0-9_-]*)/g) ?? [];
    return [...new Set(matches.map((t) => t.slice(1).toLowerCase()))];
  }

  private extractLinks(content: string): string[] {
    // [[note-title]] style links
    const matches = content.match(/\[\[([^\]]+)\]\]/g) ?? [];
    return matches.map((m) => m.slice(2, -2));
  }

  private extractTitle(content: string, fallback: string): string {
    const h1 = content.match(/^#\s+(.+)/m);
    return h1?.[1]?.trim() ?? fallback;
  }

  private wordCount(content: string): number {
    return content.split(/\s+/).filter(Boolean).length;
  }

  private generateId(title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);
    const unique = crypto.randomBytes(3).toString('hex');
    return `${slug}-${unique}`;
  }

  private applyTemplate(template: string, title: string): string {
    const date = new Date().toISOString().split('T')[0];
    return template.replace(/\{title\}/g, title).replace(/\{date\}/g, date);
  }

  private scoreSearch(query: string, content: string, title: string, tags: string[]): number {
    const q = query.toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    let score = 0;
    for (const word of words) {
      if (title.toLowerCase().includes(word)) score += 10;
      if (tags.some((t) => t.includes(word))) score += 5;
      const contentMatches = (content.toLowerCase().match(new RegExp(word, 'g')) ?? []).length;
      score += contentMatches;
    }
    return score;
  }

  /** Update backlinks across all notes when a note's links change. */
  private async rebuildBacklinks(noteId: string, linkedTitles: string[]): Promise<void> {
    // Find note IDs matching the linked titles
    const linkedIds = new Set<string>();
    for (const title of linkedTitles) {
      for (const [id, meta] of this.index.entries()) {
        if (meta.title.toLowerCase() === title.toLowerCase()) {
          linkedIds.add(id);
        }
      }
    }
    // Add this noteId as backlink to all linked notes
    for (const [id, meta] of this.index.entries()) {
      const shouldHaveBacklink = linkedIds.has(id);
      const hasBacklink = meta.backlinks.includes(noteId);
      if (shouldHaveBacklink && !hasBacklink) {
        meta.backlinks = [...meta.backlinks, noteId];
      } else if (!shouldHaveBacklink && hasBacklink) {
        meta.backlinks = meta.backlinks.filter((b) => b !== noteId);
      }
    }
  }

  // ── Tools ───────────────────────────────────────────────────────────────────

  getTools(): PluginTool[] {
    return [
      // ── notes_create ────────────────────────────────────────────────────────
      {
        name: 'notes_create',
        description: 'Create a new note. Supports templates: meeting, todo, idea, project, daily.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Note title' },
            content: { type: 'string', description: 'Note content in markdown' },
            template: {
              type: 'string',
              enum: ['meeting', 'todo', 'idea', 'project', 'daily'],
              description: 'Use a template instead of blank content',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tags to apply (also auto-detected from #hashtags in content)',
            },
            pin: { type: 'boolean', description: 'Pin this note (default: false)' },
          },
          required: ['title'],
        },
        handler: async ({ title, content, template, tags = [], pin = false }: any) => {
          await this.loadIndex();

          let noteContent = content ?? '';
          if (template && !content) {
            const tmpl = TEMPLATES[template];
            if (tmpl) noteContent = this.applyTemplate(tmpl, title);
          } else if (!content) {
            noteContent = `# ${title}\n\n`;
          }

          const id = this.generateId(title);
          const now = new Date().toISOString();
          const extractedTags = [...new Set([...tags, ...this.extractTags(noteContent)])];
          const links = this.extractLinks(noteContent);

          const meta: NoteMetadata = {
            id,
            title: this.extractTitle(noteContent, title),
            tags: extractedTags,
            pinned: pin,
            archived: false,
            createdAt: now,
            updatedAt: now,
            wordCount: this.wordCount(noteContent),
            backlinks: [],
          };

          await fs.writeFile(this.noteFilePath(id), noteContent, { encoding: 'utf-8' });
          this.index.set(id, meta);
          await this.rebuildBacklinks(id, links);
          await this.saveIndex();

          return {
            created: true,
            id,
            title: meta.title,
            tags: meta.tags,
            wordCount: meta.wordCount,
            path: this.noteFilePath(id),
          };
        },
      },

      // ── notes_read ──────────────────────────────────────────────────────────
      {
        name: 'notes_read',
        description: 'Read a note by ID or title',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Note ID' },
            title: { type: 'string', description: 'Note title (fuzzy match if ID not known)' },
          },
        },
        handler: async ({ id, title }: any) => {
          await this.loadIndex();

          let noteId = id;
          if (!noteId && title) {
            // Find best match by title
            let bestScore = 0;
            for (const [nid, meta] of this.index.entries()) {
              if (meta.archived) continue;
              const score = this.scoreSearch(title, '', meta.title, meta.tags);
              if (score > bestScore) {
                bestScore = score;
                noteId = nid;
              }
            }
          }

          if (!noteId) return { error: 'Note not found. Try notes_search.' };
          const note = await this.readNote(noteId);
          if (!note) return { error: `Note ${noteId} not found.` };

          // Resolve backlink titles
          const backlinkTitles = note.backlinks.map((bid) => this.index.get(bid)?.title ?? bid).filter(Boolean);

          return {
            ...note,
            backlinkTitles,
          };
        },
      },

      // ── notes_update ────────────────────────────────────────────────────────
      {
        name: 'notes_update',
        description: 'Update the content or metadata of an existing note',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Note ID' },
            content: { type: 'string', description: 'New content (replaces existing)' },
            append: {
              type: 'string',
              description: 'Text to append to the end of the note (use instead of content to add)',
            },
            title: { type: 'string', description: 'New title' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Replace tags' },
            addTags: { type: 'array', items: { type: 'string' }, description: 'Add tags' },
            pin: { type: 'boolean', description: 'Set pin state' },
            archive: { type: 'boolean', description: 'Archive this note' },
          },
          required: ['id'],
        },
        handler: async ({ id, content, append, title, tags, addTags, pin, archive }: any) => {
          await this.loadIndex();
          const note = await this.readNote(id);
          if (!note) return { error: `Note ${id} not found.` };

          let newContent = note.content;
          if (append !== undefined) newContent = newContent.trimEnd() + '\n\n' + append;
          if (content !== undefined) newContent = content;

          const meta = this.index.get(id)!;
          if (title !== undefined) meta.title = title;
          if (tags !== undefined) meta.tags = tags;
          if (addTags !== undefined) meta.tags = [...new Set([...meta.tags, ...addTags])];
          if (pin !== undefined) meta.pinned = pin;
          if (archive !== undefined) meta.archived = archive;

          // Re-detect tags from content
          const contentTags = this.extractTags(newContent);
          meta.tags = [...new Set([...meta.tags, ...contentTags])];
          meta.updatedAt = new Date().toISOString();
          meta.wordCount = this.wordCount(newContent);
          if (!title && !note.title) meta.title = this.extractTitle(newContent, meta.title);

          const links = this.extractLinks(newContent);
          await fs.writeFile(this.noteFilePath(id), newContent);
          this.index.set(id, meta);
          await this.rebuildBacklinks(id, links);
          await this.saveIndex();

          return { updated: true, id, title: meta.title, tags: meta.tags, wordCount: meta.wordCount };
        },
      },

      // ── notes_search ────────────────────────────────────────────────────────
      {
        name: 'notes_search',
        description: 'Full-text search across all notes, with optional tag and date filters',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search text' },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter to notes with these tags',
            },
            includeArchived: { type: 'boolean', description: 'Include archived notes (default: false)' },
            limit: { type: 'number', description: 'Max results (default: 10)' },
          },
        },
        handler: async ({ query = '', tags = [], includeArchived = false, limit = 10 }: any) => {
          await this.loadIndex();

          const results: Array<{ score: number; meta: NoteMetadata; preview: string }> = [];

          for (const [id, meta] of this.index.entries()) {
            if (!includeArchived && meta.archived) continue;
            if (tags.length && !tags.every((t: string) => meta.tags.includes(t.toLowerCase()))) continue;

            let score = 0;
            let preview = '';

            if (query) {
              let content = '';
              try {
                content = await fs.readFile(this.noteFilePath(id), 'utf-8');
              } catch {
                continue;
              }
              score = this.scoreSearch(query, content, meta.title, meta.tags);
              if (score === 0) continue;

              // Build a short preview around first match
              const idx = content.toLowerCase().indexOf(query.toLowerCase().split(' ')[0]);
              if (idx >= 0) {
                const start = Math.max(0, idx - 60);
                const end = Math.min(content.length, idx + 120);
                preview =
                  (start > 0 ? '...' : '') + content.slice(start, end).trim() + (end < content.length ? '...' : '');
              }
            } else {
              score = meta.pinned ? 100 : 1;
            }

            results.push({ score, meta, preview });
          }

          results.sort((a, b) => {
            if (a.meta.pinned !== b.meta.pinned) return a.meta.pinned ? -1 : 1;
            return b.score - a.score;
          });

          return {
            count: results.length,
            results: results.slice(0, limit).map(({ meta, preview }) => ({
              id: meta.id,
              title: meta.title,
              tags: meta.tags,
              pinned: meta.pinned,
              updatedAt: meta.updatedAt,
              wordCount: meta.wordCount,
              preview,
            })),
          };
        },
      },

      // ── notes_list ──────────────────────────────────────────────────────────
      {
        name: 'notes_list',
        description: 'List all notes, optionally filtered by tag or pinned status',
        inputSchema: {
          type: 'object',
          properties: {
            tag: { type: 'string', description: 'Filter by tag' },
            pinnedOnly: { type: 'boolean', description: 'Only show pinned notes' },
            includeArchived: { type: 'boolean', description: 'Include archived notes' },
            sortBy: {
              type: 'string',
              enum: ['updated', 'created', 'title', 'wordCount'],
              description: 'Sort field (default: updated)',
            },
          },
        },
        handler: async ({ tag, pinnedOnly = false, includeArchived = false, sortBy = 'updated' }: any) => {
          await this.loadIndex();

          let notes = Array.from(this.index.values());
          if (!includeArchived) notes = notes.filter((n) => !n.archived);
          if (pinnedOnly) notes = notes.filter((n) => n.pinned);
          if (tag) notes = notes.filter((n) => n.tags.includes(tag.toLowerCase()));

          notes.sort((a, b) => {
            if (sortBy === 'title') return a.title.localeCompare(b.title);
            if (sortBy === 'wordCount') return b.wordCount - a.wordCount;
            if (sortBy === 'created') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          });

          // Pinned always first
          const pinned = notes.filter((n) => n.pinned);
          const rest = notes.filter((n) => !n.pinned);

          const allTags = new Set<string>();
          notes.forEach((n) => n.tags.forEach((t) => allTags.add(t)));

          return {
            total: notes.length,
            allTags: Array.from(allTags).sort(),
            notes: [...pinned, ...rest].map((n) => ({
              id: n.id,
              title: n.title,
              tags: n.tags,
              pinned: n.pinned,
              archived: n.archived,
              wordCount: n.wordCount,
              updatedAt: n.updatedAt,
              createdAt: n.createdAt,
            })),
          };
        },
      },

      // ── notes_delete ────────────────────────────────────────────────────────
      {
        name: 'notes_delete',
        description: 'Delete a note permanently',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Note ID to delete' },
          },
          required: ['id'],
        },
        handler: async ({ id }: any) => {
          await this.loadIndex();
          if (!this.index.has(id)) return { error: `Note ${id} not found.` };

          // Remove backlinks to this note
          for (const meta of this.index.values()) {
            meta.backlinks = meta.backlinks.filter((b) => b !== id);
          }
          this.index.delete(id);

          try {
            await fs.unlink(this.noteFilePath(id));
          } catch {}
          await this.saveIndex();
          return { deleted: true, id };
        },
      },

      // ── notes_daily ─────────────────────────────────────────────────────────
      {
        name: 'notes_daily',
        description: "Get or create today's daily note",
        inputSchema: {
          type: 'object',
          properties: {
            append: { type: 'string', description: "Text to append to today's note" },
          },
        },
        handler: async ({ append }: any) => {
          await this.loadIndex();
          const today = new Date().toISOString().split('T')[0];
          const dailyTitle = today;

          // Find existing daily note for today
          let existingId: string | null = null;
          for (const [id, meta] of this.index.entries()) {
            if (meta.title === dailyTitle && meta.tags.includes('daily')) {
              existingId = id;
              break;
            }
          }

          if (existingId && append) {
            // Delegate to update
            const note = await this.readNote(existingId);
            if (note) {
              const newContent = note.content.trimEnd() + '\n\n' + append;
              const meta = this.index.get(existingId)!;
              meta.updatedAt = new Date().toISOString();
              meta.wordCount = this.wordCount(newContent);
              await fs.writeFile(this.noteFilePath(existingId), newContent);
              this.index.set(existingId, meta);
              await this.saveIndex();
              return { id: existingId, title: dailyTitle, updated: true, content: newContent };
            }
          }

          if (existingId) {
            return (await this.readNote(existingId)) ?? { error: 'Could not read daily note.' };
          }

          // Create new daily note
          const content = this.applyTemplate(TEMPLATES.daily, today);
          const id = this.generateId(`daily-${today}`);
          const now = new Date().toISOString();
          const meta: NoteMetadata = {
            id,
            title: dailyTitle,
            tags: ['daily'],
            pinned: false,
            archived: false,
            createdAt: now,
            updatedAt: now,
            wordCount: this.wordCount(content),
            backlinks: [],
          };
          await fs.writeFile(this.noteFilePath(id), content);
          this.index.set(id, meta);
          await this.saveIndex();
          return { id, title: dailyTitle, created: true, content };
        },
      },

      // ── notes_stats ─────────────────────────────────────────────────────────
      {
        name: 'notes_stats',
        description: 'Get statistics about your notes collection',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          await this.loadIndex();
          const all = Array.from(this.index.values());
          const active = all.filter((n) => !n.archived);
          const totalWords = active.reduce((s, n) => s + n.wordCount, 0);
          const tagCounts: Record<string, number> = {};
          active.forEach((n) =>
            n.tags.forEach((t) => {
              tagCounts[t] = (tagCounts[t] ?? 0) + 1;
            }),
          );
          const topTags = Object.entries(tagCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([tag, count]) => ({ tag, count }));

          const recentlyUpdated = [...active]
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
            .slice(0, 5)
            .map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt }));

          return {
            totalNotes: active.length,
            archivedNotes: all.length - active.length,
            pinnedNotes: active.filter((n) => n.pinned).length,
            totalWords,
            avgWordsPerNote: active.length ? Math.round(totalWords / active.length) : 0,
            uniqueTags: Object.keys(tagCounts).length,
            topTags,
            recentlyUpdated,
          };
        },
      },
    ];
  }
}
