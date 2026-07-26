import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { DomSlotOps, orderedSlotElements } from '#/bot/multibox/DomSlotOps.js';
import type { SlotHandle } from '#/bot/multibox/types.js';

let handles: SlotHandle[] = [];

beforeEach(() => {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('http://localhost:8081/multibox.html');
    document.body.innerHTML = '<div id="rail"><div id="add"></div><div id="resources"></div></div>';
    handles = [];
});

afterEach(() => {
    for (const handle of handles) {
        handle.destroy();
    }
    document.body.innerHTML = '';
});

describe('DomSlotOps', () => {
    test('reorders visually without moving iframe ancestors in the DOM', () => {
        const rail = document.getElementById('rail')!;
        const add = document.getElementById('add')!;
        const ops = new DomSlotOps(rail, add);
        const alice = ops.spawn({ username: 'alice', password: '' });
        const bob = ops.spawn({ username: 'bob', password: '' });
        const carol = ops.spawn({ username: 'carol', password: '' });
        handles.push(alice, bob, carol);

        const originalDomOrder = Array.from(rail.querySelectorAll<HTMLElement>('.mbx-slot'));
        const originalFrames = originalDomOrder.map(slot => slot.querySelector('iframe'));

        ops.move(carol, alice);

        expect(Array.from(rail.querySelectorAll('.mbx-slot'))).toEqual(originalDomOrder);
        expect(originalDomOrder.map(slot => slot.querySelector('iframe'))).toEqual(originalFrames);
        expect(orderedSlotElements(rail)).toEqual([originalDomOrder[2], originalDomOrder[0], originalDomOrder[1]]);

        ops.move(carol, null);

        expect(Array.from(rail.querySelectorAll('.mbx-slot'))).toEqual(originalDomOrder);
        expect(orderedSlotElements(rail)).toEqual(originalDomOrder);
    });

    test('keeps newly spawned slots after the current visual order', () => {
        const rail = document.getElementById('rail')!;
        const add = document.getElementById('add')!;
        const ops = new DomSlotOps(rail, add);
        const alice = ops.spawn({ username: 'alice', password: '' });
        const bob = ops.spawn({ username: 'bob', password: '' });
        handles.push(alice, bob);
        const [aliceEl, bobEl] = orderedSlotElements(rail);

        ops.move(bob, alice);
        const carol = ops.spawn({ username: 'carol', password: '' });
        handles.push(carol);

        const carolEl = Array.from(rail.querySelectorAll<HTMLElement>('.mbx-slot')).find(slot => slot.querySelector('iframe')?.title === 'carol')!;
        expect(orderedSlotElements(rail)).toEqual([bobEl, aliceEl, carolEl]);
    });
});
