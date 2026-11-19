import { afterEach, expect, it, vi } from 'vitest';
import { parseSubscriptionWithProviders } from '../../functions/modules/subscription/clash-providers.js';

afterEach(() => vi.unstubAllGlobals());

it('merges allowed providers independently of groups and keeps inline nodes when one fails', async () => {
    const inline = '{name: Inline, type: socks5, server: 1.1.1.1, port: 1080}';
    const extra = '{name: Extra, type: socks5, server: 1.0.0.1, port: 1080}';
    const fetchMock = vi.fn(async (url) =>
        url.endsWith('/good')
            ? new Response('proxies:\n  - ' + inline + '\n  - ' + extra)
            : new Response(null, { status: 503 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const nodes = await parseSubscriptionWithProviders(`
proxies:
  - ${inline}
proxy-groups:
  - {name: Selected, type: select, use: [broken]}
proxy-providers:
  unused: {type: http, url: https://public.example/good}
  broken: {type: http, url: https://public.example/bad}
  private: {type: http, url: http://127.0.0.1/secret}
  unknown: {type: http, url: https://unknown.example/provider}
  file: {type: file, path: /private}
`, { providerOrigins: 'https://public.example,http://127.0.0.1' });

    expect(nodes.map((node) => node.name)).toEqual(['Inline', 'Extra']);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        'https://public.example/good',
        'https://public.example/bad',
    ]);
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
});
