/* eslint-disable @typescript-eslint/no-explicit-any -- API singletons are patched to
   reproduce a server dialogue transition without a live client. */
import { afterEach, expect, test } from 'bun:test';
import { EventSignal } from '#/bot/api/EventSignal.js';
import { Execution } from '#/bot/api/Execution.js';
import { ChatDialog } from '#/bot/api/hud/ChatDialog.js';
import { Npcs } from '#/bot/api/queries/Npcs.js';
import { talkThrough } from '#/bot/quests/exec/primitives.js';

const originals = {
    canContinue: ChatDialog.canContinue,
    continueDialog: ChatDialog.continue,
    delayTicks: Execution.delayTicks,
    delayUntil: Execution.delayUntil,
    dialogOpen: ChatDialog.isOpen,
    eventPending: EventSignal.pending,
    npcQuery: Npcs.query,
    options: ChatDialog.options
};

afterEach(() => {
    (ChatDialog as any).canContinue = originals.canContinue;
    (ChatDialog as any).continue = originals.continueDialog;
    (Execution as any).delayTicks = originals.delayTicks;
    (Execution as any).delayUntil = originals.delayUntil;
    (ChatDialog as any).isOpen = originals.dialogOpen;
    (EventSignal as any).pending = originals.eventPending;
    (Npcs as any).query = originals.npcQuery;
    (ChatDialog as any).options = originals.options;
});

test("talkThrough accepts Fred's continue-only final response as an opened dialogue", async () => {
    let canContinue = false;
    let interactions = 0;
    let continues = 0;
    const logs: string[] = [];
    const npc = {
        actions: () => ['Talk-to'],
        interact: async () => {
            interactions++;
            canContinue = true;
            return true;
        }
    };

    (ChatDialog as any).isOpen = () => false;
    (ChatDialog as any).canContinue = () => canContinue;
    (ChatDialog as any).continue = async () => {
        continues++;
        canContinue = false;
        return true;
    };
    (ChatDialog as any).options = () => [];
    (EventSignal as any).pending = () => false;
    (Execution as any).delayUntil = async (condition: () => boolean) => condition();
    (Execution as any).delayTicks = async () => {};
    (Npcs as any).query = () => ({
        name: () => ({
            where: () => ({ nearest: () => npc })
        })
    });

    expect(await talkThrough('Fred the Farmer', [], message => logs.push(message))).toBe(true);
    expect(interactions).toBe(1);
    expect(continues).toBe(1);
    expect(logs).not.toContain("'Fred the Farmer' never opened a dialogue");
});
