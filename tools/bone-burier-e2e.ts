import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { boot, bringUpOffIsland, fail, launchBrowser, login, startFromLibrary, type } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:16260';
const runningShot = resolve(process.argv[3] ?? 'docs/e2e/issue-62-bone-burier-running.png');
const completeShot = resolve(process.argv[4] ?? 'docs/e2e/issue-62-bone-burier-complete.png');
const username = process.env.E2E_USER ?? `bury${Date.now().toString(36).slice(-8)}`.slice(0, 12);
let seeded = 0;
mkdirSync(dirname(runningShot), { recursive: true });
mkdirSync(dirname(completeShot), { recursive: true });

type Snapshot = {
    state: string;
    status: string;
    burials: number;
    trips: number;
    prayerXp: number;
    bones: number;
    tile: { x: number; z: number; level: number } | null;
    log: string[];
};

const browser = await launchBrowser();
try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', error => console.error(`pageerror: ${error}`));

    const teleport = async (command: string, expected: { x: number; z: number; level: number }): Promise<void> => {
        for (let attempt = 0; attempt < 4; attempt++) {
            await page.evaluate(() => (globalThis as never as {
                rs2b0t: { actions: { closeModal(): boolean } };
            }).rs2b0t.actions.closeModal());
            await type(page, command, 900);
            const arrived = await page.waitForFunction(tile => {
                const here = (globalThis as never as {
                    rs2b0t: { reader: { worldTile(): { x: number; z: number; level: number } | null } };
                }).rs2b0t.reader.worldTile();
                return here?.x === tile.x && here.z === tile.z && here.level === tile.level;
            }, expected, { timeout: 5000 }).then(() => true).catch(() => false);
            if (arrived) {
                console.log(`teleport verified at ${expected.x},${expected.z},${expected.level}`);
                return;
            }
            const actual = await page.evaluate(() => (globalThis as never as {
                rs2b0t: { reader: { worldTile(): { x: number; z: number; level: number } | null } };
            }).rs2b0t.reader.worldTile());
            console.log(`teleport attempt ${attempt + 1} actual=${JSON.stringify(actual)}`);
            await page.evaluate(async () => {
                const actions = (globalThis as never as {
                    rs2b0t: { actions: { continueDialog(): boolean } };
                }).rs2b0t.actions;
                for (let i = 0; i < 12; i++) {
                    actions.continueDialog();
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            });
        }
        const actual = await page.evaluate(() => (globalThis as never as {
            rs2b0t: { reader: { worldTile(): { x: number; z: number; level: number } | null } };
        }).rs2b0t.reader.worldTile());
        fail(`teleport did not reach ${expected.x},${expected.z},${expected.level}; actual=${JSON.stringify(actual)}`);
    };

    const closeDialogs = async (): Promise<void> => {
        await page.evaluate(async () => {
            const actions = (globalThis as never as {
                rs2b0t: { actions: { closeModal(): boolean; continueDialog(): boolean } };
            }).rs2b0t.actions;
            actions.closeModal();
            for (let i = 0; i < 16; i++) {
                actions.continueDialog();
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        });
    };

    const sendCheat = async (command: string): Promise<void> => {
        const sent = await page.evaluate(value => {
            const client = (globalThis as never as {
                rs2b0t: {
                    client: {
                        ingame: boolean;
                        out: { p1Enc(op: number): void; p1(value: number): void; pjstr(value: string): void } | null;
                    };
                };
            }).rs2b0t.client;
            if (!client.ingame || !client.out) {
                return false;
            }
            client.out.p1Enc(224);
            client.out.p1(value.length + 1);
            client.out.pjstr(value);
            return true;
        }, command);
        if (!sent) {
            fail(`could not send private-server command '${command}'`);
        }
        await page.waitForTimeout(700);
    };

    const startBankSeeder = async (): Promise<void> => {
        await page.evaluate(() => {
            const root = globalThis as never as {
                __rs2b0t: {
                    Bank: { openNearest(name: string, op: string): Promise<boolean>; depositInventory(): Promise<void> };
                    LoopingBot: new () => { loop(): Promise<void> };
                    registerScript(manifest: { name: string; create(): unknown }): unknown;
                };
                rs2b0t: { runner: { start(meta: unknown): void } };
            };
            const { Bank, LoopingBot, registerScript } = root.__rs2b0t;
            class BankSeeder extends LoopingBot {
                override async loop(): Promise<void> {
                    if (await Bank.openNearest('Bank booth', 'Use-quickly')) {
                        await Bank.depositInventory();
                    }
                }
            }
            const meta = registerScript({ name: `Bone E2E bank seed ${Date.now()}`, create: () => new BankSeeder() });
            root.rs2b0t.runner.start(meta);
        });
    };

    const stopBankSeeder = async (): Promise<void> => {
        await page.evaluate(() => (globalThis as never as {
            rs2b0t: { runner: { stop(): void } };
        }).rs2b0t.runner.stop());
        await page.waitForFunction(() => (globalThis as never as {
            rs2b0t: { runner: { state: string } };
        }).rs2b0t.runner.state === 'stopped', undefined, { timeout: 5000 });
        await closeDialogs();
        await page.waitForTimeout(700);
    };

    await page.goto(`${base}/bot.html?nodeid=10&BoneBurier.boneName=Bones`);
    await boot(page);
    let loggedIn = false;
    for (let attempt = 0; attempt < 5 && !loggedIn; attempt++) {
        loggedIn = await login(page, username);
        if (!loggedIn) {
            await page.waitForTimeout(2500);
        }
    }
    if (!loggedIn) {
        fail(`${username}: initial login failed`);
    }

    await bringUpOffIsland(page, { user: username, typeWaitMs: 700 });
    await teleport('::tele 0,50,53,53,28', { x: 3253, z: 3420, level: 0 });

    // A reused private test account may retain Tutorial Island items. Bank them
    // first so each non-stackable Bones fixture has all 28 inventory slots.
    await closeDialogs();
    await startBankSeeder();
    await page.waitForFunction(() => {
        const root = globalThis as never as {
            __rs2b0t: { Inventory: { used(): number } };
            rs2b0t: { runner: { state: string } };
        };
        if (root.rs2b0t.runner.state === 'crashed') {
            throw new Error('initial inventory bank seeder crashed');
        }
        return root.__rs2b0t.Inventory.used() === 0;
    }, undefined, { timeout: 20_000 });
    await stopBankSeeder();

    for (let batch = 1; batch <= 3; batch++) {
        let gaveBones = false;
        for (let attempt = 0; attempt < 3 && !gaveBones; attempt++) {
            await closeDialogs();
            await sendCheat('give bones 25');
            gaveBones = await page.waitForFunction(() => (globalThis as never as {
                __rs2b0t: { Inventory: { count(name: string): number } };
            }).__rs2b0t.Inventory.count('Bones') > 0, undefined, { timeout: 3000 }).then(() => true).catch(() => false);
        }
        if (!gaveBones) {
            const diagnostic = await page.evaluate(() => {
                const root = globalThis as never as {
                    __rs2b0t: { Inventory: { used(): number; items(): { name: string | null; count: number }[] } };
                    rs2b0t: { client: { staffmodlevel?: number; ingame: boolean }; reader: { worldTile(): unknown } };
                };
                return {
                    ingame: root.rs2b0t.client.ingame,
                    staff: root.rs2b0t.client.staffmodlevel,
                    tile: root.rs2b0t.reader.worldTile(),
                    used: root.__rs2b0t.Inventory.used(),
                    items: root.__rs2b0t.Inventory.items()
                };
            });
            fail(`could not spawn Bones fixture: ${JSON.stringify(diagnostic)}`);
        }
        const inventoryBones = await page.evaluate(() => (globalThis as never as {
            __rs2b0t: { Inventory: { count(name: string): number } };
        }).__rs2b0t.Inventory.count('Bones'));
        const expectedBank = seeded + inventoryBones;

        await startBankSeeder();
        await page.waitForFunction(expected => {
            const root = globalThis as never as {
                __rs2b0t: { Bank: { count(name: string): number } };
                rs2b0t: { runner: { state: string; stop(): void } };
            };
            if (root.rs2b0t.runner.state === 'crashed') {
                throw new Error('bank seeder crashed');
            }
            if (root.__rs2b0t.Bank.count('Bones') >= expected) {
                root.rs2b0t.runner.stop();
                return true;
            }
            return false;
        }, expectedBank, { timeout: 20_000 });
        await stopBankSeeder();
        seeded = expectedBank;
        console.log(`bank fixture batch ${batch}: ${seeded} Bones verified`);
    }
    if (seeded < 56) {
        fail(`bank fixture needs at least two full loads, found ${seeded} Bones`);
    }

    const prayerStart = await page.evaluate(() => {
        const api = (globalThis as never as {
            __rs2b0t: { Skills: { xp(name: string): number } };
        }).__rs2b0t;
        return api.Skills.xp('prayer');
    });

    await startFromLibrary(page, 'Prayer', 'BoneBurier');
    await page.getByRole('button', { name: 'Start', exact: true }).click();

    const sample = (): Promise<Snapshot> => page.evaluate(() => {
        const root = globalThis as never as {
            __rs2b0t: {
                Inventory: { count(name: string): number };
                Skills: { xp(name: string): number };
            };
            rs2b0t: {
                reader: { worldTile(): { x: number; z: number; level: number } | null };
                runner: {
                    state: string;
                    bot: { status?: string; burials?: number; trips?: number } | null;
                    ctx: { log: { msg: string }[] } | null;
                };
            };
        };
        const { runner } = root.rs2b0t;
        return {
            state: runner.state,
            status: runner.bot?.status ?? '',
            burials: runner.bot?.burials ?? 0,
            trips: runner.bot?.trips ?? 0,
            prayerXp: root.__rs2b0t.Skills.xp('prayer'),
            bones: root.__rs2b0t.Inventory.count('Bones'),
            tile: root.rs2b0t.reader.worldTile(),
            log: runner.ctx?.log.map(line => line.msg) ?? []
        };
    });

    const runningDeadline = Date.now() + 180_000;
    let running = await sample();
    while (Date.now() < runningDeadline) {
        running = await sample();
        console.log(`running checkpoint: state=${running.state} status="${running.status}" trips=${running.trips} buried=${running.burials} bones=${running.bones} prayer+${running.prayerXp - prayerStart}`);
        if (running.state === 'crashed' || running.state === 'stopped') {
            await page.screenshot({ path: completeShot, fullPage: true });
            fail(`BoneBurier ended before the running checkpoint: ${JSON.stringify(running)}`);
        }
        if (running.trips >= 2 && running.burials >= 30 && running.prayerXp > prayerStart) {
            break;
        }
        await page.waitForTimeout(3000);
    }
    if (running.trips < 2 || running.burials < 30 || running.prayerXp <= prayerStart) {
        await page.screenshot({ path: completeShot, fullPage: true });
        fail(`timed out before the running checkpoint: ${JSON.stringify(running)}`);
    }
    await page.screenshot({ path: runningShot, fullPage: true });

    const completeDeadline = Date.now() + 300_000;
    let complete = await sample();
    while (Date.now() < completeDeadline) {
        complete = await sample();
        console.log(`completion checkpoint: state=${complete.state} status="${complete.status}" trips=${complete.trips} buried=${complete.burials} bones=${complete.bones} prayer+${complete.prayerXp - prayerStart}`);
        if (complete.state === 'crashed') {
            fail(`BoneBurier crashed: ${JSON.stringify(complete)}`);
        }
        if (complete.state === 'stopped' && complete.burials === seeded) {
            break;
        }
        await page.waitForTimeout(3000);
    }
    const startEnabled = await page.getByRole('button', { name: 'Start', exact: true }).isEnabled();
    await page.screenshot({ path: completeShot, fullPage: true });

    if (running.trips < 2 || running.burials < 30 || running.prayerXp <= prayerStart) {
        fail(`running checkpoint lacked progress: ${JSON.stringify(running)}`);
    }
    if (complete.burials !== seeded || complete.trips < 3 || complete.bones !== 0 ||
        !complete.log.some(line => line.includes("bank is out of exact item 'Bones' — complete.")) || !startEnabled) {
        fail(`completion checkpoint was wrong: ${JSON.stringify({ complete, startEnabled })}`);
    }

    console.log(JSON.stringify({
        result: 'PASS',
        username,
        seeded,
        running: { burials: running.burials, trips: running.trips, prayerXp: running.prayerXp - prayerStart },
        complete: { burials: complete.burials, trips: complete.trips, prayerXp: complete.prayerXp - prayerStart, state: complete.state },
        screenshots: [runningShot, completeShot]
    }, null, 2));
} finally {
    await browser.close();
}
