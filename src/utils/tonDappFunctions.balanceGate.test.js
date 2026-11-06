import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { beginCell, storeStateInit } from '@ton/core'

// TON Connect Test Runner "[amount] Error if insufficient balance" (D4): tek mesaj,
// amount 10000 TON, stateInit + payload var, hesapta ~1 TON. Beklenen
// {error:{code:1,message}, id} -- onay penceresi ACILMADAN.
//
// Bakiye okumasi AG isidir: ton/tonClient burada sahtelenir (gercek proxy'ye
// gidilmez, her test okumayi kendisi belirler).
const mocks = vi.hoisted(() => ({ getBalance: vi.fn(), getTonClient: vi.fn() }))
vi.mock('./ton/tonClient', () => ({ getTonClient: mocks.getTonClient }))

const SENDER = { origin: 'https://app.dedust.io', tab: { id: 7, favIconUrl: 'https://app.dedust.io/f.ico' } }
const VARSAYILAN_TON_KASA = {
    fingerprint: 'f-ton', type: 'tonMnemonic',
    accounts: [{ key: 'acc-1', type: 'ton', name: 'TON 1', address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG' }],
}
const SESSION = {
    address: '0:1111111111111111111111111111111111111111111111111111111111111111',
    publicKey: 'ab12', accountKey: 'acc-1', chain: '-239',
    manifest: { name: 'DeDust', url: 'https://cdn.example.com', iconUrl: null, manifestUrl: 'https://cdn.example.com/m.json', sameOrigin: false },
    connectedAt: 1,
}
const ADRES = 'UQAiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIsAH'
const TON = 1_000_000_000n
const ESIK_MESAJI = 'Insufficient TON balance for the requested amount'

const PAYLOAD = beginCell().storeUint(0, 32).storeStringTail('hi').endCell().toBoc().toString('base64')
const STATE_INIT = beginCell()
    .store(storeStateInit({ code: beginCell().storeUint(1, 8).endCell(), data: beginCell().storeUint(2, 8).endCell() }))
    .endCell().toBoc().toString('base64')

// Runner'in D4 vakasi: 10000 TON, stateInit + payload.
const D4 = { address: ADRES, amount: '10000000000000', stateInit: STATE_INIT, payload: PAYLOAD }

function kurChrome(local = {}) {
    const store = { vaults: [VARSAYILAN_TON_KASA], ton_dapps: { 'app.dedust.io': SESSION }, ...local }
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

function istek(messages, id = '1') {
    return { params: [{ method: 'sendTransaction', params: [JSON.stringify({ valid_until: Math.floor(Date.now() / 1000) + 300, messages })], id }] }
}

async function gonder(req) {
    const { handleTonSend } = await import('./tonDappFunctions.js')
    const yanitlar = []
    await handleTonSend(req, SENDER, (r) => yanitlar.push(r))
    return yanitlar
}

beforeEach(() => {
    vi.resetModules()
    mocks.getBalance.mockReset()
    mocks.getTonClient.mockReset()
    mocks.getTonClient.mockReturnValue({ getBalance: mocks.getBalance })
})
afterEach(() => { delete globalThis.chrome; vi.useRealTimers(); vi.unstubAllGlobals() })

describe('sendTransaction: kesin yetmeyen bakiye (D4)', () => {
    it('Runner D4: stateInit + payload, 10000 TON vs 1 TON -> kod 1, PENCERE ACILMAZ', async () => {
        const { acilanPencereler, store } = kurChrome()
        mocks.getBalance.mockResolvedValue(1n * TON)
        const yanitlar = await gonder(istek([D4]))
        expect(acilanPencereler.length).toBe(0)
        expect(store.current_request).toBeUndefined()
        expect(yanitlar.length).toBe(1)
        expect(yanitlar[0].result).toEqual({ error: { code: 1, message: ESIK_MESAJI }, id: '1' })
    })

    it('mesaj SAYI ICERMEZ (bakiye/tutar sizdirilmaz)', async () => {
        kurChrome()
        mocks.getBalance.mockResolvedValue(1n * TON)
        const yanitlar = await gonder(istek([D4]))
        expect(yanitlar[0].result.error.message).not.toMatch(/\d/)
    })

    it('bakiye oturum adresi icin, ortak proxy tabaniyla okunur', async () => {
        kurChrome()
        mocks.getBalance.mockResolvedValue(1n * TON)
        await gonder(istek([D4]))
        expect(mocks.getTonClient).toHaveBeenCalledWith(import.meta.env.VITE_API_URL || 'http://localhost:8000')
        expect(mocks.getBalance).toHaveBeenCalledTimes(1)
        expect(mocks.getBalance.mock.calls[0][0].toRawString()).toBe(SESSION.address)
    })

    it('bakiye yeterli -> pencere acilir', async () => {
        const { acilanPencereler, store } = kurChrome()
        mocks.getBalance.mockResolvedValue(10001n * 1000n * TON)
        const yanitlar = await gonder(istek([D4]))
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.type).toBe('TON_SEND_TX')
        expect(yanitlar.length).toBe(0)
    })

    it('bakiye tam esige esitse (esik > bakiye degil) pencere acilir', async () => {
        const { acilanPencereler } = kurChrome()
        mocks.getBalance.mockResolvedValue(10000000000000n)
        await gonder(istek([D4]))
        expect(acilanPencereler.length).toBe(1)
    })

    it('bigint hassasiyeti: double araligini asan bakiye/esik farki 1 nanoton da yakalanir', async () => {
        const { acilanPencereler } = kurChrome()
        mocks.getBalance.mockResolvedValue(9007199254740993n)
        const yanitlar = await gonder(istek([{ ...D4, amount: '9007199254740994' }]))
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].result.error.code).toBe(1)
    })

    it('bakiye okuma HATASI -> fail-open: pencere acilir', async () => {
        const { acilanPencereler } = kurChrome()
        mocks.getBalance.mockRejectedValue(new Error('rpc down'))
        const yanitlar = await gonder(istek([D4]))
        expect(acilanPencereler.length).toBe(1)
        expect(yanitlar.length).toBe(0)
    })

    it('istemci kurulamazsa (getTonClient firlatir) pencere acilir', async () => {
        const { acilanPencereler } = kurChrome()
        mocks.getTonClient.mockImplementation(() => { throw new Error('TON_API_BASE_MISSING') })
        await gonder(istek([D4]))
        expect(acilanPencereler.length).toBe(1)
    })

    it('okuma 3000 ms icinde bitmezse -> fail-open: pencere acilir', async () => {
        // Modul onceden yuklenir: dinamik import gercek zaman alir, sahte saat o
        // sirada ilerlerse zamanlayici SONRADAN kurulur ve test yanlis okunur.
        const { acilanPencereler } = kurChrome()
        await import('./tonDappFunctions.js')
        vi.useFakeTimers()
        mocks.getBalance.mockReturnValue(new Promise(() => {}))
        const bitti = gonder(istek([D4]))
        for (let i = 0; i < 29; i++) await vi.advanceTimersByTimeAsync(100)
        expect(mocks.getBalance).toHaveBeenCalledTimes(1)
        expect(acilanPencereler.length).toBe(0)
        for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(100)
        await bitti
        expect(acilanPencereler.length).toBe(1)
    })

    it('zaman asimi zamanlayicisi temizlenir (hizli okuma sonrasi askida timer yok)', async () => {
        vi.useFakeTimers()
        kurChrome()
        mocks.getBalance.mockResolvedValue(1n * TON)
        const bitti = gonder(istek([D4]))
        await vi.advanceTimersByTimeAsync(10)
        const yanitlar = await bitti
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(vi.getTimerCount()).toBe(0)
    })

    it('mainnet DISI (testnet) -> bakiye HIC okunmaz, pencere acilir', async () => {
        const { acilanPencereler } = kurChrome({
            currentNetwork: { chainId: -3 },
            ton_dapps: { 'app.dedust.io': { ...SESSION, chain: '-3' } },
        })
        mocks.getBalance.mockResolvedValue(1n * TON)
        await gonder(istek([D4]))
        expect(mocks.getTonClient).not.toHaveBeenCalled()
        expect(mocks.getBalance).not.toHaveBeenCalled()
        expect(acilanPencereler.length).toBe(1)
    })

    it('stateInit YOK, payload li buyuk tutar (role fonlayabilir) -> pencere acilir', async () => {
        const { acilanPencereler } = kurChrome()
        mocks.getBalance.mockResolvedValue(0n)
        await gonder(istek([{ address: ADRES, amount: '10000000000000', payload: PAYLOAD }]))
        expect(acilanPencereler.length).toBe(1)
    })

    it('stateInit YOK, payload SIZ buyuk tutar -> kod 1, pencere acilmaz', async () => {
        const { acilanPencereler } = kurChrome()
        mocks.getBalance.mockResolvedValue(1n * TON)
        const yanitlar = await gonder(istek([{ address: ADRES, amount: '10000000000000' }]))
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].result).toEqual({ error: { code: 1, message: ESIK_MESAJI }, id: '1' })
    })

    it('coklu mesaj: tutarlar toplanir (3 x 400 TON, bakiye 1 TON) -> kod 1', async () => {
        kurChrome()
        mocks.getBalance.mockResolvedValue(1n * TON)
        const m = { address: ADRES, amount: String(400n * TON) }
        const yanitlar = await gonder(istek([m, m, m]))
        expect(yanitlar[0].result.error.code).toBe(1)
    })

    it('onceki kapilar korunur: yabanci from adresi okumadan ONCE reddedilir (bakiye okunmaz)', async () => {
        kurChrome()
        mocks.getBalance.mockResolvedValue(1n * TON)
        const yanitlar = await gonder({ params: [{ method: 'sendTransaction', params: [JSON.stringify({
            valid_until: Math.floor(Date.now() / 1000) + 300,
            from: '0:2222222222222222222222222222222222222222222222222222222222222222',
            messages: [D4],
        })], id: '1' }] })
        expect(yanitlar[0].result.error.code).toBe(1)
        expect(mocks.getBalance).not.toHaveBeenCalled()
    })

    it('sifir esik (payload siz 1 nanoton degil, yalniz payload li mesaj) -> okuma yapilmaz', async () => {
        const { acilanPencereler } = kurChrome()
        await gonder(istek([{ address: ADRES, amount: '1', payload: PAYLOAD }]))
        expect(mocks.getBalance).not.toHaveBeenCalled()
        expect(acilanPencereler.length).toBe(1)
    })
})

describe('sendTransaction: bakiye onbellegi (adres basina 5 sn)', () => {
    it('5 sn icinde ikinci istek okuma yapmaz, 5 sn sonra yeniden okur', async () => {
        vi.useFakeTimers()
        kurChrome()
        mocks.getBalance.mockResolvedValue(1n * TON)
        const bekle = async (req) => { const p = gonder(req); await vi.advanceTimersByTimeAsync(10); return p }

        await bekle(istek([D4], '1'))
        expect(mocks.getBalance).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(4000)
        const ikinci = await bekle(istek([D4], '2'))
        expect(mocks.getBalance).toHaveBeenCalledTimes(1)
        expect(ikinci[0].result.error.code).toBe(1)

        await vi.advanceTimersByTimeAsync(2000)
        await bekle(istek([D4], '3'))
        expect(mocks.getBalance).toHaveBeenCalledTimes(2)
    })

    it('onbellek yalniz BASARILI okumalari tutar: hata sonrasi ikinci istek yeniden okur', async () => {
        vi.useFakeTimers()
        const { acilanPencereler } = kurChrome()
        mocks.getBalance.mockRejectedValueOnce(new Error('rpc down')).mockResolvedValue(1n * TON)
        const bekle = async (req) => { const p = gonder(req); await vi.advanceTimersByTimeAsync(10); return p }

        await bekle(istek([D4], '1'))
        expect(acilanPencereler.length).toBe(1)
        const ikinci = await bekle(istek([D4], '2'))
        expect(mocks.getBalance).toHaveBeenCalledTimes(2)
        expect(ikinci[0].result.error.code).toBe(1)
    })
})
