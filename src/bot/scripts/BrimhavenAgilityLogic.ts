/**
 * Pure decisions for Brimhaven Agility Arena (tag pillars for tickets).
 * Platform graph + level-gated edges come from rev-274 content map m43_149.
 */

export const BOAT_FARE = 30;
export const ENTRANCE_FEE = 200;
/** Coins kept for Ardougne↔Brimhaven both ways + first-time entrance. */
export const TRIP_COINS = BOAT_FARE * 2 + ENTRANCE_FEE;
export const DEFAULT_FOOD_PER_TRIP = 25;
export const DEFAULT_BANK_TICKETS = 1000;
export const EAT_AT_HP = 5;
export const TICKET_NAME = 'Agility arena ticket';
export const ARENA_VARP = 309; // agilityarena_varbit
export const PAID_BIT = 1;
export const PILLAR_TAGGED_BIT = 0;

/**
 * Rough surface Karamja / Brimhaven footprint (ship landing through arena entrance).
 * Once here the outbound boat is already paid — only return fare (+ entrance if
 * unpaid) remains. Using TRIP_COINS here caused bank↔boat loops forever.
 */
export function onBrimhavenSurface(x: number, z: number, level: number): boolean {
    return level === 0 && x >= 2740 && x <= 2960 && z >= 3130 && z <= 3280;
}

/**
 * Absolute world tiles of arena platforms (level 3).
 * Indices 0–23 match the server ticket-pillar enum; 24 is the SE ladder landing
 * (no ticket dispenser) where Climb-Down drops you.
 */
export const PILLARS: ReadonlyArray<{ x: number; z: number }> = [
    { x: 2761, z: 9546 },
    { x: 2772, z: 9546 },
    { x: 2783, z: 9546 },
    { x: 2794, z: 9546 },
    { x: 2805, z: 9546 },
    { x: 2761, z: 9557 },
    { x: 2772, z: 9557 },
    { x: 2783, z: 9557 },
    { x: 2794, z: 9557 },
    { x: 2805, z: 9557 },
    { x: 2761, z: 9568 },
    { x: 2772, z: 9568 },
    { x: 2783, z: 9568 },
    { x: 2794, z: 9568 },
    { x: 2805, z: 9568 },
    { x: 2761, z: 9579 },
    { x: 2772, z: 9579 },
    { x: 2783, z: 9579 },
    { x: 2794, z: 9579 },
    { x: 2805, z: 9579 },
    { x: 2761, z: 9590 },
    { x: 2772, z: 9590 },
    { x: 2783, z: 9590 },
    { x: 2794, z: 9590 },
    { x: 2805, z: 9590 } // 24 — ladder landing (no dispenser)
];

/** Server ticket enum is 0–23 only. */
export const TICKET_PILLAR_COUNT = 24;
export const LANDING_PLATFORM = 24;

export type ObstacleKind =
    | 'ledge'
    | 'pillar'
    | 'monkey'
    | 'spikes'
    | 'handholds'
    | 'blade'
    | 'rope'
    | 'log'
    | 'plank'
    | 'saws'
    | 'wall'
    | 'pressure'
    | 'swing'
    | 'darts';

export type EdgeMode = 'interact' | 'walk';

export interface ArenaEdge {
    a: number;
    b: number;
    kind: ObstacleKind;
    /** Minimum agility to use this edge without guaranteed fail. */
    minLevel: number;
    mode: EdgeMode;
    /** Loc display name for interact edges. */
    locName?: string;
    op?: string;
}

/**
 * Bidirectional edges between platform indices. Built from m43_149 loc placement
 * + zone trap scripts (spikes 20, pressure 20, saws 40, darts 40, handholds 20).
 */
export const ARENA_EDGES: readonly ArenaEdge[] = [
    { a: 0, b: 1, kind: 'ledge', minLevel: 1, mode: 'interact', locName: 'Balancing ledge', op: 'Walk-across' },
    { a: 0, b: 5, kind: 'pillar', minLevel: 1, mode: 'interact', locName: 'Pillar', op: 'Jump-on' },
    { a: 1, b: 2, kind: 'monkey', minLevel: 1, mode: 'interact', locName: 'Monkey bars', op: 'Swing-across' },
    { a: 1, b: 6, kind: 'spikes', minLevel: 20, mode: 'walk' },
    { a: 2, b: 3, kind: 'handholds', minLevel: 20, mode: 'interact', locName: 'Hand holds', op: 'Climb-across' },
    { a: 2, b: 7, kind: 'blade', minLevel: 1, mode: 'walk' },
    { a: 3, b: 4, kind: 'ledge', minLevel: 1, mode: 'interact', locName: 'Balancing ledge', op: 'Walk-across' },
    { a: 3, b: 8, kind: 'rope', minLevel: 1, mode: 'interact', locName: 'Balancing rope', op: 'Walk-on' },
    { a: 4, b: 9, kind: 'log', minLevel: 1, mode: 'interact', locName: 'Log balance', op: 'Walk-on' },
    { a: 5, b: 6, kind: 'plank', minLevel: 1, mode: 'interact', locName: 'Plank', op: 'Walk-on' },
    { a: 5, b: 10, kind: 'handholds', minLevel: 20, mode: 'interact', locName: 'Hand holds', op: 'Climb-across' },
    { a: 6, b: 7, kind: 'saws', minLevel: 40, mode: 'walk' },
    { a: 6, b: 11, kind: 'rope', minLevel: 1, mode: 'interact', locName: 'Balancing rope', op: 'Walk-on' },
    { a: 7, b: 12, kind: 'wall', minLevel: 1, mode: 'interact', locName: 'Low wall', op: 'Climb-over' },
    { a: 8, b: 9, kind: 'pressure', minLevel: 20, mode: 'walk' },
    { a: 8, b: 13, kind: 'monkey', minLevel: 1, mode: 'interact', locName: 'Monkey bars', op: 'Swing-across' },
    { a: 9, b: 14, kind: 'wall', minLevel: 1, mode: 'interact', locName: 'Low wall', op: 'Climb-over' },
    { a: 10, b: 11, kind: 'swing', minLevel: 1, mode: 'interact', locName: 'Rope swing', op: 'Swing-on' },
    { a: 10, b: 15, kind: 'spikes', minLevel: 20, mode: 'walk' },
    { a: 11, b: 16, kind: 'monkey', minLevel: 1, mode: 'interact', locName: 'Monkey bars', op: 'Swing-across' },
    { a: 12, b: 13, kind: 'pillar', minLevel: 1, mode: 'interact', locName: 'Pillar', op: 'Jump-on' },
    { a: 12, b: 17, kind: 'saws', minLevel: 40, mode: 'walk' },
    { a: 13, b: 14, kind: 'spikes', minLevel: 20, mode: 'walk' },
    { a: 13, b: 18, kind: 'darts', minLevel: 40, mode: 'walk' },
    { a: 14, b: 19, kind: 'pillar', minLevel: 1, mode: 'interact', locName: 'Pillar', op: 'Jump-on' },
    { a: 15, b: 16, kind: 'log', minLevel: 1, mode: 'interact', locName: 'Log balance', op: 'Walk-on' },
    { a: 15, b: 20, kind: 'blade', minLevel: 1, mode: 'walk' },
    { a: 16, b: 17, kind: 'saws', minLevel: 40, mode: 'walk' },
    { a: 16, b: 21, kind: 'pressure', minLevel: 20, mode: 'walk' },
    { a: 17, b: 18, kind: 'blade', minLevel: 1, mode: 'walk' },
    { a: 17, b: 22, kind: 'rope', minLevel: 1, mode: 'interact', locName: 'Balancing rope', op: 'Walk-on' },
    { a: 18, b: 19, kind: 'pressure', minLevel: 20, mode: 'walk' },
    { a: 18, b: 23, kind: 'log', minLevel: 1, mode: 'interact', locName: 'Log balance', op: 'Walk-on' },
    { a: 20, b: 21, kind: 'ledge', minLevel: 1, mode: 'interact', locName: 'Balancing ledge', op: 'Walk-across' },
    { a: 21, b: 22, kind: 'wall', minLevel: 1, mode: 'interact', locName: 'Low wall', op: 'Climb-over' },
    { a: 22, b: 23, kind: 'handholds', minLevel: 20, mode: 'interact', locName: 'Hand holds', op: 'Climb-across' },
    // SE ladder landing → ticket grid (rope-swing south onto platform 19).
    { a: 24, b: 19, kind: 'swing', minLevel: 1, mode: 'interact', locName: 'Rope swing', op: 'Swing-on' },
    // Fallback if the swing is awkward — planks west onto platform 23 (broken tiles possible).
    { a: 24, b: 23, kind: 'plank', minLevel: 1, mode: 'interact', locName: 'Plank', op: 'Walk-on' }
];

/** Spike trap between platforms 13↔14 — centre-ish grind while waiting. */
export const SPIKE_EDGE: ArenaEdge = ARENA_EDGES.find(e => e.a === 13 && e.b === 14)!;
export const SPIKE_PLATFORMS = [13, 14] as const;
export const CENTRE_PLATFORM = 12;

export const ARDY_BANK = { x: 2655, z: 3283, level: 0 };
export const ARENA_ENTRANCE = { x: 2809, z: 3194, level: 0 };
export const LADDER_DOWN_STAND = { x: 2809, z: 3194, level: 0 };

export function bitSet(varp: number, bit: number): boolean {
    return ((varp >>> bit) & 1) === 1;
}

export function hasPaid(varp: number): boolean {
    return bitSet(varp, PAID_BIT);
}

export function pillarTagged(varp: number): boolean {
    return bitSet(varp, PILLAR_TAGGED_BIT);
}

/**
 * Coins still required for the rest of the trip.
 * - At Ardougne / leaving bank: both boat legs (+ entrance if unpaid).
 * - Already on Brimhaven surface: outbound boat is spent — only the return
 *   leg (+ entrance if unpaid). Without this, 230gp after the 30gp ship still
 *   looked "underfunded" vs 260 and the bot banked instead of entering.
 */
export function coinsNeeded(alreadyPaid: boolean, outboundBoatDone = false): number {
    const boatLegs = outboundBoatDone ? 1 : 2;
    const boats = BOAT_FARE * boatLegs;
    return alreadyPaid ? boats : boats + ENTRANCE_FEE;
}

/**
 * Withdraw this many coins at Ardougne bank so a full round-trip is funded
 * from the mainland (always 2 boat legs + entrance if needed).
 */
export function coinsToWithdraw(alreadyPaid: boolean, coinsInPack: number): number {
    const need = coinsNeeded(alreadyPaid, false);
    return Math.max(0, need - coinsInPack);
}

export function shouldBank(tickets: number, foodCount: number, bankAtTickets: number): boolean {
    return foodCount <= 0 || tickets >= bankAtTickets;
}

/**
 * What the bank could not supply after a restock, or null when the trip is funded.
 *
 * The bank trip is triggered by exactly these shortfalls, so anything still missing
 * when it finishes means the next loop re-opens the bank for the same reason —
 * the open/close spin a user sees when the account simply ran out of lobsters.
 * The caller stops on a non-null result instead of spinning.
 */
export function restockShortfall(s: {
    food: string;
    foodInPack: number;
    foodPerTrip: number;
    coins: number;
    alreadyPaid: boolean;
}): string | null {
    if (s.foodInPack < s.foodPerTrip) {
        return `out of ${s.food} — only ${s.foodInPack} in the pack after restocking, need ${s.foodPerTrip} per trip. Bank more ${s.food} (or lower "Food per trip") and restart.`;
    }
    const need = coinsNeeded(s.alreadyPaid, false);
    if (s.coins < need) {
        return `out of coins — only ${s.coins} after restocking, need ${need} for the boats${s.alreadyPaid ? '' : ' + arena entrance'}. Bank more coins and restart.`;
    }
    return null;
}

/** Whether low coins alone should force a bank run (location-aware). */
export function needsCoinsRestock(coins: number, alreadyPaid: boolean, atBrimhaven: boolean): boolean {
    return coins < coinsNeeded(alreadyPaid, atBrimhaven);
}

export function shouldEat(hp: number, foodCount: number, eatAt = EAT_AT_HP): boolean {
    return hp > 0 && hp < eatAt && foodCount > 0;
}

/** Nearest platform index for a world tile, or -1 if nowhere near the arena grid. */
export function platformAt(x: number, z: number, maxDist = 6): number {
    let best = -1;
    let bestD = maxDist + 1;
    for (let i = 0; i < PILLARS.length; i++) {
        const p = PILLARS[i];
        const d = Math.max(Math.abs(p.x - x), Math.abs(p.z - z));
        if (d < bestD) {
            bestD = d;
            best = i;
        }
    }
    return best;
}

/** Match a hint arrow tile to a ticket pillar index (0–23), never the landing. */
export function pillarFromHint(hx: number, hz: number): number {
    const p = platformAt(hx, hz, 3);
    return p >= 0 && p < TICKET_PILLAR_COUNT ? p : -1;
}

export function inArena(level: number, z: number): boolean {
    return level >= 3 || z >= 9500;
}

/** True when standing on the ticket platforms (plane 3), not the fall pit below. */
export function onArenaPlatform(level: number): boolean {
    return level >= 3;
}

/**
 * Failed obstacles drop the player to plane 0 under the same (x,z). Platform
 * pillars still snap by x/z, but edge locs only exist on plane 3 — treat this
 * as a pit fall and climb the rope before pathing (#user report 2802,9590,0).
 */
export function inArenaPit(level: number, z: number): boolean {
    return z >= 9500 && level < 3;
}

/**
 * After an obstacle interact, whether we should release control for the next hop.
 * - fallen: plane-0 pit — climb rope next
 * - arrived: on the destination pillar (anim residual is fine — next hop can queue)
 * - elsewhere: left the start pillar for a different platform (partial progress)
 * - pending: still mid-attempt (soft fails need multi-tick idle confirmation in the waiter)
 */
export type ObstacleOutcome = 'arrived' | 'fallen' | 'elsewhere' | 'pending';

export function obstacleOutcome(
    platform: number,
    from: number,
    to: number,
    inPit: boolean,
    _animating: boolean
): ObstacleOutcome {
    if (inPit) {
        return 'fallen';
    }
    // Landed = done. Residual get-up anims must not hold the next hop.
    if (platform === to) {
        return 'arrived';
    }
    if (platform >= 0 && platform !== from) {
        return 'elsewhere';
    }
    return 'pending';
}

/**
 * Safe to start the next hop. Only the pit blocks — residual landing anims are
 * clickable, and re-click loops handle ignored packets.
 */
export function canStartObstacle(_animating: boolean, inPit: boolean): boolean {
    return !inPit;
}

/** Manhattan tile distance between two arena platforms (for hop tie-breaks). */
export function platformGeoDist(a: number, b: number): number {
    const pa = PILLARS[a];
    const pb = PILLARS[b];
    if (!pa || !pb) {
        return 9999;
    }
    return Math.abs(pa.x - pb.x) + Math.abs(pa.z - pb.z);
}

export function usableEdges(agility: number): ArenaEdge[] {
    return ARENA_EDGES.filter(e => agility >= e.minLevel);
}

function arenaAdj(agility: number): Map<number, number[]> {
    const adj = new Map<number, number[]>();
    for (const e of usableEdges(agility)) {
        if (!adj.has(e.a)) {
            adj.set(e.a, []);
        }
        if (!adj.has(e.b)) {
            adj.set(e.b, []);
        }
        adj.get(e.a)!.push(e.b);
        adj.get(e.b)!.push(e.a);
    }
    return adj;
}

/** BFS hop-distance from `src` to every reachable platform. */
function hopDistFrom(src: number, adj: Map<number, number[]>): Map<number, number> {
    const dist = new Map<number, number>();
    const q = [src];
    dist.set(src, 0);
    while (q.length > 0) {
        const cur = q.shift()!;
        const d = dist.get(cur)!;
        for (const n of adj.get(cur) ?? []) {
            if (dist.has(n)) {
                continue;
            }
            dist.set(n, d + 1);
            q.push(n);
        }
    }
    return dist;
}

/**
 * Shortest hop path from `from` to `to`. Among equal-hop routes, each step
 * prefers the neighbour geographically closer to `to` so we don't detour
 * the long way around the grid when BFS insertion order would.
 */
export function pathPlatforms(from: number, to: number, agility: number): number[] | null {
    if (from < 0 || to < 0 || from >= PILLARS.length || to >= PILLARS.length) {
        return null;
    }
    if (from === to) {
        return [];
    }
    const adj = arenaAdj(agility);
    const rem = hopDistFrom(to, adj);
    if (!rem.has(from)) {
        return null;
    }
    const path: number[] = [];
    let cur = from;
    const total = rem.get(from)!;
    for (let step = 0; step < total; step++) {
        const need = rem.get(cur)! - 1;
        const opts = (adj.get(cur) ?? []).filter(n => rem.get(n) === need);
        if (opts.length === 0) {
            return null;
        }
        opts.sort((a, b) => {
            const ga = platformGeoDist(a, to);
            const gb = platformGeoDist(b, to);
            if (ga !== gb) {
                return ga - gb;
            }
            return a - b;
        });
        cur = opts[0];
        path.push(cur);
    }
    return path;
}

/** Whether this hop is a chase toward a ticket pillar (run) vs centre/spikes (walk). */
export function wantRunForGoal(chasingTag: boolean): boolean {
    return chasingTag;
}

export function edgeBetween(a: number, b: number, agility: number): ArenaEdge | null {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return usableEdges(agility).find(e => Math.min(e.a, e.b) === lo && Math.max(e.a, e.b) === hi) ?? null;
}

/** Next hop platform toward `goal`, or null if stuck/arrived. */
export function nextHop(from: number, goal: number, agility: number): number | null {
    const path = pathPlatforms(from, goal, agility);
    if (path === null) {
        return null;
    }
    return path[0] ?? null;
}

/**
 * Where to idle between tags: prefer spike platforms when agility ≥ 20,
 * otherwise the geometric centre platform.
 */
export function waitPlatform(agility: number, here: number): number {
    if (agility >= 20) {
        // Prefer the nearer of the two spike platforms so we don't cross half the map.
        const d13 = pathPlatforms(here, 13, agility)?.length ?? 99;
        const d14 = pathPlatforms(here, 14, agility)?.length ?? 99;
        return d13 <= d14 ? 13 : 14;
    }
    return CENTRE_PLATFORM;
}

/** Inventory keep list when depositing: food name forms + coins. */
export function keepOnDeposit(food: string): string[] {
    return ['Coins', food];
}
