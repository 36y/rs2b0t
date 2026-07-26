import { describe, expect, test } from 'bun:test';

import { matchesTransportLoc } from '#/bot/nav/WalkExecutor.js';
import type { TransportInfo } from '#/bot/nav/PathFinder.js';

const gate: TransportInfo = {
    locName: 'Gate',
    action: 'Open',
    locX: 3312,
    locZ: 3235,
    locId: 3198
};

const loc = (id: number, x: number, z: number): { id: number; tile(): { x: number; z: number } } => ({
    id,
    tile: () => ({ x, z })
});

describe('matchesTransportLoc', () => {
    test('an ID-defined transport requires the exact ID and recorded tile', () => {
        expect(matchesTransportLoc(gate, loc(3198, 3312, 3235))).toBe(true);
        expect(matchesTransportLoc(gate, loc(3197, 3312, 3234))).toBe(false);
        expect(matchesTransportLoc(gate, loc(3198, 3312, 3234))).toBe(false);
    });

    test('locId 0 takes the strict branch rather than the legacy radius branch', () => {
        const zeroId = { ...gate, locId: 0 };
        expect(matchesTransportLoc(zeroId, loc(0, 3312, 3235))).toBe(true);
        expect(matchesTransportLoc(zeroId, loc(3198, 3312, 3235))).toBe(false);
        expect(matchesTransportLoc(zeroId, loc(0, 3313, 3235))).toBe(false);
    });

    test('a legacy no-ID transport retains the three-tile radius lookup', () => {
        const { locId: _locId, ...legacy } = gate;
        expect(matchesTransportLoc(legacy, loc(3197, 3315, 3238))).toBe(true);
        expect(matchesTransportLoc(legacy, loc(3197, 3316, 3235))).toBe(false);
    });
});
