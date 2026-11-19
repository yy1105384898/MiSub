import yaml from 'js-yaml';
import { validatePublicNetworkUrl } from '../security-utils.js';
import { parseNodeList } from '../utils/node-parser.js';

const MAX_PROVIDERS = 8;
const MAX_PROVIDER_BYTES = 2 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 5000;

async function fetchProviderNodes(url, options) {
    try {
        const response = await fetch(url, {
            redirect: 'manual',
            signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        });
        if (!response.ok || !response.body) return [];

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;
        const chunks = [];
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                bytes += value.byteLength;
                if (bytes > MAX_PROVIDER_BYTES) {
                    await reader.cancel();
                    return [];
                }
                chunks.push(decoder.decode(value, { stream: true }));
            }
            chunks.push(decoder.decode());
        } finally {
            reader.releaseLock();
        }
        return parseNodeList(chunks.join(''), options);
    } catch {
        // A failed provider must not discard the main subscription's nodes.
        return [];
    }
}

// Origins are deployment configuration, never taken from the upstream YAML.
export async function parseSubscriptionWithProviders(text, { providerOrigins = '', ...options } = {}) {
    const nodes = parseNodeList(text, options);
    if (!providerOrigins || !text.includes('proxy-providers')) return nodes;

    let providers;
    try {
        providers = yaml.load(text)?.['proxy-providers'];
    } catch {
        return nodes;
    }
    if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return nodes;

    const origins = new Set(providerOrigins.split(',').map((origin) => origin.trim()));
    const urls = new Set();
    for (const provider of Object.values(providers)) {
        if (provider?.type !== 'http' || typeof provider.url !== 'string') continue;
        const { ok, url } = validatePublicNetworkUrl(provider.url);
        if (!ok || url.username || url.password || !origins.has(url.origin)) continue;
        url.hash = '';
        urls.add(url.href);
        if (urls.size >= MAX_PROVIDERS) break;
    }

    const providerNodes = await Promise.all(Array.from(urls, (url) => fetchProviderNodes(url, options)));
    const seen = new Set(nodes.map((node) => node.url));
    for (const node of providerNodes.flat()) {
        if (seen.has(node.url)) continue;
        seen.add(node.url);
        nodes.push(node);
    }
    return nodes;
}
