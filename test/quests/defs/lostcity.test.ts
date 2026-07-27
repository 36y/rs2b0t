import { describe, expect, test } from 'bun:test';
import {
    decide,
    lostCityArea,
    LOST_CITY_STAGE,
    parseLostCityJournal
} from '#/bot/quests/defs/lostcity.js';
import type { WorldTile } from '#/bot/adapter/ClientAdapter.js';
import type { QuestSnapshot, QuestStep } from '#/bot/quests/engine/types.js';

const MAINLAND: WorldTile = { x: 3200, z: 3200, level: 0 };
const ENTRANA_SHIP: WorldTile = { x: 2834, z: 3334, level: 1 };
const ENTRANA: WorldTile = { x: 2820, z: 3374, level: 0 };
const DUNGEON: WorldTile = { x: 2822, z: 9774, level: 0 };
const ZANARIS: WorldTile = { x: 3220, z: 9592, level: 0 };
const COMBAT_FOOD = Array(12).fill('Kebab') as string[];
const KEBAB_FUNDS = Array(12).fill('Coins') as string[];

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    inv?: string[];
    worn?: string[];
    bank?: string[];
    bankKnown?: boolean;
    tile?: WorldTile | null;
    freeSlots?: number;
}

function counts(names: string[]): Map<string, number> {
    const result = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
}

function snap(options: SnapshotOptions = {}): QuestSnapshot {
    return {
        journal: options.journal ?? 'inProgress',
        inv: counts(options.inv ?? []),
        worn: new Set((options.worn ?? []).map(name => name.toLowerCase())),
        noProgress: 0,
        bankCoins: 0,
        stage: options.stage ?? LOST_CITY_STAGE.NOT_STARTED,
        bank: counts(options.bank ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile === undefined ? MAINLAND : options.tile,
        freeSlots: options.freeSlots
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

describe('Lost City journal stage parsing', () => {
    test.each([
        ['@dbl@I can start this quest by speaking to the Adventurers', 0],
        ['@dbl@Apparently there is a @dre@leprechaun@dbl@ hiding in a @dre@tree', 1],
        ['I found a Leprechaun.|@dbl@I can find a @dre@Dramen Tree@dbl@ in a cave', 2],
        ['@dbl@With the @dre@Spirit@dbl@ defeated I can cut a @dre@branch@dbl@ from the tree', 3],
        ['I cut a branch from the tree.|@dbl@I should @dre@craft@dbl@ the @dre@branch@dbl@ from the tree into a @dre@staff', 4],
        ['I cut a branch from the tree and crafted a Dramen Staff.', 5],
        ['@red@QUEST COMPLETE!', 6]
    ])('maps rendered journal text to exact stage %i', (text, stage) => {
        expect(parseLostCityJournal(text as string)).toBe(stage);
    });

    test('does not infer a stage from unrecognized text', () => {
        expect(parseLostCityJournal(['Lost City', 'Loading…'])).toBeUndefined();
    });
});

describe('Lost City area classification', () => {
    test('recognizes each quest region and a missing player tile', () => {
        expect(lostCityArea(MAINLAND)).toBe('mainland');
        expect(lostCityArea(ENTRANA_SHIP)).toBe('entranaShip');
        expect(lostCityArea(ENTRANA)).toBe('entrana');
        expect(lostCityArea(DUNGEON)).toBe('dungeon');
        expect(lostCityArea(ZANARIS)).toBe('zanaris');
        expect(lostCityArea(null)).toBe('unknown');
    });
});

describe('Lost City stages 0-3', () => {
    test('stage 0 checks an unknown bank before sourcing tools', () => {
        expect(decide(snap({ stage: 0, bankKnown: false })).kind).toBe('scanBank');
    });

    test('stage 0 sources a missing Knife once the bank is known empty', () => {
        const step = decide(snap({ stage: 0 }));
        expect(step.kind).toBe('grabGround');
        expect(step.kind === 'grabGround' && step.item).toBe('Knife');
        expect(step.kind === 'grabGround' && step.waitIfMissing).toBe(true);
    });

    test('a full mainland pack is cleaned before acquiring another quest item', () => {
        const step = decide(snap({ stage: 0, inv: ['Coins', 'Bones'], freeSlots: 0 }));
        expect(step.kind).toBe('deposit');
        expect(step.kind === 'deposit' && step.keep).toContain('knife');
        expect(step.kind === 'deposit' && step.exactKeep).toBe(true);
    });

    test('stage 0 withdraws known bank tools and then starts with the Warrior', () => {
        const knife = decide(snap({ stage: 0, bank: ['Knife'] }));
        expect(knife.kind === 'withdraw' && knife.items).toEqual([{ name: 'Knife', qty: 1 }]);

        const axe = decide(snap({ stage: 0, inv: ['Knife'], bank: ['Rune axe'] }));
        expect(axe.kind === 'withdraw' && axe.items).toEqual([{ name: 'Rune axe', qty: 1 }]);

        const start = decide(snap({ stage: 0, inv: ['Knife', 'Bronze axe'] }));
        expect(start.kind === 'talk' && start.stop.npc).toBe('Warrior');
    });

    test('stage 1 reveals Shamus after ensuring the same mainland tools', () => {
        const step = decide(snap({ stage: 1, inv: ['Knife'], worn: ['Bronze axe'] }));
        expect(customName(step)).toBe('reveal Shamus and learn about the staff');
    });

    test('stage 2 strips Entrana-forbidden inventory and equipment before sailing', () => {
        const spillover = decide(snap({ stage: 2, inv: ['Knife', 'Bronze axe'] }));
        expect(spillover.kind).toBe('deposit');
        expect(spillover.kind === 'deposit' && spillover.keep).toContain('knife');
        expect(spillover.kind === 'deposit' && spillover.exactKeep).toBe(true);

        const lookalike = decide(snap({ stage: 2, inv: ['Knife', 'Bronze knife'] }));
        expect(lookalike.kind).toBe('deposit');

        const equipment = decide(snap({ stage: 2, inv: ['Knife'], worn: ['Leather body'] }));
        expect(customName(equipment)).toBe('remove Entrana-restricted equipment');

        const food = decide(snap({ stage: 2, inv: ['Knife', ...KEBAB_FUNDS] }));
        expect(customName(food)).toBe('buy 12 combat Kebabs');

        const ready = decide(snap({ stage: 2, inv: ['Knife', 'Coins', ...COMBAT_FOOD] }));
        expect(customName(ready)).toBe('sail from Port Sarim to Entrana');
    });

    test('reserves a separate inventory slot for a newly withdrawn Kebab coin stack', () => {
        const step = decide(snap({
            stage: 2,
            inv: ['Knife'],
            bank: ['Coins'],
            freeSlots: 12
        }));
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toContain('13 free inventory slots');
    });

    test('stage 2 resumes aboard the ship and on Entrana', () => {
        expect(customName(decide(snap({ stage: 2, tile: ENTRANA_SHIP })))).toBe('disembark on Entrana');
        expect(customName(decide(snap({ stage: 2, tile: ENTRANA })))).toBe('descend the one-way Entrana ladder');
    });

    test('stage 2 dungeon restart obtains, equips, then uses a dropped axe', () => {
        const missing = decide(snap({ stage: 2, tile: DUNGEON }));
        expect(customName(missing)).toBe('get an axe from Entrana Zombies');

        const held = decide(snap({ stage: 2, tile: DUNGEON, inv: ['Bronze axe'] }));
        expect(held.kind === 'equip' && held.item).toBe('Bronze axe');

        const equipped = decide(snap({ stage: 2, tile: DUNGEON, worn: ['Bronze axe'] }));
        expect(customName(equipped)).toBe('defeat the Tree Spirit');
    });

    test('stage 3 cuts a branch in the dungeon and can recover an axe after restart', () => {
        const ready = decide(snap({ stage: 3, tile: DUNGEON, worn: ['Iron axe'] }));
        expect(customName(ready)).toBe('cut a Dramen branch');

        const restarted = decide(snap({ stage: 3, tile: DUNGEON }));
        expect(customName(restarted)).toBe('get an axe from Entrana Zombies');
    });
});

describe('Lost City stage 4 branch recovery', () => {
    test('crafts a held branch when the Knife is present', () => {
        const step = decide(snap({ stage: 4, inv: ['Knife', 'Dramen branch'], tile: DUNGEON }));
        expect(step.kind).toBe('useOn');
        if (step.kind === 'useOn') {
            expect(step.item).toBe('Knife');
            expect(step.target).toBe('Dramen branch');
            expect(step.product).toBe('Dramen staff');
        }
    });

    test('leaves the dungeon if a held branch has outlived the Knife', () => {
        const step = decide(snap({ stage: 4, inv: ['Dramen branch'], tile: DUNGEON }));
        expect(customName(step)).toBe('leave the dungeon to replace the Knife');
    });

    test('scans an unknown bank, then withdraws a banked branch and Knife', () => {
        expect(decide(snap({ stage: 4, bankKnown: false })).kind).toBe('scanBank');

        const step = decide(snap({ stage: 4, bank: ['Dramen branch', 'Knife'] }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items).toEqual([
            { name: 'Dramen branch', qty: 1 },
            { name: 'Knife', qty: 1 }
        ]);
    });

    test('recovers a lost branch by returning to Entrana and cutting another', () => {
        const mainland = decide(snap({ stage: 4, inv: ['Knife', 'Coins', ...COMBAT_FOOD] }));
        expect(customName(mainland)).toBe('sail from Port Sarim to Entrana');

        const dungeon = decide(snap({ stage: 4, tile: DUNGEON, worn: ['Bronze axe'] }));
        expect(customName(dungeon)).toBe('cut a Dramen branch');
    });
});

describe('Lost City stages 5-6', () => {
    test('stage 5 scans first, then restores a banked staff', () => {
        expect(decide(snap({ stage: 5, bankKnown: false })).kind).toBe('scanBank');

        const step = decide(snap({ stage: 5, bank: ['Dramen staff'] }));
        expect(step.kind === 'withdraw' && step.items).toEqual([{ name: 'Dramen staff', qty: 1 }]);
    });

    test('stage 5 can restore a banked branch as an alternate recovery path', () => {
        const step = decide(snap({ stage: 5, bank: ['Dramen branch', 'Knife'] }));
        expect(step.kind === 'withdraw' && step.items).toEqual([
            { name: 'Dramen branch', qty: 1 },
            { name: 'Knife', qty: 1 }
        ]);
    });

    test('stage 5 equips a held staff and enters Zanaris with a worn staff', () => {
        const equip = decide(snap({ stage: 5, inv: ['Dramen staff'] }));
        expect(equip.kind === 'equip' && equip.item).toBe('Dramen staff');

        const enter = decide(snap({ stage: 5, worn: ['Dramen staff'] }));
        expect(customName(enter)).toBe('enter Zanaris through the swamp shed');
    });

    test('stage 5 exits the dungeon without unequipping its worn staff', () => {
        const step = decide(snap({ stage: 5, worn: ['Dramen staff'], tile: DUNGEON }));
        expect(customName(step)).toBe('exit through the Wilderness portal');
    });

    test('stage 5 recovers a completely lost staff, including an axe-less dungeon restart', () => {
        const mainland = decide(snap({ stage: 5, inv: ['Knife', 'Coins', ...COMBAT_FOOD] }));
        expect(customName(mainland)).toBe('sail from Port Sarim to Entrana');

        const dungeon = decide(snap({ stage: 5, tile: DUNGEON }));
        expect(customName(dungeon)).toBe('get an axe from Entrana Zombies');
    });

    test('stage 6 is done even before the journal cache updates', () => {
        expect(decide(snap({ stage: 6 })).kind).toBe('done');
        expect(decide(snap({ stage: 0, journal: 'complete' })).kind).toBe('done');
    });

    test('unknown journal remains safely idle', () => {
        expect(decide(snap({ stage: 2, journal: 'unknown' })).kind).toBe('wait');
    });
});
