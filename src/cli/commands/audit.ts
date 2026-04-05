/**
 * conductor audit — query and verify the tamper-evident audit log.
 *
 * Commands:
 *   conductor audit list   — filter and display log entries
 *   conductor audit verify — verify SHA-256 chain integrity
 *   conductor audit tail   — stream the log in real time
 *   conductor audit export — export entries to JSON or NDJSON
 *   conductor audit stats  — show summary statistics
 *   conductor audit rotate — manually rotate the current log file
 */

import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import readline from 'readline';
import { AuditLogger } from '../../core/audit.js';
import type { AuditEntry } from '../../core/audit.js';
import type { Conductor } from '../../core/conductor.js';

function getAuditDir(conductor: Conductor): string {
  return path.join(conductor.getConfig().getConfigDir(), 'audit');
}

function getAuditFile(conductor: Conductor): string {
  return path.join(getAuditDir(conductor), 'audit.log');
}

/** Read all entries from all audit log files, newest files last. */
async function readAllEntries(conductor: Conductor): Promise<AuditEntry[]> {
  const dir = getAuditDir(conductor);
  const entries: AuditEntry[] = [];

  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const logFiles = files.filter((f) => f.endsWith('.log')).sort();

  for (const file of logFiles) {
    const content = await fs.readFile(path.join(dir, file), 'utf-8').catch(() => '');
    for (const line of content.split('\n').filter((l) => l.trim())) {
      try {
        entries.push(JSON.parse(line) as AuditEntry);
      } catch {
        // skip malformed lines
      }
    }
  }

  return entries;
}

function formatEntry(e: AuditEntry): string {
  const time = e.timestamp.replace('T', ' ').replace(/\.\d+Z$/, '');
  const icon = e.result === 'success' ? '✓' : e.result === 'failure' ? '✗' : e.result === 'denied' ? '⊘' : '⏱';
  return `  ${icon} ${time}  ${e.actor.padEnd(12)} ${e.action.padEnd(16)} ${e.resource}`;
}

// ── list ──────────────────────────────────────────────────────────────────────

export async function auditList(
  conductor: Conductor,
  opts: {
    actor?: string;
    action?: string;
    tool?: string;
    result?: string;
    since?: string;
    until?: string;
    limit?: string;
    json?: boolean;
  },
): Promise<void> {
  let entries = await readAllEntries(conductor);

  if (opts.actor) entries = entries.filter((e) => e.actor === opts.actor);
  if (opts.action) entries = entries.filter((e) => e.action === opts.action);
  if (opts.tool) entries = entries.filter((e) => e.resource === opts.tool);
  if (opts.result) entries = entries.filter((e) => e.result === opts.result);
  if (opts.since) entries = entries.filter((e) => e.timestamp >= opts.since!);
  if (opts.until) entries = entries.filter((e) => e.timestamp <= opts.until!);

  const limit = opts.limit ? parseInt(opts.limit, 10) : 100;
  entries = entries.slice(-limit);

  if (entries.length === 0) {
    console.log('\n  No audit entries found.\n');
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  console.log('');
  console.log(`  📋 Audit Log (${entries.length} entries)\n`);
  console.log(
    `  ${'RESULT'.padEnd(3)} ${'TIMESTAMP'.padEnd(19)}  ${'ACTOR'.padEnd(12)} ${'ACTION'.padEnd(16)} RESOURCE`,
  );
  console.log('  ' + '─'.repeat(80));
  for (const e of entries) {
    console.log(formatEntry(e));
  }
  console.log('');
}

// ── verify ────────────────────────────────────────────────────────────────────

export async function auditVerify(conductor: Conductor, opts: { json?: boolean }): Promise<void> {
  const logger = new AuditLogger(conductor.getConfig().getConfigDir(), { flushIntervalMs: 50000 });
  try {
    const { valid, brokenAt } = await logger.verifyIntegrity();

    if (opts.json) {
      console.log(JSON.stringify({ valid, brokenAt }));
      return;
    }

    console.log('');
    if (valid) {
      console.log('  ✅ Audit log integrity verified — no tampering detected.\n');
    } else {
      console.log(`  ❌ Integrity check FAILED — chain broken at: ${brokenAt}\n`);
      console.log('  The audit log may have been tampered with. Contact your security team.\n');
      process.exit(1);
    }
  } finally {
    await logger.close();
  }
}

// ── tail ──────────────────────────────────────────────────────────────────────

export async function auditTail(conductor: Conductor, opts: { json?: boolean; lines?: string }): Promise<void> {
  const logFile = getAuditFile(conductor);
  const initialLines = parseInt(opts.lines || '20', 10);

  // Show last N lines from existing file
  try {
    const content = await fs.readFile(logFile, 'utf-8');
    const lines = content.split('\n').filter((l) => l.trim());
    const recent = lines.slice(-initialLines);

    console.log('');
    for (const line of recent) {
      try {
        const e = JSON.parse(line) as AuditEntry;
        if (opts.json) {
          console.log(JSON.stringify(e));
        } else {
          console.log(formatEntry(e));
        }
      } catch {
        // skip
      }
    }
  } catch {
    console.log('\n  No audit log found yet.\n');
  }

  // Watch for new lines
  console.log('\n  Watching for new entries (Ctrl+C to stop)...\n');

  let fileSize = 0;
  try {
    const stat = await fs.stat(logFile);
    fileSize = stat.size;
  } catch {
    fileSize = 0;
  }

  const watcher = setInterval(async () => {
    try {
      const stat = await fs.stat(logFile);
      if (stat.size > fileSize) {
        const stream = createReadStream(logFile, { start: fileSize });
        const rl = readline.createInterface({ input: stream });
        rl.on('line', (line) => {
          if (!line.trim()) return;
          try {
            const e = JSON.parse(line) as AuditEntry;
            if (opts.json) {
              console.log(JSON.stringify(e));
            } else {
              console.log(formatEntry(e));
            }
          } catch {
            // skip
          }
        });
        fileSize = stat.size;
      }
    } catch {
      // file not yet created
    }
  }, 500);

  process.on('SIGINT', () => {
    clearInterval(watcher);
    console.log('\n');
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

// ── export ────────────────────────────────────────────────────────────────────

export async function auditExport(
  conductor: Conductor,
  opts: {
    output?: string;
    format?: string;
    since?: string;
    until?: string;
  },
): Promise<void> {
  let entries = await readAllEntries(conductor);

  if (opts.since) entries = entries.filter((e) => e.timestamp >= opts.since!);
  if (opts.until) entries = entries.filter((e) => e.timestamp <= opts.until!);

  const format = opts.format || 'json';
  const output = opts.output || `-`;

  let content: string;
  if (format === 'ndjson') {
    content = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  } else {
    content = JSON.stringify(entries, null, 2) + '\n';
  }

  if (output === '-') {
    process.stdout.write(content);
  } else {
    await fs.writeFile(output, content, 'utf-8');
    console.log(`\n  ✅ Exported ${entries.length} entries to: ${output}\n`);
  }
}

// ── stats ─────────────────────────────────────────────────────────────────────

export async function auditStats(conductor: Conductor, opts: { json?: boolean }): Promise<void> {
  const entries = await readAllEntries(conductor);

  if (entries.length === 0) {
    console.log('\n  No audit entries found.\n');
    return;
  }

  const byAction: Record<string, number> = {};
  const byActor: Record<string, number> = {};
  const byResult: Record<string, number> = {};

  for (const e of entries) {
    byAction[e.action] = (byAction[e.action] || 0) + 1;
    byActor[e.actor] = (byActor[e.actor] || 0) + 1;
    byResult[e.result] = (byResult[e.result] || 0) + 1;
  }

  const stats = {
    total: entries.length,
    first: entries[0]?.timestamp,
    last: entries[entries.length - 1]?.timestamp,
    by_action: byAction,
    by_actor: byActor,
    by_result: byResult,
  };

  if (opts.json) {
    console.log(JSON.stringify(stats, null, 2));
    return;
  }

  console.log('');
  console.log(`  📊 Audit Log Statistics\n`);
  console.log(`  Total entries:  ${stats.total}`);
  console.log(`  First entry:    ${stats.first}`);
  console.log(`  Last entry:     ${stats.last}`);
  console.log('');
  console.log('  By result:');
  for (const [k, v] of Object.entries(byResult).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(12)} ${v}`);
  }
  console.log('');
  console.log('  By action (top 10):');
  for (const [k, v] of Object.entries(byAction)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)) {
    console.log(`    ${k.padEnd(20)} ${v}`);
  }
  console.log('');
}

// ── rotate ────────────────────────────────────────────────────────────────────

export async function auditRotate(conductor: Conductor): Promise<void> {
  const logFile = getAuditFile(conductor);

  try {
    const stat = await fs.stat(logFile);
    if (stat.size === 0) {
      console.log('\n  Log file is empty — nothing to rotate.\n');
      return;
    }
    const rotated = `${logFile}.${Date.now()}.bak`;
    await fs.rename(logFile, rotated);
    console.log(`\n  ✅ Rotated audit log to: ${path.basename(rotated)}\n`);
  } catch {
    console.log('\n  No audit log to rotate.\n');
  }
}
