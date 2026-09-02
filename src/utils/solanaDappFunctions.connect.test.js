import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ORIGIN = 'https://app.jup.ag'
// Gonderen origin ile sayfanin IDDIA ETTIGI ad KASITLI olarak ayrisir (K5):
// appMeta tamamen saldirgan kontrolundedir ve onay ekraninda baskin oge olamaz.
const SENDER = { origin: ORIGIN, url: ORIGIN + '/swap', tab: { id: 9, favIconUrl: ORIGIN + '/f.ico' } }
const ADDR = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const PUB_HEX = 'ee'.repeat(32)
const HD = { key: 'k1', type: 'hd', index: 0, address: '0xabc' }
const IMPORTED = { key: 'k2', type: 'imported', index: 0, address: '0xdef' }
const VAULTS = [{ id: 'v1', type: 'mnemonic', accounts: [HD, IMPORTED] }]
const SESSION = { address: ADDR, publicKey: PUB_HEX, accountKey: 'k1', cluster: 'solana:mainnet', appMeta: null, connectedAt: 1 }

const deriveSolanaAddress = vi.fn()
vi.mock('./solana/derive', () => ({
    deriveSolanaAddress: (...a) => deriveSolanaAddress(...a),
    deriveSolanaKeypair: vi.fn(),
}))
const unlockVault = vi.fn()
vi.mock('./crypto-utils', () => ({ unlockVault: (...a) => unlockVault(...a), decryptSecret: vi.fn() }))

function kurChrome(local = {}, session = {}) {
    const store = { ...local }
    const acilanPencereler = []
    const oturumOkumalari = []
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
            session: {
                get: async (k) => { oturumOkumalari.push(k); return { [k]: session[k] } },
            },
        },
        windows: {
            create: async (opts) => { acilanPencereler.push(opts); return { id: acilanPencereler.length } },
            remove: async () => {}, get: async () => ({}),
            getLastFocused: async () => ({ width: 1200, left: 0, top: 0 }),
            onRemoved: { addListener: () => {} },
        },
        tabs: { query: async () => [], sendMessage: async () => {} },
        runtime: { getURL: (p) => 'chrome-extension://x/' + p },
    }
    return { store, acilanPencereler, oturumOkumalari }
}

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })
afterEach(() => { delete globalThis.chrome })

async function connect(params, kur) {
    const { handleSolanaConnect } = await import('./solanaDappFunctions.js')
    const yanitlar = []
    await handleSolanaConnect({ method: 'solana_connect', params: [params] }, SENDER, (r) => yanitlar.push(r))
    return { yanitlar, ...kur }
}

// Tasarim belgesi 3.3.1 -- SEKIZ SATIRIN HEPSI.
describe('handleSolanaConnect — silent x oturum x kilit dogruluk tablosu', () => {
    it('silent:true + oturum YOK -> pencere ACMADAN 4100', async () => {
        const kur = kurChrome({ active_account: HD, vaults: VAULTS })
        const { yanitlar, acilanPencereler } = await connect({ silent: true }, kur)
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].error.code).toBe(4100)
    })

    it('silent:true + oturum VAR + KILITLI -> adres kilit ACILMADAN doner', async () => {
        const kur = kurChrome({ active_account: HD, vaults: VAULTS, solana_dapps: { [ORIGIN]: SESSION } }, {})
        const { yanitlar, acilanPencereler, oturumOkumalari } = await connect({ silent: true }, kur)
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].result.address).toBe(ADDR)
        expect(yanitlar[0].result.accountKey).toBe('k1')
        // 7.4: kilidi acma sayfadan TETIKLENEMEZ. Oturum deposuna hic dokunulmamali;
        // dokunulsaydi bu yol bir gun kasa acmaya genisletilebilirdi.
        expect(oturumOkumalari).toEqual([])
        expect(unlockVault).not.toHaveBeenCalled()
    })

    it('silent:true + oturum VAR + ACIK -> adres aninda doner', async () => {
        const kur = kurChrome({ active_account: HD, vaults: VAULTS, solana_dapps: { [ORIGIN]: SESSION } }, { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } })
        const { yanitlar, acilanPencereler } = await connect({ silent: true }, kur)
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].result.address).toBe(ADDR)
    })

    it('silent:false + oturum VAR + ACIK -> pencere ACMADAN aninda doner', async () => {
        const kur = kurChrome({ active_account: HD, vaults: VAULTS, solana_dapps: { [ORIGIN]: SESSION } }, { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } })
        const { yanitlar, acilanPencereler } = await connect({}, kur)
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].result.address).toBe(ADDR)
    })

    it('silent:false + oturum VAR + KILITLI -> adres kilit acilmadan doner (adres GENELDIR)', async () => {
        const kur = kurChrome({ active_account: HD, vaults: VAULTS, solana_dapps: { [ORIGIN]: SESSION } }, {})
        const { yanitlar, acilanPencereler, oturumOkumalari } = await connect({}, kur)
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].result.address).toBe(ADDR)
        expect(oturumOkumalari).toEqual([])
    })

    it('silent:false + oturum YOK + ACIK -> onay penceresi', async () => {
        const kur = kurChrome({ active_account: HD, vaults: VAULTS }, { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } })
        const { yanitlar, acilanPencereler, store } = await connect({}, kur)
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.type).toBe('SOLANA_CONNECT')
        expect(store.current_request.origin).toBe(ORIGIN)
        expect(store.current_request.accountKey).toBe('k1')
        // Kullanici onaylayana kadar promise ASKIDA.
        expect(yanitlar.length).toBe(0)
    })

    it('silent:false + oturum YOK + KILITLI -> TEK birlesik pencere (iki ayri degil)', async () => {
        const kur = kurChrome({ active_account: HD, vaults: VAULTS }, {})
        const { acilanPencereler, store } = await connect({}, kur)
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.type).toBe('SOLANA_CONNECT')
    })

    it('oturum VAR ama hesap desteklemiyor -> pencere ACMADAN SOLANA_ACCOUNT_UNSUPPORTED', async () => {
        const kur = kurChrome({
            active_account: HD, vaults: VAULTS,
            solana_dapps: { [ORIGIN]: { ...SESSION, accountKey: 'k2' } },
        })
        const { yanitlar, acilanPencereler } = await connect({}, kur)
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].error.data.code).toBe('SOLANA_ACCOUNT_UNSUPPORTED')
    })
})

describe('handleSolanaConnect — kapilar ve yuk', () => {
    it('oturum YOK + aktif hesap desteklemiyor -> pencere ACILMADAN reddedilir', async () => {
        const kur = kurChrome({ active_account: IMPORTED, vaults: VAULTS })
        const { yanitlar, acilanPencereler } = await connect({}, kur)
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].error.data.code).toBe('SOLANA_ACCOUNT_UNSUPPORTED')
    })

    // Anahtar TAM ORIGIN: sema ve port dahil (K5). hostname yeterli olsaydi
    // http://app.jup.ag ve o host'un her portu AYNI yetkiyi paylasirdi.
    it('BASKA bir origin in oturumu bu origin e yetki VERMEZ', async () => {
        const kur = kurChrome({ active_account: HD, vaults: VAULTS, solana_dapps: { 'http://app.jup.ag': SESSION } })
        const { yanitlar, acilanPencereler } = await connect({ silent: true }, kur)
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].error.code).toBe(4100)
    })

    it('publicKey sinira base64 olarak gecer (depoda hex tutulur)', async () => {
        const kur = kurChrome({ active_account: HD, vaults: VAULTS, solana_dapps: { [ORIGIN]: SESSION } })
        const { yanitlar } = await connect({ silent: true }, kur)
        const bayt = Uint8Array.from(atob(yanitlar[0].result.publicKey), (c) => c.charCodeAt(0))
        expect(bayt.length).toBe(32)
        expect(bayt.every((b) => b === 0xee)).toBe(true)
    })

    it('appMeta uzunlugu SINIRLANIR -- ekran DoS u ve tasma engellenir', async () => {
        const kur = kurChrome({ active_account: HD, vaults: VAULTS })
        const { store } = await connect({ appMeta: { name: 'A'.repeat(500), icon: 'B'.repeat(5000) } }, kur)
        expect(store.current_request.appMeta.name.length).toBe(64)
        expect(store.current_request.appMeta.icon.length).toBe(512)
    })
})

describe('handleSolanaConnectIdentity', () => {
    // Yuk NESTED: `{ type, message: { accountKey } }`. Bu deponun ic aksiyon sekli
    // (TonConnectApprove.vue:161-162 -> background.js:2241) ve onay ekrani (Gorev 14)
    // tam olarak bunu yolluyor. Duz `{ accountKey }` ile beslemek testi yesil
    // tutarken gercek eklentiyi kirardi.
    async function kimlik(message, kur) {
        const { handleSolanaConnectIdentity } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaConnectIdentity(message, { url: 'chrome-extension://x/' }, (r) => yanitlar.push(r))
        return { yanitlar, ...kur }
    }

    it('kasayi acar ve adres/publicKey doner', async () => {
        const kur = kurChrome({ vaults: VAULTS, active_account: HD }, { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } })
        globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
        unlockVault.mockResolvedValue('abandon abandon abandon about')
        deriveSolanaAddress.mockResolvedValue({ address: ADDR, publicKey: PUB_HEX })
        const { yanitlar } = await kimlik({ type: 'SOLANA_CONNECT_IDENTITY', message: { accountKey: 'k1' } }, kur)
        expect(yanitlar[0]).toEqual({ success: true, address: ADDR, publicKey: PUB_HEX })
        expect(deriveSolanaAddress).toHaveBeenCalledWith('abandon abandon abandon about', 0)
    })

    it('zaten turetilmis hesapta kasa ACILMAZ', async () => {
        const hazir = { ...HD, solanaAddress: ADDR, solanaPublicKey: PUB_HEX }
        const kur = kurChrome({ vaults: [{ id: 'v1', accounts: [hazir] }] }, { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } })
        const { yanitlar } = await kimlik({ message: { accountKey: 'k1' } }, kur)
        expect(yanitlar[0].address).toBe(ADDR)
        expect(unlockVault).not.toHaveBeenCalled()
    })

    it('desteklenmeyen hesapta SOLANA_ACCOUNT_UNSUPPORTED, kasa acilmaz', async () => {
        const kur = kurChrome({ vaults: VAULTS }, { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } })
        const { yanitlar } = await kimlik({ message: { accountKey: 'k2' } }, kur)
        expect(yanitlar[0]).toEqual({ success: false, error: 'SOLANA_ACCOUNT_UNSUPPORTED' })
        expect(unlockVault).not.toHaveBeenCalled()
    })

    it('kilitliyse WALLET_LOCKED -- anahtar TURETTIGI icin kilit ZORUNLU', async () => {
        const kur = kurChrome({ vaults: VAULTS }, {})
        const { yanitlar } = await kimlik({ message: { accountKey: 'k1' } }, kur)
        expect(yanitlar[0]).toEqual({ success: false, error: 'WALLET_LOCKED' })
    })
})
