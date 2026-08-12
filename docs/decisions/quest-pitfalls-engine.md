[Manual](../README.md) › [Quests](../QUESTS.md) › Quest pitfalls

# Quest pitfalls: engine behaviour


Three engine behaviours bit this quest hard enough to be worth stating once:

- **An op that opens a dialogue does so a tick later.** Driving it immediately makes
  `talkThrough` find nothing open and start a *fresh* conversation with the same NPC —
  which lands in a dead-end line, or at an aggressive NPC gets you attacked. Wait for
  `ChatDialog.isOpen()` first, then drive what is already there.
- **Colour tags displace punctuation.** Stripping `@dbl@` leaves a space where it stood,
  so `"potion@dbl@."` normalises to `"potion ."`. Journal needles must not span a tag
  boundary next to a mark.
- **`ownsInventory: true` opts the quest out of the engine's food provisioning**, so a
  `sustain` block declares foods that nothing ever withdraws. Source food yourself.
- **Nobody is called `Shop keeper`.** A shop belongs to a named NPC through
  `param=owned_shop` in the engine's `.npc` config, and `Shop.open()` matches the display
  name. Read the owner out of the configs; a guide will not tell you.
- **A tool that is merely absent produces no refusal.** Mining without a pickaxe is not
  an error — the rock does not respond at all, and the step retries until the watchdog
  parks it. Anything a step needs but does not consume has to be sourced explicitly.

Shilo Village added three more, each of which cost a live run:

- **A region the walker cannot reach is a nav-data problem, not a walker one.** The
  Ah Za Rhoon mound and Rashiliyia's tomb sit in a 6,193-tile jungle whose only links
  to the mainland are two Agility shortcuts that `derive-doors` cannot see. Four
  curated `transports.json` edges fixed what no amount of quest code could.
- **A journal that renders nothing is not a journal that says "not started".** At
  `found_snake_weed` while the unidentified herb is held, Jungle Potion's journal
  writes no line at all, and every other `found_` stage writes the *previous* stage's
  "go and pick it" line. When a held item is unambiguous evidence of progress, let it
  outrank the journal instead of trying to parse a state that was never written.
- **A door that refuses the key that opens it is a `useOn`, not an `Open`.** Rashiliyia's
  tomb exit answers "The door seems to be locked!" to anyone *carrying* the bone key.
  Read the `oplocu` handler before assuming an op exists for what you want.
- **Not every box is a chat box.** A scroll body built with `if_settext` is a *main*
  modal: dialogue drivers cannot see it, and while it is up every journal read comes back
  empty — which reads as "stage unavailable" and parks the quest one step later. Close it
  with `actions.closeModal()`, the same way `readProgress` does.

## See also

- [Tooling and verification habits](quest-pitfalls-habits.md)
- [The map](quest-pitfalls.md)
- [Per-quest](quest-pitfalls-2.md)
