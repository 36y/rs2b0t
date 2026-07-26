import fs from 'node:fs';

import { boot, bringUpOffIsland, fail, launchBrowser, login, parseArgs, type } from '../lib/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8890', minutes: 2 });
const nodeId = Number(process.env.TEST_NODE_ID ?? '10');
const username = `bsm${Date.now().toString(36).slice(-7)}`;
const target = { x: 3222, z: 3218, level: 0 };
const screenshotDir = 'out/basement-escape-test';
fs.mkdirSync(screenshotDir, { recursive: true });

type Tile = { x: number; z: number; level: number };
type Loc = { id: number; name: string | null; ops: (string | null)[]; tile: Tile; distance: number };
type Snapshot = { tile: Tile | null; doors: string[]; closedInnerDoor: boolean; state: string };

type R = {
    rs2b0t: {
        runner: { state: string; start(s: unknown): void; ctx: { log: { msg: string }[] } | null };
        reader: { worldTile(): Tile | null; locs(): Loc[] };
        registry: { get(n: string): unknown };
        actions?: { continueDialog?: () => boolean };
    };
};

const browser = await launchBrowser();
try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 920 } });
    page.on('pageerror', error => console.log(`pageerror: ${error}`));
    await page.goto(`${base}/bot.html?nodeid=${nodeId}&WalkTo.customTile=${target.x},${target.z},${target.level}&WalkTo.arriveRadius=0`);
    await boot(page);

    let loggedIn = false;
    for (let attempt = 0; attempt < 6 && !loggedIn; attempt++) {
        loggedIn = await login(page, username);
        if (!loggedIn) await page.waitForTimeout(3000);
    }
    if (!loggedIn) fail('initial login failed');
    await bringUpOffIsland(page, { user: username });

    const clearDialogs = () =>
        page.evaluate(async () => {
            const actions = (globalThis as never as R).rs2b0t.actions;
            for (let i = 0; i < 20; i++) {
                actions?.continueDialog?.();
                await new Promise(resolve => setTimeout(resolve, 150));
            }
        });
    const read = () =>
        page.evaluate((): Snapshot => {
            const r = (globalThis as never as R).rs2b0t;
            const locs = r.reader.locs();
            const doors = locs
                .filter(loc => /door/i.test(loc.name ?? '') && loc.distance <= 12)
                .map(loc => `${loc.name}#${loc.id}@${loc.tile.x},${loc.tile.z}[${loc.ops.filter(Boolean).join('/')}]`)
                .sort();
            return {
                tile: r.reader.worldTile(),
                doors,
                closedInnerDoor: locs.some(loc => loc.name === 'Large door' && loc.tile.x === 3213 && loc.tile.z === 3220 && loc.ops.some(op => op !== null && /^open/i.test(op))),
                state: r.runner.state
            };
        });

    let start: Tile | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type(page, '::tele 0,50,150,12,15', 2000);
        start = (await read()).tile;
        if (start && Math.max(Math.abs(start.x - 3212), Math.abs(start.z - 9615)) <= 2) break;
        await clearDialogs();
    }
    if (!start || start.z < 9000) fail(`basement teleport missed: ${JSON.stringify(start)}`);
    console.log(`start=(${start.x},${start.z},${start.level})`);
    await page.screenshot({ path: `${screenshotDir}/01-basement-start.jpg`, type: 'jpeg', quality: 86 });

    await page.evaluate(() => {
        const r = (globalThis as never as R).rs2b0t;
        r.runner.start(r.registry.get('WalkTo'));
    });
    console.log(`started exact issue route -> (${target.x},${target.z},${target.level})`);

    const startedAt = Date.now();
    const deadline = startedAt + minutes * 60_000;
    let seenLogs = 0;
    let lastState = '';
    let reachedSurface = false;
    let sawClosedInnerDoor = false;
    let crossedInnerDoor = false;
    let reachedDestination = false;
    let capturedClosed = false;
    let capturedCrossed = false;

    while (Date.now() < deadline) {
        await page.waitForTimeout(1000);
        const snap = await read();
        const elapsed = Math.round((Date.now() - startedAt) / 1000);
        const lines = await page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(line => line.msg));
        for (const line of lines.slice(seenLogs)) console.log(`  ${line}`);
        seenLogs = lines.length;

        reachedSurface ||= !!snap.tile && snap.tile.z < 4000;
        sawClosedInnerDoor ||= snap.closedInnerDoor;
        crossedInnerDoor ||= !!snap.tile && snap.tile.level === 0 && snap.tile.x >= 3214 && snap.tile.z >= 3217 && snap.tile.z <= 3222;
        reachedDestination = !!snap.tile && snap.tile.level === 0 && Math.max(Math.abs(snap.tile.x - target.x), Math.abs(snap.tile.z - target.z)) <= 1;

        const state = `${snap.tile?.x},${snap.tile?.z},${snap.tile?.level}|${snap.doors.join(' ')}`;
        if (state !== lastState) {
            lastState = state;
            console.log(`  t=${elapsed}s tile=(${snap.tile?.x},${snap.tile?.z},${snap.tile?.level}) doors=${snap.doors.join(' ')}`);
        }
        if (snap.closedInnerDoor && !capturedClosed) {
            capturedClosed = true;
            await page.screenshot({ path: `${screenshotDir}/02-surface-closed-door.jpg`, type: 'jpeg', quality: 86 });
        }
        if (crossedInnerDoor && !capturedCrossed) {
            capturedCrossed = true;
            await page.screenshot({ path: `${screenshotDir}/03-crossed-inner-door.jpg`, type: 'jpeg', quality: 86 });
        }
        if (reachedDestination || snap.state !== 'running') break;
    }

    const final = await read();
    await page.screenshot({ path: `${screenshotDir}/04-arrived.jpg`, type: 'jpeg', quality: 86 });
    console.log(`final=${JSON.stringify(final.tile)} surface=${reachedSurface} closed=${sawClosedInnerDoor} crossed=${crossedInnerDoor} arrived=${reachedDestination}`);
    if (!reachedSurface) fail('did not climb out of the basement');
    if (!sawClosedInnerDoor) fail('did not test the inner Large door while closed');
    if (!crossedInnerDoor) fail('did not cross the inner Large door');
    if (!reachedDestination) fail('did not reach Lumbridge spawn');
    console.log(`PASS: escaped basement and crossed closed castle doors in ${Math.round((Date.now() - startedAt) / 1000)}s`);
} finally {
    await browser.close();
}
