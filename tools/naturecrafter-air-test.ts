// Air-rune smoke: the short route — runner withdraws UNNOTED essence at Falador East and walks it
// to the air altar master. No noting, no ship, no store, no coins.
// Usage: bun tools/naturecrafter-air-test.ts [base] [budget-min]

import type { Page } from 'playwright-core';
import { boot, bringUpOffIsland, fail, launchBrowser, login, type } from './lib/harness.js';
import { cheatQuiet, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const budgetMin = Number(process.argv[3]) || 12;
const stamp = Date.now().toString(36).slice(-6);
const M_USER = `nam${stamp}`; // master at the air altar
const R_USER = `nar${stamp}`; // runner at the Falador East bank
const RUINS_TELE = '::tele 0,46,51,39,24'; // air Mysterious ruins (2983,3288)
const BANK_TELE = '::tele 0,47,52,5,27'; // Falador East bank (3013,3355)
const RUNE = 'Air runes';
const SEED = Number(process.argv[4]) || 60; // bank essence; pass a small number to drain the bank and watch it stop honestly

type Abi = {
    __rs2b0t: { Inventory: { items(): { name: string | null; id: number; count: number }[] }; Skills: { xp(s: string): number }; reader: { worldTile(): { x: number; z: number; level: number } | null } };
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

function sample(page: Page): Promise<{ pos: { x: number; z: number } | null; airRunes: number; unnoted: number; noted: number; coins: number; rcXp: number; state: string; logs: string[] }> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const items = g.__rs2b0t.Inventory.items();
        const ess = items.filter(i => (i.name ?? '').toLowerCase() === 'rune essence');
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            airRunes: items.filter(i => (i.name ?? '').toLowerCase() === 'air rune').reduce((s, i) => s + Math.max(1, i.count), 0),
            unnoted: ess.filter(i => i.id === 1436).length,
            noted: ess.filter(i => i.id !== 1436).reduce((s, i) => s + i.count, 0),
            coins: items.filter(i => (i.name ?? '').toLowerCase() === 'coins').reduce((s, i) => s + i.count, 0),
            rcXp: g.__rs2b0t.Skills.xp('runecraft'),
            state: g.rs2b0t.runner.state,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-14).map(l => l.msg)
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
    await teleTo(pageM, M_USER, RUINS_TELE);
    await teleTo(pageR, R_USER, BANK_TELE);
    console.log('master at the air ruins, runner at the Falador East bank');

    await cheatQuiet(pageM, '~clearinv');
    await cheatQuiet(pageM, '~item air_talisman 1');
    await pageM.evaluate(n => {
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:rune', 'Air runes');
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Master');
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:partner', n);
    }, R_USER);

    // deliberately NO coins anywhere: the air route must never ask for fare money.
    // withdrawEss is set OVER the trade cap on purpose — a value carried over from the noting
    // route used to fill the pack (28), costing the master a second altar trip for the leftover 3.
    await cheatQuiet(pageR, '~clearinv');
    await cheatQuiet(pageR, `~bankitem blankrune ${SEED}`);
    await pageR.evaluate(n => {
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:rune', 'Air runes');
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Runner');
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:partner', n);
        sessionStorage.setItem('rs2b0t:set:NatureCrafter:withdrawEss', '28');
    }, M_USER);
    await pageR.waitForTimeout(800);

    await startScript(pageM, 'NatureCrafter');
    await startScript(pageR, 'NatureCrafter');
    console.log(`both bots started on ${RUNE} — runner has ${SEED} essence banked and zero coins`);

    const xp0 = (await sample(pageM)).rcXp;
    const deadline = Date.now() + budgetMin * 60_000;
    let seenM = 0, seenR = 0;
    let m = await sample(pageM), r = await sample(pageR);
    let withdrewUnnoted = false, delivered = false, crafted = false;
    while (Date.now() < deadline) {
        m = await sample(pageM); r = await sample(pageR);
        for (let i = seenR; i < r.logs.length; i++) { console.log(`   [R] ${r.logs[i]}`); }
        seenR = r.logs.length;
        for (let i = seenM; i < m.logs.length; i++) { console.log(`   [M] ${m.logs[i]}`); }
        seenM = m.logs.length;
        const secs = Math.round((budgetMin * 60_000 - (deadline - Date.now())) / 1000);
        console.log(`  t=${secs}s | M air=${m.airRunes} rc+${m.rcXp - xp0} @${m.pos ? `${m.pos.x},${m.pos.z}` : '?'} | R unnoted=${r.unnoted} noted=${r.noted} coins=${r.coins} @${r.pos ? `${r.pos.x},${r.pos.z}` : '?'} ${r.state}`);

        for (const l of r.logs) {
            const hit = /withdrew (\d+) unnoted essence/.exec(l);
            if (!hit) { continue; }
            withdrewUnnoted = true;
            if (Number(hit[1]) > 25) { fail(`withdrew ${hit[1]} unnoted essence — a trade window only moves 25, so the rest costs an extra altar trip`); }
        }
        if (r.unnoted > 25) { fail(`runner is carrying ${r.unnoted} unnoted essence, over the 25 trade cap`); }
        if (r.logs.some(l => /delivered \d+ essence/.test(l))) { delivered = true; }
        if (m.airRunes > 0 && m.rcXp > xp0) { crafted = true; }
        if (r.noted > 0) { fail(`the air runner banked a NOTE (${r.noted}) — the short route must withdraw unnoted`); }
        if (crafted && delivered) { break; }
        if (r.state === 'crashed' || m.state === 'crashed') { break; }
        await pageM.waitForTimeout(3000);
    }

    if (crafted && delivered) {
        console.log(`PASS: air runner delivered unnoted essence from Falador East (unnoted withdraw log: ${withdrewUnnoted}), master crafted ${m.airRunes} Air runes (rc +${m.rcXp - xp0} xp) with no coins involved`);
        await browser.close();
        process.exit(0);
    }
    fail(`incomplete within ${budgetMin}min [withdrewUnnoted=${withdrewUnnoted} delivered=${delivered} crafted=${crafted} Mair=${m.airRunes} Runnoted=${r.unnoted} Rstate=${r.state} Mstate=${m.state}]`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
