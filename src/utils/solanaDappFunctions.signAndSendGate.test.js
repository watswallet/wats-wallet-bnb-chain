// GENEL KISIT: @solana/web3.js'i DOGRUDAN iceren her dosyanin (kaynak VE test)
// ILK import'u bufferGlobal olmak zorunda -- Gorev 26 bunu test dosyasindan
// eksik biraktigi icin bir inceleme turu kaybetti. Bu dosya GERCEK islemler
// kurup serilestirdigi icin @solana/web3.js'e DOGRUDAN girer.
import './solana/bufferGlobal.js'

// signAndSendTransaction KAPILARI -- hepsi PENCERE ACILMADAN once (§4.3.1).
//
// Olculen sey iki tanedir ve ikincisi daha onemlidir:
//   1) dogru hata kodu doner,
//   2) HICBIR onay penceresi ACILMAZ. Bir kapi pencereden SONRA calisirsa
//      kullaniciya imzalayamayacagi bir sey onaylatilir ve dapp'in promise'i
//      (pencere kapaninca 4001 gelene kadar) asili kalir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import { MAX_TX_BASE64_LENGTH } from './solana/walletStandardFeatures'

const ORIGIN = 'https://app.example.com'
const FROM = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const ALICI = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const ORTAK = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const BLOCKHASH = 'GfVcyD4kkTrj4bKc7WA9sZCin9JDbdT4Zkd3EittNR1W'
const SENDER = { origin: ORIGIN, frameId: 0, tab: { favIconUrl: ORIGIN + '/favicon.ico' } }

let localStore
let handleSolanaSignAndSend

function txBase64({ cosigner = null } = {}) {
    const tx = new Transaction()
    tx.feePayer = new PublicKey(FROM)
    tx.recentBlockhash = BLOCKHASH
    tx.add(SystemProgram.transfer({ fromPubkey: new PublicKey(FROM), toPubkey: new PublicKey(ALICI), lamports: 1000 }))
    // Ikinci bir ZORUNLU imzaci: bizim disimizda, imzasiz.
    if (cosigner) {
        tx.add(SystemProgram.transfer({ fromPubkey: new PublicKey(cosigner), toPubkey: new PublicKey(FROM), lamports: 1 }))
    }
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
}

// compact-u16 (shortvec) yazici -- parseDappTransaction.js'in okuyucusunun
// (readShortVec) TERSI. solanaDappFunctions.signTx.test.js'teki asiriBuyukTx
// ile AYNI teknik (Task 29 review Bulgu 1).
function shortvecEncode(n) {
    const out = []
    let value = n
    for (;;) {
        let byte = value & 0x7f
        value >>>= 7
        if (value !== 0) byte |= 0x80
        out.push(byte)
        if (value === 0) break
    }
    return out
}

// EK -- boyut kapisi testi icin. GECERLI, COZULEBILIR ama MAX_TX_BASE64_LENGTH'i
// asan bir islem: tek imzaci FROM, ortak imzaci YOK. Boyut kapisi olmasaydi bu
// islem parseDappTransaction'i, kapi 7'yi VE kapi 8'i GECIP pencere ACARDI --
// test bu yuzden yalniz boyut kapisini tetikler. Tel sekli ELLE kuruluyor:
// [1 imza][baslik][2 hesap anahtari][blockhash][1 talimat, verisi 2000 bayt].
function asiriBuyukTx() {
    const payerBytes = new PublicKey(FROM).toBytes()
    const programBytes = SystemProgram.programId.toBytes()
    const veri = new Array(2000).fill(1)
    const bytes = [
        1, // imza sayisi (shortvec, 1 imzaci)
        ...new Array(64).fill(0), // imzasiz yuva (parseDappTransaction eksik imzayi missingCosigners'a yazar, throw etmez)
        1, 0, 1, // numRequiredSignatures=1, numReadonlySigned=0, numReadonlyUnsigned=1
        2, // hesap anahtari sayisi (shortvec)
        ...payerBytes, // hesap 0: odeyen/imzaci (FROM)
        ...programBytes, // hesap 1: program kimligi
        ...new Array(32).fill(0), // blockhash (32 sifir bayt, gecerlilik burada onemsiz)
        1, // talimat sayisi (shortvec)
        1, // programIdIndex -> hesap 1
        1, 0, // talimatin hesap sayisi (shortvec) + hesap 0 (odeyen)
        ...shortvecEncode(veri.length),
        ...veri,
    ]
    return Buffer.from(Uint8Array.from(bytes)).toString('base64')
}

// EK -- Task 29'daki surumBozukTx ile AYNI teknik: surum bayti 0x81 (legacy/v0
// DISI) olacak sekilde ELLE PATCHLENMIS, aksi halde TAMAMEN gecerli tek-imzali
// bir islem. Tel sekli: [1 baytlik shortvec imza sayisi=1][64 baytlik imza
// yuvasi][mesaj] -- mesaj bu yuzden 65. bayttan basliyor. txBase64()'un
// urettigi islem TEK zorunlu imzaci (FROM) tasidigi icin offset Task 29'unkiyle
// AYNI (1 + 1*64).
function surumBozukTx() {
    const bytes = Buffer.from(txBase64(), 'base64')
    bytes[1 + 1 * 64] = 0x81
    return bytes.toString('base64')
}

function installChromeStub() {
    globalThis.chrome = {
        runtime: { getURL: (p) => 'chrome-extension://wats/' + p, onMessage: { addListener: () => {} }, lastError: null },
        storage: {
            local: {
                get: vi.fn(async (keys) => {
                    const wanted = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(wanted.map((k) => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async (k) => { delete localStore[k] }),
            },
            session: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) },
        },
        windows: {
            create: vi.fn(async () => ({ id: 7 })),
            getLastFocused: vi.fn(async () => ({ id: 1, left: 0, top: 0, width: 1000 })),
            remove: vi.fn(async () => {}),
            get: vi.fn(async () => ({ id: 7 })),
            onRemoved: { addListener: () => {} },
        },
        tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => {}) },
    }
}

// Isleyici SENKRON doner (sozlesme); asenkron is bir makro-gorev turunda biter.
const bekle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    localStore = {
        solana_dapps: {
            [ORIGIN]: {
                address: FROM, publicKey: 'ee'.repeat(32), accountKey: 'k1',
                cluster: 'solana:mainnet', appMeta: { name: 'Example' }, connectedAt: 1,
            },
        },
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', type: 'hd', index: 0 }] }],
        active_account: { key: 'k1', type: 'hd', index: 0 },
    }
    installChromeStub()
    const mod = await import('./solanaDappFunctions.js')
    handleSolanaSignAndSend = mod.handleSolanaSignAndSend
})

afterEach(() => { delete globalThis.chrome })

async function cagir(params, sender = SENDER) {
    const sendResponse = vi.fn()
    handleSolanaSignAndSend({ method: 'solana_signAndSendTransaction', params: [params] }, sender, sendResponse)
    await bekle()
    return sendResponse
}

describe('handleSolanaSignAndSend -- kapilar (hepsi pencereden ONCE)', () => {
    it('oturumu olmayan origin 4100 alir ve PENCERE ACILMAZ', async () => {
        const sendResponse = await cagir({ transaction: txBase64(), chain: 'solana:mainnet' },
            { origin: 'https://kotu.example', frameId: 0, tab: {} })

        expect(sendResponse.mock.calls[0][0].error.code).toBe(4100)
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    // K5: yetki TAM ORIGIN'dir. Ayni host'un http'si BASKA bir origin'dir.
    it('ayni host un http su AYRI origin dir -- 4100', async () => {
        const sendResponse = await cagir({ transaction: txBase64(), chain: 'solana:mainnet' },
            { origin: 'http://app.example.com', frameId: 0, tab: {} })

        expect(sendResponse.mock.calls[0][0].error.code).toBe(4100)
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    // EK -- Task 38 inceleme yukumlulugu 3 (kapi sirasi): K10 pini, session
    // gatesinin hemen ardindan, hesap destegi kapisindan ONCE calisir.
    // handleSolanaSignTransaction'daki (Task 29) AYNI kural: oturum
    // accountKey'e SABITLENIR, kullanici cuzdanda BASKA bir hesaba gectiyse
    // eski oturum imza istegi icin GECERSIZDIR.
    it('EK: aktif hesap oturumdan FARKLI accountKey ise 4100, PENCERE YOK (K10 pini)', async () => {
        localStore.active_account = { key: 'k2', type: 'hd', index: 1 }
        const sendResponse = await cagir({ transaction: txBase64(), chain: 'solana:mainnet' })

        expect(sendResponse.mock.calls[0][0].error.code).toBe(4100)
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('mainnet disi cluster SOLANA_WRONG_CLUSTER ile reddedilir', async () => {
        const sendResponse = await cagir({ transaction: txBase64(), chain: 'solana:devnet' })

        expect(sendResponse.mock.calls[0][0].error.data.code).toBe('SOLANA_WRONG_CLUSTER')
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('chain alani YOKSA mainnet varsayilir ve istek gecer', async () => {
        await cagir({ transaction: txBase64() })
        expect(chrome.windows.create).toHaveBeenCalledOnce()
        expect(localStore.current_request.chain).toBe('solana:mainnet')
    })

    it('cozulemeyen yuk TX_DESERIALIZE_FAILED ile reddedilir', async () => {
        const sendResponse = await cagir({ transaction: 'bu-base64-degil!!', chain: 'solana:mainnet' })

        expect(sendResponse.mock.calls[0][0].error.data.code).toBe('TX_DESERIALIZE_FAILED')
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    // EK -- Task 38 inceleme yukumlulugu 3 (boyut kapisi): parse'tan ONCE
    // calisir. Girdi BIZIM gecerli imzamizla kurulu (asiriBuyukTx): boyut
    // kapisi olmasaydi bu islem parseDappTransaction'i, kapi 7'yi VE kapi 8'i
    // GECIP pencere ACARDI -- test bu yuzden yalniz boyut kapisini tetikler.
    it('EK: MAX_TX_BASE64_LENGTH asilinca TX_DESERIALIZE_FAILED, PENCERE YOK', async () => {
        const buyuk = asiriBuyukTx()
        expect(buyuk.length).toBeGreaterThan(MAX_TX_BASE64_LENGTH)
        const sendResponse = await cagir({ transaction: buyuk, chain: 'solana:mainnet' })

        expect(sendResponse.mock.calls[0][0].error.data.code).toBe('TX_DESERIALIZE_FAILED')
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    // EK -- Task 38 inceleme yukumlulugu 1: parse basarisiz olunca isleyici
    // BURADA durmali, `parsed` tanimsizken kapi 7/8'e DUSMEMELI. Duserse gate 7
    // (`parsed.requiredSigners`) `parsed` undefined oldugu icin FIRLATIR ve
    // disaridaki genel catch IKINCI bir sendResponse cagirir -- ilk cagri hala
    // dogru kodu tasidigi icin `mock.calls[0]`e bakan ustteki test bunu
    // YAKALAYAMAZ; `toHaveBeenCalledTimes(1)` yakalar.
    it('EK: parse basarisiz olunca sendResponse TAM BIR KEZ cagrilir (fall-through YOK)', async () => {
        const sendResponse = await cagir({ transaction: 'bu-base64-degil!!', chain: 'solana:mainnet' })

        expect(sendResponse).toHaveBeenCalledTimes(1)
        expect(sendResponse.mock.calls[0][0].error.data.code).toBe('TX_DESERIALIZE_FAILED')
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    // EK (Task 38 fix turu, Minor 2) -- `e?.message === 'UNSUPPORTED_TX_VERSION'`
    // dalinin kendi dedike testi yoktu: satiri `'TX_DESERIALIZE_FAILED'`e
    // mutasyonlayan bir degisiklik yakalanamazdi. Task 29'un surumBozukTx
    // deseniyle AYNI: surum bayti 0x81 (legacy/v0 DISI) olacak sekilde elle
    // patchlenmis, aksi halde tamamen gecerli tek-imzali bir islem.
    it('EK: desteklenmeyen surum (0x81) UNSUPPORTED_TX_VERSION doner, PENCERE YOK', async () => {
        const sendResponse = await cagir({ transaction: surumBozukTx(), chain: 'solana:mainnet' })

        expect(sendResponse.mock.calls[0][0].error.data.code).toBe('UNSUPPORTED_TX_VERSION')
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it('imzaci olmadigimiz islem SOLANA_NOT_A_SIGNER ile reddedilir', async () => {
        // Oturum adresi islemde HIC gecmiyor: fee payer baska biri.
        localStore.solana_dapps[ORIGIN].address = ALICI
        const sendResponse = await cagir({ transaction: txBase64(), chain: 'solana:mainnet' })

        expect(sendResponse.mock.calls[0][0].error.data.code).toBe('SOLANA_NOT_A_SIGNER')
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    // §4.3.1 KAPI 8 -- bu turun asil kapisi. Yayini BIZ yaptigimiz icin islem
    // TAM IMZALI olmak zorunda; eksik ortak imzaci onaydan SONRA fark edilirse
    // kullanici onayladigi seyin yayinlanamadigini gorur.
    it('bizim disimizda imzasiz zorunlu imzaci SOLANA_MISSING_COSIGNER, PENCERE YOK', async () => {
        const sendResponse = await cagir({ transaction: txBase64({ cosigner: ORTAK }), chain: 'solana:mainnet' })

        expect(sendResponse.mock.calls[0][0].error.data.code).toBe('SOLANA_MISSING_COSIGNER')
        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(localStore.current_request).toBeUndefined()
    })

    it('ed25519 uretemeyen hesapta SOLANA_ACCOUNT_UNSUPPORTED, PENCERE YOK', async () => {
        localStore.vaults = [{ id: 'v1', accounts: [{ key: 'k1', type: 'imported' }] }]
        const sendResponse = await cagir({ transaction: txBase64(), chain: 'solana:mainnet' })

        expect(sendResponse.mock.calls[0][0].error.data.code).toBe('SOLANA_ACCOUNT_UNSUPPORTED')
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    // EK -- tip karisikligi, fail-closed: hesap vaults'ta HIC bulunamazsa (orn.
    // bozuk/eksik depo durumu) destek BILINEMEZ, "destekleniyor" VARSAYILMAZ.
    it('EK: hesap vaults ta bulunamazsa SOLANA_ACCOUNT_UNSUPPORTED (fail-closed), PENCERE YOK', async () => {
        localStore.vaults = []
        const sendResponse = await cagir({ transaction: txBase64(), chain: 'solana:mainnet' })

        expect(sendResponse.mock.calls[0][0].error.data.code).toBe('SOLANA_ACCOUNT_UNSUPPORTED')
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })
})

describe('handleSolanaSignAndSend -- onay kaydi', () => {
    it('current_request signAndSend modunda ve GERCEK origin ile yazilir', async () => {
        const b64 = txBase64()
        const sendResponse = await cagir({ transaction: b64, chain: 'solana:mainnet' })

        expect(chrome.windows.create).toHaveBeenCalledOnce()
        // Basari yolunda yanit ONAY EKRANINDAN gelir; kapi yanit vermez.
        expect(sendResponse).not.toHaveBeenCalled()

        const kayit = localStore.current_request
        expect(kayit.type).toBe('SOLANA_SIGN_TX')
        // Ekran ile arka plan `mode` uzerinden anlasir (§4.5): yayini kimin
        // yapacagi buradan okunur.
        expect(kayit.mode).toBe('signAndSend')
        expect(kayit.origin).toBe(ORIGIN)
        expect(kayit.from).toBe(FROM)
        expect(kayit.accountKey).toBe('k1')
        expect(kayit.transactions).toEqual([b64])
        expect(kayit.isDurableNonce).toBe(false)
    })

    // EK -- handleSolanaDappSignTx (Task 30) onay dugmesinde
    // `current_request.requestId !== requestId` kilidiyle icerik baglar; bu
    // alan eksik kalirsa HER signAndSend onayi fail-closed reddedilirdi.
    it('EK: current_request requestId TASIR (onay ekraninin icerik kilidi buna dayanir)', async () => {
        await cagir({ transaction: txBase64(), chain: 'solana:mainnet' })
        const kayit = localStore.current_request
        expect(typeof kayit.requestId).toBe('string')
        expect(kayit.requestId.length).toBeGreaterThan(0)
        expect(kayit.id).toBe(kayit.requestId)
    })

    // Dapp'in HAM opsiyonlari DISKE HIC yazilmaz: kayittaki deger zaten
    // temizlenmis olandir, yayin yolu onu oldugu gibi kullanir.
    it('dapp options u SANITIZE EDILMIS olarak saklanir', async () => {
        await cagir({
            transaction: txBase64(), chain: 'solana:mainnet',
            options: { skipPreflight: true, preflightCommitment: 'processed', maxRetries: 999, minContextSlot: 42 },
        })

        expect(localStore.current_request.options).toEqual({
            encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3,
        })
    })
})

// C5.3 -- nihai inceleme: hicbir test gateSolanaSignAndSend'i catch dalina
// SURMUYORDU. KAYNAKTAN dogrulandi: handleSolanaSignTransaction ile AYNI --
// jenerik `{ error: { code: -32603, message: 'Internal error' } }` doner
// (handleSolanaSignMessage/handleSolanaSignIn'in AKSINE `uygulamaHatasi`
// KULLANMAZ).
describe('handleSolanaSignAndSend -- catch dali', () => {
    it('chrome.storage.local.get FIRLATIRSA jenerik Internal error doner, SIFIR pencere, ham mesaj SIZMAZ', async () => {
        chrome.storage.local.get = vi.fn(async () => { throw new Error('secret-ish text') })
        const sendResponse = await cagir({ transaction: txBase64(), chain: 'solana:mainnet' })

        expect(sendResponse).toHaveBeenCalledWith({ error: { code: -32603, message: 'Internal error' } })
        expect(chrome.windows.create).not.toHaveBeenCalled()
        expect(JSON.stringify(sendResponse.mock.calls[0][0])).not.toContain('secret-ish')
    })
})

describe('handleSolanaSignAndSend -- gonderen kapisi (C1.3)', () => {
    it.each([
        ['ust cerceve DEGIL (frameId 3)', { ...SENDER, frameId: 3 }],
        ['sender.tab YOK', { ...SENDER, tab: undefined }],
        ['http yabanci host (localhost/127.0.0.1 DEGIL)', { ...SENDER, frameId: 0, origin: 'http://app.jup.ag' }],
        ["origin 'null' (sandbox'li cerceve)", { ...SENDER, origin: 'null' }],
        ['file:// semasi', { ...SENDER, origin: 'file:///C:/x.html' }],
    ])('%s -> 4100, PENCERE ACILMAZ', async (_ad, gonderen) => {
        const sendResponse = await cagir({ transaction: txBase64(), chain: 'solana:mainnet' }, gonderen)
        expect(sendResponse.mock.calls[0][0].error).toEqual({ code: 4100, message: 'Unauthorized.' })
        expect(chrome.windows.create).not.toHaveBeenCalled()
    })

    it.each([
        ['http://localhost', { origin: 'http://localhost:3000', frameId: 0, tab: {} }],
        ['http://127.0.0.1', { origin: 'http://127.0.0.1:8080', frameId: 0, tab: {} }],
    ])('%s -> kapi GECER, o origin e verilmis oturumla pencere acilir', async (_ad, gonderen) => {
        localStore.solana_dapps = {
            [gonderen.origin]: {
                address: FROM, publicKey: 'ee'.repeat(32), accountKey: 'k1',
                cluster: 'solana:mainnet', appMeta: { name: 'Example' }, connectedAt: 1,
            },
        }
        await cagir({ transaction: txBase64(), chain: 'solana:mainnet' }, gonderen)
        expect(chrome.windows.create).toHaveBeenCalledOnce()
        expect(localStore.current_request.origin).toBe(gonderen.origin)
    })
})
