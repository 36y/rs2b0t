import Tile from '../api/core/Tile.js';
import type { WorldTile } from '../adapter/ClientAdapter.js';
import { shouldEatToUseFood } from '../api/combat/food.js';

/**
 * Pure decisions for HillGiant, kept out of the game-touching bot so the pit
 * spot spread, the key/food trip requirements and the loot rules can be tested
 * without a client.
 */

export const BRASS_KEY = 'Brass key';
export const BIG_BONES = 'Big bones';
export const LIMPWURT = 'Limpwurt root';

/**
 * Stand tiles spread across the Edgeville dungeon giant pit. Several bots on one
 * world otherwise pile onto the same corner and starve each other of spawns, so
 * a trip picks one at random.
 */
export const PIT_SPOTS: WorldTile[] = [
    new Tile(3110, 9832, 0),
    new Tile(3117, 9835, 0),
    new Tile(3103, 9836, 0),
    new Tile(3113, 9841, 0),
    new Tile(3120, 9843, 0),
    new Tile(3107, 9845, 0)
];

/** Pick a pit spot from `rand` in [0,1). Kept injectable so tests are exact. */
export function pickSpot(rand: number, spots: WorldTile[] = PIT_SPOTS): WorldTile {
    if (spots.length === 0) {
        throw new Error('no pit spots configured');
    }
    const clamped = Number.isFinite(rand) ? Math.min(Math.max(rand, 0), 0.999999) : 0;
    return spots[Math.floor(clamped * spots.length)];
}

export interface TripNeeds {
    key: boolean;
    food: number;
}

/**
 * What a trip must leave the bank with. The key is only needed when it is not
 * already carried — it is never dropped, so one is enough forever.
 */
export function tripNeeds(carryingKey: boolean, foodInPack: number, foodPerTrip: number): TripNeeds {
    return { key: !carryingKey, food: Math.max(0, foodPerTrip - foodInPack) };
}

export interface BankDecision {
    freeSlots: number;
    foodInPack: number;
    lootSlotsTarget: number;
    usedLootSlots: number;
    /** Current hitpoints (effective). */
    hp: number;
    /** Max hitpoints (base level). */
    maxHp: number;
    /** Heal of one of the configured food (e.g. lobster = 12). */
    heal: number;
}

/**
 * Leave for the bank when:
 * - loot target is hit, or
 * - pack is full with no food left to free a slot, or
 * - out of food and HP is in the smart-eat band (a full heal would fit, or the
 *   safety floor) — fighting on with an empty pack is how the bot used to die.
 *
 * Example: lobster (12), 40/53 HP, 0 food → bank (40+12 still under max; full heal fits).
 */
export function shouldBank(d: BankDecision): boolean {
    if (d.usedLootSlots >= d.lootSlotsTarget) {
        return true;
    }
    if (d.freeSlots === 0 && d.foodInPack === 0) {
        return true;
    }
    // Out of food and we would eat if we had any — go restock before death.
    if (d.foodInPack === 0) {
        return shouldEatToUseFood({
            hp: d.hp,
            maxHp: d.maxHp,
            heal: d.heal,
            foodCount: 1
        });
    }
    return false;
}

/**
 * Eating for space is only worth it while there is loot still to pick up and
 * the pack is genuinely full; eating at full health purely to free a slot is
 * what the issue asks for, so HP is deliberately not part of this decision.
 */
export function shouldEatForSpace(freeSlots: number, foodInPack: number): boolean {
    return freeSlots === 0 && foodInPack > 0;
}

/** Big bones are either buried for prayer xp or banked — never both. */
export function bonesAction(buryBones: boolean): 'bury' | 'bank' {
    return buryBones ? 'bury' : 'bank';
}

/** Names a trip keeps in the pack when depositing at the bank. */
export function keepOnDeposit(food: string): string[] {
    return [BRASS_KEY, food];
}

/**
 * Kill counter gate (#479). Only true when the engaged NPC has left the scene.
 * Counting on Attack multi-counted: a death anim stayed Attackable for several
 * ticks and each Fight loop re-clicked Attack. Health bars are often 0/0 until
 * hit on this client, so presence-by-index is the reliable signal.
 */
export function isHillGiantKill(stillPresent: boolean): boolean {
    return !stillPresent;
}
