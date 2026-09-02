import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ACCOUNT = { key: 'acc-1', address: '0xAaaa000000000000000000000000000000000001', name: 'Hesap A', type: 'hd' }
const TON_ADDRESS_RAW = '0:1111111111111111111111111111111111111111111111111111111111111111'
const SENDER = { origin: 'https://app.dedust.io', tab: { id: 7, favIconUrl: 'https://app.dedust.io/f.ico' } }
// Manifest bir CDN'de barinir VE icerigindeki `url` alani GERCEK gonderen
// kokeninden (SENDER.origin) FARKLI bir host beyan eder. UCU de (SENDER.origin,
// MANIFEST_URL'in kokeni, MANIFEST_RAW.url) BASKA BASKA olmali: aksi halde
// origin'i SENDER yerine manifest'ten (raw.url ya da manifestUrl'in kokeninden)
// okuyan YANLIS bir implementasyon da asagidaki testleri GECERDI -- ucu de ayni
// degerde oldugu ESKI test verisiyle tam olarak bu kacak kapaliydi.
const MANIFEST_URL = 'https://cdn.example.com/dedust/manifest.json'
const MANIFEST_RAW = { url: 'https://cdn.example.com', name: 'DeDust', iconUrl: 'https://cdn.example.com/i.png' }

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

beforeEach(() => { vi.resetModules() })
afterEach(() => { delete globalThis.chrome; vi.unstubAllGlobals() })

describe('handleTonConnect', () => {
    it('manifest indirilir, onay penceresi TON_CONNECT tipiyle acilir', async () => {
        const { store, acilanPencereler } = kurChrome({ active_account: ACCOUNT })
        vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => MANIFEST_RAW }))

        const { handleTonConnect } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonConnect(
            { params: [{ manifestUrl: MANIFEST_URL, items: [{ name: 'ton_addr' }] }] },
            SENDER,
            (r) => yanitlar.push(r),
        )

        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.type).toBe('TON_CONNECT')
        // Origin SENDER'dan gelir, manifest'ten DEGIL (K5): manifest CDN'de
        // barinir ve kendi `url` alaninda BASKA bir host beyan eder. Origin
        // buradan turetilseydi onay ekraninda gercek gonderen yerine manifest'in
        // KENDI IDDIA ETTIGI kimlik gorunurdu.
        expect(store.current_request.origin).toBe(SENDER.origin)
        expect(store.current_request.manifest.name).toBe('DeDust')
        // sameOrigin FALSE: manifest CDN'de, dapp'in gercek kokeni (SENDER.origin)
        // BASKA. MANIFEST_URL'in kokeni de MANIFEST_RAW.url de SENDER.origin'den
        // farkli oldugu icin bu tek olcum, origin'in ucunden BIRINDEN degil
        // gercekten SENDER'dan geldigini de dolayli dogrular.
        expect(store.current_request.manifest.sameOrigin).toBe(false)
        // Henuz yanit YOK: kullanici onaylayana kadar promise askida.
        expect(yanitlar.length).toBe(0)
    })

    it('ton_proof istendigi onay ekranina TASINIR', async () => {
        const { store } = kurChrome({ active_account: ACCOUNT })
        vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => MANIFEST_RAW }))
        const { handleTonConnect } = await import('./tonDappFunctions.js')
        await handleTonConnect({
            params: [{ manifestUrl: 'https://app.dedust.io/m.json', items: [{ name: 'ton_addr' }, { name: 'ton_proof', payload: 'nonce-1' }] }],
        }, SENDER, () => {})
        expect(store.current_request.proofPayload).toBe('nonce-1')
    })

    it('manifest indirilemezse kod 2 doner, PENCERE ACILMAZ', async () => {
        const { acilanPencereler } = kurChrome({ active_account: ACCOUNT })
        vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({}) }))
        const { handleTonConnect } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonConnect({ params: [{ manifestUrl: 'https://app.dedust.io/m.json', items: [] }] }, SENDER, (r) => yanitlar.push(r))
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].result.event).toBe('connect_error')
        expect(yanitlar[0].result.payload.code).toBe(2)
    })

    it('manifest icerigi bozuksa kod 3', async () => {
        kurChrome({ active_account: ACCOUNT })
        vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => ({ name: 'yalniz-ad' }) }))
        const { handleTonConnect } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonConnect({ params: [{ manifestUrl: 'https://a/m.json', items: [] }] }, SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.payload.code).toBe(3)
    })

    // Hata TonConnect BICIMINDE doner: `{ result: { event: 'connect_error' } }`.
    // EIP-1193 sekli `{ error: { code } }` gonderilseydi dapp'in kutuphanesi
    // yaniti hic tanimazdi.
    it('manifestUrl yoksa connect_error kod 1', async () => {
        kurChrome({ active_account: ACCOUNT })
        const { handleTonConnect } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonConnect({ params: [{ items: [] }] }, SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.event).toBe('connect_error')
        expect(yanitlar[0].result.payload.code).toBe(1)
    })

    // http(s) disi bir manifestUrl (file:, javascript: ...) fetch'e HIC
    // GONDERILMEMELI: yetkisiz bir sayfaya "bu host acik mi/kapali mi" diye
    // soran bir ORACLE vermemek icin (kod 2 ile kod 3 arasindaki fark bile
    // yeterli bir prob sinyali olurdu).
    it('manifestUrl semasi http(s) degilse kod 2 doner, fetch HIC cagrilmaz', async () => {
        kurChrome({ active_account: ACCOUNT })
        const fetchSpy = vi.fn()
        vi.stubGlobal('fetch', fetchSpy)
        const { handleTonConnect } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonConnect({ params: [{ manifestUrl: 'javascript:alert(1)', items: [] }] }, SENDER, (r) => yanitlar.push(r))
        expect(fetchSpy).not.toHaveBeenCalled()
        expect(yanitlar[0].result.event).toBe('connect_error')
        expect(yanitlar[0].result.payload.code).toBe(2)
    })
})

describe('handleTonRestore', () => {
    const SESSION = {
        address: TON_ADDRESS_RAW, publicKey: 'ab12', accountKey: 'acc-1', chain: '-239',
        manifest: { name: 'DeDust', url: 'https://app.dedust.io', iconUrl: null, manifestUrl: 'https://app.dedust.io/m.json', sameOrigin: true },
        connectedAt: 1,
    }

    it('kayitli oturum varsa connect olayi doner', async () => {
        kurChrome({ ton_dapps: { 'app.dedust.io': SESSION }, active_account: ACCOUNT })
        const { handleTonRestore } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonRestore({}, SENDER, (r) => yanitlar.push(r))
        const olay = yanitlar[0].result
        expect(olay.event).toBe('connect')
        const addrItem = olay.payload.items.find((i) => i.name === 'ton_addr')
        expect(addrItem.address).toBe(TON_ADDRESS_RAW)
        expect(addrItem.network).toBe('-239')
        expect(addrItem.publicKey).toBe('ab12')
    })

    // Cuzdan KILITLIYKEN de calisir: adres zaten aleni bir veri ve dapp bunu HER
    // sayfa yuklemesinde cagiriyor. Kilit istemek, her TON dapp'ini acilista
    // parola ekranina dusururdu.
    it('cuzdan kilitliyken de kayitli adresi doner', async () => {
        kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonRestore } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonRestore({}, SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.event).toBe('connect')
    })

    it('oturum yoksa connect_error kod 100', async () => {
        kurChrome({ ton_dapps: {} })
        const { handleTonRestore } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonRestore({}, SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.event).toBe('connect_error')
        expect(yanitlar[0].result.payload.code).toBe(100)
    })
})

describe('handleTonSend — disconnect', () => {
    it('oturum silinir ve bos sonuc doner', async () => {
        const { store } = kurChrome({ ton_dapps: { 'app.dedust.io': { address: TON_ADDRESS_RAW, accountKey: 'acc-1' } } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend({ params: [{ method: 'disconnect', params: [], id: '5' }] }, SENDER, (r) => yanitlar.push(r))
        expect(store.ton_dapps['app.dedust.io']).toBeUndefined()
        expect(yanitlar[0].result).toEqual({ result: {}, id: '5' })
    })

    it('bilinmeyen metot kod 400', async () => {
        kurChrome({ ton_dapps: {} })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend({ params: [{ method: 'uydurma', params: [], id: '6' }] }, SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.error.code).toBe(400)
    })

    it('kayitsiz origin sendTransaction isteyemez (kod 100)', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: {} })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend({ params: [{ method: 'sendTransaction', params: ['{}'], id: '7' }] }, SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.error.code).toBe(100)
        // Task 9/10 bu kapinin ARKASINI (sendTransaction/signData govdesini)
        // dolduracak: kapi burada GERCEKTEN kapali kalmali -- ne bir onay
        // penceresi acilmali ne de (hic var olmayan) bir oturum yazilmali.
        // Yalniz error.code'a bakmak, onay penceresini acip SONRA 100 donen
        // bir implementasyonu da gecerdi.
        expect(acilanPencereler.length).toBe(0)
        expect(store.ton_dapps['app.dedust.io']).toBeUndefined()
    })
})
