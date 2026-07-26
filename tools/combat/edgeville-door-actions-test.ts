import fs from 'node:fs';

import type { Page } from 'playwright-core';

import { boot, bringUpOffIsland, launchBrowser, login, parseArgs, startFromLibrary } from '../lib/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8890' });
const nodeId = Number(process.env.TEST_NODE_ID ?? '10');
const username = `d71${Date.now().toString(36).slice(-7)}`;

const START = { x: 3101, z: 3510, level: 0 } as const;
const TARGET = { x: 3097, z: 3512, level: 0 } as const;
const DOOR_PREP = { x: 3100, z: 3511, level: 0 } as const;
const TARGET_NAME = 'Goblin guard';
const TARGET_DEBUG_NAME = 'goblin_guard';
const DROP_NAME = 'Uncut sapphire';

const CLOSED_DOORS = [
    { id: 1516, x: 3101, z: 3509 },
    { id: 1519, x: 3101, z: 3510 }
] as const;
const OPEN_DOORS = [
    { id: 1517, x: 3100, z: 3509 },
    { id: 1520, x: 3100, z: 3510 }
] as const;

const SERVER_TICK_MS = 300;
const TIMEOUT_FACTOR = 2;
const ticks = (count: number): number => count * SERVER_TICK_MS * TIMEOUT_FACTOR;
const POLL_MS = ticks(1);

const W_E = 0x8;
const W_W = 0x80;

const artifactDir = 'out/edgeville-door-actions-test';
const logPath = `${artifactDir}/run.log`;
fs.mkdirSync(artifactDir, { recursive: true });
fs.writeFileSync(logPath, '');

function record(message: string): void {
    const line = `[${new Date().toISOString()}] ${message}`;
    console.log(line);
    fs.appendFileSync(logPath, `${line}\n`);
}

function fail(message: string): never {
    throw new Error(message);
}

type Tile = { x: number; z: number; level: number };
type NpcSnapshot = { index: number; id: number; name: string | null; tile: Tile; inCombat: boolean };
type LocSnapshot = { typecode: number; id: number; name: string | null; ops: (string | null)[]; tile: Tile };
type GroundItemSnapshot = { id: number; name: string | null; count: number; tile: Tile };
type InvItemSnapshot = { id: number; name: string | null; count: number; slot: number; comId: number; ops: (string | null)[] };

type InteractionCall =
    | { kind: 'npc'; at: number; index: number; op: number }
    | { kind: 'loc'; at: number; x: number; z: number; level: number; id: number; typecode: number; op: number }
    | { kind: 'obj'; at: number; x: number; z: number; level: number; id: number; op: number };

type InputDriver = {
    interactNpc(index: number, op: number): boolean | Promise<boolean>;
    interactLoc(lx: number, lz: number, typecode: number, op: number): boolean | Promise<boolean>;
    takeObj(lx: number, lz: number, id: number, op: number): boolean | Promise<boolean>;
};

type LocEntity = {
    id: number;
    tile(): Tile;
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;
};

type LocQuery = {
    action(action: string): LocQuery;
    where(predicate: (loc: LocEntity) => boolean): LocQuery;
    nearest(): LocEntity | null;
};

type InvItem = {
    name: string | null;
    interact(action: string): boolean | Promise<boolean>;
};

type Runtime = {
    rs2b0t: {
        client: {
            ingame: boolean;
            out: { p1Enc(op: number): void; p1(value: number): void; pjstr(value: string): void } | null;
        };
        runner: {
            state: string;
            bot: Record<string, unknown> | null;
            ctx: { log: { msg: string }[] } | null;
            start(script: unknown): void;
            stop(): void;
        };
        registry: { get(name: string): unknown };
        reader: {
            worldTile(): Tile | null;
            npcs(): NpcSnapshot[];
            locs(): LocSnapshot[];
            groundItems(): GroundItemSnapshot[];
            inventory(): InvItemSnapshot[];
            inCombat(): boolean;
            chat(count: number): { text: string }[];
            stat(index: number): { xp: number };
            toLocal(x: number, z: number): { lx: number; lz: number } | null;
            toWorld(lx: number, lz: number): Tile | null;
            collisionFlags(lx: number, lz: number): number | null;
        };
        router: { driver: InputDriver };
        actions?: { continueDialog?: () => boolean };
    };
    __rs2b0t: {
        Locs: { query(): LocQuery };
        Inventory: { items(): InvItem[] };
    };
    __issue71Calls?: InteractionCall[];
    __issue71OriginalDriver?: {
        npc: InputDriver['interactNpc'];
        loc: InputDriver['interactLoc'];
        obj: InputDriver['takeObj'];
    };
};

type Snapshot = {
    tile: Tile | null;
    state: string;
    status: string;
    inCombat: boolean;
    combatXp: number;
    doors: LocSnapshot[];
    upperEastFlags: number | null;
    upperWestFlags: number | null;
    calls: InteractionCall[];
    cantReach: number;
    chat: string[];
    logs: string[];
    npcs: NpcSnapshot[];
    ground: GroundItemSnapshot[];
    inventoryDropCount: number;
};

function sameTile(actual: Tile | null, expected: Tile): boolean {
    return actual !== null && actual.x === expected.x && actual.z === expected.z && actual.level === expected.level;
}

function teleportCommand(tile: Tile): string {
    return `tele ${tile.level},${tile.x >> 6},${tile.z >> 6},${tile.x & 63},${tile.z & 63}`;
}

function describe(snapshot: Snapshot): string {
    const tile = snapshot.tile ? `(${snapshot.tile.x},${snapshot.tile.z},${snapshot.tile.level})` : 'null';
    const doors = snapshot.doors.map(loc => `${loc.id}@${loc.tile.x},${loc.tile.z}[${loc.ops.filter(Boolean).join('/')}]`).join(' ');
    return `tile=${tile} runner=${snapshot.state} status=${JSON.stringify(snapshot.status)} combat=${snapshot.inCombat} doors=${doors || '-'} cantReach=${snapshot.cantReach} calls=${snapshot.calls.length}`;
}

async function cheat(page: Page, command: string, settleMs = ticks(2)): Promise<void> {
    const sent = await page.evaluate(cmd => {
        const client = (globalThis as never as Runtime).rs2b0t.client;
        if (!client.ingame || !client.out) return false;
        client.out.p1Enc(224);
        client.out.p1(cmd.length + 1);
        client.out.pjstr(cmd);
        return true;
    }, command);
    if (!sent) fail(`could not send ::${command}`);
    record(`sent ::${command}`);
    await page.waitForTimeout(settleMs);
}

async function clearDialogs(page: Page): Promise<void> {
    await page.evaluate(async () => {
        const actions = (globalThis as never as Runtime).rs2b0t.actions;
        for (let i = 0; i < 30; i++) {
            actions?.continueDialog?.();
            await new Promise(resolve => setTimeout(resolve, 60));
        }
    });
}

async function installProbe(page: Page): Promise<void> {
    await page.evaluate(() => {
        const root = globalThis as never as Runtime;
        if (root.__issue71OriginalDriver) throw new Error('issue #71 interaction probe is already installed');
        const runtime = root.rs2b0t;
        const driver = runtime.router.driver;
        const original = {
            npc: driver.interactNpc,
            loc: driver.interactLoc,
            obj: driver.takeObj
        };
        root.__issue71Calls = [];
        root.__issue71OriginalDriver = original;

        driver.interactNpc = function (this: InputDriver, index: number, op: number): boolean | Promise<boolean> {
            root.__issue71Calls!.push({ kind: 'npc', at: Date.now(), index, op });
            return original.npc.call(this, index, op);
        };
        driver.interactLoc = function (this: InputDriver, lx: number, lz: number, typecode: number, op: number): boolean | Promise<boolean> {
            const world = runtime.reader.toWorld(lx, lz) ?? { x: -1, z: -1, level: -1 };
            root.__issue71Calls!.push({ kind: 'loc', at: Date.now(), ...world, id: (typecode >> 14) & 0x7fff, typecode, op });
            return original.loc.call(this, lx, lz, typecode, op);
        };
        driver.takeObj = function (this: InputDriver, lx: number, lz: number, id: number, op: number): boolean | Promise<boolean> {
            const world = runtime.reader.toWorld(lx, lz) ?? { x: -1, z: -1, level: -1 };
            root.__issue71Calls!.push({ kind: 'obj', at: Date.now(), ...world, id, op });
            return original.obj.call(this, lx, lz, id, op);
        };
    });
}

async function restoreProbe(page: Page): Promise<void> {
    await page.evaluate(() => {
        const root = globalThis as never as Runtime;
        const original = root.__issue71OriginalDriver;
        if (!original) return;
        const driver = root.rs2b0t.router.driver;
        driver.interactNpc = original.npc;
        driver.interactLoc = original.loc;
        driver.takeObj = original.obj;
        delete root.__issue71OriginalDriver;
        delete root.__issue71Calls;
    });
}

async function resetCalls(page: Page): Promise<void> {
    await page.evaluate(() => { (globalThis as never as Runtime).__issue71Calls = []; });
}

const browser = await launchBrowser();
let page: Page | null = null;
let speedChanged = false;

try {
    page = await browser.newPage({ viewport: { width: 1400, height: 920 } });
    page.on('pageerror', error => record(`pageerror: ${error.message}`));

    const params = new URLSearchParams({
        nodeid: String(nodeId),
        'AutoFighter.target': TARGET_NAME,
        'AutoFighter.spot': 'Custom coordinates',
        'AutoFighter.coordinates': `${TARGET.x},${TARGET.z},${TARGET.level}`,
        'AutoFighter.leashRadius': '8',
        'AutoFighter.foodWithdraw': '0',
        'AutoFighter.eatAtHp': '0',
        'AutoFighter.panicHp': '0',
        'AutoFighter.solveClues': 'false',
        'AutoFighter.banking': 'None',
        'AutoFighter.loot': DROP_NAME,
        'ChickenKiller.targetName': 'No such npc',
        'ChickenKiller.lootMatch': DROP_NAME,
        'ChickenKiller.buryBones': 'false',
        'ChickenKiller.fightHpGate': '0',
        'ChickenKiller.bankStrategy': 'Off',
        'ChickenKiller.leashRadius': '12'
    });
    await page.goto(`${base}/bot.html?${params}`);
    await boot(page);

    let loggedIn = false;
    for (let attempt = 0; attempt < 6 && !loggedIn; attempt++) {
        loggedIn = await login(page, username);
        if (!loggedIn) await page.waitForTimeout(ticks(5));
    }
    if (!loggedIn) fail('initial login failed');
    await bringUpOffIsland(page, { user: username, typeWaitMs: ticks(3) });
    await clearDialogs(page);
    await cheat(page, '~maxme');
    await clearDialogs(page);

    await cheat(page, 'speed 300');
    speedChanged = true;

    const read = (): Promise<Snapshot> => page!.evaluate(dropName => {
        const root = globalThis as never as Runtime;
        const reader = root.rs2b0t.reader;
        const east = reader.toLocal(3101, 3510);
        const west = reader.toLocal(3100, 3510);
        const chat = reader.chat(100).map(line => line.text);
        return {
            tile: reader.worldTile(),
            state: root.rs2b0t.runner.state,
            status: String((root.rs2b0t.runner.bot as { status?: unknown } | null)?.status ?? ''),
            inCombat: reader.inCombat(),
            combatXp: [0, 1, 2, 3].reduce((sum, index) => sum + reader.stat(index).xp, 0),
            doors: reader.locs().filter(loc => [1516, 1517, 1519, 1520].includes(loc.id) && loc.tile.x >= 3100 && loc.tile.x <= 3101 && loc.tile.z >= 3509 && loc.tile.z <= 3510),
            upperEastFlags: east ? reader.collisionFlags(east.lx, east.lz) : null,
            upperWestFlags: west ? reader.collisionFlags(west.lx, west.lz) : null,
            calls: [...(root.__issue71Calls ?? [])],
            cantReach: chat.filter(line => /^i can't reach that/i.test(line)).length,
            chat,
            logs: (root.rs2b0t.runner.ctx?.log ?? []).map(line => line.msg),
            npcs: reader.npcs(),
            ground: reader.groundItems(),
            inventoryDropCount: reader.inventory().filter(item => (item.name ?? '').toLowerCase() === dropName.toLowerCase()).reduce((sum, item) => sum + Math.max(1, item.count), 0)
        };
    }, DROP_NAME);

    const waitFor = async (label: string, timeoutMs: number, predicate: (snapshot: Snapshot) => boolean): Promise<Snapshot> => {
        const deadline = Date.now() + timeoutMs;
        let latest = await read();
        let last = '';
        while (Date.now() < deadline) {
            const description = describe(latest);
            if (description !== last) {
                record(`${label}: ${description}`);
                last = description;
            }
            if (predicate(latest)) return latest;
            await page!.waitForTimeout(POLL_MS);
            latest = await read();
        }
        fail(`${label} timed out after ${timeoutMs}ms; last ${describe(latest)}; logs=${JSON.stringify(latest.logs.slice(-12))}`);
    };

    const exactClosed = (snapshot: Snapshot): boolean => CLOSED_DOORS.every(expected => snapshot.doors.some(loc => loc.id === expected.id && loc.tile.x === expected.x && loc.tile.z === expected.z && loc.tile.level === 0 && loc.ops.some(op => op === 'Open')));
    const exactOpen = (snapshot: Snapshot): boolean => OPEN_DOORS.every(expected => snapshot.doors.some(loc => loc.id === expected.id && loc.tile.x === expected.x && loc.tile.z === expected.z && loc.tile.level === 0 && loc.ops.some(op => op === 'Close')));
    const closedAndBlocked = (snapshot: Snapshot): boolean => exactClosed(snapshot) && snapshot.upperEastFlags !== null && snapshot.upperWestFlags !== null && (snapshot.upperEastFlags & W_W) !== 0 && (snapshot.upperWestFlags & W_E) !== 0;
    const openAndPassable = (snapshot: Snapshot): boolean => exactOpen(snapshot) && snapshot.upperEastFlags !== null && snapshot.upperWestFlags !== null && (snapshot.upperEastFlags & W_W) === 0 && (snapshot.upperWestFlags & W_E) === 0;

    const teleport = async (tile: Tile): Promise<Snapshot> => {
        await cheat(page!, teleportCommand(tile), ticks(3));
        return waitFor(`teleport ${tile.x},${tile.z}`, ticks(16), snapshot => sameTile(snapshot.tile, tile));
    };

    const forceClosed = async (): Promise<Snapshot> => {
        await teleport(DOOR_PREP);
        let snapshot = await read();
        if (!closedAndBlocked(snapshot)) {
            const result = await page!.evaluate(async openDoors => {
                const abi = (globalThis as never as Runtime).__rs2b0t;
                const open = abi.Locs.query()
                    .where(loc => openDoors.some(expected => {
                        const tile = loc.tile();
                        return loc.id === expected.id && tile.x === expected.x && tile.z === expected.z && tile.level === 0;
                    }))
                    .action('Close')
                    .nearest();
                return open ? Boolean(await open.interact('Close')) : false;
            }, OPEN_DOORS);
            if (!result) fail(`could not close the exact Edgeville Large door pair: ${describe(snapshot)}`);
            snapshot = await waitFor('force exact doors closed', ticks(16), closedAndBlocked);
        }
        if (!closedAndBlocked(snapshot)) fail(`closed-door precondition failed: ${describe(snapshot)}`);
        return snapshot;
    };

    await waitFor('speed 300 acknowledgement', ticks(10), snapshot => snapshot.chat.some(line => line === 'World speed was changed to 300ms'));
    record('PROOF server acknowledged exactly: World speed was changed to 300ms');

    await forceClosed();
    await teleport(TARGET);
    const targetIndexesBefore = new Set((await read()).npcs.filter(npc => npc.name === TARGET_NAME).map(npc => npc.index));
    await cheat(page, `npcadd ${TARGET_DEBUG_NAME}`, ticks(2));
    const spawned = await waitFor('spawn exact target', ticks(16), snapshot => snapshot.npcs.some(npc => npc.name === TARGET_NAME && sameTile(npc.tile, TARGET) && !targetIndexesBefore.has(npc.index)));
    const targetNpc = spawned.npcs.find(npc => npc.name === TARGET_NAME && sameTile(npc.tile, TARGET) && !targetIndexesBefore.has(npc.index));
    if (!targetNpc) fail(`could not identify the exact spawned ${TARGET_NAME} target`);
    record(`PROOF spawned stationary ${TARGET_NAME}#${targetNpc.index} at exact (${TARGET.x},${TARGET.z},${TARGET.level})`);

    await teleport(START);
    const attackPrecondition = await waitFor('attack precondition', ticks(16), snapshot => sameTile(snapshot.tile, START) && closedAndBlocked(snapshot) && snapshot.npcs.some(npc => npc.index === targetNpc.index && sameTile(npc.tile, TARGET)));
    record(`PROOF issue #71 precondition: ${describe(attackPrecondition)} target=${TARGET_NAME}#${targetNpc.index}@(${TARGET.x},${TARGET.z},${TARGET.level})`);
    await page.screenshot({ path: `${artifactDir}/01-attack-precondition-closed.jpg`, type: 'jpeg', quality: 86 });

    await startFromLibrary(page, 'Combat', 'AutoFighter');
    await installProbe(page);
    await resetCalls(page);
    const attackCantReachBefore = (await read()).cantReach;
    const attackXpBefore = (await read()).combatXp;
    await page.evaluate(() => {
        const runtime = (globalThis as never as Runtime).rs2b0t;
        const script = runtime.registry.get('AutoFighter');
        if (!script) throw new Error('AutoFighter is not registered');
        runtime.runner.start(script);
    });
    record(`started AutoFighter at the exact reported tile against the pinned ${TARGET_NAME} behind the shut doors`);

    const attackResult = await waitFor('door-aware attack', ticks(100), snapshot => {
        const gained = snapshot.combatXp > attackXpBefore;
        return openAndPassable(snapshot) && (snapshot.inCombat || gained);
    });
    const attackCantReach = attackResult.cantReach - attackCantReachBefore;
    const npcCalls = attackResult.calls.filter((call): call is Extract<InteractionCall, { kind: 'npc' }> => call.kind === 'npc');
    const doorCalls = attackResult.calls.filter((call): call is Extract<InteractionCall, { kind: 'loc' }> => call.kind === 'loc' && CLOSED_DOORS.some(door => call.id === door.id && call.x === door.x && call.z === door.z) && call.op === 1);
    if (attackCantReach < 1 || attackCantReach > 2) fail(`expected one bounded authoritative can't-reach during attack, got ${attackCantReach}`);
    if (npcCalls.length < 2 || npcCalls.some(call => call.index !== targetNpc.index)) fail(`attack did not retry only the pinned ${TARGET_NAME}#${targetNpc.index}: ${JSON.stringify(npcCalls)}`);
    if (doorCalls.length !== 1) fail(`expected exactly one Open interaction on the reported door pair, got ${JSON.stringify(doorCalls)}`);
    if (!attackResult.logs.some(line => /opening blocking 'Large door'/.test(line))) fail(`missing door-recovery log: ${JSON.stringify(attackResult.logs.slice(-12))}`);
    record(`PROOF attack recovered: can't-reach=${attackCantReach}, ${TARGET_NAME} interactions=${npcCalls.length}, exact door Opens=${doorCalls.length}, combatXp=${attackResult.combatXp - attackXpBefore}`);
    await page.screenshot({ path: `${artifactDir}/02-attack-recovered.jpg`, type: 'jpeg', quality: 86 });

    await page.evaluate(() => (globalThis as never as Runtime).rs2b0t.runner.stop());
    await waitFor('AutoFighter stopped', ticks(100), snapshot => snapshot.state === 'stopped');
    await waitFor('combat settled after stop', ticks(100), snapshot => !snapshot.inCombat);
    await page.waitForTimeout(ticks(3));
    if ((await read()).inCombat) fail('combat resumed after AutoFighter reached stopped state');

    await forceClosed();
    await teleport(TARGET);
    await cheat(page, `give ${DROP_NAME.toLowerCase().replaceAll(' ', '_')}`, ticks(2));
    const dropped = await page.evaluate(async dropName => {
        const item = (globalThis as never as Runtime).__rs2b0t.Inventory.items().find(entry => (entry.name ?? '').toLowerCase() === dropName.toLowerCase());
        return item ? Boolean(await item.interact('Drop')) : false;
    }, DROP_NAME);
    if (!dropped) fail(`could not drop ${DROP_NAME} at the exact target tile`);
    await waitFor('ground drop appears', ticks(16), snapshot => snapshot.ground.some(item => item.name === DROP_NAME && sameTile(item.tile, TARGET)) && snapshot.inventoryDropCount === 0);
    record(`PROOF owner-visible ${DROP_NAME} seeded at exact (${TARGET.x},${TARGET.z},${TARGET.level})`);

    await teleport(START);
    const lootPrecondition = await waitFor('loot precondition', ticks(16), snapshot => sameTile(snapshot.tile, START) && closedAndBlocked(snapshot) && snapshot.ground.some(item => item.name === DROP_NAME && sameTile(item.tile, TARGET)));
    record(`PROOF Cow-shared loot precondition: ${describe(lootPrecondition)} drop=${DROP_NAME}@(${TARGET.x},${TARGET.z},${TARGET.level})`);
    await page.screenshot({ path: `${artifactDir}/03-loot-precondition-closed.jpg`, type: 'jpeg', quality: 86 });

    await startFromLibrary(page, 'Combat', 'ChickenKiller');
    await resetCalls(page);
    const lootCantReachBefore = (await read()).cantReach;
    await page.evaluate(() => {
        const runtime = (globalThis as never as Runtime).rs2b0t;
        const script = runtime.registry.get('ChickenKiller');
        if (!script) throw new Error('ChickenKiller is not registered');
        runtime.runner.start(script);
    });
    record('started ChickenKiller with Cow-shared LootDrops against the pinned ground item behind the shut doors');

    const lootResult = await waitFor('door-aware Cow-shared loot', ticks(100), snapshot => snapshot.inventoryDropCount > 0 && openAndPassable(snapshot));
    const lootCantReach = lootResult.cantReach - lootCantReachBefore;
    const takeCalls = lootResult.calls.filter((call): call is Extract<InteractionCall, { kind: 'obj' }> => call.kind === 'obj' && call.x === TARGET.x && call.z === TARGET.z);
    const lootDoorCalls = lootResult.calls.filter((call): call is Extract<InteractionCall, { kind: 'loc' }> => call.kind === 'loc' && CLOSED_DOORS.some(door => call.id === door.id && call.x === door.x && call.z === door.z) && call.op === 1);
    if (lootCantReach < 1 || lootCantReach > 2) fail(`expected one bounded authoritative can't-reach during loot, got ${lootCantReach}`);
    if (takeCalls.length < 2 || takeCalls.some(call => call.id !== lootPrecondition.ground.find(item => item.name === DROP_NAME && sameTile(item.tile, TARGET))?.id)) fail(`loot did not retry only the pinned ${DROP_NAME}: ${JSON.stringify(takeCalls)}`);
    if (lootDoorCalls.length !== 1) fail(`expected exactly one door Open interaction during loot, got ${JSON.stringify(lootDoorCalls)}`);
    if (!lootResult.logs.some(line => /opening blocking 'Large door'/.test(line))) fail(`missing Cow-shared loot recovery log: ${JSON.stringify(lootResult.logs.slice(-12))}`);
    record(`PROOF Cow-shared loot recovered: can't-reach=${lootCantReach}, Take interactions=${takeCalls.length}, exact door Opens=${lootDoorCalls.length}, inventory ${DROP_NAME}=${lootResult.inventoryDropCount}`);
    await page.screenshot({ path: `${artifactDir}/04-loot-recovered.jpg`, type: 'jpeg', quality: 86 });

    record('PASS: issue #71 AutoFighter Attack and Cow-shared LootDrops both recover through the exact Edgeville Large door pair');
} catch (error) {
    record(`FAIL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
} finally {
    if (page) {
        await page.evaluate(() => (globalThis as never as Runtime).rs2b0t.runner.stop()).catch(() => {});
        if (speedChanged) await cheat(page, 'speed 600').catch(error => record(`could not restore ::speed 600: ${String(error)}`));
        await restoreProbe(page).catch(error => record(`could not restore interaction probe: ${String(error)}`));
    }
    await browser.close();
}
