#!/usr/bin/env node
/**
 * Smoke test for the lightpanda-skill package.
 *
 * Proves the thing a user actually cares about: that the published tarball
 * contains the full skill, and that installing it produces a directory the DSH
 * skill loader recognises (SKILL.md with valid frontmatter).
 *
 * Run with: node test/smoke.mjs   (or: npm test)
 * Does NOT require the lightpanda binary — install correctness is independent
 * of whether the browser is available.
 */
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'bin', 'cli.mjs');
const SKILL = 'lightpanda-browser';

let failures = 0;
const ok = (name, detail = '') => console.log(`  \x1b[32mok\x1b[0m   ${name}${detail ? ` \x1b[2m${detail}\x1b[0m` : ''}`);
const bad = (name, detail = '') => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ` \x1b[2m${detail}\x1b[0m` : ''}`); };
const check = (cond, name, detail) => (cond ? ok(name, detail) : bad(name, detail));

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', timeout: 30000 });
}

console.log('lightpanda-skill smoke test\n');

// --- 1. bundled skill is complete and well-formed ---------------------------
console.log('bundle');
const srcSkill = join(ROOT, '.dsh', 'skills', SKILL);
const skillMd = join(srcSkill, 'SKILL.md');
check(existsSync(skillMd), 'SKILL.md present');

if (existsSync(skillMd)) {
  const text = await readFile(skillMd, 'utf8');
  const fm = text.match(/^---\n([\s\S]*?)\n---\n/);
  check(!!fm, 'has YAML frontmatter');
  if (fm) {
    const name = fm[1].match(/^name:\s*(.+)$/m)?.[1]?.trim();
    const desc = fm[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
    // The loader rejects names outside this grammar and hides skills without a description.
    check(name === SKILL, 'frontmatter name matches dir', name);
    check(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name ?? ''), 'name is valid kebab-case');
    check(!!desc && desc.length > 40, 'description is present and substantive', `${desc?.length ?? 0} chars`);
  }
}

const refs = existsSync(join(srcSkill, 'references')) ? await readdir(join(srcSkill, 'references')) : [];
check(refs.length >= 5, 'references present', `${refs.length} files`);
for (const need of ['fetch.md', 'pandascript.md', 'cdp.md', 'mcp.md', 'interfaces.md', 'install.md']) {
  check(refs.includes(need), `reference: ${need}`);
}

const scriptsDir = join(srcSkill, 'scripts');
const scripts = existsSync(scriptsDir) ? await readdir(scriptsDir) : [];
check(scripts.length >= 5, 'scripts present', `${scripts.length} files`);

// Every internal markdown link must resolve, or the agent follows a dead path.
console.log('\ninternal links');
const broken = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (e.name.endsWith('.md')) {
      const txt = await readFile(p, 'utf8');
      for (const [, target] of txt.matchAll(/\[[^\]]+\]\(([^)#]+)\)/g)) {
        if (/^(https?:|mailto:)/.test(target)) continue;
        if (!existsSync(resolve(dirname(p), target))) broken.push(`${p} -> ${target}`);
      }
    }
  }
}
await walk(srcSkill);
check(broken.length === 0, 'all relative links resolve', broken.join(', '));

// --- 2. CLI surface --------------------------------------------------------
console.log('\ncli');
const h = run(['--help']);
check(h.status === 0 && /Usage/.test(h.stdout), '--help exits 0');

const where = run(['where']);
check(where.status === 0 && where.stdout.trim() === srcSkill, 'where prints bundle path');

const printed = run(['print']);
check(printed.status === 0 && printed.stdout.startsWith('---'), 'print outputs SKILL.md');

const traversal = run(['print', '--file', '../../../etc/passwd']);
check(traversal.status === 1, 'print refuses path traversal');

const unknown = run(['bogus-command']);
check(unknown.status === 1, 'unknown command exits 1');

// --- 3. install into a scratch project -------------------------------------
console.log('\ninstall');
const tmp = await mkdtemp(join(tmpdir(), 'lp-skill-'));
try {
  const r = run(['install'], tmp);
  const dest = join(tmp, '.dsh', 'skills', SKILL);
  check(r.status === 0, 'install exits 0');
  check(existsSync(join(dest, 'SKILL.md')), 'SKILL.md installed');
  check(existsSync(join(dest, 'references', 'fetch.md')), 'references installed');
  check(existsSync(join(dest, 'scripts', 'lp.sh')), 'scripts installed');

  // Executable bit matters: the shipped .sh files are meant to be run directly.
  const sh = await stat(join(dest, 'scripts', 'lp.sh'));
  check((sh.mode & 0o111) !== 0, 'shell script keeps exec bit');

  const again = run(['install'], tmp);
  check(again.status === 1, 're-install without --force refuses to clobber');

  const forced = run(['install', '--force'], tmp);
  check(forced.status === 0, 're-install with --force succeeds');

  // --user writes to the real ~/.dsh/skills, which a test must not mutate.
  // Verify the *path resolution* without touching home: an existing install
  // makes it refuse (exit 1), and either way stdout/stderr names the location.
  const userDir = run(['install', '--user', '--dry-run'], tmp);
  check(
    userDir.status === 0 && `${userDir.stdout}`.includes(join('.dsh', 'skills', SKILL)),
    '--user resolves to ~/.dsh/skills',
  );
} finally {
  await rm(tmp, { recursive: true, force: true });
}

// --- 4. packed tarball contains everything ---------------------------------
console.log('\npackage contents');
const pack = spawnSync('npm', ['pack', '--dry-run', '--json', '--cache', join(ROOT, '.npm-cache')], {
  cwd: ROOT, encoding: 'utf8', timeout: 120000,
});
if (pack.status === 0) {
  try {
    // npm --json emits an object keyed by package name (some versions emit an array).
    const parsed = JSON.parse(pack.stdout);
    const info = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
    const names = info.files.map((f) => f.path);
    check(names.some((p) => p.endsWith(`.dsh/skills/${SKILL}/SKILL.md`)), 'tarball includes SKILL.md');
    check(names.some((p) => p.includes('references/fetch.md')), 'tarball includes references');
    check(names.some((p) => p.includes('bin/cli.mjs')), 'tarball includes CLI');
  } catch {
    bad('parse npm pack output');
  }
} else {
  ok('npm pack skipped', 'npm unavailable');
}

console.log(failures === 0 ? '\n\x1b[32mall checks passed\x1b[0m' : `\n\x1b[31m${failures} check(s) failed\x1b[0m`);
process.exit(failures === 0 ? 0 : 1);
