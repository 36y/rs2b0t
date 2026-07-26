import type { Page } from 'playwright-core';
import { boot, fail, launchBrowser, login, parseArgs, startFromLibrary, type Rs2b0t } from './lib/harness.js';

const { base, rest } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8890' });
const accountStem = (rest[0] ?? `af${Date.now().toString(36).slice(-7)}`).slice(0, 10);
const COW_TELE = '::tele 0,50,51,55,6';
const VARROCK_START_TELE = '::tele 0,51,53,0,35';
const CUSTOM_ANCHOR = { x: 3273, z: 3427, level: 0 };

type Runtime = Rs2b0t & {
    rs2b0t: Rs2b0t['rs2b0t'] & {
        actions?: { continueDialog?: () => boolean };
        runner: Rs2b0t['rs2b0t']['runner'] & { bot: { kills?: number; trips?: number; status?: string } | null };
    };
};

function logs(page: Page): Promise<string[]> {
    return page.evaluate(() => ((globalThis as never as Runtime).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
}

function tile(page: Page) {
    return page.evaluate(() => (globalThis as never as Runtime).rs2b0t.reader.worldTile());
}

function combatXp(page: Page): Promise<number> {
    return page.evaluate(() => {
        const reader = (globalThis as never as Runtime).rs2b0t.reader;
        return [0, 1, 2, 3].reduce((sum, index) => sum + reader.stat(index).xp, 0);
    });
}

async function cheat(page: Page, command: string, waitMs = 1400): Promise<void> {
    await page.evaluate(value => {
        const client = (globalThis as never as Runtime).rs2b0t.client;
        const input = value.replace(/^::/, '');
        client.out?.p1Enc(224); // CLIENT_CHEAT
        client.out?.p1(input.length + 1);
        client.out?.pjstr(input);
    }, command);
    await page.waitForTimeout(waitMs);
}

async function clearDialogs(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const actions = (globalThis as never as Runtime).rs2b0t.actions;
        for (let i = 0; i < 30; i++) {
            actions?.continueDialog?.();
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    });
}

async function prepare(page: Page, user: string, url: string): Promise<void> {
    page.on('pageerror', error => console.log(`pageerror: ${error}`));
    await page.goto(url);
    await boot(page);
    if (!(await login(page, user))) fail(`${user}: first login failed`);
    await cheat(page, '::~maxme');
    await clearDialogs(page);
}

function paramRow(page: Page, label: string) {
    return page.locator('.rs2b0t-param-row', {
        has: page.locator('.rs2b0t-param-label', { hasText: label })
    });
}

async function openParams(page: Page): Promise<void> {
    await page.getByRole('button', { name: /Edit parameters/ }).click();
    await page.waitForSelector('.rs2b0t-params-body', { state: 'visible', timeout: 5000 });
}

async function closeParams(page: Page): Promise<void> {
    const modal = page.locator('.rs2b0t-modal', { has: page.locator('.rs2b0t-params-body') });
    await modal.locator('.rs2b0t-modal-header > button').click();
    await page.waitForSelector('.rs2b0t-params-body', { state: 'hidden', timeout: 5000 });
}

async function waitForCombatProgress(page: Page, xpAtStart: number, timeoutMs: number): Promise<{ engaged: boolean; gained: number }> {
    const deadline = Date.now() + timeoutMs;
    let engaged = false;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const runtime = (globalThis as never as Runtime).rs2b0t;
            return { state: runtime.runner.state, inCombat: runtime.reader.inCombat() };
        });
        if (snap.state === 'crashed') fail(`AutoFighter crashed: ${(await logs(page)).slice(-8).join(' | ')}`);
        engaged ||= snap.inCombat;
        const gained = (await combatXp(page)) - xpAtStart;
        if (gained > 0) return { engaged, gained };
        await page.waitForTimeout(500);
    }
    return { engaged, gained: (await combatXp(page)) - xpAtStart };
}

const browser = await launchBrowser();
try {
    const startContext = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    const startPage = await startContext.newPage();
    const startUser = `${accountStem}a`.slice(0, 12);
    const startUrl = `${base}/bot.html?AutoFighter.foodWithdraw=0&AutoFighter.solveClues=false&AutoFighter.banking=None&AutoFighter.loot=Cow%20hide`;
    await prepare(startPage, startUser, startUrl);
    await cheat(startPage, COW_TELE);
    await startFromLibrary(startPage, 'Combat', 'AutoFighter');
    await openParams(startPage);

    const targetRow = paramRow(startPage, 'Target NPC name');
    const targetInput = targetRow.locator('input[type="text"]');
    if ((await targetInput.count()) !== 1 || (await targetRow.locator('select').count()) !== 0) {
        fail('Target NPC name is not a freeform text field');
    }
    await targetInput.fill('Cow');
    await targetInput.press('Tab');
    await paramRow(startPage, 'Killing spot').locator('select').selectOption('Start position');
    if ((await paramRow(startPage, 'Killing coordinates').count()) !== 0) {
        fail('custom coordinates are visible for Start position');
    }
    await closeParams(startPage);

    const expectedStart = await tile(startPage);
    if (!expectedStart) fail('no start tile before the start-position test');
    const startXp = await combatXp(startPage);
    await startPage.getByRole('button', { name: 'Start' }).click();
    await startPage.waitForFunction(() => ((globalThis as never as Runtime).rs2b0t.runner.ctx?.log ?? []).some(line => line.msg.startsWith('AutoFighter starting')), undefined, { timeout: 15000 });
    const startLog = (await logs(startPage)).find(line => line.startsWith('AutoFighter starting')) ?? '';
    const expectedAnchor = `(${expectedStart.x}, ${expectedStart.z}, ${expectedStart.level})`;
    if (!startLog.includes("'Cow'") || !startLog.includes(`Start position ${expectedAnchor}`)) {
        fail(`start-position/freeform settings not applied: "${startLog}"`);
    }
    const cowFight = await waitForCombatProgress(startPage, startXp, 90_000);
    if (cowFight.gained <= 0) fail(`freeform Cow target was never fought: ${startLog}`);
    console.log(`freeform target + start position: Cow fought from ${expectedAnchor} (xp +${cowFight.gained})`);
    await startPage.getByRole('button', { name: 'Stop' }).click();
    await startContext.close();

    const customContext = await browser.newContext({ viewport: { width: 1280, height: 760 } });
    const customPage = await customContext.newPage();
    const customUser = `${accountStem}b`.slice(0, 12);
    const params = new URLSearchParams({
        'AutoFighter.target': 'Guard',
        'AutoFighter.spot': 'Custom coordinates',
        'AutoFighter.coordinates': `${CUSTOM_ANCHOR.x},${CUSTOM_ANCHOR.z},${CUSTOM_ANCHOR.level}`,
        'AutoFighter.leashRadius': '8',
        'AutoFighter.foodWithdraw': '0',
        'AutoFighter.solveClues': 'false',
        'AutoFighter.banking': 'Auto',
        'AutoFighter.bankAtLootSlots': '1',
        'AutoFighter.loot': 'Uncut sapphire'
    });
    await prepare(customPage, customUser, `${base}/bot.html?${params}`);
    await cheat(customPage, VARROCK_START_TELE);
    await cheat(customPage, '::give uncut_sapphire');
    await startFromLibrary(customPage, 'Combat', 'AutoFighter');
    await openParams(customPage);

    if ((await paramRow(customPage, 'Target NPC name').locator('input[type="text"]').inputValue()) !== 'Guard') {
        fail('custom run target text did not resolve to Guard');
    }
    if ((await paramRow(customPage, 'Killing spot').locator('select').inputValue()) !== 'Custom coordinates') {
        fail('Custom coordinates mode is not selected');
    }
    const coordinateValues = await paramRow(customPage, 'Killing coordinates').locator('input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value));
    if (coordinateValues.join(',') !== '3273,3427,0') {
        fail(`coordinate editor did not contain 3273,3427,0: ${coordinateValues.join(',')}`);
    }
    if ((await paramRow(customPage, 'Banking').locator('select').inputValue()) !== 'Auto') {
        fail('Miner-style Auto banking is not selected');
    }
    await closeParams(customPage);

    const customStart = await tile(customPage);
    if (!customStart || (customStart.x === CUSTOM_ANCHOR.x && customStart.z === CUSTOM_ANCHOR.z)) {
        fail(`custom run did not start away from its anchor: ${JSON.stringify(customStart)}`);
    }
    const customXp = await combatXp(customPage);
    await customPage.getByRole('button', { name: 'Start' }).click();
    await customPage.waitForFunction(() => ((globalThis as never as Runtime).rs2b0t.runner.ctx?.log ?? []).some(line => line.msg.includes('banking at the')), undefined, { timeout: 120_000 });
    await customPage.waitForFunction(() => {
        const runtime = (globalThis as never as Runtime).rs2b0t;
        const banked = !runtime.reader.inventory().some(item => (item.name ?? '').toLowerCase().includes('uncut sapphire'));
        return banked && (runtime.runner.bot?.trips ?? 0) >= 1;
    }, undefined, { timeout: 120_000 });

    const guardFight = await waitForCombatProgress(customPage, customXp, 120_000);
    if (guardFight.gained <= 0) fail(`Guard was never fought after auto-banking: ${(await logs(customPage)).slice(-12).join(' | ')}`);
    const arrived = await tile(customPage);
    if (!arrived || Math.max(Math.abs(arrived.x - CUSTOM_ANCHOR.x), Math.abs(arrived.z - CUSTOM_ANCHOR.z)) > 14) {
        fail(`bot did not return to custom coordinates after banking: ${JSON.stringify(arrived)}`);
    }

    await customPage.screenshot({ path: 'out/autofighter-running.png' });
    console.log(`custom coordinates + auto bank: sapphire deposited, returned, Guard fought (xp +${guardFight.gained})`);
    console.log('screenshot: out/autofighter-running.png');
    console.log('PASS: AutoFighter freeform targeting, start/custom spots, and auto banking');
    await customContext.close();
} finally {
    await browser.close();
}
