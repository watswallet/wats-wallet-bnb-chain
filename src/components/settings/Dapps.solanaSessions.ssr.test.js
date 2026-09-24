// Solana oturumlari da bu ekranda: kullanicinin bir Solana dapp'iyle
// baglantisini gorebilecegi ve kesebilecegi TEK yer burasi (Header.vue'daki
// "bu sitede baglisin" acilir menusu EVM'e ozel kaldi).
//
// TON kardesinden AYRILAN TEK NOKTA: anahtar HOSTNAME degil TAM ORIGIN'dir
// (K5). Ekran hostname gosterirse `https://app.x.com` ile `http://app.x.com`
// ve o host'un HER portu kullaniciya AYNI satir gibi gorunur -- kullanici
// hangisini kestigini bilemez.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../../test-utils/ssrRender.js'
import { pageStore } from '../../store/pageStore'
import Dapps from './Dapps.vue'

const ACCOUNT = { key: 'acc-1', address: '0xAaaa000000000000000000000000000000000001', name: 'Hesap A', type: 'hd' }

// base58 BUYUK/KUCUK HARF DUYARLIDIR (K8): fixture bilerek karisik yazimli.
const SOLANA_SESSION_A = {
    address: '7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK',
    publicKey: '5f0e1a', accountKey: 'acc-1', cluster: 'solana:mainnet',
    // Sayfanin IDDIA ettigi ad -- saldirgan kontrolunde (K5).
    appMeta: { name: 'Jupiter', icon: null },
    connectedAt: 1756700000,
}
const SOLANA_SESSION_B = {
    address: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH',
    publicKey: 'c31d02', accountKey: 'acc-1', cluster: 'solana:mainnet',
    appMeta: { name: 'Tensor', icon: null },
    connectedAt: 1756700001,
}
const TON_SESSION = {
    address: '0:1111111111111111111111111111111111111111111111111111111111111111',
    publicKey: 'ab12', accountKey: 'acc-1', chain: '-239',
    manifest: { name: 'DeDust', url: 'https://app.dedust.io', iconUrl: null, manifestUrl: 'https://app.dedust.io/m.json', sameOrigin: true },
    connectedAt: 1756000000,
}
const EVM_DAPP = { accounts: [ACCOUNT.address], chainId: '0x1' }

beforeEach(() => {
    vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => {} } })
})

afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    delete globalThis.chrome
})

// setup()'un varsayilan sendMessage sahtesi DISCONNECT_SOLANA_DAPP'i arka
// planin GERCEK davranisiyla taklit eder: silme ERTELENMIS bir tikte olur
// (gercek chrome.runtime.sendMessage de mikrotask sirasi disinda calisir,
// arka plan servis calisaninda calisir). Bu, bilesenin yeniden-okumadan
// ONCE sendMessage'i GERCEKTEN BEKLEMESI gerektigini kanitlar (fix turu 1,
// P1) -- await dusseydi ya da yeniden-okuma satiri kaldirilsaydi liste
// ESKI kalirdi ve eski test suite'i bunu YAKALAYAMAZDI (stub hic silmiyordu).
function setup({ solanaDapps = {}, tonDapps = {}, dapps = {} } = {}) {
    const stub = installChromeStub({
        active_account: ACCOUNT,
        dapps,
        ton_dapps: tonDapps,
        solana_dapps: solanaDapps,
        current_request: undefined,
    })
    const gonderilen = []
    stub.setSendMessage(async (m) => {
        gonderilen.push(m)
        if (m.type === 'DISCONNECT_SOLANA_DAPP') {
            await new Promise((r) => setTimeout(r, 0))
            // GERCEK chrome.storage.local.get() surec sinirini gecen bir
            // structured-clone dondugu icin HER ZAMAN TAZE bir nesnedir --
            // burada da AYNI nesneyi delete ile MUTATE ETMEK yerine YENI bir
            // nesne atanir. Aksi halde bilesenin `solana_dapps` ref'i ZATEN
            // bu nesneye isaret ettigi icin (onMounted'daki ilk get() ayni
            // referansi tasir) sonraki `solana_dapps.value = guncel` atamasi
            // Vue'nun referans-tabanli degisiklik-tespitini (Object.is)
            // TETIKLEMEZ ve computed SESSIZCE bayatlar.
            const { [m.origin]: _atilan, ...kalan } = stub.localStore.solana_dapps
            stub.localStore.solana_dapps = kalan
        }
        return { success: true }
    })

    const app = createApp(Dapps)
    app.use(createTestPinia())
    app.use(createTestI18n())
    pageStore().currentPage = 'settings_dapps'

    return { app, stub, gonderilen }
}

describe('Dapps.vue (SSR) -- Solana oturumlari', () => {
    it('solana_dapps kayitlari listelenir', async () => {
        const { app } = setup({ solanaDapps: { 'https://jup.ag': SOLANA_SESSION_A } })
        const html = await render(app)
        expect(html).toContain('Solana Connections')
        expect(html).toContain('https://jup.ag')
    })

    // K5: baskin oge TAM ORIGIN'dir -- SEMA ve PORT dahil. Fix turu 1 (I1):
    // origin GORUNUR METIN olarak baskin span'da basilmali; bir ozniteligin
    // (title/dicebear seed) icinde saklanmasi YETMEZ -- o zaman ekranda
    // kullaniciya yalniz kisaltilmis hostname gorunur ve iki oturumu
    // AYIRT EDEMEZ. Duz toContain BUNU KANITLAYAMAZ (attribute icindeki
    // metin de ayni sekilde eslesir); regex OZELLIKLE font-bold span'in
    // ICERIGINI hedefler.
    it('TAM ORIGIN gosterilir: sema ve port KIRPILMAZ', async () => {
        const { app } = setup({
            solanaDapps: { 'https://jup.ag': SOLANA_SESSION_A, 'https://jup.ag:8443': SOLANA_SESSION_B },
        })
        const holder = captureInstance(app, 'Dapps')
        const html = await render(app)

        expect(holder.instance.setupState.solanaOturumlari.map((o) => o.origin))
            .toEqual(['https://jup.ag', 'https://jup.ag:8443'])
        expect(html).toMatch(/font-bold[^>]*>https:\/\/jup\.ag:8443<\/span>/)
        expect(html).toMatch(/font-bold[^>]*>https:\/\/jup\.ag<\/span>/)
    })

    // Adres base58: toLowerCase EDILMEZ (K8). Fix turu 1 (M1): tam adres
    // HTML'e HIC SIZMAMALI -- yalniz kisaltilmis hali gorunur.
    it('base58 adres BUYUK/KUCUK harfi KORUNARAK kisaltilir', async () => {
        const { app } = setup({ solanaDapps: { 'https://jup.ag': SOLANA_SESSION_A } })
        const html = await render(app)
        expect(html).toContain('7EqQ')
        expect(html).toContain('wJeK')
        expect(html).not.toContain('7eqq')
        expect(html).toContain('7EqQ...wJeK')
        expect(html).not.toContain(SOLANA_SESSION_A.address)
    })

    // appMeta TAMAMEN saldirgan kontrolundedir (Wallet Standard'da manifest YOK).
    // Ekranda gorunecekse "site boyle IDDIA ediyor" etiketiyle gorunmeli.
    // Fix turu 1 (M4): rozet metni TAM olarak "claimedName: ad" seklinde,
    // IDDIA edilen ad ASLA baskin (font-bold) span'da GORUNMEZ.
    it('appMeta adi IDDIA rozetiyle gosterilir, baskin oge OLMAZ', async () => {
        const { app } = setup({ solanaDapps: { 'https://kotu-site.example': { ...SOLANA_SESSION_A, appMeta: { name: 'Jupiter', icon: null } } } })
        const html = await render(app)
        expect(html).toContain('Name claimed by the site')
        expect(html).toContain('https://kotu-site.example')
        expect(html).toContain('Name claimed by the site: Jupiter')
        expect(html).toMatch(/font-bold[^>]*>https:\/\/kotu-site\.example<\/span>/)
        expect(html).not.toMatch(/font-bold[^>]*>Jupiter</)
    })

    // C3.2: appMeta.name eskiden hic isaretlenmiyordu -- onay ekranlarinin
    // (SolanaSignTx/SignMessage/ConnectApprove) kullandigi AYNI PAYLASILAN
    // gorunmezlik/homoglif helper'i (gorunurKil) simdi buraya da uygulanir.
    // Kiril 'а' (U+0430) ile yazilmis bir ad GERCEK bir markaya (Latin 'a')
    // AYNI gorunur -- K2 kacirma testiyle (asagida) CATISMAZ: escape ayri bir
    // katmandir, gorunurKil ham HTML uretmez, yalnizca metni degistirir.
    it('appMeta.name homoglif icerirse ISARETLENIR', async () => {
        const { app } = setup({ solanaDapps: { 'https://kotu.example': { ...SOLANA_SESSION_A, appMeta: { name: 'jupitаr', icon: null } } } })
        const html = await render(app)
        expect(html).toContain('[U+0430]')
        expect(html).not.toContain('jupitаr')
    })

    // Fix turu 1 (I2): appMeta.icon (uzak URL, saldirgan kontrolunde) ASLA
    // render EDILMEZ -- Wallet Standard'da manifest dogrulamasi yoktur.
    // Sabit dicebear seed'i (getHostname(origin)) HER ZAMAN kullanilir.
    it('appMeta.icon ASLA render edilmez, ikon HER ZAMAN dicebear seed kullanir', async () => {
        const { app } = setup({
            solanaDapps: {
                'https://jup.ag': { ...SOLANA_SESSION_A, appMeta: { name: 'Jupiter', icon: 'https://kotu.example/track.png' } },
            },
        })
        const html = await render(app)
        expect(html).not.toContain('kotu.example/track.png')
        expect(html).toContain('api.dicebear.com/7.x/initials/svg?seed=jup.ag')
    })

    // Fix turu 1 (P2): appMeta.name saldirgan kontrolunde -- bos/eksik/nesne
    // olabilir. Boyle durumlarda rozet HIC basilmamali; nesne durumunda
    // anlamsiz bir metin de SIZMAMALI.
    it('appMeta.name yoksa veya dize degilse iddia rozeti basilmaz', async () => {
        const { app: appNull } = setup({ solanaDapps: { 'https://jup.ag': { ...SOLANA_SESSION_A, appMeta: { name: null, icon: null } } } })
        const htmlNull = await render(appNull)
        expect(htmlNull).not.toContain('Name claimed by the site')

        const { app: appObj } = setup({ solanaDapps: { 'https://jup.ag': { ...SOLANA_SESSION_A, appMeta: { name: { x: 1 }, icon: null } } } })
        const htmlObj = await render(appObj)
        expect(htmlObj).not.toContain('[object Object]')
        expect(htmlObj).not.toContain('Name claimed by the site')
    })

    // Fix turu 1 (P3): :key origin OLMALI, address DEGIL -- ayni cuzdan
    // adresi iki AYRI sitede oturum acmis olabilir (mesru); adres anahtari
    // cift-anahtar uyarisi verir ve Vue satirlardan birini render'DAN
    // DUSUREBILIR.
    it('ayni adresli iki FARKLI origin ayri satirlar olarak gorunur (key=origin)', async () => {
        const { app } = setup({
            solanaDapps: {
                'https://jup.ag': SOLANA_SESSION_A,
                'https://tensor.trade': { ...SOLANA_SESSION_A, appMeta: { name: 'Tensor', icon: null } },
            },
        })
        const html = await render(app)
        expect(html).toContain('https://jup.ag')
        expect(html).toContain('https://tensor.trade')

        const kaynak = readFileSync(new URL('./Dapps.vue', import.meta.url), 'utf8')
        expect(kaynak).toContain(':key="oturum.origin"')
    })

    it('solana_dapps bos ise Solana bolumu cizilmez', async () => {
        const { app } = setup({ dapps: { 'uniswap.org': EVM_DAPP } })
        const holder = captureInstance(app, 'Dapps')
        const html = await render(app)
        expect(holder.instance.setupState.solanaOturumlari.length).toBe(0)
        expect(html).not.toContain('Solana Connections')
    })

    // hicBaglantiYok UC listeye BIRDEN bakmali: yalniz EVM+TON'a bakan eski
    // kosul, SADECE Solana baglantisi varken bos-durum ekranini gosterir ve
    // kullanici Solana baglantisini HIC goremezdi.
    it('yalniz Solana baglantisi varken bos-durum GORUNMEZ, liste cizilir', async () => {
        const { app } = setup({ solanaDapps: { 'https://jup.ag': SOLANA_SESSION_A } })
        const html = await render(app)
        expect(html).not.toContain('No Connections')
        expect(html).toContain('https://jup.ag')
    })

    it('HICBIR baglanti yoksa bos-durum metni HALA cizilir', async () => {
        const { app } = setup({})
        const html = await render(app)
        expect(html).toContain('No Connections')
    })

    // Fix turu 1 (M3): bolumler EVM -> TON -> Solana SIRASIYLA cizilir
    // (sablondaki fiziksel sira budur), basliklar dahil.
    it('UC bolum de AYNI ANDA listelenir', async () => {
        const { app } = setup({
            dapps: { 'uniswap.org': EVM_DAPP },
            tonDapps: { 'app.dedust.io': TON_SESSION },
            solanaDapps: { 'https://jup.ag': SOLANA_SESSION_A },
        })
        const html = await render(app)
        expect(html).toContain('uniswap.org')
        expect(html).toContain('app.dedust.io')
        expect(html).toContain('https://jup.ag')

        const iUni = html.indexOf('uniswap.org')
        const iTon = html.indexOf('TON Connections')
        const iDedust = html.indexOf('app.dedust.io')
        const iSol = html.indexOf('Solana Connections')
        const iJup = html.indexOf('https://jup.ag')
        expect(iUni).toBeGreaterThan(-1)
        expect(iUni).toBeLessThan(iTon)
        expect(iTon).toBeLessThan(iDedust)
        expect(iDedust).toBeLessThan(iSol)
        expect(iSol).toBeLessThan(iJup)
    })

    // Kesme EVM ve TON yollarindan GECMEZ: her biri kendi deposunu temizler.
    // Fix turu 1 (M2): TEK mesaj gider, fazla alan YOK. Fix turu 1 (P1):
    // kesme sonrasi liste GERCEKTEN tazelenir (arka plan silmesi --
    // ERTELENMIS de olsa -- beklenir).
    it('kesme DISCONNECT_SOLANA_DAPP i TAM ORIGIN ile gonderir', async () => {
        const { app, gonderilen } = setup({ solanaDapps: { 'https://jup.ag:8443': SOLANA_SESSION_B } })
        const holder = captureInstance(app, 'Dapps')
        await render(app)

        await holder.instance.setupState.solanaBaglantisiniKes('https://jup.ag:8443')

        expect(gonderilen).toEqual([{ type: 'DISCONNECT_SOLANA_DAPP', origin: 'https://jup.ag:8443' }])
        expect(holder.instance.setupState.solanaOturumlari.length).toBe(0)
    })

    // Silme TEK yerde (arka planda) yapilir; bilesen yalniz mesaji gonderip
    // listeyi TAZELER. Fix turu 1: bilesenin KENDISI storage.local.set'i HIC
    // CAGIRMADIGI dogrudan spy ile kanitlanir -- bu, setup()'un varsayilan
    // (ERTELENMIS) arka-plan-silme simulasyonundan BAGIMSIZDIR: arka plan
    // localStore'u DOGRUDAN nesne mutasyonuyla degistirir, storage.local.set
    // uzerinden GECMEZ, bu yuzden spy her durumda GUVENILIR bir kanit verir.
    it('kesme SIRASINDA bilesen solana_dapps a YAZMAZ (silme tek yerde)', async () => {
        const { app } = setup({ solanaDapps: { 'https://jup.ag': SOLANA_SESSION_A } })
        const holder = captureInstance(app, 'Dapps')
        await render(app)

        const orijinalSet = globalThis.chrome.storage.local.set
        const setSpy = vi.fn((...args) => orijinalSet(...args))
        globalThis.chrome.storage.local.set = setSpy

        await holder.instance.setupState.solanaBaglantisiniKes('https://jup.ag')

        expect(setSpy).not.toHaveBeenCalled()
    })

    // K2: appMeta.name saldirgan kontrolunde -- Vue {{ }} kacirir, v-html
    // KULLANILMAZ. SSR ciktisinda '<b>' ham HTML olarak DEGIL, kacirilmis
    // metin olarak gorunmeli; aksi halde ayarlar ekrani bagli sitelerin
    // gonderdigi adlar araciligiyla script enjeksiyonuna acik olurdu.
    it('appMeta.name HTML olarak DEGIL, kacirilmis metin olarak basilir', async () => {
        const { app } = setup({
            solanaDapps: {
                'https://kotu.example': {
                    ...SOLANA_SESSION_A,
                    appMeta: { name: '<b>Jupiter</b><img src=x onerror=alert(1)>', icon: null },
                },
            },
        })
        const html = await render(app)
        expect(html).toContain('&lt;b&gt;Jupiter&lt;/b&gt;')
        expect(html).not.toContain('<img src=x')
    })

    // Fix turu 1 (C1): arka plan sendMessage reddederse (agdaki gecici bir
    // sorun, ya da servis calisani uykuya dalmissa) bilesen FIRLAMAZ, yalniz
    // konsola uyarir ve YINE de listeyi yeniden okur -- sessiz basarisizlik
    // kullaniciya "cuzdan bozuk" izlenimi birakirdi.
    it('sendMessage reddederse firlatilmaz, uyarilir ve liste yeniden okunur', async () => {
        const uyariSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const { app, stub } = setup({ solanaDapps: { 'https://jup.ag': SOLANA_SESSION_A } })
        stub.setSendMessage(async () => { throw new Error('ag hatasi') })
        const holder = captureInstance(app, 'Dapps')
        await render(app)

        await expect(holder.instance.setupState.solanaBaglantisiniKes('https://jup.ag')).resolves.toBeUndefined()

        // Depo hic degismedi (arka plan hicbir zaman calismadi) -- yeniden
        // okuma yine de calisir ve GERCEK (degismemis) durumu yansitir.
        expect(holder.instance.setupState.solanaOturumlari.length).toBe(1)
        expect(uyariSpy).toHaveBeenCalled()
    })

    // Fix turu 1 (C2): kisa/gecersiz adreslerde firlatmamali ve anlamsiz
    // "abc...abc" gibi bir kisaltma URETMEMELI -- slice(0,4)+slice(-4) orta
    // kisim 10 karakterden kisa adreslerde CAKISIR; sayisal (dize olmayan)
    // bir deger gelirse .slice olmadigi icin RENDER COKMEMELI.
    it('kisa veya gecersiz adres firlatmadan islenir', async () => {
        const { app: appKisa } = setup({ solanaDapps: { 'https://jup.ag': { ...SOLANA_SESSION_A, address: 'abc' } } })
        const htmlKisa = await render(appKisa)
        expect(htmlKisa).toContain('abc')
        expect(htmlKisa).not.toContain('abc...abc')

        const { app: appSayi } = setup({ solanaDapps: { 'https://jup.ag': { ...SOLANA_SESSION_A, address: 42 } } })
        await expect(render(appSayi)).resolves.toBeTypeOf('string')
    })
})
