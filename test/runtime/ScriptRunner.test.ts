import { afterEach, expect, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { LoopingBot } from '#/bot/api/Bot.js';
import { Execution } from '#/bot/api/Execution.js';
import { Scheduler } from '#/bot/runtime/Scheduler.js';
import { loopReadyOrDetached, ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
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

class StartProbeBot extends LoopingBot {
    starts = 0;

    override onStart(): void {
        this.starts++;
    }

    override loop(): void {}
}

class AsyncStartPaintProbeBot extends LoopingBot {
    starts = 0;
    paints = 0;
    private releaseStart!: () => void;
    private readonly startGate = new Promise<void>(resolve => {
        this.releaseStart = resolve;
    });

    override onStart(): Promise<void> {
        this.starts++;
        return this.startGate;
    }

    override onPaint(): void {
        this.paints++;
    }

    finishStart(): void {
        this.releaseStart();
    }

    override loop(): void {}
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

test('onPaint remains hidden until asynchronous onStart establishes its baseline', async () => {
    const instance = new AsyncStartPaintProbeBot();
    ScriptRunner.start({
        name: 'Paint startup probe',
        description: 'runner paint readiness regression fixture',
        create: () => instance
    });
    await settle();

    expect(instance.starts).toBe(1);
    expect(ScriptRunner.paintBot).toBeNull();
    expect(instance.paints).toBe(0);

    instance.finishStart();
    await settle();

    expect(ScriptRunner.paintBot).toBe(instance);
    ScriptRunner.paintBot?.onPaint?.({} as CanvasRenderingContext2D);
    expect(instance.paints).toBe(1);
});

test('an attached script waits for the login stat snapshot before reading XP', () => {
    const original = {
        attached: reader.attached,
        ingame: reader.ingame,
        sceneState: reader.sceneState,
        worldTile: reader.worldTile,
        statsReady: reader.statsReady
    };

    try {
        reader.attached = () => true;
        reader.ingame = () => true;
        reader.sceneState = () => 2;
        reader.worldTile = () => ({ x: 3200, z: 3200, level: 0 });
        reader.statsReady = () => false;
        expect(loopReadyOrDetached()).toBe(false);

        reader.statsReady = () => true;
        expect(loopReadyOrDetached()).toBe(true);
    } finally {
        reader.attached = original.attached;
        reader.ingame = original.ingame;
        reader.sceneState = original.sceneState;
        reader.worldTile = original.worldTile;
        reader.statsReady = original.statsReady;
    }
});

test('onStart remains blocked until the stat snapshot is ready', async () => {
    const originalReader = {
        attached: reader.attached,
        ingame: reader.ingame,
        sceneState: reader.sceneState,
        worldTile: reader.worldTile,
        statsReady: reader.statsReady
    };
    const originalDelayUntil = Execution.delayUntil;
    let statsReady = false;
    const pending: { waitedFor?: () => boolean; release?: (ready: boolean) => void } = {};
    const instance = new StartProbeBot();

    try {
        reader.attached = () => true;
        reader.ingame = () => true;
        reader.sceneState = () => 2;
        reader.worldTile = () => ({ x: 3200, z: 3200, level: 0 });
        reader.statsReady = () => statsReady;
        Execution.delayUntil = cond => {
            pending.waitedFor = cond;
            return new Promise(resolve => {
                pending.release = resolve;
            });
        };

        ScriptRunner.start({
            name: 'XP baseline probe',
            description: 'runner readiness regression fixture',
            create: () => instance
        });
        await settle();

        expect(instance.starts).toBe(0);
        expect(ScriptRunner.paintBot).toBeNull();
        expect(pending.waitedFor?.()).toBe(false);

        statsReady = true;
        expect(pending.waitedFor?.()).toBe(true);
        pending.release?.(true);
        await settle();
        expect(instance.starts).toBe(1);
        expect(ScriptRunner.paintBot).toBe(instance);
    } finally {
        Execution.delayUntil = originalDelayUntil;
        reader.attached = originalReader.attached;
        reader.ingame = originalReader.ingame;
        reader.sceneState = originalReader.sceneState;
        reader.worldTile = originalReader.worldTile;
        reader.statsReady = originalReader.statsReady;
    }
});
