import { actions, reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import Tile from '../../api/Tile.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Quests } from '../../api/hud/Quests.js';
import { Skills } from '../../api/hud/Skills.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import { QUESTS } from '../data/quests.js';
import type { QuestModule, QuestSnapshot, QuestStep } from '../engine/types.js';
import { talkThrough, type NpcStop } from '../exec/primitives.js';
import { QuestFood } from '../food.js';

export const LOST_CITY_STAGE = {
    NOT_STARTED: 0,
    STARTED: 1,
    SPOKEN_TO_SHAMUS: 2,
    SPIRIT_DEFEATED: 3,
    BRANCH_CUT: 4,
    STAFF_MADE: 5,
    COMPLETE: 6
} as const;

export function parseLostCityJournal(lines: readonly string[] | string): number | undefined {
    const text = (typeof lines === 'string' ? lines : lines.join(' '))
        .replace(/@[a-z0-9]{3}@/gi, ' ')
        .replace(/[|\s]+/g, ' ')
        .trim()
        .toLowerCase();

    // Check newest progress first because later journal entries repeat earlier history.
    if (text.includes('quest complete!')) return LOST_CITY_STAGE.COMPLETE;
    if (text.includes('crafted a dramen staff')) return LOST_CITY_STAGE.STAFF_MADE;
    if (text.includes('i should craft the branch from the tree into a staff')) return LOST_CITY_STAGE.BRANCH_CUT;
    if (text.includes('with the spirit defeated i can cut a branch')) return LOST_CITY_STAGE.SPIRIT_DEFEATED;
    if (text.includes('i can find a dramen tree')) return LOST_CITY_STAGE.SPOKEN_TO_SHAMUS;
    if (text.includes('apparently there is a leprechaun')) return LOST_CITY_STAGE.STARTED;
    if (text.includes('i can start this quest')) return LOST_CITY_STAGE.NOT_STARTED;
    return undefined;
}

async function readLostCityStage(): Promise<number | undefined> {
    const status = Quests.status('Lost City');
    if (status === 'complete') return LOST_CITY_STAGE.COMPLETE;
    if (status === 'notStarted') return LOST_CITY_STAGE.NOT_STARTED;
    if (status !== 'inProgress') return undefined;

    const lines = await Quests.journal('Lost City');
    const stage = parseLostCityJournal(lines);
    if (reader.modals().main !== -1) {
        actions.closeModal();
        await Execution.delayTicks(1);
    }
    return stage;
}

const KNIFE = 'Knife';
const KEBAB = 'Kebab';
const KEBAB_TARGET = 12;
const BRANCH = 'Dramen branch';
const STAFF = 'Dramen staff';
const AXES = ['Rune axe', 'Adamant axe', 'Mithril axe', 'Black axe', 'Steel axe', 'Iron axe', 'Bronze axe'];
const DUNGEON_AXES = ['Iron axe', 'Bronze axe'];

const SHAMUS_TREE_ID = 2409;
const DRAMEN_TREE_ID = 1292;
const MAGIC_DOOR_ID = 2407;
const TREE_SPIRIT_ID = 655;
const SHAMUS_ID = 654;
const ENTRANA_ZOMBIE_ID = 76;

const DRAYNOR_BANK = new Tile(3093, 3243, 0);
const KNIFE_SPAWN = new Tile(3224, 3202, 0);
const BOB_AXES = { npc: 'Bob', anchor: new Tile(3232, 3203, 0) };
const KEBAB_SELLER = new Tile(3272, 3182, 0);
const SHAMUS_TREE = new Tile(3138, 3212, 0);
const PORT_SARIM_MONK = new Tile(3046, 3235, 0);
const ENTRANA_LANDING = new Tile(2834, 3334, 0);
const ENTRANA_LADDER = new Tile(2820, 3374, 0);
const DUNGEON_ARRIVAL = new Tile(2822, 9774, 0);
const ZOMBIES = new Tile(2846, 9761, 0);
const DRAMEN_TREE = new Tile(2860, 9734, 0);
const MAGIC_DOOR_APPROACH = new Tile(2873, 9750, 0);
const SHED_OUTSIDE = new Tile(3201, 3169, 0);

const WARRIOR: NpcStop = {
    npc: 'Warrior',
    anchor: new Tile(3145, 3202, 0),
    leash: 7,
    prefer: [
        'What are you camped here for?',
        "Who's Zanaris?",
        "If it's hidden how are you planning to find it?",
        "Looks like you don't know either."
    ]
};

const PORT_MONK: NpcStop = {
    npc: 'Monk of Entrana',
    anchor: PORT_SARIM_MONK,
    leash: 8,
    prefer: ["Yes, okay, I'm ready to go."]
};

type LostCityArea = 'dungeon' | 'entranaShip' | 'entrana' | 'zanaris' | 'mainland' | 'unknown';

export function lostCityArea(tile: QuestSnapshot['tile']): LostCityArea {
    if (!tile) {
        return 'unknown';
    }
    if (tile.x >= 3150 && tile.x <= 3300 && tile.z >= 9450 && tile.z <= 9700) {
        return 'zanaris';
    }
    if (tile.x >= 2790 && tile.x <= 2900 && tile.z >= 9650 && tile.z <= 9850) {
        return 'dungeon';
    }
    if (tile.x >= 2790 && tile.x <= 2880 && tile.z >= 3290 && tile.z <= 3440) {
        return tile.level > 0 ? 'entranaShip' : 'entrana';
    }
    return 'mainland';
}

const held = (snap: QuestSnapshot, name: string): boolean => (snap.inv.get(name.toLowerCase()) ?? 0) > 0;
const heldCount = (snap: QuestSnapshot, name: string): number => snap.inv.get(name.toLowerCase()) ?? 0;
const worn = (snap: QuestSnapshot, name: string): boolean => snap.worn.has(name.toLowerCase());
const banked = (snap: QuestSnapshot, name: string): number => snap.bank?.get(name.toLowerCase()) ?? 0;
const hasAxe = (snap: QuestSnapshot): boolean => AXES.some(name => held(snap, name) || worn(snap, name));
const wornAxe = (snap: QuestSnapshot): boolean => AXES.some(name => worn(snap, name));

function heldAxe(snap: QuestSnapshot): string | null {
    return AXES.find(name => held(snap, name)) ?? null;
}

function bankAxe(snap: QuestSnapshot): string | null {
    return AXES.find(name => banked(snap, name) > 0) ?? null;
}

function withdraw(items: { name: string; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items, bank: DRAYNOR_BANK };
}

function scanBank(): QuestStep {
    return { kind: 'scanBank', bank: DRAYNOR_BANK };
}

function mainlandKeep(): string[] {
    const food = QuestFood.name?.trim().toLowerCase();
    return ['knife', 'kebab', ...AXES.map(name => name.toLowerCase()), 'dramen branch', 'dramen staff', 'coins', ...(food ? [food] : [])];
}

function makeAcquisitionSpace(snap: QuestSnapshot, slots: number): QuestStep | null {
    if (snap.freeSlots === undefined || snap.freeSlots >= slots) {
        return null;
    }
    const keep = mainlandKeep();
    const disposable = [...snap.inv.keys()].some(name => !keep.includes(name));
    return disposable
        ? { kind: 'deposit', keep, bank: DRAYNOR_BANK, exactKeep: true }
        : { kind: 'wait', reason: `need ${slots} free inventory slot${slots === 1 ? '' : 's'} for Lost City items` };
}

function sourceKnife(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, KNIFE)) {
        return null;
    }
    const space = makeAcquisitionSpace(snap, 1);
    if (space) {
        return space;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    if (banked(snap, KNIFE) > 0) {
        return withdraw([{ name: KNIFE, qty: 1 }]);
    }
    return { kind: 'grabGround', item: KNIFE, anchor: KNIFE_SPAWN, waitIfMissing: true };
}

function sourceMainlandAxe(snap: QuestSnapshot): QuestStep | null {
    if (hasAxe(snap)) {
        return null;
    }
    const space = makeAcquisitionSpace(snap, 1);
    if (space) {
        return space;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const axe = bankAxe(snap);
    if (axe) {
        return withdraw([{ name: axe, qty: 1 }]);
    }
    if ((snap.inv.get('coins') ?? 0) < 100) {
        if (banked(snap, 'Coins') > 0) {
            return withdraw([{ name: 'Coins', qty: Math.min(1000, banked(snap, 'Coins')) }]);
        }
        return { kind: 'wait', reason: 'need coins for an axe from Bob' };
    }
    return { kind: 'buy', item: 'Bronze axe', qty: 1, shop: BOB_AXES, estGp: 100 };
}

function entranaKeep(): string[] {
    const food = QuestFood.name?.trim().toLowerCase();
    return ['knife', 'kebab', 'coins', ...(food ? [food] : [])];
}

function hasEntranaSpillover(snap: QuestSnapshot): boolean {
    const keep = entranaKeep();
    return [...snap.inv.keys()].some(name => !keep.includes(name));
}

async function unequipAll(_log: (m: string) => void): Promise<boolean> {
    for (const item of Equipment.items()) {
        if (item.name && !(await Equipment.unequip(item.name))) {
            return false;
        }
    }
    return Equipment.items().length === 0;
}

async function buyKebabs(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(KEBAB_SELLER, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    for (let i = Inventory.count(KEBAB); i < KEBAB_TARGET; i++) {
        if (Inventory.count('Coins') < 1) {
            log('no coins left for combat Kebabs');
            return false;
        }
        const before = Inventory.count(KEBAB);
        if (!(await talkThrough('Kebab seller', ['Yes please.'], log))) {
            return false;
        }
        if (!(await Execution.delayUntil(() => Inventory.count(KEBAB) > before, 5000))) {
            log('Kebab seller dialogue completed without adding a Kebab');
            return false;
        }
    }
    return true;
}

function sourceKebabs(snap: QuestSnapshot): QuestStep | null {
    const missing = KEBAB_TARGET - heldCount(snap, KEBAB);
    if (missing <= 0) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const inBank = banked(snap, KEBAB);
    // If the bank cannot supply every missing Kebab, buying the remainder may first need a new
    // inventory slot for Coins. Reserve it now so that withdrawing food cannot fill the pack and
    // strand the quest with no disposable item.
    const coinSlot = inBank < missing && heldCount(snap, 'Coins') === 0 ? 1 : 0;
    const space = makeAcquisitionSpace(snap, missing + coinSlot);
    if (space) {
        return space;
    }
    if (inBank > 0) {
        return withdraw([{ name: KEBAB, qty: Math.min(missing, inBank) }]);
    }
    if (heldCount(snap, 'Coins') < missing) {
        const bankCoins = banked(snap, 'Coins');
        if (bankCoins > 0) {
            return withdraw([{ name: 'Coins', qty: Math.min(Math.max(missing, 100), bankCoins) }]);
        }
        return { kind: 'wait', reason: 'need coins for combat Kebabs' };
    }
    return { kind: 'custom', name: `buy ${missing} combat Kebabs`, run: buyKebabs };
}

async function eatKebab(): Promise<boolean> {
    const food = Inventory.first(KEBAB);
    if (!food) {
        return false;
    }
    const beforeCount = Inventory.count(KEBAB);
    const beforeHp = Skills.effective('hitpoints');
    if (!(await food.interact('Eat'))) {
        return false;
    }
    return Execution.delayUntil(
        () => Inventory.count(KEBAB) < beforeCount || Skills.effective('hitpoints') !== beforeHp,
        3000
    );
}

async function restoreWithKebabs(target: number): Promise<void> {
    for (let i = 0; i < KEBAB_TARGET && Skills.hpFraction() < target && Inventory.contains(KEBAB); i++) {
        if (!(await eatKebab())) {
            return;
        }
    }
}

async function waitOutCombat(timeoutMs: number): Promise<boolean> {
    const deadline = performance.now() + timeoutMs;
    while (Game.inCombat() && performance.now() < deadline) {
        if (Skills.hpFraction() < 0.65 && Inventory.contains(KEBAB)) {
            await eatKebab();
        }
        await Execution.delayTicks(1);
    }
    return !Game.inCombat();
}

async function revealAndTalkShamus(log: (m: string) => void): Promise<boolean> {
    let shamus = Npcs.query().where(n => n.id === SHAMUS_ID).within(30).nearest();
    if (!shamus) {
        if (!(await Traversal.walkResilient(SHAMUS_TREE, { radius: 2, attempts: 3, timeoutMs: 90_000, log }))) {
            return false;
        }
        const tree = Locs.query().where(l => l.id === SHAMUS_TREE_ID).action('Chop').within(8).nearest();
        if (!tree) {
            log('no Lost City tree to Chop at the adventurer camp');
            return false;
        }
        if (!(await tree.interact('Chop'))) {
            return false;
        }
        await Execution.delayUntil(() => Npcs.query().where(n => n.id === SHAMUS_ID).within(30).nearest() !== null, 8000);
        shamus = Npcs.query().where(n => n.id === SHAMUS_ID).within(30).nearest();
    }
    if (!shamus) {
        return false;
    }
    return talkThrough('Shamus', ['How does it fit in a shed then?'], log);
}

async function disembarkEntrana(log: (m: string) => void): Promise<boolean> {
    const plank = Locs.query().name('Gangplank').action('Cross').within(10).nearest();
    if (!plank) {
        log('no Entrana Gangplank to Cross from the ship');
        return false;
    }
    if (!(await plank.interact('Cross'))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const tile = Game.tile();
        return tile !== null && tile.level === 0 && ENTRANA_LANDING.distanceTo(tile) <= 8;
    }, 10_000);
}

async function descendEntrana(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(ENTRANA_LADDER, { radius: 2, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    if (!(await talkThrough('Cave monk', ['Well that is a risk I will have to take.'], log))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const tile = Game.tile();
        return tile !== null && DUNGEON_ARRIVAL.distanceTo(tile) <= 8;
    }, 12_000);
}

function liveHasDungeonAxe(): boolean {
    return DUNGEON_AXES.some(name => Inventory.contains(name) || Equipment.contains(name));
}

async function takeDungeonAxe(): Promise<boolean> {
    if (Inventory.isFull()) {
        const junk = Inventory.items().find(item => item.name !== null
            && ![KNIFE, BRANCH, STAFF, 'Coins', ...AXES].some(keep => keep.toLowerCase() === item.name!.toLowerCase())
            && item.actions().some(op => op.toLowerCase() === 'drop'));
        if (junk) {
            await junk.interact('Drop');
            await Execution.delayUntil(() => !Inventory.isFull(), 3000);
        }
    }
    const drop = GroundItems.query().name(...DUNGEON_AXES).within(20).nearest();
    if (!drop) {
        return false;
    }
    if (!(await drop.interact('Take'))) {
        return false;
    }
    return Execution.delayUntil(liveHasDungeonAxe, 8000);
}

async function acquireDungeonAxe(log: (m: string) => void): Promise<boolean> {
    if (liveHasDungeonAxe() || (await takeDungeonAxe())) {
        return true;
    }
    if (Game.inCombat()) {
        await waitOutCombat(120_000);
        return takeDungeonAxe();
    }
    if (!(await Traversal.walkResilient(ZOMBIES, { radius: 7, attempts: 3, timeoutMs: 90_000, log }))) {
        return false;
    }
    if (await takeDungeonAxe()) {
        return true;
    }
    const zombie = Npcs.query()
        .where(n => n.id === ENTRANA_ZOMBIE_ID && !n.inCombat && !n.targetsAnotherPlayer())
        .action('Attack')
        .within(15)
        .nearest();
    if (!zombie) {
        log('waiting for an available Entrana Zombie');
        await Execution.delayTicks(2);
        return false;
    }
    await restoreWithKebabs(0.85);
    if (!(await zombie.interact('Attack'))) {
        return false;
    }
    await Execution.delayUntil(() => Game.inCombat() || !zombie.valid(), 5000);
    await waitOutCombat(120_000);
    return takeDungeonAxe();
}

async function defeatTreeSpirit(log: (m: string) => void): Promise<boolean> {
    let spirit = Npcs.query()
        .where(n => n.id === TREE_SPIRIT_ID && !n.targetsAnotherPlayer())
        .within(18)
        .nearest();
    if (!spirit) {
        if (!(await Traversal.walkResilient(DRAMEN_TREE, { radius: 3, attempts: 3, timeoutMs: 120_000, log }))) {
            return false;
        }
        const tree = Locs.query().where(l => l.id === DRAMEN_TREE_ID).action('Chop down').within(8).nearest();
        if (!tree) {
            log('no Dramen tree to Chop down');
            return false;
        }
        if (!(await tree.interact('Chop down'))) {
            return false;
        }
        await Execution.delayUntil(
            () => Npcs.query()
                .where(n => n.id === TREE_SPIRIT_ID && !n.targetsAnotherPlayer())
                .within(18)
                .nearest() !== null,
            10_000
        );
        spirit = Npcs.query()
            .where(n => n.id === TREE_SPIRIT_ID && !n.targetsAnotherPlayer())
            .within(18)
            .nearest();
    }
    if (!spirit) {
        return false;
    }
    await restoreWithKebabs(0.9);
    if (!Game.inCombat() && !(await spirit.interact('Attack'))) {
        return false;
    }
    if (!(await Execution.delayUntil(() => Game.inCombat() || !spirit!.valid(), 5000))) {
        return false;
    }
    await waitOutCombat(180_000);
    // The next journal read verifies that this player, rather than another attacker, got credit.
    return true;
}

async function chopBranch(log: (m: string) => void): Promise<boolean> {
    if (Inventory.isFull()) {
        const junk = Inventory.items().find(item => item.name !== null
            && ![KNIFE, BRANCH, STAFF, 'Coins', ...AXES].some(keep => keep.toLowerCase() === item.name!.toLowerCase())
            && item.actions().some(op => op.toLowerCase() === 'drop'));
        if (!junk || !(await junk.interact('Drop'))) {
            log('inventory is full and has no disposable item for the Dramen branch');
            return false;
        }
        await Execution.delayUntil(() => !Inventory.isFull(), 3000);
    }
    if (!(await Traversal.walkResilient(DRAMEN_TREE, { radius: 3, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const before = Inventory.count(BRANCH);
    const tree = Locs.query().where(l => l.id === DRAMEN_TREE_ID).action('Chop down').within(8).nearest();
    if (!tree) {
        log('no Dramen tree to cut a branch from');
        return false;
    }
    if (!(await tree.interact('Chop down'))) {
        return false;
    }
    return Execution.delayUntil(() => Inventory.count(BRANCH) > before, 10_000);
}

async function leaveDungeon(log: (m: string) => void): Promise<boolean> {
    if (Game.inCombat()) {
        await Execution.delayUntil(() => !Game.inCombat(), 120_000);
        return false;
    }
    // Walk to the reachable tile west of the portal, then interact explicitly. Targeting the
    // portal tile itself makes the navigator treat its one-way teleport as a normal door edge.
    if (!(await Traversal.walkResilient(MAGIC_DOOR_APPROACH, { radius: 0, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    const door = Locs.query().where(l => l.id === MAGIC_DOOR_ID).action('Open').within(3).nearest();
    if (!door) {
        log('no Magic door to leave the Entrana dungeon');
        return false;
    }
    if (!(await door.interact('Open'))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const tile = Game.tile();
        return tile !== null && lostCityArea(tile) !== 'dungeon';
    }, 12_000);
}

async function enterZanaris(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(SHED_OUTSIDE, { radius: 1, attempts: 4, timeoutMs: 300_000, log }))) {
        return false;
    }
    const door = Locs.query().where(l => l.id === 2406).action('Open').within(5).nearest();
    if (!door) {
        log('no Lost City shed Door to Open');
        return false;
    }
    if (!(await door.interact('Open'))) {
        return false;
    }
    return Execution.delayUntil(() => lostCityArea(Game.tile()) === 'zanaris', 15_000);
}

async function sailToEntrana(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(PORT_SARIM_MONK, { radius: 3, attempts: 3, timeoutMs: 120_000, log }))) {
        return false;
    }
    if (!(await talkThrough(PORT_MONK.npc, PORT_MONK.prefer, log))) {
        return false;
    }
    return Execution.delayUntil(() => {
        const tile = Game.tile();
        return tile !== null && tile.x >= 2790 && tile.x <= 2880 && tile.z >= 3290 && tile.z <= 3440;
    }, 30_000);
}

function mainlandTools(snap: QuestSnapshot): QuestStep | null {
    return sourceKnife(snap) ?? sourceMainlandAxe(snap);
}

function travelToDungeon(snap: QuestSnapshot): QuestStep {
    const area = lostCityArea(snap.tile);
    if (area === 'entranaShip') {
        return { kind: 'custom', name: 'disembark on Entrana', run: disembarkEntrana };
    }
    if (area === 'entrana') {
        return { kind: 'custom', name: 'descend the one-way Entrana ladder', run: descendEntrana };
    }
    if (area === 'mainland') {
        const knife = sourceKnife(snap);
        if (knife) {
            return knife;
        }
        if (hasEntranaSpillover(snap)) {
            return { kind: 'deposit', keep: entranaKeep(), bank: DRAYNOR_BANK, exactKeep: true };
        }
        if (snap.worn.size > 0) {
            return { kind: 'custom', name: 'remove Entrana-restricted equipment', run: unequipAll };
        }
        const food = sourceKebabs(snap);
        if (food) {
            return food;
        }
        return { kind: 'custom', name: 'sail from Port Sarim to Entrana', run: sailToEntrana };
    }
    return { kind: 'wait', reason: 'locating the Entrana route' };
}

function dungeonWork(snap: QuestSnapshot, stage: number): QuestStep {
    if (!hasAxe(snap)) {
        return { kind: 'custom', name: 'get an axe from Entrana Zombies', run: acquireDungeonAxe };
    }
    if (!wornAxe(snap)) {
        return { kind: 'equip', item: heldAxe(snap)! };
    }
    if (stage === LOST_CITY_STAGE.SPOKEN_TO_SHAMUS) {
        return { kind: 'custom', name: 'defeat the Tree Spirit', run: defeatTreeSpirit };
    }
    return { kind: 'custom', name: 'cut a Dramen branch', run: chopBranch };
}

export function decide(snap: QuestSnapshot): QuestStep {
    if (snap.journal === 'complete' || (snap.stage ?? 0) >= LOST_CITY_STAGE.COMPLETE) {
        return { kind: 'done' };
    }
    if (snap.journal === 'unknown') {
        return { kind: 'wait', reason: 'quest journal not loaded' };
    }

    const stage = snap.stage;
    if (stage === undefined) {
        return { kind: 'wait', reason: 'Lost City journal stage unavailable' };
    }
    const area = lostCityArea(snap.tile);

    if (stage === LOST_CITY_STAGE.NOT_STARTED) {
        const tool = mainlandTools(snap);
        return tool ?? { kind: 'talk', stop: WARRIOR };
    }

    if (stage === LOST_CITY_STAGE.STARTED) {
        const tool = mainlandTools(snap);
        return tool ?? { kind: 'custom', name: 'reveal Shamus and learn about the staff', run: revealAndTalkShamus };
    }

    if (stage === LOST_CITY_STAGE.SPOKEN_TO_SHAMUS || stage === LOST_CITY_STAGE.SPIRIT_DEFEATED) {
        if (area === 'dungeon') {
            return dungeonWork(snap, stage);
        }
        return travelToDungeon(snap);
    }

    if (stage === LOST_CITY_STAGE.BRANCH_CUT) {
        if (held(snap, BRANCH)) {
            const knife = sourceKnife(snap);
            if (knife) {
                return area === 'dungeon'
                    ? { kind: 'custom', name: 'leave the dungeon to replace the Knife', run: leaveDungeon }
                    : knife;
            }
            return { kind: 'useOn', item: KNIFE, targetKind: 'item', target: BRANCH, anchor: DRAMEN_TREE, product: STAFF };
        }
        if (area === 'mainland') {
            if (!snap.bankKnown) {
                return scanBank();
            }
            if (banked(snap, BRANCH) > 0) {
                const items = [
                    { name: BRANCH, qty: 1 },
                    ...(held(snap, KNIFE) ? [] : [{ name: KNIFE, qty: 1 }])
                ];
                const space = makeAcquisitionSpace(snap, items.length);
                if (space) {
                    return space;
                }
                return withdraw(items);
            }
        }
        if (area === 'dungeon') {
            return dungeonWork(snap, stage);
        }
        return travelToDungeon(snap);
    }

    if (stage === LOST_CITY_STAGE.STAFF_MADE) {
        if (worn(snap, STAFF)) {
            return area === 'dungeon'
                ? { kind: 'custom', name: 'exit through the Wilderness portal', run: leaveDungeon }
                : { kind: 'custom', name: 'enter Zanaris through the swamp shed', run: enterZanaris };
        }
        if (held(snap, STAFF)) {
            return { kind: 'equip', item: STAFF };
        }
        if (held(snap, BRANCH)) {
            const knife = sourceKnife(snap);
            if (knife) {
                return area === 'dungeon'
                    ? { kind: 'custom', name: 'leave the dungeon to replace the Knife', run: leaveDungeon }
                    : knife;
            }
            return { kind: 'useOn', item: KNIFE, targetKind: 'item', target: BRANCH, anchor: DRAMEN_TREE, product: STAFF };
        }
        if (area === 'mainland') {
            if (!snap.bankKnown) {
                return scanBank();
            }
            if (banked(snap, STAFF) > 0) {
                const space = makeAcquisitionSpace(snap, 1);
                if (space) {
                    return space;
                }
                return withdraw([{ name: STAFF, qty: 1 }]);
            }
            if (banked(snap, BRANCH) > 0) {
                const items = [
                    { name: BRANCH, qty: 1 },
                    ...(held(snap, KNIFE) ? [] : [{ name: KNIFE, qty: 1 }])
                ];
                const space = makeAcquisitionSpace(snap, items.length);
                if (space) {
                    return space;
                }
                return withdraw(items);
            }
        }
        if (area === 'dungeon') {
            return dungeonWork(snap, stage);
        }
        return travelToDungeon(snap);
    }

    return { kind: 'wait', reason: `unrecognized Lost City stage ${stage}` };
}

export const lostcity: QuestModule = {
    record: QUESTS.find(r => r.id === 'zanaris')!,
    bank: DRAYNOR_BANK,
    grind: ['Zombie', 'Tree spirit'],
    tools: ['knife', 'axe', 'dramen branch', 'dramen staff'],
    ownsInventory: true,
    readStage: readLostCityStage,
    decide
};
