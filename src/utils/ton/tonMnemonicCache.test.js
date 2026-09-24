import { describe, it, expect, vi, beforeEach } from 'vitest'

// Turetme hesap basina ~70 ms (en kotu ~205 ms). Adres diske yaziliyor ama
// IMZALAMA yolu her seferinde ifadeyi yeniden uretir. Onbellek OTURUM
// bellegindedir: diske YAZILMAZ, cunku turetilmis ifade bir SIRDIR.
describe('cachedTonMnemonicFromSeed', () => {
    beforeEach(() => vi.resetModules())

    it('ayni (ifade, index) icin turetmeyi BIR KEZ calistirir', async () => {
        const spy = vi.fn(async () => 'sonuc bir')
        vi.doMock('./tonFromSeed', () => ({
            TON_FROM_SEED_DOMAIN: 'wats/ton-from-seed/v1',
            tonMnemonicFromSeed: spy,
        }))
        const { cachedTonMnemonicFromSeed } = await import('./tonMnemonicCache')

        expect(await cachedTonMnemonicFromSeed('ana ifade', 0)).toBe('sonuc bir')
        expect(await cachedTonMnemonicFromSeed('ana ifade', 0)).toBe('sonuc bir')
        expect(spy).toHaveBeenCalledTimes(1)
    })

    it('farkli index AYRI girdi', async () => {
        const spy = vi.fn(async (m, i) => `sonuc ${i}`)
        vi.doMock('./tonFromSeed', () => ({
            TON_FROM_SEED_DOMAIN: 'wats/ton-from-seed/v1',
            tonMnemonicFromSeed: spy,
        }))
        const { cachedTonMnemonicFromSeed } = await import('./tonMnemonicCache')

        expect(await cachedTonMnemonicFromSeed('ana ifade', 0)).toBe('sonuc 0')
        expect(await cachedTonMnemonicFromSeed('ana ifade', 1)).toBe('sonuc 1')
        expect(spy).toHaveBeenCalledTimes(2)
    })

    it('farkli ana ifade AYRI girdi', async () => {
        const spy = vi.fn(async (m) => `sonuc ${m}`)
        vi.doMock('./tonFromSeed', () => ({
            TON_FROM_SEED_DOMAIN: 'wats/ton-from-seed/v1',
            tonMnemonicFromSeed: spy,
        }))
        const { cachedTonMnemonicFromSeed } = await import('./tonMnemonicCache')

        expect(await cachedTonMnemonicFromSeed('a', 0)).toBe('sonuc a')
        expect(await cachedTonMnemonicFromSeed('b', 0)).toBe('sonuc b')
        expect(spy).toHaveBeenCalledTimes(2)
    })

    // Hata onbelleklenmemeli: gecici bir hata kalici bir kilide donusurdu.
    it('firlatan turetme ONBELLEKLENMEZ', async () => {
        let cagri = 0
        const spy = vi.fn(async () => {
            cagri += 1
            if (cagri === 1) throw new Error('gecici')
            return 'sonuc'
        })
        vi.doMock('./tonFromSeed', () => ({
            TON_FROM_SEED_DOMAIN: 'wats/ton-from-seed/v1',
            tonMnemonicFromSeed: spy,
        }))
        const { cachedTonMnemonicFromSeed } = await import('./tonMnemonicCache')

        await expect(cachedTonMnemonicFromSeed('a', 0)).rejects.toThrow('gecici')
        expect(await cachedTonMnemonicFromSeed('a', 0)).toBe('sonuc')
    })

    it('clearTonMnemonicCache onbellegi bosaltir', async () => {
        const spy = vi.fn(async () => 'sonuc')
        vi.doMock('./tonFromSeed', () => ({
            TON_FROM_SEED_DOMAIN: 'wats/ton-from-seed/v1',
            tonMnemonicFromSeed: spy,
        }))
        const { cachedTonMnemonicFromSeed, clearTonMnemonicCache } =
            await import('./tonMnemonicCache')

        await cachedTonMnemonicFromSeed('a', 0)
        clearTonMnemonicCache()
        await cachedTonMnemonicFromSeed('a', 0)
        expect(spy).toHaveBeenCalledTimes(2)
    })
})
