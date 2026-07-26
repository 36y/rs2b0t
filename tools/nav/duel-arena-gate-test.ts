import fs from 'node:fs';

import type { Page } from 'playwright-core';

import { boot, bringUpOffIsland, launchBrowser, login } from '../lib/harness.js';

type Direction = 'west-to-east' | 'east-to-west';
type LeafId = 3197 | 3198;
type Tile = { x: number; z: number; level: number };

interface Options {
    base: string;
    minutes: number;
    leafId: LeafId;
    direction: Direction;
}

interface GateCase {
    requestedLeafId: LeafId;
    requestedZ: 3234 | 3235;
    direction: Direction;
    start: Tile;
    target: Tile;
    workaroundLeafId: 3197;
    workaroundZ: 3234;
}

interface LocSnapshot {
    typecode: number;
    id: number;
    name: string | null;
    ops: (string | null)[];
    tile: Tile;
}

interface InteractionAttempt {
    sequence: number;
    monotonicMs: number;
    lx: number;
    lz: number;
    typecode: number;
    id: number;
    tile: Tile | null;
    op: number;
    action: string | null;
    result: boolean | null;
    error: string | null;
}

interface PlannedTransport {
    locName: string;
    action: string;
    locX: number;
    locZ: number;
    locId?: number;
}

interface PlanEvidence {
    ok: boolean;
    reason?: string;
    terminal?: Tile;
    transports: PlannedTransport[];
}

interface EdgeSnapshot {
    z: 3234 | 3235;
    westFlags: number | null;
    eastFlags: number | null;
    westEastWallBlocked: boolean | null;
    eastWestWallBlocked: boolean | null;
    westToEastPassable: boolean | null;
    eastToWestPassable: boolean | null;
    passable: boolean | null;
}

interface RuntimeSnapshot {
    tile: Tile | null;
    runnerState: string;
    botStatus: string;
    closedLeaves: LocSnapshot[];
    upperEdge: EdgeSnapshot;
    lowerEdge: EdgeSnapshot;
    logs: string[];
    chat: string[];
    interactions: InteractionAttempt[];
}

interface Observation {
    at: string;
    label: string;
    snapshot: RuntimeSnapshot;
}

interface RunArtifact {
    schemaVersion: 1;
    case: GateCase;
    serverTickMs: number;
    engineConstraint: {
        freshWorldRequired: true;
        sameWorldForceCloseSupported: false;
        workaroundLeafId: 3197;
        excludedLeafId: 3198;
        expectedScriptError: string;
        detail: string;
    };
    startedAt: string;
    finishedAt?: string;
    passed: boolean;
    speed300Acknowledged: boolean;
    speed600Restored: boolean;
    expected3197Typecode?: number;
    plan?: PlanEvidence;
    sawExact3197Plan: boolean;
    sawExact3197Interaction: boolean;
    sawExpectedEngineError: boolean;
    sawUpperOpenPassable: boolean;
    sawLowerStillClosedBlocked: boolean;
    sawExactCrossLog: boolean;
    sawSignedUpperFarSide: boolean;
    arrivedExactRequestedTarget: boolean;
    observations: Observation[];
    interactions: InteractionAttempt[];
    screenshots: string[];
    finalSnapshot?: RuntimeSnapshot;
    error?: string;
}

type InputDriver = {
    interactLoc(lx: number, lz: number, typecode: number, op: number): boolean | Promise<boolean>;
};

type InteractionProbe = {
    original: InputDriver['interactLoc'];
    attempts: InteractionAttempt[];
    restored: boolean;
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
        navigator: {
            findPath(from: Tile, to: Tile): Promise<{ ok: true; waypoints: { x: number; z: number; level: number; transport?: PlannedTransport }[] } | { ok: false; reason: string }>;
        };
        reader: {
            worldTile(): Tile | null;
            locs(): LocSnapshot[];
            toLocal(x: number, z: number): { lx: number; lz: number } | null;
            toWorld(lx: number, lz: number): Tile | null;
            collisionFlags(lx: number, lz: number): number | null;
            chat(count: number): { text: string }[];
        };
        router: { driver: InputDriver };
    };
    __duelGateProbe?: InteractionProbe;
};

const SERVER_TICK_MS = 300;
const TIMEOUT_FACTOR = 2;
const ticks = (count: number): number => count * SERVER_TICK_MS * TIMEOUT_FACTOR;
const POLL_MS = SERVER_TICK_MS / 2;
const TELEPORT_DEADLINE_MS = ticks(16);
const FRESH_CLOSED_DEADLINE_MS = ticks(16);
const OPEN_DEADLINE_MS = ticks(50);

// Values from CollisionFlag. The closed wall is between the west stand tile
// (3311,z) and the loc tile (3312,z). Entering the loc tile eastbound requires
// it to clear PL_WALK_W; the reverse step requires PL_WALK_E on the west tile.
const W_E = 0x8;
const W_W = 0x80;
const PL_WALK_E = 0x280108;
const PL_WALK_W = 0x280180;

const GATE_X = 3312;
const CLOSED_LEAVES = [
    { id: 3197 as const, x: GATE_X, z: 3234 as const, level: 0 as const },
    { id: 3198 as const, x: GATE_X, z: 3235 as const, level: 0 as const }
];

// The packed Engine has no usable server next_loc_stage for this pair. Its
// stable current behavior is narrow but useful: opening 3197 removes that
// upper leaf and clears its edge, emits the exact error below, and leaves 3198
// closed with the lower edge blocked. Production navigation therefore excludes
// 3198 and intentionally detours every requested row through 3197. A fresh
// isolated world remains mandatory because this partial mutation is persistent.
const EXPECTED_ENGINE_ERROR = 'script error: loc_add An input for a Loc type was not valid to use. Input was -1.';
const ENGINE_CONSTRAINT = 'Current Engine removes only Gate#3197, opens the upper edge, leaves Gate#3198/lower edge closed, then emits the known loc_add type -1 script error. Restart the isolated Engine before every case.';

function usage(): string {
    return [
        'usage: bun tools/nav/duel-arena-gate-test.ts --leaf <3197|3198> --direction <west-to-east|east-to-west> [--base <url>] [--minutes <n>]',
        '',
        '--leaf selects the requested destination row; every case must use Gate#3197 at z=3234.',
        'Run exactly one case per freshly restarted isolated Engine:',
        '  --leaf 3197 --direction west-to-east',
        '  --leaf 3197 --direction east-to-west',
        '  --leaf 3198 --direction west-to-east',
        '  --leaf 3198 --direction east-to-west'
    ].join('\n');
}

function parseArgs(argv: string[]): Options {
    let base = 'http://localhost:8890';
    let minutes = 2;
    let leafId: LeafId | undefined;
    let direction: Direction | undefined;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--base' && argv[i + 1]) {
            base = argv[++i];
        } else if (arg === '--minutes' && argv[i + 1]) {
            minutes = Number(argv[++i]);
        } else if (arg === '--leaf' && argv[i + 1]) {
            const value = Number(argv[++i]);
            if (value === 3197 || value === 3198) leafId = value;
            else throw new Error(`--leaf must be 3197 or 3198 (got ${value})\n${usage()}`);
        } else if (arg === '--direction' && argv[i + 1]) {
            const value = argv[++i];
            if (value === 'west-to-east' || value === 'east-to-west') direction = value;
            else throw new Error(`invalid --direction ${JSON.stringify(value)}\n${usage()}`);
        } else if (arg === '--help') {
            console.log(usage());
            process.exit(0);
        } else {
            throw new Error(`unknown or incomplete argument: ${arg}\n${usage()}`);
        }
    }

    if (!Number.isFinite(minutes) || minutes <= 0) {
        throw new Error(`--minutes must be positive (got ${minutes})`);
    }
    if (leafId === undefined || direction === undefined) {
        throw new Error(`--leaf and --direction are required\n${usage()}`);
    }
    return { base, minutes, leafId, direction };
}

function selectedCase(opts: Options): GateCase {
    const z = opts.leafId === 3197 ? 3234 : 3235;
    const west = { x: 3311, z, level: 0 } as const;
    const east = { x: 3313, z, level: 0 } as const;
    return {
        requestedLeafId: opts.leafId,
        requestedZ: z,
        direction: opts.direction,
        start: opts.direction === 'west-to-east' ? west : east,
        target: opts.direction === 'west-to-east' ? east : west,
        workaroundLeafId: 3197,
        workaroundZ: 3234
    };
}

function sameTile(actual: Tile | null, expected: Tile): boolean {
    return actual !== null && actual.x === expected.x && actual.z === expected.z && actual.level === expected.level;
}

function exactLeaf(snapshot: RuntimeSnapshot, id: LeafId): LocSnapshot | undefined {
    const expected = CLOSED_LEAVES.find(leaf => leaf.id === id)!;
    return snapshot.closedLeaves.find(loc => loc.id === id && sameTile(loc.tile, expected));
}

function isBlocked(edge: EdgeSnapshot): boolean {
    return edge.westEastWallBlocked === true && edge.eastWestWallBlocked === true && edge.westToEastPassable === false && edge.eastToWestPassable === false && edge.passable === false;
}

function isPassable(edge: EdgeSnapshot): boolean {
    return edge.westEastWallBlocked === false && edge.eastWestWallBlocked === false && edge.westToEastPassable === true && edge.eastToWestPassable === true && edge.passable === true;
}

function isFreshClosed(snapshot: RuntimeSnapshot): boolean {
    return (
        CLOSED_LEAVES.every(leaf => {
            const loc = snapshot.closedLeaves.find(candidate => candidate.id === leaf.id && sameTile(candidate.tile, leaf));
            return loc?.ops[0] === 'Open';
        }) &&
        isBlocked(snapshot.upperEdge) &&
        isBlocked(snapshot.lowerEdge)
    );
}

function isNarrowWorkaroundState(snapshot: RuntimeSnapshot): boolean {
    const lowerLeaf = exactLeaf(snapshot, 3198);
    return exactLeaf(snapshot, 3197) === undefined && lowerLeaf?.ops[0] === 'Open' && isPassable(snapshot.upperEdge) && isBlocked(snapshot.lowerEdge);
}

function isSignedUpperFarSide(tile: Tile | null, testCase: GateCase): boolean {
    if (!tile || tile.level !== 0 || tile.z !== testCase.workaroundZ) return false;
    return testCase.direction === 'west-to-east' ? tile.x > GATE_X : tile.x < GATE_X;
}

function isExpectedInteraction(attempt: InteractionAttempt, testCase: GateCase, typecode: number): boolean {
    return (
        attempt.id === testCase.workaroundLeafId &&
        attempt.typecode === typecode &&
        attempt.tile !== null &&
        attempt.tile.x === GATE_X &&
        attempt.tile.z === testCase.workaroundZ &&
        attempt.tile.level === 0 &&
        attempt.op === 1 &&
        attempt.action === 'Open'
    );
}

function isExpectedEngineError(line: string): boolean {
    return line.trim() === EXPECTED_ENGINE_ERROR;
}

function expectedEngineError(chat: string[]): string | undefined {
    return chat.find(isExpectedEngineError);
}

function unexpectedServerError(chat: string[]): string | undefined {
    return chat.find(line => /^script error:/i.test(line.trim()) && !isExpectedEngineError(line));
}

function rejectedWalkerLog(logs: string[]): string | undefined {
    return logs.find(line => /giving up after \d+ repaths|can't reach|cannot reach|couldn't reach|\bcrashed:/i.test(line));
}

function hex(value: number | null): string {
    return value === null ? 'null' : `0x${value.toString(16)}`;
}

function describe(snapshot: RuntimeSnapshot): string {
    const tile = snapshot.tile ? `(${snapshot.tile.x},${snapshot.tile.z},${snapshot.tile.level})` : 'null';
    const leaves = snapshot.closedLeaves.map(loc => `${loc.id}@${loc.tile.x},${loc.tile.z},${loc.tile.level}:tc=${loc.typecode}[${loc.ops.filter(Boolean).join('/')}]`).join(' ');
    return (
        `tile=${tile} runner=${snapshot.runnerState} status=${JSON.stringify(snapshot.botStatus)} ` +
        `leaves=${leaves || '-'} ` +
        `upper(flags=${hex(snapshot.upperEdge.westFlags)}->${hex(snapshot.upperEdge.eastFlags)} wall=${snapshot.upperEdge.westEastWallBlocked}/${snapshot.upperEdge.eastWestWallBlocked} pass=${snapshot.upperEdge.westToEastPassable}/${snapshot.upperEdge.eastToWestPassable}) ` +
        `lower(flags=${hex(snapshot.lowerEdge.westFlags)}->${hex(snapshot.lowerEdge.eastFlags)} wall=${snapshot.lowerEdge.westEastWallBlocked}/${snapshot.lowerEdge.eastWestWallBlocked} pass=${snapshot.lowerEdge.westToEastPassable}/${snapshot.lowerEdge.eastToWestPassable}) ` +
        `interactions=${snapshot.interactions.length}`
    );
}

function teleportCommand(tile: Tile): string {
    return `tele ${tile.level},${tile.x >> 6},${tile.z >> 6},${tile.x & 63},${tile.z & 63}`;
}

async function cheat(page: Page, command: string, settleMs = POLL_MS): Promise<void> {
    const sent = await page.evaluate(cmd => {
        const client = (globalThis as never as Runtime).rs2b0t.client;
        if (!client.ingame || !client.out) return false;
        client.out.p1Enc(224);
        client.out.p1(cmd.length + 1);
        client.out.pjstr(cmd);
        return true;
    }, command);
    if (!sent) throw new Error(`could not send ::${command} (client is not ingame)`);
    await page.waitForTimeout(settleMs);
}

async function chat(page: Page): Promise<string[]> {
    return page.evaluate(() => (globalThis as never as Runtime).rs2b0t.reader.chat(100).map(line => line.text));
}

function countExact(lines: string[], wanted: string): number {
    return lines.filter(line => line === wanted).length;
}

async function changeSpeed(page: Page, speed: 300 | 600): Promise<void> {
    const acknowledgement = `World speed was changed to ${speed}ms`;
    const before = countExact(await chat(page), acknowledgement);
    await cheat(page, `speed ${speed}`);
    const deadline = Date.now() + ticks(12);
    while (Date.now() < deadline) {
        if (countExact(await chat(page), acknowledgement) > before) return;
        await page.waitForTimeout(POLL_MS);
    }
    throw new Error(`server did not add exact chat acknowledgement ${JSON.stringify(acknowledgement)}`);
}

async function installInteractionProbe(page: Page): Promise<void> {
    const installed = await page.evaluate(() => {
        const root = globalThis as never as Runtime;
        if (root.__duelGateProbe && !root.__duelGateProbe.restored) return false;

        const driver = root.rs2b0t.router.driver;
        const original = driver.interactLoc;
        const attempts: InteractionAttempt[] = [];
        const probe: InteractionProbe = { original, attempts, restored: false };
        root.__duelGateProbe = probe;

        driver.interactLoc = function (this: InputDriver, lx: number, lz: number, typecode: number, op: number): boolean | Promise<boolean> {
            const tile = root.rs2b0t.reader.toWorld(lx, lz);
            const id = (typecode >> 14) & 0x7fff;
            const loc = root.rs2b0t.reader.locs().find(candidate => candidate.typecode === typecode && tile !== null && candidate.tile.x === tile.x && candidate.tile.z === tile.z && candidate.tile.level === tile.level);
            const attempt: InteractionAttempt = {
                sequence: attempts.length + 1,
                monotonicMs: performance.now(),
                lx,
                lz,
                typecode,
                id,
                tile,
                op,
                action: loc?.ops[op - 1] ?? null,
                result: null,
                error: null
            };
            attempts.push(attempt);
            try {
                const result = original.call(this, lx, lz, typecode, op);
                if (result instanceof Promise) {
                    return result.then(
                        value => {
                            attempt.result = value;
                            return value;
                        },
                        error => {
                            attempt.error = String(error);
                            throw error;
                        }
                    );
                }
                attempt.result = result;
                return result;
            } catch (error) {
                attempt.error = String(error);
                throw error;
            }
        };
        return true;
    });
    if (!installed) throw new Error('ActionRouter.driver.interactLoc already has an active duel-gate probe');
}

async function restoreInteractionProbe(page: Page): Promise<void> {
    await page.evaluate(() => {
        const root = globalThis as never as Runtime;
        const probe = root.__duelGateProbe;
        if (!probe || probe.restored) return;
        root.rs2b0t.router.driver.interactLoc = probe.original;
        probe.restored = true;
    });
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    const testCase = selectedCase(opts);
    const nodeId = Number(process.env.TEST_NODE_ID ?? '10');
    const username = `d73${testCase.requestedLeafId === 3197 ? 'a' : 'b'}${testCase.direction === 'west-to-east' ? 'w' : 'e'}${Date.now().toString(36).slice(-7)}`;
    const caseName = `${testCase.requestedLeafId}-${testCase.direction}`;
    const artifactDir = `out/duel-arena-gate-test/${caseName}`;
    const logPath = `${artifactDir}/run.log`;
    const summaryPath = `${artifactDir}/summary.json`;
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(logPath, '');

    const artifact: RunArtifact = {
        schemaVersion: 1,
        case: testCase,
        serverTickMs: SERVER_TICK_MS,
        engineConstraint: {
            freshWorldRequired: true,
            sameWorldForceCloseSupported: false,
            workaroundLeafId: 3197,
            excludedLeafId: 3198,
            expectedScriptError: EXPECTED_ENGINE_ERROR,
            detail: ENGINE_CONSTRAINT
        },
        startedAt: new Date().toISOString(),
        passed: false,
        speed300Acknowledged: false,
        speed600Restored: false,
        sawExact3197Plan: false,
        sawExact3197Interaction: false,
        sawExpectedEngineError: false,
        sawUpperOpenPassable: false,
        sawLowerStillClosedBlocked: false,
        sawExactCrossLog: false,
        sawSignedUpperFarSide: false,
        arrivedExactRequestedTarget: false,
        observations: [],
        interactions: [],
        screenshots: []
    };

    const record = (message: string): void => {
        const line = `[${new Date().toISOString()}] ${message}`;
        console.log(line);
        fs.appendFileSync(logPath, `${line}\n`);
    };

    const browser = await launchBrowser();
    let page: Page | null = null;
    let speedChanged = false;
    let probeInstalled = false;
    let thrown: unknown = null;

    const screenshot = async (name: string): Promise<void> => {
        if (!page || page.isClosed()) throw new Error(`cannot take ${name}: page is unavailable`);
        const file = `${artifactDir}/${name}.png`;
        await page.screenshot({ path: file });
        artifact.screenshots.push(file);
    };

    try {
        record(`starting issue #73 requested-row case ${caseName}; route must detour through Gate#3197@(3312,3234); ${ENGINE_CONSTRAINT}`);
        page = await browser.newPage({ viewport: { width: 1400, height: 920 } });
        page.on('pageerror', error => record(`pageerror: ${error.message}`));
        await page.goto(`${opts.base}/bot.html?nodeid=${nodeId}&WalkTo.customTile=${testCase.target.x},${testCase.target.z},${testCase.target.level}&WalkTo.arriveRadius=0`);
        await boot(page);

        let loggedIn = false;
        for (let attempt = 0; attempt < 6 && !loggedIn; attempt++) {
            loggedIn = await login(page, username);
            if (!loggedIn) await page.waitForTimeout(ticks(5));
        }
        if (!loggedIn) throw new Error('initial login failed');
        await bringUpOffIsland(page, { user: username, typeWaitMs: ticks(3) });

        await installInteractionProbe(page);
        probeInstalled = true;

        const read = (): Promise<RuntimeSnapshot> =>
            page!.evaluate(
                ({ leaves, masks }): RuntimeSnapshot => {
                    const root = globalThis as never as Runtime;
                    const runtime = root.rs2b0t;
                    const reader = runtime.reader;
                    const edgeAt = (z: 3234 | 3235): EdgeSnapshot => {
                        const west = reader.toLocal(3311, z);
                        const east = reader.toLocal(3312, z);
                        const westFlags = west ? reader.collisionFlags(west.lx, west.lz) : null;
                        const eastFlags = east ? reader.collisionFlags(east.lx, east.lz) : null;
                        const westToEastPassable = eastFlags === null ? null : (eastFlags & masks.plWalkWest) === 0;
                        const eastToWestPassable = westFlags === null ? null : (westFlags & masks.plWalkEast) === 0;
                        return {
                            z,
                            westFlags,
                            eastFlags,
                            westEastWallBlocked: westFlags === null ? null : (westFlags & masks.wallEast) !== 0,
                            eastWestWallBlocked: eastFlags === null ? null : (eastFlags & masks.wallWest) !== 0,
                            westToEastPassable,
                            eastToWestPassable,
                            passable: westToEastPassable === null || eastToWestPassable === null ? null : westToEastPassable && eastToWestPassable
                        };
                    };
                    return {
                        tile: reader.worldTile(),
                        runnerState: runtime.runner.state,
                        botStatus: String((runtime.runner.bot as { status?: unknown } | null)?.status ?? ''),
                        closedLeaves: reader.locs().filter(loc => leaves.some(leaf => loc.id === leaf.id && loc.tile.x === leaf.x && loc.tile.z === leaf.z && loc.tile.level === leaf.level)),
                        upperEdge: edgeAt(3234),
                        lowerEdge: edgeAt(3235),
                        logs: (runtime.runner.ctx?.log ?? []).map(line => line.msg),
                        chat: reader.chat(100).map(line => line.text),
                        interactions: (root.__duelGateProbe?.attempts ?? []).map(attempt => ({ ...attempt, tile: attempt.tile ? { ...attempt.tile } : null }))
                    };
                },
                { leaves: CLOSED_LEAVES, masks: { wallEast: W_E, wallWest: W_W, plWalkEast: PL_WALK_E, plWalkWest: PL_WALK_W } }
            );

        let lastDescription = '';
        const observe = async (label: string): Promise<RuntimeSnapshot> => {
            const snapshot = await read();
            const description = describe(snapshot);
            if (description !== lastDescription) {
                lastDescription = description;
                record(`${label}: ${description}`);
                artifact.observations.push({ at: new Date().toISOString(), label, snapshot });
            }
            artifact.interactions = snapshot.interactions;
            artifact.finalSnapshot = snapshot;
            return snapshot;
        };

        const waitFor = async (label: string, timeoutMs: number, predicate: (snapshot: RuntimeSnapshot) => boolean): Promise<RuntimeSnapshot> => {
            const deadline = Date.now() + timeoutMs;
            let latest = await observe(label);
            while (Date.now() < deadline) {
                if (predicate(latest)) return latest;
                await page!.waitForTimeout(POLL_MS);
                latest = await observe(label);
            }
            throw new Error(`${label} timed out after ${timeoutMs}ms; last ${describe(latest)}; chat=${JSON.stringify(latest.chat)}`);
        };

        speedChanged = true;
        await changeSpeed(page, 300);
        artifact.speed300Acknowledged = true;
        record('PROOF server added exact acknowledgement: World speed was changed to 300ms');

        await cheat(page, teleportCommand(testCase.start), ticks(4));
        await waitFor('exact start teleport', TELEPORT_DEADLINE_MS, snapshot => sameTile(snapshot.tile, testCase.start));
        const precondition = await waitFor('fresh closed precondition', FRESH_CLOSED_DEADLINE_MS, snapshot => sameTile(snapshot.tile, testCase.start) && isFreshClosed(snapshot));
        if (expectedEngineError(precondition.chat)) throw new Error(`fresh-world chat already contains the known gate Engine error; restart required: ${expectedEngineError(precondition.chat)}`);
        if (unexpectedServerError(precondition.chat)) throw new Error(`fresh-world chat contains an unexpected server error: ${unexpectedServerError(precondition.chat)}`);
        if (!sameTile(precondition.tile, testCase.start)) throw new Error(`player left exact start before WalkTo launch: ${describe(precondition)}`);
        if (!isFreshClosed(precondition)) throw new Error(`fresh closed collision precondition failed: ${describe(precondition)}`);
        const workaroundLeaf = exactLeaf(precondition, testCase.workaroundLeafId);
        if (!workaroundLeaf) throw new Error(`exact workaround leaf 3197@(${GATE_X},3234,0) is absent; restart the isolated Engine`);
        artifact.expected3197Typecode = workaroundLeaf.typecode;
        record(`PROOF fresh exact leaves + both rows blocked; requested row z=${testCase.requestedZ}, workaround 3197 typecode=${workaroundLeaf.typecode}: ${describe(precondition)}`);
        await screenshot('01-fresh-closed-blocked');

        const plan = await page.evaluate(
            async (request): Promise<PlanEvidence> => {
                const outcome = await (globalThis as never as Runtime).rs2b0t.navigator.findPath(request.from, request.to);
                if (!outcome.ok) return { ok: false, reason: outcome.reason, transports: [] };
                const terminal = outcome.waypoints[outcome.waypoints.length - 1];
                return {
                    ok: true,
                    terminal: terminal ? { x: terminal.x, z: terminal.z, level: terminal.level } : undefined,
                    transports: outcome.waypoints.flatMap(waypoint => (waypoint.transport ? [waypoint.transport] : []))
                };
            },
            { from: testCase.start, to: testCase.target }
        );
        artifact.plan = plan;
        if (!plan.ok) throw new Error(`navigator could not plan requested row z=${testCase.requestedZ}: ${plan.reason}`);
        if (!sameTile(plan.terminal ?? null, testCase.target)) throw new Error(`navigator plan ended at ${JSON.stringify(plan.terminal)} instead of exact requested target ${JSON.stringify(testCase.target)}`);
        const plannedGates = plan.transports.filter(transport => transport.locName === 'Gate');
        const exactPlannedGates = plannedGates.filter(transport => transport.locId === 3197 && transport.action === 'Open' && transport.locX === GATE_X && transport.locZ === 3234);
        const plannedExcluded3198 = plannedGates.some(transport => transport.locId === 3198 || (transport.locX === GATE_X && transport.locZ === 3235));
        if (exactPlannedGates.length !== 1 || plannedGates.length !== 1 || plannedExcluded3198) {
            throw new Error(`navigator did not plan the sole 3197 upper-edge workaround for requested z=${testCase.requestedZ}: ${JSON.stringify(plannedGates)}`);
        }
        artifact.sawExact3197Plan = true;
        record(`PROOF planned requested z=${testCase.requestedZ} via Open Gate#3197@(3312,3234), never 3198: ${JSON.stringify(plan)}`);

        await page.evaluate(() => {
            const runtime = (globalThis as never as Runtime).rs2b0t;
            const script = runtime.registry.get('WalkTo');
            if (!script) throw new Error('WalkTo is not registered');
            runtime.runner.start(script);
        });
        await page.waitForFunction(() => (globalThis as never as Runtime).rs2b0t.runner.state === 'running', undefined, { timeout: ticks(10) });
        record(`started WalkTo from (${testCase.start.x},${testCase.start.z},0) to exact (${testCase.target.x},${testCase.target.z},0)`);

        const startedAt = Date.now();
        const fullDeadline = startedAt + opts.minutes * 60_000;
        const openDeadline = startedAt + OPEN_DEADLINE_MS;
        let interactionScreenshot = false;
        let openScreenshot = false;
        let targetScreenshot = false;
        let seenLogs = 0;

        while (Date.now() < fullDeadline) {
            const snapshot = await observe('route');
            if (snapshot.logs.length < seenLogs) seenLogs = 0;
            for (const line of snapshot.logs.slice(seenLogs)) record(`bot: ${line}`);
            seenLogs = snapshot.logs.length;

            const wrongInteraction = snapshot.interactions.find(attempt => !isExpectedInteraction(attempt, testCase, workaroundLeaf.typecode));
            if (wrongInteraction) {
                throw new Error(`ActionRouter interacted with the wrong loc; every requested row must use id=3197 typecode=${workaroundLeaf.typecode} tile=(${GATE_X},3234,0) op=1/Open, got ${JSON.stringify(wrongInteraction)}`);
            }
            const exactInteraction = snapshot.interactions.find(attempt => isExpectedInteraction(attempt, testCase, workaroundLeaf.typecode) && attempt.result === true && attempt.error === null);
            if (exactInteraction && !artifact.sawExact3197Interaction) {
                artifact.sawExact3197Interaction = true;
                record(`PROOF exact ActionRouter.interactLoc used Gate#3197 upper edge for requested z=${testCase.requestedZ}: ${JSON.stringify(exactInteraction)}`);
            }
            if (snapshot.interactions.length > 0 && !interactionScreenshot) {
                interactionScreenshot = true;
                await screenshot('02-interaction-dispatched');
            }

            const otherServerError = unexpectedServerError(snapshot.chat);
            if (otherServerError) {
                throw new Error(`unexpected server script error: ${otherServerError}`);
            }
            const knownEngineError = expectedEngineError(snapshot.chat);
            if (knownEngineError && !artifact.sawExpectedEngineError) {
                artifact.sawExpectedEngineError = true;
                record(`EXPECTED ENGINE CONSTRAINT observed exactly: ${knownEngineError}`);
            }
            const rejected = rejectedWalkerLog(snapshot.logs);
            if (rejected) throw new Error(`walker emitted a rejected giving-up/can't-reach log: ${rejected}`);

            if (!artifact.sawUpperOpenPassable && artifact.sawExact3197Interaction && isNarrowWorkaroundState(snapshot)) {
                artifact.sawUpperOpenPassable = true;
                artifact.sawLowerStillClosedBlocked = true;
                record(`PROOF narrow Engine state: 3197 absent + upper edge passable; 3198 still closed + lower edge blocked: ${describe(snapshot)}`);
            }
            if (artifact.sawUpperOpenPassable && artifact.sawLowerStillClosedBlocked && !openScreenshot) {
                openScreenshot = true;
                await screenshot('03-upper-open-lower-closed');
            }

            const exactCrossLog = snapshot.logs.some(line => line.includes(`crossed 'Gate' at (${GATE_X},3234)`));
            artifact.sawExactCrossLog ||= exactCrossLog;
            // crossMultiTileDoor emits this exact log only after isOnFarSide()
            // succeeds. Treat it as authoritative when the browser poll misses
            // the transient z=3234 far-side tile between two 300 ms ticks.
            artifact.sawSignedUpperFarSide ||= artifact.sawUpperOpenPassable && (isSignedUpperFarSide(snapshot.tile, testCase) || exactCrossLog);
            const arrivalLog = snapshot.logs.some(line => line.includes(`arrived at custom ${testCase.target.x},${testCase.target.z},${testCase.target.level}`));
            artifact.arrivedExactRequestedTarget = artifact.sawSignedUpperFarSide && sameTile(snapshot.tile, testCase.target) && arrivalLog;

            if (artifact.arrivedExactRequestedTarget) {
                if (!artifact.sawExact3197Plan) throw new Error('reached requested target without the exact 3197 route plan proof');
                if (!artifact.sawExact3197Interaction) throw new Error('reached requested target without the exact 3197 interaction');
                if (!artifact.sawExpectedEngineError) throw new Error('reached requested target without observing the exact expected Engine constraint');
                if (!artifact.sawUpperOpenPassable || !artifact.sawLowerStillClosedBlocked) throw new Error('reached requested target without proving upper-open/lower-closed collision state');
                if (!artifact.sawExactCrossLog) throw new Error(`reached requested target without the exact crossing log for (${GATE_X},3234)`);
                record(`PROOF crossed signed upper 3197 edge, then arrived exact requested row z=${testCase.requestedZ} target: ${describe(snapshot)}`);
                targetScreenshot = true;
                await screenshot('04-exact-requested-target');
                break;
            }

            if (!artifact.sawUpperOpenPassable && Date.now() >= openDeadline) {
                throw new Error(`3197 never reached the required upper-open/lower-closed collision state within ${OPEN_DEADLINE_MS}ms`);
            }
            if (snapshot.runnerState !== 'running') throw new Error(`WalkTo stopped before exact arrival: ${describe(snapshot)}`);
            await page.waitForTimeout(POLL_MS);
        }

        if (!artifact.sawExact3197Plan) throw new Error('never proved the requested route was planned through exact Gate#3197@(3312,3234)');
        if (!artifact.sawExact3197Interaction) throw new Error('never recorded the exact Gate#3197 ActionRouter.interactLoc call');
        if (!artifact.sawExpectedEngineError) throw new Error(`never observed exact expected Engine constraint: ${EXPECTED_ENGINE_ERROR}`);
        if (!artifact.sawUpperOpenPassable) throw new Error('never observed 3197 disappear and the upper edge become bidirectionally passable');
        if (!artifact.sawLowerStillClosedBlocked) throw new Error('never proved 3198 remained closed with the lower edge blocked');
        if (!artifact.sawExactCrossLog) throw new Error(`never observed exact Gate crossing log at (${GATE_X},3234)`);
        if (!artifact.sawSignedUpperFarSide) throw new Error(`never occupied the signed ${testCase.direction === 'west-to-east' ? 'east' : 'west'} side of the upper 3197 edge`);
        if (!artifact.arrivedExactRequestedTarget) throw new Error(`did not arrive on exact requested-row target ${JSON.stringify(testCase.target)} within ${opts.minutes} minutes`);
        if (!targetScreenshot) throw new Error('exact-target screenshot was not captured');

        artifact.passed = true;
        record(`PASS issue #73 fresh-world requested-row case ${caseName} via exact upper Gate#3197; artifacts=${artifactDir}`);
    } catch (error) {
        thrown = error;
        artifact.error = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
        record(`FAIL issue #73 case ${caseName}: ${artifact.error}`);
        if (page && !page.isClosed()) {
            await screenshot('99-failure').catch(screenshotError => record(`failure screenshot unavailable: ${String(screenshotError)}`));
        }
    } finally {
        if (page && !page.isClosed()) {
            if (probeInstalled) {
                await page
                    .evaluate(() => (globalThis as never as Runtime).__duelGateProbe?.attempts ?? [])
                    .then(attempts => {
                        artifact.interactions = attempts;
                    })
                    .catch(error => record(`could not collect final interaction probe: ${String(error)}`));
                await restoreInteractionProbe(page).catch(error => record(`could not restore interactLoc probe: ${String(error)}`));
            }

            if (speedChanged) {
                await changeSpeed(page, 600).then(
                    () => {
                        artifact.speed600Restored = true;
                        record('restored server tick rate; exact acknowledgement: World speed was changed to 600ms');
                    },
                    error => {
                        record(`WARNING could not hard-verify ::speed 600 restoration: ${String(error)}`);
                        if (!thrown) {
                            thrown = error;
                            artifact.error = `speed restoration failed: ${String(error)}`;
                            artifact.passed = false;
                        }
                    }
                );
            }
        }

        await browser.close();
        artifact.finishedAt = new Date().toISOString();
        fs.writeFileSync(summaryPath, `${JSON.stringify(artifact, null, 2)}\n`);
        record(`wrote JSON summary ${summaryPath}`);
    }

    if (thrown) throw thrown;
}

await main();
