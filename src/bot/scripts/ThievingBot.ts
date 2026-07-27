import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Reachability } from '../api/Reachability.js';
import Tile from '../api/Tile.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Bank } from '../api/hud/Bank.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { SettingsStore } from '../runtime/Settings.js';
import { Skills } from '../api/hud/Skills.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { GroundItems } from '../api/queries/GroundItems.js';
import { Npcs } from '../api/queries/Npcs.js';
import { Traversal } from '../api/Traversal.js';
import { nearestBank } from '../api/BankLocations.js';
import { walkOpening } from '../api/walkOpening.js';
import { PICKPOCKET_TARGET_NAMES } from './PickpocketTargets.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { autoFoodBanking, countFood, foodMatches, safeToSteal, shouldRestockFood, THIEVER_BANKING_OPTIONS } from './ThievingBotLogic.js';

export const SETTINGS: SettingsSchema = {
    target: { type: 'string', default: 'Man', options: PICKPOCKET_TARGET_NAMES, label: 'Pickpocket target', help: 'pick by exact in-game name (level in parens): Man/Woman 1, Farmer 10, Rogue 32, Guard 40, Knight of Ardougne 55, Paladin 70, Hero 80' },
    action: { type: 'string', default: 'Pickpocket', label: 'Action', help: 'right-click op, e.g. Pickpocket / Steal-from' },
    food: { type: 'string', default: '', label: 'Food to eat (name contains)', help: 'eat this when HP drops from failed steals; Auto banking withdraws the first matching bank item' },
    eatAtHp: { type: 'number', default: 50, min: 0, max: 100, label: 'Eat below HP%' },
    banking: { type: 'string', default: 'None', options: THIEVER_BANKING_OPTIONS, label: 'Food banking', help: 'Auto = bank non-food items, withdraw food, and return to the starting spot' },
    foodWithdraw: { type: 'number', default: 10, min: 1, max: 27, label: 'Food to carry', showIf: { key: 'banking', anyOf: ['Auto'] } },
    bankAtFood: { type: 'number', default: 0, min: 0, max: 26, label: 'Bank at food remaining', showIf: { key: 'banking', anyOf: ['Auto'] } },
    dropMatch: { type: 'string', default: '', label: 'Drop when full (name contains)', help: 'drop these when the pack fills; blank = just idle when full (coins stack, so rarely fills)' },
    loot: { type: 'string', default: 'coins', label: 'Pick up from ground (name contains)', help: 'grab matching ground drops within the leash, e.g. coins; comma-separate for several; blank = pick up nothing' },
    obstacle: { type: 'string', default: 'door, gate', label: 'Openable obstacles (name contains)', help: 'when a target or the anchor is walled off, open the nearest of these that still has an Open action; comma-separate' },
    leashRadius: { type: 'number', default: 6, min: 2, max: 20, label: 'Leash radius (tiles)' }
};

function splitKeywords(raw: string): string[] {
    return raw
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);
}

export default class ThievingBot extends TaskBot {
    override loopDelay = 600;

    private anchor: Tile | null = null;
    private target = 'Man';
    private action = 'Pickpocket';
    private food = '';
    private eatAtHp = 0.5;
    private autoBank = false;
    private foodWithdraw = 10;
    private bankAtFood = 0;
    private dropMatch = '';
    private loot: string[] = ['coins'];
    private obstacle: string[] = ['door', 'gate'];
    private leash = 6;

    private steals = 0;
    private eats = 0;
    private picked = 0;
    private bankTrips = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.target = this.settings.str('target', 'Man');
        this.action = this.settings.str('action', 'Pickpocket');
        this.food = this.settings.str('food', '').toLowerCase();
        this.eatAtHp = this.settings.num('eatAtHp', 50) / 100;
        this.autoBank = autoFoodBanking(this.settings.str('banking', 'None'));
        this.foodWithdraw = this.settings.num('foodWithdraw', 10);
        this.bankAtFood = Math.min(this.settings.num('bankAtFood', 0), this.foodWithdraw - 1);
        this.dropMatch = this.settings.str('dropMatch', '').toLowerCase();
        this.loot = splitKeywords(this.settings.str('loot', 'coins'));
        this.obstacle = splitKeywords(this.settings.str('obstacle', 'door, gate'));
        this.leash = this.settings.num('leashRadius', 6);

        const here = Game.tile()!;
        this.anchor = new Tile(here.x, here.z, here.level);
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('thieving');
        if (this.autoBank && !this.food) {
            this.setStatus('Auto banking needs a food name — stopped');
            this.log('Auto food banking needs a non-blank food setting — stopping.');
            ScriptRunner.stop();
            return;
        }
        this.log(`thieving '${this.target}' (${this.action}) within ${this.leash} of ${this.anchor}${this.food ? `, eating *${this.food}* below ${Math.round(this.eatAtHp * 100)}% hp` : ''}, banking ${this.autoBank ? `at ${this.bankAtFood} food (target ${this.foodWithdraw})` : 'off'}`);

        this.on('chat.message', e => {
            if (/you (pick|steal|manage to steal)/i.test(e.text)) {
                this.steals++;
            }
        });

        this.add(new ContinueDialog(), new EatFood(this), new FoodBank(this), new WaitForHealth(this), new DropJunk(this), new Loot(this), new Steal(this), new ReturnToAnchor(this));
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#9be05b' });
        p.title(`ThievingBot — ${this.status}`);

        const mins = (Date.now() - this.startedAt) / 60_000;
        const xph = mins > 0.5 ? `${(((Skills.xp('thieving') - this.xpAtStart) / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Target: ${this.target}`, `XP/hr: ${xph}`);
        p.row(`Steals: ${this.steals}`, `Ate: ${this.eats}`, `Picked: ${this.picked}`);
        p.row(`Food: ${this.foodCount()}`, `Bank trips: ${this.bankTrips}`);
        p.bar('HP', Skills.hpFraction());

        p.gap();
        const picked = p.select('target', 'target', PICKPOCKET_TARGET_NAMES, this.target);
        if (picked && picked !== this.target) {
            this.switchTarget(picked);
        }
        ScriptRunner.paintControls(p);
        p.end();
    }

    private switchTarget(target: string): void {
        this.target = target;
        SettingsStore.save('Thiever', 'target', target);
        this.log(`pickpocket target switched to ${target} (from the paint)`);
    }

    setStatus(s: string): void {
        this.status = s;
    }
    getAnchor(): Tile {
        return this.anchor!;
    }
    leashRadius(): number {
        return this.leash;
    }
    targetName(): string {
        return this.target;
    }
    actionName(): string {
        return this.action;
    }
    foodKeyword(): string {
        return this.food;
    }
    eatGate(): number {
        return this.eatAtHp;
    }
    foodCount(): number {
        return countFood(Inventory.items(), this.food);
    }
    isFood(name: string | null): boolean {
        return foodMatches(name, this.food);
    }
    shouldBank(): boolean {
        const bankablePackFull = Inventory.isFull() && Inventory.items().some(item => !this.isFood(item.name));
        return shouldRestockFood(this.autoBank, this.foodCount(), this.bankAtFood, bankablePackFull);
    }
    foodTarget(): number {
        return this.foodWithdraw;
    }
    foodFloor(): number {
        return this.bankAtFood;
    }
    canSteal(): boolean {
        return safeToSteal(Skills.hpFraction(), this.eatAtHp, this.foodCount());
    }
    dropKeyword(): string {
        return this.dropMatch;
    }
    lootKeywords(): string[] {
        return this.loot;
    }
    obstacleList(): string[] {
        return this.obstacle;
    }
    countEat(): void {
        this.eats++;
    }
    countLoot(): void {
        this.picked++;
    }
    countBankTrip(): void {
        this.bankTrips++;
    }
    stopSafely(reason: string): void {
        this.setStatus(`${reason} — stopped`);
        this.log(`${reason} — stopping.`);
        ScriptRunner.stop();
    }
}

class EatFood implements Task {
    constructor(private bot: ThievingBot) {}
    private food() {
        return Inventory.items().find(i => this.bot.isFood(i.name)) ?? null;
    }
    validate(): boolean {
        return Skills.hpFraction() < this.bot.eatGate() && this.food() !== null;
    }
    async execute(): Promise<void> {
        const food = this.food();
        if (!food) {
            return;
        }
        this.bot.setStatus('eating');
        const before = Skills.effective('hitpoints');
        await food.interact('Eat');
        await Execution.delayUntil(() => Skills.effective('hitpoints') > before, 3000);
        this.bot.countEat();
    }
}

class FoodBank implements Task {
    constructor(private bot: ThievingBot) {}

    validate(): boolean {
        return !Game.inCombat() && this.bot.shouldBank();
    }

    async execute(): Promise<void> {
        const here = Game.tile();
        const bank = here ? nearestBank(here) : null;
        if (!bank) {
            this.bot.stopSafely('no usable bank from this location');
            return;
        }

        this.bot.setStatus(`banking for food at ${bank.name}`);
        this.bot.log(`food restock: ${this.bot.foodCount()}/${this.bot.foodTarget()} — walking to ${bank.name} ${bank.tile}`);
        if (!(await Traversal.walkResilient(bank.tile, { radius: 3, attempts: 4, timeoutMs: 180_000, log: message => this.bot.log(`  ${message}`) }))) {
            this.bot.stopSafely(`could not reach ${bank.name} bank`);
            return;
        }

        const access = bank.access ?? { name: 'Bank booth', op: 'Use-quickly' };
        if (!(await Bank.openNearestAccess(access, message => this.bot.log(`  ${message}`)))) {
            this.bot.stopSafely(`could not open ${bank.name} bank`);
            return;
        }

        await Bank.depositAllMatching(name => !this.bot.isFood(name), message => this.bot.log(`  ${message}`));
        await Execution.delayUntil(() => Bank.items().some(item => this.bot.isFood(item.name)), 3000);
        if (!Bank.items().some(item => this.bot.isFood(item.name))) {
            this.bot.stopSafely(`no '${this.bot.foodKeyword()}' food in the bank`);
            return;
        }

        for (let guard = 0; guard < this.bot.foodTarget() && this.bot.foodCount() < this.bot.foodTarget() && !Inventory.isFull(); guard++) {
            const bankFood = Bank.items().find(item => this.bot.isFood(item.name));
            if (!bankFood?.name) {
                break;
            }
            const before = this.bot.foodCount();
            if (!(await Bank.withdraw(bankFood.name, 'Withdraw-1'))) {
                await Execution.delayTicks(1);
                continue;
            }
            if (!(await Execution.delayUntil(() => this.bot.foodCount() > before, 2500))) {
                break;
            }
        }
        if (this.bot.foodCount() <= this.bot.foodFloor()) {
            this.bot.stopSafely(`only ${this.bot.foodCount()} '${this.bot.foodKeyword()}' food available`);
            return;
        }

        this.bot.countBankTrip();
        this.bot.log(`food restock complete: carrying ${this.bot.foodCount()} '${this.bot.foodKeyword()}' food`);
        this.bot.setStatus('returning from the bank');
        if (!(await Traversal.walkResilient(this.bot.getAnchor(), { radius: 2, attempts: 4, timeoutMs: 180_000, log: message => this.bot.log(`  ${message}`) }))) {
            this.bot.stopSafely('could not return to the pickpocket spot');
        }
    }
}

class WaitForHealth implements Task {
    private announced = false;

    constructor(private bot: ThievingBot) {}

    validate(): boolean {
        const waiting = !this.bot.canSteal();
        if (!waiting) {
            this.announced = false;
        }
        return waiting;
    }

    async execute(): Promise<void> {
        this.bot.setStatus('waiting for HP — no food');
        if (!this.announced) {
            this.announced = true;
            this.bot.log('HP is below the eat threshold with no food — waiting instead of risking death');
        }
        await Execution.delayTicks(5);
    }
}

class DropJunk implements Task {
    constructor(private bot: ThievingBot) {}
    private junk() {
        const kw = this.bot.dropKeyword();
        return kw ? Inventory.items().filter(i => i.name?.toLowerCase().includes(kw)) : [];
    }
    validate(): boolean {
        return Inventory.isFull() && this.junk().length > 0;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('dropping junk');
        for (let guard = 0; guard < 28; guard++) {
            const item = this.junk()[0];
            if (!item) {
                break;
            }
            const before = Inventory.used();
            await item.interact('Drop');
            await Execution.delayUntil(() => Inventory.used() < before, 3000);
        }
    }
}

class Loot implements Task {
    constructor(private bot: ThievingBot) {}

    private find() {
        const want = this.bot.lootKeywords();
        if (want.length === 0) {
            return null;
        }
        const anchor = this.bot.getAnchor();
        const within = this.bot.leashRadius();
        return GroundItems.query()
            .where(g => {
                const n = g.name?.toLowerCase();
                return n !== undefined && want.some(k => n.includes(k));
            })
            .where(g => g.tile().distanceTo(anchor) <= within && Reachability.canReach(g.tile()))
            .nearest();
    }

    validate(): boolean {
        return !Inventory.isFull() && this.find() !== null;
    }

    async execute(): Promise<void> {
        const drop = this.find();
        if (!drop) {
            return;
        }
        const name = drop.name ?? '';
        this.bot.setStatus(`picking up ${name}`);
        const before = Inventory.count(name);
        if (!(await drop.interact('Take'))) {
            await Execution.delayTicks(2);
            return;
        }
        if (await Execution.delayUntil(() => Inventory.count(name) > before, 3000)) {
            this.bot.countLoot();
        }
    }
}

class Steal implements Task {
    constructor(private bot: ThievingBot) {}

    private find() {
        const anchor = this.bot.getAnchor();
        const within = this.bot.leashRadius();
        return Npcs.query()
            .name(this.bot.targetName())
            .action(this.bot.actionName())
            .where(n => n.tile().distanceTo(anchor) <= within)
            .nearest();
    }

    validate(): boolean {
        return this.bot.canSteal() && !Inventory.isFull() && this.find() !== null;
    }

    async execute(): Promise<void> {
        const npc = this.find();
        if (!npc) {
            return;
        }
        if (!Reachability.canReach(npc.tile(), { adjacentOk: true })) {
            this.bot.setStatus(`clearing path to ${this.bot.targetName()}`);
            await walkOpening(npc.tile(), 1, this.bot.obstacleList(), m => this.bot.log(m));
            return;
        }
        this.bot.setStatus(`${this.bot.actionName()} ${this.bot.targetName()} at ${npc.tile()}`);
        const xpBefore = Skills.xp('thieving');
        const usedBefore = Inventory.used();
        if (!(await npc.interact(this.bot.actionName()))) {
            await Execution.delayTicks(2);
            return;
        }
        await Execution.delayUntil(
            () => Skills.xp('thieving') > xpBefore || Inventory.used() > usedBefore || ChatDialog.canContinue() || Skills.hpFraction() < this.bot.eatGate(),
            3000
        );
    }
}

class ReturnToAnchor implements Task {
    constructor(private bot: ThievingBot) {}
    validate(): boolean {
        const here = Game.tile();
        return here !== null && this.bot.getAnchor().distanceTo(here) > this.bot.leashRadius() + 4;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('returning to anchor');
        await walkOpening(this.bot.getAnchor(), 2, this.bot.obstacleList(), m => this.bot.log(m));
    }
}
