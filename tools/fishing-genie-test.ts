import { boot, bringUpOffIsland, fail, launchBrowser, login, parseArgs, startFromLibrary, type, type Rs2b0t } from './lib/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 1.25 });
const username = `fg${Date.now().toString(36).slice(-8)}`;
const FISH_TELE = '::tele 0,51,49,3,12';
const nodeId = process.env.TEST_NODE_ID ?? '10';

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', error => console.log(`pageerror: ${error}`));
    page.on('console', message => {
        if (message.type() === 'error' || /crc|response|error/i.test(message.text())) console.log(`browser ${message.type()}: ${message.text()}`);
    });

    const logs = () => page.evaluate(() => ((globalThis as never as Rs2b0t).rs2b0t.runner.ctx?.log ?? []).map(line => line.msg));
    const rawCount = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().filter(item => (item.name ?? '').toLowerCase().startsWith('raw ')).length);
    const tile = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    const geniePresent = () => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.npcs().some(npc => npc.name === 'Genie'));

    await page.goto(`${base}/bot.html?nodeid=${nodeId}&Fisher.location=None&Global.lampSkill=fishing`);
    await boot(page);
    if (!(await login(page, username))) {
        const detail = await page.evaluate(() => {
            const client = (globalThis as never as Rs2b0t).rs2b0t.client;
            const internals = client as never as { loginMes1?: string; loginMes2?: string };
            return `message=${internals.loginMes1 ?? ''} ${internals.loginMes2 ?? ''}, ingame=${client.ingame}, scene=${client.sceneState}`;
        });
        fail(`login failed (${detail})`);
    }
    await bringUpOffIsland(page, { user: username });
    await type(page, '::give net');
    await type(page, '::advancestat fishing 40');
    await type(page, FISH_TELE);

    await startFromLibrary(page, 'Fishing', 'Fisher');
    await page.getByRole('button', { name: 'Start' }).click();
    const fishing = await page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.reader.inventory().some(item => (item.name ?? '').toLowerCase().startsWith('raw ')), undefined, { timeout: 60_000 }).then(() => true).catch(() => false);
    if (!fishing) {
        const detail = await page.evaluate(() => {
            const bot = (globalThis as never as Rs2b0t).rs2b0t;
            return {
                state: bot.runner.state,
                tile: bot.reader.worldTile(),
                inventory: bot.reader.inventory().map(item => item.name),
                spots: bot.reader.npcs().filter(npc => npc.name === 'Fishing spot').map(npc => ({ distance: npc.distance, ops: npc.ops, tile: npc.tile })),
                log: (bot.runner.ctx?.log ?? []).map(line => line.msg)
            };
        });
        await page.screenshot({ path: 'out/fishing-genie-test.png' });
        fail(`Fisher never caught a fish: ${JSON.stringify(detail)}`);
    }

    const anchor = await tile();
    if (!anchor) fail('missing fishing tile');
    console.log(`Fisher active at ${anchor.x},${anchor.z}; spawning a targeted Genie`);

    await type(page, '::~macro_event 2', 300);
    await page.waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.reader.npcs().some(npc => npc.name === 'Genie'), undefined, { timeout: 10_000 });

    const spawnedAt = Date.now();
    const deadline = spawnedAt + Math.max(65_000, minutes * 60_000);
    let lastLogged = 0;
    let clearedRaw = -1;
    let resumed = false;

    while (Date.now() < deadline) {
        await page.waitForTimeout(1000);
        const currentLogs = await logs();
        for (const line of currentLogs.slice(lastLogged)) console.log(`  [bot] ${line}`);
        lastLogged = currentLogs.length;

        const here = await tile();
        if (!here || here.level !== anchor.level || Math.max(Math.abs(here.x - anchor.x), Math.abs(here.z - anchor.z)) > 20) {
            await page.screenshot({ path: 'out/fishing-genie-test.png' });
            fail(`Genie teleported Fisher away: ${here ? `${here.x},${here.z},${here.level}` : 'no tile'}`);
        }
        if ((await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.runner.state)) === 'crashed') fail('Fisher crashed');

        const cleared = currentLogs.some(line => line.includes('random event: genie cleared')) && !(await geniePresent());
        if (cleared && clearedRaw < 0) clearedRaw = await rawCount();
        if (clearedRaw >= 0 && (await rawCount()) > clearedRaw) resumed = true;
    }

    const finalLogs = await logs();
    if (!finalLogs.some(line => line.includes('random event: genie — talking through it'))) fail('Fisher never yielded to the Genie handler');
    if (!finalLogs.some(line => line.includes('random event: genie cleared'))) fail('Genie dialogue never cleared');
    if (!finalLogs.some(line => /rubbed lamp \(\+xp fishing\)/i.test(line))) fail('Genie lamp was not claimed and used');
    if (!resumed) fail('Fisher did not resume catching fish after the Genie');

    await page.screenshot({ path: 'out/fishing-genie-test.png' });
    console.log(`PASS: Genie handled, no teleport, fishing resumed (${Math.round((Date.now() - spawnedAt) / 1000)}s observed)`);
} finally {
    await browser.close();
}
