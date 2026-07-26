// Empty-bank smoke: a runner whose bank genuinely has no essence must stop — but only after the
// bank list has actually been read, never on a stale/blank one (that used to strand bots with
// thousands of essence banked). Runner only; no master needed.
// Usage: bun tools/naturecrafter-emptybank-test.ts [base] [budget-min]

import type { Page } from 'playwright-core';
import { boot, bringUpOffIsland, fail, launchBrowser, login, type } from './lib/harness.js';
import { cheatQuiet, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const budgetMin = Number(process.argv[3]) || 5;
const USER = `neb${Date.now().toString(36).slice(-6)}`;
const BANK_TELE = '::tele 0,47,52,5,27'; // Falador East bank (3013,3355)

type Abi = {
    __rs2b0t: { Inventory: { items(): { name: string | null; count: number }[] } };
    rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } };
};

function sample(page: Page): Promise<{ ess: number; state: string; logs: string[] }> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        return {
            ess: g.__rs2b0t.Inventory.items().filter(i => (i.name ?? '').toLowerCase() === 'rune essence').length,
            state: g.rs2b0t.runner.state,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-20).map(l => l.msg)
        };
    });
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, USER))) fail('first login failed');
    await bringUpOffIsland(page, { user: USER });
    await type(page, BANK_TELE);
    await page.reload();
    await boot(page);
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) { await page.waitForTimeout(3000); ok = await login(page, USER); }
    if (!ok) fail('relogin failed');

    // nothing banked and nothing held: the bank really is empty
    await cheatQuiet(page, '~clearinv');
    await page.waitForTimeout(600);
    await page.evaluate(() => {
        localStorage.setItem('rs2b0t:set:NatureCrafter:rune', 'Air runes');
        localStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Runner');
        localStorage.setItem('rs2b0t:set:NatureCrafter:partner', 'DummyMaster');
    });
    await startScript(page, 'NatureCrafter');
    console.log(`runner '${USER}' started at Falador East with an empty bank`);

    const deadline = Date.now() + budgetMin * 60_000;
    let s = await sample(page);
    let seen = 0;
    while (Date.now() < deadline) {
        s = await sample(page);
        for (let i = seen; i < s.logs.length; i++) { console.log(`      · ${s.logs[i]}`); }
        seen = s.logs.length;
        console.log(`  ess=${s.ess} state=${s.state}`);
        if (s.state !== 'running') { break; }
        await page.waitForTimeout(2500);
    }

    const stopped = s.state === 'stopped';
    const honest = s.logs.some(l => /out of Rune essence in the bank \(three reads\)/.test(l));
    if (stopped && honest) {
        console.log('PASS: a genuinely empty bank still stops the runner, and only after three confirming reads');
        await browser.close();
        process.exit(0);
    }
    fail(`empty bank not handled [stopped=${stopped} honestMessage=${honest} state=${s.state}] — a runner that never stops here would walk to the bank forever`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
