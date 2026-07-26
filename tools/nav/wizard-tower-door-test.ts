import fs from 'node:fs';

import { boot, bringUpOffIsland, fail, launchBrowser, login, parseArgs, type } from '../lib/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8890', minutes: 6 });
const username = `wiz${Date.now().toString(36).slice(-7)}`;
const nodeId = Number(process.env.TEST_NODE_ID ?? '10');
const reverse = rest.includes('--reverse');
const target = reverse ? { x: 3106, z: 3161, level: 0 } : { x: 2845, z: 3430, level: 0 };
const startTile = reverse ? { x: 3108, z: 3162, level: 0 } : { x: 3106, z: 3161, level: 0 };
const arriveRadius = reverse ? 0 : 3;
const tele = `::tele 0,48,49,${startTile.x & 63},${startTile.z & 63}`;
const shotPrefix = reverse ? 'reverse' : 'outbound';
const screenshotDir = 'out/wizard-tower-test';
fs.mkdirSync(screenshotDir, { recursive: true });

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(s: unknown): void; ctx: { log: { msg: string }[] } | null };
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            locs(): { id: number; name: string | null; ops: (string | null)[]; tile: { x: number; z: number; level: number }; distance: number }[];
        };
        registry: { get(n: string): unknown };
    };
};

const browser = await launchBrowser();
try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 920 } });
    page.on('pageerror', error => console.log(`pageerror: ${error}`));
    await page.goto(`${base}/bot.html?nodeid=${nodeId}&WalkTo.customTile=${target.x},${target.z},${target.level}&WalkTo.arriveRadius=${arriveRadius}`);
    await boot(page);
    let loggedIn = false;
    for (let attempt = 0; attempt < 6 && !loggedIn; attempt++) {
        loggedIn = await login(page, username);
        if (!loggedIn) await page.waitForTimeout(3000);
    }
    if (!loggedIn) fail('initial login failed');
    await bringUpOffIsland(page, { user: username });
    await type(page, tele, 2500);

    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
    const doorSnapshot = () => page.evaluate(() => {
        const r = (globalThis as never as R).rs2b0t.reader;
        return r.locs()
            .filter(loc => loc.name === 'Door' && loc.distance <= 8)
            .map(loc => `${loc.id}@${loc.tile.x},${loc.tile.z}[${loc.ops.filter(Boolean).join('/')}]`)
            .sort();
    });

    const start = await tile();
    if (!start || start.x !== startTile.x || start.z !== startTile.z || start.level !== 0) {
        fail(`teleport missed: ${JSON.stringify(start)}`);
    }
    console.log(`start=(${start.x},${start.z},${start.level}) doors=${(await doorSnapshot()).join(' ')}`);
    await page.screenshot({ path: `${screenshotDir}/${shotPrefix}-01-start-closed.png` });

    await page.evaluate(() => {
        const r = (globalThis as never as R).rs2b0t;
        r.runner.start(r.registry.get('WalkTo'));
    });
    console.log(`started ${reverse ? 'reverse diagonal-door route' : 'exact issue route'} -> (${target.x},${target.z},${target.level})`);

    const startedAt = Date.now();
    const deadline = startedAt + minutes * 60_000;
    let seen = 0;
    let lastProgress = 0;
    let crossedDiagonal = false;
    let reachedDestination = false;
    const shots = [15_000, 60_000, 5 * 60_000, 10 * 60_000];
    const taken = new Set<number>();

    while (Date.now() < deadline) {
        await page.waitForTimeout(2000);
        const elapsed = Date.now() - startedAt;
        const lines = await page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(line => line.msg));
        for (const line of lines.slice(seen)) console.log(`  ${line}`);
        seen = lines.length;
        const current = await tile();
        crossedDiagonal ||= !!current && (current.x > 3107 || current.z >= 3165);
        reachedDestination = !!current && current.level === target.level && Math.max(Math.abs(current.x - target.x), Math.abs(current.z - target.z)) <= arriveRadius;

        if (elapsed - lastProgress >= 10_000) {
            lastProgress = elapsed;
            console.log(`  t=${Math.floor(elapsed / 1000)}s tile=(${current?.x},${current?.z},${current?.level}) doors=${(await doorSnapshot()).join(' ')}`);
        }
        for (const shotAt of shots) {
            if (elapsed >= shotAt && !taken.has(shotAt)) {
                taken.add(shotAt);
                await page.screenshot({ path: `${screenshotDir}/${shotPrefix}-${String(Math.round(shotAt / 1000)).padStart(3, '0')}s.png` });
            }
        }
        if (reachedDestination || (await page.evaluate(() => (globalThis as never as R).rs2b0t.runner.state)) !== 'running') break;
    }

    const final = await tile();
    await page.screenshot({ path: `${screenshotDir}/${shotPrefix}-99-final.png` });
    console.log(`final=(${final?.x},${final?.z},${final?.level}) elapsed=${Math.round((Date.now() - startedAt) / 1000)}s crossedDiagonal=${crossedDiagonal} reachedDestination=${reachedDestination}`);
    if (!crossedDiagonal && !reverse) fail('did not cross the Wizard Tower diagonal door');
    if (reverse && !reachedDestination) fail('did not cross the Wizard Tower diagonal door in reverse');
    if (!reachedDestination && minutes >= 10) fail('did not finish the exact issue route');
} finally {
    await browser.close();
}
