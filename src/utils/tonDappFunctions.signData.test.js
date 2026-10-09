import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { beginCell } from '@ton/core'

// Task 9'daki kurChrome/SENDER/SESSION buraya KOPYALANDI (tonDappFunctions.sendTx.test.js'ten):
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

// B2: ag/from uyusmazligi ONAY penceresi ACMAZ ama yalniz-uyari penceresi acar.
const onayPencereleri = (p) => p.filter((o) => o.url.endsWith('#window'))
const uyariPencereleri = (p) => p.filter((o) => o.url.endsWith('#alert'))

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

// id SAYISAL dize: oturum basina artan olmali (rpc.md), SDK '0','1',... gonderir.
function signIstegi(payload, id = '1') {
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

    // Kod 1 (BAD_REQUEST, sign-data.md Step 3); 100 oturum/hesap kapilarina ait.
    // B2 (rpc.md:347): kullanici yalniz-uyari penceresinde nedenini gorur.
    it('YABANCI from adresi kod 1, ONAY penceresi acilmaz, UYARI penceresi acilir', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        const yabanci = '0:9999999999999999999999999999999999999999999999999999999999999999'
        const req = { params: [{ method: 'signData', params: [JSON.stringify({ from: yabanci, type: 'text', text: 'x' })], id: '9' }] }
        await handleTonSend(req, SENDER, (r) => yanitlar.push(r))
        expect(yanitlar).toHaveLength(1)
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.error.message).toBe('Requested from address does not match the connected account')
        expect(onayPencereleri(acilanPencereler)).toHaveLength(0)
        expect(uyariPencereleri(acilanPencereler)).toHaveLength(1)
        expect(store.ton_alert).toMatchObject({
            kind: 'from', hostname: 'app.dedust.io', appName: 'DeDust',
            requested: yabanci, expected: SESSION.address, network: '-239',
        })
        expect(store.current_request).toBeUndefined()
    })

    // Uyumsuzluk DISINDAKI kod 1 retleri yalniz-uyari penceresi de ACMAZ.
    it('bozuk signData parametresi kod 1, HICBIR pencere acilmaz', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend({ params: [{ method: 'signData', params: ['{bozuk'], id: '1' }] }, SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.error).toEqual({ code: 1, message: 'Malformed signData params' })
        expect(acilanPencereler).toHaveLength(0)
        expect(store.ton_alert).toBeUndefined()
    })

    // Oturum adresi HAM saklanir; dapp ayni hesabi friendly bicimde de verebilir (rpc.md).
    it.each([
        ['EQ', 'EQAREREREREREREREREREREREREREREREREREREREREREeYT'],
        ['UQ', 'UQAREREREREREREREREREREREREREREREREREREREREREbvW'],
    ])('from oturum adresinin %s bicimiyse pencere acilir', async (_ad, from) => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        await handleTonSend(signIstegi({ type: 'text', text: 'x', from }), SENDER, () => {})
        expect(acilanPencereler.length).toBe(1)
        // signData yanitindaki `address` HAM olmali (rpc.md): oturum adresi kalir.
        expect(store.current_request.from).toBe(SESSION.address)
    })

    it.each([[123], [false], [{}]])('dize olmayan from %j kod 1, ONAY penceresi acilmaz, UYARI acilir', async (from) => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(signIstegi({ type: 'text', text: 'x', from }), SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.error.message).toBe('Requested from address does not match the connected account')
        expect(onayPencereleri(acilanPencereler)).toHaveLength(0)
        expect(uyariPencereleri(acilanPencereler)).toHaveLength(1)
        expect(store.ton_alert).toMatchObject({ kind: 'from', requested: null, expected: SESSION.address })
    })
})

// rpc.md signData: AppDomain connect ile ayni kurala uyar (connect.md
// Domain-binding rules); imzalanan ad GONDEREN cercevenin hostname'idir.
describe('signData alan adi kapisi', () => {
    it('noktasiz host (localhost) oturumundan signData kod 1, PENCERE ACILMAZ', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { localhost: SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(signIstegi({ type: 'text', text: 'x' }), { origin: 'http://localhost:3000', tab: { id: 7 } }, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.error.message).toBe('signData requires a domain with a dot')
        expect(yanitlar[0].result.id).toBe('1')
        expect(acilanPencereler.length).toBe(0)
        expect(store.current_request).toBeUndefined()
    })

    it('127.0.0.1 oturumundan signData pencere acar', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { '127.0.0.1': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        await handleTonSend(signIstegi({ type: 'text', text: 'x' }), { origin: 'http://127.0.0.1:4545', tab: { id: 7 } }, () => {})
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.hostname).toBe('127.0.0.1')
    })
})

// rpc.md signData: `network` verilmis ve cuzdanin aginden farkliysa imza YOK.
// Ag OPAK bir dizedir: sayi -239 bile '-239' ile uyusmaz. Cuzdan agi
// currentNetwork'ten okunur (depoda yoksa mainnet).
describe('signData ag kapisi', () => {
    const TESTNET_OTURUM = { ...SESSION, chain: '-3' }

    // Sayi -239 '-239' ile uyusmaz (opak kimlik); uyari onu dize gibi YANSITMAZ
    // (null -> ekranda "gecersiz deger"), yoksa "Mainnet istedi, cuzdan Mainnet'te" cikardi.
    it.each([
        ['testnet dizesi', '-3', '-3'],
        ['sayi -239', -239, null],
    ])('mainnet cuzdanda network %s kod 1, ONAY penceresi acilmaz, UYARI acilir', async (_ad, network, uyaridaki) => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': SESSION } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(signIstegi({ type: 'text', text: 'x', network }), SENDER, (r) => yanitlar.push(r))
        expect(yanitlar).toHaveLength(1)
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.error.message).toBe('Requested network does not match the wallet network')
        expect(onayPencereleri(acilanPencereler)).toHaveLength(0)
        expect(uyariPencereleri(acilanPencereler)).toHaveLength(1)
        expect(store.ton_alert).toMatchObject({ kind: 'network', hostname: 'app.dedust.io', requested: uyaridaki, expected: '-239' })
        expect(store.current_request).toBeUndefined()
    })

    // W5 adresi aga gore DEGISIR: testnette kurulan oturumun adresi mainnet
    // cuzdanda imzalanamaz, hata ancak Onayla'dan SONRA gelirdi.
    // network YOKSA dapp'in niyeti oturumun agidir: uyari onu gosterir.
    it('network YOKSA ve oturum agi cuzdaninkinden farkliysa kod 1, ONAY penceresi acilmaz, UYARI acilir', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': TESTNET_OTURUM } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        const req = { params: [{ method: 'signData', params: [JSON.stringify({ type: 'text', text: 'x' })], id: '1' }] }
        await handleTonSend(req, SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.error.message).toBe('Wallet network does not match the connected session')
        expect(onayPencereleri(acilanPencereler)).toHaveLength(0)
        expect(uyariPencereleri(acilanPencereler)).toHaveLength(1)
        expect(store.ton_alert).toMatchObject({ kind: 'network', requested: '-3', expected: '-239' })
        expect(store.current_request).toBeUndefined()
    })

    // Istek cuzdanin agini istese de oturum adresi o agda YOK: yine imzalanamaz.
    // network VERILMIS ve cuzdanla ayni: rpc.md:343 uyari sart kosmaz (yalniz
    // FARKLI network). Asagidaki 0, uyari penceresini de kapsar.
    it('network cuzdanla ayni ama oturum agi farkliysa yine kod 1', async () => {
        const { acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': TESTNET_OTURUM } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        const yanitlar = []
        await handleTonSend(signIstegi({ type: 'text', text: 'x', network: '-239' }), SENDER, (r) => yanitlar.push(r))
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(yanitlar[0].result.error.message).toBe('Wallet network does not match the connected session')
        expect(acilanPencereler.length).toBe(0)
    })

    it('testnet cuzdan, testnet oturum ve network -3: pencere acilir', async () => {
        const { store, acilanPencereler } = kurChrome({ ton_dapps: { 'app.dedust.io': TESTNET_OTURUM }, currentNetwork: { chainId: -3 } })
        const { handleTonSend } = await import('./tonDappFunctions.js')
        await handleTonSend(signIstegi({ type: 'text', text: 'x', network: '-3' }), SENDER, () => {})
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.type).toBe('TON_SIGN_DATA')
    })
})
