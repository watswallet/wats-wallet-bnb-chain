import { describe, it, expect, afterEach, afterAll, vi } from 'vitest'
import { MANIFEST_ENV_KEYS, snapshotManifestEnv, setManifestEnv } from './test-utils/manifestEnv'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Her testte manifest.config.js'i (vite loadEnv) yeniden cozer: yukluyken 15 sn yetmiyor (T29, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

/**
 * TESLIM AG LISTELERI DERLEME KAPISI (gizli-mod cok-ag spec 4.2 kural 4, 6.3). integratorId kapisi gibi mekaniktir:
 * yapilandirma yuklenirken gecersiz oge ya da degismez ihlali HER modda derlemeyi durdurur; ek olarak Gizli mod acik
 * URETIM derlemesinde Para yukle listesi 56'yi icermek zorundadir (Gizli Hesap'a para yuklenemeyen surum cikmaz).
 * manifestDevKey.test.js ile ayni desen: mod process.argv'den cozulur, loadEnv process.env'i dosyanin ustune koyar,
 * bu yuzden her degisken (liste dahil) acikca verilir ve hicbir sonuc .env dosyalarina bagli degildir.
 */
const restoreEnv = snapshotManifestEnv()
afterAll(restoreEnv)

// `atsSale`: VITE_PRIVATE_ATS_SALE degeri (varsayilan 'false'; 1.10 ile uretimde de true olabilir, Para yukle degismezlerine ETKISI YOK).
// `sources`: Gonder kaynagi olan aglar (varsayilan gercek tablo: on agin hepsi). Verilirse privateBridgedSources.hasPrivateSendSource taklit
// edilir (teslim degismezi: Para yuklede her agin en az bir Gonder kaynagi olmali).
async function loadManifest({ build = true, integratorId = '', privacy = 'false', send, fund, atsSale, sources } = {}) {
    vi.resetModules()
    vi.doUnmock('./utils/privacy/privateBridgedSources.js')
    if (sources) vi.doMock('./utils/privacy/privateBridgedSources.js', async (importOriginal) => ({ ...(await importOriginal()), hasPrivateSendSource: (id) => sources.includes(id) }))
    setManifestEnv({ integratorId, privacy, ...(send !== undefined ? { send } : {}), ...(fund !== undefined ? { fund } : {}), ...(atsSale !== undefined ? { atsSale } : {}) })
    const argv = process.argv
    process.argv = build ? ['node', 'vite', 'build'] : ['node', 'vite']
    try {
        return (await import('../manifest.config.js')).default
    } finally {
        process.argv = argv
    }
}

const GECERLI_ID = 'int_' + 'a1b2c3d4e5f6g7h8i9j0k1l2'
const TUM_AGLAR = '1,56,8453,42161,10,137,100,42220,5000,25'

afterEach(() => {
    for (const name of MANIFEST_ENV_KEYS) delete process.env[name]
    vi.doUnmock('./utils/privacy/privateBridgedSources.js')
    vi.resetModules()
})

describe('test yardimcisi', () => {
    it('MANIFEST_ENV_KEYS iki liste degiskenini ve ATS satin alma bayragini icerir; setManifestEnv varsayilan olarak gecerli 56/56 ve KAPALI bayrak verir', () => {
        expect(MANIFEST_ENV_KEYS).toEqual(expect.arrayContaining(['VITE_PRIVATE_SEND_CHAINS', 'VITE_PRIVATE_FUND_CHAINS', 'VITE_PRIVATE_ATS_SALE']))
        setManifestEnv()
        expect([process.env.VITE_PRIVATE_SEND_CHAINS, process.env.VITE_PRIVATE_FUND_CHAINS, process.env.VITE_PRIVATE_ATS_SALE]).toEqual(['56', '56', 'false'])
        setManifestEnv({ send: TUM_AGLAR, fund: '', atsSale: 'true' })
        expect([process.env.VITE_PRIVATE_SEND_CHAINS, process.env.VITE_PRIVATE_FUND_CHAINS, process.env.VITE_PRIVATE_ATS_SALE]).toEqual([TUM_AGLAR, '', 'true'])
    })
})

describe('teslim ag listeleri kapisi: gecersiz oge her modda derlemeyi durdurur', () => {
    it.each([true, false])('build=%s: Gonder listesinde gecersiz oge hata verir ve degisken adini tasir', async (build) => {
        for (const send of ['56,abc', '56,99999', '56,0', '56,,1', '056', '56,1.5']) {
            await expect(loadManifest({ build, send, fund: '' }), `send=${send}`).rejects.toThrow(/VITE_PRIVATE_SEND_CHAINS/)
        }
    })

    it.each([true, false])('build=%s: Para yukle listesinde gecersiz oge hata verir', async (build) => {
        for (const fund of ['56,abc', '99999', '56,']) {
            await expect(loadManifest({ build, send: TUM_AGLAR, fund }), `fund=${fund}`).rejects.toThrow(/VITE_PRIVATE_FUND_CHAINS/)
        }
    })
})

describe('teslim ag listeleri kapisi: degismez ihlali her modda derlemeyi durdurur', () => {
    it.each([true, false])('build=%s: Para yukle Gonder altkumesi degilse hata', async (build) => {
        await expect(loadManifest({ build, send: '1', fund: '56' })).rejects.toThrow(/fund-not-in-send/)
    })

    it.each([true, false])('build=%s: BSC disi Para yukle 56 olmadan hata', async (build) => {
        await expect(loadManifest({ build, send: '56,1', fund: '1' })).rejects.toThrow(/fund-needs-bsc/)
    })

    // Teslim degismezi (1.10, eski ATS satisi sarti (c) yerine): Para yuklede her agin en az bir Gonder kaynagi olmali, cunku Gizli Hesap'a
    // teslim edilen varlik yalniz Gonder ile cikabilir. ATS satisi bayragi ARTIK sart degil: kapaliyken de BSC disi Para yukle derlenir.
    it.each([true, false])('build=%s: BSC disi Para yukle ATS satisi bayragi ne olursa olsun derlenir (Gonder kaynagi varken)', async (build) => {
        for (const atsSale of [undefined, 'false', '', 'TRUE', '1', 'yes']) {
            // yalniz uretim ONCEDEN reddettigi 'true' haric; 'TRUE' tam "true" degildir
            const manifest = await loadManifest({ build, send: '56,1', fund: '56,1', atsSale })
            expect(manifest.manifest_version, String(atsSale)).toBe(3)
        }
    })

    it.each([true, false])('build=%s: Para yuklede Gonder kaynagi olmayan ag varsa hata (fund-no-send-source)', async (build) => {
        await expect(loadManifest({ build, send: '56,1,8453', fund: '56,1,8453', sources: [56, 8453] })).rejects.toThrow(/fund-no-send-source/)
        await expect(loadManifest({ build, send: '56,1', fund: '56,1', sources: [] })).rejects.toThrow(/fund-no-send-source/)
        // yalniz Para yukle'deki aglar icin sart: Gonder listesinde kaynaksiz ag olabilir
        expect((await loadManifest({ build, send: '56,1', fund: '56', sources: [56] })).manifest_version).toBe(3)
    })

    it('gelistirme: bayrak ACIK: BSC disi Para yukle derlenir; 56 yoksa ya da Gonder altkumesi degilse yine hata', async () => {
        const manifest = await loadManifest({ build: false, send: TUM_AGLAR, fund: TUM_AGLAR, atsSale: 'true' })
        expect(manifest.manifest_version).toBe(3)
        await expect(loadManifest({ build: false, send: TUM_AGLAR, fund: '1,8453', atsSale: 'true' })).rejects.toThrow(/fund-needs-bsc/)
        await expect(loadManifest({ build: false, send: '56', fund: '56,1', atsSale: 'true' })).rejects.toThrow(/fund-not-in-send/)
    })

    // 6.11: 1.10 ile ATS satisi uretimde acildi; bayragin hicbir degeri derlemeyi durdurmaz.
    it('VITE_PRIVATE_ATS_SALE her degerle derlenir: uretimde true dahil, gelistirmede de', async () => {
        expect((await loadManifest({ build: true, atsSale: 'true' })).manifest_version).toBe(3)
        expect((await loadManifest({ build: true, send: TUM_AGLAR, fund: TUM_AGLAR, atsSale: 'true' })).manifest_version).toBe(3)
        expect((await loadManifest({ build: false, atsSale: 'true' })).manifest_version).toBe(3)
        for (const atsSale of [undefined, 'false', '', 'TRUE']) {
            expect((await loadManifest({ build: true, atsSale })).manifest_version, String(atsSale)).toBe(3)
        }
    })

    it('gecerli ciftler derlenir: bos, yalniz BSC, on ag Gonder + BSC Para yukle, on ag Gonder + on ag Para yukle', async () => {
        for (const [send, fund] of [['', ''], ['56', '56'], [TUM_AGLAR, '56'], [TUM_AGLAR, TUM_AGLAR], [TUM_AGLAR, ''], ['8453', '']]) {
            const manifest = await loadManifest({ build: true, send, fund })
            expect(manifest.manifest_version, `${send} | ${fund}`).toBe(3)
        }
    })
})

describe('teslim ag listeleri kapisi: Gizli mod acik URETIM derlemesinde Para yukle 56 icerir (6.3)', () => {
    it('uretim + Gizli mod acik + Para yukle bos: hata', async () => {
        await expect(loadManifest({ build: true, privacy: 'true', integratorId: GECERLI_ID, send: '56', fund: '' })).rejects.toThrow(/VITE_PRIVATE_FUND_CHAINS/)
        await expect(loadManifest({ build: true, privacy: 'true', integratorId: GECERLI_ID, send: '', fund: '' })).rejects.toThrow(/VITE_PRIVATE_FUND_CHAINS/)
    })

    it('uretim + Gizli mod acik + Para yukle 56 iceriyor: derlenir', async () => {
        const manifest = await loadManifest({ build: true, privacy: 'true', integratorId: GECERLI_ID, send: TUM_AGLAR, fund: '56' })
        expect(manifest.manifest_version).toBe(3)
    })

    it('gelistirme + Gizli mod acik + Para yukle bos: derlenir (kural yalniz uretimde)', async () => {
        const manifest = await loadManifest({ build: false, privacy: 'true', send: '', fund: '' })
        expect(manifest.manifest_version).toBe(3)
    })

    // 1.10 magaza surumu: Gizli mod ACIK ve on ag Para yukle uretim derlemesinde derlenir (ATS satisi acik; her agin Gonder kaynagi var).
    it('uretim + Gizli mod acik + on ag Para yukle: ATS satisi acik ya da kapali derlenir; kaynaksiz ag derlemeyi durdurur', async () => {
        const uretim = { build: true, privacy: 'true', integratorId: GECERLI_ID, send: TUM_AGLAR }
        expect((await loadManifest({ ...uretim, fund: TUM_AGLAR, atsSale: 'false' })).manifest_version).toBe(3)
        expect((await loadManifest({ ...uretim, fund: TUM_AGLAR, atsSale: 'true' })).manifest_version).toBe(3)
        await expect(loadManifest({ ...uretim, fund: TUM_AGLAR, sources: [56, 1, 8453] })).rejects.toThrow(/fund-no-send-source/)
        expect((await loadManifest({ ...uretim, fund: '56' })).manifest_version).toBe(3)
    })

    it('uretim + Gizli mod KAPALI + bos listeler: derlenir (bugunku magaza yapilandirmasi)', async () => {
        const manifest = await loadManifest({ build: true, privacy: 'false', send: '', fund: '' })
        expect(manifest.manifest_version).toBe(3)
    })
})
