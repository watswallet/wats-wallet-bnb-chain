import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ORIGIN = 'https://app.jup.ag'
const OTEKI = 'https://raydium.io'
const SENDER = { origin: ORIGIN, url: ORIGIN + '/swap', frameId: 0, tab: { id: 9 } }
const ADDR = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const SESSION = { address: ADDR, publicKey: 'ee'.repeat(32), accountKey: 'k1', cluster: 'solana:mainnet', appMeta: null, connectedAt: 1 }

vi.mock('./solana/derive', () => ({ deriveSolanaAddress: vi.fn(), deriveSolanaKeypair: vi.fn() }))
vi.mock('./crypto-utils', () => ({ unlockVault: vi.fn(), decryptSecret: vi.fn() }))

function kurChrome(local = {}, tabs = [{ id: 1 }, { id: 2 }]) {
    const store = { ...local }
    const gonderilen = []
    const yazimlar = []
    const okumalar = []
    const acilanPencereler = []
    // Yazim/bildirim GORECELI SIRASI: her chrome.storage.local.set 'yazim',
    // her chrome.tabs.sendMessage 'bildirim' ekler. Sira pini testleri bunu
    // kullanir -- yazimin bildirimden ONCE gittigini dogrudan sayimla degil
    // ZAMAN SIRASIYLA kanitlar.
    const sira = []
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const w = keys === undefined ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys])
                    okumalar.push(...w)
                    return Object.fromEntries(w.map((k) => [k, store[k]]))
                },
                set: async (obj) => { sira.push('yazim'); yazimlar.push(obj); Object.assign(store, obj) },
                remove: async (k) => { delete store[k] },
            },
            session: { get: async () => ({}) },
        },
        tabs: {
            query: async () => tabs,
            sendMessage: async (tabId, msg) => { sira.push('bildirim'); gonderilen.push({ tabId, msg }) },
        },
        windows: {
            create: async (o) => { acilanPencereler.push(o); return { id: acilanPencereler.length } },
            remove: async () => {}, get: async () => ({}), getLastFocused: async () => ({ width: 1200, left: 0, top: 0 }), onRemoved: { addListener: () => {} },
        },
        runtime: { getURL: (p) => 'chrome-extension://x/' + p },
    }
    return { store, gonderilen, yazimlar, okumalar, sira, acilanPencereler }
}

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })
afterEach(() => { delete globalThis.chrome })

describe('notifySolanaDapp', () => {
    it('TUM sekmelere frameId VERMEDEN yollar -- iframe suzgeci sayfada calisir', async () => {
        const { gonderilen } = kurChrome({})
        const { notifySolanaDapp } = await import('./solanaDappFunctions.js')
        await notifySolanaDapp(ORIGIN, { event: 'change', payload: { accounts: [] } })
        expect(gonderilen.map((g) => g.tabId)).toEqual([1, 2])
        // Yuk sekli notifyTonDapp'in AYNISI ama alan `hostname` DEGIL `origin`:
        // yetki kaynagi TAM ORIGIN'dir (K5) ve content.js suzgeci de origin ile
        // karsilastirir. `hostname` gonderilseydi http:// serit de eslesirdi.
        expect(gonderilen[0].msg).toEqual({
            target: 'wats_solana_inpage',
            origin: ORIGIN,
            event: { event: 'change', payload: { accounts: [] } },
        })
    })

    it('id siz sekmeler atlanir, tek bir sekmenin hatasi digerlerini kesmez', async () => {
        const { gonderilen } = kurChrome({}, [{ id: undefined }, { id: 5 }])
        globalThis.chrome.tabs.sendMessage = async (tabId, msg) => {
            gonderilen.push({ tabId, msg })
            throw new Error('Receiving end does not exist')
        }
        const { notifySolanaDapp } = await import('./solanaDappFunctions.js')
        await expect(notifySolanaDapp(ORIGIN, { event: 'change', payload: { accounts: [] } })).resolves.toBeUndefined()
        expect(gonderilen.map((g) => g.tabId)).toEqual([5])
    })
})

describe('handleSolanaDisconnect — sayfadan gelen kesme', () => {
    async function kes(kur) {
        const { handleSolanaDisconnect } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaDisconnect({ method: 'solana_disconnect' }, SENDER, (r) => yanitlar.push(r))
        return { yanitlar, ...kur }
    }

    it('oturumu siler ve bos nesne doner', async () => {
        const kur = kurChrome({ solana_dapps: { [ORIGIN]: SESSION, [OTEKI]: SESSION } })
        const { yanitlar, store } = await kes(kur)
        expect(yanitlar[0]).toEqual({ result: {} })
        expect(store.solana_dapps[ORIGIN]).toBeUndefined()
        // BASKA origin'in oturumuna DOKUNULMAZ.
        expect(store.solana_dapps[OTEKI]).toEqual(SESSION)
    })

    // KAYIP GUNCELLEME KORUMASI: kayit YOKKEN butun haritayi geri yazmak, TAM O
    // ANDA onay ekranindan inen bir putSolanaSession'i EZERDI (kullanici baska bir
    // sekmede tam o sirada baglaniyorken). Yaziya hic GEREK yoksa yazma.
    it('oturum YOKSA 4100 doner ve depoya HIC YAZILMAZ', async () => {
        const kur = kurChrome({ solana_dapps: { [OTEKI]: SESSION } })
        const { yanitlar, yazimlar } = await kes(kur)
        expect(yanitlar[0].error.code).toBe(4100)
        expect(yazimlar).toEqual([])
    })

    // KAYIP GUNCELLEME PENCERESI (C2.2): yetki denetimi icin okunan ILK anlik
    // goruntu SILME icin KULLANILMAZ -- silme, oturumuDepodanSil'in kendi TAZE
    // okumasindan yapilir. Ilk okumadan sonra, ikinci (taze) okumadan ONCE baska
    // bir sekmede es zamanli bir connect onayi OTEKI icin depoya yaziyor; bu
    // oturum EZILMEMELI.
    it('taze okuma ile siler; ikinci okumadan once inen OTEKI origin EZILMEZ', async () => {
        const kur = kurChrome({ solana_dapps: { [ORIGIN]: SESSION } })
        const asilGet = globalThis.chrome.storage.local.get
        let sayilan = 0
        globalThis.chrome.storage.local.get = async (keys) => {
            const w = Array.isArray(keys) ? keys : [keys]
            if (w.includes('solana_dapps')) sayilan++
            const sonuc = await asilGet(keys)
            // Ilk okuma (yetki denetimi) BITTIKTEN hemen sonra, ama
            // oturumuDepodanSil'in kendi (ikinci) okumasindan ONCE, baska bir
            // sekmede es zamanli bir connect onayi OTEKI icin depoya yaziyor.
            if (w.includes('solana_dapps') && sayilan === 1) {
                kur.store.solana_dapps = { ...kur.store.solana_dapps, [OTEKI]: SESSION }
            }
            return sonuc
        }
        const { yanitlar, store } = await kes(kur)
        expect(yanitlar[0]).toEqual({ result: {} })
        expect(store.solana_dapps[ORIGIN]).toBeUndefined()
        // OTEKI, oturumuDepodanSil'in TAZE okumasindan HEMEN once enjekte
        // edildi -- taze okuma yapilmasaydi (ilk anlik goruntu yazilsaydi)
        // burada KAYBOLURDU.
        expect(store.solana_dapps[OTEKI]).toEqual(SESSION)
    })
})

// C5.3 -- nihai inceleme: hicbir test handleSolanaDisconnect'i catch dalina
// SURMUYORDU.
describe('handleSolanaDisconnect -- catch dali', () => {
    it('chrome.storage.local.get FIRLATIRSA jenerik Internal error doner, SIFIR pencere, ham mesaj SIZMAZ', async () => {
        const kur = kurChrome({ solana_dapps: { [ORIGIN]: SESSION } })
        globalThis.chrome.storage.local.get = async () => { throw new Error('secret-ish text') }
        const { handleSolanaDisconnect } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaDisconnect({ method: 'solana_disconnect' }, SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0]).toEqual({ error: { code: -32603, message: 'Internal error' } })
        expect(kur.acilanPencereler).toEqual([])
        expect(JSON.stringify(yanitlar[0])).not.toContain('secret-ish')
    })
})

describe('handleSolanaDisconnect -- gonderen kapisi (C1.3)', () => {
    async function kesWithSender(sender) {
        const { handleSolanaDisconnect } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaDisconnect({ method: 'solana_disconnect' }, sender, (r) => yanitlar.push(r))
        return yanitlar
    }

    it.each([
        ['ust cerceve DEGIL (frameId 3)', { ...SENDER, frameId: 3 }],
        ['sender.tab YOK', { ...SENDER, tab: undefined }],
        ['http yabanci host (localhost/127.0.0.1 DEGIL)', { ...SENDER, frameId: 0, origin: 'http://app.jup.ag', url: 'http://app.jup.ag/x' }],
        ["origin 'null' (sandbox'li cerceve)", { ...SENDER, origin: 'null' }],
        ['file:// semasi', { ...SENDER, origin: 'file:///C:/x.html' }],
    ])('%s -> 4100, depoya HIC YAZILMAZ (iframe/yabanci sema bagli oturumu SILEMEZ)', async (_ad, gonderen) => {
        const kur = kurChrome({ solana_dapps: { [ORIGIN]: SESSION } })
        const oncesi = structuredClone(kur.store.solana_dapps)
        const yanitlar = await kesWithSender(gonderen)
        expect(yanitlar[0].error).toEqual({ code: 4100, message: 'Unauthorized.' })
        expect(kur.yazimlar).toEqual([])
        expect(kur.store.solana_dapps).toEqual(oncesi)
    })

    it.each([
        ['http://localhost', { origin: 'http://localhost:3000', url: 'http://localhost:3000/x', frameId: 0, tab: { id: 9 } }],
        ['http://127.0.0.1', { origin: 'http://127.0.0.1:8080', url: 'http://127.0.0.1:8080/x', frameId: 0, tab: { id: 9 } }],
    ])('%s -> kapi GECER, bagli oturum silinir', async (_ad, gonderen) => {
        const kur = kurChrome({ solana_dapps: { [gonderen.origin]: SESSION } })
        const yanitlar = await kesWithSender(gonderen)
        expect(yanitlar[0]).toEqual({ result: {} })
        expect(kur.store.solana_dapps[gonderen.origin]).toBeUndefined()
    })
})

describe('handleDisconnectSolanaDapp — ayarlar ekranindan kesme', () => {
    async function kes(origin, kur) {
        const { handleDisconnectSolanaDapp } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleDisconnectSolanaDapp({ type: 'DISCONNECT_SOLANA_DAPP', origin }, { url: 'chrome-extension://x/' }, (r) => yanitlar.push(r))
        return { yanitlar, ...kur }
    }

    it('kaydi siler ve dapp e change -> accounts:[] gonderir', async () => {
        const kur = kurChrome({ solana_dapps: { [ORIGIN]: SESSION } })
        const { yanitlar, store, gonderilen } = await kes(ORIGIN, kur)
        expect(yanitlar[0]).toEqual({ success: true })
        expect(store.solana_dapps[ORIGIN]).toBeUndefined()
        expect(gonderilen[0].msg.event).toEqual({ event: 'change', payload: { accounts: [] } })
    })

    // C2.2: silme artik oturumuDepodanSil ortak yardimcisiyla yapiliyor
    // (handleSolanaDisconnect ile AYNI kod yolu) -- BASKA bir origin'in
    // oturumuna DOKUNULMADIGINI ve bildirimin origin basina TEK sefer
    // gittigini (2 sekme -> 2 sendMessage, 4 DEGIL) dogrular.
    it('OTEKI origine dokunulmaz, bildirim origin basina bir kez gider', async () => {
        const kur = kurChrome({ solana_dapps: { [ORIGIN]: SESSION, [OTEKI]: SESSION } })
        const { yanitlar, store, gonderilen } = await kes(ORIGIN, kur)
        expect(yanitlar[0]).toEqual({ success: true })
        expect(store.solana_dapps[ORIGIN]).toBeUndefined()
        expect(store.solana_dapps[OTEKI]).toEqual(SESSION)
        expect(gonderilen.length).toBe(2)
    })

    // Bildirim IDEMPOTENT: oturum onceden yoksa da zararsizdir. Ama YAZIM
    // yapilmamalidir (kayip guncelleme).
    it('kayit yoksa depoya yazilmaz ama bildirim yine gider', async () => {
        const kur = kurChrome({ solana_dapps: {} })
        const { yanitlar, yazimlar, gonderilen } = await kes(ORIGIN, kur)
        expect(yanitlar[0]).toEqual({ success: true })
        expect(yazimlar).toEqual([])
        expect(gonderilen.length).toBe(2)
    })
})

describe('disconnectOrphanedSolanaSessions', () => {
    it('hesabi artik olmayan oturumlari siler ve haber verir', async () => {
        const kur = kurChrome({
            solana_dapps: { [ORIGIN]: SESSION, [OTEKI]: { ...SESSION, accountKey: 'silinmis' } },
        })
        const { disconnectOrphanedSolanaSessions } = await import('./solanaDappFunctions.js')
        await disconnectOrphanedSolanaSessions([{ id: 'v1', accounts: [{ key: 'k1' }] }])
        expect(kur.store.solana_dapps[ORIGIN]).toEqual(SESSION)
        expect(kur.store.solana_dapps[OTEKI]).toBeUndefined()
        expect(kur.gonderilen.map((g) => g.msg.origin)).toEqual([OTEKI, OTEKI])
    })

    // SIRA PINI: bildirim yazimdan ONCE giderse dapp'e "baglanti kesildi"
    // denip de kayit depoda kalmis olabilir (ya da tam tersi). Mevcut
    // testlerin hicbiri bu SIRAYI dogrudan olcmuyor (yalnizca nihai depo
    // durumunu ve gonderilen mesaj SAYISINI/ICERIGINI kontrol ediyorlar) --
    // bu test yazim indeksinin bildirim indeksinden KUCUK oldugunu ayrica
    // kilitler.
    it('yazim bildirimden ONCE gider', async () => {
        const kur = kurChrome({
            solana_dapps: { [ORIGIN]: SESSION, [OTEKI]: { ...SESSION, accountKey: 'silinmis' } },
        })
        const { disconnectOrphanedSolanaSessions } = await import('./solanaDappFunctions.js')
        await disconnectOrphanedSolanaSessions([{ id: 'v1', accounts: [{ key: 'k1' }] }])

        const sonYazimIndeksi = kur.sira.lastIndexOf('yazim')
        const ilkBildirimIndeksi = kur.sira.indexOf('bildirim')
        expect(sonYazimIndeksi).toBeGreaterThanOrEqual(0)
        expect(ilkBildirimIndeksi).toBeGreaterThanOrEqual(0)
        expect(sonYazimIndeksi).toBeLessThan(ilkBildirimIndeksi)
    })

    // KAYIP GUNCELLEME PENCERESI (C2.1): yetim adaylari BIR anlik goruntuden
    // hesaplanir ama SILME o anlik goruntuden DEGIL, set'ten hemen once alinan
    // TAZE bir ikinci okumadan yapilir. Ilk okumadan sonra baska bir sekmede
    // es zamanli bir connect onayi (putSolanaSession) UCUNCU bir origin icin
    // depoya yaziyor -- bu oturum supurgede KAYBOLMAMALI.
    it('bildirim/await sirasinda depoya inen YENI oturum (es zamanli connect onayi) EZILMEZ', async () => {
        const UCUNCU = 'https://third.example'
        const kur = kurChrome({
            solana_dapps: { [ORIGIN]: SESSION, [OTEKI]: { ...SESSION, accountKey: 'silinmis' } },
        })
        const asilGet = globalThis.chrome.storage.local.get
        let sayilan = 0
        globalThis.chrome.storage.local.get = async (keys) => {
            const w = Array.isArray(keys) ? keys : [keys]
            if (w.includes('solana_dapps')) sayilan++
            const sonuc = await asilGet(keys)
            if (w.includes('solana_dapps') && sayilan === 1) {
                kur.store.solana_dapps = { ...kur.store.solana_dapps, [UCUNCU]: { ...SESSION } }
            }
            return sonuc
        }
        const { disconnectOrphanedSolanaSessions } = await import('./solanaDappFunctions.js')
        await disconnectOrphanedSolanaSessions([{ id: 'v1', accounts: [{ key: 'k1' }] }])

        expect(kur.store.solana_dapps[UCUNCU]).toEqual(SESSION)
        expect(kur.store.solana_dapps[OTEKI]).toBeUndefined()
        expect(kur.store.solana_dapps[ORIGIN]).toEqual(SESSION)
        expect(kur.okumalar.filter((k) => k === 'solana_dapps').length).toBe(2)
    })

    // Yetim, ilk anlik goruntu ile ikinci (taze) okuma ARASINDA baska bir akis
    // tarafindan (orn. handleDisconnectSolanaDapp) ZATEN silinmisse, taze
    // kopyada artik YOK -- bu durumda hicbir sey degismedigi icin depoya
    // YAZILMAMALI ve dapp'e "baglanti kesildi" BILDIRILMEMELI (zaten baska bir
    // akis bunu yapti; ikinci bir bildirim yanlis degil ama gereksizdir ve
    // "yalnizca GERCEKTEN silinene bildir" kuralinin bir parcasidir -- G2).
    it('yetim bu arada zaten silindiyse yazim YOK, bildirim de GITMEZ', async () => {
        const kur = kurChrome({
            solana_dapps: { [ORIGIN]: SESSION, [OTEKI]: { ...SESSION, accountKey: 'silinmis' } },
        })
        const asilGet = globalThis.chrome.storage.local.get
        let sayilan = 0
        globalThis.chrome.storage.local.get = async (keys) => {
            const w = Array.isArray(keys) ? keys : [keys]
            if (w.includes('solana_dapps')) sayilan++
            if (w.includes('solana_dapps') && sayilan === 2) {
                return { solana_dapps: { [ORIGIN]: SESSION } }
            }
            return asilGet(keys)
        }
        const { disconnectOrphanedSolanaSessions } = await import('./solanaDappFunctions.js')
        await disconnectOrphanedSolanaSessions([{ id: 'v1', accounts: [{ key: 'k1' }] }])
        expect(kur.yazimlar).toEqual([])
        expect(kur.gonderilen).toEqual([])
    })

    // G1: yetimlik TAZE kopyadan YENIDEN HESAPLANMALI, yalnizca VARLIK
    // kontrolu ile degil. Ilk okumadan sonra, ikinci (taze) okumadan once,
    // OTEKI GECERLI bir accountKey'e ('acc-1') es zamanli bir connect onayiyla
    // yeniden baglaniyor -- artik yetim DEGIL, ne silinmeli ne de bildirim
    // gitmeli.
    it('taze kopyada GECERLI accountKey ile yeniden baglanmis oturum artik yetim SAYILMAZ', async () => {
        const kur = kurChrome({
            solana_dapps: { [ORIGIN]: SESSION, [OTEKI]: { ...SESSION, accountKey: 'silinmis' } },
        })
        const asilGet = globalThis.chrome.storage.local.get
        let sayilan = 0
        globalThis.chrome.storage.local.get = async (keys) => {
            const w = Array.isArray(keys) ? keys : [keys]
            if (w.includes('solana_dapps')) sayilan++
            const sonuc = await asilGet(keys)
            if (w.includes('solana_dapps') && sayilan === 1) {
                kur.store.solana_dapps = { ...kur.store.solana_dapps, [OTEKI]: { ...SESSION, accountKey: 'acc-1' } }
            }
            return sonuc
        }
        const { disconnectOrphanedSolanaSessions } = await import('./solanaDappFunctions.js')
        await disconnectOrphanedSolanaSessions([{ id: 'v1', accounts: [{ key: 'k1' }, { key: 'acc-1' }] }])

        expect(kur.store.solana_dapps[OTEKI]).toEqual({ ...SESSION, accountKey: 'acc-1' })
        expect(kur.store.solana_dapps[ORIGIN]).toEqual(SESSION)
        expect(kur.yazimlar).toEqual([])
        expect(kur.gonderilen.some((g) => g.msg.origin === OTEKI)).toBe(false)
    })

    // "bilmiyorum" ile "hicbir hesap yok" AYNI SEY DEGIL: ikincisini varsaymak
    // kullanicinin butun dapp baglantilarini GERI ALINAMAZ sekilde silerdi.
    it('hesap anahtari cozulemezse HICBIR SEY silinmez', async () => {
        const kur = kurChrome({ solana_dapps: { [ORIGIN]: SESSION } })
        const { disconnectOrphanedSolanaSessions } = await import('./solanaDappFunctions.js')
        await disconnectOrphanedSolanaSessions([])
        expect(kur.store.solana_dapps[ORIGIN]).toEqual(SESSION)
        expect(kur.yazimlar).toEqual([])
        expect(kur.gonderilen).toEqual([])
    })
})
