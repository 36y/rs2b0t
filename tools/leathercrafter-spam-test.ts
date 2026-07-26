import fs from 'node:fs';

import { boot, bringUpOffIsland, fail, launchBrowser, login, parseArgs, type } from './lib/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8890' });
const nodeId = Number(process.env.TEST_NODE_ID ?? '10');
// engine2 currently drains at most five USER_EVENT packets per server tick.
const minBurst = Number(process.env.MIN_BURST ?? '5');
const username = `hl${Date.now().toString(36).slice(-7)}`;
const screenshot = 'out/leathercrafter-spam.jpg';

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        host: { tickCount: number };
        runner: { state: string; start(s: unknown): void; ctx: { log: { msg: string }[] } | null };
        reader: {
            inventory(): { id: number; name: string | null; count: number }[];
            worldTile(): { x: number; z: number; level: number } | null;
        };
        registry: { get(n: string): unknown };
        actions?: { continueDialog?: () => boolean };
    };
};

type Sample = { tick: number; leather: number; bodies: number };

const browser = await launchBrowser();
try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 920 } });
    page.on('pageerror', error => console.log(`pageerror: ${error}`));
    await page.goto(`${base}/bot.html?nodeid=${nodeId}&LeatherCrafter.leatherType=Hard%20leather&LeatherCrafter.threadPerTrip=100`);
    await boot(page);

    let loggedIn = false;
    for (let attempt = 0; attempt < 6 && !loggedIn; attempt++) {
        loggedIn = await login(page, username);
        if (!loggedIn) await page.waitForTimeout(3000);
    }
    if (!loggedIn) fail('initial login failed');
    await bringUpOffIsland(page, { user: username });

    await type(page, '::give needle');
    await type(page, '::give thread 100');
    // Hard leather is not stackable, so givemany fills the remaining 26 slots.
    await type(page, '::givemany hard_leather');
    await type(page, '::advancestat crafting 99');
    const clearDialogs = () =>
        page.evaluate(async () => {
            const actions = (globalThis as never as R).rs2b0t.actions;
            for (let i = 0; i < 30; i++) {
                actions?.continueDialog?.();
                await new Promise(resolve => setTimeout(resolve, 150));
            }
        });
    await clearDialogs();
    let positioned = false;
    for (let attempt = 0; attempt < 4 && !positioned; attempt++) {
        await type(page, '::tele 0,51,49,5,31', 2000);
        const tile = await page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
        positioned = !!tile && Math.max(Math.abs(tile.x - 3269), Math.abs(tile.z - 3167)) <= 4;
        if (!positioned) await clearDialogs();
    }
    if (!positioned) fail('could not teleport to Al Kharid bank');

    const read = () =>
        page.evaluate((): Sample => {
            const r = (globalThis as never as R).rs2b0t;
            const count = (name: string): number =>
                r.reader
                    .inventory()
                    .filter(item => item.name?.toLowerCase() === name)
                    .reduce((sum, item) => sum + item.count, 0);
            return { tick: r.host.tickCount, leather: count('hard leather'), bodies: count('hardleather body') };
        });

    await page.evaluate(() => {
        const r = (globalThis as never as R).rs2b0t;
        r.runner.start(r.registry.get('LeatherCrafter'));
    });
    console.log('started LeatherCrafter: Hard leather');

    let stocked = false;
    for (let attempt = 0; attempt < 15 && !stocked; attempt++) {
        await page.waitForTimeout(2000);
        const current = await read();
        stocked = current.leather >= 10;
        if (attempt % 3 === 0) {
            const debug = await page.evaluate(() => {
                const r = (globalThis as never as R).rs2b0t;
                return {
                    tile: r.reader.worldTile(),
                    inventory: r.reader.inventory().map(item => `${item.name}x${item.count}`),
                    logs: (r.runner.ctx?.log ?? []).slice(-5).map(line => line.msg)
                };
            });
            console.log(`  setup=${JSON.stringify(debug)}`);
        }
    }
    if (!stocked) {
        await page.screenshot({ path: screenshot, type: 'jpeg', quality: 86 });
        fail('did not prepare a hard-leather crafting pack');
    }

    const samples: Sample[] = [await read()];
    const deadline = Date.now() + 25_000;
    while (Date.now() < deadline) {
        await page.waitForTimeout(40);
        const current = await read();
        const previous = samples[samples.length - 1];
        if (current.tick !== previous.tick || current.leather !== previous.leather || current.bodies !== previous.bodies) {
            samples.push(current);
            if (current.leather !== previous.leather || current.bodies !== previous.bodies) {
                console.log(`  tick=${current.tick} leather=${current.leather} bodies=${current.bodies} delta=${previous.leather - current.leather}`);
            }
        }
        if (current.bodies - samples[0].bodies >= 12 || current.leather === 0) break;
    }

    const craftChanges = samples
        .slice(1)
        .map((sample, i) => ({
            tick: sample.tick,
            leatherDrop: samples[i].leather - sample.leather,
            bodyGain: sample.bodies - samples[i].bodies
        }))
        .filter(change => change.leatherDrop > 0 || change.bodyGain > 0);
    const maxBurst = Math.max(0, ...craftChanges.map(change => change.leatherDrop));
    const totalCrafted = samples[0].leather - samples[samples.length - 1].leather;
    fs.mkdirSync('out', { recursive: true });
    await page.screenshot({ path: screenshot, type: 'jpeg', quality: 86 });
    console.log(`maxBurst=${maxBurst} totalCrafted=${totalCrafted} changes=${JSON.stringify(craftChanges)}`);
    if (maxBurst < minBurst) fail(`largest same-tick hard-leather burst was ${maxBurst}; expected at least ${minBurst}`);
    console.log(`PASS: crafted ${maxBurst} hardleather bodies in one server tick`);
} finally {
    await browser.close();
}
