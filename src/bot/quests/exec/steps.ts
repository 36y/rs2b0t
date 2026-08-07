import type { WorldTile } from '../../adapter/ClientAdapter.js';
import { Execution } from '../../api/Execution.js';
import { Game } from '../../api/Game.js';
import Tile from '../../api/Tile.js';
import { Bank } from '../../api/hud/Bank.js';
import { Equipment } from '../../api/hud/Equipment.js';
import { Inventory } from '../../api/hud/Inventory.js';
import { Modals } from '../../api/hud/Modals.js';
import { Shop } from '../../api/hud/Shop.js';
import { bankDistance, nearestBanks } from '../../api/BankLocations.js';
import { Navigator } from '../../nav/Navigator.js';
import { GroundItems } from '../../api/queries/GroundItems.js';
import { Locs } from '../../api/queries/Locs.js';
import { Npcs } from '../../api/queries/Npcs.js';
import { Traversal } from '../../api/Traversal.js';
import { QUEST_ROCK_TYPES, ROCK_TYPES } from '../../api/MiningRocks.js';
import type { QuestStep } from '../engine/types.js';
import { gotoNpc, talkThrough, type LadderHop } from './primitives.js';

const BANK_NAME = 'Bank booth';
const BANK_OP = 'Use-quickly';

/** How deep into the straight-line shortlist to look before giving up. */
const BANK_CANDIDATES = 6;

/**
 * The nearest bank by the walk, not by the crow.
 *
 * From the Lumbridge respawn the three closest banks by air — Al Kharid, Shantay
 * Pass and the Duel Arena — are all behind the same 10gp toll gate, and the
 * navigator prunes a fare it cannot pay. So to a bot that has just died, every
 * bank it can see is one it cannot reach, and the first it can walk to is only
 * third on the list. Ask the navigator for real path costs instead.
 */
async function reachableBank(from: WorldTile, log: (m: string) => void): Promise<Tile | undefined> {
    const candidates = nearestBanks(from).slice(0, BANK_CANDIDATES);
    let best: { tile: Tile; cost: number } | null = null;
    for (const bank of candidates) {
        // Stop once a known route beats the next candidate's crow-flight. On open
        // ground that is exact, since a walk is never shorter than the line it
        // covers; a ladder or a ship can beat it, so this can settle for a bank
        // that is not quite the cheapest. It can never settle for an unreachable
        // one — nothing breaks the loop until a path has already been found — and
        // it keeps the common case to one or two pathfinds instead of six.
        if (best !== null && bankDistance(from, bank.tile) >= best.cost) {
            break;
        }
        const path = await Navigator.findPath(from, bank.tile);
        if (path.ok && (best === null || path.cost < best.cost)) {
            best = { tile: bank.tile, cost: path.cost };
        }
    }
    if (best) {
        return best.tile;
    }
    log(`no bank answered a path from (${from.x},${from.z}) — trying the closest anyway`);
    return candidates[0]?.tile;
}

export async function openBankLeg(noBankMsg: string, override: Tile | undefined, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    const bankTile = override ?? (here ? await reachableBank(here, log) : undefined);
    if (!bankTile) {
        log(noBankMsg);
        return false;
    }
    if (!(await Traversal.walkResilient(bankTile, { radius: 3, attempts: 6, timeoutMs: 300_000, log }))) {
        return false;
    }
    return Bank.openNearest(BANK_NAME, BANK_OP, log);
}

async function ensureAt(anchor: Tile, radius: number, log: (m: string) => void): Promise<boolean> {
    const here = Game.tile();
    if (here && anchor.distanceTo(here) <= radius) {
        return true;
    }
    return Traversal.walkResilient(anchor, { radius, attempts: 3, timeoutMs: 90_000, log });
}

export async function executeStep(step: QuestStep, hops: LadderHop[], log: (m: string) => void): Promise<boolean> {
    switch (step.kind) {
        case 'talk': {
            if (!(await gotoNpc(step.stop, hops, log))) {
                return false;
            }
            return talkThrough(step.stop.npc, step.stop.prefer, log);
        }
        case 'grabGround': {
            const before = Inventory.count(step.item);
            const g = GroundItems.query().name(step.item).within(12).nearest();
            if (!g) {
                const arrived = await ensureAt(step.anchor, 2, log);
                if (arrived && step.waitIfMissing) {
                    await Execution.delayTicks(2);
                    return false;
                }
                return arrived;
            }
            if (!(await g.interact('Take'))) {
                return false;
            }
            return Execution.delayUntil(() => Inventory.count(step.item) > before, 8000);
        }
        case 'pickLoc': {
            const before = Inventory.count(step.item);
            const loc = Locs.query().name(step.loc).action(step.op).within(10).nearest();
            if (!loc) {
                return ensureAt(step.anchor, 2, log);
            }
            if (!(await loc.interact(step.op))) {
                return false;
            }
            return Execution.delayUntil(() => Inventory.count(step.item) > before, 8000);
        }
        case 'interactLoc': {
            const loc = Locs.query().name(step.loc).action(step.op).within(10).nearest();
            if (!loc) {
                return ensureAt(step.anchor, 2, log);
            }
            if (!(await loc.interact(step.op))) {
                return false;
            }
            if (step.expectItem !== undefined) {
                const item = step.expectItem;
                return Execution.delayUntil(() => Inventory.contains(item), 8000);
            }
            await Execution.delayTicks(3);
            return true;
        }
        case 'useOn': {
            if (step.targetKind === 'item') {
                const held = Inventory.first(step.item);
                if (!held) {
                    log(`useOn: no '${step.item}' in the pack`);
                    return false;
                }
                const targetItem = Inventory.first(step.target);
                if (!targetItem) {
                    log(`useOn: no '${step.target}' in the pack`);
                    return false;
                }
                const beforeProduct = step.product !== undefined ? Inventory.count(step.product) : 0;
                if (!(await held.useOn(targetItem))) {
                    return false;
                }
                if (step.product !== undefined) {
                    const product = step.product;
                    return Execution.delayUntil(() => Inventory.count(product) > beforeProduct, 10_000);
                }
                await Execution.delayTicks(3);
                return true;
            }
            if (!(await ensureAt(step.anchor, 4, log))) {
                return false;
            }
            const held = Inventory.first(step.item);
            if (!held) {
                log(`useOn: no '${step.item}' in the pack`);
                return false;
            }
            const target = step.targetKind === 'npc'
                ? Npcs.query().name(step.target).within(10).nearest()
                : Locs.query().name(step.target).within(10).nearest();
            if (!target) {
                log(`useOn: no '${step.target}' near the anchor`);
                return false;
            }
            const beforeProduct = step.product !== undefined ? Inventory.count(step.product) : 0;
            if (!(await held.useOn(target))) {
                return false;
            }
            if (step.product !== undefined) {
                const product = step.product;
                return Execution.delayUntil(() => Inventory.count(product) > beforeProduct, 10_000);
            }
            await Execution.delayTicks(3);
            return true;
        }
        case 'equip':
            return Equipment.equip(step.item);
        case 'scanBank':
            return openBankLeg('scanBank: no known bank', step.bank, log);
        case 'withdraw': {
            if (!(await openBankLeg('withdraw: no known bank', step.bank, log))) {
                return false;
            }
            let ok = true;
            for (const it of step.items) {
                const withdrawn = it.id === undefined
                    ? await Bank.withdrawX(it.name, it.qty)
                    : await Bank.withdrawXById(it.id, it.qty);
                if (!withdrawn) {
                    const exact = it.id === undefined ? '' : ` (id ${it.id})`;
                    log(`withdraw: '${it.name}'${exact} x${it.qty} failed`);
                    ok = false;
                }
            }
            if (!step.leaveOpen) {
                await Modals.close();
            }
            return ok;
        }
        case 'deposit': {
            if (!(await openBankLeg('deposit: no known bank', step.bank, log))) {
                return false;
            }
            const keepIds = new Set(step.keepIds ?? []);
            const kept = (name: string, id: number): boolean => {
                if (keepIds.has(id)) {
                    return true;
                }
                const n = name.toLowerCase();
                return step.keep.some(k => step.exactKeep ? n === k.toLowerCase() : n.includes(k.toLowerCase()));
            };
            await Bank.depositAllMatching((name, id) => !kept(name, id));
            if (!step.leaveOpen) {
                await Modals.close();
            }
            return true;
        }
        case 'buy': {
            const before = Inventory.count(step.item);
            if (Inventory.count('Coins') < step.estGp) {
                if (!(await openBankLeg('buy: no known bank for coins', undefined, log))) {
                    return false;
                }
                await Bank.withdrawX('Coins', step.estGp);
                await Modals.close();
                if (Inventory.count('Coins') < step.estGp) {
                    log(`buy: bank could not cover ${step.estGp} gp for ${step.item}`);
                    return false;
                }
            }
            if (!(await ensureAt(step.shop.anchor, 3, log))) {
                return false;
            }
            if (!(await Shop.open(step.shop.npc))) {
                log(`buy: could not open ${step.shop.npc}'s shop near the anchor`);
                return false;
            }
            await Shop.buy(step.item, step.qty);
            await Shop.close();
            return Inventory.count(step.item) > before;
        }
        case 'mineRock': {
            const before = Inventory.count(step.item);
            const rockType = step.rock.replace(/ ore$/i, '');
            const rockIds = ROCK_TYPES[rockType] ?? QUEST_ROCK_TYPES[rockType];
            if (!rockIds) {
                log(`mineRock: no rock-id mapping for '${rockType}'`);
                return false;
            }
            const idSet = new Set(rockIds);
            const rock = Locs.query().where(l => idSet.has(l.id)).action('Mine').within(10).nearest();
            if (!rock) {
                return ensureAt(step.anchor, 3, log);
            }
            if (!(await rock.interact('Mine'))) {
                return false;
            }
            return Execution.delayUntil(() => Inventory.count(step.item) > before, 20_000);
        }
        case 'custom':
            return step.run(log);
        case 'wait':
            await Execution.delayTicks(2);
            return true;
        case 'done':
            return true;
    }
}
