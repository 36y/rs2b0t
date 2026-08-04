import { describe, expect, test } from 'bun:test';

import type { TransportEdgeData } from '#/bot/nav/PathFinder.js';
import transports from '#/bot/nav/data/transports.json';

/**
 * Karamja's volcano, which is the only walkable way into the dungeon that backs
 * onto Crandor. Both hops are scripted teleports and neither is derivable, so
 * they are curated — and both are ungated: `[oploc1,volcano_entrance]` and
 * `[oploc1,climbing_rope2]` carry no conditions at all, unlike the Crandor
 * secret wall next door, which refuses anyone who has not opened it from the
 * Crandor side. That wall used to be kept out of the graph entirely; #396 baked
 * it behind Dragon Slayer complete on both directions instead.
 */
const DOWN = {
    from: { x: 2856, z: 3167, level: 0 },
    to: { x: 2856, z: 9567, level: 0 },
    locName: 'Rocks',
    action: 'Climb-down',
    kind: 'dungeon'
} as const satisfies TransportEdgeData;

const UP = {
    from: { x: 2856, z: 9570, level: 0 },
    to: { x: 2856, z: 3166, level: 0 },
    locName: 'Climbing rope',
    action: 'Climb',
    kind: 'dungeon'
} as const satisfies TransportEdgeData;

const edges = transports as TransportEdgeData[];
const find = (e: TransportEdgeData): TransportEdgeData | undefined =>
    edges.find(t => t.from.x === e.from.x && t.from.z === e.from.z && t.from.level === e.from.level);

describe('Karamja volcano transports', () => {
    test('both hops are curated, with the tiles the engine actually uses', () => {
        // Climb-down telejumps exactly 6400 south of the stand, so the stand is
        // what fixes the landing tile; the rope teleports to a coordinate the
        // script names outright.
        expect(find(DOWN)).toMatchObject(DOWN);
        expect(find(UP)).toMatchObject(UP);
        expect(DOWN.from.z + 6400).toBe(DOWN.to.z);
    });

    test('the rope is taken from beside it, never from its own tile', () => {
        // addEdges drops any edge whose endpoints are not both walkable, without
        // a word. The rope loc stands on (2856,9569) and blocks it, so an edge
        // written from there vanishes and the dungeon becomes a one-way trip —
        // which is exactly how it read: in from Falador, no route back out.
        expect(UP.from).not.toMatchObject({ x: 2856, z: 9569 });
        expect(Math.abs(UP.from.z - 9569) + Math.abs(UP.from.x - 2856)).toBe(1);
    });

    test('the volcano is the only ungated way in — the wall is Dragon Slayer both ways', () => {
        // The Crandor secret wall used to be curated out entirely: it refuses
        // anyone who has not opened it from the Crandor side, and an ungated edge
        // would route a passing bot into a dungeon it cannot leave. #396 baked it
        // instead, gated on Dragon Slayer complete — which answers that objection
        // as long as the gate is on **both** directions. Assert that, not absence:
        // an ungated wall edge, or one gated on only one side, is the real defect.
        const wall = edges.filter(e => e.from.z === 9599 || e.to.z === 9599);
        expect(wall.length).toBeGreaterThan(0);
        for (const e of wall) {
            expect(e.requires?.quests).toEqual([{ quest: 'Dragon Slayer', minStatus: 'complete' }]);
        }
        // Both directions exist, so the wall can never strand a bot behind it.
        expect(wall.some(e => e.from.z === 9599 && e.to.z === 9601)).toBe(true);
        expect(wall.some(e => e.from.z === 9601 && e.to.z === 9599)).toBe(true);
    });
});
