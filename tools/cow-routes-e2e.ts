import { mkdirSync } from 'fs';
import { join } from 'path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { boot, fail, launchBrowser, login, startFromLibrary, type } from './lib/harness.js';

type Runtime = {
    rs2b0t: {
        actions?: { continueDialog?: () => boolean };
        client: { ingame: boolean; sceneState: number };
        reader: {
            inCombat(): boolean;
            inventory(): { name: string | null; count: number }[];
            worldTile(): { x: number; z: number; level: number } | null;
        };
        runner: {
            bot: { status?: string } | null;
            ctx: { startedAt: number; state: string; log: { time: number; level: string; msg: string }[] } | null;
            state: string;
        };
        setRenderMode(mode: 'focused' | 'background'): void;
    };
};

interface CaseSpec {
    id: 'remote' | 'toll' | 'falador';
    location: string;
    startTele: string;
    bankStrategy: 'Off' | 'Loot count';
    bankEveryItems: number;
    seedCoins: boolean;
}

interface RunningCase extends CaseSpec {
    context: BrowserContext;
    page: Page;
    user: string;
    accumulatedLog: string[];
    seenLogLines: Set<string>;
    screenshots: string[];
}

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
    const at = args.indexOf(name);
    return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const base = option('--base', 'http://localhost:8890');
const nodeId = Number(option('--nodeid', '10'));
const minutes = Number(option('--minutes', '10.5'));
if (!Number.isFinite(minutes) || minutes <= 10) {
    fail('--minutes must be greater than 10');
}

const evidenceDir = join(import.meta.dir, '..', 'docs', 'cowkiller-e2e');
mkdirSync(evidenceDir, { recursive: true });

const suffix = Date.now().toString(36).slice(-5);
const allSpecs: CaseSpec[] = [
    {
        id: 'remote',
        location: 'Lumbridge cow field',
        startTele: '::tele 0,50,53,53,28', // Varrock East bank
        bankStrategy: 'Off',
        bankEveryItems: 15,
        seedCoins: false
    },
    {
        id: 'toll',
        location: 'Lumbridge cow field',
        startTele: '::tele 0,51,49,5,31', // Al Kharid bank
        bankStrategy: 'Loot count',
        bankEveryItems: 2,
        seedCoins: true
    },
    {
        id: 'falador',
        location: 'South of Falador',
        startTele: '::tele 0,46,52,2,41', // Falador West bank
        bankStrategy: 'Loot count',
        bankEveryItems: 3,
        seedCoins: false
    }
];
const caseFilter = option('--case', 'all').toLowerCase();
const specs = caseFilter === 'all' ? allSpecs : allSpecs.filter(spec => spec.id === caseFilter);
if (specs.length === 0) {
    fail(`unknown --case ${caseFilter}; expected remote, toll, falador, or all`);
}

function pageUrl(spec: CaseSpec): string {
    const query = new URLSearchParams({
        nodeid: String(nodeId),
        'CowKiller.location': spec.location,
        'CowKiller.alKharidTollCoins': 'true',
        'CowKiller.bankStrategy': spec.bankStrategy,
        'CowKiller.bankEveryItems': String(spec.bankEveryItems),
        'CowKiller.leashRadius': '18',
        'CowKiller.fightHpGate': '20',
        'CowKiller.restUntilHp': '50'
    });
    return `${base}/bot.html?${query}`;
}

async function relogin(page: Page, user: string): Promise<void> {
    await page.reload();
    await boot(page);
    for (let attempt = 0; attempt < 8; attempt++) {
        if (await login(page, user)) {
            return;
        }
        await page.waitForTimeout(2500);
    }
    fail(`${user}: could not re-login off Tutorial Island`);
}

async function clearDialogs(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const actions = (globalThis as never as Runtime).rs2b0t.actions;
        for (let i = 0; i < 24; i++) {
            actions?.continueDialog?.();
            await new Promise(resolve => setTimeout(resolve, 125));
        }
    });
}

async function teleport(page: Page, command: string): Promise<void> {
    const parts = command.replace(/^::tele\s+/, '').split(',').map(Number);
    const [level, mx, mz, lx = 32, lz = 32] = parts;
    const expected = { x: mx * 64 + lx, z: mz * 64 + lz, level };
    for (let attempt = 0; attempt < 4; attempt++) {
        await type(page, command, 700);
        const arrived = await page.waitForFunction(tile => {
            const here = (globalThis as never as Runtime).rs2b0t.reader.worldTile();
            return here?.x === tile.x && here.z === tile.z && here.level === tile.level;
        }, expected, { timeout: 2500 }).then(() => true).catch(() => false);
        if (arrived) {
            return;
        }
        await clearDialogs(page);
    }
    fail(`teleport did not reach ${expected.x},${expected.z},${expected.level}`);
}

async function giveCoins(page: Page, minimum: number): Promise<number> {
    for (let attempt = 0; attempt < 3; attempt++) {
        await type(page, `::give coins ${minimum}`, 700);
        const count = await page.evaluate(() => (globalThis as never as {
            __rs2b0t: { Inventory: { count(name: string): number } };
        }).__rs2b0t.Inventory.count('Coins'));
        if (count >= minimum) {
            return count;
        }
        await clearDialogs(page);
    }
    fail(`could not seed ${minimum} inventory coins`);
}

async function screenshot(run: RunningCase, label: string): Promise<void> {
    const snap = await read(run);
    const runtime = Math.floor(snap.runtimeMs / 1000);
    const elapsed = `${Math.floor(runtime / 60)}m${String(runtime % 60).padStart(2, '0')}s`;
    const name = `${run.id}-${label}-${elapsed}.jpg`;
    await run.page.bringToFront();
    await run.page.evaluate(() => (globalThis as never as Runtime).rs2b0t.setRenderMode('focused'));
    await run.page.waitForTimeout(1200);
    await run.page.screenshot({ path: join(evidenceDir, name), type: 'jpeg', quality: 86 });
    await run.page.evaluate(() => (globalThis as never as Runtime).rs2b0t.setRenderMode('background'));
    run.screenshots.push(name);
    console.log(`[${run.id}] screenshot ${name} status="${snap.status}" tile=${formatTile(snap.tile)}`);
}

async function read(run: RunningCase) {
    const snap = await run.page.evaluate(() => {
        const api = (globalThis as never as Runtime).rs2b0t;
        const ctx = api.runner.ctx;
        return {
            state: api.runner.state,
            status: api.runner.bot?.status ?? '',
            runtimeMs: ctx ? performance.now() - ctx.startedAt : 0,
            log: ctx?.log ?? [],
            tile: api.reader.worldTile(),
            inCombat: api.reader.inCombat(),
            coins: api.reader.inventory()
                .filter(item => item.name?.toLowerCase() === 'coins')
                .reduce((sum, item) => sum + item.count, 0)
        };
    });
    for (const line of snap.log) {
        const key = `${line.time}\0${line.level}\0${line.msg}`;
        if (run.seenLogLines.has(key)) {
            continue;
        }
        run.seenLogLines.add(key);
        run.accumulatedLog.push(line.msg);
        console.log(`[${run.id}] ${line.msg}`);
    }
    return snap;
}

function formatTile(tile: { x: number; z: number; level: number } | null): string {
    return tile ? `${tile.x},${tile.z},${tile.level}` : '?';
}

async function prepare(browser: Browser, spec: CaseSpec, index: number): Promise<RunningCase> {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const user = `cw${spec.id[0]}${suffix}${index}`.slice(0, 12);
    const run: RunningCase = { ...spec, context, page, user, accumulatedLog: [], seenLogLines: new Set(), screenshots: [] };
    page.on('pageerror', error => console.log(`[${spec.id}] pageerror: ${error}`));

    await page.goto(pageUrl(spec));
    await boot(page);
    let firstLogin = false;
    for (let attempt = 0; attempt < 5 && !firstLogin; attempt++) {
        firstLogin = await login(page, user);
        if (!firstLogin) {
            await page.waitForTimeout(2500);
        }
    }
    if (!firstLogin) {
        fail(`${spec.id}: first login failed`);
    }
    await teleport(page, '::tele 0,50,50,20,20');
    await relogin(page, user);
    await type(page, '::~clearinv', 500);
    for (const skill of ['attack', 'strength', 'defence', 'hitpoints']) {
        await type(page, `::setstat ${skill} 35`, 450);
    }
    await clearDialogs(page);
    let seededCoins = 0;
    if (spec.seedCoins) {
        seededCoins = await giveCoins(page, 500);
    }
    await teleport(page, spec.startTele);
    if (spec.seedCoins) {
        await seedNearestBank(page, seededCoins);
    }
    await startFromLibrary(page, 'Combat', 'CowKiller');
    await page.getByRole('button', { name: 'Start' }).click();
    await page.waitForFunction(() => (globalThis as never as Runtime).rs2b0t.runner.state === 'running', undefined, { timeout: 10_000 });
    await page.evaluate(() => (globalThis as never as Runtime).rs2b0t.setRenderMode('background'));
    await page.waitForTimeout(3500);
    await read(run);
    await screenshot(run, '01-start');
    return run;
}

async function seedNearestBank(page: Page, expectedCoins: number): Promise<void> {
    await page.evaluate(() => {
        const abi = (globalThis as never as {
            __rs2b0t: {
                Bank: {
                    openNearest(name: string, op: string): Promise<boolean>;
                    depositInventory(): Promise<void>;
                };
                LoopingBot: new () => { loop(): Promise<void> };
                registerScript(manifest: { name: string; create(): unknown }): unknown;
            };
            rs2b0t: { runner: { start(meta: unknown): void } };
        });
        const { Bank, LoopingBot, registerScript } = abi.__rs2b0t;
        class SeedBankBot extends LoopingBot {
            override async loop(): Promise<void> {
                if (!(await Bank.openNearest('Bank booth', 'Use-quickly'))) {
                    throw new Error('could not open fixture bank');
                }
                await Bank.depositInventory();
            }
        }
        const meta = registerScript({ name: `Cow E2E bank fixture ${Date.now()}`, create: () => new SeedBankBot() });
        abi.rs2b0t.runner.start(meta);
    });
    await page.waitForFunction(expected => {
        const root = globalThis as never as {
            __rs2b0t: { Bank: { count(name: string): number } };
            rs2b0t: { runner: { state: string; stop(): void } };
        };
        if (root.rs2b0t.runner.state === 'crashed') {
            throw new Error('bank fixture crashed');
        }
        if (root.__rs2b0t.Bank.count('Coins') >= expected) {
            root.rs2b0t.runner.stop();
            return true;
        }
        return false;
    }, expectedCoins, { timeout: 20_000 });
    await page.waitForFunction(() => (globalThis as never as Runtime).rs2b0t.runner.state === 'stopped', undefined, { timeout: 5000 });
}

interface CaseEvidence {
    kills: number;
    walked: boolean;
    tollCrossings: number;
    tollTopUps: number;
    bankTrips: number;
    screenshots: string[];
}

const anchors: Record<CaseSpec['id'], { x: number; z: number }> = {
    remote: { x: 3255, z: 3288 },
    toll: { x: 3255, z: 3288 },
    falador: { x: 3033, z: 3306 }
};
const wanted: Record<CaseSpec['id'], RegExp[]> = {
    remote: [/^fighting$/i, /^looting /i],
    toll: [/^fighting$/i, /^periodic bank run$/i],
    falador: [/^fighting$/i, /^periodic bank run$/i]
};

async function exercise(run: RunningCase): Promise<CaseEvidence> {
    console.log(`[${run.id}] soaking for ${minutes.toFixed(2)} minutes`);
    const anchor = anchors[run.id];
    while (true) {
        await run.page.waitForTimeout(5000);
        const snap = await read(run);
        if (snap.state === 'crashed') {
            await screenshot(run, 'crashed');
            fail(`${run.id}: CowKiller crashed`);
        }
        if (snap.tile
            && Math.max(Math.abs(snap.tile.x - anchor.x), Math.abs(snap.tile.z - anchor.z)) <= 20
            && run.accumulatedLog.some(line => /Cow killed/.test(line))) {
            await screenshot(run, '02-arrived');
            break;
        }
    }

    const minimumMs = minutes * 60_000;
    while (true) {
        await run.page.waitForTimeout(10_000);
        const snap = await read(run);
        if (snap.state === 'crashed') {
            fail(`${run.id}: crashed during the soak`);
        }
        console.log(`[${run.id}] runtime ${(snap.runtimeMs / 60_000).toFixed(2)} minutes`);
        if (snap.runtimeMs >= minimumMs) {
            break;
        }
    }
    await screenshot(run, '03-runtime');

    const captured = new Set<number>();
    const actionDeadline = Date.now() + 4 * 60_000;
    while (Date.now() < actionDeadline && captured.size < wanted[run.id].length) {
        await run.page.waitForTimeout(1000);
        const snap = await read(run);
        if (snap.state === 'crashed') {
            fail(`${run.id}: crashed while capturing action evidence`);
        }
        const patterns = wanted[run.id];
        for (let i = 0; i < patterns.length; i++) {
            if (!captured.has(i) && patterns[i].test(snap.status)) {
                captured.add(i);
                await screenshot(run, `0${4 + i}-${i === 0 ? 'combat' : run.id === 'remote' ? 'loot' : 'banking'}`);
            }
        }
    }
    while (run.screenshots.length < 4) {
        await run.page.waitForTimeout(5000);
        await screenshot(run, `0${run.screenshots.length + 1}-extra`);
    }

    return {
        kills: run.accumulatedLog.filter(line => /Cow killed/.test(line)).length,
        walked: run.accumulatedLog.some(line => /web-walking to the hunting anchor/.test(line)),
        tollCrossings: run.accumulatedLog.filter(line => /Al Kharid toll gate: crossed/.test(line)).length,
        tollTopUps: run.accumulatedLog.filter(line => /Al Kharid toll float ready: 20 coins/.test(line)).length,
        bankTrips: run.accumulatedLog.filter(line => /periodic bank: completed/.test(line)).length,
        screenshots: run.screenshots
    };
}

function validate(id: CaseSpec['id'], result: CaseEvidence): void {
    if (id === 'remote' && (result.kills < 2 || !result.walked)) {
        fail(`remote case incomplete: ${JSON.stringify(result)}`);
    }
    if (id === 'toll' && (result.kills < 2 || result.tollCrossings < 2 || result.tollTopUps < 2 || result.bankTrips < 1)) {
        fail(`toll case incomplete: ${JSON.stringify(result)}`);
    }
    if (id === 'falador' && (result.kills < 2 || !result.walked || result.bankTrips < 1)) {
        fail(`Falador case incomplete: ${JSON.stringify(result)}`);
    }
}

const browser = await launchBrowser();
const evidence: Partial<Record<CaseSpec['id'], CaseEvidence>> = {};
try {
    for (let index = 0; index < specs.length; index++) {
        const run = await prepare(browser, specs[index], index);
        try {
            const result = await exercise(run);
            validate(run.id, result);
            evidence[run.id] = result;
            console.log(`[${run.id}] PASS ${JSON.stringify(result)}`);
        } finally {
            await run.page.evaluate(() => (globalThis as never as Runtime).rs2b0t.runner.state === 'running'
                && (globalThis as never as { rs2b0t: { runner: { stop(): void } } }).rs2b0t.runner.stop()).catch(() => {});
            await run.context.close().catch(() => {});
        }
    }
    console.log(JSON.stringify(evidence, null, 2));
    console.log(`PASS: ${specs.map(spec => spec.id).join(', ')} exceeded ten minutes with screenshot evidence`);
} finally {
    await browser.close();
}
