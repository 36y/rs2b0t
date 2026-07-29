# Watch Tower Quest Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Watch Tower as the nineteenth AIOQuester quest module, completing end-to-end on a
max-stat account whose bank holds coins plus three drop-only items.

**Architecture:** A `defs/watchtower/` directory following the Waterfall pattern — the rendered
quest journal is the stage oracle, `decide()` is a pure function of the snapshot, and each of the
nine sealed map pockets is entered by a `custom` leg that owns its scripted crossing. Two general
extensions land first: journal sub-progress as typed flags on the snapshot, and a dialogue
primitive that chooses an option from the NPC's spoken line.

**Tech Stack:** TypeScript, Bun (`bun test`), Playwright harnesses against a local Lost City
engine on `http://localhost:8888`.

## Global Constraints

- Design source of truth: `docs/superpowers/specs/2026-07-28-watchtower-quest-design.md`. Every
  coordinate, loc name, npc name, dialogue string and stage number in this plan is copied from it.
- Branch `watchtower`, already cut from `main`. **Never push to `main`** — this repo is PR-only.
- Comments: near-comment-free. Write a comment only where the *why* is not derivable from the
  code. No rationale essays, no history, no citations.
- State comes from the journal and held items. **Never read varps for quest state** — they do not
  reach a revision-274 client.
- `'unknown'` journal status is not `'notStarted'`; it always returns `wait`.
- A failing step must eventually park with a reason. A step that loops forever is the worst
  outcome available.
- Quest name string is exactly `'Watch Tower'`; quest id is `'itwatchtower'`.
- Local engine: `http://localhost:8888`. Send `::speed 300` for 2× ticks before any timed run.
- Run `bun test` and `bun run lint` before every commit. Lint budget for new bot files is 0.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/bot/quests/engine/types.ts` | +`QuestProgress`, `QuestModule.readProgress`, `QuestSnapshot.progress` |
| `src/bot/quests/engine/QuestEngine.ts` | call `readProgress` and put it on the snapshot |
| `src/bot/adapter/ClientAdapter.ts` | +`chatModalTexts()` |
| `src/bot/api/hud/ChatDialog.ts` | +`texts()` |
| `src/bot/quests/exec/primitives.ts` | +`pickByLine`, +`talkChoosingBy` |
| `src/bot/nav/data/transports.json` | +tower l1↔l2 ladders, +Grew exit swing |
| `src/bot/quests/data/quests.ts` | Watch Tower record gains its `items` |
| `src/bot/quests/defs/index.ts` | register `watchtower` |
| `src/bot/quests/defs/watchtower/areas.ts` | every Tile/loc/npc/item constant; `watchtowerArea()` |
| `src/bot/quests/defs/watchtower/journal.ts` | `WATCHTOWER_STAGE`, journal parser, `readWatchtowerProgress()` |
| `src/bot/quests/defs/watchtower/tower.ts` | wall climb, ladders, wizard dialogue legs |
| `src/bot/quests/defs/watchtower/tribes.ts` | Og, Toban, Gorad, Grew, relic parts |
| `src/bot/quests/defs/watchtower/gutanoth.ts` | relic gate, rock cake, battlement, chasm jump, city guard |
| `src/bot/quests/defs/watchtower/caves.ts` | six skavid caves, light source, language |
| `src/bot/quests/defs/watchtower/enclave.ts` | nightshade entry, shamans, Rock of Dalgroth |
| `src/bot/quests/defs/watchtower/supplies.ts` | bank-first provisioning and shop fallbacks |
| `src/bot/quests/defs/watchtower/index.ts` | the `QuestModule` and `decide()` |
| `test/quests/defs/watchtower.test.ts` | `decide()`, parser, area classifier |
| `test/quests/exec/primitives.test.ts` | `pickByLine` (extend if the file exists, else create) |
| `tools/watchtower-solo-test.ts` | stage-jumping single-leg harness |

---

### Task 1: Journal sub-progress on the snapshot

Watch Tower's journal carries progress the stage number alone does not: which tribes are helped,
which skavid words are known, how many shamans remain. `decide()` must stay pure, so that detail
has to arrive *in* the snapshot. `readStage` returns only a number, so add a superseding hook.

**Files:**
- Modify: `src/bot/quests/engine/types.ts`
- Modify: `src/bot/quests/engine/QuestEngine.ts:167-168`
- Test: `test/quests/engine/progress.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface QuestProgress { stage: number; flags: ReadonlySet<string> }`;
  `QuestModule.readProgress?: () => QuestProgress | undefined | Promise<QuestProgress | undefined>`;
  `QuestSnapshot.progress?: QuestProgress`. When `readProgress` is present the engine uses it and
  ignores `readStage`; `snap.stage` is set from `progress.stage`.

- [ ] **Step 1: Write the failing test**

```ts
// test/quests/engine/progress.test.ts
import { describe, expect, test } from 'bun:test';
import { hasFlag, flagValue } from '#/bot/quests/engine/types.js';

describe('quest progress flags', () => {
    test('hasFlag is case-insensitive on the flag name', () => {
        const progress = { stage: 2, flags: new Set(['helped-og']) };
        expect(hasFlag(progress, 'helped-og')).toBe(true);
        expect(hasFlag(progress, 'helped-grew')).toBe(false);
    });

    test('hasFlag on an absent progress is false, never a throw', () => {
        expect(hasFlag(undefined, 'helped-og')).toBe(false);
    });

    test('flagValue reads the numeric tail of a "name:N" flag', () => {
        const progress = { stage: 10, flags: new Set(['shamans-left:4']) };
        expect(flagValue(progress, 'shamans-left')).toBe(4);
    });

    test('flagValue is undefined when the flag is absent', () => {
        const progress = { stage: 10, flags: new Set<string>() };
        expect(flagValue(progress, 'shamans-left')).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/engine/progress.test.ts`
Expected: FAIL — `hasFlag` is not exported from `engine/types.js`.

- [ ] **Step 3: Add the type and helpers**

Append to `src/bot/quests/engine/types.ts`:

```ts
export interface QuestProgress {
    stage: number;
    /** Journal-visible sub-progress. `name` or `name:N` for a counted flag. */
    flags: ReadonlySet<string>;
}

export function hasFlag(progress: QuestProgress | undefined, name: string): boolean {
    return progress?.flags.has(name) ?? false;
}

export function flagValue(progress: QuestProgress | undefined, name: string): number | undefined {
    const prefix = name + ':';
    for (const flag of progress?.flags ?? []) {
        if (flag.startsWith(prefix)) {
            const n = Number(flag.slice(prefix.length));
            return Number.isFinite(n) ? n : undefined;
        }
    }
    return undefined;
}
```

In the same file add `progress?: QuestProgress;` to `QuestSnapshot` (beside `stage`), and to
`QuestModule` add:

```ts
    /** Supersedes readStage. Journal stage plus sub-progress the stage number cannot carry. */
    readProgress?: () => QuestProgress | undefined | Promise<QuestProgress | undefined>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/quests/engine/progress.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the engine**

In `src/bot/quests/engine/QuestEngine.ts`, replace:

```ts
        const stage = await module.readStage?.();
        const snap = this.buildSnapshot(module, stage);
```

with:

```ts
        const progress = await module.readProgress?.();
        const stage = progress ? progress.stage : await module.readStage?.();
        const snap = this.buildSnapshot(module, stage, progress);
```

Change the two later `this.buildSnapshot(module, stage)` calls (in the watchdog block) to
`this.buildSnapshot(module, stage, progress)`, and change the method signature and its return
object:

```ts
    private buildSnapshot(module: QuestModule, stage?: number, progress?: QuestProgress): QuestSnapshot {
```

adding `progress,` to the returned object literal beside `stage,`. Import `QuestProgress` from
`./types.js` alongside the existing type imports.

- [ ] **Step 6: Verify nothing regressed**

Run: `bun test && bun run lint`
Expected: PASS — the existing 18 quest modules use `readStage` and are untouched.

- [ ] **Step 7: Commit**

```bash
git add src/bot/quests/engine/types.ts src/bot/quests/engine/QuestEngine.ts test/quests/engine/progress.test.ts
git commit -m "feat(quests): carry journal sub-progress as typed flags on the snapshot"
```

---

### Task 2: Choose a dialogue option from the NPC's line

The mad skavid speaks one of four phrases at random and the correct reply depends on which.
`driveDialog`'s fixed preference list cannot express that.

**Files:**
- Modify: `src/bot/adapter/ClientAdapter.ts` (beside `mainModalTexts`, ~line 675)
- Modify: `src/bot/api/hud/ChatDialog.ts`
- Modify: `src/bot/quests/exec/primitives.ts`
- Test: `test/quests/exec/primitives.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `reader.chatModalTexts(): string[]`; `ChatDialog.texts(): string[]`;
  `export interface LineRule { whenLine: string; choose: string }`;
  `pickByLine(lines: string[], options: string[], rules: readonly LineRule[]): string | null`;
  `talkChoosingBy(npcName: string, rules: readonly LineRule[], prefer: string[], log): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```ts
// test/quests/exec/primitives.test.ts
import { describe, expect, test } from 'bun:test';
import { pickByLine, type LineRule } from '#/bot/quests/exec/primitives.js';

const SKAVID_RULES: readonly LineRule[] = [
    { whenLine: 'ar cur', choose: 'Gor.' },
    { whenLine: 'bidith ig', choose: 'Cur.' },
    { whenLine: 'cur tanath', choose: 'Bidith.' },
    { whenLine: 'gor nod', choose: 'Tanath.' }
];

const OPTIONS = ['Cur.', 'Ar.', 'Bidith.', 'Tanath.', 'Gor.'];

describe('pickByLine', () => {
    test('matches the rule whose line the NPC actually spoke', () => {
        expect(pickByLine(['Ar cur...'], OPTIONS, SKAVID_RULES)).toBe('Gor.');
        expect(pickByLine(['Bidith ig...'], OPTIONS, SKAVID_RULES)).toBe('Cur.');
        expect(pickByLine(['Cur tanath...'], OPTIONS, SKAVID_RULES)).toBe('Bidith.');
        expect(pickByLine(['Gor nod...'], OPTIONS, SKAVID_RULES)).toBe('Tanath.');
    });

    test('prefers the longest matching rule so "cur tanath" never matches "ar cur"', () => {
        expect(pickByLine(['Cur tanath...'], OPTIONS, SKAVID_RULES)).toBe('Bidith.');
    });

    test('ignores colour tags and pipe separators in the spoken line', () => {
        expect(pickByLine(['@dbl@Gor|nod...'], OPTIONS, SKAVID_RULES)).toBe('Tanath.');
    });

    test('returns null when no rule matches, rather than guessing', () => {
        expect(pickByLine(['Tanath gor ar bidith?'], OPTIONS, SKAVID_RULES)).toBeNull();
    });

    test('returns null when the matched reply is not on offer', () => {
        expect(pickByLine(['Ar cur...'], ['Cur.', 'Ar.'], SKAVID_RULES)).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/exec/primitives.test.ts`
Expected: FAIL — `pickByLine` is not exported.

- [ ] **Step 3: Add the adapter reader**

In `src/bot/adapter/ClientAdapter.ts`, directly after `mainModalTexts()`:

```ts
    chatModalTexts(): string[] {
        if (!raw || raw.chatModalId === -1) {
            return [];
        }

        return walkComponents(raw.chatModalId)
            .filter(com => com.type === ComponentType.TYPE_TEXT && com.text)
            .map(com => com.text!);
    },
```

- [ ] **Step 4: Add the ChatDialog accessor**

In `src/bot/api/hud/ChatDialog.ts`, after `options()`:

```ts
    texts(): string[] {
        return reader.chatModalTexts();
    },
```

- [ ] **Step 5: Add the primitive**

In `src/bot/quests/exec/primitives.ts`, after `pickPreferred`:

```ts
export interface LineRule {
    /** Lower-case fragment of the NPC's spoken line. */
    whenLine: string;
    /** Option to choose when that fragment is present. */
    choose: string;
}

function flattenLines(lines: string[]): string {
    return lines.join(' ').replace(/@[a-z0-9]{3}@/gi, ' ').replace(/[|\s]+/g, ' ').trim().toLowerCase();
}

export function pickByLine(lines: string[], options: string[], rules: readonly LineRule[]): string | null {
    const said = flattenLines(lines);
    // Longest first: "cur tanath" and "ar cur" overlap, and the shorter must not win.
    const hit = [...rules]
        .sort((a, b) => b.whenLine.length - a.whenLine.length)
        .find(rule => said.includes(rule.whenLine.toLowerCase()));
    if (!hit) {
        return null;
    }
    return options.find(o => o.toLowerCase().includes(hit.choose.toLowerCase())) ?? null;
}
```

and after `talkThrough`:

```ts
export async function talkChoosingBy(
    npcName: string,
    rules: readonly LineRule[],
    prefer: string[],
    log: (m: string) => void
): Promise<boolean> {
    if (!ChatDialog.isOpen()) {
        const npc = Npcs.query().name(npcName).where(n => talkOp(n.actions()) !== null).nearest();
        if (!npc || !(await npc.interact(talkOp(npc.actions())!))) {
            log(`no '${npcName}' nearby to talk to`);
            return false;
        }
        if (!(await Execution.delayUntil(() => ChatDialog.isOpen(), 8000))) {
            log(`'${npcName}' never opened a dialogue`);
            return false;
        }
    }
    let spoken: string[] = [];
    for (let i = 0; i < 120; i++) {
        if (EventSignal.pending()) {
            return false;
        }
        if (ChatDialog.isOpen()) {
            const texts = ChatDialog.texts();
            if (texts.length > 0) {
                spoken = texts;
            }
        }
        if (ChatDialog.canContinue()) {
            await ChatDialog.continue();
            await Execution.delayTicks(1);
            continue;
        }
        const opts = ChatDialog.options();
        if (opts.length > 0) {
            const pick = pickByLine(spoken, opts, rules) ?? pickPreferred(opts, prefer);
            if (!pick) {
                log(`no rule or preference matched [${opts.join(' | ')}] after "${spoken.join(' ')}"`);
                return false;
            }
            await ChatDialog.chooseOption(pick);
            await Execution.delayTicks(2);
            continue;
        }
        if (!ChatDialog.isOpen()) {
            break;
        }
        await Execution.delayTicks(1);
    }
    return !ChatDialog.isOpen();
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test test/quests/exec/primitives.test.ts && bun run lint`
Expected: PASS (5 tests), lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/bot/adapter/ClientAdapter.ts src/bot/api/hud/ChatDialog.ts src/bot/quests/exec/primitives.ts test/quests/exec/primitives.test.ts
git commit -m "feat(quests): choose a dialogue option from the NPC's spoken line"
```

---

### Task 3: Watch Tower constants and area classifier

**Files:**
- Create: `src/bot/quests/defs/watchtower/areas.ts`
- Test: `test/quests/defs/watchtower.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `WT_ITEM`, `WT_LOC`, `WT_NPC`, `WT_TILE` constant objects, and
  `watchtowerArea(tile: QuestSnapshot['tile']): WatchtowerArea` where
  `type WatchtowerArea = 'yanille' | 'towerFloor' | 'grewIsland' | 'tobanCamp' | 'lowerCity' | 'cityGuard' | 'skavidCaves' | 'enclave' | 'mirrorTower' | 'unknown'`.

- [ ] **Step 1: Write the failing test**

```ts
// test/quests/defs/watchtower.test.ts
import { describe, expect, test } from 'bun:test';
import { watchtowerArea } from '#/bot/quests/defs/watchtower/areas.js';

const at = (x: number, z: number, level = 0) => ({ x, z, level });

describe('watchtowerArea', () => {
    test('classifies each sealed pocket by a tile inside it', () => {
        expect(watchtowerArea(at(2544, 3112, 2))).toBe('towerFloor');
        expect(watchtowerArea(at(2513, 3084))).toBe('grewIsland');
        expect(watchtowerArea(at(2576, 3027))).toBe('tobanCamp');
        expect(watchtowerArea(at(2526, 3018))).toBe('lowerCity');
        expect(watchtowerArea(at(2541, 3029))).toBe('cityGuard');
        expect(watchtowerArea(at(2504, 9441))).toBe('skavidCaves');
        expect(watchtowerArea(at(2588, 9410))).toBe('enclave');
        expect(watchtowerArea(at(2928, 4715, 2))).toBe('mirrorTower');
    });

    test('the city-guard pocket is not swallowed by the lower city', () => {
        expect(watchtowerArea(at(2530, 3029))).toBe('cityGuard');
        expect(watchtowerArea(at(2531, 3026))).toBe('lowerCity');
    });

    test('everything else on the surface is yanille', () => {
        expect(watchtowerArea(at(2612, 3092))).toBe('yanille');
        expect(watchtowerArea(at(2544, 3134))).toBe('yanille');
        expect(watchtowerArea(at(2506, 3023))).toBe('yanille');
    });

    test('a null tile is unknown, never a default area', () => {
        expect(watchtowerArea(null)).toBe('unknown');
        expect(watchtowerArea(undefined)).toBe('unknown');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `areas.ts`**

```ts
// src/bot/quests/defs/watchtower/areas.ts
import Tile from '../../../api/Tile.js';
import type { QuestSnapshot } from '../../engine/types.js';

export interface WatchtowerItem {
    id: number;
    name: string;
}

export const WT_ITEM = {
    COINS: { id: 995, name: 'Coins' },
    ROPE: { id: 954, name: 'Rope' },
    LIT_CANDLE: { id: 33, name: 'Lit candle' },
    VIAL_WATER: { id: 227, name: 'Vial of water' },
    JANGERBERRIES: { id: 247, name: 'Jangerberries' },
    GUAM_LEAF: { id: 249, name: 'Guam leaf' },
    GUAM_VIAL: { id: 91, name: 'Guam potion (unf)' },
    PESTLE: { id: 233, name: 'Pestle and mortar' },
    BAT_BONES: { id: 530, name: 'Bat bones' },
    DRAGON_BONES: { id: 536, name: 'Dragon bones' },
    DEATH_RUNE: { id: 560, name: 'Death rune' },
    OGRE_RELIC: { id: 2372, name: 'Ogre relic' },
    RELIC_PART1: { id: 2373, name: 'Relic part' },
    RELIC_PART2: { id: 2374, name: 'Relic part' },
    RELIC_PART3: { id: 2375, name: 'Relic part' },
    SKAVID_MAP: { id: 2376, name: 'Skavid map' },
    OGRE_TOOTH: { id: 2377, name: 'Ogre tooth' },
    TOBAN_KEY: { id: 2378, name: 'Toban key' },
    ROCK_CAKE: { id: 2379, name: 'Rock cake' },
    CRYSTAL1: { id: 2380, name: 'Powering crystal' },
    CRYSTAL2: { id: 2381, name: 'Powering crystal' },
    CRYSTAL3: { id: 2382, name: 'Powering crystal' },
    CRYSTAL4: { id: 2383, name: 'Powering crystal' },
    FINGERNAILS: { id: 2384, name: 'Fingernails' },
    JANGER_VIAL: { id: 2389, name: 'Jangerberry potion (unf)' },
    GUAM_JANGER_VIAL: { id: 2390, name: 'Guam-jangerberry potion' },
    GROUND_BAT_BONES: { id: 2391, name: 'Ground bat bones' },
    STOLEN_GOLD: { id: 2393, name: 'Gold' },
    OGRE_POTION: { id: 2394, name: 'Ogre potion' },
    MAGIC_OGRE_POTION: { id: 2395, name: 'Magic ogre potion' },
    WATCHTOWER_SPELL: { id: 2396, name: 'Spell scroll' },
    SHAMAN_ROBE: { id: 2397, name: 'Shaman robe' },
    NIGHTSHADE: { id: 2398, name: 'Nightshade' }
} as const satisfies Record<string, WatchtowerItem>;

export const WT_LOC = {
    WALL_CLIMB: 2299,
    TOWER_LADDER: 2833,
    LADDER_TOP: 1746,
    WATCH_LADDER_UP: 2796,
    WATCH_LADDER_DOWN: 2797,
    LEVER: 2794,
    BUSH_NAIL: 2799,
    ROPESWING_NOROPE: 2326,
    ROPESWING: 2324,
    TOBAN_CAVE: 2811,
    TOBAN_LADDER_DOWN: 2812,
    TOBAN_CHEST: 2790,
    GATE_RELIC: 2788,
    ROCK_CAKE_STALL: 2793,
    BATTLEMENT: 2832,
    JUMP_IN: 2830,
    JUMP_OUT: 2831,
    ENCLAVE_CAVE: 2813,
    ROCK_OF_DALGROTH: 2816,
    CAVE_IN: [2805, 2806, 2807, 2808, 2809, 2810],
    CAVE_OUT: [2817, 2818, 2819, 2820, 2821, 2822]
} as const;

export const WT_NPC = {
    WIZARD: 'Watchtower wizard',
    OG: 'Og',
    GREW: 'Grew',
    TOBAN: 'Toban',
    GORAD: 'Gorad',
    CITY_GUARD: 'City guard',
    GUARD_RELIC: 'Ogre guard',
    ENCLAVE_GUARD: 'Enclave guard',
    SHAMAN: 'Ogre shaman',
    SCARED_SKAVID: 'Skavid',
    MAD_SKAVID: 'Skavid'
} as const;

export const WT_TILE = {
    YANILLE_BANK: new Tile(2612, 3092, 0),
    WALL_CLIMB_STAND: new Tile(2548, 3120, 0),
    WALL_TOP: new Tile(2548, 3117, 1),
    TOWER_LADDER_STAND: new Tile(2544, 3112, 0),
    TOWER_L1: new Tile(2544, 3112, 1),
    LADDER_UP_STAND: new Tile(2549, 3112, 1),
    WIZARD_FLOOR: new Tile(2549, 3112, 2),
    LEVER_STAND: new Tile(2543, 3116, 2),
    BUSH_NAIL: new Tile(2544, 3134, 0),
    CANDLE: new Tile(2547, 3115, 0),
    OG: new Tile(2506, 3116, 0),
    ROPESWING_STAND: new Tile(2501, 3087, 0),
    GREW_LANDING: new Tile(2505, 3087, 0),
    GREW: new Tile(2513, 3084, 0),
    GREW_EXIT_STAND: new Tile(2511, 3091, 0),
    GREW_EXIT_ARRIVE: new Tile(2511, 3096, 0),
    JANGERBERRIES: [
        new Tile(2510, 3090, 0),
        new Tile(2512, 3080, 0),
        new Tile(2516, 3086, 0),
        new Tile(2517, 3082, 0)
    ],
    TOBAN_CAVE: new Tile(2499, 2990, 0),
    TOBAN_ARRIVE: new Tile(2576, 3029, 0),
    TOBAN_LADDER: new Tile(2575, 3029, 0),
    TOBAN_CHEST: new Tile(2575, 3032, 0),
    TOBAN: new Tile(2576, 3027, 0),
    GORAD: new Tile(2577, 3021, 0),
    GATE_RELIC_STAND: new Tile(2506, 3062, 0),
    GATE_RELIC_ARRIVE: new Tile(2503, 3062, 0),
    HILL: new Tile(2546, 3065, 0),
    HILL_LOWER: new Tile(2523, 2998, 0),
    ROCK_CAKE_STALL: new Tile(2505, 3023, 0),
    BATTLEMENT_GUARD: new Tile(2503, 3011, 0),
    BATTLEMENT_ARRIVE: new Tile(2508, 3011, 0),
    JUMP_STAND: new Tile(2531, 3026, 0),
    JUMP_ARRIVE: new Tile(2530, 3029, 0),
    JUMP_BACK_STAND: new Tile(2531, 3029, 0),
    CITY_GUARD: new Tile(2541, 3029, 0),
    ENCLAVE_GUARD: new Tile(2507, 3037, 0),
    ENCLAVE_ARRIVE: new Tile(2588, 9410, 0),
    ENCLAVE_EXIT: new Tile(2598, 9469, 0),
    ENCLAVE_EXIT_ARRIVE: new Tile(2540, 3054, 0),
    ROCK_OF_DALGROTH: new Tile(2590, 9450, 0),
    SHAMAN_ROBE: new Tile(2617, 9437, 0),
    SHAMANS: [
        new Tile(2577, 9451, 0),
        new Tile(2582, 9437, 0),
        new Tile(2592, 9436, 0),
        new Tile(2599, 9461, 0),
        new Tile(2606, 9438, 0),
        new Tile(2607, 9451, 0)
    ],
    MIRROR_LADDER_DOWN: new Tile(2933, 4712, 2)
} as const;

export interface SkavidCave {
    index: number;
    mouth: Tile;
    landing: Tile;
    exitArrive: Tile;
}

export const WT_CAVES: readonly SkavidCave[] = [
    { index: 1, mouth: new Tile(2560, 3023, 0), landing: new Tile(2498, 9418, 0), exitArrive: new Tile(2562, 3024, 0) },
    { index: 2, mouth: new Tile(2522, 3069, 0), landing: new Tile(2532, 9469, 0), exitArrive: new Tile(2524, 3070, 0) },
    { index: 3, mouth: new Tile(2539, 3053, 0), landing: new Tile(2518, 9455, 0), exitArrive: new Tile(2540, 3054, 0) },
    { index: 4, mouth: new Tile(2552, 3053, 0), landing: new Tile(2498, 9451, 0), exitArrive: new Tile(2553, 3054, 0) },
    { index: 5, mouth: new Tile(2553, 3034, 0), landing: new Tile(2504, 9441, 0), exitArrive: new Tile(2552, 3034, 0) },
    { index: 6, mouth: new Tile(2527, 3012, 0), landing: new Tile(2522, 9411, 0), exitArrive: new Tile(2529, 3013, 0) }
];

export const WT_NIGHTSHADE = {
    cave2: new Tile(2530, 9462, 0),
    cave6: new Tile(2528, 9415, 0)
} as const;

export type WatchtowerArea =
    | 'yanille'
    | 'towerFloor'
    | 'grewIsland'
    | 'tobanCamp'
    | 'lowerCity'
    | 'cityGuard'
    | 'skavidCaves'
    | 'enclave'
    | 'mirrorTower'
    | 'unknown';

export function watchtowerArea(tile: QuestSnapshot['tile']): WatchtowerArea {
    if (!tile) return 'unknown';
    const { x, z, level } = tile;
    if (x >= 2900 && x <= 2960 && z >= 4670 && z <= 4740) return 'mirrorTower';
    if (z >= 9400 && z <= 9480 && x >= 2490 && x <= 2540) return 'skavidCaves';
    if (z >= 9400 && z <= 9480 && x >= 2560 && x <= 2623) return 'enclave';
    if (level === 2 && x >= 2540 && x <= 2552 && z >= 3108 && z <= 3120) return 'towerFloor';
    if (x >= 2505 && x <= 2519 && z >= 3079 && z <= 3092) return 'grewIsland';
    if (x >= 2565 && x <= 2585 && z >= 3015 && z <= 3040) return 'tobanCamp';
    if (x >= 2527 && x <= 2545 && z >= 3027 && z <= 3036) return 'cityGuard';
    if (x >= 2508 && x <= 2532 && z >= 3005 && z <= 3026) return 'lowerCity';
    return 'yanille';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/quests/defs/watchtower.test.ts && bun run lint`
Expected: PASS (4 tests).

- [ ] **Step 5: Verify the pocket boxes against the collision pack**

The bounding boxes must not claim tiles that belong to a neighbour. Confirm with the probe used
to write the spec:

```bash
bun tools/nav/wt-comp.ts 2541 3029 0 | head -20
```

Expected: the `city-guard pocket bounds` line reads `x 2527..2545, z 3027..3036`, matching the
`cityGuard` box above. If `tools/nav/wt-comp.ts` is absent, skip this step — the unit test above
is the gate.

- [ ] **Step 6: Commit**

```bash
git add src/bot/quests/defs/watchtower/areas.ts test/quests/defs/watchtower.test.ts
git commit -m "feat(watchtower): quest constants and the sealed-pocket area classifier"
```

---

### Task 4: The journal parser

**Files:**
- Create: `src/bot/quests/defs/watchtower/journal.ts`
- Modify: `test/quests/defs/watchtower.test.ts`

**Interfaces:**
- Consumes: `QuestProgress` from Task 1.
- Produces: `WATCHTOWER_STAGE` (const object), `parseWatchtowerJournal(lines: readonly string[] | string): QuestProgress | undefined`, `readWatchtowerProgress(): Promise<QuestProgress | undefined>`.
  Flags emitted: `helped-og`, `helped-grew`, `helped-toban`, `spoken-og`, `spoken-grew`,
  `spoken-toban`, `looking-relic`, `market-asked`, `market-paid`, `has-map`, `learning-skavid`,
  `learned-ar`, `learned-ig`, `learned-cur`, `learned-nod`, `shamans-left:N`, `mined-rock`.

- [ ] **Step 1: Write the failing test**

Append to `test/quests/defs/watchtower.test.ts`:

```ts
import { WATCHTOWER_STAGE, parseWatchtowerJournal } from '#/bot/quests/defs/watchtower/journal.js';
import { flagValue, hasFlag } from '#/bot/quests/engine/types.js';

describe('parseWatchtowerJournal', () => {
    test('not started', () => {
        const p = parseWatchtowerJournal('@dbl@I can start this quest by speaking to the @dre@Watchtower wizard');
        expect(p?.stage).toBe(WATCHTOWER_STAGE.NOT_STARTED);
    });

    test('started, before and after the fingernails are found', () => {
        expect(parseWatchtowerJournal([
            '@dbl@I accepted the challenge of finding the lost @dre@crystals.',
            '@dbl@I need to @dre@find evidence@dbl@ of what happened.'
        ])?.stage).toBe(WATCHTOWER_STAGE.STARTED);
        expect(parseWatchtowerJournal([
            '@dbl@I accepted the challenge of finding the lost @dre@crystals.',
            '@dbl@I found some @dre@fingernails@dbl@ as evidence.'
        ])?.stage).toBe(WATCHTOWER_STAGE.STARTED);
    });

    test('the tribal block reports which tribes are helped', () => {
        const p = parseWatchtowerJournal([
            '@str@I found some fingernails as evidence.',
            "@str@I returned Og's stolen gold.",
            "@dbl@Grew wants me to give him @dre@one of Gorad's teeth.",
            '@dbl@Toban wants the @dre@bones of an adult dragon.'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.GIVEN_FINGERNAILS);
        expect(hasFlag(p, 'helped-og')).toBe(true);
        expect(hasFlag(p, 'spoken-grew')).toBe(true);
        expect(hasFlag(p, 'helped-grew')).toBe(false);
        expect(hasFlag(p, 'spoken-toban')).toBe(true);
        expect(hasFlag(p, 'helped-toban')).toBe(false);
    });

    test('newest entry wins: the riddle line outranks the tribal block', () => {
        const p = parseWatchtowerJournal([
            '@str@I found some fingernails as evidence.',
            "@str@I returned Og's stolen gold.",
            '@dbl@Some guards gave me a @dre@puzzle to solve.'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.GIVEN_RIDDLE);
    });

    test('the map block reports whether the map is carried and which words are known', () => {
        const p = parseWatchtowerJournal([
            '@str@I was given a map by the guard.',
            '@dbl@I have it with me now, so I can navigate the skavid caves.',
            '@dbl@I have been taught a few words of the skavid language:',
            "@dre@'Cur bidith' - 'Ig'",
            "@dre@'Gor cur' - 'Ar'"
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.SOLVED_RIDDLE);
        expect(hasFlag(p, 'has-map')).toBe(true);
        expect(hasFlag(p, 'learning-skavid')).toBe(true);
        expect(hasFlag(p, 'learned-ig')).toBe(true);
        expect(hasFlag(p, 'learned-ar')).toBe(true);
        expect(hasFlag(p, 'learned-cur')).toBe(false);
        expect(hasFlag(p, 'learned-nod')).toBe(false);
    });

    test('the potion block counts the shamans still standing', () => {
        const p = parseWatchtowerJournal([
            '@str@I gave the potion to the wizard.',
            '@str@I need to defeat the ogre shamans.',
            '@dbl@Now I need to @dre@kill 4 ogre shaman(s).'
        ]);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.MADE_POTION);
        expect(flagValue(p, 'shamans-left')).toBe(4);
    });

    test('all shamans dead reports zero left, and the mined rock', () => {
        const p = parseWatchtowerJournal([
            '@str@I gave the potion to the wizard.',
            '@str@I killed all the ogre shamans.',
            '@dbl@I have @dre@mined the sacred rock@dbl@ and have taken the last @dre@crystal.'
        ]);
        expect(flagValue(p, 'shamans-left')).toBe(0);
        expect(hasFlag(p, 'mined-rock')).toBe(true);
    });

    test('complete', () => {
        const p = parseWatchtowerJournal(['@str@My task here is done.', '@dre@QUEST COMPLETE!']);
        expect(p?.stage).toBe(WATCHTOWER_STAGE.COMPLETE);
    });

    test('unrecognised journal text yields undefined, never a default stage', () => {
        expect(parseWatchtowerJournal(['something else entirely'])).toBeUndefined();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL — `journal.js` not found.

- [ ] **Step 3: Write `journal.ts`**

```ts
// src/bot/quests/defs/watchtower/journal.ts
import { actions, reader } from '../../../adapter/ClientAdapter.js';
import { Execution } from '../../../api/Execution.js';
import { Quests } from '../../../api/hud/Quests.js';
import type { QuestProgress } from '../../engine/types.js';

export const WATCHTOWER_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    GIVEN_FINGERNAILS: 2,
    MADE_RELIC: 3,
    GIVEN_RELIC: 4,
    GIVEN_RIDDLE: 5,
    SOLVED_RIDDLE: 6,
    SKAVID_CRYSTAL: 7,
    FED_NIGHTSHADE: 8,
    LEARNED_POTION: 9,
    MADE_POTION: 10,
    FOUND_ALL_CRYSTALS: 11,
    COMPLETE: 13,
    READ_SCROLL: 14
} as const;

const QUEST_NAME = 'Watch Tower';

function normalize(lines: readonly string[] | string): string {
    return (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();
}

const FLAG_LINES: readonly [string, string][] = [
    ["i returned og's stolen gold", 'helped-og'],
    ['og wants me to', 'spoken-og'],
    ["i have og's", 'spoken-og'],
    ["i knocked out one of gorad's teeth", 'helped-grew'],
    ['grew wants me to', 'spoken-grew'],
    ["i have one of gorad's teeth", 'spoken-grew'],
    ['i gave the bones to toban', 'helped-toban'],
    ['toban wants the', 'spoken-toban'],
    ['i have the dragon bones', 'spoken-toban'],
    ['the north west guard wants', 'looking-relic'],
    ['the north-east guard wants', 'market-asked'],
    ['i gave the north-east guard a rock cake', 'market-paid'],
    ['i have it with me now, so i can navigate', 'has-map'],
    ['i have been taught a few words', 'learning-skavid'],
    ["'cur bidith' - 'ig'", 'learned-ig'],
    ["'gor cur' - 'ar'", 'learned-ar'],
    ["'bidith tanath' - 'cur'", 'learned-cur'],
    ["'gor nod' - 'nod'", 'learned-nod'],
    ['i have mined the sacred rock', 'mined-rock']
];

// helped-* implies spoken-*; the journal drops the earlier line once a tribe is satisfied.
const IMPLIED: readonly [string, string][] = [
    ['helped-og', 'spoken-og'],
    ['helped-grew', 'spoken-grew'],
    ['helped-toban', 'spoken-toban']
];

function readFlags(text: string): Set<string> {
    const flags = new Set<string>();
    for (const [needle, flag] of FLAG_LINES) {
        if (text.includes(needle)) {
            flags.add(flag);
        }
    }
    for (const [source, implied] of IMPLIED) {
        if (flags.has(source)) {
            flags.add(implied);
        }
    }
    const kills = text.match(/kill (\d+) ogre shaman/);
    if (kills) {
        flags.add('shamans-left:' + kills[1]);
    } else if (text.includes('i killed all the ogre shamans')) {
        flags.add('shamans-left:0');
    }
    return flags;
}

function readStageOnly(text: string): number | undefined {
    // Later entries retain the complete earlier history, so match newest first.
    if (text.includes('quest complete!')) return WATCHTOWER_STAGE.COMPLETE;
    if (text.includes('i have taken the crystals to the watchtower wizard')) return WATCHTOWER_STAGE.FOUND_ALL_CRYSTALS;
    if (text.includes('he infused it into a magic ogre potion')) return WATCHTOWER_STAGE.MADE_POTION;
    if (text.includes('i need to make the') || text.includes('i have made the ogre potion. i need to get it enchanted')) {
        return WATCHTOWER_STAGE.LEARNED_POTION;
    }
    if (text.includes('i need to defeat the ogre shamans and find the other crystals')) return WATCHTOWER_STAGE.FED_NIGHTSHADE;
    if (text.includes("the other crystals are in the shamans' enclave")) return WATCHTOWER_STAGE.SKAVID_CRYSTAL;
    if (text.includes('i was given a map by the guard')) return WATCHTOWER_STAGE.SOLVED_RIDDLE;
    if (text.includes('some guards gave me a puzzle')) return WATCHTOWER_STAGE.GIVEN_RIDDLE;
    if (text.includes('i gave the ogre relic to the north west guard')) return WATCHTOWER_STAGE.GIVEN_RELIC;
    if (text.includes('now i need to deal with the tribal ogres')) return WATCHTOWER_STAGE.GIVEN_FINGERNAILS;
    if (text.includes('i accepted the challenge of finding the lost')) return WATCHTOWER_STAGE.STARTED;
    if (text.includes('i can start this quest')) return WATCHTOWER_STAGE.NOT_STARTED;
    return undefined;
}

export function parseWatchtowerJournal(lines: readonly string[] | string): QuestProgress | undefined {
    const text = normalize(lines);
    const stage = readStageOnly(text);
    if (stage === undefined) {
        return undefined;
    }
    return { stage, flags: readFlags(text) };
}

export async function readWatchtowerProgress(): Promise<QuestProgress | undefined> {
    const status = Quests.status(QUEST_NAME);
    if (status === 'complete') return { stage: WATCHTOWER_STAGE.COMPLETE, flags: new Set() };
    if (status === 'notStarted') return { stage: WATCHTOWER_STAGE.NOT_STARTED, flags: new Set() };
    if (status !== 'inProgress') return undefined;

    const progress = parseWatchtowerJournal(await Quests.journal(QUEST_NAME));
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return progress;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/quests/defs/watchtower.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 5: Reconcile the stage strings against the live journal**

The stage matchers above are transcribed from `itwatchtower_journal.rs2`; the rendered text can
differ in punctuation. With the engine running on :8888:

```bash
bun tools/watchtower-solo-test.ts --stage 2 --dump-journal
```

That tool arrives in Task 6 — defer this step until then, and correct any matcher that does not
fire against the real text.

- [ ] **Step 6: Commit**

```bash
git add src/bot/quests/defs/watchtower/journal.ts test/quests/defs/watchtower.test.ts
git commit -m "feat(watchtower): parse the quest journal into a stage plus sub-progress flags"
```

---

### Task 5: Module skeleton, record, registration, and nav edges

Makes the quest visible in the dashboard and routable to the wizard, with a `decide()` that
handles only the terminal cases. Everything else parks with an honest reason.

**Files:**
- Create: `src/bot/quests/defs/watchtower/index.ts`
- Modify: `src/bot/quests/data/quests.ts:173-184`
- Modify: `src/bot/quests/defs/index.ts`
- Modify: `src/bot/nav/data/transports.json`
- Modify: `test/quests/defs/watchtower.test.ts`

**Interfaces:**
- Consumes: `WATCHTOWER_STAGE`, `readWatchtowerProgress`, `watchtowerArea`, `WT_TILE`.
- Produces: `export const watchtower: QuestModule`; `export function decide(snap: QuestSnapshot): QuestStep`.

- [ ] **Step 1: Write the failing test**

Append to `test/quests/defs/watchtower.test.ts`:

```ts
import { decide, watchtower } from '#/bot/quests/defs/watchtower/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/quests/engine/types.js';

function snapshot(o: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return {
        journal: o.journal ?? 'inProgress',
        inv: o.inv ?? new Map(),
        invIds: o.invIds ?? new Map(),
        worn: o.worn ?? new Set(),
        wornIds: o.wornIds ?? new Set(),
        noProgress: 0,
        bankCoins: o.bankCoins ?? 0,
        stage: o.stage,
        progress: o.progress,
        bank: o.bank ?? new Map(),
        bankIds: o.bankIds ?? new Map(),
        bankKnown: o.bankKnown ?? true,
        tile: o.tile === undefined ? { x: 2612, z: 3092, level: 0 } : o.tile,
        freeSlots: o.freeSlots ?? 28
    };
}

describe('watchtower decide — terminal cases', () => {
    test('a complete journal is done', () => {
        expect(decide(snapshot({ journal: 'complete' })).kind).toBe('done');
    });

    test('stage 13 is done even before the journal colour catches up', () => {
        expect(decide(snapshot({ stage: WATCHTOWER_STAGE.COMPLETE })).kind).toBe('done');
    });

    test('an unloaded journal waits — it is not notStarted', () => {
        const step = decide(snapshot({ journal: 'unknown' }));
        expect(step.kind).toBe('wait');
    });

    test('a missing stage waits rather than guessing', () => {
        const step = decide(snapshot({ stage: undefined }));
        expect(step.kind).toBe('wait');
    });

    test('the module declares itself owning inventory and keeps coins in tools', () => {
        expect(watchtower.ownsInventory).toBe(true);
        expect(watchtower.tools).toContain('coins');
        expect(watchtower.record.id).toBe('itwatchtower');
        expect(watchtower.record.name).toBe('Watch Tower');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL — `watchtower/index.js` not found.

- [ ] **Step 3: Write the skeleton `index.ts`**

```ts
// src/bot/quests/defs/watchtower/index.ts
import { QUESTS } from '../../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../../engine/types.js';
import { WT_TILE, watchtowerArea } from './areas.js';
import { WATCHTOWER_STAGE, readWatchtowerProgress } from './journal.js';

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete' || (snap.stage ?? -1) >= WATCHTOWER_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.stage === undefined) {
        return { kind: 'wait', reason: 'Watch Tower journal stage unavailable' };
    }
    if (watchtowerArea(snap.tile) === 'unknown') {
        return { kind: 'wait', reason: 'player location unavailable' };
    }
    return { kind: 'wait', reason: 'Watch Tower stage ' + snap.stage + ' is not implemented yet' };
}

export const watchtower: QuestModule = {
    record: QUESTS.find(record => record.id === 'itwatchtower')!,
    bank: WT_TILE.YANILLE_BANK,
    tools: [
        'coins', 'rope', 'lit candle', 'vial of water', 'jangerberries', 'guam leaf',
        'pestle and mortar', 'bat bones', 'ground bat bones', 'dragon bones', 'death rune',
        'ogre relic', 'relic part', 'skavid map', 'ogre tooth', 'toban key', 'rock cake',
        'powering crystal', 'fingernails', 'gold', 'nightshade', 'ogre potion',
        'magic ogre potion', 'guam potion (unf)', 'guam-jangerberry potion'
    ],
    ownsInventory: true,
    readProgress: readWatchtowerProgress,
    sustain: { foods: ['Lobster', 'Swordfish', 'Tuna'], eatBelowHp: 0.6 },
    decide
};
```

- [ ] **Step 4: Give the record its items**

In `src/bot/quests/data/quests.ts`, replace the Watch Tower record's `items: []` with:

```ts
        items: [
            { name: 'Dragon bones', qty: 1, kind: 'mustHave' },
            { name: 'Guam leaf', qty: 1, kind: 'mustHave' },
            { name: 'Bat bones', qty: 1, kind: 'mustHave' }
        ]
```

- [ ] **Step 5: Register the module**

In `src/bot/quests/defs/index.ts` add the import and append to the array:

```ts
import { watchtower } from './watchtower/index.js';
```

```ts
export const QUEST_DEFS: QuestModule[] = [runemysteries, doric, sheepshearer, restlessghost, cooksassistant, hetty, romeojuliet, princeali, waterfall, goblindiplomacy, demonslayer, witchshouse, merlinscrystal, priestperil, blackknight, druidicritual, lostcity, touristtrap, watchtower];
```

- [ ] **Step 6: Add the two nav transport edges**

Append these four objects to the array in `src/bot/nav/data/transports.json`:

```json
  { "from": { "x": 2549, "z": 3112, "level": 1 }, "to": { "x": 2549, "z": 3112, "level": 2 }, "locName": "Ladder", "action": "Climb-up", "kind": "stair" },
  { "from": { "x": 2549, "z": 3112, "level": 2 }, "to": { "x": 2549, "z": 3112, "level": 1 }, "locName": "Ladder", "action": "Climb-down", "kind": "stair" },
  { "from": { "x": 2933, "z": 4712, "level": 2 }, "to": { "x": 2933, "z": 4712, "level": 1 }, "locName": "Ladder", "action": "Climb-down", "kind": "stair" },
  { "from": { "x": 2511, "z": 3091, "level": 0 }, "to": { "x": 2511, "z": 3096, "level": 0 }, "locName": "Ropeswing", "action": "Swing-on", "kind": "dungeon" }
```

- [ ] **Step 7: Verify the wizard's floor is now routable**

```bash
bun tools/nav/route-probe.ts
```

That prints the pack summary; then confirm the new edges took by checking the printed
`transport edges` count rose by 4 from its previous value. Also run:

```bash
bun tools/nav/coverage.ts
```

Expected: no new `FAIL` lines versus before this task.

- [ ] **Step 8: Run tests**

Run: `bun test && bun run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/bot/quests/defs/watchtower/index.ts src/bot/quests/data/quests.ts src/bot/quests/defs/index.ts src/bot/nav/data/transports.json test/quests/defs/watchtower.test.ts
git commit -m "feat(watchtower): register the module, its record items, and the tower/swing nav edges"
```

---

### Task 6: The stage-jumping solo harness

Every later task is gated on a live run. This is the tool that makes those runs cheap.

**Files:**
- Create: `tools/watchtower-solo-test.ts`

**Interfaces:**
- Consumes: `launchBrowser` from `tools/lib/harness.js`; `cheatQuiet`, `mainlandAccount`,
  `startScript` from `tools/tutorial/harness.js`.
- Produces: a CLI:
  `bun tools/watchtower-solo-test.ts [--base URL] [--user NAME] [--stage N] [--bits N] [--give obj:n,...] [--minutes N] [--dump-journal]`.

- [ ] **Step 1: Write the harness**

```ts
// tools/watchtower-solo-test.ts
import { fail, launchBrowser } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, startScript } from './tutorial/harness.js';

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name: string): boolean => argv.includes(name);

const base = opt('--base') ?? 'http://localhost:8888';
const user = opt('--user') ?? `wt${Date.now().toString(36).slice(-7)}`;
const stage = opt('--stage');
const bits = opt('--bits');
const give = opt('--give') ?? '';
const minutes = Number(opt('--minutes') ?? 20);

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
    });

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}'`);

    if (!(await cheatQuiet(page, 'speed 300'))) fail('could not set 2x tick rate');
    if (!(await cheatQuiet(page, '~maxme'))) fail('could not max stats');
    for (const pair of give.split(',').map(s => s.trim()).filter(Boolean)) {
        const [obj, n] = pair.split(':');
        if (!(await cheatQuiet(page, `~item ${obj} ${Number(n) || 1}`))) fail(`could not give ${pair}`);
        console.log(`gave ${pair}`);
    }
    if (stage !== undefined && !(await cheatQuiet(page, `setvar itwatchtower ${stage}`))) {
        fail('could not set itwatchtower');
    }
    if (bits !== undefined && !(await cheatQuiet(page, `setvar itwatchtower_bits ${bits}`))) {
        fail('could not set itwatchtower_bits');
    }
    if (stage !== undefined) console.log(`jumped to stage ${stage}${bits !== undefined ? ` bits ${bits}` : ''}`);

    if (flag('--dump-journal')) {
        const lines = await page.evaluate(async () => {
            const g = globalThis as never as { __rs2b0t: { Quests: { journal(n: string): Promise<string[]> } } };
            return g.__rs2b0t.Quests.journal('Watch Tower');
        });
        console.log('--- journal ---');
        for (const l of lines) console.log(`  ${JSON.stringify(l)}`);
        console.log('--- end journal ---');
    }

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'itwatchtower'));
    await startScript(page, 'AIOQuester');
    console.log('started AIOQuester — watching');

    const deadline = Date.now() + minutes * 60_000;
    let lastLogTime = 0;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: { worldTile(): { x: number; z: number; level: number } | null };
                    Quests: { status(n: string): string; points(): number };
                };
                rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
            };
            return {
                pos: g.__rs2b0t.reader.worldTile(),
                status: g.__rs2b0t.Quests.status('Watch Tower'),
                qp: g.__rs2b0t.Quests.points(),
                runner: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-60)
            };
        });
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(`  t=${t}s pos=${snap.pos ? `${snap.pos.x},${snap.pos.z},${snap.pos.level}` : '?'} status=${snap.status} qp=${snap.qp} runner=${snap.runner}`);
        for (const l of snap.logs) {
            if (l.time > lastLogTime) console.log(`      · [${l.level}] ${l.msg}`);
        }
        if (snap.logs.length > 0) lastLogTime = Math.max(lastLogTime, ...snap.logs.map(l => l.time));
        if (snap.status === 'complete' || snap.runner !== 'running') break;
        await page.waitForTimeout(10_000);
    }
} finally {
    await browser.close();
}
```

- [ ] **Step 2: Verify it boots and reads the journal**

Start the local engine, then:

```bash
bun tools/watchtower-solo-test.ts --stage 2 --dump-journal --minutes 1
```

Expected: an account is created, stats maxed, `itwatchtower` set to 2, and the `--- journal ---`
block prints the real stage-2 text.

- [ ] **Step 3: Complete Task 4 Step 5**

Compare the dumped lines against the matchers in `journal.ts`. Fix any matcher whose needle does
not appear in the real text, and re-run `bun test test/quests/defs/watchtower.test.ts` — update
the test fixtures to the real strings at the same time so the test keeps testing reality.

- [ ] **Step 4: Commit**

```bash
git add tools/watchtower-solo-test.ts src/bot/quests/defs/watchtower/journal.ts test/quests/defs/watchtower.test.ts
git commit -m "test(watchtower): stage-jumping solo harness, and journal matchers checked against the live text"
```

---

### Task 7: The tower — reach the wizard, start the quest, hand in the fingernails

**Files:**
- Create: `src/bot/quests/defs/watchtower/tower.ts`
- Modify: `src/bot/quests/defs/watchtower/index.ts`
- Modify: `test/quests/defs/watchtower.test.ts`

**Interfaces:**
- Consumes: `WT_ITEM`, `WT_LOC`, `WT_TILE`, `watchtowerArea`, `WATCHTOWER_STAGE`.
- Produces: `climbToWizard(stage: number, log): Promise<boolean>`,
  `leaveWizardFloor(log): Promise<boolean>`, `startQuest(log): Promise<boolean>`,
  `handInFingernails(log): Promise<boolean>`, `talkToWizard(prefer: string[], log): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Append to `test/quests/defs/watchtower.test.ts`:

```ts
describe('watchtower decide — the tower', () => {
    test('stage 0 goes to the wizard', () => {
        const step = decide(snapshot({ stage: WATCHTOWER_STAGE.NOT_STARTED }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toMatch(/wizard/i);
    });

    test('stage 1 without fingernails searches the bush', () => {
        const step = decide(snapshot({ stage: WATCHTOWER_STAGE.STARTED }));
        expect(step.kind).toBe('pickLoc');
        expect(step.kind === 'pickLoc' && step.item).toBe('Fingernails');
    });

    test('stage 1 holding fingernails hands them in', () => {
        const step = decide(snapshot({
            stage: WATCHTOWER_STAGE.STARTED,
            invIds: new Map([[2384, 1]])
        }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toMatch(/fingernails/i);
    });

    test('stranded on the wizard floor at a stage with work elsewhere, it climbs down', () => {
        const step = decide(snapshot({
            stage: WATCHTOWER_STAGE.STARTED,
            tile: { x: 2544, z: 3112, level: 2 }
        }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toMatch(/down|leave/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL — stage 0 currently returns `wait`.

- [ ] **Step 3: Write `tower.ts`**

```ts
// src/bot/quests/defs/watchtower/tower.ts
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Reach } from '../../../api/Reach.js';
import { Traversal } from '../../../api/Traversal.js';
import { talkThrough } from '../../exec/primitives.js';
import { WT_ITEM, WT_LOC, WT_NPC, WT_TILE, watchtowerArea } from './areas.js';
import { WATCHTOWER_STAGE } from './journal.js';

function level(): number {
    return Game.tile()?.level ?? -1;
}

async function climbWall(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(WT_TILE.WALL_CLIMB_STAND, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const wall = Locs.query().where(l => l.id === WT_LOC.WALL_CLIMB).within(6).nearest();
    if (!wall || !(await wall.interact('Climb-up'))) {
        log('no climbable Watchtower wall in range');
        return false;
    }
    return Execution.delayUntil(() => level() === 1, 10_000);
}

async function climbTowerLadder(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(WT_TILE.TOWER_LADDER_STAND, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const ladder = Locs.query().where(l => l.id === WT_LOC.TOWER_LADDER).action('Climb-up').within(6).nearest();
    if (!ladder || !(await ladder.interact('Climb-up'))) {
        return false;
    }
    return Execution.delayUntil(() => level() === 1, 10_000);
}

export async function climbToWizard(stage: number, log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) === 'towerFloor') {
        return true;
    }
    if (level() === 0) {
        // The tower guard refuses the ladder until the quest is started, so the baked
        // ground-to-first-floor edge is not usable at stage 0.
        const up = stage <= WATCHTOWER_STAGE.NOT_STARTED ? await climbWall(log) : await climbTowerLadder(log);
        if (!up) {
            return false;
        }
    }
    if (level() !== 1) {
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.LADDER_UP_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const ladder = Locs.query().where(l => l.id === WT_LOC.WATCH_LADDER_UP).action('Climb-up').within(6).nearest();
    if (!ladder || !(await ladder.interact('Climb-up'))) {
        return false;
    }
    return Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'towerFloor', 10_000);
}

export async function leaveWizardFloor(log: (m: string) => void): Promise<boolean> {
    const area = watchtowerArea(Game.tile());
    if (area !== 'towerFloor' && area !== 'mirrorTower') {
        return true;
    }
    const down = Locs.query().where(l => l.id === WT_LOC.WATCH_LADDER_DOWN).action('Climb-down').within(10).nearest();
    if (!down || !(await down.interact('Climb-down'))) {
        log('no Watchtower ladder down in range');
        return false;
    }
    if (!(await Execution.delayUntil(() => level() === 1, 10_000))) {
        return false;
    }
    const out = Locs.query().where(l => l.id === WT_LOC.LADDER_TOP).action('Climb-down').within(10).nearest();
    if (!out || !(await out.interact('Climb-down'))) {
        return false;
    }
    return Execution.delayUntil(() => level() === 0, 10_000);
}

export async function talkToWizard(prefer: string[], log: (m: string) => void): Promise<boolean> {
    if ((await Reach.npcDialog({ name: WT_NPC.WIZARD, near: WT_TILE.WIZARD_FLOOR, log })) !== 'done') {
        return false;
    }
    return talkThrough(WT_NPC.WIZARD, prefer, log);
}

export async function startQuest(log: (m: string) => void): Promise<boolean> {
    if (!(await climbToWizard(WATCHTOWER_STAGE.NOT_STARTED, log))) {
        return false;
    }
    return talkToWizard(
        ["What's the matter?", 'So how come the spell doesn\'t work?', 'Can I be of help?'],
        log
    );
}

export async function handInFingernails(log: (m: string) => void): Promise<boolean> {
    if (Inventory.count(WT_ITEM.FINGERNAILS.name) === 0) {
        log('no fingernails to hand in');
        return false;
    }
    if (!(await climbToWizard(WATCHTOWER_STAGE.STARTED, log))) {
        return false;
    }
    return talkToWizard(['What do you suggest I do?', 'So what do I do?'], log);
}
```

- [ ] **Step 4: Wire the stages into `decide()`**

In `src/bot/quests/defs/watchtower/index.ts`, add imports and replace the final fallback:

```ts
import { WT_ITEM, WT_LOC, WT_TILE, watchtowerArea } from './areas.js';
import { climbToWizard, handInFingernails, leaveWizardFloor, startQuest } from './tower.js';
```

```ts
function held(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete' || (snap.stage ?? -1) >= WATCHTOWER_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }
    if (snap.stage === undefined) {
        return { kind: 'wait', reason: 'Watch Tower journal stage unavailable' };
    }
    const area = watchtowerArea(snap.tile);
    if (area === 'unknown') {
        return { kind: 'wait', reason: 'player location unavailable' };
    }

    switch (snap.stage) {
        case WATCHTOWER_STAGE.NOT_STARTED:
            return { kind: 'custom', name: 'climb the Watchtower and ask the wizard for work', run: startQuest };
        case WATCHTOWER_STAGE.STARTED: {
            if (held(snap, WT_ITEM.FINGERNAILS.id) > 0) {
                return { kind: 'custom', name: 'give the fingernails to the wizard', run: handInFingernails };
            }
            if (area === 'towerFloor') {
                return { kind: 'custom', name: 'climb down from the wizard floor', run: leaveWizardFloor };
            }
            return {
                kind: 'pickLoc',
                loc: 'Bush',
                op: 'Search',
                item: WT_ITEM.FINGERNAILS.name,
                anchor: WT_TILE.BUSH_NAIL
            };
        }
        default:
            return { kind: 'wait', reason: 'Watch Tower stage ' + snap.stage + ' is not implemented yet' };
    }
}
```

Keep `climbToWizard` imported — later tasks use it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test test/quests/defs/watchtower.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 6: Live-verify stage 0 → 2**

```bash
bun tools/watchtower-solo-test.ts --minutes 25
```

Expected in the log: the wall climb at (2548,3119), arrival on the wizard floor, the start
dialogue, a walk to the bush at (2544,3134), `Fingernails` taken, the ladder climb (not the wall,
now that the quest is started), and the journal reaching stage 2. Confirm the **exact bush**: the
`pickLoc` step matches by name `Bush`, and 40+ decoy bushes share that name — if it searches a
decoy, change the step to an `interactLoc` restricted by tile and re-run.

- [ ] **Step 7: Commit**

```bash
git add src/bot/quests/defs/watchtower/tower.ts src/bot/quests/defs/watchtower/index.ts test/quests/defs/watchtower.test.ts
git commit -m "feat(watchtower): reach the wizard, start the quest, hand in the fingernails"
```

---

### Task 8: Og, Toban's cave, and the chest

**Files:**
- Create: `src/bot/quests/defs/watchtower/tribes.ts`
- Modify: `test/quests/defs/watchtower.test.ts`

**Interfaces:**
- Consumes: `WT_ITEM`, `WT_LOC`, `WT_TILE`, `watchtowerArea`.
- Produces: `talkToOg(log): Promise<boolean>`, `enterTobanCamp(log): Promise<boolean>`,
  `leaveTobanCamp(log): Promise<boolean>`, `openTobanChest(log): Promise<boolean>`,
  `talkToToban(log): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

Append to `test/quests/defs/watchtower.test.ts`:

```ts
const P = (stage: number, ...flags: string[]) => ({ stage, flags: new Set(flags) });

describe('watchtower decide — the tribes', () => {
    test('stage 2 with nothing done talks to Og first', () => {
        const step = decide(snapshot({ stage: 2, progress: P(2) }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toMatch(/og/i);
    });

    test('holding the key, it goes for the chest', () => {
        const step = decide(snapshot({
            stage: 2,
            progress: P(2, 'spoken-og'),
            invIds: new Map([[2378, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/chest|gold/i);
    });

    test('holding the stolen gold, it returns to Og', () => {
        const step = decide(snapshot({
            stage: 2,
            progress: P(2, 'spoken-og'),
            invIds: new Map([[2393, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/og/i);
    });

    test('once Og is helped it stops going back to him', () => {
        const step = decide(snapshot({ stage: 2, progress: P(2, 'helped-og') }));
        expect(step.kind === 'custom' && step.name).not.toMatch(/^.*talk to og/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL — stage 2 returns `wait`.

- [ ] **Step 3: Write the Og and Toban legs in `tribes.ts`**

```ts
// src/bot/quests/defs/watchtower/tribes.ts
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Reach } from '../../../api/Reach.js';
import { Traversal } from '../../../api/Traversal.js';
import { talkThrough } from '../../exec/primitives.js';
import { WT_ITEM, WT_LOC, WT_NPC, WT_TILE, watchtowerArea } from './areas.js';

function heldId(id: number): number {
    return Inventory.items().filter(i => i.id === id).reduce((sum, i) => sum + i.count, 0);
}

export async function talkToOg(log: (m: string) => void): Promise<boolean> {
    if ((await Reach.npcDialog({ name: WT_NPC.OG, near: WT_TILE.OG, log })) !== 'done') {
        return false;
    }
    return talkThrough(WT_NPC.OG, ['I seek entrance to the city of ogres.', 'I have your gold.'], log);
}

export async function enterTobanCamp(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) === 'tobanCamp') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.TOBAN_CAVE, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const cave = Locs.query().where(l => l.id === WT_LOC.TOBAN_CAVE).action('Enter').within(8).nearest();
    if (!cave || !(await cave.interact('Enter'))) {
        log('no Toban cave entrance in range');
        return false;
    }
    return Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'tobanCamp', 15_000);
}

export async function leaveTobanCamp(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) !== 'tobanCamp') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.TOBAN_LADDER, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const ladder = Locs.query().where(l => l.id === WT_LOC.TOBAN_LADDER_DOWN).action('Climb-down').within(6).nearest();
    if (!ladder || !(await ladder.interact('Climb-down'))) {
        return false;
    }
    return Execution.delayUntil(() => watchtowerArea(Game.tile()) !== 'tobanCamp', 15_000);
}

export async function openTobanChest(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.STOLEN_GOLD.id) > 0) {
        return true;
    }
    if (!(await enterTobanCamp(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.TOBAN_CHEST, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const chest = Locs.query().where(l => l.id === WT_LOC.TOBAN_CHEST).within(6).nearest();
    const key = Inventory.items().find(i => i.id === WT_ITEM.TOBAN_KEY.id);
    if (!chest || !key) {
        log('no chest or no key at Toban\'s camp');
        return false;
    }
    // op1 eats the key; using the key on the chest keeps it for a second opening.
    if (!(await key.useOn(chest))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(WT_ITEM.STOLEN_GOLD.id) > 0, 8000);
}

export async function talkToToban(log: (m: string) => void): Promise<boolean> {
    if (!(await enterTobanCamp(log))) {
        return false;
    }
    if ((await Reach.npcDialog({ name: WT_NPC.TOBAN, near: WT_TILE.TOBAN, log })) !== 'done') {
        return false;
    }
    return talkThrough(
        WT_NPC.TOBAN,
        ['I seek entrance to the city of ogres.', 'I could do something for you...'],
        log
    );
}
```

- [ ] **Step 4: Wire the Og/Toban half of stage 2 into `decide()`**

Add to `index.ts`, replacing the `default:` arm's coverage of stage 2 with a dedicated case that
calls a new `stageTribes` function (Grew and Gorad arrive in Task 9; until then their branches
fall through to `wait`):

```ts
import { hasFlag } from '../../engine/types.js';
import { enterTobanCamp, leaveTobanCamp, openTobanChest, talkToOg, talkToToban } from './tribes.js';
```

```ts
function stageTribes(snap: QuestSnapshot, area: WatchtowerArea): QuestStep {
    const p = snap.progress;

    if (!hasFlag(p, 'helped-og')) {
        if (held(snap, WT_ITEM.STOLEN_GOLD.id) > 0 || !hasFlag(p, 'spoken-og')) {
            return { kind: 'custom', name: 'talk to Og', run: talkToOg };
        }
        if (held(snap, WT_ITEM.TOBAN_KEY.id) > 0) {
            return { kind: 'custom', name: "take the stolen gold from Toban's chest", run: openTobanChest };
        }
        return { kind: 'custom', name: 'ask Og for another chest key', run: talkToOg };
    }

    if (!hasFlag(p, 'helped-toban')) {
        if (!hasFlag(p, 'spoken-toban') || held(snap, WT_ITEM.DRAGON_BONES.id) > 0) {
            return { kind: 'custom', name: 'talk to Toban', run: talkToToban };
        }
        if ((snap.bankIds?.get(WT_ITEM.DRAGON_BONES.id) ?? 0) > 0) {
            return {
                kind: 'withdraw',
                items: [{ name: WT_ITEM.DRAGON_BONES.name, id: WT_ITEM.DRAGON_BONES.id, qty: 1 }],
                bank: WT_TILE.YANILLE_BANK
            };
        }
        if (!snap.bankKnown) {
            return { kind: 'scanBank', bank: WT_TILE.YANILLE_BANK };
        }
        return { kind: 'wait', reason: 'no Dragon bones in the bank for Toban' };
    }

    if (area === 'tobanCamp') {
        return { kind: 'custom', name: "leave Toban's camp", run: leaveTobanCamp };
    }
    return { kind: 'wait', reason: 'Grew and Gorad are not implemented yet' };
}
```

and in the switch:

```ts
        case WATCHTOWER_STAGE.GIVEN_FINGERNAILS:
            return stageTribes(snap, area);
```

Import `WatchtowerArea` as a type from `./areas.js`.

- [ ] **Step 5: Run tests**

Run: `bun test test/quests/defs/watchtower.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 6: Live-verify the Og → chest → Og → Toban chain**

```bash
bun tools/watchtower-solo-test.ts --stage 2 --give dragon_bones:1 --minutes 30
```

Expected: Og gives the key; the bot walks to (2499,2990), enters the cave, arrives at (2576,3029),
uses the key on the chest at (2575,3031), returns to Og with the gold, receives `relicpart1`, then
talks to Toban and hands over the dragon bones for `relicpart3`. Verify the key is **still in the
pack** after the chest opens — if it is gone, the `useOn` did not take and the leg fell back to
op1.

- [ ] **Step 7: Commit**

```bash
git add src/bot/quests/defs/watchtower/tribes.ts src/bot/quests/defs/watchtower/index.ts test/quests/defs/watchtower.test.ts
git commit -m "feat(watchtower): Og's key, Toban's chest, and Toban's dragon bones"
```

---

### Task 9: Grew's island, the jangerberries, and Gorad

**Files:**
- Modify: `src/bot/quests/defs/watchtower/tribes.ts`
- Modify: `src/bot/quests/defs/watchtower/index.ts`
- Modify: `test/quests/defs/watchtower.test.ts`

**Interfaces:**
- Consumes: everything from Task 8.
- Produces: `swingToGrewIsland(log): Promise<boolean>`, `leaveGrewIsland(log): Promise<boolean>`,
  `talkToGrew(log): Promise<boolean>`, `pickJangerberries(log): Promise<boolean>`,
  `killGorad(log): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('watchtower decide — Grew and Gorad', () => {
    const helpedOgToban = ['helped-og', 'helped-toban'];

    test('Grew is spoken to before Gorad is attacked', () => {
        const step = decide(snapshot({ stage: 2, progress: P(2, ...helpedOgToban) }));
        expect(step.kind === 'custom' && step.name).toMatch(/grew/i);
    });

    test('once Grew has asked for the tooth, it goes for Gorad', () => {
        const step = decide(snapshot({ stage: 2, progress: P(2, ...helpedOgToban, 'spoken-grew') }));
        expect(step.kind === 'custom' && step.name).toMatch(/gorad/i);
    });

    test('holding the tooth, it returns to Grew', () => {
        const step = decide(snapshot({
            stage: 2,
            progress: P(2, ...helpedOgToban, 'spoken-grew'),
            invIds: new Map([[2377, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/grew/i);
    });

    test('it needs a rope in the pack before swinging to Grew', () => {
        const step = decide(snapshot({
            stage: 2,
            progress: P(2, ...helpedOgToban),
            bankIds: new Map([[954, 5]])
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('it picks jangerberries while on the island and short of them', () => {
        const step = decide(snapshot({
            stage: 2,
            progress: P(2, ...helpedOgToban, 'spoken-grew', 'helped-grew'),
            tile: { x: 2513, z: 3084, level: 0 },
            invIds: new Map([[954, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/jangerberr/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the Grew and Gorad legs to `tribes.ts`**

```ts
export async function swingToGrewIsland(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) === 'grewIsland') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.ROPESWING_STAND, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const tree = Locs.query().where(l => l.id === WT_LOC.ROPESWING_NOROPE).within(6).nearest();
    const rope = Inventory.items().find(i => i.id === WT_ITEM.ROPE.id);
    if (!tree || !rope) {
        log('no rope, or no swing tree, at the Grew crossing');
        return false;
    }
    if (!(await rope.useOn(tree))) {
        return false;
    }
    return Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'grewIsland', 15_000);
}

export async function leaveGrewIsland(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) !== 'grewIsland') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.GREW_EXIT_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const swing = Locs.query().where(l => l.id === WT_LOC.ROPESWING).action('Swing-on').within(6).nearest();
    if (!swing || !(await swing.interact('Swing-on'))) {
        log('no Grew-island rope swing in range');
        return false;
    }
    return Execution.delayUntil(() => watchtowerArea(Game.tile()) !== 'grewIsland', 15_000);
}

export async function talkToGrew(log: (m: string) => void): Promise<boolean> {
    if (!(await swingToGrewIsland(log))) {
        return false;
    }
    if ((await Reach.npcDialog({ name: WT_NPC.GREW, near: WT_TILE.GREW, log })) !== 'done') {
        return false;
    }
    return talkThrough(WT_NPC.GREW, ['Don\'t eat me; I can help you.', 'Can I do anything else for you?'], log);
}

export async function pickJangerberries(log: (m: string) => void): Promise<boolean> {
    if (!(await swingToGrewIsland(log))) {
        return false;
    }
    for (const spot of WT_TILE.JANGERBERRIES) {
        if (heldId(WT_ITEM.JANGERBERRIES.id) >= JANGERBERRY_TARGET) {
            return true;
        }
        if (!(await Traversal.walkResilient(spot, { radius: 1, attempts: 2, timeoutMs: 45_000, log }))) {
            continue;
        }
        const berry = GroundItems.query().name(WT_ITEM.JANGERBERRIES.name).within(3).nearest();
        if (berry) {
            const before = heldId(WT_ITEM.JANGERBERRIES.id);
            await berry.take();
            await Execution.delayUntil(() => heldId(WT_ITEM.JANGERBERRIES.id) > before, 5000);
        }
    }
    return heldId(WT_ITEM.JANGERBERRIES.id) > 0;
}

export async function killGorad(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.OGRE_TOOTH.id) > 0) {
        return true;
    }
    if (Inventory.free() === 0) {
        log('no free slot — Gorad drops nothing into a full pack');
        return false;
    }
    if (!(await enterTobanCamp(log))) {
        return false;
    }
    if ((await Reach.npcDialog({ name: WT_NPC.GORAD, near: WT_TILE.GORAD, log })) !== 'done') {
        return false;
    }
    if (!(await talkThrough(WT_NPC.GORAD, ['I don\'t know who you are.'], log))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(WT_ITEM.OGRE_TOOTH.id) > 0, 180_000);
}
```

Add at the top of the file:

```ts
import { GroundItems } from '../../../api/queries/GroundItems.js';

export const JANGERBERRY_TARGET = 2;
```

`Reach.npcDialog` opens the conversation; Gorad's `opnpc1` immediately retaliates once Grew has
been spoken to, and the shared combat sustain in the AIOQuester host handles the fight. The
180-second `delayUntil` is the kill window.

- [ ] **Step 4: Complete `stageTribes` in `index.ts`**

Replace the tail of `stageTribes` (the `'Grew and Gorad are not implemented yet'` wait) with:

```ts
    if (!hasFlag(p, 'helped-grew')) {
        if (held(snap, WT_ITEM.OGRE_TOOTH.id) > 0 || !hasFlag(p, 'spoken-grew')) {
            const rope = needRope(snap);
            return rope ?? { kind: 'custom', name: 'talk to Grew', run: talkToGrew };
        }
        return { kind: 'custom', name: "knock out one of Gorad's teeth", run: killGorad };
    }

    if (held(snap, WT_ITEM.JANGERBERRIES.id) === 0 && (snap.bankIds?.get(WT_ITEM.JANGERBERRIES.id) ?? 0) === 0) {
        const rope = needRope(snap);
        return rope ?? { kind: 'custom', name: 'pick jangerberries on Grew island', run: pickJangerberries };
    }

    if (area === 'grewIsland') {
        return { kind: 'custom', name: 'swing back off Grew island', run: leaveGrewIsland };
    }
    if (area === 'tobanCamp') {
        return { kind: 'custom', name: "leave Toban's camp", run: leaveTobanCamp };
    }
    return { kind: 'wait', reason: 'the relic hand-in is not implemented yet' };
```

and add the helper above `stageTribes`:

```ts
function needRope(snap: QuestSnapshot): QuestStep | null {
    if (watchtowerArea(snap.tile) === 'grewIsland' || held(snap, WT_ITEM.ROPE.id) > 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: WT_TILE.YANILLE_BANK };
    }
    if ((snap.bankIds?.get(WT_ITEM.ROPE.id) ?? 0) > 0) {
        return {
            kind: 'withdraw',
            items: [{ name: WT_ITEM.ROPE.name, id: WT_ITEM.ROPE.id, qty: 2 }],
            bank: WT_TILE.YANILLE_BANK
        };
    }
    return {
        kind: 'buy',
        item: WT_ITEM.ROPE.name,
        qty: 2,
        shop: { npc: 'Shop keeper', anchor: new Tile(2615, 3294, 0) },
        estGp: 40
    };
}
```

Import `Tile` from `../../../api/Tile.js`, and the new tribe functions.

- [ ] **Step 5: Run tests**

Run: `bun test test/quests/defs/watchtower.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 6: Live-verify the Grew/Gorad chain**

```bash
bun tools/watchtower-solo-test.ts --stage 2 --bits 68 --give rope:2 --minutes 30
```

`--bits 68` sets `helped_og` (bit 6) and `helped_toban` (bit 2). Expected: rope used on the tree
at (2499,3087), landing at (2505,3087), Grew asks for the tooth, the bot swings out at
(2511,3091), enters Toban's camp, kills Gorad, returns to Grew with the tooth, and receives
`relicpart2` plus `powering_crystal1`. Confirm the jangerberries are picked on one of the visits.

- [ ] **Step 7: Commit**

```bash
git add src/bot/quests/defs/watchtower/tribes.ts src/bot/quests/defs/watchtower/index.ts test/quests/defs/watchtower.test.ts
git commit -m "feat(watchtower): Grew's island, the jangerberry spawns, and Gorad's tooth"
```

---

### Task 10: Assemble the relic

**Files:**
- Modify: `src/bot/quests/defs/watchtower/tower.ts`
- Modify: `src/bot/quests/defs/watchtower/index.ts`
- Modify: `test/quests/defs/watchtower.test.ts`

**Interfaces:**
- Consumes: `climbToWizard`, `talkToWizard`.
- Produces: `giveRelicPart(id: number, log): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('watchtower decide — the relic', () => {
    const allTribes = ['helped-og', 'helped-grew', 'helped-toban'];

    test('holding a relic part with every tribe helped, it takes it to the wizard', () => {
        const step = decide(snapshot({
            stage: 2,
            progress: P(2, ...allTribes),
            invIds: new Map([[2373, 1], [247, 2]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/relic part/i);
    });

    test('with no parts left and the tribes done, it waits on the wizard rather than looping', () => {
        const step = decide(snapshot({
            stage: 2,
            progress: P(2, ...allTribes),
            invIds: new Map([[247, 2]])
        }));
        expect(step.kind).toBe('wait');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add `giveRelicPart` to `tower.ts`**

```ts
export async function giveRelicPart(id: number, log: (m: string) => void): Promise<boolean> {
    if (!(await climbToWizard(WATCHTOWER_STAGE.GIVEN_FINGERNAILS, log))) {
        return false;
    }
    const part = Inventory.items().find(i => i.id === id);
    if (!part) {
        log(`relic part ${id} is not in the pack`);
        return false;
    }
    const wizard = Npcs.query().name(WT_NPC.WIZARD).nearest();
    if (!wizard || !(await part.useOn(wizard))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => Inventory.items().every(i => i.id !== id), 8000))) {
        return false;
    }
    return driveDialog([], log);
}
```

Import `Npcs` from `../../../api/queries/Npcs.js` and `driveDialog` from `../../exec/primitives.js`.

- [ ] **Step 4: Wire it into `stageTribes`**

Insert immediately after the `helped-grew` block and before the jangerberry block:

```ts
    for (const part of [WT_ITEM.RELIC_PART1, WT_ITEM.RELIC_PART2, WT_ITEM.RELIC_PART3]) {
        if (held(snap, part.id) > 0) {
            return {
                kind: 'custom',
                name: `give relic part ${part.id - 2372} to the wizard`,
                run: log => giveRelicPart(part.id, log)
            };
        }
    }
```

and change the final `wait` to:

```ts
    return { kind: 'wait', reason: 'every tribe is helped but no relic part is in the pack' };
```

- [ ] **Step 5: Run tests**

Run: `bun test test/quests/defs/watchtower.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 6: Live-verify stage 2 → 3**

```bash
bun tools/watchtower-solo-test.ts --stage 2 --give dragon_bones:1,rope:2 --minutes 45
```

Expected: the full tribal chain runs and the journal reaches stage 3 with `Ogre relic` in the
pack.

- [ ] **Step 7: Commit**

```bash
git add src/bot/quests/defs/watchtower/tower.ts src/bot/quests/defs/watchtower/index.ts test/quests/defs/watchtower.test.ts
git commit -m "feat(watchtower): hand the three relic parts to the wizard"
```

---

### Task 11: The relic gate into Gu'Tanoth

`ogre_guard2` takes **two** interactions. The first talk sets `looking_relic` and teleports the
player to the hill at (2546,3065); only then does using the relic on him work.

**Files:**
- Create: `src/bot/quests/defs/watchtower/gutanoth.ts`
- Modify: `src/bot/quests/defs/watchtower/index.ts`
- Modify: `test/quests/defs/watchtower.test.ts`

**Interfaces:**
- Consumes: `WT_ITEM`, `WT_NPC`, `WT_TILE`, `watchtowerArea`.
- Produces: `showRelicToGuard(log): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('watchtower decide — the relic gate', () => {
    test('stage 3 holding the relic shows it to the north-west guard', () => {
        const step = decide(snapshot({
            stage: 3,
            progress: P(3),
            invIds: new Map([[2372, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/guard/i);
    });

    test('stage 3 without the relic asks the wizard for a copy', () => {
        const step = decide(snapshot({ stage: 3, progress: P(3) }));
        expect(step.kind === 'custom' && step.name).toMatch(/wizard|copy|another/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL — stage 3 returns `wait`.

- [ ] **Step 3: Write `gutanoth.ts`**

```ts
// src/bot/quests/defs/watchtower/gutanoth.ts
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { Reach } from '../../../api/Reach.js';
import { Traversal } from '../../../api/Traversal.js';
import { talkThrough } from '../../exec/primitives.js';
import { WT_ITEM, WT_NPC, WT_TILE, watchtowerArea } from './areas.js';

function heldId(id: number): number {
    return Inventory.items().filter(i => i.id === id).reduce((sum, i) => sum + i.count, 0);
}

function insideCity(): boolean {
    const t = Game.tile();
    return t !== null && t.x <= 2504 && t.z >= 3060 && t.z <= 3066;
}

export async function showRelicToGuard(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.OGRE_RELIC.id) === 0) {
        log('no Ogre relic in the pack');
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.GATE_RELIC_STAND, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const guard = Npcs.query().name(WT_NPC.GUARD_RELIC).nearest();
    if (!guard) {
        log('no ogre guard at the north-west gate');
        return false;
    }
    const relic = Inventory.items().find(i => i.id === WT_ITEM.OGRE_RELIC.id);
    if (!relic || !(await relic.useOn(guard))) {
        return false;
    }
    await talkThrough(WT_NPC.GUARD_RELIC, [], log);
    if (await Execution.delayUntil(() => insideCity(), 10_000)) {
        return true;
    }
    // First contact only sets "he wants a sign of friendship" and throws us down the
    // hill. Walking back and repeating is the documented second half of the crossing.
    log('guard threw us down the hill — returning to show the relic again');
    if (!(await Traversal.walkResilient(WT_TILE.GATE_RELIC_STAND, { radius: 2, attempts: 3, timeoutMs: 180_000, log }))) {
        return false;
    }
    const again = Npcs.query().name(WT_NPC.GUARD_RELIC).nearest();
    const relicAgain = Inventory.items().find(i => i.id === WT_ITEM.OGRE_RELIC.id);
    if (!again || !relicAgain || !(await relicAgain.useOn(again))) {
        return false;
    }
    await talkThrough(WT_NPC.GUARD_RELIC, [], log);
    return Execution.delayUntil(() => insideCity(), 10_000);
}

export { heldId as gutanothHeld, insideCity };
```

- [ ] **Step 4: Wire stage 3 into `decide()`**

```ts
import { showRelicToGuard } from './gutanoth.js';
import { askWizardForRelic } from './tower.js';
```

```ts
        case WATCHTOWER_STAGE.MADE_RELIC: {
            if (held(snap, WT_ITEM.OGRE_RELIC.id) > 0) {
                return { kind: 'custom', name: 'show the relic to the north-west ogre guard', run: showRelicToGuard };
            }
            if ((snap.bankIds?.get(WT_ITEM.OGRE_RELIC.id) ?? 0) > 0) {
                return {
                    kind: 'withdraw',
                    items: [{ name: WT_ITEM.OGRE_RELIC.name, id: WT_ITEM.OGRE_RELIC.id, qty: 1 }],
                    bank: WT_TILE.YANILLE_BANK
                };
            }
            return { kind: 'custom', name: 'ask the wizard for another relic', run: askWizardForRelic };
        }
```

Add to `tower.ts`:

```ts
export async function askWizardForRelic(log: (m: string) => void): Promise<boolean> {
    if (!(await climbToWizard(WATCHTOWER_STAGE.MADE_RELIC, log))) {
        return false;
    }
    return talkToWizard(['I have lost the relic you gave me.'], log);
}
```

- [ ] **Step 5: Run tests**

Run: `bun test test/quests/defs/watchtower.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 6: Live-verify stage 3 → 4**

```bash
bun tools/watchtower-solo-test.ts --stage 3 --give ogrerelic:1 --minutes 20
```

Expected: two approaches to (2506,3062) — the first ends with a teleport to (2546,3065), the
second passes the gate and lands at (2503,3062) with the journal at stage 4. Confirm the relic is
**not** consumed.

- [ ] **Step 7: Commit**

```bash
git add src/bot/quests/defs/watchtower/gutanoth.ts src/bot/quests/defs/watchtower/tower.ts src/bot/quests/defs/watchtower/index.ts test/quests/defs/watchtower.test.ts
git commit -m "feat(watchtower): pass the north-west gate with the ogre relic"
```

---

### Task 12: Rock cake, battlement, chasm jump, riddle, death rune

**Files:**
- Modify: `src/bot/quests/defs/watchtower/gutanoth.ts`
- Modify: `src/bot/quests/defs/watchtower/index.ts`
- Modify: `test/quests/defs/watchtower.test.ts`

**Interfaces:**
- Consumes: Task 11.
- Produces: `stealRockCake(log)`, `crossBattlement(log)`, `jumpChasm(log)`, `jumpBack(log)`,
  `askRiddle(log)`, `answerRiddle(log)`, `sourceDeathRune(snap): QuestStep | null`.

- [ ] **Step 1: Write the failing test**

```ts
describe('watchtower decide — into the city guard pocket', () => {
    test('stage 4 with no rock cake steals one', () => {
        const step = decide(snapshot({ stage: 4, progress: P(4, 'market-asked') }));
        expect(step.kind === 'custom' && step.name).toMatch(/rock cake|steal/i);
    });

    test('stage 4 with the market paid and standing in the lower city jumps the chasm', () => {
        const step = decide(snapshot({
            stage: 4,
            progress: P(4, 'market-paid'),
            tile: { x: 2526, z: 3018, level: 0 },
            invIds: new Map([[995, 500]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/jump|chasm/i);
    });

    test('the chasm jump is not attempted without the 20gp toll', () => {
        const step = decide(snapshot({
            stage: 4,
            progress: P(4, 'market-paid'),
            tile: { x: 2526, z: 3018, level: 0 },
            invIds: new Map()
        }));
        expect(step.kind).not.toBe('custom');
    });

    test('stage 5 in the pocket uses the death rune on the guard', () => {
        const step = decide(snapshot({
            stage: 5,
            progress: P(5),
            tile: { x: 2541, z: 3029, level: 0 },
            invIds: new Map([[560, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/riddle|rune/i);
    });

    test('stage 5 without a death rune buys one', () => {
        const step = decide(snapshot({
            stage: 5,
            progress: P(5),
            tile: { x: 2541, z: 3029, level: 0 },
            invIds: new Map([[995, 500]]),
            bankKnown: true
        }));
        expect(step.kind).toBe('buy');
    });

    test('stage 6 holding the map moves on to the caves', () => {
        const step = decide(snapshot({
            stage: 6,
            progress: P(6, 'has-map'),
            invIds: new Map([[2376, 1]])
        }));
        expect(step.kind).not.toBe('wait');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the city legs to `gutanoth.ts`**

```ts
import { Locs } from '../../../api/queries/Locs.js';
import { WT_LOC } from './areas.js';

const CHASM_TOLL = 20;

export async function stealRockCake(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.ROCK_CAKE.id) > 0) {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.ROCK_CAKE_STALL, { radius: 1, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    for (let attempt = 0; attempt < 6; attempt++) {
        const stall = Locs.query().where(l => l.id === WT_LOC.ROCK_CAKE_STALL).action('Steal-From').within(6).nearest();
        if (!stall) {
            // The counter swaps to its empty form for 12 ticks after a theft.
            await Execution.delayTicks(6);
            continue;
        }
        if (await stall.interact('Steal-From')) {
            if (await Execution.delayUntil(() => heldId(WT_ITEM.ROCK_CAKE.id) > 0, 6000)) {
                return true;
            }
        }
        await Execution.delayTicks(4);
    }
    log('could not steal a rock cake — the ogre trader may be guarding the stall');
    return false;
}

export async function crossBattlement(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) === 'lowerCity') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.BATTLEMENT_GUARD, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const guard = Npcs.query().name(WT_NPC.GUARD_RELIC).nearest();
    if (!guard) {
        log('no battlement guard in range');
        return false;
    }
    // First contact sets "prove it with a gift"; the cake is what satisfies it.
    const cake = Inventory.items().find(i => i.id === WT_ITEM.ROCK_CAKE.id);
    const opened = cake ? await cake.useOn(guard) : await guard.interact('Talk-to');
    if (!opened) {
        return false;
    }
    await talkThrough(WT_NPC.GUARD_RELIC, ['But I am a friend to ogres...'], log);
    if (await Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'lowerCity', 10_000)) {
        return true;
    }
    // Handing the cake over auto-climbs; if it did not, climb the wall ourselves.
    const wall = Locs.query().where(l => l.id === WT_LOC.BATTLEMENT).action('Climb-over').within(8).nearest();
    if (!wall || !(await wall.interact('Climb-over'))) {
        return false;
    }
    return Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'lowerCity', 10_000);
}

export async function jumpChasm(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) === 'cityGuard') {
        return true;
    }
    if (heldId(WT_ITEM.COINS.id) < CHASM_TOLL) {
        log(`need ${CHASM_TOLL} gp for the chasm toll`);
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.JUMP_STAND, { radius: 1, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const rock = Locs.query().where(l => l.id === WT_LOC.JUMP_IN).action('Jump-From').within(6).nearest();
    if (!rock || !(await rock.interact('Jump-From'))) {
        log('no Jump-From rock at the chasm — check whether the level-1 loc is clickable from level 0');
        return false;
    }
    if (!(await talkThrough(WT_NPC.GUARD_RELIC, ["Okay, I'll pay it."], log))) {
        return false;
    }
    return Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'cityGuard', 12_000);
}

export async function jumpBack(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) !== 'cityGuard') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.JUMP_BACK_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const rock = Locs.query().where(l => l.id === WT_LOC.JUMP_OUT).action('Jump-From').within(6).nearest();
    if (!rock || !(await rock.interact('Jump-From'))) {
        return false;
    }
    return Execution.delayUntil(() => watchtowerArea(Game.tile()) !== 'cityGuard', 12_000);
}

export async function askRiddle(log: (m: string) => void): Promise<boolean> {
    if (!(await jumpChasm(log))) {
        return false;
    }
    if ((await Reach.npcDialog({ name: WT_NPC.CITY_GUARD, near: WT_TILE.CITY_GUARD, log })) !== 'done') {
        return false;
    }
    return talkThrough(WT_NPC.CITY_GUARD, ['I seek passage into the skavid caves.'], log);
}

export async function answerRiddle(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.DEATH_RUNE.id) === 0) {
        log('no Death rune to answer the riddle with');
        return false;
    }
    if (!(await jumpChasm(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.CITY_GUARD, { radius: 2, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const guard = Npcs.query().name(WT_NPC.CITY_GUARD).nearest();
    const rune = Inventory.items().find(i => i.id === WT_ITEM.DEATH_RUNE.id);
    if (!guard || !rune || !(await rune.useOn(guard))) {
        return false;
    }
    await talkThrough(WT_NPC.CITY_GUARD, [], log);
    return Execution.delayUntil(() => heldId(WT_ITEM.SKAVID_MAP.id) > 0, 10_000);
}
```

- [ ] **Step 4: Add death-rune sourcing to `supplies.ts`**

```ts
// src/bot/quests/defs/watchtower/supplies.ts
import Tile from '../../../api/Tile.js';
import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { WT_ITEM, WT_TILE } from './areas.js';

export const MAGIC_GUILD = { npc: 'Shop keeper', anchor: new Tile(2596, 3088, 0) };
const DEATH_RUNE_PRICE = 300;

export function heldOf(snap: QuestSnapshot, id: number): number {
    return snap.invIds?.get(id) ?? 0;
}

export function bankedOf(snap: QuestSnapshot, id: number): number {
    return snap.bankIds?.get(id) ?? 0;
}

/** Bank first, then shop. Returns null when the item is already carried. */
export function source(
    snap: QuestSnapshot,
    item: { id: number; name: string },
    qty: number,
    shop: { npc: string; anchor: Tile },
    unitGp: number
): QuestStep | null {
    if (heldOf(snap, item.id) >= qty) {
        return null;
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: WT_TILE.YANILLE_BANK };
    }
    const missing = qty - heldOf(snap, item.id);
    const inBank = bankedOf(snap, item.id);
    if (inBank > 0) {
        return {
            kind: 'withdraw',
            items: [{ name: item.name, id: item.id, qty: Math.min(missing, inBank) }],
            bank: WT_TILE.YANILLE_BANK
        };
    }
    return { kind: 'buy', item: item.name, qty: missing, shop, estGp: missing * unitGp };
}

export function sourceDeathRune(snap: QuestSnapshot): QuestStep | null {
    return source(snap, WT_ITEM.DEATH_RUNE, 1, MAGIC_GUILD, DEATH_RUNE_PRICE);
}
```

- [ ] **Step 5: Wire stages 4 and 5 into `decide()`**

```ts
        case WATCHTOWER_STAGE.GIVEN_RELIC: {
            if (area === 'cityGuard') {
                return { kind: 'custom', name: 'ask the city guard for passage', run: askRiddle };
            }
            if (!hasFlag(snap.progress, 'market-paid')) {
                if (held(snap, WT_ITEM.ROCK_CAKE.id) === 0) {
                    return { kind: 'custom', name: 'steal a rock cake from the ogre stall', run: stealRockCake };
                }
                return { kind: 'custom', name: 'give the rock cake to the battlement guard', run: crossBattlement };
            }
            if (held(snap, WT_ITEM.COINS.id) < 60) {
                const coins = sourceCoins(snap, 300);
                if (coins) return coins;
            }
            if (area !== 'lowerCity') {
                return { kind: 'custom', name: 'climb the battlement into the lower city', run: crossBattlement };
            }
            return { kind: 'custom', name: 'pay the ogre guard and jump the chasm', run: askRiddle };
        }
        case WATCHTOWER_STAGE.GIVEN_RIDDLE: {
            const rune = sourceDeathRune(snap);
            if (rune) return rune;
            return { kind: 'custom', name: 'answer the riddle with a death rune', run: answerRiddle };
        }
```

Add `sourceCoins` to `supplies.ts`:

```ts
export function sourceCoins(snap: QuestSnapshot, want: number): QuestStep | null {
    if (heldOf(snap, WT_ITEM.COINS.id) >= want) {
        return null;
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: WT_TILE.YANILLE_BANK };
    }
    const available = bankedOf(snap, WT_ITEM.COINS.id);
    if (available <= 0) {
        return { kind: 'wait', reason: `need ${want} gp for Gu'Tanoth tolls and shops` };
    }
    return {
        kind: 'withdraw',
        items: [{ name: WT_ITEM.COINS.name, id: WT_ITEM.COINS.id, qty: Math.min(want, available) }],
        bank: WT_TILE.YANILLE_BANK
    };
}
```

- [ ] **Step 6: Run tests**

Run: `bun test test/quests/defs/watchtower.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 7: Live-verify stage 4 → 6**

```bash
bun tools/watchtower-solo-test.ts --stage 4 --give coins:5000 --minutes 30
```

Expected: rock cake stolen at (2506,3023), battlement climbed at (2507,3011), chasm jumped for
20 gp, riddle asked (stage 5), death rune bought at the Magic Guild, riddle answered, `Skavid map`
in the pack at stage 6. **If `Jump-From` cannot be clicked from level 0**, record it and switch
`jumpChasm` to talk to `ogre_guard4` first — the guard's dialogue calls `p_oploc` for the player.

- [ ] **Step 8: Commit**

```bash
git add src/bot/quests/defs/watchtower/gutanoth.ts src/bot/quests/defs/watchtower/supplies.ts src/bot/quests/defs/watchtower/index.ts test/quests/defs/watchtower.test.ts
git commit -m "feat(watchtower): rock cake, battlement, chasm toll, and the guard's riddle"
```

---

### Task 13: The skavid caves and the language

**Files:**
- Create: `src/bot/quests/defs/watchtower/caves.ts`
- Modify: `src/bot/quests/defs/watchtower/index.ts`
- Modify: `test/quests/defs/watchtower.test.ts`

**Interfaces:**
- Consumes: `WT_CAVES`, `WT_NIGHTSHADE`, `pickByLine`/`talkChoosingBy` from Task 2.
- Produces: `SKAVID_REPLIES: Record<number, string>`, `MAD_SKAVID_RULES: readonly LineRule[]`,
  `enterCave(index, log)`, `leaveCave(log)`, `learnFromScaredSkavid(log)`,
  `learnWord(index, log)`, `answerMadSkavid(log)`, `takeNightshade(log)`,
  `nextSkavidCave(progress): number | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { MAD_SKAVID_RULES, SKAVID_REPLIES, nextSkavidCave } from '#/bot/quests/defs/watchtower/caves.js';
import { pickByLine } from '#/bot/quests/exec/primitives.js';

describe('skavid language', () => {
    test('each talker cave has its own reply', () => {
        expect(SKAVID_REPLIES[1]).toBe('Nod.');
        expect(SKAVID_REPLIES[2]).toBe('Ig.');
        expect(SKAVID_REPLIES[3]).toBe('Ar.');
        expect(SKAVID_REPLIES[4]).toBe('Cur.');
    });

    test('the mad skavid rules cover all four phrases', () => {
        const opts = ['Cur.', 'Ar.', 'Bidith.', 'Tanath.', 'Gor.'];
        expect(pickByLine(['Ar cur...'], opts, MAD_SKAVID_RULES)).toBe('Gor.');
        expect(pickByLine(['Bidith ig...'], opts, MAD_SKAVID_RULES)).toBe('Cur.');
        expect(pickByLine(['Cur tanath...'], opts, MAD_SKAVID_RULES)).toBe('Bidith.');
        expect(pickByLine(['Gor nod...'], opts, MAD_SKAVID_RULES)).toBe('Tanath.');
    });

    test('cave 5 comes first because it teaches the words', () => {
        expect(nextSkavidCave(P(6, 'has-map'))).toBe(5);
    });

    test('after learning, it visits the talker caves in turn and skips known words', () => {
        expect(nextSkavidCave(P(6, 'has-map', 'learning-skavid'))).toBe(1);
        expect(nextSkavidCave(P(6, 'has-map', 'learning-skavid', 'learned-nod'))).toBe(2);
        expect(nextSkavidCave(P(6, 'has-map', 'learning-skavid', 'learned-nod', 'learned-ig', 'learned-ar'))).toBe(4);
    });

    test('with every word known it goes to the mad skavid in cave 6', () => {
        const all = P(6, 'has-map', 'learning-skavid', 'learned-nod', 'learned-ig', 'learned-ar', 'learned-cur');
        expect(nextSkavidCave(all)).toBe(6);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL — `caves.js` not found.

- [ ] **Step 3: Write `caves.ts`**

```ts
// src/bot/quests/defs/watchtower/caves.ts
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { GroundItems } from '../../../api/queries/GroundItems.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Traversal } from '../../../api/Traversal.js';
import { talkChoosingBy, talkThrough, type LineRule } from '../../exec/primitives.js';
import { hasFlag, type QuestProgress } from '../../engine/types.js';
import { WT_CAVES, WT_ITEM, WT_LOC, WT_NIGHTSHADE, WT_NPC, watchtowerArea } from './areas.js';

/** Cave index → the word that skavid understands. */
export const SKAVID_REPLIES: Readonly<Record<number, string>> = {
    1: 'Nod.',
    2: 'Ig.',
    3: 'Ar.',
    4: 'Cur.'
};

const WORD_FLAG: Readonly<Record<number, string>> = {
    1: 'learned-nod',
    2: 'learned-ig',
    3: 'learned-ar',
    4: 'learned-cur'
};

export const MAD_SKAVID_RULES: readonly LineRule[] = [
    { whenLine: 'ar cur', choose: 'Gor.' },
    { whenLine: 'bidith ig', choose: 'Cur.' },
    { whenLine: 'cur tanath', choose: 'Bidith.' },
    { whenLine: 'gor nod', choose: 'Tanath.' }
];

export function nextSkavidCave(progress: QuestProgress | undefined): number | null {
    if (!hasFlag(progress, 'learning-skavid')) {
        return 5;
    }
    for (const index of [1, 2, 3, 4]) {
        if (!hasFlag(progress, WORD_FLAG[index])) {
            return index;
        }
    }
    return 6;
}

function heldId(id: number): number {
    return Inventory.items().filter(i => i.id === id).reduce((sum, i) => sum + i.count, 0);
}

export async function enterCave(index: number, log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) === 'skavidCaves') {
        return true;
    }
    const cave = WT_CAVES.find(c => c.index === index)!;
    if (!(await Traversal.walkResilient(cave.mouth, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const mouth = Locs.query().where(l => l.id === WT_LOC.CAVE_IN[index - 1]).action('Enter').within(8).nearest();
    if (!mouth || !(await mouth.interact('Enter'))) {
        log(`no cave ${index} entrance in range`);
        return false;
    }
    if (!(await Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'skavidCaves', 12_000))) {
        return false;
    }
    const here = Game.tile();
    if (here && cave.landing.distanceTo(here) > 12) {
        log('landed in the dark cave — the map or the lit light source is missing');
        return false;
    }
    return true;
}

export async function leaveCave(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) !== 'skavidCaves') {
        return true;
    }
    const exit = Locs.query().where(l => WT_LOC.CAVE_OUT.includes(l.id)).action('Leave').within(20).nearest();
    if (!exit) {
        log('no cave exit in range');
        return false;
    }
    if (!(await exit.interact('Leave'))) {
        return false;
    }
    return Execution.delayUntil(() => watchtowerArea(Game.tile()) !== 'skavidCaves', 12_000);
}

export async function learnFromScaredSkavid(log: (m: string) => void): Promise<boolean> {
    if (!(await enterCave(5, log))) {
        return false;
    }
    const cave = WT_CAVES.find(c => c.index === 5)!;
    if (!(await Traversal.walkResilient(cave.landing, { radius: 8, attempts: 2, timeoutMs: 45_000, log }))) {
        return false;
    }
    if (!(await talkThrough(WT_NPC.SCARED_SKAVID, ["Okay, okay, I'm not going to hurt you."], log))) {
        return false;
    }
    return leaveCave(log);
}

export async function learnWord(index: number, log: (m: string) => void): Promise<boolean> {
    if (!(await enterCave(index, log))) {
        return false;
    }
    const cave = WT_CAVES.find(c => c.index === index)!;
    if (!(await Traversal.walkResilient(cave.landing, { radius: 8, attempts: 2, timeoutMs: 45_000, log }))) {
        return false;
    }
    if (!(await talkThrough(WT_NPC.SCARED_SKAVID, [SKAVID_REPLIES[index]], log))) {
        return false;
    }
    return leaveCave(log);
}

export async function takeNightshade(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.NIGHTSHADE.id) > 0) {
        return true;
    }
    if (!(await enterCave(2, log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(WT_NIGHTSHADE.cave2, { radius: 1, attempts: 3, timeoutMs: 45_000, log }))) {
        return false;
    }
    const plant = GroundItems.query().name(WT_ITEM.NIGHTSHADE.name).within(4).nearest();
    if (!plant || !(await plant.take())) {
        log('no Nightshade on the cave floor — it respawns, so retry');
        return false;
    }
    if (!(await Execution.delayUntil(() => heldId(WT_ITEM.NIGHTSHADE.id) > 0, 6000))) {
        return false;
    }
    return leaveCave(log);
}

export async function answerMadSkavid(log: (m: string) => void): Promise<boolean> {
    if (!(await enterCave(6, log))) {
        return false;
    }
    const cave = WT_CAVES.find(c => c.index === 6)!;
    if (!(await Traversal.walkResilient(cave.landing, { radius: 4, attempts: 2, timeoutMs: 45_000, log }))) {
        return false;
    }
    for (let attempt = 0; attempt < 4; attempt++) {
        if (await talkChoosingBy(WT_NPC.MAD_SKAVID, MAD_SKAVID_RULES, ['But I\'ve lost it!'], log)) {
            if (heldId(WT_ITEM.CRYSTAL2.id) > 0) {
                return leaveCave(log);
            }
        }
        await Execution.delayTicks(2);
    }
    log('the mad skavid did not hand over a crystal in four attempts');
    return false;
}
```

`WT_NPC.SCARED_SKAVID` and `WT_NPC.MAD_SKAVID` are both `'Skavid'`; each cave holds exactly one,
so a name query cannot pick the wrong one.

- [ ] **Step 4: Add the light source to `supplies.ts`**

```ts
export function sourceLightSource(snap: QuestSnapshot): QuestStep | null {
    if (heldOf(snap, WT_ITEM.LIT_CANDLE.id) > 0) {
        return null;
    }
    if (bankedOf(snap, WT_ITEM.LIT_CANDLE.id) > 0) {
        return {
            kind: 'withdraw',
            items: [{ name: WT_ITEM.LIT_CANDLE.name, id: WT_ITEM.LIT_CANDLE.id, qty: 1 }],
            bank: WT_TILE.YANILLE_BANK
        };
    }
    return {
        kind: 'grabGround',
        item: WT_ITEM.LIT_CANDLE.name,
        anchor: WT_TILE.CANDLE,
        waitIfMissing: true
    };
}
```

- [ ] **Step 5: Wire stage 6 into `decide()`**

```ts
        case WATCHTOWER_STAGE.SOLVED_RIDDLE: {
            if (held(snap, WT_ITEM.SKAVID_MAP.id) === 0) {
                return { kind: 'custom', name: 'ask the city guard for another skavid map', run: askRiddle };
            }
            const light = sourceLightSource(snap);
            if (light) return light;
            const cave = nextSkavidCave(snap.progress);
            if (cave === 5) {
                return { kind: 'custom', name: 'learn skavid words from the scared skavid', run: learnFromScaredSkavid };
            }
            if (cave !== null && cave <= 4) {
                return { kind: 'custom', name: `answer the skavid in cave ${cave}`, run: log => learnWord(cave, log) };
            }
            return { kind: 'custom', name: 'answer the mad skavid for a crystal', run: answerMadSkavid };
        }
```

- [ ] **Step 6: Run tests**

Run: `bun test test/quests/defs/watchtower.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 7: Live-verify stage 6 → 7**

```bash
bun tools/watchtower-solo-test.ts --stage 6 --bits 4096 --give skavidmap:1,lit_candle:1,coins:5000 --minutes 45
```

`--bits 4096` presets `learning_skavid` so the four talker caves can be checked first; re-run
without it to exercise cave 5. Expected: each cave entered and left, the journal accumulating one
word per cave, then cave 6 (which needs the battlement route) yielding `powering_crystal2` at
stage 7. **Cave 6's mouth is inside the lower city** — if the bot cannot reach (2527,3012),
`decide()` must cross the battlement first; add that guard and re-run.

- [ ] **Step 8: Commit**

```bash
git add src/bot/quests/defs/watchtower/caves.ts src/bot/quests/defs/watchtower/supplies.ts src/bot/quests/defs/watchtower/index.ts test/quests/defs/watchtower.test.ts
git commit -m "feat(watchtower): the six skavid caves, the language, and the mad skavid's crystal"
```

---

### Task 14: Nightshade into the enclave, and the wizard's advice

**Files:**
- Create: `src/bot/quests/defs/watchtower/enclave.ts`
- Modify: `src/bot/quests/defs/watchtower/index.ts`
- Modify: `test/quests/defs/watchtower.test.ts`

**Interfaces:**
- Consumes: `takeNightshade` from Task 13, `climbToWizard`/`talkToWizard` from Task 7.
- Produces: `enterEnclave(log)`, `leaveEnclave(log)`, `askWizardAboutShamans(log)`.

- [ ] **Step 1: Write the failing test**

```ts
describe('watchtower decide — the enclave', () => {
    test('stage 7 without nightshade fetches it', () => {
        const step = decide(snapshot({ stage: 7, progress: P(7) }));
        expect(step.kind === 'custom' && step.name).toMatch(/nightshade/i);
    });

    test('stage 7 with nightshade feeds the enclave guard', () => {
        const step = decide(snapshot({ stage: 7, progress: P(7), invIds: new Map([[2398, 1]]) }));
        expect(step.kind === 'custom' && step.name).toMatch(/guard|enclave/i);
    });

    test('stage 8 inside the enclave leaves before talking to the wizard', () => {
        const step = decide(snapshot({
            stage: 8,
            progress: P(8),
            tile: { x: 2588, z: 9410, level: 0 }
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/leave|out/i);
    });

    test('stage 8 outside goes to the wizard for the recipe', () => {
        const step = decide(snapshot({ stage: 8, progress: P(8) }));
        expect(step.kind === 'custom' && step.name).toMatch(/wizard/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `enclave.ts`**

```ts
// src/bot/quests/defs/watchtower/enclave.ts
import { Execution } from '../../../api/Execution.js';
import { Game } from '../../../api/Game.js';
import { Inventory } from '../../../api/hud/Inventory.js';
import { Locs } from '../../../api/queries/Locs.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { Traversal } from '../../../api/Traversal.js';
import { talkThrough } from '../../exec/primitives.js';
import { WT_ITEM, WT_LOC, WT_NPC, WT_TILE, watchtowerArea } from './areas.js';

function heldId(id: number): number {
    return Inventory.items().filter(i => i.id === id).reduce((sum, i) => sum + i.count, 0);
}

export async function enterEnclave(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) === 'enclave') {
        return true;
    }
    if (heldId(WT_ITEM.NIGHTSHADE.id) === 0) {
        log('no Nightshade — the enclave guard cannot be distracted');
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.ENCLAVE_GUARD, { radius: 2, attempts: 3, timeoutMs: 300_000, log }))) {
        return false;
    }
    const guard = Npcs.query().name(WT_NPC.ENCLAVE_GUARD).nearest();
    const shade = Inventory.items().find(i => i.id === WT_ITEM.NIGHTSHADE.id);
    if (!guard || !shade || !(await shade.useOn(guard))) {
        return false;
    }
    await talkThrough(WT_NPC.ENCLAVE_GUARD, [], log);
    return Execution.delayUntil(() => watchtowerArea(Game.tile()) === 'enclave', 15_000);
}

export async function leaveEnclave(log: (m: string) => void): Promise<boolean> {
    if (watchtowerArea(Game.tile()) !== 'enclave') {
        return true;
    }
    if (!(await Traversal.walkResilient(WT_TILE.ENCLAVE_EXIT, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const cave = Locs.query().where(l => l.id === WT_LOC.ENCLAVE_CAVE).action('Enter').within(8).nearest();
    if (!cave || !(await cave.interact('Enter'))) {
        log('no enclave exit cave in range');
        return false;
    }
    return Execution.delayUntil(() => watchtowerArea(Game.tile()) !== 'enclave', 15_000);
}
```

- [ ] **Step 4: Add the wizard leg to `tower.ts`**

```ts
export async function askWizardAboutShamans(log: (m: string) => void): Promise<boolean> {
    if (!(await climbToWizard(WATCHTOWER_STAGE.FED_NIGHTSHADE, log))) {
        return false;
    }
    return talkToWizard([], log);
}
```

- [ ] **Step 5: Wire stages 7 and 8 into `decide()`**

```ts
        case WATCHTOWER_STAGE.SKAVID_CRYSTAL: {
            if (area === 'enclave') {
                return { kind: 'custom', name: 'leave the shaman enclave', run: leaveEnclave };
            }
            if (held(snap, WT_ITEM.NIGHTSHADE.id) === 0) {
                const light = sourceLightSource(snap);
                if (light) return light;
                return { kind: 'custom', name: 'take Nightshade from the skavid cave', run: takeNightshade };
            }
            return { kind: 'custom', name: 'feed the enclave guard Nightshade', run: enterEnclave };
        }
        case WATCHTOWER_STAGE.FED_NIGHTSHADE: {
            if (area === 'enclave') {
                return { kind: 'custom', name: 'leave the shaman enclave', run: leaveEnclave };
            }
            return { kind: 'custom', name: 'ask the wizard how to beat the shamans', run: askWizardAboutShamans };
        }
```

- [ ] **Step 6: Run tests**

Run: `bun test test/quests/defs/watchtower.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 7: Live-verify stage 7 → 9**

```bash
bun tools/watchtower-solo-test.ts --stage 7 --give skavidmap:1,lit_candle:1,coins:5000 --minutes 30
```

Expected: nightshade taken from cave 2, used on the guard at (2507,3036), arrival at (2588,9410)
(stage 8), exit via (2598,9468) landing at (2540,3054), and the wizard conversation reaching
stage 9.

- [ ] **Step 8: Commit**

```bash
git add src/bot/quests/defs/watchtower/enclave.ts src/bot/quests/defs/watchtower/tower.ts src/bot/quests/defs/watchtower/index.ts test/quests/defs/watchtower.test.ts
git commit -m "feat(watchtower): nightshade into the shaman enclave and the wizard's potion advice"
```

---

### Task 15: Brew the ogre potion

Order is load-bearing: any other pairing calls `~potion_explosion`, destroys both items and deals
5 damage.

**Files:**
- Modify: `src/bot/quests/defs/watchtower/supplies.ts`
- Create: `src/bot/quests/defs/watchtower/potion.ts`
- Modify: `src/bot/quests/defs/watchtower/index.ts`
- Modify: `test/quests/defs/watchtower.test.ts`

**Interfaces:**
- Consumes: `source`, `heldOf`, `bankedOf` from `supplies.ts`.
- Produces: `brewOgrePotion(log): Promise<boolean>`, `infusePotion(log): Promise<boolean>`,
  `potionIngredients(snap): QuestStep | null`.

- [ ] **Step 1: Write the failing test**

```ts
describe('watchtower decide — the potion', () => {
    const ready = new Map([[227, 1], [249, 1], [247, 1], [2391, 1]]);

    test('stage 9 with every ingredient brews', () => {
        const step = decide(snapshot({ stage: 9, progress: P(9), invIds: ready }));
        expect(step.kind === 'custom' && step.name).toMatch(/brew|potion/i);
    });

    test('a missing bank-only ingredient parks with a reason naming it', () => {
        const step = decide(snapshot({
            stage: 9,
            progress: P(9),
            invIds: new Map([[227, 1], [247, 1], [2391, 1]]),
            bankKnown: true
        }));
        expect(step.kind).toBe('wait');
        expect(step.kind === 'wait' && step.reason).toMatch(/guam/i);
    });

    test('bat bones in the pack are ground before brewing', () => {
        const step = decide(snapshot({
            stage: 9,
            progress: P(9),
            invIds: new Map([[227, 1], [249, 1], [247, 1], [530, 1], [233, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/grind/i);
    });

    test('holding a finished ogre potion, it goes to the wizard to infuse it', () => {
        const step = decide(snapshot({ stage: 9, progress: P(9), invIds: new Map([[2394, 1]]) }));
        expect(step.kind === 'custom' && step.name).toMatch(/wizard|infuse/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `potion.ts`**

```ts
// src/bot/quests/defs/watchtower/potion.ts
import { Execution } from '../../../api/Execution.js';
import { Inventory, type InvItem } from '../../../api/hud/Inventory.js';
import { Npcs } from '../../../api/queries/Npcs.js';
import { driveDialog } from '../../exec/primitives.js';
import { WT_ITEM, WT_NPC, WT_TILE } from './areas.js';
import { WATCHTOWER_STAGE } from './journal.js';
import { climbToWizard } from './tower.js';

function item(id: number): InvItem | null {
    return Inventory.items().find(i => i.id === id) ?? null;
}

function heldId(id: number): number {
    return Inventory.items().filter(i => i.id === id).reduce((sum, i) => sum + i.count, 0);
}

async function combine(useId: number, ontoId: number, producesId: number, log: (m: string) => void): Promise<boolean> {
    const a = item(useId);
    const b = item(ontoId);
    if (!a || !b) {
        log(`cannot combine ${useId} with ${ontoId} — one is missing`);
        return false;
    }
    if (!(await a.useOn(b))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(producesId) > 0, 8000);
}

export async function grindBatBones(log: (m: string) => void): Promise<boolean> {
    return combine(WT_ITEM.PESTLE.id, WT_ITEM.BAT_BONES.id, WT_ITEM.GROUND_BAT_BONES.id, log);
}

export async function brewOgrePotion(log: (m: string) => void): Promise<boolean> {
    // guam -> jangerberries -> ground bat bones. Any other order explodes the vial.
    if (heldId(WT_ITEM.GUAM_VIAL.id) === 0 && heldId(WT_ITEM.GUAM_JANGER_VIAL.id) === 0) {
        if (!(await combine(WT_ITEM.GUAM_LEAF.id, WT_ITEM.VIAL_WATER.id, WT_ITEM.GUAM_VIAL.id, log))) {
            return false;
        }
    }
    if (heldId(WT_ITEM.GUAM_JANGER_VIAL.id) === 0) {
        if (!(await combine(WT_ITEM.JANGERBERRIES.id, WT_ITEM.GUAM_VIAL.id, WT_ITEM.GUAM_JANGER_VIAL.id, log))) {
            return false;
        }
    }
    return combine(WT_ITEM.GROUND_BAT_BONES.id, WT_ITEM.GUAM_JANGER_VIAL.id, WT_ITEM.OGRE_POTION.id, log);
}

export async function infusePotion(log: (m: string) => void): Promise<boolean> {
    if (!(await climbToWizard(WATCHTOWER_STAGE.LEARNED_POTION, log))) {
        return false;
    }
    const potion = item(WT_ITEM.OGRE_POTION.id);
    const wizard = Npcs.query().name(WT_NPC.WIZARD).nearest();
    if (!potion || !wizard || !(await potion.useOn(wizard))) {
        return false;
    }
    if (!(await driveDialog([], log))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(WT_ITEM.MAGIC_OGRE_POTION.id) > 0, 15_000);
}
```

`WT_TILE` is not imported here — `climbToWizard` owns every tile this file needs.

- [ ] **Step 4: Add ingredient sourcing to `supplies.ts`**

```ts
import Tile from '../../../api/Tile.js';

export const ARDOUGNE_HERBLORE = { npc: 'Shop keeper', anchor: new Tile(2666, 3304, 0) };
export const OGRE_HERBLORE = { npc: 'Grud', anchor: new Tile(2510, 3032, 0) };

const BANK_ONLY = [WT_ITEM.GUAM_LEAF, WT_ITEM.BAT_BONES, WT_ITEM.DRAGON_BONES];

export function potionIngredients(snap: QuestSnapshot): QuestStep | null {
    if (heldOf(snap, WT_ITEM.OGRE_POTION.id) > 0 || heldOf(snap, WT_ITEM.MAGIC_OGRE_POTION.id) > 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: WT_TILE.YANILLE_BANK };
    }

    const midway = heldOf(snap, WT_ITEM.GUAM_VIAL.id) > 0 || heldOf(snap, WT_ITEM.GUAM_JANGER_VIAL.id) > 0;
    if (!midway) {
        const guam = bankOnly(snap, WT_ITEM.GUAM_LEAF);
        if (guam) return guam;
        const vial = source(snap, WT_ITEM.VIAL_WATER, 1, ARDOUGNE_HERBLORE, 40);
        if (vial) return vial;
    }
    if (heldOf(snap, WT_ITEM.GUAM_JANGER_VIAL.id) === 0 && heldOf(snap, WT_ITEM.JANGERBERRIES.id) === 0) {
        return { kind: 'wait', reason: 'no Jangerberries — pick them on Grew island' };
    }
    if (heldOf(snap, WT_ITEM.GROUND_BAT_BONES.id) === 0) {
        const bones = bankOnly(snap, WT_ITEM.BAT_BONES);
        if (bones) return bones;
        const pestle = source(snap, WT_ITEM.PESTLE, 1, OGRE_HERBLORE, 150);
        if (pestle) return pestle;
    }
    return null;
}

function bankOnly(snap: QuestSnapshot, item: { id: number; name: string }): QuestStep | null {
    if (heldOf(snap, item.id) > 0) {
        return null;
    }
    if (bankedOf(snap, item.id) > 0) {
        return {
            kind: 'withdraw',
            items: [{ name: item.name, id: item.id, qty: 1 }],
            bank: WT_TILE.YANILLE_BANK
        };
    }
    return { kind: 'wait', reason: `no ${item.name} in the bank — it is a drop-only item` };
}

export { BANK_ONLY };
```

- [ ] **Step 5: Wire stage 9 into `decide()`**

```ts
        case WATCHTOWER_STAGE.LEARNED_POTION: {
            if (held(snap, WT_ITEM.OGRE_POTION.id) > 0) {
                return { kind: 'custom', name: 'have the wizard infuse the ogre potion', run: infusePotion };
            }
            const ingredients = potionIngredients(snap);
            if (ingredients) return ingredients;
            if (held(snap, WT_ITEM.GROUND_BAT_BONES.id) === 0 && held(snap, WT_ITEM.BAT_BONES.id) > 0) {
                return { kind: 'custom', name: 'grind the bat bones', run: grindBatBones };
            }
            return { kind: 'custom', name: 'brew the ogre potion', run: brewOgrePotion };
        }
```

- [ ] **Step 6: Run tests**

Run: `bun test test/quests/defs/watchtower.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 7: Live-verify stage 9 → 10**

```bash
bun tools/watchtower-solo-test.ts --stage 9 --give guam_leaf:1,jangerberries:2,bat_bones:1,vial_water:1,pestle_and_mortar:1,coins:5000 --minutes 20
```

Expected: guam into the vial, jangerberries into that, bones ground and mixed, `Ogre potion`
produced with **no explosion message and no damage**, then infused by the wizard into
`Magic ogre potion` at stage 10.

- [ ] **Step 8: Commit**

```bash
git add src/bot/quests/defs/watchtower/potion.ts src/bot/quests/defs/watchtower/supplies.ts src/bot/quests/defs/watchtower/index.ts test/quests/defs/watchtower.test.ts
git commit -m "feat(watchtower): brew the ogre potion in the only order that does not explode"
```

---

### Task 16: The six shamans and the Rock of Dalgroth

**Files:**
- Modify: `src/bot/quests/defs/watchtower/enclave.ts`
- Modify: `src/bot/quests/defs/watchtower/index.ts`
- Modify: `test/quests/defs/watchtower.test.ts`

**Interfaces:**
- Consumes: `enterEnclave`, `leaveEnclave`, `flagValue`.
- Produces: `dissolveShamans(log): Promise<boolean>`, `mineDalgroth(log): Promise<boolean>`,
  `searchShamanRobe(log): Promise<boolean>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('watchtower decide — the shamans', () => {
    test('stage 10 with shamans left goes to dissolve them', () => {
        const step = decide(snapshot({
            stage: 10,
            progress: P(10, 'shamans-left:6'),
            invIds: new Map([[2395, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/shaman/i);
    });

    test('with all shamans dead and no crystal 4, it mines the rock', () => {
        const step = decide(snapshot({
            stage: 10,
            progress: P(10, 'shamans-left:0'),
            invIds: new Map([[2382, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/rock|mine/i);
    });

    test('a lost magic potion is re-brewed rather than parked, when ingredients exist', () => {
        const step = decide(snapshot({
            stage: 10,
            progress: P(10, 'shamans-left:3'),
            invIds: new Map(),
            bankIds: new Map([[249, 1], [530, 1]]),
            bankKnown: true
        }));
        expect(step.kind).not.toBe('wait');
    });

    test('all four crystals held moves on to the wizard', () => {
        const step = decide(snapshot({
            stage: 10,
            progress: P(10, 'shamans-left:0'),
            invIds: new Map([[2380, 1], [2381, 1], [2382, 1], [2383, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/wizard|crystal/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the shaman legs to `enclave.ts`**

```ts
import { GroundItems } from '../../../api/queries/GroundItems.js';
import { Skills } from '../../../api/hud/Skills.js';
import { Sustain } from '../../../api/Sustain.js';

export async function dissolveShamans(log: (m: string) => void): Promise<boolean> {
    if (!(await enterEnclave(log))) {
        return false;
    }
    for (const spot of WT_TILE.SHAMANS) {
        if (heldId(WT_ITEM.MAGIC_OGRE_POTION.id) === 0) {
            log('the magic ogre potion is gone — leaving to re-brew');
            return leaveEnclave(log);
        }
        if (Skills.effective('hitpoints') < Skills.level('hitpoints') / 2) {
            await Sustain.run();
        }
        if (!(await Traversal.walkResilient(spot, { radius: 2, attempts: 2, timeoutMs: 60_000, log }))) {
            continue;
        }
        // Never talk to or attack a shaman: opnpc1 is 20 damage and attacking is 30.
        const shaman = Npcs.query().name(WT_NPC.SHAMAN).where(n => n.distance() <= 4).nearest();
        const potion = Inventory.items().find(i => i.id === WT_ITEM.MAGIC_OGRE_POTION.id);
        if (!shaman || !potion) {
            continue;
        }
        if (await potion.useOn(shaman)) {
            await Execution.delayTicks(3);
        }
    }
    return true;
}

export async function mineDalgroth(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.CRYSTAL4.id) > 0) {
        return true;
    }
    if (!(await enterEnclave(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.ROCK_OF_DALGROTH, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const rock = Locs.query().where(l => l.id === WT_LOC.ROCK_OF_DALGROTH).action('Mine').within(8).nearest();
    if (!rock || !(await rock.interact('Mine'))) {
        log('no Rock of Dalgroth in range, or no pickaxe');
        return false;
    }
    return Execution.delayUntil(() => heldId(WT_ITEM.CRYSTAL4.id) > 0, 20_000);
}

export async function searchShamanRobe(log: (m: string) => void): Promise<boolean> {
    if (heldId(WT_ITEM.CRYSTAL3.id) > 0) {
        return true;
    }
    if (!(await enterEnclave(log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.SHAMAN_ROBE, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const robe = GroundItems.query().name(WT_ITEM.SHAMAN_ROBE.name).within(4).nearest();
    if (!robe || !(await robe.take())) {
        return false;
    }
    if (!(await Execution.delayUntil(() => heldId(WT_ITEM.SHAMAN_ROBE.id) > 0, 6000))) {
        return false;
    }
    const held = Inventory.items().find(i => i.id === WT_ITEM.SHAMAN_ROBE.id);
    if (!held || !(await held.interact('Search'))) {
        return false;
    }
    return Execution.delayUntil(() => heldId(WT_ITEM.CRYSTAL3.id) > 0, 8000);
}
```

- [ ] **Step 4: Wire stage 10 into `decide()`**

```ts
        case WATCHTOWER_STAGE.MADE_POTION: {
            const left = flagValue(snap.progress, 'shamans-left') ?? 6;
            const crystals = [WT_ITEM.CRYSTAL1, WT_ITEM.CRYSTAL2, WT_ITEM.CRYSTAL3, WT_ITEM.CRYSTAL4];
            const missing = crystals.filter(c => held(snap, c.id) === 0);

            if (left > 0) {
                if (held(snap, WT_ITEM.MAGIC_OGRE_POTION.id) === 0) {
                    if (area === 'enclave') {
                        return { kind: 'custom', name: 'leave the enclave to re-brew the potion', run: leaveEnclave };
                    }
                    if (held(snap, WT_ITEM.OGRE_POTION.id) > 0) {
                        return { kind: 'custom', name: 'have the wizard infuse the ogre potion', run: infusePotion };
                    }
                    const ingredients = potionIngredients(snap);
                    if (ingredients) return ingredients;
                    if (held(snap, WT_ITEM.GROUND_BAT_BONES.id) === 0 && held(snap, WT_ITEM.BAT_BONES.id) > 0) {
                        return { kind: 'custom', name: 'grind the bat bones', run: grindBatBones };
                    }
                    return { kind: 'custom', name: 'brew a replacement ogre potion', run: brewOgrePotion };
                }
                const shade = held(snap, WT_ITEM.NIGHTSHADE.id) === 0 && area !== 'enclave'
                    ? { kind: 'custom' as const, name: 'take Nightshade for the enclave', run: takeNightshade }
                    : null;
                return shade ?? { kind: 'custom', name: 'dissolve the ogre shamans', run: dissolveShamans };
            }

            if (missing.includes(WT_ITEM.CRYSTAL4)) {
                return { kind: 'custom', name: 'mine the Rock of Dalgroth', run: mineDalgroth };
            }
            if (missing.includes(WT_ITEM.CRYSTAL3)) {
                return { kind: 'custom', name: 'search a shaman robe for the third crystal', run: searchShamanRobe };
            }
            if (area === 'enclave') {
                return { kind: 'custom', name: 'leave the shaman enclave', run: leaveEnclave };
            }
            const recovery = recoverCrystals(snap);
            if (recovery) return recovery;
            return { kind: 'custom', name: 'take all four crystals to the wizard', run: showCrystalsToWizard };
        }
```

`recoverCrystals` and `showCrystalsToWizard` arrive in Task 17 — until then, stub them in
`index.ts` as:

```ts
function recoverCrystals(_snap: QuestSnapshot): QuestStep | null { return null; }
function showCrystalsToWizard(): Promise<boolean> { return Promise.resolve(false); }
```

and delete the stubs in Task 17.

- [ ] **Step 5: Run tests**

Run: `bun test test/quests/defs/watchtower.test.ts && bun run lint`
Expected: PASS.

- [ ] **Step 6: Live-verify stage 10 crystals**

```bash
bun tools/watchtower-solo-test.ts --stage 10 --give magic_ogre_potion:1,nightshade:2,bronze_pickaxe:1,coins:5000 --minutes 40
```

Expected: six shamans dissolved one at a time with **no combat and no 20/30 damage messages**, the
sixth yielding `powering_crystal3`, then the rock mined for `powering_crystal4`. Watch that the
potion is only consumed on the sixth kill.

- [ ] **Step 7: Commit**

```bash
git add src/bot/quests/defs/watchtower/enclave.ts src/bot/quests/defs/watchtower/index.ts test/quests/defs/watchtower.test.ts
git commit -m "feat(watchtower): dissolve the six shamans and mine the Rock of Dalgroth"
```

---

### Task 17: Crystal recovery, the lever, and the reward scroll

**Files:**
- Modify: `src/bot/quests/defs/watchtower/tower.ts`
- Modify: `src/bot/quests/defs/watchtower/index.ts`
- Modify: `test/quests/defs/watchtower.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `showCrystalsToWizard(log)`, `pullLever(log)`, `readSpellScroll(log)`,
  `recoverCrystals(snap): QuestStep | null`.

- [ ] **Step 1: Write the failing test**

```ts
describe('watchtower decide — finishing', () => {
    test('a crystal sitting in the bank is withdrawn, because its re-issue checks the bank', () => {
        const step = decide(snapshot({
            stage: 10,
            progress: P(10, 'shamans-left:0'),
            invIds: new Map([[2380, 1], [2382, 1], [2383, 1]]),
            bankIds: new Map([[2381, 1]]),
            bankKnown: true
        }));
        expect(step.kind).toBe('withdraw');
    });

    test('a lost crystal 2 is re-asked from the mad skavid, not parked', () => {
        const step = decide(snapshot({
            stage: 10,
            progress: P(10, 'shamans-left:0'),
            invIds: new Map([[2380, 1], [2382, 1], [2383, 1]]),
            bankIds: new Map(),
            bankKnown: true
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/skavid/i);
    });

    test('stage 11 pulls the lever', () => {
        const step = decide(snapshot({ stage: 11, progress: P(11) }));
        expect(step.kind === 'custom' && step.name).toMatch(/lever/i);
    });

    test('a complete quest still holding the scroll reads it', () => {
        const step = decide(snapshot({
            journal: 'complete',
            stage: 13,
            progress: P(13),
            invIds: new Map([[2396, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toMatch(/scroll/i);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the finishing legs to `tower.ts`**

```ts
export async function showCrystalsToWizard(log: (m: string) => void): Promise<boolean> {
    if (!(await climbToWizard(WATCHTOWER_STAGE.MADE_POTION, log))) {
        return false;
    }
    const crystal = Inventory.items().find(i => i.id === WT_ITEM.CRYSTAL1.id);
    const wizard = Npcs.query().name(WT_NPC.WIZARD).nearest();
    if (!crystal || !wizard || !(await crystal.useOn(wizard))) {
        return false;
    }
    return driveDialog(['This is the last one.'], log);
}

export async function pullLever(log: (m: string) => void): Promise<boolean> {
    if (!(await climbToWizard(WATCHTOWER_STAGE.FOUND_ALL_CRYSTALS, log))) {
        return false;
    }
    if (!(await Traversal.walkResilient(WT_TILE.LEVER_STAND, { radius: 1, attempts: 3, timeoutMs: 60_000, log }))) {
        return false;
    }
    const lever = Locs.query().where(l => l.id === WT_LOC.LEVER).action('Pull').within(6).nearest();
    if (!lever || !(await lever.interact('Pull'))) {
        log('no Watchtower lever in range');
        return false;
    }
    return Execution.delayUntil(() => Quests.status('Watch Tower') === 'complete', 40_000);
}

export async function readSpellScroll(log: (m: string) => void): Promise<boolean> {
    const scroll = Inventory.items().find(i => i.id === WT_ITEM.WATCHTOWER_SPELL.id);
    if (!scroll) {
        return true;
    }
    if (!(await scroll.interact('Read'))) {
        return false;
    }
    await Execution.delayTicks(2);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    log('memorised the Watchtower Teleport scroll');
    return true;
}
```

Import `Quests` from `../../../api/hud/Quests.js` and `actions, reader` from
`../../../adapter/ClientAdapter.js`.

- [ ] **Step 4: Replace the Task 16 stubs in `index.ts`**

```ts
const CRYSTAL_RECOVERY: Readonly<Record<number, { name: string; run: (log: (m: string) => void) => Promise<boolean> }>> = {
    [WT_ITEM.CRYSTAL1.id]: { name: 'ask Grew for another crystal', run: talkToGrew },
    [WT_ITEM.CRYSTAL2.id]: { name: 'ask the mad skavid for another crystal', run: answerMadSkavid },
    [WT_ITEM.CRYSTAL3.id]: { name: 'search a shaman robe for the third crystal', run: searchShamanRobe },
    [WT_ITEM.CRYSTAL4.id]: { name: 'mine the Rock of Dalgroth again', run: mineDalgroth }
};

function recoverCrystals(snap: QuestSnapshot): QuestStep | null {
    const crystals = [WT_ITEM.CRYSTAL1, WT_ITEM.CRYSTAL2, WT_ITEM.CRYSTAL3, WT_ITEM.CRYSTAL4];
    // Every re-issue check reads the bank as well as the pack, so a banked crystal
    // blocks its own replacement. Withdraw before asking for another.
    const banked = crystals.filter(c => held(snap, c.id) === 0 && (snap.bankIds?.get(c.id) ?? 0) > 0);
    if (banked.length > 0) {
        return {
            kind: 'withdraw',
            items: banked.map(c => ({ name: c.name, id: c.id, qty: 1 })),
            bank: WT_TILE.YANILLE_BANK
        };
    }
    if (!snap.bankKnown) {
        return { kind: 'scanBank', bank: WT_TILE.YANILLE_BANK };
    }
    const lost = crystals.find(c => held(snap, c.id) === 0);
    if (!lost) {
        return null;
    }
    const recovery = CRYSTAL_RECOVERY[lost.id];
    return { kind: 'custom', name: recovery.name, run: recovery.run };
}
```

- [ ] **Step 5: Wire stage 11 and the post-complete scroll**

Replace the `done` guard at the top of `decide()` with:

```ts
    const complete = snap.journal === 'complete' || (snap.stage ?? -1) >= WATCHTOWER_STAGE.COMPLETE;
    if (complete) {
        if (held(snap, WT_ITEM.WATCHTOWER_SPELL.id) > 0) {
            return { kind: 'custom', name: 'read the Watchtower spell scroll', run: readSpellScroll };
        }
        if (watchtowerArea(snap.tile) === 'mirrorTower') {
            return { kind: 'custom', name: 'climb down from the activated Watchtower', run: leaveWizardFloor };
        }
        return { kind: 'done' };
    }
```

and add the stage-11 case:

```ts
        case WATCHTOWER_STAGE.FOUND_ALL_CRYSTALS:
            return { kind: 'custom', name: 'pull the lever to activate the shield', run: pullLever };
```

- [ ] **Step 6: Run tests**

Run: `bun test && bun run lint`
Expected: PASS across the whole suite.

- [ ] **Step 7: Live-verify stage 10 → complete**

```bash
bun tools/watchtower-solo-test.ts --stage 10 --bits 786432 --give powering_crystal1:1,powering_crystal2:1,powering_crystal3:1,powering_crystal4:1,coins:5000 --minutes 25
```

`--bits 786432` sets the shaman kill count to 6 (bits 17-19). Expected: crystals shown to the
wizard (stage 11), lever pulled, quest complete with +4 QP, the scroll read, and the bot climbing
out of the 45_73 mirror tower back to Yanille.

- [ ] **Step 8: Commit**

```bash
git add src/bot/quests/defs/watchtower/tower.ts src/bot/quests/defs/watchtower/index.ts test/quests/defs/watchtower.test.ts
git commit -m "feat(watchtower): return the crystals, pull the lever, read the reward scroll"
```

---

### Task 18: Recovery paths, the end-to-end run, and the docs

**Files:**
- Modify: `src/bot/quests/defs/watchtower/index.ts`
- Modify: `test/quests/defs/watchtower.test.ts`
- Modify: `docs/QUESTS.md`
- Delete: `tools/nav/wt-map.ts`, `tools/nav/wt-comp.ts` (or promote — see Step 5)

**Interfaces:**
- Consumes: everything.
- Produces: an escape branch for every pocket, reachable from every stage.

- [ ] **Step 1: Write the failing test**

```ts
describe('watchtower decide — escapes from every pocket', () => {
    const POCKETS: [string, { x: number; z: number; level: number }][] = [
        ['grewIsland', { x: 2513, z: 3084, level: 0 }],
        ['tobanCamp', { x: 2576, z: 3027, level: 0 }],
        ['cityGuard', { x: 2541, z: 3029, level: 0 }],
        ['skavidCaves', { x: 2504, z: 9441, level: 0 }],
        ['enclave', { x: 2588, z: 9410, level: 0 }],
        ['towerFloor', { x: 2544, z: 3112, level: 2 }]
    ];

    test('no stage ever returns wait purely because the bot is in a pocket', () => {
        for (const stage of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
            for (const [name, tile] of POCKETS) {
                const step = decide(snapshot({ stage, progress: P(stage), tile, bankKnown: true }));
                expect(`${stage}/${name}: ${step.kind}`).not.toMatch(/wait$/);
            }
        }
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/quests/defs/watchtower.test.ts`
Expected: FAIL for at least one stage/pocket pair.

- [ ] **Step 3: Add a shared escape helper and call it first in every stage**

In `index.ts`, above the switch:

```ts
function escapePocket(area: WatchtowerArea, wanted: WatchtowerArea): QuestStep | null {
    if (area === wanted) {
        return null;
    }
    switch (area) {
        case 'grewIsland':
            return { kind: 'custom', name: 'swing back off Grew island', run: leaveGrewIsland };
        case 'tobanCamp':
            return { kind: 'custom', name: "leave Toban's camp", run: leaveTobanCamp };
        case 'cityGuard':
            return { kind: 'custom', name: 'jump back out of the city-guard pocket', run: jumpBack };
        case 'skavidCaves':
            return { kind: 'custom', name: 'leave the skavid cave', run: leaveCave };
        case 'enclave':
            return { kind: 'custom', name: 'leave the shaman enclave', run: leaveEnclave };
        case 'towerFloor':
        case 'mirrorTower':
            return { kind: 'custom', name: 'climb down from the wizard floor', run: leaveWizardFloor };
        default:
            return null;
    }
}
```

Then in each `case` of the switch, before its own logic, add an escape guard naming the area that
stage actually wants — `'towerFloor'` for the wizard stages (0, 1 hand-in, 3 fallback, 8, 11),
`'enclave'` for the shaman work in stage 10, `'skavidCaves'` for stage 6, and `'yanille'` for
everything else. Example for stage 1:

```ts
        case WATCHTOWER_STAGE.STARTED: {
            if (held(snap, WT_ITEM.FINGERNAILS.id) > 0) {
                const escape = escapePocket(area, 'towerFloor');
                return escape ?? { kind: 'custom', name: 'give the fingernails to the wizard', run: handInFingernails };
            }
            const escape = escapePocket(area, 'yanille');
            return escape ?? {
                kind: 'pickLoc',
                loc: 'Bush',
                op: 'Search',
                item: WT_ITEM.FINGERNAILS.name,
                anchor: WT_TILE.BUSH_NAIL
            };
        }
```

Note `escapePocket(area, 'towerFloor')` returns null when already on the wizard floor and returns
a climb-down otherwise — which is correct, because `climbToWizard` inside each leg does the
climbing back up from Yanille.

- [ ] **Step 4: Run tests**

Run: `bun test && bun run lint`
Expected: PASS.

- [ ] **Step 5: Decide the fate of the nav probes**

`tools/nav/wt-map.ts` and `tools/nav/wt-comp.ts` were written to produce the spec's component
table. Either:
- **Promote**: rename `wt-comp.ts` to `tools/nav/components.ts`, give it a `--help`, and add a row
  to the tooling table in `docs/NAV.md#the-collision-pack`; delete `wt-map.ts`.
- **Delete both**: `git rm -f` them.

Promote if the component table proved useful more than once during Tasks 7-17; otherwise delete.
Do not leave them untracked.

- [ ] **Step 6: Document the quest**

In `docs/QUESTS.md`, under "Adding a quest", add Watch Tower as the worked example for the hardest
shape, after the existing Priest in Peril pointer:

```markdown
Start from [`defs/cooksassistant.ts`](../src/bot/quests/defs/cooksassistant.ts) for
the simple shape, [`defs/priestperil.ts`](../src/bot/quests/defs/priestperil.ts)
for one with level changes, gated doors, and a long item chain, or
[`defs/watchtower/`](../src/bot/quests/defs/watchtower/) for a quest large enough to
need a directory — nine sealed map pockets, each entered through a scripted crossing,
with journal sub-progress carried as flags on the snapshot.
```

And in the "Quest state" section, after the paragraph about held items, add:

```markdown
When the stage number alone cannot express where a quest is — which of three tribes
are satisfied, which words have been learned, how many monsters remain — a module can
implement `readProgress()` instead of `readStage()` and return named flags alongside
the stage. Those arrive on the snapshot as `snap.progress`, so `decide()` stays a pure
function. `hasFlag` and `flagValue` in [`engine/types.ts`](../src/bot/quests/engine/types.ts)
read them.
```

- [ ] **Step 7: The uncheated end-to-end run**

Seed only what the design says the bank holds, and let the bot do the rest:

```bash
bun tools/aio-quest-test.ts http://localhost:8888 wtfull itwatchtower 240 \
  "dragon_bones:1,guam_leaf:1,bat_bones:1,coins:2000000" \
  "magic:20,mining:45,herblore:20,thieving:20,agility:30,attack:60,strength:60,defence:60,hitpoints:60"
```

Before starting, send `::speed 300` in the client. Expected: `PASS` with the Watch Tower journal
complete and quest points up by 4. Record the wall-clock time in the PR description.

- [ ] **Step 8: Commit and open the PR**

```bash
git add -A src/bot/quests/defs/watchtower docs/QUESTS.md test/quests/defs/watchtower.test.ts tools/nav
git commit -m "feat(watchtower): escapes from every pocket, and document the module"
git push -u origin watchtower
gh pr create --title "feat(quester): automate Watch Tower" --body "$(cat <<'BODY'
Closes #112.

Watch Tower as the nineteenth AIOQuester module: twelve journal stages, four crystals,
three tribal-ogre chains, six skavid caves with the language puzzle, the ogre potion,
six shamans, and the Rock of Dalgroth.

Design: `docs/superpowers/specs/2026-07-28-watchtower-quest-design.md`.
Plan: `docs/superpowers/plans/2026-07-28-watchtower-quest.md`.

Two general extensions land with it:
- journal sub-progress as typed flags on the quest snapshot (`readProgress`), so a
  stage with internal branching stays resumable and `decide()` stays pure;
- `talkChoosingBy`, which picks a dialogue option from the NPC's spoken line — the mad
  skavid says one of four phrases at random.

Verified: unit suite green; each leg live-verified with `tools/watchtower-solo-test.ts`;
one uncheated end-to-end run from a fresh account with only coins and the three
drop-only items banked.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: stage varp → Task 4; sealed pockets
→ Tasks 8-9 (Grew, Toban), 11-12 (city), 13 (caves), 14 (enclave), 7/17 (tower); no-gold-bar
finding → honoured by never referencing `ogre_guard1`; jangerberry spawns → Task 9; the tower
ladder that lies at stage 0 → Task 7 Step 3; route legs → Tasks 7-17 in journal order; module
layout → the File Structure table; state and resumability → Tasks 1, 4, 18; the recovery table →
Tasks 8 (key), 11 (relic), 13 (map), 17 (crystals), 16 (potion); nav changes → Task 5 Step 6;
item sourcing → Task 12 Step 4 and Task 15 Step 4; new primitives → Tasks 2 and 16; testing →
Task 6 plus a live step in every later task; phasing → Tasks 7-17 follow phases A-F.

**Open risks from the spec are all made live-test steps**, not assumptions: the level-1
`Jump-From` loc (Task 12 Step 7), the candle on a blocked tile (Task 13 Step 4 uses `grabGround`
with `waitIfMissing`, checked in Task 14 Step 7), the invisible walls after a gate crossing (Task
11 arrival checks key on the destination tile), and the cave-6 boundary (Task 13 Step 7).

**Type consistency.** `heldId` is a private per-file helper in `tribes.ts`, `gutanoth.ts`,
`enclave.ts`, `potion.ts` and `caves.ts`; `held(snap, id)` is the snapshot reader in `index.ts`;
`heldOf(snap, id)` is the exported form in `supplies.ts`. `WT_ITEM`/`WT_LOC`/`WT_NPC`/`WT_TILE`
keep their names throughout. `QuestProgress`, `hasFlag`, `flagValue` are used exactly as defined
in Task 1.
