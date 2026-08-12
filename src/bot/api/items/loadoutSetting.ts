import type { SettingDef, SettingsBag } from '../../runtime/Settings.js';
import { Loadouts } from './loadoutStore.js';
import type { Loadout } from './loadouts.js';

export const LOADOUT_SETTING: SettingDef = {
    type: 'string',
    default: '',
    options: [],
    optionsFrom: 'loadouts',
    label: 'Loadout',
    help: 'gear and supplies to wear, defined in the Loadouts panel; blank uses the first one. Anything the loadout does not name falls back to this script\'s own default'
};

/** The chosen loadout, the first as a fallback, null when none are defined. */
export function selectedLoadout(bag: SettingsBag): Loadout | null {
    const all = Loadouts.all();
    if (all.length === 0) {
        return null;
    }
    const wanted = bag.str('loadout', '').trim().toLowerCase();
    return all.find(l => l.name.toLowerCase() === wanted) ?? all[0]!;
}
