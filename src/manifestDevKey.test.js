import { describe, it, expect, afterEach, afterAll, vi } from 'vitest'
import { MANIFEST_ENV_KEYS, snapshotManifestEnv, setManifestEnv } from './test-utils/manifestEnv'
import { heavyBackgroundTimeouts } from './test-utils/heavyBackgroundTimeouts.js'

// Her testte manifest.config.js'i (vite loadEnv) yeniden cozer: yukluyken 15 sn yetmiyor (T29, test-utils/heavyBackgroundTimeouts.js).
heavyBackgroundTimeouts()

/**
 * GELISTIRME ANAHTARI (Gizli mod / SilentSwap, Plan 2 Task 1).
 *
 * SilentSwap integratorId'yi birebir chrome-extension://<id> origin'ine baglar. Paketlenmemis
 * gelistirme kopyasinin kimligi klasor yoluna gore degisir; magaza kaydinin GENEL anahtari
 * yalniz GELISTIRME derlemesine yazilirsa iki kopya ayni kimligi tasir. URETIM paketine `key`
 * YAZILMAZ: magaza paketinin kimligini bu dosya belirlemez.
 *
 * manifest.config.js NODE tarafinda calisir: mod process.argv'den cozulur (`--mode x`,
 * `--mode=x`, `-m x`; hicbiri yoksa `build` -> production, aksi halde development) ve loadEnv
 * onekli process.env degerlerini .env dosyalarinin USTUNE koyar (bos dizge de ustune biner). Bu
 * yuzden testler argv'yi VE bagli olduklari her degiskeni (anahtar, Gizli mod bayragi, integrator
 * kimligi) kendileri kurar; verilmeyenler 'kapali' / 'bos' varsayilir. Hicbir sonuc .env,
 * .env.production ya da .env.*.local icerigine bagli degildir: .env.production'da Gizli mod
 * acilsa ya da kisisel dosyada yazim hatasi olsa anahtar/mod testleri bundan etkilenmez.
 *
 * Ayni dosya integratorId kapisini da tasir (Task 19): bicimi bozuk id her modda, bos id ise
 * Gizli mod acik URETIM derlemesinde yapilandirma yuklenirken hata verir.
 */
const restoreEnv = snapshotManifestEnv()
afterAll(restoreEnv)

async function loadManifest({ key = '', build, argv: customArgv, integratorId = '', privacy = 'false' }) {
    vi.resetModules()
    // Her cagri temiz baslar: onceki testin degeri sizmasin; UC degisken de HER ZAMAN acikca verilir,
    // boylece loadEnv hicbir .env dosyasindan deger okumaz (bos dizge de dosyanin ustune biner).
    setManifestEnv({ key, integratorId, privacy })
    const argv = process.argv
    process.argv = customArgv || (build ? ['node', 'vite', 'build'] : ['node', 'vite'])
    try {
        return (await import('../manifest.config.js')).default
    } finally {
        process.argv = argv
    }
}

const GECERLI_ID = 'int_' + 'a1b2c3d4e5f6g7h8i9j0k1l2'

afterEach(() => {
    for (const name of MANIFEST_ENV_KEYS) delete process.env[name]
    vi.resetModules()
})

describe('manifest gelistirme anahtari yalniz gelistirme derlemesinde', () => {
    it('gelistirme + anahtar tanimli: manifest key tasir', async () => {
        const manifest = await loadManifest({ key: 'TESTANAHTARI', build: false })
        expect(manifest.key).toBe('TESTANAHTARI')
    })

    it('gelistirme + anahtar bos: key alani HIC yoktur', async () => {
        const manifest = await loadManifest({ key: '', build: false })
        expect('key' in manifest).toBe(false)
    })

    it('uretim derlemesi + anahtar tanimli: key YAZILMAZ', async () => {
        const manifest = await loadManifest({ key: 'TESTANAHTARI', build: true })
        expect('key' in manifest).toBe(false)
    })
})

describe('mod bayragi uc bicimde de okunur (npm run build:dev yolu)', () => {
    it.each([
        ['--mode development', ['node', 'vite', 'build', '--mode', 'development']],
        ['--mode=development', ['node', 'vite', 'build', '--mode=development']],
        ['-m development', ['node', 'vite', 'build', '-m', 'development']],
    ])('%s + anahtar tanimli: key YAZILIR', async (_ad, argv) => {
        const manifest = await loadManifest({ key: 'TESTANAHTARI', argv })
        expect(manifest.key).toBe('TESTANAHTARI')
    })

    it.each([
        ['--mode production', ['node', 'vite', 'build', '--mode', 'production']],
        ['--mode=production', ['node', 'vite', 'build', '--mode=production']],
        ['-m production', ['node', 'vite', 'build', '-m', 'production']],
    ])('%s + anahtar tanimli: key YAZILMAZ', async (_ad, argv) => {
        const manifest = await loadManifest({ key: 'TESTANAHTARI', argv })
        expect('key' in manifest).toBe(false)
    })
})

describe('SilentSwap integratorId kapisi', () => {
    it('bicimi bozuk id her modda yapilandirma yuklenirken hata verir', async () => {
        await expect(loadManifest({ build: false, integratorId: 'int_kisa' })).rejects.toThrow(/VITE_SILENTSWAP_INTEGRATOR_ID/)
        await expect(loadManifest({ build: true, integratorId: GECERLI_ID.toUpperCase() })).rejects.toThrow(/VITE_SILENTSWAP_INTEGRATOR_ID/)
    })

    it('uretim + Gizli mod acik + bos id: hata verir', async () => {
        await expect(loadManifest({ build: true, privacy: 'true', integratorId: '' })).rejects.toThrow(/VITE_SILENTSWAP_INTEGRATOR_ID/)
    })

    it('uretim + Gizli mod acik + gecerli id: manifest uretilir', async () => {
        const manifest = await loadManifest({ build: true, privacy: 'true', integratorId: GECERLI_ID })
        expect(manifest.manifest_version).toBe(3)
    })

    it('uretim + Gizli mod kapali + bos id: hata vermez (bugunku uretim yapilandirmasi)', async () => {
        const manifest = await loadManifest({ build: true, privacy: 'false', integratorId: '' })
        expect(manifest.manifest_version).toBe(3)
    })

    it('gelistirme + Gizli mod acik + bos id: hata vermez (bos id yalniz uretimde yasak)', async () => {
        const manifest = await loadManifest({ build: false, privacy: 'true', integratorId: '' })
        expect(manifest.manifest_version).toBe(3)
    })
})
