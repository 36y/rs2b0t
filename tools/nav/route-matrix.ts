import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { gunzipSync } from 'fflate';

import doorsJson from '#/bot/nav/data/doors.json';
import { NAV_TARGETS, type NavTarget } from '#/bot/nav/data/navTargets.js';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import transportsJson from '#/bot/nav/data/transports.json';
import { PathFinder, type DoorEdgeData, type NavPoint, type PathOutcome, type TransportEdgeData, type TransportInfo } from '#/bot/nav/PathFinder.js';
import { WALK_DESTINATIONS, type WalkDestination } from '#/bot/scripts/WalkDestinations.js';

const DEFAULT_PACK = 'out/collision.lcnav.gz';
const DEFAULT_OUT = 'out/nav-route-matrix.json';
const DEFAULT_MAX_EXPANSIONS = 1_000_000;

type RouteGroup = 'walk-destinations' | 'nav-targets' | 'semantic-regressions';

interface NamedPoint {
    label: string;
    tile: NavPoint;
}

interface RouteRecord {
    id: string;
    group: RouteGroup;
    from: NamedPoint;
    to: NamedPoint;
    expected: 'reachable' | 'unreachable';
    status: 'reachable' | 'expected-unreachable' | 'unexpected-reachable' | 'unexpected-unreachable' | 'wrong-terminal';
    cost?: number;
    expanded: number;
    terminal?: NavPoint;
    transports?: TransportInfo[];
    reason?: string;
}

interface Options {
    packPath: string;
    outPath: string;
    maxExpansions: number;
}

interface SemanticAssertion {
    id: string;
    ok: boolean;
    detail: string;
}

interface ExpectedUnreachable {
    id: string;
    justification: string;
}

// Keep this list explicit and justified. It is intentionally empty: the complete
// current matrix is expected to route. Adding an entry is a reviewed product/data
// decision, never a way for this tool to silently skip a failing route.
const EXPECTED_UNREACHABLE: ExpectedUnreachable[] = [];

const WIZARD_BASEMENT_LABEL = 'wizard-tower basement ladder landing';
const WIZARD_SURFACE: NamedPoint = { label: 'Wizard Tower surface', tile: { x: 3105, z: 3162, level: 0 } };

function parseArgs(argv: string[]): Options {
    let packPath = DEFAULT_PACK;
    let outPath = DEFAULT_OUT;
    let maxExpansions = DEFAULT_MAX_EXPANSIONS;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--pack' && argv[i + 1]) {
            packPath = argv[++i];
        } else if (arg === '--out' && argv[i + 1]) {
            outPath = argv[++i];
        } else if (arg === '--max-expansions' && argv[i + 1]) {
            maxExpansions = Number(argv[++i]);
        } else if (arg === '--help') {
            console.log('usage: bun tools/nav/route-matrix.ts [--pack <collision.lcnav[.gz]>] [--out <summary.json>] [--max-expansions <n>]');
            process.exit(0);
        } else {
            throw new Error(`unknown or incomplete argument: ${arg}`);
        }
    }

    if (!Number.isSafeInteger(maxExpansions) || maxExpansions < 1) {
        throw new Error(`--max-expansions must be a positive safe integer (got ${maxExpansions})`);
    }
    return { packPath, outPath, maxExpansions };
}

function point(value: { x: number; z: number; level: number }): NavPoint {
    return { x: value.x, z: value.z, level: value.level };
}

function samePoint(a: NavPoint, b: NavPoint): boolean {
    return a.x === b.x && a.z === b.z && a.level === b.level;
}

function chebyshev2d(a: NavPoint, b: NavPoint): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function slug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function walkDestinationPoint(destination: WalkDestination): NamedPoint {
    return { label: destination.name, tile: point(destination.tile) };
}

function anchorFor(target: NavTarget): NamedPoint {
    if (target.label === WIZARD_BASEMENT_LABEL) {
        return WIZARD_SURFACE;
    }

    const nearest = WALK_DESTINATIONS.reduce((best, candidate) => {
        const candidateDistance = chebyshev2d(point(candidate.tile), target.tile);
        const bestDistance = chebyshev2d(point(best.tile), target.tile);
        return candidateDistance < bestDistance ? candidate : best;
    });
    return walkDestinationPoint(nearest);
}

function loadPack(packPath: string): { bytes: Uint8Array; packedBytes: Uint8Array } {
    const packedBytes = new Uint8Array(fs.readFileSync(packPath));
    const bytes = packedBytes.length >= 2 && packedBytes[0] === 0x1f && packedBytes[1] === 0x8b ? gunzipSync(packedBytes) : packedBytes;
    return { bytes, packedBytes };
}

function terminalOf(outcome: Extract<PathOutcome, { ok: true }>): NavPoint | undefined {
    const terminal = outcome.waypoints[outcome.waypoints.length - 1];
    return terminal ? point(terminal) : undefined;
}

function transportMatches(actual: TransportInfo, expected: TransportInfo): boolean {
    return actual.locName === expected.locName && actual.action === expected.action && actual.locX === expected.locX && actual.locZ === expected.locZ && actual.locId === expected.locId;
}

function transportLabel(transport: TransportInfo): string {
    const id = transport.locId === undefined ? '' : `#${transport.locId}`;
    return `${transport.action} ${transport.locName}${id}@${transport.locX},${transport.locZ}`;
}

function assertTransportSubsequence(actual: TransportInfo[], expected: TransportInfo[]): { ok: boolean; detail: string } {
    let cursor = 0;
    for (const transport of actual) {
        if (cursor < expected.length && transportMatches(transport, expected[cursor])) {
            cursor++;
        }
    }
    const actualLabel = actual.length === 0 ? '(none)' : actual.map(transportLabel).join(' -> ');
    return cursor === expected.length ? { ok: true, detail: actualLabel } : { ok: false, detail: `wanted subsequence ${expected.map(transportLabel).join(' -> ')}; got ${actualLabel}` };
}

function exactDoorFixture(expected: DoorEdgeData): { ok: boolean; detail: string } {
    const coordinateMatches = (doorsJson as DoorEdgeData[]).filter(door => door.x === expected.x && door.z === expected.z && door.level === expected.level);
    const exactMatches = coordinateMatches.filter(door => door.locId === expected.locId && door.locName === expected.locName && door.dir === expected.dir);
    if (coordinateMatches.length === 1 && exactMatches.length === 1) {
        return { ok: true, detail: `${expected.locName}#${expected.locId}@${expected.x},${expected.z},L${expected.level} dir=${expected.dir}` };
    }
    return {
        ok: false,
        detail: `expected ${expected.locName}#${expected.locId}@${expected.x},${expected.z},L${expected.level} dir=${expected.dir} to be the only door at that coordinate; found ${exactMatches.length} exact and ${coordinateMatches.length} total`
    };
}

function exactTransportFixture(expected: TransportEdgeData, source: TransportEdgeData[]): { ok: boolean; detail: string } {
    const matches = source.filter(edge => samePoint(edge.from, expected.from) && samePoint(edge.to, expected.to) && edge.locName === expected.locName && edge.action === expected.action && edge.kind === expected.kind);
    return matches.length === 1
        ? { ok: true, detail: `${expected.action} ${expected.locName} (${expected.from.x},${expected.from.z},L${expected.from.level}) -> (${expected.to.x},${expected.to.z},L${expected.to.level})` }
        : { ok: false, detail: `expected exactly one matching ${expected.kind} edge; found ${matches.length}` };
}

function main(): void {
    const opts = parseArgs(process.argv.slice(2));
    const { bytes, packedBytes } = loadPack(opts.packPath);
    const finder = new PathFinder(bytes);
    finder.addEdges(doorsJson as DoorEdgeData[], transportsJson as TransportEdgeData[], stairsJson as TransportEdgeData[]);

    const expectedUnreachable = new Map(EXPECTED_UNREACHABLE.map(item => [item.id, item.justification]));
    const encounteredExpectedUnreachable = new Set<string>();
    const records: RouteRecord[] = [];
    const assertions: SemanticAssertion[] = [];
    const failures: string[] = [];

    const checkRoute = (group: RouteGroup, id: string, from: NamedPoint, to: NamedPoint): RouteRecord => {
        const expectedFailure = expectedUnreachable.get(id);
        if (expectedFailure !== undefined) {
            encounteredExpectedUnreachable.add(id);
        }

        const outcome = finder.findPath(from.tile, to.tile, undefined, opts.maxExpansions);
        if (!outcome.ok) {
            const record: RouteRecord = {
                id,
                group,
                from,
                to,
                expected: expectedFailure === undefined ? 'reachable' : 'unreachable',
                status: expectedFailure === undefined ? 'unexpected-unreachable' : 'expected-unreachable',
                expanded: outcome.expanded,
                reason: outcome.reason
            };
            records.push(record);
            if (expectedFailure === undefined) {
                failures.push(`${id}: ${outcome.reason} after ${outcome.expanded} expansions`);
            }
            return record;
        }

        const terminal = terminalOf(outcome);
        const transports = outcome.waypoints.flatMap(waypoint => (waypoint.transport ? [waypoint.transport] : []));
        let status: RouteRecord['status'] = 'reachable';
        if (expectedFailure !== undefined) {
            status = 'unexpected-reachable';
            failures.push(`${id}: route became reachable; remove or revisit the expected-unreachable entry (${expectedFailure})`);
        } else if (!terminal || !samePoint(terminal, to.tile)) {
            status = 'wrong-terminal';
            failures.push(`${id}: planner returned terminal ${terminal ? `${terminal.x},${terminal.z},L${terminal.level}` : '(none)'} instead of ${to.tile.x},${to.tile.z},L${to.tile.level}`);
        }

        const record: RouteRecord = {
            id,
            group,
            from,
            to,
            expected: expectedFailure === undefined ? 'reachable' : 'unreachable',
            status,
            cost: outcome.cost,
            expanded: outcome.expanded,
            terminal,
            transports
        };
        records.push(record);
        return record;
    };

    const addAssertion = (id: string, result: { ok: boolean; detail: string }): void => {
        assertions.push({ id, ...result });
        if (!result.ok) {
            failures.push(`${id}: ${result.detail}`);
        }
    };

    for (const fromDestination of WALK_DESTINATIONS) {
        for (const toDestination of WALK_DESTINATIONS) {
            const from = walkDestinationPoint(fromDestination);
            const to = walkDestinationPoint(toDestination);
            checkRoute('walk-destinations', `walk-destinations/${slug(from.label)}/to/${slug(to.label)}`, from, to);
        }
    }

    NAV_TARGETS.forEach((target, index) => {
        const anchor = anchorFor(target);
        const targetPoint: NamedPoint = { label: `${target.bot}: ${target.label}`, tile: point(target.tile) };
        const prefix = `nav-targets/${String(index + 1).padStart(2, '0')}-${slug(target.bot)}-${slug(target.label)}`;
        checkRoute('nav-targets', `${prefix}/anchor-to-target`, anchor, targetPoint);
        checkRoute('nav-targets', `${prefix}/target-to-anchor`, targetPoint, anchor);
    });

    const issue69Door: DoorEdgeData = { x: 3063, z: 3380, level: 0, locId: 1512, locName: 'Large door', dir: 'E' };
    const issue69Stair: TransportEdgeData = {
        from: { x: 3058, z: 9776, level: 0 },
        to: { x: 3062, z: 3376, level: 0 },
        locName: 'Staircase',
        action: 'Climb-up',
        kind: 'stair'
    };
    addAssertion('issue-69/source-door', exactDoorFixture(issue69Door));
    addAssertion('issue-69/source-stair', exactTransportFixture(issue69Stair, stairsJson as TransportEdgeData[]));

    const issue69 = checkRoute('semantic-regressions', 'semantic/issue-69/dwarven-mine-to-edgeville', { label: 'Dwarven Mine staircase', tile: point(issue69Stair.from) }, { label: 'Edgeville bank', tile: { x: 3094, z: 3493, level: 0 } });
    const issue69ExpectedTransports: TransportInfo[] = [
        { locName: 'Staircase', action: 'Climb-up', locX: 3058, locZ: 9776, locId: undefined },
        { locName: 'Large door', action: 'Open', locX: 3063, locZ: 3380, locId: 1512 }
    ];
    addAssertion('issue-69/transport-order', issue69.status === 'reachable' ? assertTransportSubsequence(issue69.transports ?? [], issue69ExpectedTransports) : { ok: false, detail: `semantic route status was ${issue69.status}` });

    const usableDuelGate: DoorEdgeData = { x: 3312, z: 3234, level: 0, locId: 3197, locName: 'Gate', dir: 'W' };
    const excludedDuelGate: DoorEdgeData = { x: 3312, z: 3235, level: 0, locId: 3198, locName: 'Gate', dir: 'W' };
    addAssertion('issue-73/source-gate-3197-present', exactDoorFixture(usableDuelGate));
    const excludedCoordinateMatches = (doorsJson as DoorEdgeData[]).filter(door => door.x === excludedDuelGate.x && door.z === excludedDuelGate.z && door.level === excludedDuelGate.level);
    const excludedIdMatches = (doorsJson as DoorEdgeData[]).filter(door => door.locId === excludedDuelGate.locId);
    addAssertion(
        'issue-73/source-gate-3198-excluded',
        excludedCoordinateMatches.length === 0 && excludedIdMatches.length === 0
            ? { ok: true, detail: 'Gate#3198@3312,3235,L0 is deliberately absent from the source door graph' }
            : { ok: false, detail: `expected Gate#3198@3312,3235,L0 to be excluded; found ${excludedCoordinateMatches.length} doors at the coordinate and ${excludedIdMatches.length} rows with locId 3198` }
    );

    const requestedRows = [
        { requestedLocId: 3197, requestedZ: 3234, routeLabel: 'upper row using 3197' },
        { requestedLocId: 3198, requestedZ: 3235, routeLabel: 'lower row detouring via upper 3197' }
    ];
    for (const row of requestedRows) {
        const legs = [
            { direction: 'west-to-east', from: { x: 3311, z: row.requestedZ, level: 0 }, to: { x: 3313, z: row.requestedZ, level: 0 } },
            { direction: 'east-to-west', from: { x: 3313, z: row.requestedZ, level: 0 }, to: { x: 3311, z: row.requestedZ, level: 0 } }
        ];
        for (const leg of legs) {
            const route = checkRoute(
                'semantic-regressions',
                `semantic/issue-73/requested-row-${row.requestedLocId}-via-3197/${leg.direction}`,
                { label: `Duel Arena ${row.routeLabel} ${leg.direction} start`, tile: leg.from },
                { label: `Duel Arena ${row.routeLabel} ${leg.direction} finish`, tile: leg.to }
            );
            const gateSteps = (route.transports ?? []).filter(transport => transport.locName === 'Gate');
            const exactSteps = gateSteps.filter(transport => transport.action === 'Open' && transport.locId === usableDuelGate.locId && transport.locX === usableDuelGate.x && transport.locZ === usableDuelGate.z);
            const onlyUsableGate = gateSteps.every(transport => transportMatches(transport, { locName: 'Gate', action: 'Open', locX: usableDuelGate.x, locZ: usableDuelGate.z, locId: usableDuelGate.locId }));
            const usedExcludedLeaf = gateSteps.some(transport => transport.locId === excludedDuelGate.locId || (transport.locX === excludedDuelGate.x && transport.locZ === excludedDuelGate.z));
            let assertionResult: { ok: boolean; detail: string };
            if (route.status === 'reachable' && exactSteps.length === 1 && onlyUsableGate && !usedExcludedLeaf) {
                assertionResult = { ok: true, detail: `requested z=${row.requestedZ}; ${transportLabel(exactSteps[0])}` };
            } else {
                assertionResult = {
                    ok: false,
                    detail: `route=${route.status}; requested z=${row.requestedZ}; exact 3197 uses=${exactSteps.length}; only 3197=${onlyUsableGate}; used excluded 3198=${usedExcludedLeaf}; gates=${gateSteps.map(transportLabel).join(' -> ') || '(none)'}`
                };
            }
            addAssertion(`issue-73/requested-row-${row.requestedLocId}-via-3197/${leg.direction}`, assertionResult);
        }
    }

    for (const item of EXPECTED_UNREACHABLE) {
        if (!encounteredExpectedUnreachable.has(item.id)) {
            failures.push(`expected-unreachable entry was not exercised: ${item.id} (${item.justification})`);
        }
    }

    const summary = {
        schemaVersion: 1,
        input: {
            collisionPackSha256: createHash('sha256').update(packedBytes).digest('hex'),
            collisionPackBytes: packedBytes.byteLength,
            collisionBytes: bytes.byteLength,
            mapsquares: finder.mapsquares,
            members: finder.members,
            sourceDoors: (doorsJson as DoorEdgeData[]).length,
            compiledDoors: finder.doorEdges,
            sourceTransports: (transportsJson as TransportEdgeData[]).length,
            sourceStairs: (stairsJson as TransportEdgeData[]).length,
            compiledTransports: finder.transportEdges,
            maxExpansions: opts.maxExpansions
        },
        coverage: {
            walkDestinations: WALK_DESTINATIONS.length,
            walkDestinationRoutes: WALK_DESTINATIONS.length * WALK_DESTINATIONS.length,
            navTargets: NAV_TARGETS.length,
            navTargetRoutes: NAV_TARGETS.length * 2,
            semanticRoutes: records.filter(record => record.group === 'semantic-regressions').length
        },
        expectedUnreachable: EXPECTED_UNREACHABLE,
        assertions,
        results: records,
        failures
    };

    fs.mkdirSync(path.dirname(opts.outPath), { recursive: true });
    fs.writeFileSync(opts.outPath, `${JSON.stringify(summary, null, 2)}\n`);

    const succeeded = records.filter(record => record.status === 'reachable').length;
    console.log(`route matrix: ${succeeded}/${records.length} reachable as expected; ${assertions.filter(assertion => assertion.ok).length}/${assertions.length} semantic assertions passed`);
    console.log(`pack: ${finder.mapsquares} mapsquares, ${finder.doorEdges}/${(doorsJson as DoorEdgeData[]).length} doors compiled, ${finder.transportEdges} transports compiled`);
    console.log(`summary: ${opts.outPath}`);
    if (failures.length > 0) {
        for (const failure of failures) {
            console.error(`FAIL: ${failure}`);
        }
        process.exit(1);
    }
    console.log('PASS');
}

main();
