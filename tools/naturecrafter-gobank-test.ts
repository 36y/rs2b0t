// Go-bank paint button: clicks the real canvas button mid-run, asserts the runner parks at
// the Ardougne bank, then clicks Resume and asserts it leaves again.
// Usage: bun tools/naturecrafter-gobank-test.ts [base] [budget-min]

import type { Page } from 'playwright-core';
import { boot, bringUpOffIsland, fail, launchBrowser, login, type } from './lib/harness.js';
import { cheatQuiet, startScript } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const budgetMin = Number(process.argv[3]) || 10;
const USER = `ngob${Date.now().toString(36).slice(-6)}`;
const BANK_TELE = '::tele 0,41,51,31,19'; // Ardougne East bank (2655,3283)
const ARD_BANK = { x: 2655, z: 3283 };

// chatbox dock (8,345,506x150): title 20 + 3 rows of 16 + 6 gap -> the button row starts at 421
const BTN = { x: 40, y: 429 };
const CANVAS_W = 765;
const CANVAS_H = 503;

type Abi = {
    __rs2b0t: {
        Inventory: { items(): { name: string | null; count: number }[] };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
    rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } };
};

async function teleTo(page: Page, user: string, tele: string): Promise<void> {
    await type(page, tele);
    await page.reload();
    await boot(page);
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) { await page.waitForTimeout(3000); ok = await login(page, user); }
    if (!ok) fail(`${user}: relogin failed`);
}

function sample(page: Page): Promise<{ pos: { x: number; z: number; level: number } | null; state: string; logs: string[] }> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            state: g.rs2b0t.runner.state,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-60).map(l => l.msg)
        };
    });
}

// the paint reads canvas-space coords, so map through the canvas' on-screen rect
async function clickPaint(page: Page, cx: number, cy: number): Promise<void> {
    const pt = await page.evaluate(([x, y, w, h]) => {
        const canvas = document.getElementById('canvas'); // the element PaintInput binds to
        if (!canvas) { return null; }
        const r = canvas.getBoundingClientRect();
        return { x: r.left + x * (r.width / w), y: r.top + y * (r.height / h) };
    }, [cx, cy, CANVAS_W, CANVAS_H]);
    if (!pt) fail('no canvas to click');
    await page.mouse.move(pt.x, pt.y);
    await page.waitForTimeout(150);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(700);
}

function atBank(p: { x: number; z: number } | null): boolean {
    return p !== null && Math.abs(p.x - ARD_BANK.x) <= 6 && Math.abs(p.z - ARD_BANK.z) <= 6;
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, USER))) fail('first login failed');
    await bringUpOffIsland(page, { user: USER });
    await teleTo(page, USER, BANK_TELE);
    console.log(`runner '${USER}' at the Ardougne East bank`);

    await cheatQuiet(page, '~clearinv');
    await cheatQuiet(page, '~bankitem blankrune 52');
    await cheatQuiet(page, '~bankitem coins 100000');
    await page.waitForTimeout(800);

    await page.evaluate(() => {
        localStorage.setItem('rs2b0t:set:NatureCrafter:mode', 'Runner');
        localStorage.setItem('rs2b0t:set:NatureCrafter:partner', 'DummyMaster');
    });
    await startScript(page, 'NatureCrafter');
    console.log('runner started — waiting for it to leave the bank before pressing Go bank');

    const deadline = Date.now() + budgetMin * 60_000;
    let s = await sample(page);
    let left = false, pressed = false, parked = false, resumed = false;
    let seen = 0;
    while (Date.now() < deadline) {
        s = await sample(page);
        for (let i = seen; i < s.logs.length; i++) { console.log(`      · ${s.logs[i]}`); }
        seen = s.logs.length;
        const secs = Math.round((budgetMin * 60_000 - (deadline - Date.now())) / 1000);
        console.log(`  t=${secs}s pos=${s.pos ? `${s.pos.x},${s.pos.z},${s.pos.level}` : '?'} state=${s.state} left=${left} pressed=${pressed} parked=${parked}`);

        if (s.state !== 'running') { break; }

        if (!left && !atBank(s.pos)) {
            left = true;
            console.log('runner has left the bank — clicking "Go bank"');
            await clickPaint(page, BTN.x, BTN.y);
            pressed = (await sample(page)).logs.some(l => /Go bank pressed/.test(l));
            if (!pressed) fail(`the "Go bank" click did not register at canvas (${BTN.x},${BTN.y})`);
            console.log('Go bank pressed — waiting for it to park at the Ardougne bank');
            continue;
        }

        if (pressed && !parked && atBank(s.pos) && s.logs.some(l => /Go bank pressed/.test(l))) {
            parked = true;
            console.log('parked at the bank — clicking "Resume"');
            await clickPaint(page, BTN.x, BTN.y);
            resumed = (await sample(page)).logs.some(l => /Resume pressed/.test(l));
            if (!resumed) fail('the "Resume" click did not register');
            console.log('Resume pressed — waiting for it to leave again');
            continue;
        }

        if (resumed && !atBank(s.pos)) {
            console.log(`PASS: Go bank walked the runner back to (${s.pos?.x},${s.pos?.z}) and parked; Resume released it (now at ${s.pos?.x},${s.pos?.z})`);
            await browser.close();
            process.exit(0);
        }

        await page.waitForTimeout(2500);
    }

    fail(`incomplete within ${budgetMin}min [left=${left} pressed=${pressed} parked=${parked} resumed=${resumed} pos=${s.pos ? `${s.pos.x},${s.pos.z}` : '?'} state=${s.state}]`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
