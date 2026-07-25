import { _electron as electron } from 'playwright-core';

const server = process.argv[2] ?? 'http://localhost:8888';
const tag = Date.now().toString(36).slice(-6);
const u1 = `mbx${tag}a`;
const u2 = `mbx${tag}b`;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

interface Snap { id: number; username: string; ingame: boolean; loopCycle: number; drawn: number; mode: string; focused: boolean }
type Mbx = { multibox: { add(a: { username: string; password: string }): unknown; focus(id: number): void; slots(): Snap[]; importProfiles(a: unknown): Promise<number>; profiles(): string[] } };

const app = await electron.launch({
    args: ['desktop/main.cjs', `--server=${server}/multibox.html`],
    executablePath: 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
});

try {
    const page = await app.firstWindow();
    const slots = () => page.evaluate(() => (globalThis as never as Mbx).multibox.slots());

    await page.waitForFunction(() => Boolean((globalThis as never as Mbx).multibox), undefined, { timeout: 30000 });
    console.log('manager booted');

    // hermetic: the Electron profile persists localStorage across smoke runs
    await page.evaluate(() => {
        localStorage.removeItem('rs2b0t:multibox:profiles');
        localStorage.removeItem('rs2b0t:multibox:accounts');
        localStorage.removeItem('rs2b0t:multibox:railHidden');
    });
    const railHidden = () => page.evaluate(() => document.getElementById('mbx-app')!.classList.contains('mbx-rail-hidden'));
    if (await railHidden()) await page.click('#mbx-drawer');

    await page.evaluate(([a, b]) => { const m = (globalThis as never as Mbx).multibox; m.add({ username: a, password: 'test' }); m.add({ username: b, password: 'test' }); }, [u1, u2]);

    await page.waitForFunction(() => { const s = (globalThis as never as Mbx).multibox.slots(); return s.length === 2 && s.every(x => x.ingame); }, undefined, { timeout: 90000 })
        .catch(() => fail('both bots did not reach ingame within 90s'));

    const users = (await slots()).map(s => s.username).sort();
    if (users.length !== 2 || users[0] === users[1]) fail(`accounts collided: ${users.join(', ')}`);
    if (users[0] !== u1 && users[0] !== u2) fail(`unexpected usernames: ${users.join(', ')}`);
    console.log(`PASS: two distinct accounts ingame (${users.join(', ')})`);

    const ids = (await slots()).map(s => s.id);
    await page.evaluate(id => (globalThis as never as Mbx).multibox.focus(id), ids[0]);
    const a = await slots();
    await page.waitForTimeout(4000);
    const b = await slots();
    const by = (arr: Snap[], id: number) => arr.find(s => s.id === id)!;
    const secs = 4;
    const fDraw = (by(b, ids[0]).drawn - by(a, ids[0]).drawn) / secs;
    const bDraw = (by(b, ids[1]).drawn - by(a, ids[1]).drawn) / secs;
    const fLoop = (by(b, ids[0]).loopCycle - by(a, ids[0]).loopCycle) / secs;
    const bLoop = (by(b, ids[1]).loopCycle - by(a, ids[1]).loopCycle) / secs;
    console.log(`focused: draw ${fDraw.toFixed(1)} loop ${fLoop.toFixed(1)} | background: draw ${bDraw.toFixed(1)} loop ${bLoop.toFixed(1)} (fps)`);
    if (fDraw < 25) fail(`focused bot draw fps too low (${fDraw.toFixed(1)})`);
    if (bDraw > 15) fail(`background bot draw not throttled (${bDraw.toFixed(1)})`);
    if (fLoop < 25 || bLoop < 25) fail(`logic starved (focused ${fLoop.toFixed(1)}, background ${bLoop.toFixed(1)})`);
    console.log('PASS: render decoupled from logic across the wall');

    const beforeNav = by(await slots(), ids[1]).loopCycle;
    await page.evaluate(id => (globalThis as never as Mbx).multibox.focus(id), ids[1]);
    await page.waitForTimeout(500);
    await page.evaluate(id => (globalThis as never as Mbx).multibox.focus(id), ids[0]);
    await page.waitForTimeout(500);
    const afterNav = by(await slots(), ids[1]).loopCycle;
    if (afterNav < beforeNav) fail(`iframe reloaded on navigation (loopCycle ${beforeNav} -> ${afterNav})`);
    console.log('PASS: switching the active bot kept sessions alive (no reload)');

    const u3 = `mbx${tag}c`;
    const u4 = `mbx${tag}d`;

    await page.click('#mbx-add');
    await page.fill('#mbx-vault-pass', 'smoke-pass');
    await page.fill('#mbx-vault-confirm', 'smoke-pass');
    await page.click('#mbx-vault-go');
    await page.waitForSelector('.mbx-chooser-overlay:not([hidden]) .mbx-chooser-empty', { timeout: 10000 });
    await page.click('.mbx-chooser-overlay:not([hidden])', { position: { x: 8, y: 8 } });
    console.log('PASS: vault passphrase set; chooser gated behind it');

    const imported = await page.evaluate(u => (globalThis as never as Mbx).multibox.importProfiles([{ username: u, password: 'test' }]), u3);
    if (imported !== 1) fail(`importProfiles imported ${imported}, expected 1`);
    await page.click('#mbx-add');
    await page.click(`.mbx-profile-row:has-text("${u3}")`);
    await page.waitForFunction(() => { const s = (globalThis as never as Mbx).multibox.slots(); return s.length === 3 && s.every(x => x.ingame); }, undefined, { timeout: 90000 })
        .catch(() => fail('profile-loaded bot did not reach ingame within 90s'));
    console.log('PASS: chooser loaded a saved profile into a live slot');

    await page.click('#mbx-add');
    await page.fill('#mbx-new-user', u4);
    await page.fill('#mbx-new-pass', 'test');
    await page.click('#mbx-new-go');
    await page.waitForFunction(() => { const s = (globalThis as never as Mbx).multibox.slots(); return s.length === 4 && s.every(x => x.ingame); }, undefined, { timeout: 90000 })
        .catch(() => fail('create-new bot did not reach ingame within 90s'));
    const savedNames = await page.evaluate(() => (globalThis as never as Mbx).multibox.profiles());
    const rawStore = await page.evaluate(() => localStorage.getItem('rs2b0t:multibox:profiles') ?? '');
    if ((JSON.parse(rawStore) as { v?: number }).v !== 1) fail('profile store is not an encrypted blob');
    if (rawStore.includes(u4)) fail('profile store contains a plaintext username');
    if (!savedNames.includes(u4)) fail(`create-new did not persist a profile (saved: ${savedNames.join(', ')})`);
    const boxed = await page.evaluate(u => Array.from(document.querySelectorAll('iframe')).some(f => f.src.includes(`box=${u}`)), u3);
    if (!boxed) fail('profile bot iframe missing its ?box= namespace');
    console.log('PASS: create-new persisted a profile; slots namespaced by username');

    const u4idx = await page.evaluate(u => (globalThis as never as Mbx).multibox.slots().findIndex(s => s.username === u), u4);
    if (u4idx < 0) fail('create-new bot missing from slots');
    await page.click(`.mbx-slot >> nth=${u4idx} >> .mbx-close`);
    await page.waitForFunction(u => { const s = (globalThis as never as Mbx).multibox.slots(); return s.length === 3 && !s.some(x => x.username === (u as string)); }, u4, { timeout: 10000 })
        .catch(() => fail('tile ✕ did not remove the bot'));
    await page.click('#mbx-add');
    await page.click('#mbx-load-all');
    await page.waitForFunction(() => { const s = (globalThis as never as Mbx).multibox.slots(); return s.length === 4 && s.every(x => x.ingame); }, undefined, { timeout: 90000 })
        .catch(async () => {
            const s = await page.evaluate(() => (globalThis as never as Mbx).multibox.slots().map(x => `${x.username}:${x.ingame ? 'in' : 'out'}`));
            fail(`load-all did not restore the removed bot to ingame [${s.join(', ')}]`);
        });
    console.log('PASS: tile ✕ removed a bot; load-all restored it (dedup held)');

    await page.click('#mbx-drawer');
    if (!(await page.evaluate(() => document.getElementById('mbx-rail')!.offsetWidth === 0))) fail('drawer did not hide the rail');
    const focusedVisible = await page.evaluate(() => {
        const f = document.querySelector('.mbx-slot.is-focused .mbx-frame');
        return f !== null && f.getBoundingClientRect().width > 100;
    });
    if (!focusedVisible) fail('hiding the rail blanked the focused bot');
    await page.click('#mbx-drawer');
    if (!(await page.evaluate(() => document.getElementById('mbx-rail')!.offsetWidth > 0))) fail('drawer did not restore the rail');
    console.log('PASS: rail drawer toggles');

    console.log('\nPASS');
} finally {
    await app.close();
}
