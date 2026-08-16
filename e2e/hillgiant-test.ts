// Live HillGiant proof: public Edgeville trapdoor into the pit, no brass key.

//   bun e2e/hillgiant-test.ts [http://localhost:8888]
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, positionalArgs, setSettings } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const user = args[1] ?? `hgi${Date.now().toString(36).slice(-5)}`;
const START = { x: 3094, z: 3493 }; // Edgeville bank

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number; contains(name: string): boolean; used(): number };
        Equipment: { contains(name: string): boolean };
        Skills: { level(name: string): number };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
    rs2b0t: { runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null }; registry: { get(name: string): unknown } };
}

const tile = () => page.evaluate(() => (globalThis as never as Api).__rs2b0t.reader.worldTile());
const dump = async (label: string) => {
    const log = await page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-12).map(l => l.msg));
    console.log(`--- ${label} ---`);
    for (const l of log) console.log(`  ${l}`);
};

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
try {
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) fail('login failed');
    await bringUpOffIsland(page, { user });
    console.log(`ingame as ${user}`);

    for (const stat of ['attack', 'strength', 'defence', 'hitpoints']) {
        await cheatQuiet(page, `setstat ${stat} 70`, 900);
    }
    await cheatQuiet(page, `tele 0,${START.x >> 6},${START.z >> 6},${START.x & 63},${START.z & 63}`, 3000);
    await cheatQuiet(page, 'give trout 12', 1500);
    await cheatQuiet(page, 'give bronze_scimitar 1', 1500);

    const seeded = await page.evaluate(() => {
        const api = (globalThis as never as Api).__rs2b0t;
        return { food: api.Inventory.count('Trout'), key: api.Inventory.contains('Brass key'), hp: api.Skills.level('hitpoints') };
    });
    if (seeded.food < 1) fail('seeding food failed');
    if (seeded.key) fail('expected to start WITHOUT a brass key');
    console.log(`seeded: ${seeded.food} trout, hp ${seeded.hp}, no brass key`);

    await setSettings(page, 'HillGiant', { weapon: 'Bronze scimitar' });
    if (await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Equipment.contains('Bronze scimitar'))) {
        fail('expected the scimitar to start unequipped');
    }
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('HillGiant');
        if (!meta) throw new Error('HillGiant is not registered');
        g.rs2b0t.runner.start(meta);
    });
    console.log('HillGiant started');

    const wielded = await page
        .waitForFunction(() => (globalThis as never as Api).__rs2b0t.Equipment.contains('Bronze scimitar'), undefined, { timeout: 60_000 })
        .then(() => true).catch(() => false);
    if (!wielded) fail('never wielded the Bronze scimitar sitting in the pack');
    console.log('PASS 0/2 — wielded the Bronze scimitar from the pack');

    const inPit = await page
        .waitForFunction(() => {
            const t = (globalThis as never as Api).__rs2b0t.reader.worldTile();
            return t !== null && t.z > 9800 && t.z < 9855 && t.x > 3095 && t.x < 3130;
        }, undefined, { timeout: 240_000 })
        .then(() => true).catch(() => false);
    await dump('after entry leg');
    if (!inPit) fail('never reached the giant pit through the public Edgeville trapdoor');
    const usedHut = await page.evaluate(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).some(l => /unlocked the hut door|Brass key/i.test(l.msg)));
    if (usedHut) fail('still used the brass-key hut route');
    console.log(`PASS 1/2 — entered the pit without a brass key at ${JSON.stringify(await tile())}`);

    const fought = await page
        .waitForFunction(() => ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).some(l => /attacking Giant|looted/i.test(l.msg)), undefined, { timeout: 180_000 })
        .then(() => true).catch(() => false);
    await dump('after combat leg');
    if (!fought) fail('never engaged a Giant in the pit');

    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));
    console.log('PASS 2/2 — HillGiant entered via the public trapdoor and fought in the pit');
} finally {
    await browser.close();
}
