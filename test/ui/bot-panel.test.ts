import { beforeEach, expect, test } from 'bun:test';
import type { BotHostImpl } from '#/bot/BotHost.js';
import BotPanel from '#/bot/ui/BotPanel.js';

beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    sessionStorage.clear();
});

test('sidebar omits chat and low-value status rows', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const host = {
        selfTestMissing: [],
        addDrawListener: () => {}
    } as unknown as BotHostImpl;

    new BotPanel(root, host);

    const sections = Array.from(root.children).filter(node => node.classList.contains('rs2b0t-section'));
    const title = (section: Element): string =>
        Array.from(section.children).find(node => node.classList.contains('rs2b0t-section-title'))?.textContent ?? '';

    expect(sections.map(title)).toEqual(['script', 'parameters', 'status', 'log']);
    expect(root.querySelector('.rs2b0t-chat')).toBeNull();

    const status = sections.find(section => title(section) === 'status');
    expect(status).toBeDefined();
    expect(Array.from(status!.querySelectorAll('.rs2b0t-key'), node => node.textContent)).toEqual(['state', 'player', 'tile', 'modals']);
});
