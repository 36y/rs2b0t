export interface NamedStack {
    name: string | null;
    count: number;
}

export const THIEVER_BANKING_OPTIONS = ['None', 'Auto'];

export function autoFoodBanking(mode: string): boolean {
    return mode.trim().toLowerCase() === 'auto';
}

export function foodMatches(name: string | null, keyword: string): boolean {
    const wanted = keyword.trim().toLowerCase();
    return wanted.length > 0 && (name ?? '').toLowerCase().includes(wanted);
}

export function countFood(items: NamedStack[], keyword: string): number {
    return items.filter(item => foodMatches(item.name, keyword)).reduce((sum, item) => sum + item.count, 0);
}

export function shouldRestockFood(enabled: boolean, foodCount: number, restockAt: number, bankablePackFull: boolean): boolean {
    return enabled && (foodCount <= restockAt || bankablePackFull);
}

export function safeToSteal(hpFraction: number, eatAt: number, foodCount: number): boolean {
    return hpFraction >= eatAt || foodCount > 0;
}
