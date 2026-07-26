import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { boot, fail, launchBrowser, login, startFromLibrary } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:18680';
const screenshotPath = resolve(process.argv[3] ?? 'docs/e2e/issue-68-self-stop.png');
const username = `stop${Date.now().toString(36).slice(-7)}`.slice(0, 12);
mkdirSync(dirname(screenshotPath), { recursive: true });

const browser = await launchBrowser();
try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', error => console.error(`pageerror: ${error}`));
    page.on('console', message => console.log(`browser ${message.type()}: ${message.text()}`));

    await page.goto(`${base}/bot.html?nodeid=10&Firemaker.logType=Magic%20logs`);
    await boot(page);
    let loggedIn = false;
    for (let attempt = 0; attempt < 5 && !loggedIn; attempt++) {
        loggedIn = await login(page, username);
        if (!loggedIn) {
            await page.waitForTimeout(2500);
        }
    }
    if (!loggedIn) {
        const message = await page.evaluate(() => {
            const client = (globalThis as never as {
                rs2b0t: { client: { loginMes1?: string; loginMes2?: string } };
            }).rs2b0t.client;
            return `${client.loginMes1 ?? ''} ${client.loginMes2 ?? ''}`.trim() || 'no login message';
        });
        fail(`${username}: login failed (${message})`);
    }
    await startFromLibrary(page, 'Firemaking', 'Firemaker');

    const start = page.getByRole('button', { name: 'Start', exact: true });
    const pause = page.getByRole('button', { name: 'Pause', exact: true });
    const stop = page.getByRole('button', { name: 'Stop', exact: true });
    const browse = page.getByRole('button', { name: 'Browse…', exact: true });

    const runLogs: string[][] = [];
    for (let run = 1; run <= 2; run++) {
        if (!(await start.isEnabled())) {
            fail(`Start is disabled before run ${run}`);
        }
        await start.click();
        await page.waitForFunction(() => {
            const runner = (globalThis as never as {
                rs2b0t: { runner: { state: string; ctx: { log: { msg: string }[] } | null } };
            }).rs2b0t.runner;
            return runner.state === 'stopped' && (runner.ctx?.log.some(line => line.msg === 'stopped') ?? false);
        }, undefined, { timeout: 10_000 });
        runLogs.push(await page.evaluate(() => (globalThis as never as {
            rs2b0t: { runner: { ctx: { log: { msg: string }[] } | null } };
        }).rs2b0t.runner.ctx?.log.map(line => line.msg) ?? []));
    }

    const controls = {
        start: await start.isEnabled(),
        pause: await pause.isEnabled(),
        stop: await stop.isEnabled(),
        browse: await browse.isEnabled()
    };
    const snapshot = await page.evaluate(() => {
        const runner = (globalThis as never as {
            rs2b0t: { runner: { state: string; ctx: { log: { msg: string }[] } | null } };
        }).rs2b0t.runner;
        return { state: runner.state, log: runner.ctx?.log.map(line => line.msg) ?? [] };
    });
    const cleanRuns = runLogs.filter(log =>
        log.some(line => line.includes('Magic logs need Firemaking 75')) && log.at(-1) === 'stopped'
    ).length;

    if (snapshot.state !== 'stopped' || cleanRuns !== 2) {
        fail(`expected two clean stops, got state=${snapshot.state}, cleanRuns=${cleanRuns}`);
    }
    if (!controls.start || controls.pause || controls.stop || !controls.browse) {
        fail(`wrong stopped controls: ${JSON.stringify(controls)}`);
    }

    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(JSON.stringify({ result: 'PASS', username, controls, cleanRuns, screenshotPath }, null, 2));
} finally {
    await browser.close();
}
