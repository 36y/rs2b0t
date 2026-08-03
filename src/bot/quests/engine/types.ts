import type Tile from '../../api/Tile.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';
import type { QuestStatus } from '#/bot/api/hud/Quests.js';
import type { QuestRecord } from '../types.js';
import type { NpcStop, LadderHop } from '../exec/primitives.js';

export interface QuestProgress {
    stage: number;
    /** Journal-visible sub-progress. `name`, or `name:N` for a counted flag. */
    flags: ReadonlySet<string>;
}

export function hasFlag(progress: QuestProgress | undefined, name: string): boolean {
    return progress?.flags.has(name) ?? false;
}

export function flagValue(progress: QuestProgress | undefined, name: string): number | undefined {
    const prefix = name + ':';
    for (const flag of progress?.flags ?? []) {
        if (flag.startsWith(prefix)) {
            const value = Number(flag.slice(prefix.length));
            return Number.isFinite(value) ? value : undefined;
        }
    }
    return undefined;
}

export interface QuestSnapshot {
    journal: QuestStatus;
    inv: Map<string, number>;
    /** Inventory totals keyed by exact server object ID. */
    invIds?: ReadonlyMap<number, number>;
    worn: Set<string>;
    /** Equipped object IDs. */
    wornIds?: ReadonlySet<number>;
    noProgress: number;
    bankCoins: number;
    /** Exact server quest stage when the quest module exposes one. */
    stage?: number;
    /** Stage plus journal sub-progress, when the module exposes readProgress. */
    progress?: QuestProgress;
    /** Last complete bank view observed by this engine instance. */
    bank?: ReadonlyMap<string, number>;
    /** Last complete bank view keyed by exact server object ID. */
    bankIds?: ReadonlyMap<number, number>;
    bankKnown?: boolean;
    tile?: WorldTile | null;
    freeSlots?: number;
}

export type QuestStep =
    | { kind: 'talk'; stop: NpcStop }
    | { kind: 'grabGround'; item: string; anchor: Tile; waitIfMissing?: boolean }
    | { kind: 'pickLoc'; loc: string; op: string; item: string; anchor: Tile }
    | { kind: 'interactLoc'; loc: string; op: string; anchor: Tile; expectItem?: string }
    | { kind: 'useOn'; item: string; targetKind: 'npc' | 'loc' | 'item'; target: string; anchor: Tile; product?: string }
    | { kind: 'equip'; item: string }
    | { kind: 'scanBank'; bank?: Tile }
    | { kind: 'withdraw'; items: { name: string; qty: number; id?: number }[]; bank?: Tile; leaveOpen?: boolean }
    | { kind: 'deposit'; keep: string[]; keepIds?: readonly number[]; bank?: Tile; leaveOpen?: boolean; exactKeep?: boolean }
    | { kind: 'mineRock'; rock: string; item: string; qty: number; anchor: Tile }
    | { kind: 'buy'; item: string; qty: number; shop: { npc: string; anchor: Tile }; estGp: number }
    | { kind: 'custom'; name: string; run: (log: (m: string) => void) => Promise<boolean> }
    | { kind: 'wait'; reason: string }
    | { kind: 'done' };

export interface QuestSustain {
    /** Food display names this quest can source and use for traversal upkeep. */
    foods: readonly string[];
    /** Hitpoints fraction below which the host should eat, from 0 to 1. */
    eatBelowHp: number;
}

export interface QuestModule {
    record: QuestRecord;
    hops?: LadderHop[];
    /**
     * The bank this quest uses. Most quests sit in one town and naming its bank
     * is both shorter and more predictable than working it out. `'nearest'` is
     * for the ones that do not — a quest spread across four kingdoms pays for a
     * pinned bank on every single leg.
     */
    bank?: Tile | 'nearest';
    grind?: string[];
    food?: number;
    gather?: Record<string, (snap: QuestSnapshot, need: number) => QuestStep>;
    tools?: string[];
    /**
     * Walked when the quest is finished, before the retreat to a bank, for the
     * quests that end somewhere the navigator cannot leave on its own. Return
     * true once the character is somewhere a bank walk can start from.
     */
    exit?: (log: (m: string) => void) => Promise<boolean>;
    /** The module owns all banking/loadout decisions, including restarts in bankless areas. */
    ownsInventory?: boolean;
    /** Read an exact quest stage from client-visible state. Async journals are supported. */
    readStage?: () => number | undefined | Promise<number | undefined>;
    /** Supersedes readStage: the stage plus sub-progress the stage number cannot carry. */
    readProgress?: () => QuestProgress | undefined | Promise<QuestProgress | undefined>;
    /** Optional quest-specific survival policy applied while this module is active. */
    sustain?: QuestSustain;
    /**
     * Spending money to keep in the pack, default `COIN_FLOAT`. Set 0 when the
     * module fetches coins at the point of sale — the float is restored on every
     * provisioning loop, so a standing balance means a bank trip per purchase.
     */
    coinFloat?: number;
    /**
     * Optional one-shot advisory when this module becomes the active runner.
     * Use for “live harness only proved X stats” warnings — not hard gates.
     * Return null when the account looks fine.
     */
    warnReadiness?: () => string | null;
    decide(snap: QuestSnapshot): QuestStep;
}
