import { actions, reader } from '../adapter/ClientAdapter.js';
import { TaskBot, type Task } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { ContinueDialog } from '../api/tasks/ContinueDialog.js';
import { Bank } from '../api/hud/Bank.js';
import { ChatDialog } from '../api/hud/ChatDialog.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { foodCount as foodCountIn, FOOD_OPTIONS, foodForms } from '../api/combat/food.js';
import { Locs, type Loc } from '../api/queries/Locs.js';
import { Npcs } from '../api/queries/Npcs.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';
import {
    ARDY_BANK,
    ARENA_ENTRANCE,
    ARENA_VARP,
    CENTRE_PLATFORM,
    DEFAULT_BANK_TICKETS,
    DEFAULT_FOOD_PER_TRIP,
    EAT_AT_HP,
    LADDER_DOWN_STAND,
    PILLARS,
    SPIKE_PLATFORMS,
    TICKET_NAME,
    canStartObstacle,
    coinsNeeded,
    coinsToWithdraw,
    edgeBetween,
    hasPaid,
    inArena,
    inArenaPit,
    needsCoinsRestock,
    nextHop,
    obstacleOutcome,
    onArenaPlatform,
    onBrimhavenSurface,
    pathPlatforms,
    pillarFromHint,
    pillarTagged,
    platformAt,
    shouldBank,
    shouldEat,
    waitPlatform,
    wantRunForGoal,
    type ArenaEdge
} from './BrimhavenAgilityLogic.js';

export const BRIMHAVEN_AGILITY_SETTINGS: SettingsSchema = {
    food: {
        type: 'string',
        default: 'Lobster',
        options: FOOD_OPTIONS,
        label: 'Food',
        help: 'withdrawn at Ardougne south bank; eaten below 5 HP (damage scales with current HP)'
    },
    foodWithdraw: {
        type: 'number',
        default: DEFAULT_FOOD_PER_TRIP,
        min: 1,
        max: 27,
        label: 'Food per trip',
        help: 'default 25 leaves one slot for the coin stack (26 used)'
    },
    bankAtTickets: {
        type: 'number',
        default: DEFAULT_BANK_TICKETS,
        min: 1,
        max: 5000,
        label: 'Bank at X tickets',
        help: 'also banks when out of food'
    }
};

export default class BrimhavenAgility extends TaskBot {
    // One server tick between loops so the next hop can start the tick we go idle.
    override loopDelay = 600;
    override loopCadence = { kind: 'server-tick' as const, ticks: 1 };

    private foodName = 'Lobster';
    private foodPerTrip = DEFAULT_FOOD_PER_TRIP;
    private bankAtTickets = DEFAULT_BANK_TICKETS;

    private tickets = 0;
    private tags = 0;
    private status = 'starting';
    private startedAt = Date.now();
    private xpAtStart = 0;
    private spikeToggle = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.foodName = this.settings.str('food', 'Lobster');
        this.foodPerTrip = this.settings.num('foodWithdraw', DEFAULT_FOOD_PER_TRIP);
        this.bankAtTickets = this.settings.num('bankAtTickets', DEFAULT_BANK_TICKETS);
        this.startedAt = Date.now();
        this.xpAtStart = Skills.xp('agility');
        this.tickets = Inventory.count(TICKET_NAME);

        this.log(
            `BrimhavenAgility — food '${this.foodName}' x${this.foodPerTrip}, bank@${this.bankAtTickets} tickets, eat@${EAT_AT_HP}hp`
        );

        this.add(
            new ContinueDialog(),
            new Eat(this),
            new ClimbOutOfPit(this),
            new BankTrip(this),
            new TravelToArena(this),
            new EnterArena(this),
            new TagPillar(this),
            new CrossObstacle(this),
            new SpikeWait(this)
        );
    }

    setStatus(s: string): void {
        this.status = s;
    }

    cfg() {
        return {
            food: this.foodName,
            foodPerTrip: this.foodPerTrip,
            bankAtTickets: this.bankAtTickets
        };
    }

    foodInPack(): number {
        return foodCountIn(Inventory.items(), this.foodName);
    }

    ticketCount(): number {
        return Inventory.count(TICKET_NAME);
    }

    coinCount(): number {
        return Inventory.count('Coins');
    }

    agility(): number {
        return Skills.level('agility');
    }

    hp(): number {
        return Skills.effective('hitpoints');
    }

    paid(): boolean {
        return hasPaid(reader.varp(ARENA_VARP));
    }

    tagged(): boolean {
        return pillarTagged(reader.varp(ARENA_VARP));
    }

    here(): Tile | null {
        const t = Game.tile();
        return t ? new Tile(t.x, t.z, t.level) : null;
    }

    platform(): number {
        const t = this.here();
        // Only snap to pillars on the real platform plane — the fall pit shares
        // x/z with pillars but has no Rope swing / ledge locs (stuck loop).
        if (!t || !onArenaPlatform(t.level) || !inArena(t.level, t.z)) {
            return -1;
        }
        return platformAt(t.x, t.z);
    }

    inPitNow(): boolean {
        const t = this.here();
        return t !== null && inArenaPit(t.level, t.z);
    }

    /** Active ticket pillar from the client hint arrow. */
    targetPillar(): number {
        const h = reader.hintTile();
        if (!h) {
            return -1;
        }
        return pillarFromHint(h.x, h.z);
    }

    inArenaNow(): boolean {
        const t = this.here();
        return t !== null && inArena(t.level, t.z);
    }

    countTag(): void {
        this.tags++;
        this.tickets = this.ticketCount();
    }

    nextSpikePlatform(): number {
        const cur = this.platform();
        if (cur === SPIKE_PLATFORMS[0]) {
            return SPIKE_PLATFORMS[1];
        }
        if (cur === SPIKE_PLATFORMS[1]) {
            return SPIKE_PLATFORMS[0];
        }
        return SPIKE_PLATFORMS[this.spikeToggle++ % 2];
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#3bb0b0' });
        p.title(`Brimhaven — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('agility') - this.xpAtStart;
        const xph = mins > 0.5 ? `${((xp / mins) * 60 / 1000).toFixed(1)}k` : '—';
        p.row(`Runtime: ${fmtDuration(mins)}`, `Tags: ${this.tags}`, `XP/hr: ${xph}`);
        p.row(`Tickets: ${this.ticketCount()}`, `Food: ${this.foodInPack()}`, `HP: ${this.hp()}`);
        p.row(`Agility: ${this.agility()}`, `Platform: ${this.platform()}`, `Target: ${this.targetPillar()}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}

class Eat implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        return shouldEat(this.bot.hp(), this.bot.foodInPack());
    }
    async execute(): Promise<void> {
        const { food } = this.bot.cfg();
        const item = Inventory.items().find(i => foodForms(food).includes((i.name ?? '').toLowerCase()));
        if (!item) {
            return;
        }
        this.bot.setStatus(`eating ${item.name} (${this.bot.hp()} hp)`);
        const before = Inventory.used();
        await item.interact('Eat');
        await Execution.delayUntil(() => Inventory.used() < before || this.bot.hp() >= EAT_AT_HP, 3000);
    }
}

class BankTrip implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        if (this.bot.inArenaNow()) {
            // leave the arena first when banking is needed
            return shouldBank(this.bot.ticketCount(), this.bot.foodInPack(), this.bot.cfg().bankAtTickets);
        }
        const here = this.bot.here();
        const atBrim = here !== null && onBrimhavenSurface(here.x, here.z, here.level);
        // Do not top up food to foodPerTrip while already on Brimhaven — that
        // alone would ship you back to Ardy after eating a single lobster.
        const needFood =
            this.bot.foodInPack() <= 0 ||
            (!atBrim && this.bot.foodInPack() < this.bot.cfg().foodPerTrip);
        return (
            shouldBank(this.bot.ticketCount(), this.bot.foodInPack(), this.bot.cfg().bankAtTickets) ||
            needFood ||
            needsCoinsRestock(this.bot.coinCount(), this.bot.paid(), atBrim)
        );
    }
    async execute(): Promise<void> {
        const { food, foodPerTrip, bankAtTickets } = this.bot.cfg();

        if (this.bot.inArenaNow()) {
            this.bot.setStatus('leaving arena to bank');
            await leaveArena(this.bot);
            return;
        }

        this.bot.setStatus('banking at Ardougne south');
        if (!(await Traversal.walkResilient(new Tile(ARDY_BANK.x, ARDY_BANK.z, 0), { radius: 3, attempts: 3, timeoutMs: 180_000, log: m => this.bot.log(`  ${m}`) }))) {
            this.bot.log('could not reach Ardougne south bank');
            return;
        }
        if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => this.bot.log(`  ${m}`)))) {
            this.bot.log('could not open the bank');
            return;
        }

        const keep = new Set(['coins', ...foodForms(food)]);
        await Bank.depositAllMatching(name => !keep.has(name.toLowerCase()));

        // Always fund a full mainland→Brimhaven round-trip when stocking.
        const needCoins = coinsNeeded(this.bot.paid(), false);
        const withdrawCoins = coinsToWithdraw(this.bot.paid(), this.bot.coinCount());
        if (Bank.count('Coins') < withdrawCoins && this.bot.coinCount() < needCoins) {
            await Bank.close();
            this.bot.log(`not enough coins in the bank (need ${needCoins} for boats${this.bot.paid() ? '' : ' + entrance'}). Stopping.`);
            ScriptRunner.stop();
            return;
        }
        if (withdrawCoins > 0) {
            await Bank.withdrawX('Coins', withdrawCoins);
        }

        if (Bank.count(food) < 1 && this.bot.foodInPack() < 1) {
            await Bank.close();
            this.bot.log(`out of ${food} in the bank. Stopping.`);
            ScriptRunner.stop();
            return;
        }
        const have = this.bot.foodInPack();
        if (have < foodPerTrip) {
            await Bank.withdrawX(food, foodPerTrip - have);
        }

        await Bank.close();
        this.bot.log(`restocked: ${this.bot.foodInPack()} ${food}, ${this.bot.coinCount()} coins, ${this.bot.ticketCount()} tickets banked (threshold ${bankAtTickets})`);
    }
}

class TravelToArena implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        if (this.bot.inArenaNow()) {
            return false;
        }
        if (shouldBank(this.bot.ticketCount(), this.bot.foodInPack(), this.bot.cfg().bankAtTickets)) {
            return false;
        }
        const here = this.bot.here();
        if (!here) {
            return false;
        }
        const atBrim = onBrimhavenSurface(here.x, here.z, here.level);
        // still need food + coins for remaining legs (not full trip if already on Brimhaven)
        if (this.bot.foodInPack() < 1 || needsCoinsRestock(this.bot.coinCount(), this.bot.paid(), atBrim)) {
            return false;
        }
        const nearEntrance = Math.max(Math.abs(here.x - ARENA_ENTRANCE.x), Math.abs(here.z - ARENA_ENTRANCE.z)) <= 8 && here.level === 0;
        return !nearEntrance;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('walking to Brimhaven arena');
        // web-walk uses the Ardougne↔Brimhaven ship special when needed
        if (!(await Traversal.walkResilient(new Tile(ARENA_ENTRANCE.x, ARENA_ENTRANCE.z, 0), { radius: 4, attempts: 4, timeoutMs: 300_000, log: m => this.bot.log(`  ${m}`) }))) {
            this.bot.log('could not reach the arena entrance');
        }
    }
}

class EnterArena implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        if (this.bot.inArenaNow()) {
            return false;
        }
        // On Brimhaven the outbound boat is already paid — only need return + entrance.
        if (this.bot.foodInPack() < 1 || needsCoinsRestock(this.bot.coinCount(), this.bot.paid(), true)) {
            return false;
        }
        const here = this.bot.here();
        if (!here) {
            return false;
        }
        return Math.max(Math.abs(here.x - ARENA_ENTRANCE.x), Math.abs(here.z - ARENA_ENTRANCE.z)) <= 12 && here.level === 0;
    }
    async execute(): Promise<void> {
        if (!this.bot.paid()) {
            this.bot.setStatus("paying Cap'n Izzy");
            const clerk =
                Npcs.query().name("Cap'n Izzy No-Beard").within(10).nearest() ??
                Npcs.query()
                    .within(10)
                    .where(n => /izzy|no-beard|cap'?n/i.test(n.name ?? ''))
                    .nearest();
            if (!clerk) {
                this.bot.log("Cap'n Izzy not nearby — walking to entrance");
                await Traversal.walkResilient(new Tile(LADDER_DOWN_STAND.x, LADDER_DOWN_STAND.z, 0), {
                    radius: 2,
                    attempts: 2,
                    timeoutMs: 30_000
                });
                return;
            }
            const before = this.bot.coinCount();
            // op3 = Pay (instant 200gp when unpaid); Talk-to otherwise
            if (clerk.actions().some(a => a.toLowerCase() === 'pay')) {
                await clerk.interact('Pay');
            } else {
                await clerk.interact('Talk-to');
                for (let i = 0; i < 10; i++) {
                    if (this.bot.paid() || this.bot.coinCount() < before) {
                        break;
                    }
                    if (ChatDialog.canContinue()) {
                        await ChatDialog.continue();
                    } else if (ChatDialog.options().length > 0) {
                        if (
                            !(await ChatDialog.chooseOption('use the Agility Arena')) &&
                            !(await ChatDialog.chooseOption("Okay, here's 200"))
                        ) {
                            await ChatDialog.chooseOption();
                        }
                    } else {
                        break;
                    }
                    await Execution.delayTicks(1);
                }
            }
            await Execution.delayUntil(() => this.bot.paid() || this.bot.coinCount() < before, 5000);
            if (!this.bot.paid() && this.bot.coinCount() >= before) {
                this.bot.log('payment did not register — retrying');
                return;
            }
            this.bot.log('paid 200 coins entrance');
        }

        this.bot.setStatus('climbing into the arena');
        await Traversal.walkResilient(new Tile(LADDER_DOWN_STAND.x, LADDER_DOWN_STAND.z, 0), {
            radius: 2,
            attempts: 2,
            timeoutMs: 20_000
        });
        const ladder =
            Locs.query().name('Ladder').action('Climb-Down').within(6).nearest() ??
            Locs.query()
                .name('Ladder')
                .within(6)
                .where(l => l.actions().some(a => /climb-down/i.test(a)))
                .nearest();
        if (!ladder) {
            this.bot.log('no ladder down at the entrance');
            return;
        }
        await ladder.interact(ladder.actions().find(a => /climb-down/i.test(a)) ?? 'Climb-Down');
        await Execution.delayUntil(() => this.bot.inArenaNow(), 8000);
    }
}

/** After a failed obstacle the player lands on plane 0 under the arena. */
class ClimbOutOfPit implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        return this.bot.inPitNow();
    }
    async execute(): Promise<void> {
        this.bot.setStatus('climbing out of the pit');
        const rope =
            Locs.query().name('Climbing rope').within(20).nearest() ??
            Locs.query()
                .within(20)
                .where(l => /climbing rope/i.test(l.name ?? ''))
                .nearest();
        if (!rope) {
            this.bot.log('fallen into the pit but no Climbing rope in range — waiting');
            await Execution.delayTicks(2);
            return;
        }
        const op = rope.actions().find(a => /climb/i.test(a)) ?? rope.actions()[0];
        if (!op) {
            this.bot.log(`Climbing rope at ${rope.tile().x},${rope.tile().z} has no climb op`);
            return;
        }
        this.bot.log(`climbing rope at ${rope.tile().x},${rope.tile().z} (${op})`);
        if (!(await rope.interact(op))) {
            this.bot.log('Climbing rope interact failed');
            return;
        }
        // Wait until back on the platform plane and idle so the next hop can fire immediately.
        if (!(await Execution.delayUntil(() => !this.bot.inPitNow() && !Game.animating(), 8000))) {
            this.bot.log('still in the pit after climbing rope');
        }
    }
}

class TagPillar implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        if (!this.bot.inArenaNow() || this.bot.inPitNow() || this.bot.tagged()) {
            return false;
        }
        const target = this.bot.targetPillar();
        const here = this.bot.platform();
        return target >= 0 && here === target && target < 24;
    }
    async execute(): Promise<void> {
        this.bot.setStatus('tagging ticket dispenser');
        const ticketsBefore = this.bot.ticketCount();
        const taggedBefore = this.bot.tagged();
        const dispenser =
            Locs.query().name('Ticket Dispenser').within(6).nearest() ??
            Locs.query()
                .within(6)
                .where(l => /ticket/i.test(l.name ?? '') && l.actions().some(a => /tag/i.test(a)))
                .nearest();
        if (!dispenser) {
            this.bot.log(`no Ticket Dispenser on platform ${this.bot.platform()}`);
            return;
        }
        const op = dispenser.actions().find(a => /tag/i.test(a)) ?? 'Tag';
        await dispenser.interact(op);
        // first tag shows a mesbox; subsequent give a ticket + objbox
        await Execution.delayUntil(
            () =>
                this.bot.tagged() !== taggedBefore ||
                this.bot.ticketCount() > ticketsBefore ||
                reader.modals().chat !== -1 ||
                reader.modals().main !== -1,
            5000
        );
        // clear mesbox/objbox so ContinueDialog/next task can run
        for (let i = 0; i < 4 && (ChatDialog.canContinue() || reader.modals().main !== -1); i++) {
            if (ChatDialog.canContinue()) {
                await ChatDialog.continue();
            } else {
                break;
            }
            await Execution.delayTicks(1);
        }
        if (this.bot.ticketCount() > ticketsBefore || this.bot.tagged()) {
            this.bot.countTag();
            this.bot.log(`tagged pillar ${this.bot.platform()} (tickets ${this.bot.ticketCount()})`);
        }
    }
}

class CrossObstacle implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        if (!this.bot.inArenaNow() || this.bot.inPitNow()) {
            return false;
        }
        if (!canStartObstacle(Game.animating(), false)) {
            return false;
        }
        if (shouldBank(this.bot.ticketCount(), this.bot.foodInPack(), this.bot.cfg().bankAtTickets)) {
            return false;
        }
        const here = this.bot.platform();
        if (here < 0) {
            return false;
        }
        const target = this.bot.targetPillar();
        // path to the active pillar unless already tagged and waiting
        if (this.bot.tagged() || target < 0) {
            const wait = waitPlatform(this.bot.agility(), here);
            return here !== wait && pathPlatforms(here, wait, this.bot.agility()) !== null;
        }
        return here !== target && nextHop(here, target, this.bot.agility()) !== null;
    }
    async execute(): Promise<void> {
        const here = this.bot.platform();
        const target = this.bot.targetPillar();
        const chasingTag = !this.bot.tagged() && target >= 0;
        const goal = chasingTag ? target : waitPlatform(this.bot.agility(), here);
        const hop = nextHop(here, goal, this.bot.agility());
        if (hop === null) {
            this.bot.log(`no path from platform ${here} to ${goal} at agility ${this.bot.agility()}`);
            return;
        }
        const edge = edgeBetween(here, hop, this.bot.agility());
        if (!edge) {
            this.bot.log(`no usable edge ${here}->${hop}`);
            return;
        }
        this.bot.log(`crossing ${edge.kind} ${here}→${hop} (goal ${goal})`);
        this.bot.setStatus(`crossing ${edge.kind} ${here}→${hop}`);
        await ensureRun(wantRunForGoal(chasingTag));
        await crossEdge(this.bot, edge, here, hop);
    }
}

class SpikeWait implements Task {
    constructor(private bot: BrimhavenAgility) {}
    validate(): boolean {
        if (!this.bot.inArenaNow() || this.bot.inPitNow()) {
            return false;
        }
        if (shouldBank(this.bot.ticketCount(), this.bot.foodInPack(), this.bot.cfg().bankAtTickets)) {
            return false;
        }
        // only idle-grind while the current pillar is already tagged (or no hint yet)
        if (!this.bot.tagged() && this.bot.targetPillar() >= 0 && this.bot.platform() !== this.bot.targetPillar()) {
            return false;
        }
        if (this.bot.agility() < 20) {
            // park near centre without grinding spikes
            return this.bot.platform() === CENTRE_PLATFORM || this.bot.platform() < 0;
        }
        const p = this.bot.platform();
        return p === SPIKE_PLATFORMS[0] || p === SPIKE_PLATFORMS[1];
    }
    async execute(): Promise<void> {
        if (this.bot.agility() < 20) {
            this.bot.setStatus('waiting for next pillar');
            await Execution.delayTicks(1);
            return;
        }
        if (!canStartObstacle(Game.animating(), false)) {
            return;
        }
        // already tagged this round — keep jumping spikes for XP until the arrow moves
        if (!this.bot.tagged() && this.bot.targetPillar() === this.bot.platform()) {
            // should tag first
            return;
        }
        // Spikes / centre wait: walk to save energy for the next pillar chase.
        await ensureRun(false);
        const dest = this.bot.nextSpikePlatform();
        const here = this.bot.platform();
        if (here < 0) {
            return;
        }
        const edge = edgeBetween(here, dest, this.bot.agility());
        if (!edge) {
            // walk onto the other spike platform via path
            const hop = nextHop(here, dest, this.bot.agility());
            if (hop !== null) {
                const e = edgeBetween(here, hop, this.bot.agility());
                if (e) {
                    this.bot.setStatus(`to spikes via ${e.kind}`);
                    await crossEdge(this.bot, e, here, hop);
                }
            }
            return;
        }
        this.bot.setStatus('spike grind');
        await crossEdge(this.bot, edge, here, dest);
    }
}

async function leaveArena(bot: BrimhavenAgility): Promise<void> {
    // climb rope / ladder up from the pit if fallen, then the exit ladder
    if (bot.inPitNow()) {
        const rope = Locs.query().name('Climbing rope').within(20).nearest();
        if (rope) {
            bot.setStatus('climbing rope out of the pit');
            const op = rope.actions().find(a => /climb/i.test(a)) ?? 'Climb';
            await rope.interact(op);
            await Execution.delayUntil(() => !bot.inPitNow() && !Game.animating(), 6000);
        }
    }
    // exit ladder at local 53,54-ish — ladderup near SE of map
    const exit = Locs.query().name('Ladder').action('Climb-up').within(40).nearest()
        ?? Locs.query().name('Ladder').within(40).where(l => l.actions().some(a => /climb-up/i.test(a))).nearest();
    if (!exit) {
        // path toward platform 4 / SE where the exit ladder sits after climb dest 53,54
        const here = bot.platform();
        // ladder up is near platform area 20/SE — walk graph toward platform 4 then search
        if (here >= 0) {
            const hop = nextHop(here, 4, bot.agility()) ?? nextHop(here, 14, bot.agility());
            if (hop !== null) {
                const e = edgeBetween(here, hop, bot.agility());
                if (e) {
                    await crossEdge(bot, e, here, hop);
                }
            }
        }
        return;
    }
    bot.setStatus('climbing out of the arena');
    // may need to path across platforms first if far
    const dest = exit.tile();
    const destPlat = platformAt(dest.x, dest.z, 12);
    const here = bot.platform();
    if (here >= 0 && destPlat >= 0 && here !== destPlat) {
        const hop = nextHop(here, destPlat, bot.agility());
        if (hop !== null) {
            const e = edgeBetween(here, hop, bot.agility());
            if (e) {
                await crossEdge(bot, e, here, hop);
                return;
            }
        }
    }
    await exit.interact(exit.actions().find(a => /climb-up/i.test(a)) ?? 'Climb-up');
    await Execution.delayUntil(() => !bot.inArenaNow(), 8000);
}

/**
 * Override the global runAuto threshold: run while chasing a ticket pillar,
 * walk while returning to centre / grinding spikes (saves energy for the next tag).
 */
async function ensureRun(want: boolean): Promise<void> {
    if (Game.runEnabled() === want) {
        return;
    }
    actions.setRun(want);
    await Execution.delayUntil(() => Game.runEnabled() === want, 1200);
}

/**
 * Wait until the hop is done enough to act again.
 * - success: on dest (anim residual OK)
 * - pit fall
 * - partial progress onto another platform
 * - soft fail: engaged then idle back on start (saws/pressure bounce)
 * Also ends after a few idle ticks on start so we never sit out the full timeout.
 */
async function waitObstacleSettled(bot: BrimhavenAgility, from: number, to: number, timeoutMs: number): Promise<void> {
    let leftStart = false;
    let idleTicks = 0;
    let animStreak = 0;
    let lastTile = bot.here();
    const startPillar = PILLARS[from];
    const start = performance.now();

    while (performance.now() - start < timeoutMs) {
        const platform = bot.platform();
        const anim = Game.animating();
        const pit = bot.inPitNow();
        const tile = bot.here();
        const moved =
            !!tile &&
            !!lastTile &&
            (tile.x !== lastTile.x || tile.z !== lastTile.z || tile.level !== lastTile.level);
        // Walk traps keep platform===from until near the dest — only treat as
        // "left" when we actually leave the start island, fall, or sustain anim
        // (ignore 1-frame click flashes that would false-fail before the hop starts).
        const distFromStart =
            tile && startPillar
                ? Math.max(Math.abs(tile.x - startPillar.x), Math.abs(tile.z - startPillar.z))
                : 0;
        animStreak = anim ? animStreak + 1 : 0;
        if (pit || distFromStart > 4 || (platform >= 0 && platform !== from) || animStreak >= 2) {
            leftStart = true;
        }

        const outcome = obstacleOutcome(platform, from, to, pit, anim);
        if (outcome === 'arrived' || outcome === 'fallen' || outcome === 'elsewhere') {
            bot.log(
                `  settled ${outcome} platform ${platform} (from ${from}, want ${to}) anim=${anim} pit=${pit}`
            );
            return;
        }

        if (!anim && !moved) {
            idleTicks++;
        } else {
            idleTicks = 0;
        }
        // Soft fail / stuck mid-trap: after a real leave, a few idle ticks without
        // arriving means bounce or stall — retry now (not a 8–12s hang).
        if (leftStart && idleTicks >= 3) {
            bot.log(
                `  settled failed (stalled after leave) platform ${platform} distStart=${distFromStart} (from ${from}, want ${to})`
            );
            return;
        }
        // Click/walk never took — retry without sitting out the full timeout.
        if (!leftStart && platform === from && idleTicks >= 6) {
            bot.log(`  settled failed (never left start) platform ${platform} (from ${from}, want ${to})`);
            return;
        }

        lastTile = tile ?? lastTile;
        await Execution.delayTicks(1);
    }
    bot.log(
        `  settled timeout platform ${bot.platform()} (from ${from}, want ${to}) anim=${Game.animating()} pit=${bot.inPitNow()}`
    );
}

async function crossEdge(bot: BrimhavenAgility, edge: ArenaEdge, from: number, to: number): Promise<void> {
    const dest = PILLARS[to];

    if (edge.mode === 'walk') {
        // traps fire on zone entry. Use the client pathfinder (not the overworld
        // collision pack) so island→island steps stay in the arena scene.
        const local = reader.toLocal(dest.x, dest.z);
        if (!local) {
            bot.log(`  dest ${dest.x},${dest.z} not in scene`);
            return;
        }
        if (!actions.walkTo(local.lx, local.lz)) {
            bot.log(`  walkTo(${local.lx},${local.lz}) refused`);
            return;
        }
        await waitObstacleSettled(bot, from, to, 8_000);
        return;
    }

    const loc = findEdgeLoc(edge, from, to);
    if (!loc) {
        bot.log(`no ${edge.locName ?? edge.kind} loc for edge ${from}->${to}`);
        return;
    }
    const op =
        edge.op && loc.actions().some(a => a.toLowerCase() === edge.op!.toLowerCase())
            ? loc.actions().find(a => a.toLowerCase() === edge.op!.toLowerCase())!
            : loc.actions()[0];
    if (!op) {
        bot.log(`${edge.locName} has no actions at ${loc.tile().x},${loc.tile().z}`);
        return;
    }
    // Stand on the from-platform side of the loc (rope swings reject the wrong side).
    // Skip approach when already on the from platform — residual post-hop walks waste ticks.
    const lt = loc.tile();
    const here0 = bot.here();
    const distToLoc =
        here0 === null ? 99 : Math.max(Math.abs(here0.x - lt.x), Math.abs(here0.z - lt.z));
    const onFrom = bot.platform() === from;
    if (distToLoc > 3 && !onFrom) {
        const approach = {
            x: lt.x + Math.sign(PILLARS[from].x - lt.x) * 2,
            z: lt.z + Math.sign(PILLARS[from].z - lt.z) * 2
        };
        if (approach.x !== lt.x || approach.z !== lt.z) {
            const al = reader.toLocal(approach.x, approach.z);
            if (al) {
                bot.log(`  approach ${approach.x},${approach.z}`);
                actions.walkTo(al.lx, al.lz);
                await Execution.delayUntil(() => {
                    const t = bot.here();
                    return t !== null && Math.max(Math.abs(t.x - approach.x), Math.abs(t.z - approach.z)) <= 1;
                }, 4000);
            }
        }
    }

    bot.log(`  ${op} ${edge.locName} @ ${lt.x},${lt.z}`);
    // Click immediately (even mid residual anim). Re-click while still on start
    // until the obstacle engages — no long dead wait after rope/pillar/monkey.
    for (let attempt = 0; attempt < 5; attempt++) {
        if (bot.inPitNow() || bot.platform() === to) {
            break;
        }
        if (bot.platform() >= 0 && bot.platform() !== from) {
            break;
        }
        const live = findEdgeLoc(edge, from, to) ?? loc;
        if (!(await live.interact(op))) {
            bot.log(`  interact failed (attempt ${attempt + 1})`);
        }
        const started = await Execution.delayUntil(
            () =>
                Game.animating()
                || bot.platform() === to
                || bot.inPitNow()
                || (bot.platform() >= 0 && bot.platform() !== from),
            700
        );
        if (started || Game.animating() || bot.platform() !== from) {
            break;
        }
        await Execution.delayTicks(1);
    }
    await waitObstacleSettled(bot, from, to, 10_000);
}

function findEdgeLoc(edge: ArenaEdge, from: number, to: number): Loc | null {
    if (!edge.locName) {
        return null;
    }
    const a = PILLARS[from];
    const b = PILLARS[to];
    const midX = (a.x + b.x) / 2;
    const midZ = (a.z + b.z) / 2;
    // Prefer the from-side candidate so rope swings face the right way.
    const candidates = Locs.query()
        .name(edge.locName)
        .within(16)
        .where(l => l.actions().length > 0)
        .results();
    if (candidates.length === 0) {
        return Locs.query().name(edge.locName).within(16).nearest();
    }
    let best: Loc | null = null;
    let bestScore = Infinity;
    for (const loc of candidates) {
        const t = loc.tile();
        const midD = Math.hypot(t.x - midX, t.z - midZ);
        const fromD = Math.hypot(t.x - a.x, t.z - a.z);
        const score = midD + fromD * 0.25;
        if (score < bestScore) {
            bestScore = score;
            best = loc;
        }
    }
    return best;
}

