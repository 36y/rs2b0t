import { reader, actions } from '../adapter/ClientAdapter.js';
import { LoopingBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { Bank } from '../api/hud/Bank.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { ActionRouter } from '../input/ActionRouter.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';

const NEEDLE = 1733;
const THREAD = 1734;
const BANK_STAND = new Tile(3269, 3167, 0);

// leather_crafting opens as a main modal, skill_multi3 as a chat one
const LEATHER_IF = 2311;
const MULTI3_IF = 8880;
// skill_multi3 "make X" per slot: a = body, b = vambraces, c = chaps
const MULTI3_MAKEX = { a: 8886, b: 8890, c: 8894 };

interface Recipe {
    level: number;
    qty: number;
    label: string;
    // soft leather picks a button on the leather_crafting interface; dragonhide
    // answers the shared skill_multi3 chat dialog instead
    make1?: number;
    make10?: number;
    slot?: 'a' | 'b' | 'c';
}

interface LeatherKind {
    leatherId: number;
    flow: 'interface' | 'single' | 'multi3';
    recipes: Recipe[];
}

// levels/quantities are the engine's craft_leather_table; chaps deliberately has
// no make10 because all three of its buttons make one (engine-side)
export const LEATHERS: Record<string, LeatherKind> = {
    Leather: {
        leatherId: 1741,
        flow: 'interface',
        recipes: [
            { level: 1, qty: 1, label: 'Leather gloves', make1: 8638, make10: 8636 },
            { level: 7, qty: 1, label: 'Leather boots', make1: 8641, make10: 8639 },
            { level: 9, qty: 1, label: 'Leather cowl', make1: 8653, make10: 8651 },
            { level: 11, qty: 1, label: 'Leather vambraces', make1: 8644, make10: 8642 },
            { level: 14, qty: 1, label: 'Leather body', make1: 8635, make10: 8633 },
            { level: 18, qty: 1, label: 'Leather chaps', make1: 8647 },
            { level: 38, qty: 1, label: 'Coif', make1: 8650, make10: 8648 }
        ]
    },
    'Hard leather': {
        leatherId: 1743,
        flow: 'single',
        recipes: [{ level: 28, qty: 1, label: 'Hardleather body' }]
    },
    'Green dragon leather': {
        leatherId: 1745,
        flow: 'multi3',
        recipes: [
            { level: 57, qty: 1, label: 'Green vambraces', slot: 'b' },
            { level: 60, qty: 2, label: 'Green chaps', slot: 'c' },
            { level: 63, qty: 3, label: 'Green body', slot: 'a' }
        ]
    },
    'Blue dragon leather': {
        leatherId: 2505,
        flow: 'multi3',
        recipes: [
            { level: 66, qty: 1, label: 'Blue vambraces', slot: 'b' },
            { level: 68, qty: 2, label: 'Blue chaps', slot: 'c' },
            { level: 71, qty: 3, label: 'Blue body', slot: 'a' }
        ]
    },
    'Red dragon leather': {
        leatherId: 2507,
        flow: 'multi3',
        recipes: [
            { level: 73, qty: 1, label: 'Red vambraces', slot: 'b' },
            { level: 75, qty: 2, label: 'Red chaps', slot: 'c' },
            { level: 77, qty: 3, label: 'Red body', slot: 'a' }
        ]
    },
    'Black dragon leather': {
        leatherId: 2509,
        flow: 'multi3',
        recipes: [
            { level: 79, qty: 1, label: 'Black vambraces', slot: 'b' },
            { level: 82, qty: 2, label: 'Black chaps', slot: 'c' },
            { level: 84, qty: 3, label: 'Black body', slot: 'a' }
        ]
    }
};

export const CRAFTER_SETTINGS: SettingsSchema = {
    leatherType: {
        type: 'string',
        default: 'Leather',
        options: Object.keys(LEATHERS),
        label: 'Leather to use',
        help: 'makes the best item your Crafting level allows for this leather; keeps a needle + thread and banks the rest'
    },
    threadPerTrip: { type: 'number', default: 100, min: 1, max: 1000, label: 'Thread to keep stocked' }
};

function invById(id: number): number {
    return Inventory.items().filter(i => i.id === id).reduce((n, i) => n + i.count, 0);
}

function opIndex(ops: readonly (string | null)[], pattern: RegExp): number {
    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        if (op !== null && pattern.test(op)) {
            return i + 1;
        }
    }
    return -1;
}

// the bank helpers are name-keyed, which cannot separate same-named hides/leathers
async function withdrawXById(id: number, count: number): Promise<boolean> {
    if (count <= 0) {
        return true;
    }
    const item = Bank.items().find(i => i.id === id);
    if (!item) {
        return false;
    }
    const op = opIndex(item.ops, /withdraw[\s-]*x/i);
    if (op === -1) {
        return false;
    }
    const before = Inventory.used();
    ActionRouter.driver.invButton(item.id, item.slot, item.comId, op);
    if (!(await Execution.delayUntil(() => reader.countDialogOpen(), 3000))) {
        return false;
    }
    actions.answerCountDialog(count);
    return Execution.delayUntil(() => Inventory.used() > before, 4000);
}

// deposits by object id: the leathers and their products share display names in
// places, so a name-keyed deposit would bank the wrong thing
async function depositAllExceptIds(keep: Set<number>): Promise<void> {
    for (let guard = 0; guard < 32; guard++) {
        const item = reader.bankSideItems().find(i => !keep.has(i.id));
        if (!item) {
            return;
        }
        const op = opIndex(item.ops, /deposit[\s-]*all/i);
        if (op === -1) {
            return;
        }
        ActionRouter.driver.invButton(item.id, item.slot, item.comId, op);
        await Execution.delayUntil(() => !reader.bankSideItems().some(i => i.slot === item.slot && i.id === item.id), 2000);
    }
}

export default class LeatherCrafter extends LoopingBot {
    override loopDelay = 600;

    private kind: LeatherKind = LEATHERS.Leather;
    private kindLabel = 'Leather';
    private recipe: Recipe | null = null;
    private threadStock = 100;

    private crafted = 0;
    private xpAtStart = 0;
    private status = 'starting';
    private startedAt = Date.now();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.kindLabel = this.settings.str('leatherType', 'Leather');
        this.kind = LEATHERS[this.kindLabel] ?? LEATHERS.Leather;
        this.threadStock = this.settings.num('threadPerTrip', 100);
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('crafting');

        this.pickRecipe();
        if (!this.recipe) {
            const need = Math.min(...this.kind.recipes.map(r => r.level));
            this.log(`Crafting ${Skills.level('crafting')} is too low for ${this.kindLabel} (needs ${need}) — stopping.`);
            ScriptRunner.stop();
            return;
        }
        this.log(`LeatherCrafter — ${this.kindLabel} -> ${this.recipe.label} (level ${this.recipe.level}, ${this.recipe.qty} per item)`);
    }

    // best = the highest-level item this Crafting level unlocks for the chosen leather
    private pickRecipe(): void {
        const level = Skills.level('crafting');
        const usable = this.kind.recipes.filter(r => r.level <= level).sort((a, b) => b.level - a.level);
        const next = usable[0] ?? null;
        if (next && next.label !== this.recipe?.label) {
            if (this.recipe) {
                this.log(`levelled up — switching to ${next.label}`);
            }
            this.recipe = next;
        }
    }

    async loop(): Promise<void> {
        this.pickRecipe();
        if (!this.recipe) {
            return;
        }

        if (invById(this.kind.leatherId) >= this.recipe.qty && invById(THREAD) > 0) {
            await this.craftLeg();
            return;
        }
        await this.bankLeg();
    }

    private async bankLeg(): Promise<void> {
        const here = Game.tile();
        if (!here || Math.max(Math.abs(here.x - BANK_STAND.x), Math.abs(here.z - BANK_STAND.z)) > 4) {
            this.setStatus('walking to the bank');
            if (!(await Traversal.walkResilient(BANK_STAND, { radius: 3, attempts: 2, timeoutMs: 45_000, log: m => this.log(`  ${m}`) }))) {
                return;
            }
        }

        this.setStatus('banking');
        if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => this.log(`  ${m}`)))) {
            this.log('could not open the bank — retrying');
            return;
        }

        await depositAllExceptIds(new Set([NEEDLE, THREAD, this.kind.leatherId]));

        if (invById(NEEDLE) === 0 && !(await withdrawXById(NEEDLE, 1))) {
            this.log('no needle in the bank — stopping.');
            ScriptRunner.stop();
            return;
        }
        if (invById(THREAD) < 5 && !(await withdrawXById(THREAD, this.threadStock))) {
            this.log('no thread in the bank — stopping.');
            ScriptRunner.stop();
            return;
        }

        const free = reader.inventorySize() - Inventory.used();
        if (!(await withdrawXById(this.kind.leatherId, free))) {
            this.log(`no ${this.kindLabel} left in the bank — stopping.`);
            ScriptRunner.stop();
            return;
        }

        actions.closeModal();
        await Execution.delayUntil(() => !Bank.isOpen(), 3000);
    }

    private async craftLeg(): Promise<void> {
        const recipe = this.recipe!;
        const needle = Inventory.items().find(i => i.id === NEEDLE);
        const leather = Inventory.items().find(i => i.id === this.kind.leatherId);
        if (!needle || !leather) {
            return;
        }

        const before = invById(this.kind.leatherId);
        this.setStatus(`making ${recipe.label}`);
        if (!(await needle.useOn(leather))) {
            return;
        }

        if (this.kind.flow === 'single') {
            // hardleather bodies are made one per use — no interface to drive
            await Execution.delayUntil(() => invById(this.kind.leatherId) < before, 5000);
        } else if (this.kind.flow === 'interface') {
            if (!(await Execution.delayUntil(() => reader.modals().main === LEATHER_IF, 5000))) {
                return;
            }
            actions.ifButton(recipe.make10 ?? recipe.make1!);
            await this.awaitCrafting(before);
        } else {
            if (!(await Execution.delayUntil(() => reader.modals().chat === MULTI3_IF, 5000))) {
                return;
            }
            actions.ifButton(MULTI3_MAKEX[recipe.slot!]);
            if (!(await Execution.delayUntil(() => reader.countDialogOpen(), 3000))) {
                return;
            }
            actions.answerCountDialog(Math.floor(before / recipe.qty));
            await this.awaitCrafting(before);
        }

        const used = before - invById(this.kind.leatherId);
        if (used > 0) {
            this.crafted += Math.floor(used / recipe.qty);
        }
    }

    // craft batches tick along item by item; stop waiting once the leather stops moving
    private async awaitCrafting(before: number): Promise<void> {
        let last = before;
        for (let idle = 0; idle < 8; idle++) {
            const settled = await Execution.delayUntil(() => invById(this.kind.leatherId) < last, 4000);
            const now = invById(this.kind.leatherId);
            if (now < this.recipe!.qty || invById(THREAD) === 0) {
                return;
            }
            if (!settled && now === last) {
                return;
            }
            last = now;
        }
    }

    private setStatus(s: string): void {
        this.status = s;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#b07d4a' });
        p.title(`Leather Crafter — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('crafting') - this.xpAtStart;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Made: ${this.crafted}`, `XP/hr: ${mins > 0.5 ? Math.round((xp / mins) * 60) : 0}`);
        p.row(`Item: ${this.recipe?.label ?? '-'}`, `Craft lvl: ${Skills.level('crafting')}`, `Thread: ${invById(THREAD)}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
