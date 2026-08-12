import { reader } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/core/Execution.js';
import { Game } from '../../api/core/Game.js';
import { Reach } from '../../nav/Reach.js';
import { Traversal } from '../../nav/Traversal.js';
import { ChatDialog } from '../../api/hud/ChatDialog.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Modals } from '../../api/hud/Modals.js';
import { Npcs, type Npc } from '../../api/entities/Npcs.js';
import { GameMessages } from '../../events/gameMessages.js';
import { driveUntil } from '../exec/prompts.js';
import {
    BARBARIAN_GUARD_ID,
    BARCRAWL_CARD,
    BAR_PREFER,
    BARS,
    COINS,
    GATE_IS_OPEN,
    GUARD_PREFER,
    GUARD_TILE,
    TOO_DRUNK,
    nextBar,
    parseCard,
    type Bar,
    type BarcrawlProgress
} from './BarcrawlLogic.js';

/**
 * Read the card. The scroll is a **main** modal built with `if_settext`, so no
 * dialogue driver can see it and every other modal read comes back empty while
 * it is up — it has to be closed again, exactly like a quest journal.
 */
export async function readCard(log?: (m: string) => void): Promise<BarcrawlProgress | null> {
    const card = Inventory.first(BARCRAWL_CARD);
    if (!card) {
        return null;
    }
    const before = reader.modals().main;
    const mark = GameMessages.mark();
    if (!(await card.interact('Read'))) {
        log?.('the card refused its Read op');
        return null;
    }
    // The modal id arrives in `if_openmain`; each line of the scroll arrives in
    // its own `if_settext`, and component text persists in the interface list
    // between modals. Sampling on the tick the id changes therefore reads an
    // empty scroll — or the previous read's. Settle a tick, then wait for text
    // that actually parses as the card rather than for the id alone.
    const idChanged = await Execution.delayUntil(() => {
        const main = reader.modals().main;
        return main !== -1 && main !== before;
    }, 5000);
    let parsed: BarcrawlProgress | null = null;
    if (idChanged) {
        await Execution.delayTicks(1);
        await Execution.delayUntil(() => parseCard(reader.mainModalTexts()) !== null, 5000);
        parsed = parseCard(reader.mainModalTexts());
        await Modals.closeIfOpen();
    }
    if (parsed) {
        return parsed;
    }
    // `opheld1,barcrawl_card` stops opening the scroll once every bar is
    // signed — "You are too drunk to be able to read the barcrawl card" is
    // the *finished* state, not a failed read, and taking it for a failure
    // leaves the tour looping at the tenth bar forever.
    if (GameMessages.sawSince(mark, TOO_DRUNK)) {
        return { remaining: [], done: true };
    }
    log?.(idChanged
        ? 'the card scroll opened but never rendered a parseable line'
        : 'the card scroll never opened, and no "too drunk" message came back');
    return null;
}

/** Every bartender in the game renders "Bartender", so they are found by id. */
const byId = (id: number): Npc | null => Npcs.query().where(n => n.id === id).nearest();

/**
 * One bar. `[opnpcu,<bartender>]` takes the card straight to the barcrawl
 * branch, which skips the four-option menu the talk op puts up and behaves the
 * same at every one of the ten.
 */
async function drinkAt(bar: Bar, log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(bar.tile, { radius: 3, attempts: 3, timeoutMs: 300_000, log }))) {
        log(`could not reach the ${bar.line} bartender`);
        return false;
    }
    await Execution.delayTicks(2);
    const npc = byId(bar.id);
    const card = Inventory.first(BARCRAWL_CARD);
    if (!npc || !card) {
        log(`no bartender ${bar.id} or no card at the ${bar.line}`);
        return false;
    }
    const beforeCoins = Inventory.count(COINS);
    if (!(await card.useOn(npc))) {
        return false;
    }
    // Nine of the ten go straight into the drink; the Rising Sun's barmaid
    // still offers her ale list first, so the barcrawl line has to be in the
    // preference list or her menu sits unanswered and the card never signs.
    //
    // The coin deduction is what says the drink was actually bought — the card
    // only turns green several `p_delay`s later, so the read is retried rather
    // than taken once.
    await driveUntil(() => Inventory.count(COINS) < beforeCoins, BAR_PREFER, log, 20_000);
    for (let attempt = 0; attempt < 3; attempt++) {
        await Execution.delayTicks(5);
        const after = await readCard(m => log(`  read ${attempt + 1}/3: ${m}`));
        if (after !== null && !after.remaining.some(b => b.line === bar.line)) {
            log(`signed at the ${bar.line}`);
            return true;
        }
    }
    log(`the ${bar.line} did not sign the card`);
    return false;
}

/** Reported once per pass, so a caller's paint tracks the tour rather than the pass. */
export type Progress = (signed: number, total: number) => void;

/** Consecutive bars that answer nothing before the tour is called broken. */
const GIVE_UP = 3;

/**
 * Drive the whole crawl. Returns once the card is fully signed; the guard still
 * has to be told, which {@link handInBarcrawl} does.
 */
export async function runBarcrawl(log: (m: string) => void, onProgress?: Progress): Promise<boolean> {
    let missed = 0;
    for (let pass = 0; pass < BARS.length * 2; pass++) {
        const progress = await readCard(m => log(`  ${m}`));
        if (!progress) {
            log(Inventory.count(BARCRAWL_CARD) === 0
                ? 'no barcrawl card in the pack to read'
                : 'holding a barcrawl card but could not read it — stopping rather than re-walking the tour');
            return false;
        }
        onProgress?.(BARS.length - progress.remaining.length, BARS.length);
        if (progress.done) {
            log('barcrawl card fully signed');
            return true;
        }
        const next = nextBar(progress.remaining, Game.tile());
        if (!next) {
            return true;
        }
        log(`barcrawl: ${progress.remaining.length} bars left, heading for the ${next.line}`);
        // One bar that will not answer is not a reason to walk the whole tour
        // again from the top — the next pass re-reads the card and re-sorts, so
        // the loop moves on and comes back to it.
        missed = (await drinkAt(next, log)) ? 0 : missed + 1;
        if (missed >= GIVE_UP) {
            log(`${missed} bars in a row refused the card — stopping`);
            return false;
        }
    }
    return (await readCard())?.done ?? false;
}

async function talkToGuard(log: (m: string) => void): Promise<boolean> {
    if (!(await Traversal.walkResilient(GUARD_TILE, { radius: 4, attempts: 3, timeoutMs: 300_000, log }))) {
        log('could not reach the outpost gate guard');
        return false;
    }
    await Execution.delayTicks(2);
    // By id, not by display name: the outpost's other "Barbarian guard" is the
    // attackable one, and the gate loc runs the same conversation, so a talk
    // aimed by name can land on either.
    if (!byId(BARBARIAN_GUARD_ID)) {
        log('no barbarian guard at the outpost gate');
        return false;
    }
    const status = await Reach.entityOp({
        find: () => byId(BARBARIAN_GUARD_ID),
        op: 'Talk-to',
        expect: () => ChatDialog.isOpen() || ChatDialog.canContinue(),
        what: 'Barbarian guard',
        log
    });
    return status === 'done';
}

/**
 * Give the signed card to the gate guard. `outpost_guard_progress` consumes it
 * and sets `%barcrawl` to complete, which is what actually opens the gate.
 */
export async function handInBarcrawl(log: (m: string) => void): Promise<boolean> {
    if (!(await talkToGuard(log))) {
        return false;
    }
    await driveUntil(() => Inventory.count(BARCRAWL_CARD) === 0, [], log, 20_000);
    return Inventory.count(BARCRAWL_CARD) === 0;
}

export type GuardVerdict = 'complete' | 'issued' | 'retry';

/**
 * Ask the gate guard where the crawl stands, which is the only oracle there is:
 * `%barcrawl` is not on the wire, and an empty pack looks the same before the
 * card is issued as after it is handed in.
 *
 * `outpost_guard_talk` branches on the varp — "Oi, whaddya want?" for not
 * started, "'Ello friend." for complete, "So, how's the Barcrawl coming along?"
 * for anything between, and that last branch re-issues a lost card.
 *
 * **The greeting is the verdict, not the empty pack.** A random event landing
 * mid-conversation abandons the option chain, and reading "no card came out" as
 * "already done" sends the bot at a gate that will not open, for good. Only
 * "'Ello friend." means finished.
 */
export async function askGuard(log: (m: string) => void): Promise<GuardVerdict> {
    if (!(await talkToGuard(log))) {
        log('the outpost guard never opened a dialogue');
        return 'retry';
    }
    const greeting = ChatDialog.texts().join(' / ');
    log(`guard opens with: ${greeting || '(nothing)'}`);
    if (GATE_IS_OPEN.test(greeting)) {
        return 'complete';
    }
    // Drive to the card, not to the end of the conversation: the branch that
    // issues one is three menus deep, and stopping at the first lull leaves the
    // choice on screen with the tour un-started.
    await driveUntil(() => Inventory.count(BARCRAWL_CARD) > 0, GUARD_PREFER, log, 25_000);
    const held = Inventory.count(BARCRAWL_CARD);
    log(`guard done — card in pack: ${held}`);
    return held > 0 ? 'issued' : 'retry';
}

/**
 * Everything between "no barcrawl" and a gate that opens. Returns true when the
 * guard will let the character through, whether that took the whole tour or the
 * account had already done it.
 */
export async function ensureBarcrawl(log: (m: string) => void, onProgress?: Progress): Promise<boolean> {
    if (Inventory.count(BARCRAWL_CARD) === 0) {
        const verdict = await askGuard(log);
        if (verdict === 'complete') {
            log('the guard waves us through — the barcrawl is already done');
            return true;
        }
        if (verdict === 'retry') {
            // Not "already done": the conversation was cut short, most often by a
            // random event. Fail so the caller walks back and asks again.
            log('the guard handed over no card and did not wave us through — retrying');
            return false;
        }
    }
    if (!(await runBarcrawl(log, onProgress))) {
        return false;
    }
    return handInBarcrawl(log);
}
