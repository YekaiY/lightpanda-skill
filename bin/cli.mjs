#!/usr/bin/env node
/**
 * lightpanda-skill CLI
 *
 * Installs the lightpanda-browser agent skill into a project or the user's
 * DSH home, so it becomes discoverable by the agent. This is deliberately a
 * file-copy installer rather than a runtime library: a skill is text the agent
 * reads, so it must live on disk where the skill loader looks.
 *
 * Usage:
 *   npx lightpanda-skill install [--dir <path>] [--user] [--force]
 *   npx lightpanda-skill print  [--file SKILL.md]
 *   npx lightpanda-skill where
 *   npx lightpanda-skill doctor
 */
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL_NAME = 'lightpanda-browser';
const SRC = join(PKG_ROOT, '.dsh', 'skills', SKILL_NAME);

const C = process.stdout.isTTY
  ? { dim: '\x1b[2m', bold: '\x1b[1m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', off: '\x1b[0m' }
  : { dim: '', bold: '', green: '', yellow: '', red: '', cyan: '', off: '' };

const log = (...a) => console.log(...a);
const warn = (...a) => console.error(`${C.yellow}warn${C.off}`, ...a);
const die = (msg) => { console.error(`${C.red}error${C.off} ${msg}`); process.exit(1); };

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') out.dir = argv[++i];
    else if (a === '--user') out.user = true;
    else if (a === '--force' || a === '-f') out.force = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--file') out.file = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('-')) die(`unknown flag: ${a}`);
    else out._.push(a);
  }
  return out;
}

/** Walk the bundled skill directory and return posix-style relative paths. */
async function listFiles(root, base = root) {
  const out = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const abs = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(abs, base));
    else if (entry.isFile()) out.push(relative(base, abs).split(/[\\/]/).join('/'));
  }
  return out;
}

/**
 * Resolve the install target.
 * Default: <cwd>/.dsh/skills/<name> — the project root DSH discovers.
 * --user:  ~/.dsh/skills/<name>  — every project on the machine.
 */
function resolveTarget(opts) {
  if (opts.dir) {
    const d = resolve(opts.dir);
    // If the caller names the skills root, nest under it; if they name a
    // parent, still produce <that>/.dsh/skills/<name>.
    if (d.endsWith(join('.dsh', 'skills')) || d.endsWith('/skills')) return join(d, SKILL_NAME);
    return join(d, '.dsh', 'skills', SKILL_NAME);
  }
  if (opts.user) return join(homedir(), '.dsh', 'skills', SKILL_NAME);
  return join(process.cwd(), '.dsh', 'skills', SKILL_NAME);
}

async function cmdInstall(opts) {
  if (!existsSync(SRC)) die(`bundled skill not found at ${SRC} — package is corrupt`);

  const dest = resolveTarget(opts);
  if (opts.dryRun) {
    // Report the resolved target without writing anything.
    log(`would install ${SKILL_NAME} → ${dest}`);
    log(`${C.dim}(${(await listFiles(SRC)).length} files; --dry-run wrote nothing)${C.off}`);
    return 0;
  }
  if (existsSync(dest) && !opts.force) {
    // Never silently clobber a skill the user may have edited.
    die(`${dest} already exists.\n  Re-run with --force to overwrite, or --dir to install elsewhere.`);
  }

  const files = await listFiles(SRC);
  let copied = 0;
  for (const rel of files) {
    const from = join(SRC, rel);
    const to = join(dest, rel);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    copied++;
  }
  // Keep shell scripts executable.
  for (const rel of files.filter((f) => f.endsWith('.sh'))) {
    const { chmod } = await import('node:fs/promises');
    await chmod(join(dest, rel), 0o755);
  }

  log(`${C.green}installed${C.off} ${C.bold}${SKILL_NAME}${C.off} → ${dest}`);
  log(`${C.dim}${copied} files${C.off}`);

  // Tell the user how to verify, and warn if the binary itself is missing.
  const parent = dirname(dirname(dirname(dest)));
  log(`\n${C.dim}The skill is discovered automatically. Verify with:${C.off}`);
  log(`  ls ${join(dest, 'SKILL.md')}`);
  log(`\n${C.dim}This skill drives the Lightpanda binary. Check it:${C.off}`);
  log(`  lightpanda version   ${C.dim}# or: npx lightpanda-skill doctor${C.off}`);
  return 0;
}

async function cmdPrint(opts) {
  // Print a single bundled file to stdout so the text is pipeable.
  const rel = opts.file ?? 'SKILL.md';
  // Refuse path traversal out of the skill directory.
  const target = resolve(SRC, rel);
  if (relative(SRC, target).startsWith('..')) die(`refusing to read outside the skill: ${rel}`);
  if (!existsSync(target)) die(`no such file in skill: ${rel}`);
  process.stdout.write(await readFile(target, 'utf8'));
  return 0;
}

async function cmdWhere() {
  log(SRC);
  return 0;
}

async function cmdDoctor() {
  const { spawnSync } = await import('node:child_process');
  const bin = process.env.LP_BIN || 'lightpanda';

  log(`${C.bold}lightpanda-skill doctor${C.off}\n`);

  // 1. bundled skill present
  const okSkill = existsSync(join(SRC, 'SKILL.md'));
  log(` skill bundle      ${okSkill ? C.green + 'ok' + C.off : C.red + 'MISSING' + C.off}  ${SRC}`);

  // 2. installed anywhere?
  const projectDest = join(process.cwd(), '.dsh', 'skills', SKILL_NAME);
  const userDest = join(homedir(), '.dsh', 'skills', SKILL_NAME);
  for (const [label, p] of [['project install', projectDest], ['user install', userDest]]) {
    log(` ${label.padEnd(17)} ${existsSync(p) ? C.green + 'present' + C.off : C.dim + 'absent' + C.off}  ${p}`);
  }

  // 3. binary present + version
  const r = spawnSync(bin, ['version'], { encoding: 'utf8', timeout: 15000 });
  if (r.error || r.status !== 0) {
    log(` lightpanda binary ${C.yellow}not found${C.off}`);
    log(`\n${C.dim}Install it:${C.off}`);
    log(`  curl -fsSL https://pkg.lightpanda.io/install.sh | bash`);
    log(`  ${C.dim}# binary lands in ~/.local/bin/lightpanda${C.off}`);
  } else {
    log(` lightpanda binary ${C.green}ok${C.off}       ${(r.stdout || '').trim().split('\n')[0]}`);
  }

  // 4. a real render, because `version` alone proves little
  if (r.status === 0) {
    const probe = spawnSync(bin, [
      'fetch', '--dump', 'markdown', '--strip-mode', 'clutter', '--wait-ms', '8000',
      '--fail-on-http-error', 'https://example.com',
    ], { encoding: 'utf8', timeout: 40000 });
    const bytes = (probe.stdout || '').length;
    if (probe.status === 0 && bytes > 0) {
      log(` render test       ${C.green}ok${C.off}       ${bytes} bytes from example.com`);
    } else {
      log(` render test       ${C.red}failed${C.off}     exit=${probe.status} bytes=${bytes}`);
      log(`${C.dim}  network, proxy, or TLS problem — see references/install.md${C.off}`);
    }
  }

  log(`\n${C.dim}Docs: https://github.com/YekaiY/lightpanda-skill${C.off}`);
  return 0;
}

function usage() {
  log(`${C.bold}lightpanda-skill${C.off} — install the Lightpanda browser agent skill

${C.bold}Usage${C.off}
  npx lightpanda-skill <command> [options]

${C.bold}Commands${C.off}
  install            Copy the skill into this project (default)
  print [--file F]   Print a bundled skill file to stdout (default: SKILL.md)
  where              Show where the bundled skill lives
  doctor             Check the skill install and the lightpanda binary

${C.bold}install options${C.off}
  --dir <path>       Install into <path> instead of the cwd
  --user             Install to ~/.dsh/skills (all projects on this machine)
  --force, -f        Overwrite an existing install

${C.bold}Examples${C.off}
  npx lightpanda-skill install              ${C.dim}# into ./.dsh/skills/${SKILL_NAME}${C.off}
  npx lightpanda-skill install --user       ${C.dim}# into ~/.dsh/skills${C.off}
  npx lightpanda-skill doctor               ${C.dim}# verify binary + install${C.off}
  npx lightpanda-skill print --file references/fetch.md`);
  return 0;
}

const opts = parseArgs(process.argv.slice(2));
const cmd = opts.help ? 'help' : (opts._[0] ?? 'install');

try {
  const rc = await ({
    install: () => cmdInstall(opts),
    print: () => cmdPrint(opts),
    where: () => cmdWhere(),
    doctor: () => cmdDoctor(),
    help: () => usage(),
    '--help': () => usage(),
  }[cmd] ?? (() => { usage(); die(`unknown command: ${cmd}`); }))();
  process.exit(rc ?? 0);
} catch (err) {
  die(err?.message ?? String(err));
}
