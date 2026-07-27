import { actions, reader, type WorldTile } from '../adapter/ClientAdapter.js';
import { depositAllExcept } from '../api/Banking.js';
import { LoopingBot } from '../api/Bot.js';
import { EventSignal } from '../api/EventSignal.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Reachability } from '../api/Reachability.js';
import Tile from '../api/Tile.js';
import { Traversal } from '../api/Traversal.js';
import { Bank } from '../api/hud/Bank.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { Skills } from '../api/hud/Skills.js';
import { fmtDuration } from '../api/hud/paintLogic.js';
import { GameMessages } from '../events/gameMessages.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import type { SettingsSchema } from '../runtime/Settings.js';

const TINDERBOX = 'Tinderbox';
const CANT_LIGHT = /can't light a fire here/i;

// neither of these is a throughput knob. START_MS is "did the click reach the
// server"; LIGHT_MS has to outlast the roll tail, and the roll only becomes a
// certainty at Firemaking 43 — at level 1 it is 65/256 every 4 ticks, so 90s of
// rolls is the difference between a one-in-a-hundred false stall and a
// one-in-a-hundred-thousand one
const START_MS = 2_400;
const LIGHT_MS = 90_000;

// a burn lane is a west-running strip of ground with nothing on it: lighting a
// fire drops the log at your feet and teleports you one square west, and a tile
// already carrying scenery (or someone else's fire) refuses loc_add. Plots are
// the longest such strips at each bank, read off the client's collision map and
// location list.
interface Plot {
    bank: Tile;
    x0: number;
    x1: number;
    z0: number;
    z1: number;
}

export const FIRE_SPOTS: Record<string, Plot> = {
    'Varrock East': { bank: new Tile(3253, 3420, 0), x0: 3232, x1: 3284, z0: 3428, z1: 3430 },
    'Varrock West': { bank: new Tile(3185, 3440, 0), x0: 3168, x1: 3209, z0: 3428, z1: 3431 },
    Draynor: { bank: new Tile(3093, 3243, 0), x0: 3072, x1: 3097, z0: 3247, z1: 3249 },
    Seers: { bank: new Tile(2725, 3491, 0), x0: 2695, x1: 2733, z0: 3484, z1: 3485 }
};

export const LOG_LEVELS: Record<string, number> = {
    Logs: 1,
    'Oak logs': 15,
    'Willow logs': 30,
    'Maple logs': 45,
    'Yew logs': 60,
    'Magic logs': 75
};

export const FIREMAKER_SETTINGS: SettingsSchema = {
    logType: { type: 'string', default: 'Logs', options: Object.keys(LOG_LEVELS), label: 'What to burn' },
    location: { type: 'string', default: 'Varrock East', options: Object.keys(FIRE_SPOTS), label: 'Where to burn', help: 'each spot is a bank plus the longest clear west-running ground next to it' }
};

// the server gates fires 4 ticks apart, so a human-sized pause between clicks
// costs no xp at all as long as it lands inside that window
function reactionMs(): number {
    return 180 + Math.random() * 420;
}

export default class Firemaker extends LoopingBot {
    override loopDelay = 600;

    private plot: Plot = FIRE_SPOTS['Varrock East'];
    private spotName = 'Varrock East';
    private logName = 'Logs';

    private lane = 0;
    private fires = 0;
    private trips = 0;
    private xpStart = 0;
    private status = 'starting';
    private startedAt = Date.now();

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);

        this.spotName = this.settings.str('location', 'Varrock East');
        this.plot = FIRE_SPOTS[this.spotName];
        this.logName = this.settings.str('logType', 'Logs');
        this.xpStart = Skills.xp('firemaking');
        this.startedAt = Date.now();

        const need = LOG_LEVELS[this.logName];
        const have = Skills.level('firemaking');
        if (!this.plot || need === undefined) {
            this.log(`unknown setting — logType='${this.logName}', location='${this.spotName}' — stopping.`);
            ScriptRunner.stop();
            return;
        }
        if (have < need) {
            this.log(`${this.logName} need Firemaking ${need}, you have ${have} — stopping.`);
            ScriptRunner.stop();
            return;
        }
        this.log(`Firemaker — ${this.logName} at ${this.spotName}, plot x${this.plot.x0}-${this.plot.x1} z${this.plot.z0}-${this.plot.z1}`);
    }

    async loop(): Promise<void> {
        if (!(await this.bankLeg())) {
            return;
        }
        await this.burnLeg();
        this.trips++;
    }

    private setStatus(s: string): void {
        this.status = s;
    }

    private logsLeft(): number {
        return Inventory.count(this.logName);
    }

    private async walkTo(dest: WorldTile, what: string, radius: number): Promise<boolean> {
        this.setStatus(`walking to ${what}`);
        // generous: the first bank leg can be a cross-map web-walk from wherever
        // the script was started
        return Traversal.walkResilient(dest, { radius, attempts: 3, timeoutMs: 120_000, log: m => this.log(`  ${m}`) });
    }

    private async bankLeg(): Promise<boolean> {
        const here = Game.tile();
        if (here && Math.max(Math.abs(here.x - this.plot.bank.x), Math.abs(here.z - this.plot.bank.z)) > 4 && !(await this.walkTo(this.plot.bank, `the ${this.spotName} bank`, 2))) {
            return false;
        }
        this.setStatus('banking');
        if (!(await Bank.openNearest('Bank booth', 'Use-quickly', m => this.log(`  ${m}`)))) {
            this.log('could not open the bank — retrying');
            return false;
        }

        await Bank.depositAllMatching(depositAllExcept([TINDERBOX]));
        if (Inventory.count(TINDERBOX) === 0) {
            await Bank.withdraw(TINDERBOX);
            if (!(await Execution.delayUntil(() => Inventory.count(TINDERBOX) > 0, 3000))) {
                this.log('no tinderbox in the bank or pack — stopping.');
                ScriptRunner.stop();
                return false;
            }
        }
        if (!(await Bank.withdrawX(this.logName, reader.inventorySize() - Inventory.used()))) {
            this.log(`no ${this.logName} left in the bank — stopping.`);
            ScriptRunner.stop();
            return false;
        }

        actions.closeModal();
        await Execution.delayUntil(() => !Bank.isOpen(), 3000);
        return this.logsLeft() > 0;
    }

    // how many fires a lane starting on this tile yields before it runs into
    // scenery, a live fire or a wall
    private runWest(from: WorldTile, occupied: Set<string>, cap: number): number {
        let n = 0;
        let cur: WorldTile = from;
        while (n < cap) {
            if (cur.x < this.plot.x0 || occupied.has(`${cur.x},${cur.z}`) || !Reachability.walkable(cur)) {
                break;
            }
            n++;
            const next = { x: cur.x - 1, z: cur.z, level: cur.level };
            if (!Reachability.canStep(cur, next)) {
                break;
            }
            cur = next;
        }
        return n;
    }

    // every tile carrying a loc — scenery or a live fire — refuses loc_add
    private occupied(): Set<string> {
        return new Set(reader.locs().map(l => `${l.tile.x},${l.tile.z}`));
    }

    // the shortest walk to a lane that can absorb the whole remaining load; a
    // fire burns for 100-200 ticks, so rows we just used score themselves out
    private findLane(want: number): { start: Tile; run: number } | null {
        const occupied = this.occupied();
        const here = Game.tile();
        if (!here) {
            return null;
        }
        let best: { start: Tile; run: number; d: number } | null = null;
        for (let z = this.plot.z0; z <= this.plot.z1; z++) {
            for (let x = this.plot.x0; x <= this.plot.x1; x++) {
                const start = new Tile(x, z, this.plot.bank.level);
                const run = this.runWest(start, occupied, want);
                if (run === 0) {
                    continue;
                }
                const d = Math.max(Math.abs(x - here.x), Math.abs(z - here.z));
                if (!best || run > best.run || (run === best.run && d < best.d)) {
                    best = { start, run, d };
                }
            }
        }
        return best ? { start: best.start, run: best.run } : null;
    }

    private async gotoLane(): Promise<boolean> {
        for (let attempt = 0; attempt < 3; attempt++) {
            const want = this.logsLeft();
            const found = this.findLane(want);
            if (!found) {
                this.log(`no clear ground left in the ${this.spotName} plot — waiting for fires to burn out`);
                this.setStatus('waiting for a clear lane');
                await Execution.delayTicks(25);
                continue;
            }
            this.setStatus(`walking to lane ${found.start.x},${found.start.z} (${found.run} long)`);
            await this.walkTo(found.start, `lane ${found.start.x},${found.start.z}`, 0);

            // re-measured from where we actually stopped, so a walk that ends a
            // tile short burns the right number of logs instead of overrunning —
            // and a walk that ended somewhere else entirely burns nothing
            const at = Game.tile();
            const inPlot = at !== null && at.x >= this.plot.x0 && at.x <= this.plot.x1 && at.z >= this.plot.z0 && at.z <= this.plot.z1;
            this.lane = inPlot ? this.runWest(at!, this.occupied(), want) : 0;
            if (this.lane > 0) {
                this.log(`lane ${at!.x},${at!.z} west x${this.lane} (wanted ${found.run} at ${found.start.x},${found.start.z})`);
                return true;
            }
            this.log(`stopped at ${at?.x},${at?.z}, which is ${inPlot ? 'not lightable' : 'outside the plot'} — rescanning`);
        }
        return false;
    }

    private async lightOne(): Promise<'lit' | 'blocked' | 'stalled'> {
        const logs = Inventory.first(this.logName);
        const tinder = Inventory.first(TINDERBOX);
        if (!logs || !tinder) {
            return 'stalled';
        }
        const mark = GameMessages.mark();
        const xp = Skills.xp('firemaking');
        const held = this.logsLeft();
        const lit = (): boolean => Skills.xp('firemaking') > xp;
        const blocked = (): boolean => GameMessages.sawSince(mark, CANT_LIGHT);

        await logs.useOn(tinder);
        // the engine drops the log at your feet the moment a click clears its
        // checks, which is the only signal that arrives on every path: a failed
        // roll animates silently, so waiting on chat text would call a slow
        // low-level burn a dead click
        if (!(await Execution.delayUntil(() => this.logsLeft() < held || blocked(), START_MS))) {
            return 'stalled';
        }
        if (!(await Execution.delayUntil(() => lit() || blocked() || EventSignal.pending(), LIGHT_MS))) {
            return 'stalled';
        }
        return blocked() ? 'blocked' : lit() ? 'lit' : 'stalled';
    }

    private async burnLeg(): Promise<void> {
        let stalls = 0;
        while (this.logsLeft() > 0) {
            if (EventSignal.pending()) {
                return;
            }
            if (this.lane <= 0 && !(await this.gotoLane())) {
                return;
            }
            this.setStatus(`burning ${this.logsLeft()} ${this.logName} (lane ${this.lane})`);
            const outcome = await this.lightOne();
            if (outcome === 'lit') {
                this.fires++;
                this.lane--;
                stalls = 0;
                await Execution.delay(reactionMs());
                continue;
            }
            // the lane is gone (scenery, a bank zone or another player's fire):
            // rescan rather than retry the same tile
            this.lane = 0;
            if (outcome === 'blocked') {
                continue;
            }
            if (++stalls >= 3) {
                this.log('three lighting attempts went unanswered — rescanning from the bank');
                return;
            }
        }
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: '#e07a3f' });
        p.title(`Firemaker — ${this.status}`);
        const mins = (Date.now() - this.startedAt) / 60_000;
        const xp = Skills.xp('firemaking') - this.xpStart;
        p.row(`Runtime: ${fmtDuration(mins)}`, `Fires: ${this.fires}`, `Trips: ${this.trips}`);
        p.row(`Xp: ${xp}`, `Xp/hr: ${mins > 0.5 ? Math.round((xp / mins) * 60) : 0}`, `Logs: ${this.logsLeft()}`);
        p.gap();
        ScriptRunner.paintControls(p);
        p.end();
    }
}
