import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// TonConnect'in UC arka plan ucunda hesap kapisi. kurChrome/SENDER
// tonDappFunctions.connect.test.js'ten KOPYALANDI -- o dosyadaki notun ayni
// gerekcesi: test dosyalari birbirine bagimli olmamali, ortak bir yardimci
// modul biri bozulunca otekini de anlamsizca kirar.

const SENDER = { origin: 'https://app.dedust.io', tab: { id: 7, favIconUrl: 'https://app.dedust.io/f.ico' } }

const TON_UQ = 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG'
const TON_HESAP = { key: 'acc-ton', type: 'ton', name: 'TON 1', address: TON_UQ, tonAddress: TON_UQ }
// ESKI HIBRIT: type 'hd', yani artik TON imzalayamaz. R4/adim 10'un kapatmasi
// gereken nufus tam olarak budur -- oturumu diskte, imzalama yetenegi yok.
const HIBRIT_HESAP = { key: 'acc-hibrit', type: 'hd', name: 'Hesap A', address: '0xAaaa000000000000000000000000000000000001', tonFingerprint: 'f-eski' }

const TON_KASA = { fingerprint: 'f-ton', type: 'tonMnemonic', accounts: [TON_HESAP] }
const HD_KASA = { fingerprint: 'f-hd', type: 'hd', accounts: [HIBRIT_HESAP] }

const RAW_ADRES = '0:1111111111111111111111111111111111111111111111111111111111111111'
const MANIFEST_URL = 'https://cdn.example.com/dedust/manifest.json'
const MANIFEST_RAW = { url: 'https://cdn.example.com', name: 'DeDust', iconUrl: 'https://cdn.example.com/i.png' }

const OTURUM = {
    address: RAW_ADRES, publicKey: 'ab12', accountKey: 'acc-ton', chain: '-239',
    manifest: { name: 'DeDust', url: 'https://cdn.example.com', iconUrl: null, manifestUrl: MANIFEST_URL, sameOrigin: false },
    connectedAt: 1,
}
const OTURUM_HIBRIT = { ...OTURUM, accountKey: 'acc-hibrit' }

function kurChrome(local = {}) {
    const store = { ...local }
    const acilanPencereler = []
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => {
                    const w = keys === undefined ? Object.keys(store) : (Array.isArray(keys) ? keys : [keys])
                    return Object.fromEntries(w.map((k) => [k, store[k]]))
                },
                set: async (obj) => { Object.assign(store, obj) },
                remove: async (k) => { delete store[k] },
            },
        },
        windows: {
            create: async (opts) => { acilanPencereler.push(opts); return { id: acilanPencereler.length } },
            remove: async () => {},
            get: async () => ({}),
            getLastFocused: async () => ({ width: 1200, left: 0, top: 0 }),
            onRemoved: { addListener: () => {} },
        },
        tabs: { sendMessage: async () => {} },
        runtime: { getURL: (p) => 'chrome-extension://x/' + p },
    }
    return { store, acilanPencereler }
}

const gecerliGonderim = (id = 'r1') => ({
    params: [{
        method: 'sendTransaction',
        params: [JSON.stringify({
            valid_until: Math.floor(Date.now() / 1000) + 300,
            messages: [{ address: '0:2222222222222222222222222222222222222222222222222222222222222222', amount: '1000000000' }],
        })],
        id,
    }],
})

beforeEach(() => { vi.resetModules() })
afterEach(() => { delete globalThis.chrome; vi.unstubAllGlobals() })

describe('handleTonConnect hesap kapisi', () => {
    // ADIM 10'UN ACIK SARTI: red manifest INDIRILMEDEN once olmali. Manifest
    // indirmesi bir AG TURUDUR: hicbir zaman baglanamayacak bir istek icin dis
    // bir sunucuya gitmek, sayfaya "bu manifest URL'i ulasilabilir mi" diye
    // soran bir ORACLE verir (fetchManifest'in kendi sema kontrolunun
    // engellemek icin yazildigi seyin AYNISI) ve 8 saniyeye kadar bosuna bekler.
    it('TON olmayan aktif hesapta manifest HIC INDIRILMEZ, kod 300 doner', async () => {
        const { store, acilanPencereler } = kurChrome({ active_account: HIBRIT_HESAP, vaults: [HD_KASA] })
        const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => MANIFEST_RAW }))
        vi.stubGlobal('fetch', fetchSpy)

        const { handleTonConnect } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonConnect({ params: [{ manifestUrl: MANIFEST_URL, items: [{ name: 'ton_addr' }] }] }, SENDER, (r) => yanitlar.push(r))

        expect(fetchSpy).not.toHaveBeenCalled()
        expect(acilanPencereler.length).toBe(0)
        expect(store.current_request).toBeUndefined()
        expect(yanitlar[0].result.event).toBe('connect_error')
        // 300 = USER_REJECTS. Mesaj da kullanicinin reddiyle BIREBIR AYNI:
        // sayfa "cuzdanda TON hesabi yok" ile "kullanici reddetti"yi AYIRT
        // EDEMEMELI, aksi halde anonim bir sayfa cuzdanin hesap bilesimini
        // parmak izi olarak okuyabilirdi.
        expect(yanitlar[0].result.payload.code).toBe(300)
        expect(yanitlar[0].result.payload.message).toBe('User rejected the request')
    })

    it('aktif hesap HIC YOKSA kapi KAPALI duser (FAIL-CLOSED)', async () => {
        const { acilanPencereler } = kurChrome({ vaults: [] })
        const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => MANIFEST_RAW }))
        vi.stubGlobal('fetch', fetchSpy)

        const { handleTonConnect } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonConnect({ params: [{ manifestUrl: MANIFEST_URL, items: [] }] }, SENDER, (r) => yanitlar.push(r))

        expect(fetchSpy).not.toHaveBeenCalled()
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].result.payload.code).toBe(300)
    })

    it('TON hesabinda akis normal ilerler: manifest indirilir, pencere acilir', async () => {
        const { store, acilanPencereler } = kurChrome({ active_account: TON_HESAP, vaults: [TON_KASA] })
        const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => MANIFEST_RAW }))
        vi.stubGlobal('fetch', fetchSpy)

        const { handleTonConnect } = await import('./tonDappFunctions.js')
        await handleTonConnect({ params: [{ manifestUrl: MANIFEST_URL, items: [{ name: 'ton_addr' }] }] }, SENDER, () => {})

        expect(fetchSpy).toHaveBeenCalledTimes(1)
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.type).toBe('TON_CONNECT')
    })

    // Bicimsel hata dapp'in KENDI hatasidir ve hesaptan BAGIMSIZ olarak 1 ile
    // yanitlanmali: hesap kapisi manifestUrl kontrolunun ONUNE gecerse, bozuk
    // istek gonderen bir dapp "kullanici reddetti" gorur ve hatasini hic bulamaz.
    it('manifestUrl eksikse hesap kapisindan ONCE kod 1 doner', async () => {
        kurChrome({ active_account: HIBRIT_HESAP, vaults: [HD_KASA] })
        const { handleTonConnect } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonConnect({ params: [{ items: [] }] }, SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.payload.code).toBe(1)
    })
})

describe('handleTonRestore hesap kapisi', () => {
    it('oturum eski hibrit hesaba sabitlenmisse adres DONMEZ, kod 100', async () => {
        kurChrome({ ton_dapps: { 'app.dedust.io': OTURUM_HIBRIT }, vaults: [HD_KASA] })
        const { handleTonRestore } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonRestore({}, SENDER, (r) => yanitlar.push(r))

        expect(yanitlar[0].result.event).toBe('connect_error')
        expect(yanitlar[0].result.payload.code).toBe(100)
        // Adres yanitin HICBIR yerinde gecmemeli: "oturum var ama hesabi
        // kayboldu" ile "hic oturum yok" dapp acisindan AYNI olmali.
        expect(JSON.stringify(yanitlar[0])).not.toContain(RAW_ADRES)
    })

    it('accountKey hicbir kasada bulunamazsa da kod 100 (yetim oturum)', async () => {
        kurChrome({ ton_dapps: { 'app.dedust.io': { ...OTURUM, accountKey: 'silinmis' } }, vaults: [TON_KASA] })
        const { handleTonRestore } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonRestore({}, SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.payload.code).toBe(100)
    })

    it('oturum TON hesabina sabitlenmisse adres normal doner (kilitliyken de)', async () => {
        // active_account YOK: kilitli cuzdan yolu. Kasa META verisi (accounts[])
        // sifreli DEGIL, o yuzden kapi kilit sormadan calisabiliyor.
        kurChrome({ ton_dapps: { 'app.dedust.io': OTURUM }, vaults: [TON_KASA] })
        const { handleTonRestore } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonRestore({}, SENDER, (r) => yanitlar.push(r))

        expect(yanitlar[0].result.event).toBe('connect')
        expect(yanitlar[0].result.payload.items[0].address).toBe(RAW_ADRES)
    })
})

describe('handleTonSend hesap kapisi', () => {
    // BUGUNKU DEFEKT: oturum kapisi VAR, hesap kapisi YOK. Eski hibrit oturum
    // onay penceresini ACIYOR ve is icerideki createTonKeyPair'da, eslenmemis
    // bir hatayla, kullanici "Onayla"ya bastiktan SONRA olyuyor.
    it('eski hibrit oturum ONAY PENCERESI ACTIRAMAZ, kod 100 doner', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': OTURUM_HIBRIT }, vaults: [HD_KASA] })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(gecerliGonderim(), SENDER, (r) => yanitlar.push(r))

        expect(acilanPencereler.length).toBe(0)
        expect(store.current_request).toBeUndefined()
        expect(yanitlar[0].result.error.code).toBe(100)
        expect(yanitlar[0].result.id).toBe('r1')
    })

    it('signData yolunda da ayni kapi vardir', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': OTURUM_HIBRIT }, vaults: [HD_KASA] })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend({ params: [{ method: 'signData', params: [JSON.stringify({ type: 'text', text: 'merhaba' })], id: 's1' }] }, SENDER, (r) => yanitlar.push(r))

        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].result.error.code).toBe(100)
    })

    it('TON hesabina sabitlenmis oturumda pencere normal acilir', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': OTURUM }, vaults: [TON_KASA] })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        await handleTonSend(gecerliGonderim(), SENDER, () => {})

        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.type).toBe('TON_SEND_TX')
        expect(store.current_request.accountKey).toBe('acc-ton')
    })

    // Sira kilitleniyor: BILINMEYEN METOT hesap kapisindan ONCE elenmeli.
    // Aksi halde tanimadigimiz bir metot icin dapp "baglantiniz kesildi" (100)
    // gorur, oysa dogru cevap "desteklenmiyor" (400).
    it('bilinmeyen metot hesap kapisindan ONCE elenir: yine 400', async () => {
        kurChrome({ ton_dapps: { 'app.dedust.io': OTURUM_HIBRIT }, vaults: [HD_KASA] })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend({ params: [{ method: 'uydurma', params: [], id: 'm1' }] }, SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.error.code).toBe(400)
    })

    // disconnect hesap kapisinin ONUNDE kalir: imzalamayan, YALNIZCA SILEN bir
    // metodu bloke etmek, kullaniciyi silemedigi bir oturumla birakirdi.
    it('disconnect hesap kapisina TAKILMAZ, oturum silinir', async () => {
        const { store } = kurChrome({ ton_dapps: { 'app.dedust.io': OTURUM_HIBRIT }, vaults: [HD_KASA] })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend({ params: [{ method: 'disconnect', params: [], id: 'd1' }] }, SENDER, (r) => yanitlar.push(r))

        expect(store.ton_dapps['app.dedust.io']).toBeUndefined()
        expect(yanitlar[0].result).toEqual({ result: {}, id: 'd1' })
    })
})
