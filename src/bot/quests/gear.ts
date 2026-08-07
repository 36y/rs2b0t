/**
 * Player-supplied gear names, set from the script settings at startup.
 *
 * A melee weapon cannot be shopped for the way the rest of a quest loadout can:
 * nothing in the game sells a rune scimitar, and Zeke's Superior Scimitars tops
 * out at mithril. So the name is a parameter and the bank is the only source —
 * whatever the player already owns and can wield.
 */
export const QuestGear = { meleeWeapon: 'Rune scimitar' as string | null };
