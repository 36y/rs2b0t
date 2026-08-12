import type { WorldTile } from '../adapter/ClientAdapter.js';
import type { BankDestination } from '../api/bank/Banking.js';
import Tile from '../geometry/Tile.js';

export interface CowLocation {
    name: string;
    anchor: Tile;
    usesAlKharidToll: boolean;
    bankDestination?: BankDestination;
}

export const ARDOUGNE_EAST_BANK = new Tile(2655, 3283, 0);

export const COW_LOCATIONS: CowLocation[] = [
    {
        name: 'Lumbridge cow field',
        anchor: new Tile(3255, 3288, 0),
        usesAlKharidToll: true
    },
    {
        // West of the river, so it banks at Draynor and never pays the toll gate
        name: 'North-west of Lumbridge',
        anchor: new Tile(3168, 3329, 0),
        usesAlKharidToll: false
    },
    {
        name: 'South of Falador',
        anchor: new Tile(3033, 3306, 0),
        usesAlKharidToll: false
    },
    {
        name: 'East Ardougne cow field',
        anchor: new Tile(2664, 3347, 0),
        usesAlKharidToll: false,
        // Ardougne West is nearer by straight line but farther through the real street/pen route.
        bankDestination: { name: 'Ardougne East', tile: ARDOUGNE_EAST_BANK }
    }
];

export const COW_LOCATION_OPTIONS = ['Auto', ...COW_LOCATIONS.map(location => location.name), 'Start tile'];
export const AL_KHARID_BANK = new Tile(3269, 3167, 0);
export const TOLL_COIN_TARGET = 20;

export function isCowFieldLootTile(anchor: WorldTile, leashRadius: number, tile: WorldTile): boolean {
    return tile.level === anchor.level
        && Math.max(Math.abs(tile.x - anchor.x), Math.abs(tile.z - anchor.z)) <= leashRadius;
}

export function resolveCowLocation(setting: string, start: WorldTile): CowLocation | null {
    const normalized = setting.trim().toLowerCase();
    if (normalized === 'start tile') {
        return null;
    }
    if (normalized !== 'auto') {
        return COW_LOCATIONS.find(location => location.name.toLowerCase() === normalized) ?? null;
    }

    return COW_LOCATIONS.reduce((nearest, location) =>
        location.anchor.distanceTo(start) < nearest.anchor.distanceTo(start) ? location : nearest
    );
}

export function nearestCowLocation(tile: WorldTile): CowLocation {
    return COW_LOCATIONS.reduce((nearest, location) =>
        location.anchor.distanceTo(tile) < nearest.anchor.distanceTo(tile) ? location : nearest
    );
}

export function needsTollCoins(location: CowLocation | null, enabled: boolean): boolean {
    return enabled && location?.usesAlKharidToll === true;
}

export function cowBankDestination(location: CowLocation | null, tollEnabled: boolean): BankDestination | null {
    if (needsTollCoins(location, tollEnabled)) {
        return { name: 'Al Kharid', tile: AL_KHARID_BANK };
    }
    return location?.bankDestination ?? null;
}

export function shouldBootstrapTollCoins(location: CowLocation | null, start: WorldTile, coins: number, enabled: boolean): boolean {
    return needsTollCoins(location, enabled)
        && coins < TOLL_COIN_TARGET
        && start.level === AL_KHARID_BANK.level
        && AL_KHARID_BANK.distanceTo(start) <= 80;
}
