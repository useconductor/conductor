/**
 * Google Drive Plugin
 *
 * List, search, read, upload, and manage Google Drive files.
 * Requires Google OAuth — google / access_token in keychain.
 *
 * Scopes needed:
 *   https://www.googleapis.com/auth/drive.readonly       (for read-only)
 *   https://www.googleapis.com/auth/drive                (for full access)
 *   https://www.googleapis.com/auth/drive.file           (for files created by the app)
 */

import { Plugin, PluginTool } from '../manager.js';
import { Conductor } from '../../core/conductor.js';
import { Keychain } from '../../security/keychain.js';

const DRIVE_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export class GoogleDrivePlugin implements Plugin {
  name = 'gdrive';
  description = 'List, search, read, and upload files in Google Drive — requires Google OAuth';
  version = '1.0.0';

  private keychain!: Keychain;

  async initialize(conductor: Conductor): Promise<void> {
    this.keychain = new Keychain(conductor.getConfig().getConfigDir());
  }

  isConfigured(): boolean { return true; }

  private async getToken(): Promise<string> {
    const token = await this.keychain.get('google', 'access_token');
    if (!token) throw new Error('Google not authenticated. Run: conductor auth google');
    return token;
  }

  private async driveFetch(path: string, options: {
    method?: string;
    body?: any;
    base?: string;
    rawBody?: Buffer | string;
    contentType?: string;
  } = {}): Promise<any> {
    const token = await this.getToken();
    const base = options.base ?? DRIVE_BASE;
    const isRaw = options.rawBody !== undefined;

    const res = await fetch(`${base}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(isRaw
          ? { 'Content-Type': options.contentType ?? 'text/plain' }
          : { 'Content-Type': 'application/json' }),
      },
      body: isRaw ? options.rawBody : options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      if (res.status === 401) throw new Error('Google token expired. Re-authenticate: conductor auth google');
      throw new Error(`Google Drive API ${res.status}: ${err}`);
    }
    if (res.status === 204) return {};
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) return res.json();
    return res.text();
  }

  private formatFile(f: any) {
    return {
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      size: f.size ? Number(f.size) : null,
      modifiedTime: f.modifiedTime ?? '',
      createdTime: f.createdTime ?? '',
      webViewLink: f.webViewLink ?? '',
      parents: f.parents ?? [],
      shared: f.shared ?? false,
      trashed: f.trashed ?? false,
    };
  }

  getTools(): PluginTool[] {
    return [
      // ── gdrive_list ─────────────────────────────────────────────────────────
      {
        name: 'gdrive_list',
        description: 'List files and folders in Google Drive',
        inputSchema: {
          type: 'object',
          properties: {
            folderId: {
              type: 'string',
              description: 'Folder ID to list contents of (default: root)',
            },
            maxResults: { type: 'number', description: 'Max files to return (default: 20)' },
            orderBy: {
              type: 'string',
              description: 'Sort order e.g. "modifiedTime desc", "name"',
            },
          },
        },
        handler: async ({ folderId = 'root', maxResults = 20, orderBy = 'modifiedTime desc' }: any) => {
          const q = `'${folderId}' in parents and trashed = false`;
          const fields = 'files(id,name,mimeType,size,modifiedTime,webViewLink,shared)';
          const params = new URLSearchParams({
            q,
            fields,
            pageSize: String(Math.min(maxResults, 100)),
            orderBy,
          });
          const res = await this.driveFetch(`/files?${params}`);
          return {
            count: res.files?.length ?? 0,
            files: (res.files ?? []).map(this.formatFile.bind(this)),
          };
        },
      },

      // ── gdrive_search ───────────────────────────────────────────────────────
      {
        name: 'gdrive_search',
        description:
          'Search Google Drive files by name or content. Supports Drive query syntax e.g. name contains "budget" mimeType="application/vnd.google-apps.spreadsheet"',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (file name or Drive query)' },
            maxResults: { type: 'number', description: 'Max results (default: 10)' },
          },
          required: ['query'],
        },
        handler: async ({ query, maxResults = 10 }: any) => {
          // If query looks like a plain name search (no Drive operators), wrap it
          const q = query.includes('=') || query.includes(' and ') || query.includes(' or ')
            ? `(${query}) and trashed = false`
            : `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`;

          const fields = 'files(id,name,mimeType,size,modifiedTime,webViewLink,parents)';
          const params = new URLSearchParams({
            q,
            fields,
            pageSize: String(Math.min(maxResults, 50)),
          });
          const res = await this.driveFetch(`/files?${params}`);
          return {
            count: res.files?.length ?? 0,
            files: (res.files ?? []).map(this.formatFile.bind(this)),
          };
        },
      },

      // ── gdrive_get ──────────────────────────────────────────────────────────
      {
        name: 'gdrive_get',
        description: 'Get metadata about a specific Drive file',
        inputSchema: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'Google Drive file ID' },
          },
          required: ['fileId'],
        },
        handler: async ({ fileId }: any) => {
          const fields = 'id,name,mimeType,size,modifiedTime,createdTime,webViewLink,parents,shared,trashed,owners';
          const f = await this.driveFetch(`/files/${encodeURIComponent(fileId)}?fields=${fields}`);
          return {
            ...this.formatFile(f),
            owners: (f.owners ?? []).map((o: any) => ({ email: o.emailAddress, name: o.displayName })),
          };
        },
      },

      // ── gdrive_read ─────────────────────────────────────────────────────────
      {
        name: 'gdrive_read',
        description:
          'Read the text content of a Drive file. ' +
          'Google Docs/Sheets/Slides are exported as plain text. ' +
          'Binary files return an error.',
        inputSchema: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'Google Drive file ID' },
            maxChars: { type: 'number', description: 'Max characters to return (default: 10000)' },
          },
          required: ['fileId'],
        },
        handler: async ({ fileId, maxChars = 10000 }: any) => {
          // Get metadata first to determine how to export
          const meta = await this.driveFetch(
            `/files/${encodeURIComponent(fileId)}?fields=name,mimeType,size`
          );

          let content: string;
          const mimeType: string = meta.mimeType ?? '';

          const GOOGLE_EXPORTS: Record<string, string> = {
            'application/vnd.google-apps.document': 'text/plain',
            'application/vnd.google-apps.spreadsheet': 'text/csv',
            'application/vnd.google-apps.presentation': 'text/plain',
          };

          if (GOOGLE_EXPORTS[mimeType]) {
            content = await this.driveFetch(
              `/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(GOOGLE_EXPORTS[mimeType])}`
            );
          } else if (mimeType.startsWith('text/') || mimeType === 'application/json') {
            content = await this.driveFetch(`/files/${encodeURIComponent(fileId)}?alt=media`);
          } else {
            return {
              error: `Cannot read binary file (${mimeType}). Use gdrive_get for metadata.`,
              name: meta.name,
              mimeType,
            };
          }

          const text = String(content);
          return {
            name: meta.name,
            mimeType,
            length: text.length,
            truncated: text.length > maxChars,
            content: text.slice(0, maxChars),
          };
        },
      },

      // ── gdrive_create_folder ────────────────────────────────────────────────
      {
        name: 'gdrive_create_folder',
        description: 'Create a new folder in Google Drive',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Folder name' },
            parentId: { type: 'string', description: 'Parent folder ID (default: root)' },
          },
          required: ['name'],
        },
        handler: async ({ name, parentId = 'root' }: any) => {
          const f = await this.driveFetch('/files', {
            method: 'POST',
            body: {
              name,
              mimeType: 'application/vnd.google-apps.folder',
              parents: [parentId],
            },
          });
          return { created: true, id: f.id, name: f.name, webViewLink: f.webViewLink ?? '' };
        },
      },

      // ── gdrive_upload_text ──────────────────────────────────────────────────
      {
        name: 'gdrive_upload_text',
        description: 'Upload a text file to Google Drive',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'File name including extension' },
            content: { type: 'string', description: 'Text content to upload' },
            parentId: { type: 'string', description: 'Parent folder ID (default: root)' },
            mimeType: {
              type: 'string',
              description: 'MIME type (default: text/plain)',
            },
          },
          required: ['name', 'content'],
        },
        handler: async ({ name, content, parentId = 'root', mimeType = 'text/plain' }: any) => {
          // Multipart upload
          const boundary = `conductor_${Date.now()}`;
          const metadata = JSON.stringify({ name, parents: [parentId] });
          const body = [
            `--${boundary}`,
            'Content-Type: application/json; charset=UTF-8',
            '',
            metadata,
            `--${boundary}`,
            `Content-Type: ${mimeType}`,
            '',
            content,
            `--${boundary}--`,
          ].join('\r\n');

          const token = await this.getToken();
          const res = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body,
          });
          if (!res.ok) throw new Error(`Drive upload failed: ${res.status} ${res.statusText}`);
          const f = await res.json() as any;
          return { uploaded: true, id: f.id, name: f.name };
        },
      },

      // ── gdrive_delete ───────────────────────────────────────────────────────
      {
        name: 'gdrive_delete',
        description: 'Permanently delete a file from Google Drive',
        requiresApproval: true,
        inputSchema: {
          type: 'object',
          properties: {
            fileId: { type: 'string', description: 'File ID to delete' },
          },
          required: ['fileId'],
        },
        handler: async ({ fileId }: any) => {
          await this.driveFetch(`/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
          return { deleted: true, fileId };
        },
      },
    ];
  }
}
