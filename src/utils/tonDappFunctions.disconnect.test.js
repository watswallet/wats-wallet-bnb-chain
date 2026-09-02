// KOK NEDEN: kesme IKI YONLU olmak zorunda. Kullanici cuzdandan kestiginde
// dapp'e haber verilmezse dapp bagli oldugunu sanmaya devam eder ve her
// isteginde kod 100 yer -- kullanici bunu "cuzdan bozuk" diye okur.
//
// IKINCI KOK NEDEN (Gorev 14, daha once acilan bir defekt): notifyTonDapp
// sekmeleri `tab.url`in (UST cercevenin adresi) hostname'iyle SUZUYORDU, oysa
// oturumlar SENDER CERCEVESININ hostname'iyle anahtarlanir (resolveSenderOrigin
// kasitli olarak GONDEREN cerceveyi cozer). Bir iframe icindeki dapp'in ust
// cercevesi BASKA bir host'sa (or. bir aggregator sitesi TON dapp'ini iframe'de
// gosteriyorsa) eski kod o sekmeye HICBIR ZAMAN mesaj yollamiyordu. Duzeltme:
// yeni permission EKLEMEDEN, `chrome.tabs.sendMessage(tabId, msg)` frameId
// VERILMEDEN TUM cercevelere ulasir (content.js zaten her cercevede calisiyor).
// Bu yuzden notifyTonDapp artik TUM sekmelere hostname'i mesajin ICINDE tasiyarak
// yollar; hangi cercevenin bu olayi ALACAGINA content.js kendi
// `window.location.hostname`iyle karsilastirarak karar verir (bkz. content.test.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function kurChrome({ tabs = [], localStore = {} } = {}) {
    const gonderilenSekmeMesajlari = []
    const store = { ...localStore }
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const wanted = keys === undefined
                        ? Object.keys(store)
                        : (Array.isArray(keys) ? keys : [keys])
                    return Object.fromEntries(wanted.map((k) => [k, store[k]]))
                },
                set: async (obj) => { Object.assign(store, obj) },
                remove: async () => {},
            },
        },
        windows: { onRemoved: { addListener: () => {} }, create: async () => ({ id: 1 }), remove: async () => {}, get: async () => ({}), getLastFocused: async () => ({}) },
        runtime: { getURL: (p) => 'chrome-extension://x/' + p },
        tabs: {
            query: async () => tabs,
            sendMessage: (tabId, msg) => { gonderilenSekmeMesajlari.push({ tabId, msg }); return Promise.resolve() },
        },
    }
    return { store, gonderilenSekmeMesajlari }
}

beforeEach(() => { vi.resetModules() })
afterEach(() => { delete globalThis.chrome })

const OLAY = { event: 'disconnect', id: 1, payload: {} }

describe('notifyTonDapp', () => {
    // ESKI davranis (kaldirildi): yalniz tab.url'in hostname'i eslesirse yollardi.
    // YENI davranis: hangi sekmenin dogru cerceveyi barindirdigini BILEMEYIZ (bir
    // iframe'in adresi tab.url'de HIC gorunmez), o yuzden TUM sekmelere yollanir --
    // suzme content.js'te cerceve duzeyinde yapilir.
    it('TUM bilinen sekmelere mesaj yollar (tab.url ile suzmez)', async () => {
        const { gonderilenSekmeMesajlari } = kurChrome({
            tabs: [
                { id: 1, url: 'https://app.dedust.io/swap' },
                { id: 2, url: 'https://baska.io/' },
                { id: 3, url: 'https://app.dedust.io/pool' },
            ],
        })
        const { notifyTonDapp } = await import('./tonDappFunctions.js')
        await notifyTonDapp('app.dedust.io', OLAY)

        expect(gonderilenSekmeMesajlari.map((g) => g.tabId).sort()).toEqual([1, 2, 3])
    })

    // ASIL DEFEKT SENARYOSU: TON dapp'i bir iframe icinde calisiyor, sekmenin UST
    // cercevesi (tab.url) TAMAMEN BASKA bir host. Eski kod bu sekmeyi hic
    // gormezdi (tab.url hostname'i oturumun hostname'iyle eslesmiyor); yeni kod
    // yine de mesaji yollar -- suzme gorevi content.js'e (cerceve duzeyi) devredildi.
    it('UST cercevesi FARKLI olan sekmeye de mesaj yollar (iframe senaryosu)', async () => {
        const { gonderilenSekmeMesajlari } = kurChrome({
            tabs: [{ id: 7, url: 'https://aggregator.example/embed' }],
        })
        const { notifyTonDapp } = await import('./tonDappFunctions.js')
        await notifyTonDapp('app.dedust.io', OLAY)

        expect(gonderilenSekmeMesajlari.map((g) => g.tabId)).toEqual([7])
    })

    // Hedef `wats_ton_inpage` OLMAK ZORUNDA: `wats_inpage` gonderilirse olay
    // EVM saglayicisinin EIP-1193 hattina duser ve TON koprusu onu hic gormez.
    // Mesaj ayrica HEDEF hostname'i TASIMAK zorunda: content.js bunu kendi
    // `window.location.hostname`iyle karsilastirarak suzuyor.
    it('mesaj wats_ton_inpage hedefi, event VE hostname alanlariyla gider', async () => {
        const { gonderilenSekmeMesajlari } = kurChrome({ tabs: [{ id: 1, url: 'https://app.dedust.io/' }] })
        const { notifyTonDapp } = await import('./tonDappFunctions.js')
        await notifyTonDapp('app.dedust.io', OLAY)

        expect(gonderilenSekmeMesajlari[0].msg.target).toBe('wats_ton_inpage')
        expect(gonderilenSekmeMesajlari[0].msg.event).toEqual(OLAY)
        expect(gonderilenSekmeMesajlari[0].msg.hostname).toBe('app.dedust.io')
    })

    it('hic sekme yoksa sessizce hicbir sey yapmaz', async () => {
        const { gonderilenSekmeMesajlari } = kurChrome({ tabs: [] })
        const { notifyTonDapp } = await import('./tonDappFunctions.js')
        await notifyTonDapp('app.dedust.io', OLAY)
        expect(gonderilenSekmeMesajlari).toEqual([])
    })

    // `id`si olmayan bir sekme (or. onizleme/prerender) sendMessage'a
    // GONDERILMEMELI -- gonderilse bile chrome bunu reddeder, ama denemek
    // digerlerine ulasmayi ENGELLEMEMELI.
    it('id siz sekme atlanir, digerlerine yine de gider', async () => {
        const { gonderilenSekmeMesajlari } = kurChrome({
            tabs: [{ id: undefined, url: 'https://baska.io/' }, { id: 3, url: 'https://app.dedust.io/' }],
        })
        const { notifyTonDapp } = await import('./tonDappFunctions.js')
        await notifyTonDapp('app.dedust.io', OLAY)
        expect(gonderilenSekmeMesajlari.map((g) => g.tabId)).toEqual([3])
    })
})

// disconnectOrphanedTonSessions: baglandigi hesap ARTIK VAR OLMAYAN TON
// oturumlarinin temizlenmesi. TonConnect'te accountsChanged YOK (spec §7.1):
// oturum ADRESE bagli, hesap silinince imzalayacak anahtar kalmaz.
//
// KONTROLOR KARARI (Gorev 14 brief duzeltmesi): hesap anahtarlari KAYNAGI
// `vaults`tir -- `vaults.flatMap(v => v.accounts.map(a => a.key)).filter(Boolean)`.
// `active_account` yalniz SECILI hesabi bilir, TUM hesaplari degil.
//
// NOT (kontrolor + kod incelemesi): bu depoda su an hesap/kasa SILME akisi YOK
// (bkz. tonFlowWiring.test.js -- "ag secici: EVM olusturma yonlendirmesi
// ulasilamaz oldugu icin kaldirildi" blogundaki kayit: "depoda kasa/hesap SILME
// akisi YOK"). Bu fonksiyon o yuzden HENUZ hicbir cagirandan tetiklenmiyor;
// ileride bir hesap silme ekrani eklendiginde DOGRUDAN buraya baglanmasi icin
// disari verilip test edildi.
describe('disconnectOrphanedTonSessions', () => {
    const HESAPLI_OTURUM = {
        address: '0:1111111111111111111111111111111111111111111111111111111111111111',
        publicKey: 'ab12', accountKey: 'acc-1', chain: '-239',
        manifest: { name: 'DeDust', url: 'https://app.dedust.io', iconUrl: null, manifestUrl: 'https://app.dedust.io/m.json', sameOrigin: true },
        connectedAt: 1756000000,
    }
    const YETIM_OTURUM = { ...HESAPLI_OTURUM, accountKey: 'silinen-hesap' }
    const VAULTS = [{ id: 'v1', type: 'hd', accounts: [{ key: 'acc-1', address: '0xabc' }] }]

    it('hesabi HALA VAR OLAN oturuma DOKUNMAZ', async () => {
        const { store, gonderilenSekmeMesajlari } = kurChrome({
            tabs: [{ id: 1, url: 'https://app.dedust.io/' }],
            localStore: { ton_dapps: { 'app.dedust.io': HESAPLI_OTURUM } },
        })
        const { disconnectOrphanedTonSessions } = await import('./tonDappFunctions.js')
        await disconnectOrphanedTonSessions(VAULTS)

        expect(store.ton_dapps).toEqual({ 'app.dedust.io': HESAPLI_OTURUM })
        expect(gonderilenSekmeMesajlari).toEqual([])
    })

    it('YETIM oturumu depodan SILER ve dapp i BILDIRIR', async () => {
        const { store, gonderilenSekmeMesajlari } = kurChrome({
            tabs: [{ id: 1, url: 'https://app.dedust.io/' }],
            localStore: { ton_dapps: { 'app.dedust.io': YETIM_OTURUM } },
        })
        const { disconnectOrphanedTonSessions } = await import('./tonDappFunctions.js')
        await disconnectOrphanedTonSessions(VAULTS)

        expect(store.ton_dapps['app.dedust.io']).toBeUndefined()
        const bildirim = gonderilenSekmeMesajlari.find((g) => g.tabId === 1)
        expect(bildirim.msg.target).toBe('wats_ton_inpage')
        expect(bildirim.msg.hostname).toBe('app.dedust.io')
        expect(bildirim.msg.event.event).toBe('disconnect')
    })

    it('KARISIK depoda yalniz yetim silinir, gecerli oturum KALIR', async () => {
        const { store } = kurChrome({
            tabs: [],
            localStore: { ton_dapps: { 'app.dedust.io': HESAPLI_OTURUM, 'yetim.io': YETIM_OTURUM } },
        })
        const { disconnectOrphanedTonSessions } = await import('./tonDappFunctions.js')
        await disconnectOrphanedTonSessions(VAULTS)

        expect(store.ton_dapps['app.dedust.io']).toEqual(HESAPLI_OTURUM)
        expect(store.ton_dapps['yetim.io']).toBeUndefined()
    })

    // FAIL-OPEN (orphanTonHostnames'in kendi sozlesmesi, tonConnectAuthz.test.js'te
    // zaten kilitli): vaults bos/gecersizse HICBIR oturum yetim SAYILMAZ. Aksi
    // halde turetme basarisiz oldugunda kullanicinin butun TON baglantilari
    // geri alinamaz sekilde silinirdi.
    it('vaults bos/gecersizse HICBIR oturum silinmez', async () => {
        const { store } = kurChrome({
            tabs: [],
            localStore: { ton_dapps: { 'yetim.io': YETIM_OTURUM } },
        })
        const { disconnectOrphanedTonSessions } = await import('./tonDappFunctions.js')
        await disconnectOrphanedTonSessions([])
        await disconnectOrphanedTonSessions(null)
        await disconnectOrphanedTonSessions(undefined)

        expect(store.ton_dapps['yetim.io']).toEqual(YETIM_OTURUM)
    })
})
