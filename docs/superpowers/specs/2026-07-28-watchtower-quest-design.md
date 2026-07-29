# Watch Tower (AIOQuester) — Design

2026-07-28. Nineteenth quest module for the AIO quester, on branch `watchtower` cut from
`main`. Closes [#112](https://github.com/rs2b2t/rs2b0t/issues/112).

Watch Tower is the largest quest attempted here — twelve journal stages, four powering
crystals, three tribal-ogre fetch chains, six skavid caves with a language puzzle, a
brewed potion, six shamans, and a mined rock. It is roughly three times the surface of
Waterfall Quest, which is the closest existing shape.

## Engine facts this design is built on

All verified against `lostcity-dev/content` (byte-identical to `LostCityRS/Content` for
this quest) and the baked collision pack `out/collision.lcnav.gz`. Sources:
`scripts/quests/quest_itwatchtower/**`, `scripts/areas/area_yanille/scripts/ogre_trader.rs2`,
`scripts/skill_agility/{scripts,configs}/shortcuts.*`, `scripts/skill_herblore/scripts/brewing/`,
`scripts/general/configs/quest.constant`, and `maps/m{39,40}_{46,47,48,147}.jm2`.

### Stage varp

`%itwatchtower` is the stage; `%itwatchtower_bits` is a bitfield of sub-progress. **Neither
reaches a revision-274 client.** As with Waterfall, the rendered quest journal is the only
browser-visible oracle, so `readStage()` parses journal text.

| Const | Value | Reached by |
|---|---|---|
| `not_started` | 0 | — |
| `started` | 1 | wizard dialogue accepts the job |
| `given_fingernails` | 2 | fingernails handed to the wizard |
| `made_relic` | 3 | all three relic parts given to the wizard |
| `given_relic` | 4 | relic shown to `ogre_guard2` |
| `given_riddle` | 5 | `city_guard` asks the riddle (**only if stage is exactly 4**) |
| `solved_riddle` | 6 | death rune used on `city_guard` |
| `skavid_crystal` | 7 | mad skavid answered correctly |
| `fed_nightshade` | 8 | nightshade used on `enclave_guard` |
| `learned_potion` | 9 | wizard explains the potion |
| `made_potion` | 10 | ogre potion given to the wizard |
| `found_all_crystals` | 11 | all four crystals shown to the wizard |
| `complete` | 13 | lever pulled |
| `complete_read_scroll` | 14 | reward scroll read |

Bits: `0` looking_relic, `1` spoken_toban, `2` helped_toban, `3` spoken_grew, `4` helped_grew,
`5` spoken_og, `6` helped_og, `7..9` relic1/2/3 handed in, `10..11` market (rock cake) state,
`12` learning_skavid, `13..16` learned ar/ig/cur/nod, `17..19` shaman kill count.

Quest points: 4. Skill gates: Magic 14, Mining 40, Herblore 14, Thieving 15, Agility 25
(plus Agility 18 for the tower wall climb). The issue specifies max stats.

### The region is a set of sealed pockets

Flooding the collision pack from Yanille bank (2612,3092,0) over `exitMask` plus the baked
door/stair/transport edges — the same traversal `PathFinder.search` uses:

| Component | Tiles | Holds | Entered by |
|---|---|---|---|
| MAIN | 454,699 | Yanille, tower ground, evidence bushes, Og, rock-cake stall, cave mouths 1–5, death-rune spawn | — |
| Grew's island | 133 | Grew, 4× jangerberries | **rope** used on `tree_ropeswing4_norope` (2499,3087) → lands (2505,3087) |
| Toban's camp | 125 | Toban, Gorad, `tobanchest`, rope spawn | `tobancave` (2499,2989) → (2576,3029) |
| Lower city | 158 | `ogre_guard4`, chasm south stand | **rock cake** → `ganothbattlement` (2507,3011/3012) |
| City-guard pocket | 73 | `city_guard` | **20 gp** `tanothjump1` → (2530,3029) |
| Cave-6 region | 6,230 | `skavid_cave6` mouth (2527,3011) | reached through the lower city |
| Wizard's floor | 50 | `watchtower_wizard`, `watchleverup` | `watchladderup` (2549,3111,l1) → (2549,3112,l2) |
| Skavid caves | 112 | all six rooms, 2× nightshade, mad skavid | cave-mouth teleports |
| Shaman enclave | 1,666 | 6× `ogre_shaman`, Rock of Dalgroth, shaman robe | **nightshade** on `enclave_guard` → (2588,9410) |

Not one of these is reachable by walking. Every crossing is a scripted teleport with an
item or dialogue precondition.

**Two findings that shrink the work:**

- ~~**No gold bar is needed.**~~ **Wrong — corrected 2026-07-28 during implementation.**
  Both sides of `ogre_guard1`'s gate looked like MAIN only because the gate was baked as an
  ordinary door edge, so the flood crossed it and merged the two components. With that lie
  removed, the region south of it — 82 tiles containing **cave 6's mouth** — is reachable
  *only* through that gate, and its guard wants a bar of gold. The gold bar is mandatory,
  and is bank-supplied like the other drop-only items.
- **Jangerberries are in-quest**, not a 1/256 werewolf drop. Four ground spawns sit inside
  Grew's island at (2510,3090), (2512,3080), (2516,3086), (2517,3082).

### The tower ladders, and a baked edge that lies

| Loc | Coord | Effect |
|---|---|---|
| `loc_2299` (wall) | 2548,3119,l0 | Agility 18, `~agility_climb_up` → (2548,3117,l1) |
| `towerladder` | 2544,3111,l0 | Climb-up → your tile +1 level. **`tower_guard` refuses while stage is 0.** |
| `laddertop` (generic 1746) | 2544,3111,l1 | Climb-down → l0 |
| `watchladderup` | 2549,3111,l1 | → (2549,3112,l2) — or to region 45_73 once complete |
| `watchladderdown` | 2549,3111,l2 | → (2549,3112,l1) |

Level 1 is **already** routable (`towerladder`/`laddertop` are in `stairEdges.json`; a probe
from Yanille bank costs 107). Level 2 is not. But the baked l0→l1 edge is a **lie at stage 0**,
because the guard refuses the ladder until the quest is started — the navigator will happily
route into a refusal and wedge. The module must take the wall climb at stage 0 and only trust
the ladder from stage 1 on.

Completing the quest teleports the player to **region 45_73** — a mirror copy of the tower
with the shield active — at (2928,4715,l2). `watchladderdown` there (2933,4711,l2) returns to
the real (2549,3112,l1), so the exit is symmetric.

### The route, leg by leg

**Stage 0 → 1.** Wall climb at (2548,3119) → `watchladderup` → wizard on l2. Dialogue:
`"What's the matter?"` → `"So how come the spell doesn't work?"` → `"Can I be of help?"`.

**Stage 1 → 2.** Search `watchtowerbushnail` (2544,3134) for fingernails — the other four
bushes give red herrings the wizard rejects. Return to the wizard (ladder works now); either
`opnpc1` while holding them or use them on him. Then `"So what do I do?"`.

**Stage 2 → 3, the relic.** Three chains with a hard ordering constraint between two of them:

- **Og** (2506,3116, MAIN): `"I seek entrance to the city of ogres."` → `toban_key`.
- **Toban's camp** via `tobancave` (2499,2989): open `tobanchest` (2575,3031) with the key →
  `stolen_gold`; talk to Toban `"I seek entrance…"` → `"I could do something for you…"` → he
  wants dragon bones; hand them over → `relicpart3`. Leave by `tobanladderdown` (2575,3029).
- **Grew's island** via the rope swing: `"Don't eat me; I can help you."` → he wants Gorad's
  tooth. Pick up jangerberries while here.
- **Gorad** (2577,3021, Toban's camp): only becomes killable once Grew has been spoken to.
  Kill → `ogretooth`. `[queue,defeat_gorad]` **silently returns on a full inventory**, so the
  bot needs a free slot before the killing blow; Gorad respawns, so a miss is only a delay.
- Back to Grew with the tooth → `relicpart2` **and** `powering_crystal1`.
- Back to Og with the stolen gold → `relicpart1`.
- Use all three parts on the wizard → `ogrerelic`, stage 3.

The rope swing is **one-way in each direction**: entry needs a rope consumed on
`tree_ropeswing4_norope` (2499,3087); the exit is the free `tree_ropeswing3` (2511,3090),
whose handler always walks you to its `start_coord` (2511,3091) and swings to (2511,3096).
Two visits to Grew means two ropes.

**Stage 3 → 4.** `ogre_guard2` at (2505,3062) takes **two** interactions: the first talk sets
`looking_relic` and throws you to (2546,3065); then use the relic on him → stage 4 and a
teleport through to (2503,3062). The relic is not consumed.

**Stage 4 → 5.** Reaching `city_guard` needs both remaining gates:
steal a rock cake from `rockcounter_withcakes` (2506,3023) — Thieving 15, fails if
`ogre_trader2` is within 3 tiles, respawns in 12 ticks — then `ogre_guard3` (2503,3011):
`"But I am a friend to ogres…"` sets market=1, then the cake sets market=2 and he
`p_oploc`s you over `ganothbattlement`. From the lower city, `tanothjump1` (2530,3026,l1)
with `ogre_guard4` within 8 tiles: `"Okay, I'll pay it."` costs 20 gp and Agility 25, landing
at (2530,3029). Talk to `city_guard` → `"I seek passage into the skavid caves."` → stage 5.
Return jump is `tanothjump2` (2531,3029), free.

**Stage 5 → 6.** Use a death rune on `city_guard` → `skavidmap`, stage 6.

**Stage 6 → 7, the caves.** Every cave mouth checks `skavidmap` **and** a lit
`light_source_lit` item; missing either dumps you in a dark cave. The `lit_candle` ground
spawn at (2547,3114) by the tower is already lit — no tinderbox needed.

| Cave | Mouth | Lands | Holds | Exit → |
|---|---|---|---|---|
| 5 | 2553,3033 | 2504,9441 | `scared_skavid` (2499,9433) — teaches the words | 2552,3034 |
| 1 | 2560,3022 | 2498,9418 | `skavidtalker4` → reply **"Nod."** | 2562,3024 |
| 2 | 2522,3068 | 2532,9469 | `skavidtalker1` → **"Ig."**; nightshade (2530,9462) | 2524,3070 |
| 3 | 2539,3052 | 2518,9455 | `skavidtalker2` → **"Ar."** | 2540,3054 |
| 4 | 2552,3052 | 2498,9451 | `skavidtalker3` → **"Cur."** | 2553,3054 |
| 6 | 2527,3011 | 2522,9411 | `mad_skavid` (2523,9411); nightshade (2528,9415) | 2529,3013 |

Cave 5 must come first — `scared_skavid`'s `"Okay, okay, I'm not going to hurt you."` sets
`learning_skavid`, without which the talkers refuse. The mad skavid needs all five bits and
speaks one of four phrases at random:

| He says | Correct reply |
|---|---|
| `Ar cur...` | Gor. |
| `Bidith ig...` | Cur. |
| `Cur tanath...` | Bidith. |
| `Gor nod...` | Tanath. |

→ `powering_crystal2`, stage 7. Only cave 6 sits behind the city gates; **nightshade should
be taken from cave 2**, which is in MAIN.

**Stage 7 → 8.** Use nightshade on `enclave_guard` (2507,3036) → teleport to (2588,9410).
The nightshade is consumed *per entry*, so every enclave trip costs one. Leave by
`enclavecave` (2598,9468) → (2540,3054).

**Stage 8 → 9.** Talk to the wizard; he explains the recipe.

**Stage 9 → 10, the potion.** Order is load-bearing — any other pairing calls
`~potion_explosion`, destroys both items and deals 5 damage:

1. `vial_water` + `guam_leaf` → `guamvial` (ordinary Herblore)
2. `guamvial` + `jangerberries` → `guamjangervial` (Herblore 14)
3. `guamjangervial` + `ground_bat_bones` → `ogre_potion` (Herblore 14)

`ground_bat_bones` = pestle and mortar on bat bones. Use the potion on the wizard →
`magic_ogre_potion`, stage 10.

**Stage 10, crystals 3 and 4.** Use the magic potion on each of the six `ogre_shaman`
(2577,9451 / 2582,9437 / 2592,9436 / 2599,9461 / 2606,9438 / 2607,9451). **Never talk to a
shaman** — `opnpc1` is an unconditional 20 damage — and never attack one; `ai_queue2` deals
30. The sixth kill consumes the potion and yields `powering_crystal3`. Then mine
`rock_of_dalgroth` (2590,9449), op2 "Mine", Mining 40 + a pickaxe → `powering_crystal4`. A
`shaman_robe` ground spawn (2617,9437) is a backup source of crystal 3 if it is lost.

**Stage 10 → 11 → done.** Show the crystals to the wizard → stage 11. Pull `watchleverup`
(2543,3115,l2) → complete, 4 QP, 5,000 coins, Magic xp, `watchtowerspell`. Read the scroll →
stage 14, which also clears the journal's outstanding line. Climb down from the 45_73 mirror
to return to Yanille.

## Architecture

### Module layout

`defs/watchtower/` as a directory, not a single file. Waterfall is 1,120 lines in one file
and is already at the edge of comfortable; this quest is larger, and the natural seams are
sharp:

| File | Job |
|---|---|
| `index.ts` | the `QuestModule`, and `decide()` — a switch over stage, nothing else |
| `journal.ts` | journal text → stage; `readStage()` |
| `areas.ts` | `watchtowerArea()` and every `Tile`, loc id, and npc name as named constants |
| `tower.ts` | wall climb, ladders, all wizard dialogue legs |
| `tribes.ts` | Og, Toban, Gorad, Grew; the relic parts |
| `gutanoth.ts` | relic gate, rock-cake steal, battlement, chasm jump, city guard |
| `caves.ts` | the six caves, light source, skavid language |
| `enclave.ts` | nightshade entry, the six shamans, Rock of Dalgroth |
| `supplies.ts` | bank-first provisioning and shop fallbacks |

`decide()` stays a pure function of `QuestSnapshot`, so every branch is unit-testable without
a client, matching `test/quests/`.

### State and resumability

State comes from the rendered journal stage plus held items — never varps, which the client
cannot see anyway. The journal is cumulative, so `parseWatchtowerJournal` matches **newest
first**, exactly as `parseWaterfallJournal` does.

`itwatchtower_journal.rs2` renders sub-progress the stage number alone does not carry, and
the parser reads it: which tribes have been spoken to, which relic parts are outstanding,
whether the map is held, which skavid words are known, and the remaining shaman count
(`"I need to kill N ogre shaman(s)"`). That is what makes stage 2 and stage 10 — the two
stages with internal branching — resumable rather than restarted.

`watchtowerArea(tile)` classifies which pocket the bot woke up in, and **every pocket has an
escape leg**, so a bot killed mid-quest and restarted anywhere recovers instead of wedging:
Grew's island exits by the free swing, Toban's camp by the ladder, the caves by their exit
locs, the enclave by `enclavecave`, the city-guard pocket by `tanothjump2`, the 45_73 mirror
by `watchladderdown`.

The held-item wedge rule from `docs/QUESTS.md` applies directly here: a relic part or a
crystal in the pack is part of the state machine's memory, so the step that hands one over
and the step that acquires it must never both be reachable from one snapshot.

### Nothing in this quest hard-locks

Every quest item has a re-issue path, so **losing one is always a detour, never a dead end**.
`decide()` should therefore route to the recovery step rather than parking:

| Lost | Recovered from | Gate |
|---|---|---|
| `toban_key` | Og, `"I have lost the key!"` | `spoken_og` and not yet `helped_og` |
| `stolen_gold` | re-open `tobanchest` | key in hand |
| `ogretooth` | kill Gorad again | `spoken_grew` and not yet `helped_grew` |
| `relicpart1` / `2` / `3` | Og / Grew / Toban, `"I have lost the relic part…"` | the matching `helped_*` bit |
| `ogrerelic` | wizard, `"I have lost the relic you gave me."` | stage 3 |
| `skavidmap` | `city_guard`, `"I have lost the map you gave me."` | stage ≥ 6 |
| `powering_crystal1` | Grew, `"I've lost the crystal you gave me."` | `helped_grew` |
| `powering_crystal2` | `mad_skavid`, `"But I've lost it!"` | stage ≥ 7, and not already banked |
| `powering_crystal3` | search the `shaman_robe` spawn (2617,9437) | six shaman kills |
| `powering_crystal4` | re-mine the Rock of Dalgroth | six kills, and not already banked |
| `magic_ogre_potion` | brew another ogre potion and re-infuse it | stage ≥ 9; costs one more set of ingredients |
| `rock cake`, `nightshade`, `death rune`, `lit candle`, `jangerberries` | their spawns and stalls respawn | — |

Two consequences the module must respect. Several of these checks read the **bank** as well
as the inventory (`mad_skavid`, both mined crystals), so a crystal parked in the bank blocks
its own re-issue — crystals must be carried or deliberately withdrawn before recovery is
attempted. And **the tribes only re-issue what they have already given**: the `"I have lost…"`
options are gated on the corresponding `helped_*` bit, so the first acquisition still has to
succeed in order. That ordering is self-enforcing rather than hazardous, because
`check_relic_parts` will not grant the relic — and so cannot advance the stage — until all
three parts have been handed in.

One asymmetry worth coding to: `[oploc1,tobanchest]` **consumes** the key, while
`[oplocu,tobanchest]` (use key on chest) does not. The module should always use the key on
the chest, keeping it for a second opening if the gold is somehow lost.

### Nav changes

Two edges added to `transports.json`, both safe for every bot because neither is quest-gated
or item-consuming:

- `watchladderup` (2549,3111,l1) → (2549,3112,l2) and `watchladderdown` back.
- Grew's-island exit swing (2511,3091) → (2511,3096), one-way, `Swing-on`.

Everything else stays module-owned as `custom` legs. Baking the Gu'Tanoth gates, the chasm
jump, the cave mouths or the enclave into the global graph would let the clue solver or a
plain walk route into a pocket it cannot pay to leave — the same class of failure as the
Draynor Manor one-way doors.

The stage-0 ladder refusal is handled in `tower.ts`, not by removing the baked stair edge:
the edge is correct from stage 1 onward and other bots may want the tower.

### Item sourcing

Bank first, then shop, then park with a reason.

**Bank-required** (drop-only, per the issue's "assume it's in the bank"): `Dragon bones`,
`Guam leaf`, `Bat bones`. If absent, `decide()` returns `wait` with a reason naming the item
— it never silently grinds.

**Bot-sourced:** jangerberries (Grew's island), nightshade (cave 2), death rune
(ground spawn 2500,2967, with the Yanille Magic Guild as fallback), lit candle (2547,3114),
rock cake (stolen), rope, vial of water, pestle and mortar, pickaxe, coins.

Per `docs/QUESTS.md`, `coins` must stay in the module's `tools` or every purchase and the
20 gp toll park with "need gp".

### New shared primitives

- **`talkChoosingBy(npc, match)` in `exec/primitives.ts`** — pick a dialogue option from the
  NPC's *rendered line*, not from a fixed preference list. The mad skavid is the first case
  the existing `driveDialog` cannot express; it is a general gap worth closing in the shared
  vocabulary rather than in one quest.
- The six shamans reuse `useOn` with a kill counter read back from the journal; no new
  primitive needed, but the module must poll the journal count rather than assume six
  successful applications.

## Testing

Local engine on :8888 (`lostcity-dev`), `::speed 300` for 2× ticks per the issue.

**Per-leg**, before any end-to-end run: a `watchtower-solo-test.ts` harness in the shape of
`pip-solo-test.ts`, jumping straight to a stage with `::setvar itwatchtower N` and
`::setvar itwatchtower_bits M`, seeding items with `::give`, and running one leg. Each of the
six phases below lands only when its legs pass live.

**Unit**: `test/quests/watchtower.test.ts` over `decide()` and the journal parser — every
stage, plus the sub-progress branches inside stages 2 and 10, plus each pocket's escape.

**End-to-end**: one uncheated run from a fresh max-stat account with only the three
bank-required items and coins seeded, through `tools/aio-quest-test.ts`.

## Phasing

Six commits on branch `watchtower`, each live-verified before the next starts, merged as one
PR when the end-to-end run passes — how Waterfall and Priest in Peril landed.

| | Phase | Lands |
|---|---|---|
| A | Oracle and tower | journal parser, `areas.ts`, wall climb, ladder edges, quest start, fingernails → stage 2 |
| B | The tribes | rope swing, Toban's cave, Og/Toban/Gorad/Grew, jangerberries picked up, relic assembled → stage 3 |
| C | City entry | relic gate, rock-cake steal, battlement, chasm jump, riddle, death rune → stage 6 |
| D | Caves | light source, six cave mouths, skavid language, `talkChoosingBy`, crystal 2 → stage 7 |
| E | Potion and shamans | nightshade entry, wizard advice, brewing, six shamans, Rock of Dalgroth → crystals 3 and 4 |
| F | Completion | crystals returned, lever, scroll read, exit from the 45_73 mirror → stage 14 |

## Risks and open questions

- **`tanothjump1` sits at level 1** in the map data while the player stands at level 0. This
  is normal bridge rendering, but whether the client will let the bot click it from level 0
  is a live-test item in phase C. If it will not, the jump needs a `p_oploc`-style approach
  through `ogre_guard4`'s dialogue instead.
- **The lit candle spawns on an unwalkable table tile** (2547,3114). Whether `grabGround`
  takes an object off a blocked tile is unverified; phase A settles it.
- **`enter_gutanoth` drops invisible walls for 3 ticks** after each gate crossing. Arrival
  checks must key on the destination tile, not on the gate becoming passable.
- The **6,230-tile cave-6 region** was mapped but its full boundary with the lower city was
  not walked; phase D confirms the route from the battlement to the cave-6 mouth.
- **Re-brewing the potion needs bank items.** It is the only recovery in the table above that
  cannot be satisfied in the field, since guam leaf and bat bones are bank-required. If the
  magic potion is lost mid-enclave, the bot returns to the bank rather than parking — but it
  will park if the bank is empty, which is the correct outcome and must say so.
