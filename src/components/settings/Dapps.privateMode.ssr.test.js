// Ayarlar > Dapp'ler gizli modda (gizli-mod spec 23.9, karar C-M1 ile ayni): genel EVM/TON/Solana
// oturum listeleri GORUNMEZ, kes/izin kontrolu erisilemez, ekran bos bir not gosterir. Mod
// degisimi ekran acikken de uygulanir (giriste bosalir, cikista yeniden okunur; T28 M7 sinar);
// DISCONNECT_DAPP kapi siniflandirmasi DEGISMEDI (ALWAYS_ALLOWED, asagida sabitlendi).
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js KULLANIM notu).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// `watch`: SSR'da sync OLMAYAN watcher hic kurulmaz (Vue SSR kurali) ve kurulanlar renderToString bitince
// durdurulur. Ekranin GERCEK `watch(() => privacy.active, ...)` baglantisini sinamak icin watcher sync zorlanir ve
// mod render SIRASINDA (asagidaki modDegisimi) cevrilir.
vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        onMounted: actual.onServerPrefetch,
        watch: (source, cb, options) => actual.watch(source, cb, { ...options, flush: 'sync' }),
    }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import { privacyStore } from '../../store/privacy'
import { modDegisimi, ilkOkumayiTut } from '../../test-utils/privateModeScreen.js'
import Dapps from './Dapps.vue'
import { ALWAYS_ALLOWED } from '../../utils/privacy/privacyGate'

const ADRES = '0xAaaa000000000000000000000000000000000001'
const KAYIT = { accounts: [ADRES], chainId: '0x1', allowedChains: [1] }
const NOT = 'Connections are hidden in private mode.'

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
})

afterEach(() => {
    vi.unstubAllGlobals()
    delete globalThis.chrome
})

function kur({ gizli }) {
    const stub = installChromeStub({
        dapps: { 'uniswap.org': { ...KAYIT } },
        ton_dapps: { 'ton.example': { address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG', manifest: {} } },
        solana_dapps: { 'https://sol.example': { address: 'So11111111111111111111111111111111111111112' } },
    })
    const gonderilen = []
    stub.setSendMessage(async (m) => { gonderilen.push(m); return { success: true } })
    globalThis.chrome.storage.onChanged = { addListener: () => {}, removeListener: () => {} }
    const app = createApp(Dapps)
    app.use(createTestPinia())
    app.use(createTestI18n())
    pageStore().currentPage = 'settings_dapps'
    privacyStore().active = gizli
    return { app, stub, gonderilen }
}

describe('Dapps.vue (SSR) -- gizli mod', () => {
    it('gizli modda uc oturum listesi de CIZILMEZ, bos-durum ekrani da degil; kisa not cizilir', async () => {
        const { app } = kur({ gizli: true })
        const holder = captureInstance(app, 'Dapps')
        const html = await render(app)
        expect(html).toContain(NOT)
        expect(html).not.toContain('uniswap.org')
        expect(html).not.toContain('ton.example')
        expect(html).not.toContain('sol.example')
        // Bellekte de genel oturum yok.
        expect(holder.instance.setupState.dapps_list).toEqual([])
        expect(holder.instance.setupState.apps).toEqual({})
        expect(holder.instance.setupState.ton_dapps).toEqual({})
        expect(holder.instance.setupState.solana_dapps).toEqual({})
    })

    it('gizli modda kes / izin dugmesi HIC cizilmez (yalniz oturum satirinda cizilen kontroller)', async () => {
        const { app } = kur({ gizli: true })
        const html = await render(app)
        expect(html).not.toContain('settings_dapp_permissions')
        // Oturum satiri butonlari yalniz satirlarda var; gizli modda sayfada oturum satiri yok.
        expect(html).not.toContain('rose-')
    })

    it('gizli modda disconnect / tonBaglantisiniKes / solanaBaglantisiniKes: depoya YAZMAZ, mesaj YOLLAMAZ (mod yarisina karsi son savunma)', async () => {
        const { app, stub, gonderilen } = kur({ gizli: true })
        const holder = captureInstance(app, 'Dapps')
        await render(app)
        const onceki = JSON.stringify(stub.localStore)
        await holder.instance.setupState.disconnect('uniswap.org')
        await holder.instance.setupState.tonBaglantisiniKes('ton.example')
        await holder.instance.setupState.solanaBaglantisiniKes('https://sol.example')
        expect(gonderilen).toEqual([])
        expect(JSON.stringify(stub.localStore)).toBe(onceki)
    })

    it('pozitif kontrol: genel modda ayni ekran oturumlari listeler ve not cizmez', async () => {
        const { app } = kur({ gizli: false })
        const html = await render(app)
        expect(html).toContain('uniswap.org')
        expect(html).toContain('ton.example')
        // Kes dugmesi (gizli modda yok) genel modda var: yukaridaki 'rose-' iddiasinin cipasi.
        expect(html).toContain('rose-')
        expect(html).not.toContain(NOT)
    })

    // T28 M7: mod ekran ACIKKEN degisir (gercek watch baglantisi). Burada ilk okuma modun degismesinden ONCE bitmistir.
    it('ilk okuma BITTIKTEN sonra gizli moda GIRILIRSE: listeler bosalir, not cikar, bellekte oturum kalmaz', async () => {
        const { app } = kur({ gizli: false })
        const holder = captureInstance(app, 'Dapps')
        modDegisimi(app, true)
        const html = await render(app)
        expect(privacyStore().active).toBe(true)
        expect(html).toContain(NOT)
        expect(html).not.toContain('uniswap.org')
        expect(html).not.toContain('ton.example')
        expect(holder.instance.setupState.dapps_list).toEqual([])
        expect(holder.instance.setupState.apps).toEqual({})
        expect(holder.instance.setupState.ton_dapps).toEqual({})
        expect(holder.instance.setupState.solana_dapps).toEqual({})
    })

    // T29 (T28 M7): okuma SURERKEN moda girilirse gecikmis sonuc, watcher'in bosalttigi listeleri geri doldurmaz.
    it('okuma SURERKEN gizli moda girilirse: gecikmis okuma sonucu listeleri geri DOLDURMAZ', async () => {
        const { app } = kur({ gizli: false })
        const holder = captureInstance(app, 'Dapps')
        const tutulan = ilkOkumayiTut()
        modDegisimi(app, true, { flipSonrasi: () => tutulan.birak() })
        const html = await render(app)
        // Okuma gercekten tutuldu mu? (tutulmadiysa test korumayi sinamaz; Vue serverPrefetch firlatmasini yutar.)
        expect(tutulan.tutuldu).toBe(true)
        expect(privacyStore().active).toBe(true)
        expect(html).toContain(NOT)
        expect(html).not.toContain('uniswap.org')
        expect(html).not.toContain('ton.example')
        expect(holder.instance.setupState.dapps_list).toEqual([])
        expect(holder.instance.setupState.apps).toEqual({})
        expect(holder.instance.setupState.ton_dapps).toEqual({})
        expect(holder.instance.setupState.solana_dapps).toEqual({})
    })

    // T29 M2: uc kullanici eylemi de (disconnect, tonBaglantisiniKes, solanaBaglantisiniKes) bir await'ten sonra liste
    // durumu atar. Eylem uctayken (okumasi/yazimi suruyorken) gizli moda girilirse watcher listeleri bosaltir; eylemin
    // gecikmis sonucu onlari GERI DOLDURMAMALI. Eylem render sirasinda baslatilir, mod cevrilir, tutulan okuma birakilir.
    describe('kullanici eylemi surerken gizli moda girilirse listeler geri dolmaz', () => {
        function eylemSurerkenGizliyeGir(app, holder, anahtar, eylem) {
            let sonuc = null
            app.mixin({
                async serverPrefetch() {
                    if (this.$.type.__name !== 'Dapps' || sonuc) return
                    sonuc = { tutulan: null }
                    await new Promise((r) => setTimeout(r, 30)) // ilk okuma bitti
                    sonuc.tutulan = ilkOkumayiTut(anahtar)
                    const is = eylem(this.$.setupState)
                    await new Promise((r) => setTimeout(r, 10)) // eylem tutulan okumaya vardi
                    privacyStore().active = true // sync watcher listeleri bosaltir
                    sonuc.tutulan.birak()
                    await is
                    await new Promise((r) => setTimeout(r, 30))
                },
            })
            return () => sonuc
        }

        async function dene(anahtar, eylem) {
            const { app, stub } = kur({ gizli: false })
            stub.localStore.dapps['sushi.com'] = { ...KAYIT }
            const holder = captureInstance(app, 'Dapps')
            const al = eylemSurerkenGizliyeGir(app, holder, anahtar, eylem)
            const html = await render(app)
            // Okuma gercekten tutuldu mu? (tutulmadiysa test korumayi sinamaz.)
            expect(al().tutulan.tutuldu).toBe(true)
            expect(privacyStore().active).toBe(true)
            expect(html).toContain(NOT)
            expect(html).not.toContain('uniswap.org')
            expect(html).not.toContain('sushi.com')
            expect(html).not.toContain('ton.example')
            expect(holder.instance.setupState.dapps_list).toEqual([])
            expect(holder.instance.setupState.apps).toEqual({})
            expect(holder.instance.setupState.ton_dapps).toEqual({})
            expect(holder.instance.setupState.solana_dapps).toEqual({})
        }

        it('disconnect: updateDapps sonucu apps / dapps_list i geri DOLDURMAZ', async () => {
            await dene('dapps', (st) => st.disconnect('uniswap.org'))
        })

        it('tonBaglantisiniKes: taze ton_dapps okumasi ton_dapps i geri DOLDURMAZ', async () => {
            await dene('ton_dapps', (st) => st.tonBaglantisiniKes('ton.example'))
        })

        it('solanaBaglantisiniKes: taze solana_dapps okumasi solana_dapps i geri DOLDURMAZ', async () => {
            await dene('solana_dapps', (st) => st.solanaBaglantisiniKes('https://sol.example'))
        })
    })

    it('ekran gizli modda acikken genel moda DONULURSE: oturumlar yeniden okunur ve listelenir, not kalkar', async () => {
        const { app } = kur({ gizli: true })
        const holder = captureInstance(app, 'Dapps')
        modDegisimi(app, false)
        const html = await render(app)
        expect(privacyStore().active).toBe(false)
        expect(html).not.toContain(NOT)
        expect(html).toContain('uniswap.org')
        expect(html).toContain('ton.example')
        expect(holder.instance.setupState.dapps_list).toEqual(['uniswap.org'])
    })

    // Basliktaki sinif iddiasi: gizli modda Ayarlar'dan DISCONNECT_DAPP gonderilemez (ekran reddeder), kapi sinifi ise
    // degismedi: ALWAYS_ALLOWED (gizli modda "Genel hesapla BAGLI" site kesilmek istenirse kapinin kendisi engellemez;
    // koruma ekran katmanindadir).
    it('DISCONNECT_DAPP kapi sinifi DEGISMEDI: ALWAYS_ALLOWED', () => {
        expect(ALWAYS_ALLOWED.has('DISCONNECT_DAPP')).toBe(true)
    })
})
