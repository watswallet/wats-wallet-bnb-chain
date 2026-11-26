import { describe, it, expect, afterEach, afterAll, vi } from 'vitest'
import { MANIFEST_ENV_KEYS, snapshotManifestEnv, setManifestEnv } from './test-utils/manifestEnv'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Her testte manifest.config.js'i (vite loadEnv) yeniden cozer: yukluyken 15 sn yetmiyor (T29, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

/**
 * SOLANA URETIM DERLEME KILIDI (birlesme hazirligi B2). Solana main ve magaza surumunde KAPALI; .env.production degeri
 * buildConfigGuards.test.js'te kilitli. Bu kural IKINCI halkadir: deger dosyadan degil kabuk degiskeninden ya da
 * .env.production.local / .env.local'den sizarsa (loadEnv onekli process.env'i dosyanin USTUNE koyar) uretim derlemesi durur.
 *
 * DENEME derlemesi (Solana acik, magaza paketi DEGIL) IKINCI ve ayri bir acik onayla gecer: WATS_SOLANA_DENEME=1.
 * Onek VITE_ DEGIL: loadEnv onu hicbir .env dosyasindan okumaz (yalniz kabuktan gelir) ve istemci paketine girmez.
 * Gelistirme modu (npm run dev, npm run build:dev -> -dev.zip) kilitten muaftir.
 *
 * manifestDevKey.test.js ile ayni desen: mod process.argv'den cozulur ve her degisken acikca verilir.
 */
const restoreEnv = snapshotManifestEnv()
afterAll(restoreEnv)

const URETIM = ['node', 'vite', 'build']

async function loadManifest({ argv = URETIM, solana, solanaDeneme } = {}) {
    vi.resetModules()
    setManifestEnv({ ...(solana !== undefined ? { solana } : {}), ...(solanaDeneme !== undefined ? { solanaDeneme } : {}) })
    const eski = process.argv
    process.argv = argv
    try {
        return (await import('../manifest.config.js')).default
    } finally {
        process.argv = eski
    }
}

const solanaKaydi = (manifest) =>
    (manifest.content_scripts || []).find((cs) => (cs.js || []).some((f) => f.includes('solanaInjected')))

afterEach(() => {
    for (const name of MANIFEST_ENV_KEYS) delete process.env[name]
    vi.restoreAllMocks()
    vi.resetModules()
})

describe('test yardimcisi', () => {
    it('MANIFEST_ENV_KEYS Solana bayragini ve DENEME onayini icerir; setManifestEnv varsayilan olarak KAPALI bayrak ve onaysiz verir', () => {
        expect(MANIFEST_ENV_KEYS).toEqual(expect.arrayContaining(['VITE_SOLANA_ENABLED', 'WATS_SOLANA_DENEME']))
        setManifestEnv()
        expect(process.env.VITE_SOLANA_ENABLED).toBe('false')
        expect(process.env.WATS_SOLANA_DENEME).toBeUndefined()
        setManifestEnv({ solana: 'true', solanaDeneme: '1' })
        expect([process.env.VITE_SOLANA_ENABLED, process.env.WATS_SOLANA_DENEME]).toEqual(['true', '1'])
    })
})

describe('Solana uretim derleme kilidi (manifest.config.js)', () => {
    it.each([
        ['vite build', URETIM],
        ['--mode production', ['node', 'vite', 'build', '--mode', 'production']],
        ['--mode=production', ['node', 'vite', 'build', '--mode=production']],
        ['-m production', ['node', 'vite', 'build', '-m', 'production']],
    ])('%s + VITE_SOLANA_ENABLED=true + onay YOK: derleme durur', async (_ad, argv) => {
        await expect(loadManifest({ argv, solana: 'true' })).rejects.toThrow(/VITE_SOLANA_ENABLED uretim derlemesinde true olamaz/)
    })

    it("hata metni Solana'yi BILEREK acmanin ve DENEME derlemesinin yolunu soyler", async () => {
        const hata = await loadManifest({ solana: 'true' }).then(() => null, (e) => e)
        expect(hata).toBeInstanceOf(Error)
        expect(hata.message).toContain('docs/solana-acma-kapanis.md Bolum 2')
        expect(hata.message).toContain('client/src/buildConfigGuards.test.js')
        expect(hata.message).toContain('VITE_SOLANA_ENABLED=true WATS_SOLANA_DENEME=1 npm run build')
    })

    it('uretim + bayrak KAPALI: derlenir, solanaInjected.js kaydi YOK (magaza derlemesi)', async () => {
        const manifest = await loadManifest({ solana: 'false' })
        expect(solanaKaydi(manifest)).toBeUndefined()
    })

    it('uretim + bayrak KAPALI + DENEME onayi: onay tek basina hicbir sey acmaz', async () => {
        const manifest = await loadManifest({ solana: 'false', solanaDeneme: '1' })
        expect(solanaKaydi(manifest)).toBeUndefined()
    })

    it('DENEME derlemesi: uretim + bayrak ACIK + WATS_SOLANA_DENEME=1 derlenir, Solana kaydi VAR ve uyari basilir', async () => {
        const uyari = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const manifest = await loadManifest({ solana: 'true', solanaDeneme: '1' })
        expect(solanaKaydi(manifest)).toBeTruthy()
        expect(uyari).toHaveBeenCalledWith(expect.stringContaining('Solana DENEME derlemesi'))
    })

    it.each(['true', 'yes', '0', 'TRUE', ' 1'])('onay KATI: WATS_SOLANA_DENEME=%j kabul edilmez, derleme durur', async (onay) => {
        await expect(loadManifest({ solana: 'true', solanaDeneme: onay })).rejects.toThrow(/VITE_SOLANA_ENABLED/)
    })

    it.each([
        ['vite (dev sunucusu)', ['node', 'vite']],
        ['build --mode development', ['node', 'vite', 'build', '--mode', 'development']],
    ])('gelistirme modu muaf: %s + bayrak ACIK + onaysiz derlenir', async (_ad, argv) => {
        const manifest = await loadManifest({ argv, solana: 'true' })
        expect(solanaKaydi(manifest)).toBeTruthy()
    })
})
