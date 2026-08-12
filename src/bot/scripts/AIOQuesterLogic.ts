import { foodForms, foodHealAmount, shouldEatToUseFood } from '../api/combat/food.js';
import type { QuestSustain } from '../quests/engine/types.js';

export interface ResolvedSustainPolicy {
    foods: readonly string[];
}

interface SustainInventoryItem {
    name: string | null | undefined;
    actions(): readonly string[];
}

export interface SustainSelection<T extends SustainInventoryItem> {
    item: T;
    action: string;
}

// Tourist Trap can leave Baker's-stall Cakes in the pack even when general food
// is Lobster. Keep implicit eligibility narrow so edible quest items stay safe.
const OPPORTUNISTIC_FOODS = new Set(foodForms('Cake'));

/** Pick the explicit inventory operation that consumes a supported food/drink. */
export function resolveConsumeAction(actions: readonly string[]): string | null {
    for (const wanted of ['Eat', 'Drink']) {
        const action = actions.find(candidate => candidate.toLowerCase() === wanted.toLowerCase());
        if (action) return action;
    }
    return null;
}

/**
 * Select one eligible item and its exact consume operation. A fitting heal wins
 * across the whole pack before the low-HP safety floor is considered, so a
 * large food in an earlier slot cannot veto a later Cake bite that fits.
 */
export function selectSustainConsumable<T extends SustainInventoryItem>(
    items: readonly T[],
    foods: readonly string[],
    hp: number,
    maxHp: number
): SustainSelection<T> | null {
    const allowed = new Set(foods.map(food => food.trim().toLowerCase()).filter(Boolean));
    const candidates: Array<SustainSelection<T> & { heal: number; policyFood: boolean }> = [];

    for (const item of items) {
        const name = item.name?.trim().toLowerCase() ?? '';
        const policyFood = allowed.has(name);
        if (!policyFood && !OPPORTUNISTIC_FOODS.has(name)) {
            continue;
        }
        const action = resolveConsumeAction(item.actions());
        if (!action) {
            continue;
        }
        candidates.push({ item, action, heal: foodHealAmount(name), policyFood });
    }

    const fitting = hp > 0 && maxHp > 0
        ? candidates.find(candidate => hp + candidate.heal <= maxHp)
        : undefined;
    const emergency = (candidate: { heal: number }): boolean =>
        shouldEatToUseFood({ hp, maxHp, heal: candidate.heal, foodCount: 1 });
    // The emergency floor belongs only to explicitly configured/quest food;
    // opportunistic Cakes are eligible solely when their full bite fits.
    const selected = fitting
        ?? candidates.find(candidate => candidate.policyFood && emergency(candidate));
    return selected ? { item: selected.item, action: selected.action } : null;
}

/**
 * Merge the user's general food choice with the active quest's survival policy.
 * Each food expands to every form it is eaten down through, so a bitten cake is
 * still recognised as food. Eat threshold is food-heal based (see food.ts #465).
 */
export function resolveSustainPolicy(
    configuredFood: string | null,
    quest?: QuestSustain
): ResolvedSustainPolicy {
    const foods: string[] = [];
    const seen = new Set<string>();
    for (const candidate of [...(quest?.foods ?? []), configuredFood]) {
        const food = candidate?.trim();
        if (!food) {
            continue;
        }
        for (const form of foodForms(food)) {
            if (seen.has(form)) {
                continue;
            }
            seen.add(form);
            foods.push(form);
        }
    }
    return { foods };
}
