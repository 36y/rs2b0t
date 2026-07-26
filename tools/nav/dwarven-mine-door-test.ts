import fs from 'node:fs';

import type { Page } from 'playwright-core';

import { boot, bringUpOffIsland, launchBrowser, login, parseArgs } from '../lib/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8890', minutes: 6 });
const nodeId = Number(process.env.TEST_NODE_ID ?? '10');
const username = `dm69${Date.now().toString(36).slice(-7)}`;

const START = { x: 3062, z: 3375, level: 0 } as const;
const PREP = { x: 3065, z: 3379, level: 0 } as const;
const TARGET = { x: 3094, z: 3493, level: 0 } as const;
const ARRIVE_RADIUS = 2;

const DOOR = {
    closedId: 1512,
    closedX: 3063,
    closedZ: 3380,
    openId: 1515,
    openX: 3064,
    openZ: 3380,
    level: 0
} as const;

// This test changes the actual server tick rate to 300 ms. Timeout budgets are
// expressed in server ticks with 2x wall-clock slack, so speeding up the server
// also shortens the test without making its phase budgets less meaningful.
const SERVER_TICK_MS = 300;
const TIMEOUT_FACTOR = 2;
const ticks = (count: number): number => count * SERVER_TICK_MS * TIMEOUT_FACTOR;
const POLL_MS = ticks(1);
const TELEPORT_DEADLINE_MS = ticks(16);
const DOOR_STATE_DEADLINE_MS = ticks(16);
const OPEN_DEADLINE_MS = ticks(75);
const CROSS_DEADLINE_MS = ticks(30);
const CLEAR_DEADLINE_MS = ticks(125);
const FULL_DEADLINE_MS = minutes > 0 ? minutes * 60_000 : ticks(600);

// Values from CollisionFlag. The eastward step from the closed leaf tile to
// (3064,3380) is allowed only when the destination clears PL_WALK_W.
const W_E = 0x8;
const W_W = 0x80;
const PL_WALK_W = 0x280180;

const artifactDir = 'out/dwarven-mine-door-test';
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
type LocSnapshot = { id: number; name: string | null; ops: (string | null)[]; tile: Tile };
type RuntimeSnapshot = {
    tile: Tile | null;
    state: string;
    botStatus: string;
    doors: LocSnapshot[];
    sourceFlags: number | null;
    destinationFlags: number | null;
    sourceEastBlocked: boolean | null;
    destinationWestBlocked: boolean | null;
    edgePassable: boolean | null;
    logs: string[];
    chat: string[];
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
        };
        registry: { get(name: string): unknown };
        reader: {
            worldTile(): Tile | null;
            locs(): LocSnapshot[];
            toLocal(x: number, z: number): { lx: number; lz: number } | null;
            collisionFlags(lx: number, lz: number): number | null;
            chat(count: number): { text: string }[];
        };
    };
    __rs2b0t: {
        Locs: {
            query(): LocQuery;
        };
    };
};

function sameTile(actual: Tile | null, expected: Tile): boolean {
    return actual !== null && actual.x === expected.x && actual.z === expected.z && actual.level === expected.level;
}

function chebyshev(a: Tile, b: Tile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function hex(value: number | null): string {
    return value === null ? 'null' : `0x${value.toString(16)}`;
}

function describe(snapshot: RuntimeSnapshot): string {
    const tile = snapshot.tile ? `(${snapshot.tile.x},${snapshot.tile.z},${snapshot.tile.level})` : 'null';
    const doors = snapshot.doors.map(loc => `${loc.id}@${loc.tile.x},${loc.tile.z},${loc.tile.level}[${loc.ops.filter(Boolean).join('/')}]`).join(' ');
    return (
        `tile=${tile} runner=${snapshot.state} status=${JSON.stringify(snapshot.botStatus)} doors=${doors || '-'} ` +
        `flags=${hex(snapshot.sourceFlags)}->${hex(snapshot.destinationFlags)} ` +
        `eastBlocked=${snapshot.sourceEastBlocked} westBlocked=${snapshot.destinationWestBlocked} passable=${snapshot.edgePassable}`
    );
}

function teleportCommand(tile: Tile): string {
    return `tele ${tile.level},${tile.x >> 6},${tile.z >> 6},${tile.x & 63},${tile.z & 63}`;
}

async function cheat(page: Page, command: string, settleMs: number): Promise<void> {
    const sent = await page.evaluate(cmd => {
        const client = (globalThis as never as Runtime).rs2b0t.client;
        if (!client.ingame || !client.out) return false;
        client.out.p1Enc(224);
        client.out.p1(cmd.length + 1);
        client.out.pjstr(cmd);
        return true;
    }, command);
    if (!sent) fail(`could not send ::${command} (client is not ingame)`);
    record(`sent ::${command}`);
    await page.waitForTimeout(settleMs);
}

const browser = await launchBrowser();
let page: Page | null = null;
let speedChanged = false;

try {
    page = await browser.newPage({ viewport: { width: 1400, height: 920 } });
    page.on('pageerror', error => record(`pageerror: ${error.message}`));
    await page.goto(`${base}/bot.html?nodeid=${nodeId}&WalkTo.customTile=${TARGET.x},${TARGET.z},${TARGET.level}&WalkTo.arriveRadius=${ARRIVE_RADIUS}`);
    await boot(page);

    let loggedIn = false;
    for (let attempt = 0; attempt < 6 && !loggedIn; attempt++) {
        loggedIn = await login(page, username);
        if (!loggedIn) await page.waitForTimeout(ticks(5));
    }
    if (!loggedIn) fail('initial login failed');
    await bringUpOffIsland(page, { user: username, typeWaitMs: ticks(3) });

    const read = (): Promise<RuntimeSnapshot> =>
        page!.evaluate(
            ({ door, east, west, walkWest }): RuntimeSnapshot => {
                const runtime = (globalThis as never as Runtime).rs2b0t;
                const reader = runtime.reader;
                const source = reader.toLocal(door.closedX, door.closedZ);
                const destination = reader.toLocal(door.openX, door.openZ);
                const sourceFlags = source ? reader.collisionFlags(source.lx, source.lz) : null;
                const destinationFlags = destination ? reader.collisionFlags(destination.lx, destination.lz) : null;
                return {
                    tile: reader.worldTile(),
                    state: runtime.runner.state,
                    botStatus: String((runtime.runner.bot as { status?: unknown } | null)?.status ?? ''),
                    doors: reader
                        .locs()
                        .filter(
                            loc =>
                                (loc.id === door.closedId && loc.tile.x === door.closedX && loc.tile.z === door.closedZ && loc.tile.level === door.level) ||
                                (loc.id === door.openId && loc.tile.x === door.openX && loc.tile.z === door.openZ && loc.tile.level === door.level)
                        ),
                    sourceFlags,
                    destinationFlags,
                    sourceEastBlocked: sourceFlags === null ? null : (sourceFlags & east) !== 0,
                    destinationWestBlocked: destinationFlags === null ? null : (destinationFlags & west) !== 0,
                    edgePassable: destinationFlags === null ? null : (destinationFlags & walkWest) === 0,
                    logs: (runtime.runner.ctx?.log ?? []).map(line => line.msg),
                    chat: reader.chat(8).map(line => line.text)
                };
            },
            { door: DOOR, east: W_E, west: W_W, walkWest: PL_WALK_W }
        );

    const exactClosed = (snapshot: RuntimeSnapshot): boolean => snapshot.doors.some(loc => loc.id === DOOR.closedId && loc.tile.x === DOOR.closedX && loc.tile.z === DOOR.closedZ && loc.tile.level === DOOR.level && loc.ops.some(op => op === 'Open'));
    const exactOpen = (snapshot: RuntimeSnapshot): boolean => snapshot.doors.some(loc => loc.id === DOOR.openId && loc.tile.x === DOOR.openX && loc.tile.z === DOOR.openZ && loc.tile.level === DOOR.level && loc.ops.some(op => op === 'Close'));
    const closedAndBlocked = (snapshot: RuntimeSnapshot): boolean => exactClosed(snapshot) && snapshot.sourceEastBlocked === true && snapshot.destinationWestBlocked === true && snapshot.edgePassable === false;
    const openAndPassable = (snapshot: RuntimeSnapshot): boolean => exactOpen(snapshot) && snapshot.sourceEastBlocked === false && snapshot.destinationWestBlocked === false && snapshot.edgePassable === true;

    const waitFor = async (label: string, timeoutMs: number, predicate: (snapshot: RuntimeSnapshot) => boolean): Promise<RuntimeSnapshot> => {
        const deadline = Date.now() + timeoutMs;
        let latest = await read();
        let lastDescription = '';
        while (Date.now() < deadline) {
            const description = describe(latest);
            if (description !== lastDescription) {
                record(`${label}: ${description}`);
                lastDescription = description;
            }
            if (predicate(latest)) return latest;
            await page!.waitForTimeout(POLL_MS);
            latest = await read();
        }
        fail(`${label} timed out after ${timeoutMs}ms; last ${describe(latest)}; chat=${JSON.stringify(latest.chat)}`);
    };

    await cheat(page, 'speed 300', ticks(2));
    speedChanged = true;
    await waitFor('speed 300 acknowledgement', ticks(10), snapshot => snapshot.chat.some(line => line === 'World speed was changed to 300ms'));
    record('PROOF server acknowledged exactly: World speed was changed to 300ms');

    await cheat(page, teleportCommand(PREP), ticks(4));
    await waitFor('prep teleport', TELEPORT_DEADLINE_MS, snapshot => sameTile(snapshot.tile, PREP));

    let precondition = await read();
    if (!closedAndBlocked(precondition)) {
        const closeResult = await page.evaluate(async door => {
            const query = (globalThis as never as Runtime).__rs2b0t.Locs.query();
            const open = query
                .where(loc => {
                    const tile = loc.tile();
                    return loc.id === door.openId && tile.x === door.openX && tile.z === door.openZ && tile.level === door.level;
                })
                .action('Close')
                .nearest();
            if (!open) return { found: false, interacted: false };
            return { found: true, interacted: Boolean(await open.interact('Close')) };
        }, DOOR);
        record(`force-close exact 1515@(3064,3380,0): ${JSON.stringify(closeResult)}`);
        if (!closeResult.found) fail(`exact open-form door ${DOOR.openId}@(${DOOR.openX},${DOOR.openZ},${DOOR.level}) was not found`);
        if (!closeResult.interacted) fail(`exact open-form door ${DOOR.openId}@(${DOOR.openX},${DOOR.openZ},${DOOR.level}) rejected Close`);
        precondition = await waitFor('force closed door', DOOR_STATE_DEADLINE_MS, closedAndBlocked);
    }
    if (!closedAndBlocked(precondition)) fail(`closed-door collision precondition failed: ${describe(precondition)}`);
    record(`PROOF closed+blocked: ${describe(precondition)}`);
    await page.screenshot({ path: `${artifactDir}/01-precondition-closed.jpg`, type: 'jpeg', quality: 86 });

    await cheat(page, teleportCommand(START), ticks(4));
    const startSnapshot = await waitFor('reported start', TELEPORT_DEADLINE_MS, snapshot => sameTile(snapshot.tile, START) && closedAndBlocked(snapshot));
    record(`PROOF exact issue start with door still closed+blocked: ${describe(startSnapshot)}`);
    await page.screenshot({ path: `${artifactDir}/02-start-closed.jpg`, type: 'jpeg', quality: 86 });

    await page.evaluate(() => {
        const runtime = (globalThis as never as Runtime).rs2b0t;
        const script = runtime.registry.get('WalkTo');
        if (!script) throw new Error('WalkTo is not registered');
        runtime.runner.start(script);
    });
    await page.waitForFunction(() => (globalThis as never as Runtime).rs2b0t.runner.state === 'running', undefined, { timeout: ticks(10) });
    record(`started WalkTo from exact (${START.x},${START.z},${START.level}) to Edgeville (${TARGET.x},${TARGET.z},${TARGET.level}), radius ${ARRIVE_RADIUS}`);

    const startedAt = Date.now();
    const fullDeadline = startedAt + FULL_DEADLINE_MS;
    const openDeadline = startedAt + OPEN_DEADLINE_MS;
    let crossDeadline = Number.POSITIVE_INFINITY;
    let clearDeadline = Number.POSITIVE_INFINITY;
    let seenLogs = 0;
    let lastState = '';
    let sawOpenPassable = false;
    let sawCrossLog = false;
    let crossed = false;
    let clearedBuilding = false;
    let sawArrivalLog = false;
    let arrived = false;

    while (Date.now() < fullDeadline) {
        const snapshot = await read();
        if (snapshot.logs.length < seenLogs) seenLogs = 0;
        const newLogs = snapshot.logs.slice(seenLogs);
        for (const line of newLogs) record(`bot: ${line}`);
        seenLogs = snapshot.logs.length;

        const givingUp = newLogs.find(line => /giving up after \d+ repaths/i.test(line));
        if (givingUp) fail(`old issue #69 repath loop reproduced: ${givingUp.trim()}`);

        const stateDescription = describe(snapshot);
        if (stateDescription !== lastState) {
            record(`route: ${stateDescription}`);
            lastState = stateDescription;
        }

        if (!sawOpenPassable && openAndPassable(snapshot)) {
            sawOpenPassable = true;
            crossDeadline = Date.now() + CROSS_DEADLINE_MS;
            record(`PROOF exact 1515 open form and east edge passable: ${describe(snapshot)}`);
        }
        sawCrossLog ||= snapshot.logs.some(line => line.includes("crossed 'Large door' at (3063,3380)"));
        if (!crossed && sawOpenPassable && sawCrossLog) {
            crossed = true;
            clearDeadline = Date.now() + CLEAR_DEADLINE_MS;
            record(`PROOF crossed exact Large door after it opened: ${describe(snapshot)}`);
            await page.screenshot({ path: `${artifactDir}/03-door-open-crossed.jpg`, type: 'jpeg', quality: 86 });
        }

        if (!clearedBuilding && crossed && snapshot.tile && snapshot.tile.level === 0 && snapshot.tile.x <= 3060 && snapshot.tile.z <= 3374) {
            clearedBuilding = true;
            record(`PROOF cleared dwarven-mine building: ${describe(snapshot)}`);
            await page.screenshot({ path: `${artifactDir}/04-cleared-building.jpg`, type: 'jpeg', quality: 86 });
        }

        sawArrivalLog ||= snapshot.logs.some(line => line.includes(`arrived at custom ${TARGET.x},${TARGET.z},${TARGET.level}`));
        arrived = clearedBuilding && snapshot.tile !== null && snapshot.tile.level === TARGET.level && chebyshev(snapshot.tile, TARGET) <= ARRIVE_RADIUS && sawArrivalLog;
        if (arrived) {
            record(`PROOF arrived Edgeville within radius ${ARRIVE_RADIUS}: ${describe(snapshot)}`);
            await page.screenshot({ path: `${artifactDir}/05-edgeville-arrived.jpg`, type: 'jpeg', quality: 86 });
            break;
        }

        const now = Date.now();
        if (!sawOpenPassable && now >= openDeadline) fail(`door did not become exact open form + passable within ${OPEN_DEADLINE_MS}ms`);
        if (sawOpenPassable && !crossed && now >= crossDeadline) fail(`door opened but exact crossing log was not seen within ${CROSS_DEADLINE_MS}ms`);
        if (crossed && !clearedBuilding && now >= clearDeadline) fail(`crossed door but did not clear the building within ${CLEAR_DEADLINE_MS}ms`);
        if (snapshot.state !== 'running') fail(`WalkTo stopped before arrival: ${describe(snapshot)}; chat=${JSON.stringify(snapshot.chat)}`);
        await page.waitForTimeout(POLL_MS);
    }

    if (!sawOpenPassable) fail('never proved exact door open with collision passable');
    if (!crossed) fail('never proved crossing of exact Large door');
    if (!clearedBuilding) fail('never proved the bot cleared the dwarven-mine building');
    if (!arrived) {
        const finalSnapshot = await read();
        fail(`did not arrive in Edgeville within ${FULL_DEADLINE_MS}ms: ${describe(finalSnapshot)}; chat=${JSON.stringify(finalSnapshot.chat)}`);
    }
    record(`PASS issue #69: closed collision -> open/passable -> crossed -> cleared building -> Edgeville; artifacts=${artifactDir}`);
} catch (error) {
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
    record(`FAIL issue #69: ${message}`);
    if (page && !page.isClosed()) {
        await page.screenshot({ path: `${artifactDir}/99-failure.jpg`, type: 'jpeg', quality: 86 }).catch(screenshotError => {
            record(`failure screenshot unavailable: ${String(screenshotError)}`);
        });
    }
    throw error;
} finally {
    if (speedChanged && page && !page.isClosed()) {
        await cheat(page, 'speed 600', ticks(1)).then(
            () => record('restored server tick rate with ::speed 600'),
            error => record(`WARNING could not restore ::speed 600: ${String(error)}`)
        );
    }
    await browser.close();
}
