import { expect, test } from 'bun:test';
import { wallLinkHref } from '#/bot/runtime/box.js';

test('the standalone client links to the wall', () => {
    expect(wallLinkHref('')).toBe('./multibox.html');
});

test('a wall slot does not link to the wall it is already inside', () => {
    expect(wallLinkHref('someaccount')).toBeNull();
});
