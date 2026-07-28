// Type declarations for the rs2b0t script ABI (apiVersion 1). Mirrors the
// client's src/bot/api surface. interact()-style methods return
// boolean | Promise<boolean> (the promise form is ABI headroom; the direct
// driver resolves synchronously) — always await, and verify outcomes with
// Execution.delayUntil on game state.

/**
 * ABI version this shim is built for. The client refuses a bundle whose
 * version does not match the one it installs.
 * @see docs/ARCHITECTURE.md#the-abi-boundary
 */
export const apiVersion: number;

// ---- world primitives ----

/**
 * A world position. Anything positional accepts this shape.
 * @see docs/API.md#world-primitives
 */
export interface WorldTile {
    x: number;
    z: number;
    level: number;
}

/**
 * A concrete world tile with distance and translation helpers.
 * @see docs/API.md#world-primitives
 */
export class Tile implements WorldTile {
    readonly x: number;
    readonly z: number;
    readonly level: number;
    constructor(x: number, z: number, level?: number);
    static from(tile: WorldTile): Tile;
    /** Chebyshev distance (game movement metric). */
    distanceTo(other: WorldTile): number;
    translate(dx: number, dz: number): Tile;
    equals(other: WorldTile): boolean;
    toString(): string;
}

/**
 * A region of the map — rectangular or circular — for containment tests and
 * random-tile picks.
 * @see docs/API.md#world-primitives
 */
export abstract class Area {
    static rectangular(a: WorldTile, b: WorldTile): Area;
    static circular(center: WorldTile, radius: number): Area;
    abstract contains(tile: WorldTile): boolean;
    abstract getRandomTile(): Tile;
}

// ---- execution (the only legal way to sleep) ----

/**
 * The only legal way to sleep. These waits are settled from the client's frame
 * callback, so bot time is game time and Stop can unwind them; a bare
 * `setTimeout` escapes the runtime and trips the watchdog.
 * @see docs/API.md#execution
 * @see docs/ARCHITECTURE.md#frame-gap-insurance
 */
export const Execution: {
    /** Resolve after at least `ms` wall-clock milliseconds. */
    delay(ms: number): Promise<void>;
    /** Resolve after `n` more server ticks (~600ms each). */
    delayTicks(n: number): Promise<void>;
    /**
     * Resolve true when cond() holds (checked once per client frame), false
     * after timeoutMs (default 6000). Awaiting anything other than
     * Execution.* escapes the runtime: Stop can't unwind it and the watchdog
     * warns.
     */
    delayUntil(cond: () => boolean, timeoutMs?: number): Promise<boolean>;
};

// ---- game state ----

/**
 * Local player and world state — position, energy, combat, animation, ticks.
 * @see docs/API.md#game
 */
export const Game: {
    ingame(): boolean;
    /** Local player's world tile, or null before login/scene load. */
    tile(): WorldTile | null;
    energy(): number;
    /** The run toggle is on. */
    runEnabled(): boolean;
    weight(): number;
    /** Local player in combat (health bar showing). */
    inCombat(): boolean;
    /** Local player is playing a non-idle animation. */
    animating(): boolean;
    /** Server ticks observed since the client booted. */
    tick(): number;
    /** Current com_mode varp (combat style index). */
    combatMode(): number;
    setCombatStyle(mode: number): boolean;
    /** Local player's display name, or null before login. */
    myName(): string | null;
    openSideTab(tab: number): Promise<boolean>;
    castOnNpc(spell: string, npc: Npc): Promise<boolean>;
};

// ---- entities + queries ----

/**
 * Something with right-click actions that can be operated by name.
 * @see docs/API.md#entities--queries
 */
export interface Interactable {
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;
}

/**
 * Something with a world position and a distance from the local player.
 * @see docs/API.md#entities--queries
 */
export interface Locatable {
    tile(): Tile;
    distance(): number;
}

/**
 * A non-player character in the loaded scene.
 * @see docs/API.md#entity-shapes
 */
export class Npc implements Interactable, Locatable {
    readonly name: string | null;
    readonly level: number;
    readonly index: number;
    readonly inCombat: boolean;
    readonly health: number;
    tile(): Tile;
    distance(): number;
    actions(): string[];
    valid(): boolean;
    interact(action: string): boolean | Promise<boolean>;
}

/**
 * Another player in the loaded scene.
 * @see docs/API.md#entity-shapes
 */
export class Player implements Locatable {
    readonly name: string | null;
    readonly inCombat: boolean;
    tile(): Tile;
    distance(): number;
    actions(): string[];
}

/**
 * A scenery object — door, tree, rock, bank booth, altar.
 * @see docs/API.md#entity-shapes
 */
export class Loc implements Interactable, Locatable {
    readonly name: string | null;
    readonly id: number;
    tile(): Tile;
    distance(): number;
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;
}

/**
 * An item lying on the ground in the loaded scene.
 * @see docs/API.md#entity-shapes
 */
export class GroundItem implements Interactable, Locatable {
    readonly name: string | null;
    readonly id: number;
    readonly count: number;
    tile(): Tile;
    distance(): number;
    actions(): string[];
    interact(action: string): boolean | Promise<boolean>;
}

/**
 * The shape `EntityQuery` filters over.
 * @see docs/API.md#entityquery
 */
interface QueryableEntity extends Locatable {
    name: string | null;
    actions(): string[];
}

/**
 * Chainable filter over scene entities. Filters compose, then a terminal
 * (`nearest`, `results`, `exists`, ...) evaluates against the current scene.
 * @see docs/API.md#entityquery
 */
export class EntityQuery<E extends QueryableEntity> {
    /** Case-insensitive exact name match against any of the given names. */
    name(...names: string[]): this;
    /** Entity offers this action (case-insensitive). */
    action(action: string): this;
    /** Within `dist` tiles of the local player. */
    within(dist: number): this;
    /** Within a rectangle (inclusive). */
    inside(area: { minX: number; maxX: number; minZ: number; maxZ: number }): this;
    where(pred: (e: E) => boolean): this;
    results(): E[];
    nearest(): E | null;
    first(): E | null;
    exists(): boolean;
    count(): number;
}

/**
 * NPC queries.
 * @see docs/API.md#entities--queries
 */
export const Npcs: {
    query(): EntityQuery<Npc>;
    all(): Npc[];
    nearest(count?: number): Npc[];
};
/**
 * Player queries.
 * @see docs/API.md#entities--queries
 */
export const Players: { query(): EntityQuery<Player> };
/**
 * Scenery queries. A loc query is empty for about a tick after a level change —
 * blank does not mean absent.
 * @see docs/API.md#entities--queries
 * @see docs/NAV.md#level-change-loc-lag
 */
export const Locs: { query(): EntityQuery<Loc> };
/**
 * Ground-item queries.
 * @see docs/API.md#entities--queries
 */
export const GroundItems: { query(): EntityQuery<GroundItem> };

// ---- hud ----

/**
 * One backpack slot.
 * @see docs/API.md#invitem
 */
export class InvItem {
    readonly name: string | null;
    readonly id: number;
    readonly slot: number;
    readonly count: number;
    actions(): string[];
    /** Held op by name, e.g. item.interact('Bury'). */
    interact(action: string): boolean | Promise<boolean>;
    /**
     * Use this item on another item, a scenery loc, or an npc — the "use X
     * with Y" behind every processing skill (knife→logs, bar→anvil, ess→altar).
     * Returns false if a loc target is off-scene.
     */
    useOn(target: InvItem | Loc | Npc): boolean | Promise<boolean>;
}

/**
 * The backpack.
 * @see docs/API.md#inventory--equipment
 */
export const Inventory: {
    items(): InvItem[];
    first(name: string): InvItem | null;
    contains(name: string): boolean;
    /** Total quantity of an item across the backpack (sums stacks + slots). */
    count(name: string): number;
    /** Occupied slots. */
    used(): number;
    isFull(): boolean;
};

/**
 * Worn equipment.
 * @see docs/API.md#inventory--equipment
 */
export const Equipment: {
    items(): InvItem[];
    contains(name: string): boolean;
};

/**
 * Skill levels and experience.
 * @see docs/API.md#skills
 */
export const Skills: {
    /** Skill index by lowercase name ('woodcutting', ...), -1 if unknown. */
    index(name: string): number;
    /** Base (unboosted) level. */
    level(name: string): number;
    /** Current (boosted/drained) level. */
    effective(name: string): number;
    xp(name: string): number;
    /** Effective/base hitpoints, 1 while the stat isn't readable yet. */
    hpFraction(): number;
};

/**
 * One row of the open bank.
 * @see docs/API.md#bank
 */
export interface BankItemSnapshot {
    slot: number;
    id: number;
    name: string | null;
    count: number;
    ops: (string | null)[];
    comId: number;
}

/**
 * The bank interface. `isOpen()` only says the component exists — its item list
 * fills a beat later, and again after a deposit, so verify before trusting a
 * count of zero.
 * @see docs/API.md#bank
 */
export const Bank: {
    isOpen(): boolean;
    items(): BankItemSnapshot[];
    count(name: string): number;
    withdraw(name: string, op?: string): boolean | Promise<boolean>;
    deposit(name: string, op?: string): boolean | Promise<boolean>;
    depositInventory(): Promise<void>;
};

/**
 * A shop interface. Nothing here walks; be near the keeper first.
 * @see docs/API.md#registering-a-bot
 */
export const Shop: {
    isOpen(): boolean;
    /** Trade with `npcName` — walks nothing, the caller must already be near. */
    open(npcName: string): Promise<boolean>;
    /** The shop-side stock rows of the open shop. */
    stock(): { name: string; count: number; slot: number }[];
    /** Buy up to `n` of `name`; resolves the units actually bought. */
    buy(name: string, n: number): Promise<number>;
    /** Sell up to `n` of `name`; resolves the units actually sold. */
    sell(name: string, n: number): Promise<number>;
    close(): Promise<void>;
};

/**
 * A quest's journal colour.
 * @see docs/QUESTS.md#quest-state
 */
export type QuestStatus = 'notStarted' | 'inProgress' | 'complete' | 'unknown';

/**
 * The quest tab. This is the authoritative source of quest progress — never
 * infer it from varps.
 * @see docs/QUESTS.md#quest-state
 */
export const Quests: {
    /** Every quest on the quest tab with its journal-colour status. */
    all(): { name: string; status: QuestStatus }[];
    status(name: string): QuestStatus;
    /** Quest points shown on the tab. */
    points(): number;
};

/**
 * Chat modals: dialogue pages, option lists, and make-x menus.
 * @see docs/API.md#chatdialog
 */
export const ChatDialog: {
    /** A chat modal is open (dialog, make-x, ...). */
    isOpen(): boolean;
    /** A "Click here to continue" button is up. */
    canContinue(): boolean;
    /** Press continue and wait for the dialog page to change. */
    continue(): Promise<boolean>;
    /** Selectable option lines in the current dialog (text only). */
    options(): string[];
    /** Pick the option whose text contains `match` (or the first). */
    chooseOption(match?: string): Promise<boolean>;
    /** A "What would you like to make?" skill-multi menu is open. */
    isMakeMenu(): boolean;
    /** Product names offered by the open make menu. */
    makeProducts(): string[];
    /**
     * In a make menu, pick the product whose name contains `match` (or the
     * first) at the largest fixed quantity offered (prefer 10).
     */
    make(match?: string): Promise<boolean>;
};

// ---- movement ----

/**
 * Options for a single web-walk.
 * @see docs/API.md#movement
 */
export interface WalkOptions {
    /** Arrive within this many tiles of dest (default 2). */
    radius?: number;
    timeoutMs?: number;
    log?: (msg: string) => void;
}

/**
 * Options for a walk behind the escalation ladder.
 * @see docs/NAV.md#when-it-gets-stuck
 */
export interface WalkResilientOptions {
    /** Arrive when within this Chebyshev distance of dest. */
    radius: number;
    /** Bound the escalation to this many baked-walk passes; default = retry forever. */
    attempts?: number;
    /** Per baked-walk budget (default 90s). */
    timeoutMs?: number;
    /** Client-scene-walk arrival radius when bridging a baked gap (default = radius+1). */
    sceneRadius?: number;
    /** Big-budget baked retry's node budget (default 1.2M). */
    maxBudget?: number;
    log?: (msg: string) => void;
}

/**
 * World-scale movement: A* over the baked collision pack plus the door and
 * transport graph, opening doors and recovering from stuck.
 * @see docs/API.md#movement
 * @see docs/NAV.md
 */
export const Traversal: {
    /**
     * Web-walk across the world (A* over the baked collision pack + door/
     * transport graph; opens doors, recovers from stuck). Resolves false on
     * timeout/no-path. Unwalkable destinations snap to the nearest reachable
     * tile.
     */
    walkTo(dest: WorldTile, opts?: WalkOptions): Promise<boolean>;
    /**
     * walkTo behind an escalation ladder (re-path, big-budget retry, scene-walk
     * bridging) that by default never gives up — only a random event or Stop
     * ends it early. Prefer this for unattended walks.
     */
    walkResilient(dest: WorldTile, opts: WalkResilientOptions): Promise<boolean>;
    /** Warm the nav worker + collision pack before the first walk. */
    preload(): void;
    /** Path tiles left in the active walk (overlay/progress display). */
    remaining(): number;
};

/**
 * Same-scene walking only. Prefer `Traversal` unless you specifically want a
 * single click within the loaded scene.
 * @see docs/NAV.md#following-a-path
 */
export const DirectNavigator: {
    /** One same-scene walk click toward the tile (clamped into the scene). */
    walk(dest: WorldTile): boolean | Promise<boolean>;
    /** Same-scene walk with stall re-clicking; prefer Traversal.walkTo. */
    walkTo(dest: WorldTile, radius?: number, timeoutMs?: number): Promise<boolean>;
};

// ---- events ----

/**
 * One line of game chat.
 * @see docs/API.md#events
 */
export interface ChatLine {
    type: number;
    username: string | null;
    text: string;
}

/**
 * Every event a bot can subscribe to, with its payload.
 * @see docs/API.md#events
 */
export interface EventMap {
    tick: { tick: number };
    'chat.message': ChatLine;
    'skill.xp': { skill: number; name: string; xp: number; delta: number };
    'skill.level': { skill: number; name: string; level: number; previous: number };
    'inventory.changed': { slot: number; id: number; name: string | null; count: number; previousId: number; previousCount: number };
    'varp.changed': { index: number; value: number; previous: number };
}

/**
 * Global event bus. Inside a bot prefer `this.on()`, which unsubscribes on stop.
 * @see docs/API.md#events
 */
export const events: {
    /** Subscribe; returns the unsubscriber. Inside a bot prefer this.on(). */
    on<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): () => void;
    off<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): void;
};

// ---- bot base classes ----

/** Typed accessor for the run's parameters (from the manifest settingsSchema,
 *  overlaid with panel edits and ?Script.key=… URL overrides). */
export interface SettingsBag {
    bool(key: string, fallback?: boolean): boolean;
    num(key: string, fallback?: number): number;
    str(key: string, fallback?: string): string;
    list(key: string, fallback?: string[]): string[];
    tile(key: string, fallback: Tile): Tile;
    raw(): Record<string, unknown>;
}

/**
 * Base class for every bot. Usually extended via `LoopingBot`, `TaskBot`, or
 * `TreeBot` rather than directly.
 * @see docs/API.md#bot-base-classes
 */
export abstract class AbstractBot {
    /** Wall-clock ms between loop() iterations when loop() returns void. */
    loopDelay: number;
    /** Resolved parameters for this run; read e.g. this.settings.bool('x'). */
    readonly settings: SettingsBag;
    onStart?(): void | Promise<void>;
    /** Runs after stop AND crash — clean up here. */
    onStop?(): void;
    onPause?(): void;
    onResume?(): void;
    /** Draw on the overlay canvas; called every client redraw while running. */
    onPaint?(ctx: CanvasRenderingContext2D): void;
    /**
     * Where recovery flows (watchdog, guarded restarts) should walk the bot
     * back to. Scripts with a working anchor implement this.
     */
    recoveryAnchor?(): Tile | null;
    /**
     * NPC names this bot legitimately fights — the runtime event guard never
     * treats them as hostile random events. Override in combat scripts.
     */
    grindTargets(): string[];
    log(msg: string): void;
    /**
     * Subscribe to a game event for this run (auto-removed on stop/crash).
     * Callbacks fire mid-frame — set flags, log; do real work in loop().
     */
    protected on<K extends keyof EventMap>(event: K, cb: (payload: EventMap[K]) => void): void;
}

/**
 * The common shape: implement `loop()` and it is called repeatedly.
 * @see docs/API.md#loopingbot
 */
export abstract class LoopingBot extends AbstractBot {
    /** Return a number to override loopDelay for the next iteration. */
    abstract loop(): number | void | Promise<number | void>;
}

/**
 * A unit of work for `TaskBot`: a guard and the action it guards.
 * @see docs/API.md#taskbot
 */
export interface Task {
    validate(): boolean | Promise<boolean>;
    execute(): void | Promise<void>;
}

// ---- item acquisition ----

/**
 * Where an item can be obtained from.
 * @see docs/API.md#item-acquisition
 */
export type ItemSource = { kind: 'shop'; npc: string; near: WorldTile } | { kind: 'ground'; at: WorldTile } | { kind: 'gather' } | { kind: 'make' };

/**
 * A quantity of an item, and where to get it.
 * @see docs/API.md#item-acquisition
 */
export type ItemNeed = { name: string; count: number; source: ItemSource };

/** Held count of `name` across every matching backpack slot (case-insensitive). */
export function held(name: string): number;

/** True once every need's count is already met. */
export function hasAll(needs: ItemNeed[]): boolean;

/** Task that acquires the first unmet ItemNeed (shop trip / ground pickup). */
export class AcquireTask implements Task {
    constructor(bot: AbstractBot, needs: ItemNeed[]);
    validate(): boolean;
    execute(): Promise<void>;
}

/** Runs the first task whose validate() returns true, once per loop. */
export abstract class TaskBot extends LoopingBot {
    protected add(...tasks: Task[]): void;
    loop(): Promise<number | void>;
}

/**
 * A decision node in a `TreeBot`.
 * @see docs/API.md#treebot
 */
export abstract class BranchTask {
    abstract validate(): boolean;
    abstract success(): TreeNode;
    abstract failure(): TreeNode;
}

/**
 * An action node in a `TreeBot`.
 * @see docs/API.md#treebot
 */
export abstract class LeafTask {
    abstract execute(): void | Promise<void>;
}

/**
 * Either node kind in a behaviour tree.
 * @see docs/API.md#treebot
 */
export type TreeNode = BranchTask | LeafTask;

/** Walks branches by validate() until a leaf, executes it, once per loop. */
export abstract class TreeBot extends LoopingBot {
    abstract root(): TreeNode;
    loop(): Promise<number | void>;
}

// ---- manifest ----

/**
 * The parameter types the panel can render.
 * @see docs/API.md#settings
 */
export type SettingType = 'boolean' | 'number' | 'string' | 'string[]' | 'tile';

/**
 * One declared parameter: its type, default, and presentation.
 * @see docs/API.md#settings
 */
export interface SettingDef {
    type: SettingType;
    default: unknown;
    label?: string;
    min?: number;
    max?: number;
    help?: string;
}

/** Parameter schema: shown as a form in the panel, overridable via
 *  ?ScriptName.key=value. Read at runtime with this.settings. */
export type SettingsSchema = Record<string, SettingDef>;

/**
 * What a script declares about itself: name, description, category, tags, and
 * its parameter schema.
 * @see docs/API.md#registering-a-bot
 */
export interface BotManifestInput {
    name: string;
    description?: string;
    version?: string;
    /** Skill/group the script belongs to (e.g. "Mining"). Becomes a filter
     *  chip in the script library; grouped under "Other" when omitted. */
    category?: string;
    /** Free-form labels for search/filtering in the library (e.g. "f2p"). */
    tags?: string[];
    settingsSchema?: SettingsSchema;
    create(): AbstractBot;
}

/**
 * A validated manifest, as returned by `defineBot`.
 * @see docs/API.md#registering-a-bot
 */
export interface BotManifest extends BotManifestInput {
    __rs2b0tManifest: 1;
}

/** Default-export defineBot({...}) from your script's entry module. */
export function defineBot(manifest: BotManifestInput): BotManifest;

/** Imperative registration (the loader calls this for default exports). */
export function registerScript(manifest: BotManifestInput, origin?: string): void;

/** Low-level adapter reads — escape hatch; prefer the typed surface above. */
export const reader: Record<string, (...args: never[]) => unknown>;
