import { launchBrowser, parseArgs } from './lib/harness.js';
import type { Page } from 'playwright-core';

// Maps the walkable ground around each candidate firemaking bank so the burn
// anchors in Firemaker.ts are picked from the engine's real collision data
// rather than from memory of where these spots "should" be.
const { base } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8891' });
const user = `fp${Date.now().toString(36).slice(-7)}`;

const SPOTS = [
    { name: 'Varrock West', bank: [3185, 3440], noLight: [[3180, 3433, 3190, 3447]] },
    { name: 'Varrock East', bank: [3253, 3420], noLight: [[3250, 3416, 3257, 3427], [3253, 3425, 3253, 3427]] },
    { name: 'Draynor', bank: [3093, 3243], noLight: [[3088, 3240, 3097, 3246]] },
    { name: 'Seers', bank: [2725, 3491], noLight: [[2721, 3487, 2730, 3497], [2724, 3487, 2727, 3489]] }
];

const HALF_X = 32;
const HALF_Z = 16;

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; logout(): void; out: { p1Enc(op: number): void; p1(v: number): void; pjstr(s: string): void } | null; login(u: string, p: string, r: boolean): Promise<void> };
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            toLocal(x: number, z: number): { lx: number; lz: number } | null;
            collisionFlags(lx: number, lz: number): number | null;
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

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto(`${base}/bot.html?nodeid=11`);
    await boot(page);
    if (!(await login(page))) fail('login failed');

    await cheat(page, tele(3200, 3200), 2000);
    await page.evaluate(() => (globalThis as never as R).rs2b0t.client.logout());
    await page.waitForTimeout(2500);
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) {
        backIn = await login(page);
        if (!backIn) await page.waitForTimeout(4000);
    }
    if (!backIn) fail('relogin failed');

    for (const spot of SPOTS) {
        await cheat(page, tele(spot.bank[0], spot.bank[1]), 3000);
        const here = await page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
        if (!here || Math.abs(here.x - spot.bank[0]) > 2) fail(`${spot.name}: teleport landed at ${here?.x},${here?.z}`);

        const grid = await page.evaluate(
            ([cx, cz, hx, hz]) => {
                const rd = (globalThis as never as R).rs2b0t.reader;
                // any active loc on a tile blocks loc_add, so a tile with scenery
                // is walkable but not lightable
                const occupied = new Set(rd.locs().map(l => `${l.tile.x},${l.tile.z}`));
                // PL_WALK_W: can I step west onto this tile? (0x280180)
                const out: { x: number; z: number; west: boolean; solid: boolean; loc: boolean }[] = [];
                for (let z = cz - hz; z <= cz + hz; z++) {
                    for (let x = cx - hx; x <= cx + hx; x++) {
                        const l = rd.toLocal(x, z);
                        const f = l ? rd.collisionFlags(l.lx, l.lz) : null;
                        out.push({ x, z, west: f !== null && (f & 0x280180) === 0, solid: f === null || (f & 0x280100) !== 0, loc: occupied.has(`${x},${z}`) });
                    }
                }
                return out;
            },
            [spot.bank[0], spot.bank[1], HALF_X, HALF_Z]
        );

        const at = new Map(grid.map(g => [`${g.x},${g.z}`, g]));
        const inNoLight = (x: number, z: number) => spot.noLight.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);

        // run length = how many fires a lane starting here yields: the tile itself
        // must be lightable, and each step west must be walkable and lightable
        const lightable = (x: number, z: number) => {
            const g = at.get(`${x},${z}`);
            return !!g && !g.solid && !g.loc && !inNoLight(x, z);
        };
        const runFrom = (x: number, z: number): number => {
            let n = 0;
            for (let i = 0; i < 40; i++) {
                if (!lightable(x - i, z)) break;
                if (i > 0 && !at.get(`${x - i},${z}`)!.west) break;
                n++;
            }
            return n;
        };

        console.log(`\n=== ${spot.name} — bank ${spot.bank[0]},${spot.bank[1]} ===`);
        console.log(`x ${spot.bank[0] - HALF_X}..${spot.bank[0] + HALF_X}, z top ${spot.bank[1] + HALF_Z} -> bottom ${spot.bank[1] - HALF_Z}`);
        for (let z = spot.bank[1] + HALF_Z; z >= spot.bank[1] - HALF_Z; z--) {
            let row = '';
            for (let x = spot.bank[0] - HALF_X; x <= spot.bank[0] + HALF_X; x++) {
                const g = at.get(`${x},${z}`)!;
                if (x === spot.bank[0] && z === spot.bank[1]) row += 'B';
                else if (g.solid) row += '#';
                else if (inNoLight(x, z)) row += 'x';
                else if (g.loc) row += 'o';
                else row += '.';
            }
            console.log(`${String(z).padStart(4)} ${row}`);
        }

        const lanes = grid
            .filter(g => lightable(g.x, g.z))
            .map(g => ({ x: g.x, z: g.z, run: runFrom(g.x, g.z), d: Math.max(Math.abs(g.x - spot.bank[0]), Math.abs(g.z - spot.bank[1])) }))
            .filter(l => l.run >= 6)
            .sort((a, b) => b.run - a.run || a.d - b.d);

        // group by row so I can see how many parallel lanes a plot offers
        const byRow = new Map<number, { x: number; run: number; d: number }>();
        for (const l of lanes) {
            const cur = byRow.get(l.z);
            if (!cur || l.run > cur.run) byRow.set(l.z, { x: l.x, run: l.run, d: l.d });
        }
        const rows = [...byRow.entries()].sort((a, b) => b[1].run - a[1].run || a[1].d - b[1].d).slice(0, 12);
        console.log('  best lane per row (z: startX run distToBank):');
        for (const [z, r] of rows) console.log(`    z=${z}: x=${r.x} run=${r.run} d=${r.d}`);
    }
} finally {
    await browser.close();
}
