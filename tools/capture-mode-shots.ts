// Capture the two screenshots the site's "Select Bot Mode" page offers as its
// choices: the single client, and the wall with a focused bot beside its rail.
// Both are shot at the client's logical 1100x620 (the same 1.77:1 the page's
// thumbnails use), against a local engine holding a packed /rs2b0t/ subtree.
//
// Accounts are walked off tutorial island first — a fresh account sits on the
// character-design screen, which showcases nothing. The wall's bots are warmed
// through the standalone client because bringUpOffIsland drives a page's canvas
// and cannot reach a bot inside a wall iframe.
//
// Usage: bun tools/capture-mode-shots.ts <out-dir> [base]
//   bun tools/capture-mode-shots.ts ~/code/rs2b2t/site/static/img/rs2b0t

import type { Browser, Page } from 'playwright-core';
import { boot, bringUpOffIsland, launchBrowser, login } from './lib/harness.js';

const outDir = process.argv[2];
const base = process.argv[3] ?? 'http://localhost:8890';

if (!outDir) {
    console.error('usage: bun tools/capture-mode-shots.ts <out-dir> [base]');
    process.exit(1);
}

const tag = Date.now().toString(36).slice(-6);
const single = `cap${tag}s`;
const wallUsers = [`cap${tag}a`, `cap${tag}b`];

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

interface Snap { id: number; username: string; ingame: boolean }
type Mbx = { multibox: { add(a: { username: string; password: string }): unknown; focus(id: number): void; slots(): Snap[] } };

async function warmOffIsland(browser: Browser, user: string): Promise<Page> {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1100, height: 620 });
    await page.goto(`${base}/rs2b0t/index.html`);
    await boot(page);

    let ok = false;
    for (let i = 0; i < 6 && !ok; i++) {
        ok = await login(page, user);
        if (!ok) await page.waitForTimeout(3000);
    }
    if (!ok) fail(`${user} never reached ingame`);

    await bringUpOffIsland(page, { user });
    console.log(`${user} is off tutorial island`);
    return page;
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const singlePage = await warmOffIsland(browser, single);
    // let the scene settle so the shot is not a half-drawn frame
    await singlePage.waitForTimeout(5000);
    await singlePage.screenshot({ path: `${outDir}/single.jpg`, type: 'jpeg', quality: 82 });
    console.log(`captured ${outDir}/single.jpg`);
    await singlePage.close();

    for (const user of wallUsers) {
        const warm = await warmOffIsland(browser, user);
        await warm.close();
    }

    const wall = await browser.newPage();
    await wall.setViewportSize({ width: 1100, height: 620 });
    await wall.goto(`${base}/rs2b0t/multibox.html`);
    await wall.waitForFunction(() => Boolean((globalThis as never as Mbx).multibox), undefined, { timeout: 30000 });
    await wall.evaluate(users => {
        const m = (globalThis as never as Mbx).multibox;
        for (const u of users) m.add({ username: u, password: 'test' });
    }, wallUsers);

    await wall.waitForFunction(() => {
        const s = (globalThis as never as Mbx).multibox.slots();
        return s.length === 2 && s.every(x => x.ingame);
    }, undefined, { timeout: 90000 }).catch(() => fail('wall bots never reached ingame'));

    await wall.evaluate(() => {
        const m = (globalThis as never as Mbx).multibox;
        m.focus(m.slots()[0].id);
    });
    // the rail thumbnails paint on a 1s timer; give them a few frames each
    await wall.waitForTimeout(8000);
    await wall.screenshot({ path: `${outDir}/multi.jpg`, type: 'jpeg', quality: 82 });
    console.log(`captured ${outDir}/multi.jpg`);
} finally {
    await browser.close();
}
