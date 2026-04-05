/**
 * conductor release — automated npm publish with version bump
 *
 * Handles the full release pipeline:
 *   1. Check npm auth + git state
 *   2. Run tests + typecheck
 *   3. Bump version (patch / minor / major / explicit)
 *   4. Build
 *   5. npm publish --access public
 *   6. git tag + push
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile } from 'fs/promises';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const exec = promisify(execFile);
const _require = createRequire(import.meta.url);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_PATH = path.resolve(__dirname, '../../../package.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function step(msg: string) {
  process.stdout.write(`\n  ${chalk.dim('▶')} ${msg}…`);
}

function ok(detail?: string) {
  process.stdout.write(` ${chalk.green('✓')}${detail ? chalk.dim(' ' + detail) : ''}\n`);
}

function fail(msg: string): never {
  process.stdout.write(` ${chalk.red('✗')}\n`);
  console.error(`\n  ${chalk.red('Error:')} ${msg}\n`);
  process.exit(1);
}

async function run(cmd: string, args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await exec(cmd, args, { cwd: cwd ?? process.cwd() });
    return stdout.trim();
  } catch (e: any) {
    throw new Error(e.stderr?.trim() || e.message);
  }
}

function bumpVersion(current: string, bump: 'patch' | 'minor' | 'major'): string {
  const parts = current.replace(/^v/, '').split('.').map(Number);
  if (bump === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0; }
  else if (bump === 'minor') { parts[1]++; parts[2] = 0; }
  else { parts[2]++; }
  return parts.join('.');
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function release(): Promise<void> {
  console.log('');
  console.log(chalk.bold('  ╔══════════════════════════════════════╗'));
  console.log(chalk.bold('  ║') + chalk.hex('#FF8C00')('  ♦ Conductor — Release to npm         ') + chalk.bold('║'));
  console.log(chalk.bold('  ╚══════════════════════════════════════╝'));
  console.log('');

  // ── 1. Read current package.json ────────────────────────────────────────────
  const pkgRaw = await readFile(PKG_PATH, 'utf8');
  const pkg = JSON.parse(pkgRaw) as { name: string; version: string };
  const currentVersion = pkg.version;

  console.log(chalk.dim(`  Package: ${chalk.white(pkg.name)}  v${currentVersion}`));

  // ── 2. Check npm auth ───────────────────────────────────────────────────────
  step('Checking npm auth');
  try {
    const whoami = await run('npm', ['whoami']);
    ok(whoami);
  } catch {
    fail('Not logged in to npm. Run: npm login');
  }

  // ── 3. Check git is clean ───────────────────────────────────────────────────
  step('Checking git status');
  try {
    const status = await run('git', ['status', '--porcelain']);
    if (status.length > 0) {
      fail('Working tree is not clean. Commit or stash changes first.');
    }
    ok('clean');
  } catch (e: any) {
    if (e.message.includes('Working tree')) throw e;
    fail(e.message);
  }

  // ── 4. Version bump prompt ──────────────────────────────────────────────────
  console.log('');
  const { bumpType } = await inquirer.prompt<{ bumpType: string }>([
    {
      type: 'list',
      name: 'bumpType',
      message: `Version bump (current: ${chalk.white('v' + currentVersion)}):`,
      choices: [
        {
          name: `patch  → v${bumpVersion(currentVersion, 'patch')}  (bug fixes)`,
          value: 'patch',
        },
        {
          name: `minor  → v${bumpVersion(currentVersion, 'minor')}  (new features)`,
          value: 'minor',
        },
        {
          name: `major  → v${bumpVersion(currentVersion, 'major')}  (breaking changes)`,
          value: 'major',
        },
        {
          name: 'custom  — enter version manually',
          value: 'custom',
        },
      ],
      default: 'patch',
    },
  ]);

  let newVersion: string;
  if (bumpType === 'custom') {
    const { customVersion } = await inquirer.prompt<{ customVersion: string }>([
      {
        type: 'input',
        name: 'customVersion',
        message: 'Enter version (e.g. 1.2.3 or 1.2.3-beta.1):',
        validate: (v) => /^\d+\.\d+\.\d+/.test(v) || 'Must be semver (e.g. 1.2.3)',
      },
    ]);
    newVersion = customVersion.replace(/^v/, '');
  } else {
    newVersion = bumpVersion(currentVersion, bumpType as 'patch' | 'minor' | 'major');
  }

  const { confirmed } = await inquirer.prompt<{ confirmed: boolean }>([
    {
      type: 'confirm',
      name: 'confirmed',
      message: `Publish ${chalk.white(pkg.name + '@' + newVersion)} to npm?`,
      default: true,
    },
  ]);

  if (!confirmed) {
    console.log(chalk.dim('\n  Aborted.\n'));
    process.exit(0);
  }

  // ── 5. Typecheck ────────────────────────────────────────────────────────────
  step('Type-checking');
  try {
    await run('npx', ['tsc', '--noEmit']);
    ok();
  } catch (e: any) {
    fail(`TypeScript errors:\n${e.message}`);
  }

  // ── 6. Tests ─────────────────────────────────────────────────────────────────
  step('Running tests');
  try {
    await run('npx', ['vitest', 'run', '--reporter=dot']);
    ok();
  } catch (e: any) {
    const { skipTests } = await inquirer.prompt<{ skipTests: boolean }>([
      {
        type: 'confirm',
        name: 'skipTests',
        message: chalk.yellow('Tests failed. Publish anyway?'),
        default: false,
      },
    ]);
    if (!skipTests) {
      console.log(chalk.dim('\n  Aborted.\n'));
      process.exit(1);
    }
  }

  // ── 7. Bump version in package.json ─────────────────────────────────────────
  step(`Bumping version to ${newVersion}`);
  pkg.version = newVersion;
  await writeFile(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  ok();

  // ── 8. Build ─────────────────────────────────────────────────────────────────
  step('Building');
  try {
    await run('npm', ['run', 'build']);
    ok();
  } catch (e: any) {
    // Restore version on build failure
    const restored = JSON.parse(pkgRaw) as { version: string };
    restored.version = currentVersion;
    await writeFile(PKG_PATH, JSON.stringify(restored, null, 2) + '\n', 'utf8');
    fail(`Build failed:\n${e.message}`);
  }

  // ── 9. npm publish ───────────────────────────────────────────────────────────
  step(`Publishing ${pkg.name}@${newVersion}`);
  try {
    await run('npm', ['publish', '--access', 'public']);
    ok();
  } catch (e: any) {
    fail(`npm publish failed:\n${e.message}`);
  }

  // ── 10. Git commit + tag + push ──────────────────────────────────────────────
  step('Committing version bump');
  try {
    await run('git', ['add', 'package.json']);
    await run('git', ['commit', '-m', `chore: release v${newVersion}`]);
    ok();
  } catch (e: any) {
    fail(e.message);
  }

  step(`Tagging v${newVersion}`);
  try {
    await run('git', ['tag', `v${newVersion}`, '-m', `v${newVersion}`]);
    ok();
  } catch (e: any) {
    fail(e.message);
  }

  step('Pushing to origin');
  try {
    await run('git', ['push', 'origin', 'main', '--follow-tags']);
    ok();
  } catch (e: any) {
    fail(e.message);
  }

  // ── Done ─────────────────────────────────────────────────────────────────────
  console.log('');
  console.log(
    chalk.bold.white(`  ✓ Published `) +
    chalk.hex('#FF8C00')(`${pkg.name}@${newVersion}`) +
    chalk.bold.white(` to npm`),
  );
  console.log('');
  console.log(chalk.dim(`  npm i -g ${pkg.name}`));
  console.log(chalk.dim(`  npx ${pkg.name}`));
  console.log('');
}
