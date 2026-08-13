import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('#/client/3rdparty/audio.js', () => ({ playWave: async (): Promise<void> => {}, setWaveVolume: (): void => {} }));
mock.module('#/client/3rdparty/tinymidipcm.js', () => ({ playMidi: (): void => {}, setMidiVolume: (): void => {}, stopMidi: (): void => {} }));

const { RandomEventGuardian } = await import('#/bot/runtime/RandomEventGuardian.js');
const { RandomEvents } = await import('#/bot/runtime/randomevents/RandomEvents.js');
const { Game } = await import('#/bot/api/game/Game.js');
const { BotHost } = await import('#/bot/runtime/BotHost.js');
const { Execution } = await import('#/bot/api/execution/Execution.js');
const { Scheduler } = await import('#/bot/runtime/Scheduler.js');
const { ScriptContext } = await import('#/bot/runtime/ScriptContext.js');
const { ScriptRunner } = await import('#/bot/runtime/ScriptRunner.js');

// Why: an event at a loop boundary parks the iteration on `delayUntil(detect() === null)` with loopInFlight true, so a guardian that waits for the loop to yield deadlocks against it.
describe('RandomEventGuardian with a parked script loop', () => {
    let origDetect: typeof RandomEvents.detect;
    let origHandle: typeof RandomEvents.handle;
    let origReady: typeof Game.sceneReady;
    let origTickCount: PropertyDescriptor | undefined;
    let tick: number;

    const pumpFrames = async (n: number): Promise<void> => {
        for (let i = 0; i < n; i++) {
            BotHost.onFrame();
            await Promise.resolve();
            await Promise.resolve();
        }
    };

    beforeEach(() => {
        tick = 50_000;
        origDetect = RandomEvents.detect;
        origHandle = RandomEvents.handle;
        origReady = Game.sceneReady;
        Game.sceneReady = (): boolean => true;
        origTickCount = Object.getOwnPropertyDescriptor(BotHost, 'tickCount');
        Object.defineProperty(BotHost, 'tickCount', { get: () => tick, configurable: true });
        RandomEventGuardian.enable();
    });

    afterEach(() => {
        RandomEvents.detect = origDetect;
        RandomEvents.handle = origHandle;
        Game.sceneReady = origReady;
        if (origTickCount) {
            Object.defineProperty(BotHost, 'tickCount', origTickCount);
        }
        Scheduler.active = null;
        ScriptRunner.ctx = null;
    });

    test('handles the event while the loop iteration is parked awaiting it', async () => {
        let eventActive = true;
        let handleCalls = 0;
        RandomEvents.detect = (): ReturnType<typeof origDetect> =>
            (eventActive ? { kind: 'lamp', name: 'lamp' } : null) as ReturnType<typeof origDetect>;
        RandomEvents.handle = (async (): Promise<boolean> => {
            handleCalls++;
            eventActive = false;
            return true;
        }) as typeof origHandle;

        const ctx = new ScriptContext();
        ctx.state = 'running';
        ctx.loopInFlight = true;
        Scheduler.active = ctx;
        ScriptRunner.ctx = ctx;

        // Supervisor's event-wait iteration: parked on the script queue until
        // the guardian clears the event.
        const parked = Execution.delayUntil(() => !eventActive, 60_000);

        tick++;
        await pumpFrames(6);

        expect(handleCalls).toBe(1);
        expect(eventActive).toBe(false);
        await expect(parked).resolves.toBe(true);
    });
});
