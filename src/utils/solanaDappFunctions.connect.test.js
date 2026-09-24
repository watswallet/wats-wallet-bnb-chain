import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ORIGIN = 'https://app.jup.ag'
// Gonderen origin ile sayfanin IDDIA ETTIGI ad KASITLI olarak ayrisir (K5):
// appMeta tamamen saldirgan kontrolundedir ve onay ekraninda baskin oge olamaz.
const SENDER = { origin: ORIGIN, url: ORIGIN + '/swap', frameId: 0, tab: { id: 9, favIconUrl: ORIGIN + '/f.ico' } }
const ADDR = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const PUB_HEX = 'ee'.repeat(32)
const HD = { key: 'k1', type: 'hd', index: 0, address: '0xabc' }
const IMPORTED = { key: 'k2', type: 'imported', index: 0, address: '0xdef' }
const VAULTS = [{ id: 'v1', type: 'hd', accounts: [HD, IMPORTED] }]
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
        // C1.5: `accountKey` sinira ARTIK CIKMAZ -- sayfa dunyasindaki HERHANGI
        // bir betigin okuyabilecegi, capraz-zincir korelasyon icin kullanilabilecek
        // kalici bir tutamac olurdu.
        expect(Object.keys(yanitlar[0].result)).toEqual(['address', 'publicKey'])
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

    // C1.2 -- nihai inceleme, ruling A: bir oturumun accountKey'i AKTIF hesaptan
    // FARKLIYSA (K10 bayatlamasi) o oturum artik "yok" sayilir -- eskiden bu
    // durum, pencere ACILMADAN dogrudan SOLANA_ACCOUNT_UNSUPPORTED donuyordu
    // (dapp'in yeniden baglanmasi icin HICBIR sinyal yoktu). Simdi AKTIF hesap
    // destekliyse pencere O HESAP icin acilir; kayit onaya kadar DOKUNULMAZ
    // (SolanaConnectApprove.vue putSolanaSession onu yeniden yazar).
    it('silent:false + BAYAT oturum (k2) + aktif k1 destekli -> pencere AKTIF hesap icin acilir, kayit onaya kadar dokunulmaz', async () => {
        const kur = kurChrome({
            active_account: HD, vaults: VAULTS,
            solana_dapps: { [ORIGIN]: { ...SESSION, accountKey: 'k2' } },
        })
        const { yanitlar, acilanPencereler, store } = await connect({}, kur)
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.type).toBe('SOLANA_CONNECT')
        expect(store.current_request.accountKey).toBe('k1')
        expect(yanitlar.length).toBe(0)
        expect(store.solana_dapps[ORIGIN].accountKey).toBe('k2')
    })

    it('silent:true + BAYAT oturum -> pencere ACILMADAN 4100', async () => {
        const kur = kurChrome({
            active_account: HD, vaults: VAULTS,
            solana_dapps: { [ORIGIN]: { ...SESSION, accountKey: 'k2' } },
        })
        // F4 (fix turu 1): red durumunda depoya HIC dokunulmadigini da
        // kanitlar -- yalniz yanit kodunu degil.
        const oncesi = structuredClone(kur.store.solana_dapps)
        const { yanitlar, acilanPencereler, store } = await connect({ silent: true }, kur)
        expect(yanitlar[0].error.code).toBe(4100)
        expect(acilanPencereler.length).toBe(0)
        expect(store.solana_dapps).toEqual(oncesi)
        expect(store.current_request).toBeUndefined()
    })

    it('BAYAT oturum + aktif hesap desteklemiyor (IMPORTED) -> pencere ACILMADAN SOLANA_ACCOUNT_UNSUPPORTED', async () => {
        const kur = kurChrome({
            active_account: IMPORTED, vaults: VAULTS,
            solana_dapps: { [ORIGIN]: { ...SESSION, accountKey: 'k1' } },
        })
        const oncesi = structuredClone(kur.store.solana_dapps)
        const { yanitlar, acilanPencereler, store } = await connect({}, kur)
        expect(acilanPencereler.length).toBe(0)
        expect(yanitlar[0].error.data.code).toBe('SOLANA_ACCOUNT_UNSUPPORTED')
        expect(store.solana_dapps).toEqual(oncesi)
        expect(store.current_request).toBeUndefined()
    })

    it('oturumun accountKey i vaults ta artik YOKSA (silinmis hesap) AKTIF hesap icin pencere acilir, eski adres DONMEZ', async () => {
        const kur = kurChrome({
            active_account: HD, vaults: VAULTS,
            solana_dapps: { [ORIGIN]: { ...SESSION, accountKey: 'silinmis-hesap' } },
        })
        const { yanitlar, acilanPencereler, store } = await connect({}, kur)
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.accountKey).toBe('k1')
        expect(yanitlar.length).toBe(0)
    })

    it('active_account YOK + oturum YOK + silent:false -> pencere ACILMADAN 4100', async () => {
        const kur = kurChrome({ active_account: undefined, vaults: VAULTS })
        const { yanitlar, acilanPencereler } = await connect({}, kur)
        expect(yanitlar[0].error.code).toBe(4100)
        expect(acilanPencereler.length).toBe(0)
    })
})

describe('handleSolanaConnect -- gonderen kapisi (C1.3)', () => {
    async function connectWithSender(sender) {
        const { handleSolanaConnect } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaConnect({ method: 'solana_connect', params: [{}] }, sender, (r) => yanitlar.push(r))
        return yanitlar
    }

    it.each([
        ['ust cerceve DEGIL (frameId 3)', { ...SENDER, frameId: 3 }],
        ['sender.tab YOK', { ...SENDER, tab: undefined }],
        ['http yabanci host (localhost/127.0.0.1 DEGIL)', { ...SENDER, frameId: 0, origin: 'http://app.jup.ag', url: 'http://app.jup.ag/x' }],
        ["origin 'null' (sandbox'li cerceve)", { ...SENDER, origin: 'null' }],
        ['file:// semasi', { ...SENDER, origin: 'file:///C:/x.html' }],
    ])('%s -> pencere ACILMADAN 4100, kayit DEGISMEZ', async (_ad, gonderen) => {
        const kur = kurChrome({ active_account: HD, vaults: VAULTS, solana_dapps: { [ORIGIN]: SESSION } })
        const oncesi = structuredClone(kur.store.solana_dapps)
        const yanitlar = await connectWithSender(gonderen)
        expect(yanitlar[0].error).toEqual({ code: 4100, message: 'Unauthorized.' })
        expect(kur.acilanPencereler.length).toBe(0)
        expect(kur.store.solana_dapps).toEqual(oncesi)
    })

    it.each([
        ['http://localhost', { origin: 'http://localhost:3000', url: 'http://localhost:3000/x', frameId: 0, tab: { id: 9 } }],
        ['http://127.0.0.1', { origin: 'http://127.0.0.1:8080', url: 'http://127.0.0.1:8080/x', frameId: 0, tab: { id: 9 } }],
    ])('%s -> kapi GECER, oturum yokken pencere acilir', async (_ad, gonderen) => {
        const kur = kurChrome({ active_account: HD, vaults: VAULTS })
        const yanitlar = await connectWithSender(gonderen)
        expect(kur.acilanPencereler.length).toBe(1)
        expect(kur.store.current_request.origin).toBe(new URL(gonderen.origin).origin)
        expect(yanitlar.length).toBe(0)
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

// C5.3 -- nihai inceleme: hicbir test handleSolanaConnect'i catch dalina
// SURMUYORDU. `console.error`e ULASAN bir `e.message` yakalamayip dogrudan
// sendResponse'a KOYAN bir regresyon (anahtar-materyali sinifi bir hata
// dahil) bu bosluktan SESSIZCE gecerdi.
describe('handleSolanaConnect -- catch dali', () => {
    it('chrome.storage.local.get FIRLATIRSA jenerik Internal error doner, SIFIR pencere, ham mesaj SIZMAZ', async () => {
        const kur = kurChrome({ active_account: HD, vaults: VAULTS })
        globalThis.chrome.storage.local.get = async () => { throw new Error('secret-ish text') }
        const { yanitlar, acilanPencereler } = await connect({}, kur)
        expect(yanitlar[0]).toEqual({ error: { code: -32603, message: 'Internal error' } })
        expect(acilanPencereler.length).toBe(0)
        expect(JSON.stringify(yanitlar[0])).not.toContain('secret-ish')
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
