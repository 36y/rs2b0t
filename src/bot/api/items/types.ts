/** Equipment slots, named as the content's `wearpos` names them. */
export const SLOTS = [
    'hat', 'back', 'front', 'righthand', 'torso', 'lefthand',
    'legs', 'hands', 'feet', 'ring', 'quiver'
] as const;

export type Slot = (typeof SLOTS)[number];

export interface ItemRecord {
    /** Content debugname, e.g. `rune_scimitar`. */
    obj: string;
    id: number;
    /** Display name, which is what every script matches on. */
    name: string;
    slot?: Slot;
    twoHanded?: boolean;
    consumable?: 'eat' | 'drink';
    cost: number;
    members: boolean;
}
