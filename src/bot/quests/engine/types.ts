import type Tile from '../../api/Tile.js';
import type { WorldTile } from '../../adapter/ClientAdapter.js';
import type { QuestStatus } from '#/bot/api/hud/Quests.js';
import type { QuestRecord } from '../types.js';
import type { NpcStop, LadderHop } from '../exec/primitives.js';

export interface QuestSnapshot {
    journal: QuestStatus;
    inv: Map<string, number>;
    worn: Set<string>;
    noProgress: number;
    bankCoins: number;
    /** Exact server quest stage when the quest module exposes one. */
    stage?: number;
    /** Last complete bank view observed by this engine instance. */
    bank?: ReadonlyMap<string, number>;
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
    | { kind: 'withdraw'; items: { name: string; qty: number }[]; bank?: Tile; leaveOpen?: boolean }
    | { kind: 'deposit'; keep: string[]; bank?: Tile; leaveOpen?: boolean; exactKeep?: boolean }
    | { kind: 'mineRock'; rock: string; item: string; qty: number; anchor: Tile }
    | { kind: 'buy'; item: string; qty: number; shop: { npc: string; anchor: Tile }; estGp: number }
    | { kind: 'custom'; name: string; run: (log: (m: string) => void) => Promise<boolean> }
    | { kind: 'wait'; reason: string }
    | { kind: 'done' };

export interface QuestModule {
    record: QuestRecord;
    hops?: LadderHop[];
    bank?: Tile;
    grind?: string[];
    food?: number;
    gather?: Record<string, (snap: QuestSnapshot, need: number) => QuestStep>;
    tools?: string[];
    /** The module owns all banking/loadout decisions, including restarts in bankless areas. */
    ownsInventory?: boolean;
    /** Read an exact quest stage from client-visible state. Async journals are supported. */
    readStage?: () => number | undefined | Promise<number | undefined>;
    decide(snap: QuestSnapshot): QuestStep;
}
