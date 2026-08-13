/** End-to-end runner: --level quick|smart|full, --only <names>, --gates-only, --verbose.
 *  Deploys once, runs the offline gates then the harnesses, and diffs the report against the previous run so the output names what changed. */

// Usage:
//   bun run e2e                     # quick: the fast harnesses
//   bun run e2e -- --level smart    # only what the working diff can affect
//   bun run e2e -- --level full     # every harness, quests included
//   bun run e2e -- --only troll,horror
//   bun run e2e -- --gates-only     # offline gates, no engine needed
//   bun run e2e -- --verbose        # stream every child line
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { errorTail } from './lib/e2e-report.js';

type Status = 'pass' | 'fail' | 'timeout' | 'skip';
type Level = 'quick' | 'smart' | 'full';
interface Result { name: string; kind: 'gate' | 'harness'; status: Status; ms: number; note: string; }
interface Run { startedAt: string; git: string; level: Level; results: Result[]; }

const OUT = 'out/e2e';
const LOGS = join(OUT, 'logs');
const LATEST = join(OUT, 'latest.json');

/** Harnesses that need a world, an account or a second machine no runner can provide. */
const EXCLUDED = new Set(['hosted-proof-test.ts', 'hosted-wall-test.ts', 'external-script-test.ts']);

/** Minutes per harness. Anything absent gets DEFAULT_BUDGET. */
const BUDGET: Record<string, number> = {
    'trollstronghold-264-live.ts': 90,
    'horror-deep-216-live.ts': 90,
    'family-crest-210-live.ts': 75,
    'knights-sword-228-live.ts': 60,
    'ernest-chicken-229-live.ts': 45,
    'aio-quest-test.ts': 120
};
const DEFAULT_BUDGET = 12;

/** `verdict` overrides the exit code where a tool reports its status in its output.
 *  Why: the generators print STALE and some then exit non-zero on an unrelated teardown crash in the vendored audio shim. */
const DRIFT = (text: string): Status => (/\bSTALE\b|does not match/i.test(text) ? 'fail' : 'pass');

interface Gate { name: string; cmd: string[]; verdict?: (text: string) => Status; }
const OFFLINE_GATES: Gate[] = [
    { name: 'unit tests', cmd: ['bun', 'test'] },
    { name: 'typecheck', cmd: ['bun', 'run', 'typecheck'] },
    { name: 'lint', cmd: ['bun', 'run', 'lint'] },
    { name: 'cluedb drift', cmd: ['bun', 'tools/clues/gen-cluedb.ts', '--check'], verdict: DRIFT },
    { name: 'dropdb drift', cmd: ['bun', 'tools/combat/gen-dropdb.ts', '--check'], verdict: DRIFT },
    { name: 'spelldb drift', cmd: ['bun', 'tools/combat/gen-spelldb.ts', '--check'], verdict: DRIFT },
    { name: 'itemdb drift', cmd: ['bun', 'tools/items/gen-itemdb.ts', '--check'], verdict: DRIFT },
    { name: 'shopdb drift', cmd: ['bun', 'tools/shops/gen-shopdb.ts', '--check'], verdict: DRIFT },
    { name: 'scriptdocs drift', cmd: ['bun', 'tools/gen-scriptdocs.ts', '--check'], verdict: DRIFT }
];

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`);
    return i !== -1 ? process.argv[i + 1] : undefined;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

/** Quest harnesses take --stage and cost tens of minutes each. */
function isQuest(file: string): boolean {
    return readFileSync(join('tools', file), 'utf8').includes("'--stage'");
}

function allHarnesses(): string[] {
    return readdirSync('tools')
        .filter(f => (f.endsWith('-test.ts') || f.endsWith('-live.ts')) && !EXCLUDED.has(f))
        .sort();
}

/** Filename tokens, used to match a harness against changed source paths. */
function tokens(file: string): string[] {
    return file
        .replace(/-(test|live)\.ts$/, '')
        .split(/[-_]/)
        .filter(t => t.length > 3 && !/^\d+$/.test(t));
}

/** smart: run only harnesses the working diff could plausibly affect.
 *  A harness is selected when one of its filename tokens appears in a changed path or a subsystem it exercises changed; shared code (adapter, runtime, api) selects everything. */
function smartSelect(changed: string[]): { files: string[]; why: string } {
    if (changed.length === 0) return { files: [], why: 'no changes against main' };
    const broad = changed.some(c => /^src\/bot\/(adapter|runtime|api)\//.test(c) || c === 'package.json');
    if (broad) return { files: allHarnesses(), why: 'shared code changed (adapter, runtime or api) — everything is reachable' };

    const hay = changed.join(' ').toLowerCase();
    const picked = allHarnesses().filter(f => tokens(f).some(t => hay.includes(t)));
    const navTouched = changed.some(c => c.startsWith('src/bot/event/webwalk/'));
    const withNav = navTouched ? [...new Set([...picked, ...allHarnesses().filter(f => f.includes('nav'))])] : picked;
    return { files: withNav.sort(), why: `${changed.length} changed files matched ${withNav.length} harnesses` };
}

function harnesses(level: Level, only: string[]): { files: string[]; why: string } {
    let files: string[];
    let why: string;
    if (level === 'full') {
        files = allHarnesses();
        why = 'full: every harness';
    } else if (level === 'smart') {
        const changed = (Bun.spawnSync(['git', 'diff', '--name-only', 'origin/main...HEAD']).stdout.toString() +
                         Bun.spawnSync(['git', 'diff', '--name-only']).stdout.toString())
            .split('\n').map(s => s.trim()).filter(Boolean);
        ({ files, why } = smartSelect([...new Set(changed)]));
    } else {
        files = allHarnesses().filter(f => !isQuest(f) && f.endsWith('-test.ts'));
        why = 'quick: non-quest -test.ts harnesses';
    }
    if (only.length > 0) {
        files = files.filter(f => only.some(o => f.includes(o)));
        why += '; filtered by --only';
    }
    return { files, why };
}

const TTY = Boolean(process.stdout.isTTY);
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');
/** How often a non-TTY run (cron, CI) prints a still-alive line. */
const HEARTBEAT_MS = 30_000;

function statusLine(label: string, started: number, last: string): void {
    const el = `${Math.floor((Date.now() - started) / 1000)}s`.padStart(5);
    const text = `  ⏳ ${label} ${el}  ${last}`.slice(0, (process.stdout.columns || 100) - 1);
    if (TTY) process.stdout.write(`\r\u001b[2K${text}`);
    else console.log(text);
}

async function run(label: string, cmd: string[], logFile: string, budgetMs: number, verdict?: (text: string) => Status): Promise<{ status: Status; ms: number; tail: string }> {
    const started = Date.now();
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, HEADED: '0' } });
    const timer = setTimeout(() => proc.kill(9), budgetMs);
    const log = Bun.file(logFile).writer();
    const lines: string[] = [];
    let last = '';
    let beat = Date.now();

    const pump = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
        const decoder = new TextDecoder();
        const rd = stream.getReader();
        let buf = '';
        for (;;) {
            const { done, value } = await rd.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const parts = buf.split('\n');
            buf = parts.pop() ?? '';
            for (const line of parts) {
                log.write(`${line}\n`);
                lines.push(line);
                if (lines.length > 400) lines.shift();
                const clean = line.trim();
                if (!clean) continue;
                last = clean;
                if (VERBOSE) {
                    if (TTY) process.stdout.write('\r\u001b[2K');
                    console.log(`     ${clean}`.slice(0, (process.stdout.columns || 100) - 1));
                } else if (TTY || Date.now() - beat > HEARTBEAT_MS) {
                    beat = Date.now();
                    statusLine(label, started, clean);
                }
            }
        }
    };

    const ticker = TTY && !VERBOSE ? setInterval(() => statusLine(label, started, last), 1000) : null;
    await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
    const code = await proc.exited;
    clearTimeout(timer);
    if (ticker) clearInterval(ticker);
    if (TTY) process.stdout.write('\r\u001b[2K');
    await log.end();

    const ms = Date.now() - started;
    const text = lines.join('\n');
    const timedOut = ms >= budgetMs - 1000;
    const tail = errorTail(lines);
    const status: Status = timedOut ? 'timeout' : verdict ? verdict(text) : code === 0 ? 'pass' : 'fail';
    return { status, ms, tail };
}

const mins = (ms: number): string => `${(ms / 60000).toFixed(1)}m`;
const ICON: Record<Status, string> = { pass: '✅', fail: '❌', timeout: '⏱', skip: '⏭' };

function report(now: Run, before: Run | null): string {
    const prev = new Map((before?.results ?? []).map(r => [r.name, r.status]));
    const newlyBroken = now.results.filter(r => r.status !== 'pass' && prev.get(r.name) === 'pass');
    const newlyFixed = now.results.filter(r => r.status === 'pass' && prev.has(r.name) && prev.get(r.name) !== 'pass');
    const stillBroken = now.results.filter(r => r.status !== 'pass' && prev.get(r.name) && prev.get(r.name) !== 'pass');
    const untracked = now.results.filter(r => r.status !== 'pass' && !prev.has(r.name));

    const rows = (rs: Result[]): string => rs.map(r => `| ${ICON[r.status]} ${r.name} | ${r.status} | ${mins(r.ms)} | ${r.note} |`).join('\n');
    const section = (title: string, rs: Result[], empty: string): string =>
        rs.length === 0 ? `## ${title}\n\n${empty}\n` : `## ${title}\n\n| Item | Status | Time | Last output |\n|---|---|---|---|\n${rows(rs)}\n`;

    const failed = now.results.filter(r => r.status !== 'pass' && r.status !== 'skip').length;
    const head = [
        '# Regression report',
        '',
        '| | |',
        '|---|---|',
        `| Started | ${now.startedAt} |`,
        `| Commit | \`${now.git}\` |`,
        `| Level | ${now.level} |`,
        `| Ran | ${now.results.length} |`,
        `| Failing | ${failed} |`,
        `| Baseline | ${before ? `${before.startedAt} (\`${before.git}\`)` : 'none — this is the first run'} |`,
        ''
    ].join('\n');

    return [
        head,
        section('Newly broken since the baseline', newlyBroken, 'Nothing regressed.'),
        section('Newly fixed', newlyFixed, 'Nothing newly fixed.'),
        section('Still broken', stillBroken, 'Nothing carried over.'),
        section('Failing, no baseline entry', untracked, 'Nothing new and failing.'),
        '## Everything\n\n| Item | Status | Time | Last output |\n|---|---|---|---|\n' +
            now.results.map(r => `| ${ICON[r.status]} ${r.name} | ${r.status} | ${mins(r.ms)} | ${r.note} |`).join('\n') + '\n',
        `Logs: \`${LOGS}/\`\n`
    ].join('\n');
}

const level = (arg('level') as Level | undefined) ?? 'quick';
const only = (arg('only') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const engine = arg('engine');

mkdirSync(LOGS, { recursive: true });
const git = (await new Response(Bun.spawn(['git', 'rev-parse', '--short', 'HEAD'], { stdout: 'pipe' }).stdout).text()).trim();
const now: Run = { startedAt: new Date().toISOString(), git, level, results: [] };

console.log(`e2e: level=${level} commit=${git}`);

for (const { name, cmd, verdict } of OFFLINE_GATES) {
    const r = await run(name, cmd, join(LOGS, `${name.replace(/\W+/g, '-')}.log`), 20 * 60_000, verdict);
    now.results.push({ name, kind: 'gate', status: r.status, ms: r.ms, note: r.status === 'pass' ? '' : r.tail });
    console.log(`  ${ICON[r.status]} ${name} (${mins(r.ms)})${r.status === 'pass' ? '' : `\n      ${r.tail}`}`);
}

if (!has('gates-only')) {
    const gatesGreen = now.results.every(r => r.status === 'pass');
    if (!gatesGreen && !has('force')) {
        console.log('offline gates failed — skipping harnesses (pass --force to run anyway)');
    } else {
        const deploy = await run('deploy', ['sh', 'tools/deploy-local.sh'], join(LOGS, 'deploy.log'), 20 * 60_000);
        now.results.push({ name: 'deploy', kind: 'gate', status: deploy.status, ms: deploy.ms, note: deploy.status === 'pass' ? '' : deploy.tail });
        console.log(`  ${ICON[deploy.status]} deploy (${mins(deploy.ms)})`);

        if (deploy.status === 'pass') {
            const { files, why } = harnesses(level, only);
            console.log(`${files.length} harnesses — ${why}`);
            for (const [i, file] of files.entries()) {
                const budget = (BUDGET[file] ?? DEFAULT_BUDGET) * 60_000;
                const cmd = ['bun', join('tools', file), '--no-deploy'];
                if (engine) cmd.push('--base', engine);
                const r = await run(`[${i + 1}/${files.length}] ${file}`, cmd, join(LOGS, `${file}.log`), budget);
                now.results.push({ name: file, kind: 'harness', status: r.status, ms: r.ms, note: r.status === 'pass' ? '' : r.tail });
                console.log(`  ${ICON[r.status]} ${file} (${mins(r.ms)})${r.status === 'pass' ? '' : `\n      ${r.tail}`}`);
            }
        } else {
            console.log('deploy failed — harnesses would test a stale bundle, so none were run');
        }
    }
}

const before: Run | null = existsSync(LATEST) ? JSON.parse(readFileSync(LATEST, 'utf8')) as Run : null;
const md = report(now, before);
const stamp = now.startedAt.replace(/[:.]/g, '-');
writeFileSync(join(OUT, `${stamp}.json`), JSON.stringify(now, null, 1));
writeFileSync(join(OUT, 'report.md'), md);
writeFileSync(LATEST, JSON.stringify(now, null, 1));

console.log(`\n${md.split('## Everything')[0]}`);
console.log(`report: ${OUT}/report.md`);

const broken = now.results.filter(r => r.status !== 'pass' && r.status !== 'skip').length;
process.exit(broken > 0 ? 1 : 0);
