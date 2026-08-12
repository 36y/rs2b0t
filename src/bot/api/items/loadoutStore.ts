import { LOADOUT_SETTINGS, LOADOUT_SETTINGS_NS, SettingsStore } from '../../runtime/Settings.js';
import { parseLoadouts, serializeLoadouts, type Loadout } from './loadouts.js';

const KEY = 'sets';

export const Loadouts = {
    all(): Loadout[] {
        return parseLoadouts(SettingsStore.displayString(LOADOUT_SETTINGS_NS, KEY, LOADOUT_SETTINGS[KEY]!));
    },

    names(): string[] {
        return Loadouts.all().map(l => l.name);
    },

    byName(name: string): Loadout | null {
        const wanted = name.trim().toLowerCase();
        return Loadouts.all().find(l => l.name.toLowerCase() === wanted) ?? null;
    },

    save(list: readonly Loadout[]): void {
        SettingsStore.save(LOADOUT_SETTINGS_NS, KEY, serializeLoadouts(list));
    }
};
