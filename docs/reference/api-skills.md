[Manual](../README.md) › [Scripting API](../API.md) › Skills

# Skills

## Skills

```ts
Skills.index(name: string): number      // lowercase name → index, -1 if unknown
Skills.level(name: string): number      // base (unboosted)
Skills.effective(name: string): number  // current (boosted/drained)
Skills.xp(name: string): number
Skills.hpFraction(): number             // effective/base hitpoints (1 while unreadable)
```

## Prayer

Prayer points and the protection prayers. Prayer buttons live in the tab-bound
prayer overlay, and the engine treats any tab root as visible, so a prayer can be
toggled without switching to the prayer tab first.

```ts
Prayer.points(): number                 // current, drains while a prayer is on
Prayer.max(): number                    // base prayer level
Prayer.full(): boolean
Prayer.known(name: string): boolean     // e.g. 'Protect from Magic'
Prayer.available(name: string): boolean // level met and points remain
Prayer.active(name: string): boolean
Prayer.set(name: string, on: boolean): Promise<boolean>
Prayer.clear(): Promise<void>           // turn off everything that is draining
```

[`nearestAltar`](../../src/bot/api/altar/Altars.ts) finds somewhere to restore them.
[Clue trails](../reference/clues-mechanics.md#prayer-between-trails) use both to fight hard-clue dig
guardians under Protect from Magic.

## See also

- [Scripting API index](../API.md)
