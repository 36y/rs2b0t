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

test('render controls appear below the log and persist per bot', () => {
    (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('http://localhost:8081/bot.html?box=alice');
    localStorage.setItem('rs2b0t:alice:rendererEnabled', '0');
    const root = document.createElement('div');
    document.body.appendChild(root);
    const enabled: boolean[] = [];
    const frameListeners: Array<() => void> = [];
    const host = {
        selfTestMissing: [],
        addDrawListener: () => {},
        addFrameListener: (listener: () => void) => frameListeners.push(listener)
    } as unknown as BotHostImpl;

    new BotPanel(root, host, {
        enabled: () => true,
        setEnabled: value => enabled.push(value)
    });

    const sections = Array.from(root.querySelectorAll(':scope > .rs2b0t-section'));
    const headings = sections.map(section => section.querySelector('.rs2b0t-section-title')?.textContent);
    const rendering = sections.at(-1)!;
    const toggle = rendering.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(headings.slice(-2)).toEqual(['log', 'rendering']);
    expect(toggle.checked).toBe(false);
    expect(rendering.querySelector('select')).toBeNull();
    expect(enabled).toEqual([false]);
    expect(frameListeners).toHaveLength(1);

    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(enabled).toEqual([false, true]);
    expect(localStorage.getItem('rs2b0t:alice:rendererEnabled')).toBe('1');
});
