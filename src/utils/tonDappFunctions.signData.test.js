import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { beginCell } from '@ton/core'

// Task 9'daki kurChrome/SENDER/SESSION buraya KOPYALANDI (tonDappFunctions.sendTx.test.js'ten):
// test dosyalari birbirinden BAGIMSIZ olmali, ortak bir yardimci modul iki dosyayi
// birbirine baglar ve biri bozulunca digeri de anlamsizca kirilir.
const SENDER = { origin: 'https://app.dedust.io', tab: { id: 7, favIconUrl: 'https://app.dedust.io/f.ico' } }

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

// manifest.url BILEREK SENDER.origin'den FARKLI bir host (K4/Onemli 5): ikisi
// ayni dizeyi paylassaydi, origin'i sender'dan degil manifest'ten okuyan YANLIS
// bir implementasyon da asagidaki origin iddiasini gecerdi.
const SESSION = {
    address: '0:1111111111111111111111111111111111111111111111111111111111111111',
    publicKey: 'ab12', accountKey: 'acc-1', chain: '-239',
    manifest: { name: 'DeDust', url: 'https://cdn.example.com', iconUrl: null, manifestUrl: 'https://cdn.example.com/m.json', sameOrigin: false },
    connectedAt: 1,
}

// GERCEK, gecerli bir BOC -- background.tonProof.test.js'teki mutasyon-kilidi
// testinde kullanilan AYNI teknik (beginCell().storeUint(0,32).endCell().toBoc()):
// probe icin de icerigin ANLAMI onemsiz, sadece Cell.fromBase64'un ayristirabilecegi
// GECERLI bir BOC olmasi gerekiyor.
const CELL_B64 = beginCell().storeUint(0, 32).endCell().toBoc().toString('base64')

function signIstegi(payload, id = 's1') {
    return { params: [{ method: 'signData', params: [JSON.stringify({ network: '-239', from: SESSION.address, ...payload })], id }] }
}

describe('signData', () => {
    it.each([
        ['text', { type: 'text', text: 'Merhaba' }],
        ['binary', { type: 'binary', bytes: 'AQID' }],
        // GERCEK bir BOC lazim: handleTonSignData artik onay penceresinden ONCE
        // TAM `buildSignDataInput` probu calistiriyor (Cell.fromBase64 dahil).
        // 'te6ccgEB' (once buradaydi) GECERSIZ bir BOC -- Cell.fromBase64 onu
        // firlatir, probe basarisiz olur ve bu test PENCERE ACILMAZDI.
        ['cell', { type: 'cell', schema: 'transfer#0f8a7ea5', cell: CELL_B64 }],
    ])('%s yuku TON_SIGN_DATA penceresi acar', async (_ad, payload) => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        await handleTonSend(signIstegi(payload), SENDER, () => {})
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.type).toBe('TON_SIGN_DATA')
        expect(store.current_request.payload.type).toBe(payload.type)
        expect(store.current_request.from).toBe(SESSION.address)
        // KAPSAM GENISLEMESI (kontrolor karari, gorev 13): handleTonSendTransaction
        // bunu ZATEN yaziyordu, handleTonSignData YAZMIYORDU -- onay ekrani
        // hangi hesabin cozulecegini bilmeden aktif hesaba SESSIZCE dusebilirdi.
        expect(store.current_request.accountKey).toBe(SESSION.accountKey)
    })

    it('bilinmeyen yuk tipi kod 1, PENCERE ACILMAZ', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(signIstegi({ type: 'uydurma', text: 'x' }), SENDER, (r) => yanitlar.push(r))
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].result.error.code).toBe(1)
    })

    it('YABANCI from adresi kod 100', async () => {
        kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        const req = { params: [{ method: 'signData', params: [JSON.stringify({ from: '0:9999999999999999999999999999999999999999999999999999999999999999', type: 'text', text: 'x' })], id: 's9' }] }
        await handleTonSend(req, SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.error.code).toBe(100)
    })
})
