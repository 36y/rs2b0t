import { launchBrowser, parseArgs } from './lib/harness.js';
import type { Page } from 'playwright-core';

// Firemaker end-to-end. Two modes:
//   default  — one honest trip: bank 27 logs, burn them, come back, stop
//   --soak N — keeps topping the pack back up so the bot burns continuously,
//              which is what actually exercises lane exhaustion and rescans
// --speed <ms> uses the engine's ::speed cheat (World.TICKRATE is "only exposed
// for condensing time while testing long-running operations"). It compresses
// the 100-200 tick fire lifetime so plot-refill behaviour is testable in
// seconds — it does NOT give a meaningful xp/hr, because the bot's own delays
// stay in wall-clock milliseconds.
const { base, minutes } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8891', minutes: 0 });
// read our own flags off raw argv: parseArgs eats any bare number as `minutes`
const argv = process.argv.slice(2);
const flag = (name: string, dflt: string): string => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const soakMin = Number(flag('soak', '0'));
const speedMs = Number(flag('speed', '0'));
const spot = flag('spot', 'Varrock East');
const logType = flag('logs', 'Logs');
const fmLevel = Number(flag('level', '50'));
const user = `fm${Date.now().toString(36).slice(-7)}`;

const SPOT_BANK: Record<string, [number, number]> = {
    'Varrock East': [3253, 3420],
    'Varrock West': [3185, 3440],
    Draynor: [3093, 3243],
    Seers: [2725, 3491]
};

// --fillplot plants a despawning loc on every tile of a plot so findLane() has
// nothing to return; only Draynor is small enough to carpet in reasonable time
const PLOT: Record<string, [number, number, number, number]> = { Draynor: [3072, 3097, 3247, 3249] };

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; logout(): void; out: { p1Enc(op: number): void; p1(v: number): void; pjstr(s: string): void } | null; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; ctx: { log: { msg: string }[] } | null; bot: Record<string, unknown> | null };
        reader: {
            worldTile(): { x: number; z: number } | null;
            stat(i: number): { name: string; base: number; xp: number };
            skillCount(): number;
            inventory(): { name: string | null }[];
            locs(): { name: string | null; tile: { x: number; z: number } }[];
        };
    };
};

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const boot = (page: Page) => page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });

async function login(page: Page): Promise<boolean> {
    await page.evaluate(u => {
        const c = (globalThis as never as R).rs2b0t.client;
        c.loginUser = u;
        c.loginPass = 'test';
        void c.login(u, 'test', false);
    }, user);
    return page
        .waitForFunction(() => (globalThis as never as R).rs2b0t.client.ingame && (globalThis as never as R).rs2b0t.client.sceneState === 2, undefined, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);
}

async function cheat(page: Page, cmd: string, wait = 1200): Promise<void> {
    const sent = await page.evaluate(c => {
        const cl = (globalThis as never as R).rs2b0t.client;
        if (!cl.ingame || !cl.out) return false;
        cl.out.p1Enc(224);
        cl.out.p1(c.length + 1);
        cl.out.pjstr(c);
        return true;
    }, cmd);
    if (!sent) fail(`cheat '::${cmd}' not sent (not ingame)`);
    await page.waitForTimeout(wait);
}

const tele = (x: number, z: number) => `tele 0,${x >> 6},${z >> 6},${x & 63},${z & 63}`;
const snap = (page: Page, logName: string) =>
    page.evaluate(
        ln => {
            const R2 = (globalThis as never as R).rs2b0t;
            const fmIdx = [...Array(R2.reader.skillCount()).keys()].find(i => R2.reader.stat(i).name === 'firemaking')!;
            const t = R2.reader.worldTile();
            return {
                x: t?.x ?? -1,
                z: t?.z ?? -1,
                xp: R2.reader.stat(fmIdx).xp,
                level: R2.reader.stat(fmIdx).base,
                logs: R2.reader.inventory().filter(i => i.name === ln).length,
                fires: R2.reader.locs().filter(l => l.name === 'Fire').length,
                state: R2.runner.state,
                status: String((R2.runner.bot as { status?: string } | null)?.status ?? ''),
                lit: Number((R2.runner.bot as { fires?: number } | null)?.fires ?? 0),
                trips: Number((R2.runner.bot as { trips?: number } | null)?.trips ?? 0)
            };
        },
        logName
    );

const browser = await launchBrowser();
let page: Page | null = null;
try {
    page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto(`${base}/bot.html?nodeid=11&Firemaker.logType=${encodeURIComponent(logType)}&Firemaker.location=${encodeURIComponent(spot)}`);
    await boot(page);
    if (!(await login(page))) fail('login failed');

    const bank = SPOT_BANK[spot] ?? fail(`unknown spot '${spot}'`);
    await cheat(page, tele(3200, 3200), 2000);
    await page.evaluate(() => (globalThis as never as R).rs2b0t.client.logout());
    await page.waitForTimeout(2500);
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) {
        backIn = await login(page);
        if (!backIn) await page.waitForTimeout(4000);
    }
    if (!backIn) fail('relogin failed');

    await cheat(page, `advancestat firemaking ${fmLevel}`);
    await cheat(page, 'give tinderbox');
    await cheat(page, `givemany ${logType.toLowerCase().replace(/ /g, '_')}`);
    if (argv.includes('--fillplot')) {
        const [x0, x1, z0, z1] = PLOT[spot] ?? fail(`--fillplot has no plot for '${spot}'`);
        for (let z = z0; z <= z1; z++) {
            for (let x = x0; x <= x1; x++) {
                await cheat(page, tele(x, z), 60);
                await cheat(page, 'locadd crate', 60);
            }
        }
        const planted = await page.evaluate(() => (globalThis as never as R).rs2b0t.reader.locs().filter(l => l.name === 'Crate').length);
        console.log(`fillplot: carpeted x${x0}-${x1} z${z0}-${z1}, ${planted} crates visible`);
    }

    // --from x,z drops the bot somewhere else entirely, so the bank leg has to
    // web-walk to the chosen spot before it can do anything
    const from = flag('from', '');
    const [sx, sz] = from ? from.split(',').map(Number) : bank;
    await cheat(page, tele(sx, sz), 3000);
    if (speedMs > 0) await cheat(page, `speed ${speedMs}`, 1000);

    const before = await snap(page, logType);
    console.log(`ready: ${user} at ${before.x},${before.z} fm=${before.level} logs=${before.logs} tickrate=${speedMs || 600}ms`);
    if (before.logs === 0) fail(`no ${logType} in the pack — check the ::givemany obj name`);

    await page.getByRole('button', { name: 'Browse…' }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'visible', timeout: 5000 });
    await page.locator('.rs2b0t-library-card', { hasText: /Firemaker/ }).click();
    await page.waitForSelector('.rs2b0t-modal-backdrop', { state: 'hidden', timeout: 5000 });

    await page.getByRole('button', { name: 'Start' }).click();
    console.log(`started — ${soakMin > 0 ? `${soakMin} min soak` : 'single trip'}, ${logType} at ${spot}`);

    const deadline = Date.now() + (soakMin > 0 ? soakMin : minutes || 6) * 60_000;
    const seenTiles = new Set<string>();
    let lastLog = 0;
    let peakFires = 0;
    while (Date.now() < deadline) {
        await page.waitForTimeout(3000);
        const s = await snap(page, logType);
        seenTiles.add(`${s.x},${s.z}`);
        peakFires = Math.max(peakFires, s.fires);
        const lines = await page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
        for (const line of lines.slice(lastLog)) console.log(`  [bot] ${line}`);
        lastLog = lines.length;
        if (s.state !== 'running') {
            console.log(`runner ${s.state} — fires=${s.lit} xp=${s.xp - before.xp}`);
            break;
        }
        // soak: only restock once the bot has actually given up on the load and
        // headed for the bank, otherwise the pack refills under the burn loop
        // and it never completes a trip
        if (soakMin > 0 && s.logs === 0 && /bank/i.test(s.status)) await cheat(page, `givemany ${logType.toLowerCase().replace(/ /g, '_')}`, 200);
    }

    const shot = flag('shot', '');
    if (shot) {
        await page.screenshot({ path: shot });
        console.log(`screenshot: ${shot}`);
    }

    const after = await snap(page, logType);
    const mins = (Date.now() - (deadline - (soakMin > 0 ? soakMin : minutes || 6) * 60_000)) / 60_000;
    console.log('---');
    console.log(`fires lit:     ${after.lit} over ${after.trips} bank trips`);
    console.log(`firemaking xp: ${after.xp - before.xp} (level ${before.level} -> ${after.level})`);
    console.log(`xp/hr:         ${Math.round(((after.xp - before.xp) / mins) * 60)}  [meaningless unless tickrate=600]`);
    console.log(`distinct tiles stood on: ${seenTiles.size}`);
    console.log(`peak fires in scene:     ${peakFires}`);
    console.log(`ended at ${after.x},${after.z}, runner=${after.state}, status="${after.status}"`);
} finally {
    if (page && speedMs > 0) {
        await cheat(page, 'speed 600', 500).catch(() => {});
    }
    await browser.close();
}
