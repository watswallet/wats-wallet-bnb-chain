import { describe, it, expect, afterEach, vi } from 'vitest'

// Bayrak KAPALIYKEN Solana'nin zincir olarak COZULEMEDIGINI olcer.
// Kapali-durum tek yerden (utils/featureFlags) geldigi icin her senaryo
// resetModules + taze import ister.
async function withFlagOff(path) {
    vi.resetModules()
    vi.stubEnv('VITE_SOLANA_ENABLED', 'false')
    return import(path)
}

async function withFlagOn(path) {
    vi.resetModules()
    vi.stubEnv('VITE_SOLANA_ENABLED', 'true')
    return import(path)
}

const SOLANA_ID = 'solana-mainnet'

describe('bayrak kapaliyken zincir cozumlemesi Solana gormez', () => {
    afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

    it('ALL_CHAINS Solana kaydini tasimaz', async () => {
        const { ALL_CHAINS } = await withFlagOff('../data/chains.js')
        expect(ALL_CHAINS.some((c) => c.chainId === SOLANA_ID)).toBe(false)
    })

    it('LISTED_CHAINS Solana kaydini tasimaz -- ag secicilerde gorunmez', async () => {
        const { LISTED_CHAINS } = await withFlagOff('../data/chains.js')
        expect(LISTED_CHAINS.some((c) => c.chainId === SOLANA_ID)).toBe(false)
    })

    it('isResolvableChainId Solana kimligini REDDEDER', async () => {
        const mod = await withFlagOff('./chainIdentity.js')
        expect(mod.isResolvableChainId(SOLANA_ID)).toBe(false)
    })

    it('explorerSlug Solana icin kayit BULAMAZ', async () => {
        const mod = await withFlagOff('./explorer.js')
        expect(mod.explorerSlug(SOLANA_ID)).toBe(null)
    })

    it('bayrak ACIKKEN ayni kapilar Solana kaydini GECIRIR -- kapinin bayraga bagli oldugunu kanitlar', async () => {
        const { ALL_CHAINS } = await withFlagOn('../data/chains.js')
        expect(ALL_CHAINS.some((c) => c.chainId === SOLANA_ID)).toBe(true)
        const ident = await withFlagOn('./chainIdentity.js')
        expect(ident.isResolvableChainId(SOLANA_ID)).toBe(true)
    })
})
