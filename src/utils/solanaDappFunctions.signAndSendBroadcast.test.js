// GENEL KISIT: @solana/web3.js'i DOGRUDAN iceren her dosyanin (kaynak VE test)
// ILK import'u bufferGlobal olmak zorunda -- Gorev 26 bunu test dosyasindan
// eksik biraktigi icin bir inceleme turu kaybetti. Bu dosya GERCEK islemler
// kurup serilestirdigi icin @solana/web3.js'e DOGRUDAN girer.
import './solana/bufferGlobal.js'

// Onay SONRASI yol: imzala -> tazelik -> yayinla. Uc kural burada kilitlenir:
//   §6.5 blockhash tazeligi (durable nonce muafiyeti + FAIL-OPEN),
//   §6.1 imzalayici kilidi (turetilen adres = onaylanan from = oturum adresi),
//   §6.4 cift gonderim disiplini (imza YAYINDAN ONCE, belirsiz dususte hata
//        DEGIL imza donulur).
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
// BAGIMSIZ base58: uretim kodu kendi base58.js'ini kullaniyor; ayni uygulamayi
// beklenti tarafinda da kullanmak testi totolojiye cevirirdi.
import bs58 from 'bs58'

const ORIGIN = 'https://app.example.com'
const ALICI = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const NONCE_HESABI = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const BLOCKHASH = 'GfVcyD4kkTrj4bKc7WA9sZCin9JDbdT4Zkd3EittNR1W'
const TEST_MNEMONIC = 'abandon abandon abandon about'

let testKeypair
let DERIVED

// Turetme DOSYA BASINA BIR KEZ (PBKDF2 2048 tur). Mock GERCEK derive.js'in
// urettigi keypair'i dondurur: mock ile production "keypair nedir" konusunda
// ayrisamaz.
let realOwnSignatureBytes

beforeAll(async () => {
    const actual = await vi.importActual('./solana/derive')
    testKeypair = await actual.deriveSolanaKeypair(TEST_MNEMONIC, 0)
    DERIVED = testKeypair.publicKey.toBase58()
    realOwnSignatureBytes = (await vi.importActual('./solana/signAndSendPolicy')).ownSignatureBytes
})

const deriveSolanaKeypair = vi.fn()
vi.mock('./solana/derive', () => ({
    deriveSolanaKeypair: (...a) => deriveSolanaKeypair(...a),
    deriveSolanaAddress: vi.fn(),
}))

const unlockVault = vi.fn()
vi.mock('./crypto-utils', () => ({ unlockVault: (...a) => unlockVault(...a), decryptSecret: vi.fn() }))

const broadcastSignedTransaction = vi.fn()
vi.mock('./solana/send', () => ({
    broadcastSignedTransaction: (...a) => broadcastSignedTransaction(...a),
    prepareTransferContext: vi.fn(),
}))

const solanaRpc = vi.fn()
vi.mock('./solana/client', () => ({ solanaRpc: (...a) => solanaRpc(...a), SOLANA_API_BASE: 'https://api.test' }))

// foreignMissingCosigners/sanitizeSendOptions GERCEK kalir (bu testlerde
// yabanci ortak imzaci yok, davranislari degismez); ownSignatureBytes ise
// TEK bir testte (asagida) null'a zorlanabilsin diye SARILIR -- brief'in
// verdigi paket bu dali (obligation 4: null donunce YAYIN YAPILMAZ) hic
// test etmiyordu, o kontrolun testten DUSEBILECEGINI (silinebilecegini)
// kanitsiz birakiyordu.
const ownSignatureBytes = vi.fn()
vi.mock('./solana/signAndSendPolicy', async () => {
    const actual = await vi.importActual('./solana/signAndSendPolicy')
    return { ...actual, ownSignatureBytes: (...a) => ownSignatureBytes(...a) }
})

let localStore
let sessionStore
let handleSolanaDappSignTx

function txBase64({ durableNonce = false } = {}) {
    const tx = new Transaction()
    tx.feePayer = new PublicKey(DERIVED)
    tx.recentBlockhash = BLOCKHASH
    if (durableNonce) {
        tx.add(SystemProgram.nonceAdvance({
            noncePubkey: new PublicKey(NONCE_HESABI), authorizedPubkey: new PublicKey(DERIVED),
        }))
    }
    tx.add(SystemProgram.transfer({ fromPubkey: new PublicKey(DERIVED), toPubkey: new PublicKey(ALICI), lamports: 1000 }))
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
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
            session: { get: vi.fn(async () => sessionStore), set: vi.fn(async () => {}) },
        },
        windows: { create: vi.fn(), getLastFocused: vi.fn(), remove: vi.fn(), get: vi.fn(), onRemoved: { addListener: () => {} } },
        tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => {}) },
    }
}

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})

    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        current_request: {
            type: 'SOLANA_SIGN_TX', id: 'req-1', requestId: 'req-1', origin: ORIGIN, appMeta: { name: 'Example' },
            accountKey: 'k1', from: DERIVED, mode: 'signAndSend',
            transactions: [txBase64()], chain: 'solana:mainnet', isDurableNonce: false,
            options: { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 1 },
        },
        solana_dapps: {
            [ORIGIN]: { address: DERIVED, publicKey: 'ee'.repeat(32), accountKey: 'k1', cluster: 'solana:mainnet', connectedAt: 1 },
        },
        vaults: [{ id: 'v1', type: 'hd', accounts: [{ key: 'k1', type: 'hd', index: 0 }] }],
        active_account: { key: 'k1', type: 'hd', index: 0 },
    }

    installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    unlockVault.mockResolvedValue(TEST_MNEMONIC)
    deriveSolanaKeypair.mockResolvedValue(testKeypair)
    solanaRpc.mockResolvedValue({ value: true })
    broadcastSignedTransaction.mockResolvedValue('SIG_FROM_RPC')
    // Varsayilan: GERCEK uygulama. Yalniz asagidaki tek testte bir kerelik
    // null'a zorlanir (mockReturnValueOnce).
    ownSignatureBytes.mockImplementation((...a) => realOwnSignatureBytes(...a))

    const mod = await import('./solanaDappFunctions.js')
    handleSolanaDappSignTx = mod.handleSolanaDappSignTx
})

afterEach(() => { delete globalThis.chrome })

function cagir(extra = {}) {
    return new Promise((resolve) => {
        handleSolanaDappSignTx(
            { type: 'SOLANA_DAPP_SIGN_TX', requestId: 'req-1', mode: 'signAndSend', ...extra },
            { url: 'chrome-extension://wats/src/popup/index.html' },
            resolve,
        )
    })
}

describe('SOLANA_DAPP_SIGN_TX -- signAndSend', () => {
    it('islem TAM IMZALI yayinlanir ve imza YEREL olarak uretilir', async () => {
        const res = await cagir()

        expect(broadcastSignedTransaction).toHaveBeenCalledOnce()
        const [base64, options] = broadcastSignedTransaction.mock.calls[0]
        const tx = Transaction.from(Buffer.from(base64, 'base64'))
        expect(tx.feePayer.toBase58()).toBe(DERIVED)
        // Imza GERCEK ve YAYINLANAN islemin KENDI imzasi -- RPC'nin donus
        // degerinden ogrenilmedi (§6.4).
        expect(res.result.signature).toBe(bs58.encode(tx.signature))
        expect(res.result.signature).not.toBe('SIG_FROM_RPC')
        // Sayfa serididen 64 bayti atob ile uretir (§3.3): base64 alan ZORUNLU.
        expect(Buffer.from(res.result.signatureBytes, 'base64')).toHaveLength(64)
        // Temizlenmis opsiyonlar OLDUGU GIBI gecer.
        expect(options).toMatchObject({ skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 1 })
    })

    it('imza anindan once blockhash tazeligi confirmed commitment ile sorulur', async () => {
        await cagir()
        expect(solanaRpc).toHaveBeenCalledWith('isBlockhashValid', [BLOCKHASH, { commitment: 'confirmed' }])
    })

    it('bayat blockhash: SOLANA_BLOCKHASH_EXPIRED ve YAYIN YAPILMAZ', async () => {
        solanaRpc.mockResolvedValue({ value: false })

        const res = await cagir()

        expect(res.error).toBe('SOLANA_BLOCKHASH_EXPIRED')
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })

    // isBlockhashValid nonce degerini HER ZAMAN gecersiz raporlar -- kontrol
    // yapilirsa her durable-nonce islemi reddedilir.
    it('durable nonce: tazelik SORULMAZ ve islem yayinlanir', async () => {
        localStore.current_request.transactions = [txBase64({ durableNonce: true })]

        const res = await cagir()

        expect(solanaRpc).not.toHaveBeenCalled()
        expect(broadcastSignedTransaction).toHaveBeenCalledOnce()
        expect(res.error).toBeUndefined()
    })

    // §11 FAIL-OPEN: sunucu beyaz listesi henuz deploy edilmemis olabilir.
    it.each([['404', 'SOLANA_RPC_HTTP_404'], ['405', 'SOLANA_RPC_HTTP_405']])(
        'proxy %s: kontrol atlanir, islem YINE yayinlanir',
        async (_ad, kod) => {
            solanaRpc.mockRejectedValue(new Error(kod))

            const res = await cagir()

            expect(res.error).toBeUndefined()
            expect(broadcastSignedTransaction).toHaveBeenCalledOnce()
        })

    // §6.4 cift gonderim disiplini: dugum islemi KABUL ETMIS olabilir.
    it.each([['zaman asimi', 'SOLANA_RPC_TIMEOUT'], ['502', 'SOLANA_RPC_HTTP_502']])(
        'BELIRSIZ dususte (%s) hata DEGIL imza donulur',
        async (_ad, kod) => {
            broadcastSignedTransaction.mockRejectedValueOnce(new Error(kod))

            const res = await cagir()

            expect(res.error).toBeUndefined()
            expect(res.result.broadcastStatusUnknown).toBe(true)
            expect(res.result.broadcastError).toBe(kod)
            const tx = Transaction.from(Buffer.from(broadcastSignedTransaction.mock.calls[0][0], 'base64'))
            expect(res.result.signature).toBe(bs58.encode(tx.signature))
            // §6.4'un ismi TASIDIGI iddia: BELIRSIZ dususte yeniden imzalayip
            // YENIDEN yayinlamak YOKTUR -- ayni imza IKI KEZ zincire gidebilirdi.
            // `mockRejectedValueOnce` tek basina bunu KANITLAMAZ: ikinci cagri
            // ikinci mock'a (varsayilan resolve) duserdi ve `broadcastStatusUnknown`
            // hala true kalabilirdi -- bu satir olmadan bir yeniden-deneme
            // yolu butun ust assertion'lari GECERDI.
            expect(broadcastSignedTransaction).toHaveBeenCalledOnce()
        })

    // 4xx BELIRSIZ DEGILDIR: istek proxy tarafindan reddedildi, duguma HIC
    // gitmedi. Imza dondurmek dapp'e var olmayan bir islem gostermek olurdu.
    it('4xx dususte imza DONULMEZ, hata donulur', async () => {
        broadcastSignedTransaction.mockRejectedValueOnce(new Error('SOLANA_RPC_HTTP_403'))

        const res = await cagir()

        expect(res.error).toBe('SOLANA_RPC_HTTP_403')
        expect(res.result).toBeUndefined()
        // KESIN dususte de yeniden denenmez: istek proxy'de reddedildi, tekrar
        // gondermek AYNI reddi getirir -- ikinci bir ag cagrisi gereksizdir.
        expect(broadcastSignedTransaction).toHaveBeenCalledOnce()
    })

    // §6.1: turetilen anahtar HEM onaylanan `from` HEM oturum adresiyle
    // karsilastirilir. Kullanici onay ekrani acikken hesap degistirmis olabilir.
    it('turetilen adres oturumdan farkliysa SOLANA_DAPP_FROM_MISMATCH', async () => {
        localStore.solana_dapps[ORIGIN].address = ALICI

        const res = await cagir()

        expect(res.error).toBe('SOLANA_DAPP_FROM_MISMATCH')
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })

    it('kilitli kasada imzalama HIC baslamaz', async () => {
        sessionStore = {}

        const res = await cagir()

        expect(res.error).toBe('WALLET_LOCKED')
        expect(deriveSolanaKeypair).not.toHaveBeenCalled()
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })

    // Mesaj `mode` diyor ama DISKTEKI kayit demiyorsa yayinlanmaz: yayin karari
    // TEK bir kaynaktan (arka planin KENDI yazdigi current_request) okunur.
    it('diskteki kayit signAndSend DEGILSE yayin yapilmaz', async () => {
        localStore.current_request.mode = 'sign'

        const res = await cagir()

        expect(res.error).toBeTruthy()
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })

    // Task-39 review Bulgu 2: kimlik karsilastirmasi requestId'siz bir mesajda
    // ATLANAMAZ (fail-OPEN olamaz) -- aksi halde onay ekranindan gelen HERHANGI
    // bir mesaj, diskte bekleyen HANGI signAndSend kaydi varsa onu imzalayip
    // yayinlardi. Task 30'un kosulsuz karsilastirmasiyla (:776) AYNI kalip.
    it('mesajda requestId eksikse SOLANA_DAPP_FROM_MISMATCH -- kimlik kontrolu ATLANMAZ', async () => {
        const res = await cagir({ requestId: undefined })

        expect(res.error).toBe('SOLANA_DAPP_FROM_MISMATCH')
        expect(res.result).toBeUndefined()
        expect(deriveSolanaKeypair).not.toHaveBeenCalled()
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })

    // F2 (nihai inceleme fix turu 1) -- C1.5'in SIGN_TX kilidindeki AYNI
    // bosluk: `requestId` HEM mesajda HEM `current_request`te `undefined`
    // gelirse `current_request.requestId !== message.requestId` esitligi
    // (`undefined !== undefined` -> false) TATMIN OLUR ve kimlik karsilastirmasi
    // SESSIZCE gecer. Bugun bu yola sayfa ULASAMAZ (onay ekrani her zaman
    // requestId gonderir), ama kilit handleSolanaDappSignTx'teki kardesiyle
    // (`!requestId`) AYNI fail-closed simetriye sahip olmali.
    it('F2: requestId hem mesajda hem current_request te undefined ise SOLANA_DAPP_FROM_MISMATCH', async () => {
        localStore.current_request = { ...localStore.current_request, requestId: undefined }

        const res = await cagir({ requestId: undefined })

        expect(res.error).toBe('SOLANA_DAPP_FROM_MISMATCH')
        expect(res.result).toBeUndefined()
        expect(deriveSolanaKeypair).not.toHaveBeenCalled()
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })

    // §2.1: dapp islemleri bu turda GECMISE YAZILMAZ (writeSolanaPendingRecord
    // tek alici/tek tutar varsayiyor, dapp isleminde ikisi de yok).
    it('bekleyen islem kaydi YAZILMAZ', async () => {
        await cagir()
        expect(localStore.pending_transactions).toBeUndefined()
    })

    // Obligation 4 (Task 37/39): ownSignatureBytes null donerse FAIL-CLOSED --
    // kendi imzamizin islemde OLDUGUNU dogrulayamadan yayin yapmak, dapp'e
    // hangi baytlarin zincire gittigini bilmedigimiz bir "imza" donmek olurdu.
    it('ownSignatureBytes null donerse (kendi imzamiz yok) YAYIN YAPILMAZ', async () => {
        ownSignatureBytes.mockReturnValueOnce(null)

        const res = await cagir()

        expect(res.error).toBe('SOLANA_SEND_FAILED')
        expect(res.result).toBeUndefined()
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })
})
