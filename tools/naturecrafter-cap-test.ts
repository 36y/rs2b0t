// Trade-cap smoke: a runner holding MORE than the 25 cap must offer exactly 25 and keep the rest.
// Both accounts start at the ruins, so it tests the trade only — no shipping.
// Usage: bun tools/naturecrafter-cap-test.ts [base] [budget-min]

import type { Page } from 'playwright-core';
import { boot, bringUpOffIsland, fail, launchBrowser, login, type } from './lib/harness.js';
import { cheatQuiet, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const budgetMin = Number(process.argv[3]) || 10;
const stamp = Date.now().toString(36).slice(-6);
const M_USER = `ncm${stamp}`; // master
const R_USER = `ncr${stamp}`; // runner
const ALTAR_TELE = '::tele 0,44,47,49,14'; // nature ruins (2865,3022)
const SEED = 27; // over the 25 cap -> the runner must keep 2
const CAP = 25;

type Abi = {
    __rs2b0t: { Inventory: { items(): { name: string | null; count: number }[] }; Skills: { xp(s: string): number } };
    rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } };
};

async function bringUp(page: Page, user: string): Promise<void> {
    page.on('pageerror', e => console.log(`[${user}] pageerror: ${e}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) fail(`${user}: first login failed`);
    await bringUpOffIsland(page, { user });
}

async function teleTo(page: Page, user: string, tele: string): Promise<void> {
    await type(page, tele);
    await page.reload();
    await boot(page);
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) { await page.waitForTimeout(2500); ok = await login(page, user); }
    if (!ok) fail(`${user}: relogin failed`);
}

function sample(page: Page): Promise<{ unnoted: number; natures: number; rcXp: number; state: string; logs: string[] }> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const items = g.__rs2b0t.Inventory.items();
        return {
            unnoted: items.filter(i => (i.name ?? '').toLowerCase() === 'rune essence' && i.count === 1).length,
            natures: items.filter(i => (i.name ?? '').toLowerCase() === 'nature rune').reduce((s, i) => s + Math.max(1, i.count), 0),
            rcXp: g.__rs2b0t.Skills.xp('runecraft'),
            state: g.rs2b0t.runner.state,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-20).map(l => l.msg)
        };
    });
}

const browser = await launchBrowser();
try {
    const ctxM = await browser.newContext();
    const ctxR = await browser.newContext();
    const pageM = await ctxM.newPage();
    const pageR = await ctxR.newPage();

    await bringUp(pageM, M_USER);
    await bringUp(pageR, R_USER);
    await teleTo(pageM, M_USER, ALTAR_TELE);
    await teleTo(pageR, R_USER, ALTAR_TELE);
    console.log('master + runner both at the nature ruins');

    await cheatQuiet(pageM, '~maxme');
    await pageM.waitForTimeout(1500);
    await cheatQuiet(pageM, '~clearinv');
    await cheatQuiet(pageM, '~item nature_talisman 1');
    await pageM.evaluate(n => {
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Master');
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:partner', n);
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:bankAt', '400');
    }, R_USER);

    await cheatQuiet(pageR, '~clearinv');
    await cheatQuiet(pageR, `~item blankrune ${SEED}`); // unnoted, straight into the pack
    await cheatQuiet(pageR, '~item coins 20000');
    await pageR.evaluate(n => {
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Runner');
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:partner', n);
    }, M_USER);
    await pageR.waitForTimeout(800);

    const held = (await sample(pageR)).unnoted;
    if (held < SEED) fail(`runner holds ${held} unnoted essence, expected ${SEED}`);
    console.log(`runner seeded with ${held} unnoted essence (cap is ${CAP})`);

    await startScript(pageM, 'NatureCrafter');
    await startScript(pageR, 'NatureCrafter');
    console.log('both bots started — watching the capped hand-off');

    // the cap is per trade WINDOW: after the capped 25 the runner still holds the remainder and
    // will hand it over in a second trade, so assert on the per-delivery amounts, not the end state
    const deadline = Date.now() + budgetMin * 60_000;
    let seenM = 0, seenR = 0;
    let m = await sample(pageM), r = await sample(pageR);
    let capLogged = false;
    const deliveries: number[] = [];
    while (Date.now() < deadline) {
        m = await sample(pageM); r = await sample(pageR);
        for (let i = seenR; i < r.logs.length; i++) { console.log(`   [R] ${r.logs[i]}`); }
        seenR = r.logs.length;
        for (let i = seenM; i < m.logs.length; i++) { console.log(`   [M] ${m.logs[i]}`); }
        seenM = m.logs.length;
        const secs = Math.round((budgetMin * 60_000 - (deadline - Date.now())) / 1000);
        console.log(`  t=${secs}s | R unnoted=${r.unnoted} | M unnoted=${m.unnoted} nat=${m.natures} | ${r.state}/${m.state}`);

        if (r.logs.some(l => new RegExp(`offering the ${CAP} cap`).test(l))) { capLogged = true; }
        for (const l of r.logs) {
            const hit = /delivered (\d+) essence/.exec(l);
            if (hit && !deliveries.includes(Number(hit[1]))) { deliveries.push(Number(hit[1])); }
        }
        if (deliveries.length > 0 && r.unnoted <= SEED - CAP) { break; }
        if (r.state === 'crashed' || m.state === 'crashed') { break; }
        await pageM.waitForTimeout(2500);
    }

    const over = deliveries.filter(n => n > CAP);
    if (deliveries.includes(CAP) && over.length === 0) {
        console.log(`PASS: a ${SEED}-essence runner offered exactly ${CAP} in the trade window (deliveries seen: ${deliveries.join(', ')}; cap log seen: ${capLogged})`);
        await browser.close();
        process.exit(0);
    }
    fail(`cap not honoured [deliveries=${deliveries.join(',') || 'none'} over-cap=${over.join(',') || 'none'} capLog=${capLogged} Runnoted=${r.unnoted} Rstate=${r.state} Mstate=${m.state}]`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
