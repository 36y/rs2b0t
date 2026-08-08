import { LoopingBot } from '../api/Bot.js';
import { Execution } from '../api/Execution.js';
import { Game } from '../api/Game.js';
import { Bank } from '../api/hud/Bank.js';
import { Inventory } from '../api/hud/Inventory.js';
import { Paint } from '../api/hud/Paint.js';
import { ScriptRunner } from '../runtime/ScriptRunner.js';
import { openBankLeg } from '../quests/exec/steps.js';
import { BARCRAWL_CARD, BARCRAWL_GP, BARS, COINS } from '../barcrawl/BarcrawlLogic.js';
import { ensureBarcrawl, readCard } from '../barcrawl/RunBarcrawl.js';
import { Modals } from '../api/hud/Modals.js';

/**
 * Alfred Grimhand's Barcrawl, standalone.
 *
 * The tour is a miniquest of its own — it is what opens the Barbarian Outpost
 * gate and gates Barbarian Training — so it is runnable on its own as well as
 * from Horror from the Deep, which calls the same driver in
 * {@link ../barcrawl/RunBarcrawl.js}.
 */
export default class Barcrawl extends LoopingBot {
    override loopDelay = 600;

    private status = 'starting';
    private signed = 0;
    private failures = 0;

    override async onStart(): Promise<void> {
        await Execution.delayUntil(() => Game.ingame() && Game.tile() !== null, 0);
        this.log(`Barcrawl — ${BARS.length} bars, about ${BARCRAWL_GP}gp of drinks`);
    }

    override async loop(): Promise<number | void> {
        if (!Game.ingame()) {
            return 1200;
        }
        await this.refreshSigned();

        // Coins before the walk, not at the tenth bar: the tour crosses the
        // whole map and the bars that cost the most are the ones furthest from
        // a booth.
        if (Inventory.count(COINS) < BARCRAWL_GP && !(await this.topUpCoins())) {
            this.status = 'out of coins';
            ScriptRunner.stop('not enough coins for the tour and none in the bank');
            return;
        }

        this.status = 'touring';
        if (await ensureBarcrawl(m => this.log(m), signed => { this.signed = signed; })) {
            this.status = 'complete';
            ScriptRunner.stop('barcrawl complete — the outpost gate will open');
            return;
        }

        // `ensureBarcrawl` returns false for a cut-short conversation as well as
        // a broken tour, and the first is ordinary — a random event is enough.
        // Retry a few times before giving up on it.
        if (++this.failures >= 3) {
            this.status = 'gave up';
            ScriptRunner.stop('the barcrawl made no progress in three passes');
            return;
        }
        this.log(`barcrawl pass failed (${this.failures}/3) — retrying`);
        return 3000;
    }

    /** How many lines are green, for the paint. Silent when there is no card. */
    private async refreshSigned(): Promise<void> {
        if (Inventory.count(BARCRAWL_CARD) === 0) {
            return;
        }
        const progress = await readCard();
        if (progress) {
            this.signed = BARS.length - progress.remaining.length;
        }
    }

    private async topUpCoins(): Promise<boolean> {
        this.status = 'banking';
        if (!(await openBankLeg('barcrawl: no known bank', undefined, m => this.log(m)))) {
            return false;
        }
        await Bank.setNoteMode(false);
        // Four tours' worth: the walk back to a booth costs more than the coins.
        await Bank.withdrawX(COINS, BARCRAWL_GP * 4);
        await Modals.close();
        return Inventory.count(COINS) >= BARCRAWL_GP;
    }

    override onPaint(ctx: CanvasRenderingContext2D): void {
        const p = Paint.begin(ctx, { dock: 'chatbox', accent: this.status === 'complete' ? '#9be05b' : '#6cb6ff' });
        p.title(`Barcrawl — ${this.status}`);
        p.bar('Bars signed', this.signed / BARS.length, '#6cb6ff');
        p.row(`Signed: ${this.signed}/${BARS.length}`, `Coins: ${Inventory.count(COINS)}`);
        ScriptRunner.paintControls(p);
        p.end();
    }
}
