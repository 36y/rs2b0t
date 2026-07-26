import { afterEach, expect, test } from 'bun:test';
import { LoopingBot } from '#/bot/api/Bot.js';
import { Scheduler } from '#/bot/runtime/Scheduler.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import type { ScriptMeta } from '#/bot/runtime/ScriptRegistry.js';

class SelfStoppingBot extends LoopingBot {
    starts = 0;
    stops = 0;

    override onStart(): void {
        this.starts++;
        ScriptRunner.stop();
    }

    override onStop(): void {
        this.stops++;
    }

    override loop(): void {
        throw new Error('loop must not run after onStart stops the script');
    }
}

async function settle(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

afterEach(async () => {
    ScriptRunner.stop();
    await settle();
});

test('a script can restart after stopping itself during onStart', async () => {
    const instances: SelfStoppingBot[] = [];
    const meta: ScriptMeta = {
        name: 'Self-stopping test bot',
        description: 'runner regression fixture',
        create: () => {
            const bot = new SelfStoppingBot();
            instances.push(bot);
            return bot;
        }
    };

    ScriptRunner.start(meta);
    await settle();

    expect(ScriptRunner.state).toBe('stopped');
    expect(Scheduler.active).toBeNull();
    expect(instances[0]?.starts).toBe(1);
    expect(instances[0]?.stops).toBe(1);
    expect(ScriptRunner.ctx?.log.map(line => line.msg)).toEqual([
        'Self-stopping test bot started (input: direct)',
        'stopping...',
        'stopped'
    ]);

    expect(() => ScriptRunner.start(meta)).not.toThrow();
    await settle();

    expect(ScriptRunner.state).toBe('stopped');
    expect(Scheduler.active).toBeNull();
    expect(instances).toHaveLength(2);
    expect(instances[1]?.starts).toBe(1);
    expect(instances[1]?.stops).toBe(1);
});
