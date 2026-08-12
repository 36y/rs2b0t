[Manual](README.md) › Testing

# Testing

| Layer | What it proves | Cost |
|---|---|---|
| Unit tests (`bun test`) | the logic is right | seconds |
| Live harnesses (`tools/*-test.ts`) | the bot actually works against a real engine | minutes to hours |

## Pages

| Page | Covers |
|---|---|
| [Test suites](reference/test-suites.md) | what lives where, the collision pack |
| [Why this is testable](decisions/testability.md) | the design choices that keep logic headless |
| [The live-harness ABI](how-to/write-a-harness.md) | the ABI, shared helpers |
| [Write a harness](how-to/harness-shape.md) | the shape, and the end-to-end smoke |
| [Seeding test accounts](reference/seeding-test-accounts.md) | inventory vs bank cheats and their traps |
| Quest harness recipes [A–F](reference/quest-harness-recipes.md), [G–Z](reference/quest-harness-recipes-2.md) | per-quest seed and stage commands |
