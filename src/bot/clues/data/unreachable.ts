/**
 * Clue destinations the baked nav pack cannot route to, with the verified reason
 * for each. Every entry below was traced to its actual crossing in the content
 * scripts, not inferred from a map scan.
 *
 * These are gaps in the **nav data**, not the clue database: the solver abandons
 * cleanly, and baking the crossing makes the clue start working with no solver
 * edit. Deliberately not consulted by the solver — it still tries, so a pack fix
 * takes effect on its own. The audit allowlists these, and the live harnesses use
 * them to tell "blocked by a known gap" apart from a real regression.
 *
 * Grouped by what it would take to open them:
 *
 *   NO QUEST — the crossing exists today and only needs baking.
 *   QUEST    — assumes the named quest is complete, then needs baking.
 *   KIT      — needs an item or skill carried, not a quest.
 *   DEFECT   — not a gate at all; the pack or a generator is wrong.
 *
 * @see docs/CLUES.md#clues-the-pack-cannot-reach
 */
export const PACK_UNREACHABLE: Record<number, string> = {
    // ---- NO QUEST -----------------------------------------------------------
    // The southbound crossing is now baked, but it consumes a Shantay pass, and a
    // requires-gated edge is skipped when no world state is supplied. So the bot
    // walks it holding a pass; the offline audit correctly still calls it closed.
    3554: 'Kharidian desert: baked, but entry consumes a Shantay pass — the bot must carry one',

    // ---- QUEST: assume complete, then bake ---------------------------------
    3560: 'Isafdar: Sticks [Pass] @ (2200,3169) — requires Underground Pass/Regicide',
    3562: 'Isafdar: Sticks [Pass] @ (2181,3209) — requires Underground Pass/Regicide',
    3564: 'elf camp: Dense forest [Enter] @ (2231,3248) / Log balance @ (2197,3237) — requires Regicide',
    // 3546 only: 3548's Toban camp cave/ladder now routes on the curated graph.
    3546: "Gu'Tanoth ledge: chasm Jump-From baked — need 25 Agility + 20gp; hill access may need Watch Tower",
    3522: 'West Ardougne: baked sewer pipe path — requires Plague City complete and Gas mask worn',
    // Corrected against Content @ 088ca5e (#365). The previous note named
    // death_climbingrocks / Death Plateau; both are wrong. death_climbingrocks_top
    // (3722) / _bottom (3723) sit at (2880..2881, 3594..3595) — the Death Plateau,
    // ~80 tiles south of these digs and not on the route. The crossings that
    // actually border them are in quest_troll.rs2:
    //   troll_mountain_shortcut_climbingrocks1/2 (3803/3804) @ (2885,3683+3684)
    //     and (2887..2888,3661) — Agility 15 only. No quest, no boots.
    //   troll_climbingrocks (3748) @ (2910,3686+3687) — Agility 15 AND
    //     %troll_quest >= ^troll_started (Troll Stronghold *started*, not Death
    //     Plateau). Climbing boots are demanded only when coordz(coord) = 3611,
    //     i.e. from the far southern approach, not from these tiles.
    // So the shortcut rocks look bakeable today behind Agility 15 alone.
    3526: 'Trollheim: troll_mountain_shortcut_climbingrocks1/2 @ (2885,3683) not baked — Agility 15, no quest gate',
    3528: 'Trollheim: troll_mountain_shortcut_climbingrocks1/2 @ (2885,3683) not baked — Agility 15, no quest gate',

    // ---- KIT: an item or skill, no quest -----------------------------------
    // 2811 Baxtorian rope baked (#369); 2790 sewer web baked (#370); 3579 Entrana ferry+planks (#368).
    3532: 'Kharazi jungle: boundary is cut tile-by-tile with a machete (jungle_tree.rs2) — a traversal mode, not one edge',
    3534: 'Kharazi jungle: boundary is cut tile-by-tile with a machete (jungle_tree.rs2) — a traversal mode, not one edge',
    3536: 'Kharazi jungle: boundary is cut tile-by-tile with a machete (jungle_tree.rs2) — a traversal mode, not one edge'

    // 2855 Sinclair Mansion: the ladder foot was anchored on a sealed strip.
    // Fixed by overriding the approach tile in derive-ladders.py, not by making
    // snap() smarter — a general rule moved ladders that were already correct.
};

export function packUnreachable(id: number): string | null {
    return PACK_UNREACHABLE[id] ?? null;
}
