import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Bayrak modul YUKLENIRKEN sabitlenir (build-time sabit olabilmesi icin).
// Bu yuzden her senaryo resetModules + taze import ister.
async function loadFlags(value) {
    vi.resetModules()
    if (value === undefined) vi.stubEnv('VITE_SOLANA_ENABLED', undefined)
    else vi.stubEnv('VITE_SOLANA_ENABLED', value)
    return import('./featureFlags.js')
}

async function loadChains(value) {
    vi.resetModules()
    if (value === undefined) vi.stubEnv('VITE_SOLANA_ENABLED', undefined)
    else vi.stubEnv('VITE_SOLANA_ENABLED', value)
    const mod = await import('../data/supportedChains.js')
    return mod.default
}

describe('SOLANA_ENABLED bayragi', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

    it('ortam degiskeni yoksa KAPALI olur -- acik varsaymak Solana kodunu sessizce yayina sokar', async () => {
        const { SOLANA_ENABLED } = await loadFlags(undefined)
        expect(SOLANA_ENABLED).toBe(false)
    })

    it("'false' degerinde kapali olur", async () => {
        const { SOLANA_ENABLED } = await loadFlags('false')
        expect(SOLANA_ENABLED).toBe(false)
    })

    it("yalnizca 'true' metni bayragi acar -- '1'/'yes' gibi degerler ACMAZ", async () => {
        expect((await loadFlags('1')).SOLANA_ENABLED).toBe(false)
        expect((await loadFlags('yes')).SOLANA_ENABLED).toBe(false)
        expect((await loadFlags('true')).SOLANA_ENABLED).toBe(true)
    })
})

describe('desteklenen zincir listesi bayraga baglidir', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

    it('bayrak KAPALIYKEN Solana kaydi listede YOKTUR', async () => {
        const chains = await loadChains('false')
        expect(chains.some((c) => c.vm === 'solana')).toBe(false)
        expect(chains.some((c) => c.chainId === 'solana-mainnet')).toBe(false)
    })

    it('bayrak kapaliyken EVM ve TON kayitlari AYNEN kalir', async () => {
        const chains = await loadChains('false')
        expect(chains.some((c) => Number(c.chainId) === 1)).toBe(true)
        expect(chains.some((c) => c.kind === 'ton')).toBe(true)
    })

    it('bayrak ACIKKEN Solana kaydi listededir', async () => {
        const chains = await loadChains('true')
        expect(chains.some((c) => c.chainId === 'solana-mainnet')).toBe(true)
    })
})
