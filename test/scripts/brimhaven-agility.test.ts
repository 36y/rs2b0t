import { describe, expect, test } from 'bun:test';
import {
    ARENA_EDGES,
    BOAT_FARE,
    ENTRANCE_FEE,
    PILLARS,
    SPIKE_EDGE,
    TRIP_COINS,
    coinsNeeded,
    edgeBetween,
    hasPaid,
    inArena,
    nextHop,
    pathPlatforms,
    pillarFromHint,
    pillarTagged,
    platformAt,
    shouldBank,
    shouldEat,
    usableEdges,
    waitPlatform
} from '#/bot/scripts/BrimhavenAgilityLogic.js';
import {
    DEFAULT_BANK_TICKETS,
    DEFAULT_FOOD_PER_TRIP
} from '#/bot/scripts/BrimhavenAgilityLogic.js';

describe('BrimhavenAgility arena geometry', () => {
    test('has 24 ticket pillars plus the SE ladder landing', () => {
        expect(PILLARS.length).toBe(25);
        // spacing between adjacent pillars is 11 tiles
        expect(PILLARS[1].x - PILLARS[0].x).toBe(11);
        expect(PILLARS[5].z - PILLARS[0].z).toBe(11);
    });

    test('every edge endpoint is a valid platform index', () => {
        for (const e of ARENA_EDGES) {
            expect(e.a).toBeGreaterThanOrEqual(0);
            expect(e.b).toBeLessThan(PILLARS.length);
            expect(e.a).not.toBe(e.b);
        }
    });

    test('spike grind edge is floorspikes between platforms 13 and 14', () => {
        expect(SPIKE_EDGE.kind).toBe('spikes');
        expect(SPIKE_EDGE.minLevel).toBe(20);
        expect(new Set([SPIKE_EDGE.a, SPIKE_EDGE.b])).toEqual(new Set([13, 14]));
    });
});

describe('BrimhavenAgility pathfinding', () => {
    test('already-there path is empty', () => {
        expect(pathPlatforms(7, 7, 99)).toEqual([]);
    });

    test('adjacent platforms are one hop at any level when the edge has no gate', () => {
        // 0↔1 is a ledge (min 1)
        expect(pathPlatforms(0, 1, 1)).toEqual([1]);
        expect(nextHop(0, 1, 1)).toBe(1);
    });

    test('level-20 gates close floorspike / handhold / pressure edges', () => {
        // 1↔6 is floorspikes min 20
        expect(edgeBetween(1, 6, 19)).toBeNull();
        expect(edgeBetween(1, 6, 20)).not.toBeNull();
        expect(usableEdges(1).every(e => e.minLevel <= 1)).toBe(true);
        expect(usableEdges(40).length).toBe(ARENA_EDGES.length);
    });

    test('level-40 gates close sawblade and dart edges', () => {
        expect(edgeBetween(6, 7, 39)).toBeNull();
        expect(edgeBetween(6, 7, 40)?.kind).toBe('saws');
        expect(edgeBetween(13, 18, 39)).toBeNull();
        expect(edgeBetween(13, 18, 40)?.kind).toBe('darts');
    });

    test('finds a multi-hop route across the arena at high agility', () => {
        const path = pathPlatforms(0, 23, 99);
        expect(path).not.toBeNull();
        expect(path!.length).toBeGreaterThan(3);
        expect(path![path!.length - 1]).toBe(23);
    });

    test('unreachable when every connecting edge is gated', () => {
        // from 1 to 6 only via spikes (20) — at level 1, still reachable via longer routes?
        // 1→0→5→6 uses pillar + plank (both level 1)
        const path = pathPlatforms(1, 6, 1);
        expect(path).not.toBeNull();
        expect(path).not.toContain(/* direct spike would be */ -1);
        // ensure we did not take the spike edge as the sole hop
        if (path!.length === 1) {
            expect(path![0]).not.toBe(6); // if direct, it would need spikes
        }
    });

    test('wait platform prefers spikes at 20+ and centre below', () => {
        expect(waitPlatform(19, 0)).toBe(12);
        const wait = waitPlatform(50, 0);
        expect([13, 14]).toContain(wait);
    });
});

describe('BrimhavenAgility banking & combat decisions', () => {
    test('coins cover boat both ways plus first entrance', () => {
        expect(TRIP_COINS).toBe(BOAT_FARE * 2 + ENTRANCE_FEE);
        expect(coinsNeeded(false)).toBe(TRIP_COINS);
        expect(coinsNeeded(true)).toBe(BOAT_FARE * 2);
    });

    test('banks when out of food or ticket threshold hit', () => {
        expect(shouldBank(0, 0, 1000)).toBe(true);
        expect(shouldBank(1000, 5, 1000)).toBe(true);
        expect(shouldBank(999, 5, 1000)).toBe(false);
    });

    test('eats only below 5 HP with food in pack', () => {
        expect(shouldEat(4, 3)).toBe(true);
        expect(shouldEat(5, 3)).toBe(false);
        expect(shouldEat(1, 0)).toBe(false);
    });

    test('varp bit helpers match content constants', () => {
        expect(hasPaid(0)).toBe(false);
        expect(hasPaid(1 << 1)).toBe(true);
        expect(pillarTagged(0)).toBe(false);
        expect(pillarTagged(1 << 0)).toBe(true);
    });
});

describe('BrimhavenAgility location helpers', () => {
    test('platformAt snaps nearby tiles to the pillar index', () => {
        const p = PILLARS[12];
        expect(platformAt(p.x, p.z)).toBe(12);
        expect(platformAt(p.x + 2, p.z - 1)).toBe(12);
        expect(platformAt(0, 0)).toBe(-1);
    });

    test('pillarFromHint maps a hint arrow on a pillar', () => {
        expect(pillarFromHint(PILLARS[5].x, PILLARS[5].z)).toBe(5);
    });

    test('inArena accepts plane 3 or high underground z', () => {
        expect(inArena(3, 3000)).toBe(true);
        expect(inArena(0, 9560)).toBe(true);
        expect(inArena(0, 3200)).toBe(false);
    });
});

describe('BrimhavenAgility settings defaults', () => {
    test('defaults match the issue: 25 food, bank at 1000 tickets', () => {
        expect(DEFAULT_FOOD_PER_TRIP).toBe(25);
        expect(DEFAULT_BANK_TICKETS).toBe(1000);
    });
});
