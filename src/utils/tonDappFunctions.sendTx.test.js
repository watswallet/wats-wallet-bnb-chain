import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Task 8'deki kurChrome/SENDER buraya KOPYALANDI (tonDappFunctions.connect.test.js'ten):
// test dosyalari birbirinden BAGIMSIZ olmali, ortak bir yardimci modul iki dosyayi
// birbirine baglar ve biri bozulunca digeri de anlamsizca kirilir.
const SENDER = { origin: 'https://app.dedust.io', tab: { id: 7, favIconUrl: 'https://app.dedust.io/f.ico' } }

const VARSAYILAN_TON_KASA = {
    fingerprint: 'f-ton', type: 'tonMnemonic',
    accounts: [{ key: 'acc-1', type: 'ton', name: 'TON 1', address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG' }],
}

function kurChrome(local = {}) {
    // vaults VARSAYILAN: bkz. tonDappFunctions.connect.test.js'teki ayni not.
    const store = { vaults: [VARSAYILAN_TON_KASA], ...local }
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

// manifest.url BILEREK SENDER.origin'den FARKLI bir host (K4/Onemli 5): ikisi
// ayni dizeyi paylassaydi, origin'i sender'dan degil manifest'ten okuyan YANLIS
// bir implementasyon da asagidaki origin iddiasini gecerdi.
const SESSION = {
    address: '0:1111111111111111111111111111111111111111111111111111111111111111',
    publicKey: 'ab12', accountKey: 'acc-1', chain: '-239',
    manifest: { name: 'DeDust', url: 'https://cdn.example.com', iconUrl: null, manifestUrl: 'https://cdn.example.com/m.json', sameOrigin: false },
    connectedAt: 1,
}
const MSG = { address: '0:2222222222222222222222222222222222222222222222222222222222222222', amount: '1000000000' }

function istek(params, id = 'r1') {
    return { params: [{ method: 'sendTransaction', params: [JSON.stringify(params)], id }] }
}

describe('sendTransaction', () => {
    it('gecerli istek TON_SEND_TX onay penceresi acar', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        await handleTonSend(istek({ valid_until: Math.floor(Date.now() / 1000) + 300, messages: [MSG] }), SENDER, () => {})

        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.type).toBe('TON_SEND_TX')
        expect(store.current_request.messages.length).toBe(1)
        expect(store.current_request.messages[0].amountNano).toBe('1000000000')
        expect(store.current_request.from).toBe(SESSION.address)
        expect(store.current_request.manifest.name).toBe('DeDust')
        // Origin SENDER'dan gelmeli, oturumun manifest.url'sinden DEGIL (K4). SESSION
        // yukarida BILEREK farkli bir manifest.url tasiyor, yani bu iddia gercekten
        // ayirt edici: manifest'ten okuyan yanlis bir implementasyon burada duser.
        expect(store.current_request.origin).toBe(SENDER.origin)
        // Onemli 4 (plumbing yarisi): onay ekraninin tonDappSend'e geri
        // gonderebilmesi icin hangi kasa hesabinin imzalayacagi da yazilmali.
        expect(store.current_request.accountKey).toBe(SESSION.accountKey)
    })

    it('4 mesaj gecer, 5 mesaj kod 1 ve PENCERE ACILMAZ', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')

        await handleTonSend(istek({ messages: Array(4).fill(MSG) }), SENDER, () => {})
        expect(acilanPencereler.length).toBe(1)

        const yanitlar = []
        await handleTonSend(istek({ messages: Array(5).fill(MSG) }, 'r2'), SENDER, (r) => yanitlar.push(r))
        expect(acilanPencereler.length).toBe(1)
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.id).toBe('r2')
    })

    it('gecmis valid_until kod 1, PENCERE ACILMAZ', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(istek({ valid_until: 1, messages: [MSG] }), SENDER, (r) => yanitlar.push(r))
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].result.error.code).toBe(1)
    })

    // Oturum ADRESE bagli (§7.1). Dapp baska bir adres icin islem hazirlatamaz.
    it('YABANCI from adresi kod 100, PENCERE ACILMAZ', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(istek({ from: '0:9999999999999999999999999999999999999999999999999999999999999999', messages: [MSG] }), SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.error.code).toBe(100)
        // Sadece hata koduna bakmak, once onay penceresini acip SONRA 100 donen
        // yanlis bir implementasyonu da gecerdi (bkz. gorev notu).
        expect(acilanPencereler.length).toBe(0)
    })

    it('istekteki network cuzdaninkiyle uyusmuyorsa kod 1', async () => {
        kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(istek({ network: '-3', messages: [MSG] }), SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.error.code).toBe(1)
    })
})
