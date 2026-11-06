// bootstrapWalletUi: gizli mod AKTIFKEN uygulama, gizlilik durumu yuklenince mount edilir
// (gizli-mod cok-ag spec 4.7 "Acilista gizlilik durumu", E14).
//
// KOK NEDEN: `privacyStore.active` `false` ile baslar; fiyat atlamalari, yerel logo, Home sorgu kumesi ve
// tum kapilar ona bakar. `installPrivacySync` eskiden beklenmeden baslatiliyordu ve uygulama hemen mount
// ediliyordu: Gizli Hesap aktifken ilk cizim ve ilk istekler NORMAL mod gibi calisirdi (fiyat istegi, uzak logo,
// tum aglarin bakiyesi) ve Gizli adres sizardi.
//
// Bu dosya KAYNAK KILIDI DEGIL: `bootstrapWalletUi` GERCEKTEN calistirilir (bkz. bootstrapDappSurface.test.js),
// `app.mount` ve `chrome.storage.local.get` kontrol edilir. 'vue' mock'u yalniz createApp'a bir mount casusu koyar.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const uygulamalar = vi.hoisted(() => [])

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        createApp: (...args) => {
            const app = actual.createApp(...args)
            const mount = vi.fn()
            app.mount = mount
            uygulamalar.push({ app, mount })
            return app
        },
    }
})

// App.vue 54 ekrani ve ethers / @solana/web3.js zincirini getirir; her testte vi.resetModules() sonrasi yeniden
// yuklemek soguk makinede 15 sn'yi asar. Bu dosyanin konusu mount ZAMANLAMASI, ekranlar degil: App sahte bir bilesen.
vi.mock('../popup/App.vue', () => ({ default: { name: 'AppSahte', render: () => null } }))

// @vue/runtime-dom import aninda document.createElement kullanir; bootstrap.js -> store/network ve i18n zinciri
// modul ust duzeyinde chrome.storage / chrome.windows'a dokunabilir (bkz. bootstrapDappSurface.test.js).
vi.hoisted(() => {
    globalThis.document = {
        querySelector: () => null,
        createElement: () => ({ style: {}, classList: { add: () => {}, remove: () => {} } }),
        addEventListener: () => {},
        removeEventListener: () => {},
        documentElement: { classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false } },
    }
    globalThis.chrome = {
        windows: { onRemoved: { addListener: () => {} } },
        storage: { local: { get: async () => ({}), set: async () => {} } },
    }
})

import { SURFACE_POPUP } from '../utils/uiSurface'

const GIZLI_HESAP = { address: '0x' + 'cd'.repeat(20), key: 'private-' + 'cd'.repeat(20), type: 'hd', private: true }

// Gizlilik senkronunun depo okumasi ({active_account, vaults, privacy_mode} anahtarlari) `birak()` denene kadar tutulur.
// `hata` verilirse ilk `hataSayisi` senkron okuma onunla reddedilir (varsayilan: hepsi); sonrakiler basarilidir
// (gecici depo hatasi taklidi). `okuma()` senkron okuma sayisidir.
function chromeKur({ depo = {}, tut = false, hata = null, hataSayisi = Infinity } = {}) {
    let birak
    const tutulan = new Promise((r) => { birak = r })
    let senkronOkumasi = 0
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const istenen = Array.isArray(keys) ? keys : [keys]
                    if (istenen.includes('vaults') && istenen.includes('active_account')) {
                        senkronOkumasi++
                        if (hata && senkronOkumasi <= hataSayisi) throw hata
                        if (tut) await tutulan
                    }
                    return Object.fromEntries(istenen.map((k) => [k, depo[k]]))
                },
                set: async () => {},
            },
            onChanged: { addListener: () => {}, removeListener: () => {} },
        },
        runtime: {
            connect: () => ({ onDisconnect: { addListener: () => {} }, disconnect: () => {} }),
            onMessage: { addListener: () => {}, removeListener: () => {} },
            sendMessage: async () => ({}),
            lastError: null,
        },
        windows: { onRemoved: { addListener: () => {} } },
    }
    return { birak, okuma: () => senkronOkumasi }
}

// Bayrak derleme zamani sabitidir: vi.stubEnv + vi.resetModules ile her testte yeniden yuklenir.
async function yukle(bayrak) {
    vi.resetModules()
    vi.stubEnv('VITE_PRIVACY_ENABLED', bayrak)
    uygulamalar.length = 0
    const bootstrap = await import('./bootstrap')
    const { privacyStore } = await import('../store/privacy')
    return { bootstrapWalletUi: bootstrap.bootstrapWalletUi, privacyStore }
}

const mikroGorevler = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

// Sahte zamanlayici HER testte acik: hata yolunun 2 sn'lik yeniden denemesi gercek zamanlayiciyla kurulursa, sonraki bir
// testin sahte depo sayacina sizabilirdi (zamanlayici temizlikte atilir, hicbir test gercek 2 sn beklemez).
beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

describe('bootstrapWalletUi -- gizli mod aciksa mount, gizlilik durumu yuklenince yapilir (E14)', () => {
    it('depo okumasi SURERKEN uygulama mount EDILMEZ; okuma bitince mount edilir', async () => {
        const stub = chromeKur({ depo: { active_account: GIZLI_HESAP }, tut: true })
        const { bootstrapWalletUi } = await yukle('true')

        bootstrapWalletUi({ surface: SURFACE_POPUP })
        await mikroGorevler()

        expect(stub.okuma()).toBe(1)
        expect(uygulamalar).toHaveLength(1)
        expect(uygulamalar[0].mount).not.toHaveBeenCalled()

        stub.birak()
        await mikroGorevler()

        expect(uygulamalar[0].mount).toHaveBeenCalledTimes(1)
        expect(uygulamalar[0].mount).toHaveBeenCalledWith('#app')
    })

    it('mount ANINDA store gizli modu zaten biliyor (ilk cizim gizli kapilarla yapilir)', async () => {
        chromeKur({ depo: { active_account: GIZLI_HESAP } })
        const { bootstrapWalletUi, privacyStore } = await yukle('true')
        let mountAnindakiMod = null
        // createApp casusu mount'u vi.fn() yapti; mount cagrildigi ANDAKI store durumunu yakala.
        bootstrapWalletUi({ surface: SURFACE_POPUP })
        uygulamalar[0].mount.mockImplementation(() => { mountAnindakiMod = privacyStore().active })
        await mikroGorevler()

        expect(uygulamalar[0].mount).toHaveBeenCalledTimes(1)
        expect(mountAnindakiMod).toBe(true)
    })

    it('depo okumasi HATA verirse yine mount edilir ve hata konsola yazilir', async () => {
        chromeKur({ hata: new Error('depo yok') })
        const { bootstrapWalletUi } = await yukle('true')

        bootstrapWalletUi({ surface: SURFACE_POPUP })
        await mikroGorevler()

        expect(uygulamalar[0].mount).toHaveBeenCalledTimes(1)
        expect(console.error).toHaveBeenCalledWith('privacy sync:', expect.any(Error))
    })

    // Tek bir gecici depo hatasi, uiSync dinleyicisi hic kurulmadigi icin store'u pencere omru boyunca `false` birakirdi
    // (yan paneller gunlerce acik kalir: Gizli Hesap aktifken bile fiyat, uzak logo, tum aglar). 2 sn sonra BIR yeniden deneme.
    it('depo okumasi GECICI hata verirse 2 sn sonra yeniden denenir ve store gizli moda gecer (kalici fail-open degil)', async () => {
        const stub = chromeKur({ depo: { active_account: GIZLI_HESAP }, hata: new Error('gecici'), hataSayisi: 1 })
        const { bootstrapWalletUi, privacyStore } = await yukle('true')

        bootstrapWalletUi({ surface: SURFACE_POPUP })
        await mikroGorevler()

        // Ilk deneme dustu: uygulama yine mount edildi, store henuz gizli degil.
        expect(uygulamalar[0].mount).toHaveBeenCalledTimes(1)
        expect(privacyStore().active).toBe(false)
        expect(stub.okuma()).toBe(1)

        await vi.advanceTimersByTimeAsync(2000)
        await mikroGorevler()

        expect(stub.okuma()).toBe(2)
        expect(privacyStore().active).toBe(true)
        expect(uygulamalar[0].mount).toHaveBeenCalledTimes(1)
    })

    it('ikinci deneme de reddedilirse DAHA FAZLA denenmez: iki okuma, iki hata satiri, store false kalir', async () => {
        const stub = chromeKur({ hata: new Error('kalici') })
        const { bootstrapWalletUi, privacyStore } = await yukle('true')

        bootstrapWalletUi({ surface: SURFACE_POPUP })
        await mikroGorevler()
        await vi.advanceTimersByTimeAsync(60000)
        await mikroGorevler()

        expect(stub.okuma()).toBe(2)
        expect(privacyStore().active).toBe(false)
        expect(console.error).toHaveBeenCalledWith('privacy sync:', expect.any(Error))
        expect(console.error).toHaveBeenCalledWith('privacy sync (yeniden):', expect.any(Error))
    })

    it('KONTROL: bayrak KAPALIYSA mount hemen yapilir (depo okumasi beklenmez)', async () => {
        const stub = chromeKur({ depo: { active_account: GIZLI_HESAP }, tut: true })
        const { bootstrapWalletUi } = await yukle('false')

        bootstrapWalletUi({ surface: SURFACE_POPUP })
        // Para birimi diskini sinirli bekler (bootstrapMount.test.js); GIZLILIK deposu okunmaz.
        await mikroGorevler()

        expect(uygulamalar[0].mount).toHaveBeenCalledTimes(1)
        expect(stub.okuma()).toBe(0)
    })
})
