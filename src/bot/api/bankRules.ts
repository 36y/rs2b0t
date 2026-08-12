import type { SettingsSchema } from '../runtime/Settings.js';

/**
 * Deposit and bank-trigger rules, kept free of client imports so scripts and
 * tests can pull them in without loading the adapter graph.
 * Re-exported from Banking.ts — import from either.
 */

/**
 * When a bot should break off and bank.
 * @see docs/reference/api-items.md#bank
 */
export type BankStrategy = 'off' | 'items' | 'time' | 'either';

export interface BankTriggerState {
    lootCount: number;
    minutesSinceLastBank: number;
    itemsThreshold: number;
    minutesThreshold: number;
}

export function shouldBankNow(strategy: BankStrategy, s: BankTriggerState): boolean {
    if (s.lootCount <= 0) {
        return false;
    }
    const byItems = s.lootCount >= s.itemsThreshold;
    const byTime = s.minutesSinceLastBank >= s.minutesThreshold;
    switch (strategy) {
        case 'off':
            return false;
        case 'items':
            return byItems;
        case 'time':
            return byTime;
        case 'either':
            return byItems || byTime;
    }
}

const BANK_STRATEGY_OPTIONS = ['Off', 'Loot count', 'Time', 'Either'];

export function parseBankStrategy(label: string): BankStrategy {
    switch (label.trim().toLowerCase()) {
        case 'loot count':
            return 'items';
        case 'time':
            return 'time';
        case 'either':
            return 'either';
        default:
            return 'off';
    }
}

/**
 * Shared banking parameters, mixed into a script's own settings schema.
 * @see docs/reference/api-events.md#settings
 */
export const PERIODIC_BANK_SETTINGS: SettingsSchema = {
    bankStrategy: { type: 'string', default: 'Off', options: BANK_STRATEGY_OPTIONS, label: 'Periodic bank', help: 'save accumulated loot so a death does not lose it all' },
    bankEveryItems: { type: 'number', default: 15, min: 1, max: 27, label: 'Bank at N loot items' },
    bankEveryMinutes: { type: 'number', default: 10, min: 1, max: 120, label: 'Bank every N minutes' },
    bankCommonJunk: { type: 'boolean', default: true, label: 'Also bank gems/fruit/beer/kebabs/caskets' }
};

export const COMMON_BANK_LOOT: string[] = [
    'uncut', 'sapphire', 'emerald', 'ruby', 'diamond', 'opal', 'jade', 'topaz',
    'strange fruit', 'beer', 'kebab'
];

export const RANDOM_EVENT_CASKET_ID = 405;

export function matchesCommonBankLoot(name: string, id: number = -1): boolean {
    if (id === RANDOM_EVENT_CASKET_ID) {
        return true;
    }
    if (name.length === 0) {
        return false;
    }
    const n = name.toLowerCase();
    return COMMON_BANK_LOOT.some(p => n.includes(p));
}

/**
 * Inventory junk that steals pack slots during long AFK loops (random-event
 * leftovers, common bank loot). Callers must still exclude tools/gear/logs.
 * Used by GatheringBot chop-then-burn when banking is deferred for a fire load.
 */
export function isDisposableGatherJunk(name: string | null | undefined, id: number = -1): boolean {
    if (matchesCommonBankLoot(name ?? '', id)) {
        return true;
    }
    const n = (name ?? '').toLowerCase().trim();
    if (n.length === 0) {
        return false;
    }
    // Event / world leftovers that are not gear and not a gather product.
    // Every name here is verified against the content's obj configs — entries
    // for objs this revision does not have match nothing and only mislead.
    return (
        n === 'flier'
        || n === 'half a meat pie'
        || n === 'half a redberry pie'
        || n === 'half an apple pie'
    );
}

export function depositMatcher(own: (name: string) => boolean, includeCommon: boolean): (name: string, id?: number) => boolean {
    return (name: string, id: number = -1) => own(name) || (includeCommon && matchesCommonBankLoot(name, id));
}

export function depositAllExcept(keep: Iterable<string>): (name: string) => boolean {
    const set = new Set([...keep].map(s => s.toLowerCase()));
    return (name: string) => name.length > 0 && !set.has(name.toLowerCase());
}
