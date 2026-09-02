import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import { PublicKey, SystemInstruction, SystemProgram, Transaction } from '@solana/web3.js'
// BAGIMSIZ base58: uretim kodu kendi base58.js'ini kullaniyor. Ayni uygulamayi
// beklenti tarafinda da kullanmak, iki tarafin AYNI hatayi yapmasi durumunda
// testi totolojiye cevirirdi -- bu yuzden burada @solana/web3.js'in kendi
// bagimliligi (bs58) dogrudan okunur.
import bs58 from 'bs58'
import {
    decodeTransferCheckedInstruction,
    getAssociatedTokenAddressSync,
    TokenOwnerOffCurveError,
} from '@solana/spl-token'

/**
 * SOLANA_SEND handler'i.
 *
 * background.js bir service worker GIRIS dosyasi: hicbir sey disari vermiyor ve
 * modul kapsaminda chrome.* dinleyicileri kaydediyor. Bu yuzden handler'a tek
 * ulasma yolu, chrome API'sini taklit edip modulu import etmek ve kaydettigi
 * onMessage dinleyicisini yakalamak. Harness background.solanaDerive.test.js'ten
 * BIREBIR alindi.
 */

const EXTENSION_ORIGIN = 'chrome-extension://watswallet/'
const TO = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const TEST_MNEMONIC = 'abandon abandon abandon about'
const BLOCKHASH = '11111111111111111111111111111111'

// GERCEK keypair'ler: deriveSolanaKeypair burada TAM olarak mocklaniyor (asagida),
// ama mock'un dondurdugu deger uydurma bir nesne DEGIL, GERCEK derive.js
// uygulamasinin bu mnemonic icin urettigi seydir. Boylece background.js'teki
// transaction.sign()/serialize() akisi PRODUCTION'daki ile AYNI seklide (gercek
// bir ed25519 PublicKey + gercek bir secretKey ciftiyle) calisir; mock ile
// production "keypair nedir" konusunda ayrisamaz. testKeypair fee payer'i
// (active_account.solanaAddress) temsil eder; wrongKeypair ise SADECE asagidaki
// "yanlis anahtarla imzalama" testinde, BASKA bir hesabin GERCEK ama YANLIS
// secretKey'i olarak kullanilir.
let testKeypair
let wrongKeypair
let DERIVED

// Turetme DOSYA BASINA BIR KEZ: BIP-39 mnemonicToSeed 2048 turluk bir PBKDF2
// calistirir; bunu her testte tekrarlamak beforeEach'i sebepsiz sisirir.
beforeAll(async () => {
    const actual = await vi.importActual('./utils/solana/derive')
    testKeypair = await actual.deriveSolanaKeypair(TEST_MNEMONIC, 0)
    wrongKeypair = await actual.deriveSolanaKeypair(TEST_MNEMONIC, 1)
    DERIVED = testKeypair.publicKey.toBase58()
})

let messageListener
let sessionStore
let localStore

const deriveSolanaKeypair = vi.fn()
vi.mock('./utils/solana/derive', () => ({
    deriveSolanaKeypair: (...a) => deriveSolanaKeypair(...a),
    deriveSolanaAddress: vi.fn(async () => ({ address: DERIVED, publicKey: 'ee'.repeat(32) })),
}))

const prepareTransferContext = vi.fn()
const broadcastSignedTransaction = vi.fn()
vi.mock('./utils/solana/send', () => ({
    prepareTransferContext: (...a) => prepareTransferContext(...a),
    broadcastSignedTransaction: (...a) => broadcastSignedTransaction(...a),
}))

const unlockVault = vi.fn()
vi.mock('./utils/crypto-utils', () => ({
    unlockVault: (...a) => unlockVault(...a),
    decryptSecret: vi.fn(),
}))

// background.js kurtarma yolunda (checkAndRecoverPendingTxs) solanaRpc'yi
// dogrudan cagiriyor; asagidaki HEARTBEAT testinde GERCEK bir fetch cikmasin.
const solanaRpc = vi.fn()
vi.mock('./utils/solana/client', () => ({
    solanaRpc: (...a) => solanaRpc(...a),
    SOLANA_API_BASE: 'https://api.test',
}))

/**
 * broadcastSignedTransaction'a GERCEKTEN verilen base64'u coz.
 *
 * "cagrildi" demek YETMEZ: bekleyen kayit da istek parametrelerinden
 * kopyalaniyor, yani alicinin veya tutarin degistigi bir refactor'da arayuz
 * DOGRU rakamlari gostermeye devam ederken zincire BASKA bir islem gider.
 * Iddia edilmesi gereken tek sey, YAYINLANAN islemin kendisidir.
 */
function decodeBroadcast() {
    expect(broadcastSignedTransaction).toHaveBeenCalledOnce()
    const [base64] = broadcastSignedTransaction.mock.calls[0]
    expect(typeof base64).toBe('string')
    return Transaction.from(Buffer.from(base64, 'base64'))
}

function installChromeStub() {
    const listeners = { onAlarm: [], onConnect: [], onStartup: [], onInstalled: [], onMessage: [] }
    const add = (bucket) => ({ addListener: (fn) => listeners[bucket].push(fn) })

    globalThis.chrome = {
        alarms: { create: vi.fn(), onAlarm: add('onAlarm') },
        runtime: {
            getURL: () => EXTENSION_ORIGIN,
            onConnect: add('onConnect'),
            onStartup: add('onStartup'),
            onInstalled: add('onInstalled'),
            onMessage: add('onMessage'),
            sendMessage: vi.fn(() => Promise.resolve()),
            lastError: null,
        },
        storage: {
            local: {
                get: vi.fn(async (keys) => {
                    const wanted = Array.isArray(keys) ? keys : [keys]
                    return Object.fromEntries(wanted.map(k => [k, localStore[k]]))
                }),
                set: vi.fn(async (obj) => { Object.assign(localStore, obj) }),
                remove: vi.fn(async () => {}),
            },
            session: {
                get: vi.fn(async () => sessionStore),
                set: vi.fn(async (obj) => { Object.assign(sessionStore, obj) }),
                remove: vi.fn(async () => {}),
            },
        },
        tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => {}), create: vi.fn() },
        windows: { create: vi.fn(), onRemoved: add('onConnect'), remove: vi.fn() },
        action: { setBadgeText: vi.fn(), setBadgeBackgroundColor: vi.fn() },
    }
    return listeners
}

// Handler sendResponse'u ASENKRON cagiriyor (return true). Sozle sarmalanir.
function callHandler(message, sender = { url: EXTENSION_ORIGIN }) {
    return new Promise((resolve) => {
        const returned = messageListener(message, sender, resolve)
        if (returned !== true) resolve(undefined)
    })
}

beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    sessionStore = { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }
    localStore = {
        active_account: { key: 'k1', type: 'hd', index: 0, address: '0xabc' },
        vaults: [{ id: 'v1', type: 'mnemonic', accounts: [{ key: 'k1', address: '0xabc' }] }],
    }
    const listeners = installChromeStub()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    await import('./background.js')
    messageListener = listeners.onMessage[0]
    unlockVault.mockResolvedValue(TEST_MNEMONIC)

    prepareTransferContext.mockResolvedValue({
        blockhash: BLOCKHASH,
        feeLamports: 5000, rentExemptLamports: 890880,
        recipientAtaExists: true, ataRentLamports: 0,
    })
    broadcastSignedTransaction.mockResolvedValue('SIG123')
    deriveSolanaKeypair.mockResolvedValue(testKeypair)
    solanaRpc.mockResolvedValue({ value: [null] })
    localStore.active_account = { key: 'k1', type: 'hd', index: 0, address: '0xabc', solanaAddress: DERIVED }
    localStore.pending_transactions = []
})

describe('SOLANA_SEND', () => {
    // YAYINLANAN islemin ICINE bakilir. Yalnizca "broadcastSignedTransaction
    // cagrildi" demek, alicinin veya tutarin degistigi bir refactor'u YAKALAMAZ:
    // bekleyen kayit istek parametrelerinden kopyalandigi icin arayuz yine
    // DOGRU rakamlari gosterir, zincirde ne olursa olsun. Olculdu: bu iddialar
    // olmadan buildTransferPlan cagrisina baska bir `to:` gommek de,
    // `amount: String(Number(amount) * 10)` de tum testleri YESIL biraktiriyordu.
    it('islemi imzalar, yayinlar ve imzayi doner', async () => {
        const res = await callHandler({
            type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9
        })

        expect(res.result.signature).toBe('SIG123')

        const tx = decodeBroadcast()
        expect(tx.feePayer.toBase58()).toBe(DERIVED)
        expect(tx.recentBlockhash).toBe(BLOCKHASH)
        expect(tx.instructions).toHaveLength(1)
        expect(tx.instructions[0].programId.equals(SystemProgram.programId)).toBe(true)

        const transfer = SystemInstruction.decodeTransfer(tx.instructions[0])
        expect(transfer.fromPubkey.toBase58()).toBe(DERIVED)
        expect(transfer.toPubkey.toBase58()).toBe(TO)
        expect(BigInt(transfer.lamports)).toBe(1_000_000_000n)
    })

    // Ayni iddia SPL yolu icin: burada alici ARTIK cuzdan adresi degil onun
    // ATA'sidir ve tutar token ondaligiyla olceklenir. Iki kayma da (yanlis ATA,
    // yanlis olcek) yalnizca yayinlanan islem cozulerek gorulebilir.
    it('SPL yolunda mint, alici ATA ve birim sayisi zincire GIDEN islemde dogru', async () => {
        const res = await callHandler({
            type: 'SOLANA_SEND', to: TO, mint: MINT, amount: '2.5', decimals: 6
        })

        expect(res.result.signature).toBe('SIG123')

        const tx = decodeBroadcast()
        expect(tx.feePayer.toBase58()).toBe(DERIVED)
        expect(tx.instructions).toHaveLength(1)

        const decoded = decodeTransferCheckedInstruction(tx.instructions[0])
        expect(decoded.keys.mint.pubkey.toBase58()).toBe(MINT)
        expect(decoded.keys.owner.pubkey.toBase58()).toBe(DERIVED)
        expect(decoded.keys.source.pubkey.toBase58()).toBe(
            getAssociatedTokenAddressSync(new PublicKey(MINT), new PublicKey(DERIVED)).toBase58()
        )
        expect(decoded.keys.destination.pubkey.toBase58()).toBe(
            getAssociatedTokenAddressSync(new PublicKey(MINT), new PublicKey(TO)).toBase58()
        )
        expect(BigInt(decoded.data.amount)).toBe(2_500_000n)
        expect(decoded.data.decimals).toBe(6)
    })

    // Bekleyen kayit ile ZINCIRE GIDEN islem ayrisamaz. Kayit istek
    // parametrelerinden kopyalandigi icin ikisi bagimsiz olarak surukleneblir;
    // bu test onlari birbirine BAGLAR.
    it('bekleyen kayit zincire giden islemle AYNI alici ve tutari gosterir', async () => {
        await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

        const transfer = SystemInstruction.decodeTransfer(decodeBroadcast().instructions[0])
        const record = localStore.pending_transactions[0]

        expect(record.to_address).toBe(transfer.toPubkey.toBase58())
        expect(record.from_address).toBe(transfer.fromPubkey.toBase58())
        // Kayittaki tutar SOL cinsinden, zincire giden lamports cinsinden:
        // AYNI degeri gostermeliler.
        expect(BigInt(record.value) * 1_000_000_000n).toBe(BigInt(transfer.lamports))
    })

    it('bekleyen islem kaydi olusturulur', async () => {
        await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

        const pending = localStore.pending_transactions
        expect(pending).toHaveLength(1)
        expect(pending[0]).toMatchObject({
            hash: 'SIG123', chainId: 'solana-mainnet', receipt_status: 'pending'
        })
    })

    // Adres HARF KASASI KORUNARAK kaydedilir: kucultulen bir base58 adres
    // gecmis ekraninda ve zehirli adres tespitinde BASKA bir adrese donusur.
    it('bekleyen kayitta adresler kucultulmez', async () => {
        await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

        expect(localStore.pending_transactions[0].to_address).toBe(TO)
        expect(localStore.pending_transactions[0].from_address).toBe(DERIVED)
    })

    it('kasa kilitliyse imzalama HIC baslamaz', async () => {
        sessionStore = {}
        const res = await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

        expect(res.error).toBe('WALLET_LOCKED')
        expect(deriveSolanaKeypair).not.toHaveBeenCalled()
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })

    it('ice aktarilmis hesap reddedilir', async () => {
        localStore.active_account = { key: 'k2', type: 'imported', address: '0xdef' }
        const res = await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

        expect(res.error).toBe('SOLANA_UNSUPPORTED_ACCOUNT')
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })

    // Turetilen adres kayitliyla ayrilirsa BASKA bir hesabin anahtariyla imza
    // atiliyordur: kullanicinin baska bir hesabinin fonlari harcanir.
    it('turetilen adres kayitlidan farkliysa imza ATILMAZ', async () => {
        localStore.active_account.solanaAddress = 'BaskaBirAdres11111111111111111111111111111'
        const res = await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

        expect(res.error).toBe('DERIVED_ADDRESS_MISMATCH')
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })

    // Kanit: transaction.serialize()'daki verifySignatures ACIK ve CANLI.
    // publicKey BURADA DOGRU (active_account.solanaAddress ile eslesir, yani
    // DERIVED_ADDRESS_MISMATCH kontrolunu GECER) ama secretKey BASKA (gercek,
    // gecerli, ama fee payer'a AIT OLMAYAN) bir hesabinkidir -- tam olarak
    // ileride bir refactor'un yanlis keypair'i baglamasi durumunda uretecegi
    // imza. Bu durumda uretilen imza fee payer'in anahtariyla ASLA eslesmez ve
    // web3.js serialize() sirasinda bunu YEREL olarak, zincire hic gitmeden
    // yakalamali. Bu test olmadan biri serialize()'i tekrar verifySignatures:
    // false ile cagirabilir ve hicbir test kizarmaz.
    it('imza fee payer ile eslesmezse yayin YAPILMAZ', async () => {
        deriveSolanaKeypair.mockResolvedValue({
            publicKey: testKeypair.publicKey,
            secretKey: wrongKeypair.secretKey,
        })

        const res = await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

        expect(res.error).toBeTruthy()
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
        expect(localStore.pending_transactions || []).toHaveLength(0)
    })

    // KESIN reddedilen yayin: dugum istegi GORDU ve REDDETTI (preflight hatasi,
    // suresi dolmus blockhash, yetersiz bakiye). Islem zincire GITMEDI, yani
    // bekleyen kayit yazmak YALAN olurdu ve "tekrar deneyin" DOGRU tavsiyedir.
    //
    // Bu test eskiden 'yayin duserse' basligiyla HER TURLU yayin reddini
    // kapsiyormus gibi duruyordu ve BELIRSIZ dususleri de bu davranisa kilitliyordu
    // (nihai inceleme, Bulgu 1). Kapsam artik ACIKCA kesin reddedilme; belirsiz
    // dusus asagida AYRI ve ZIT bir davranisla kilitli.
    it('yayin KESIN reddedilirse bekleyen kayit BIRAKILMAZ', async () => {
        broadcastSignedTransaction.mockRejectedValueOnce(new Error('Blockhash not found'))
        const res = await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

        expect(res.error).toMatch(/Blockhash/)
        expect(res.result).toBeUndefined()
        expect(localStore.pending_transactions || []).toHaveLength(0)
    })

    // --- BELIRSIZ YAYIN (nihai inceleme, Bulgu 1) ---
    //
    // Zaman asimi ve 5xx, "dugum kabul etmedi" DEMEK DEGILDIR: yanit KAYBOLMUS
    // olabilir, yani islem ZINCIRDE olabilir. Eskiden imza yalnizca RPC'nin donus
    // degerinden ogreniliyordu, bu yuzden boyle bir dususte elde HICBIR SEY
    // kalmiyordu: kayit yazilmiyor, kullaniciya "tekrar deneyin" deniyor ve ikinci
    // tiklama TAZE blockhash ile FARKLI imzali IKINCI bir transfer uretiyordu.
    //
    // Imza `transaction.sign()` ile ZATEN belli; yayindan ONCE yakalanir.
    const BELIRSIZ = [
        ['zaman asimi', 'SOLANA_RPC_TIMEOUT'],
        ['proxy 502', 'SOLANA_RPC_HTTP_502'],
        ['saglayici 503', 'SOLANA_RPC_HTTP_503'],
        ['500', 'SOLANA_RPC_HTTP_500'],
    ]

    it.each(BELIRSIZ)('BELIRSIZ dususte (%s) imza donulur ve kayit YAZILIR', async (_ad, kod) => {
        broadcastSignedTransaction.mockRejectedValueOnce(new Error(kod))

        const res = await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

        // "tekrar deneyin" DEGIL: hata YOK, imza VAR ve durum BILINMIYOR olarak
        // isaretlenmis.
        expect(res.error).toBeUndefined()
        expect(res.result.broadcastStatusUnknown).toBe(true)
        expect(res.result.broadcastError).toBe(kod)

        // Imza YERELDIR ve GERCEKTIR: islemin KENDI imzasi (RPC'den gelmedi).
        // Dogrulama bagimsiz: aynen yayinlanmaya calisilan base64'un icindeki imza.
        const [base64] = broadcastSignedTransaction.mock.calls[0]
        const tx = Transaction.from(Buffer.from(base64, 'base64'))
        expect(res.result.signature).toBe(bs58.encode(tx.signature))
        expect(res.result.signature).not.toBe('SIG123')

        // Kayit YAZILIR: kurtarma turu (getSignatureStatuses,
        // searchTransactionHistory: true) bu imzayi arayabilsin.
        expect(localStore.pending_transactions).toHaveLength(1)
        expect(localStore.pending_transactions[0]).toMatchObject({
            hash: res.result.signature, chainId: 'solana-mainnet', receipt_status: 'pending',
        })
        // Adresler KUCULTULMEZ.
        expect(localStore.pending_transactions[0].to_address).toBe(TO)
        expect(localStore.pending_transactions[0].from_address).toBe(DERIVED)
    })

    // 4xx BELIRSIZ DEGILDIR: istek proxy tarafindan (beyaz liste / oran limiti /
    // boyut siniri) REDDEDILMISTIR, dugume HIC gitmemistir. Bu ayrim kaybolursa
    // hicbir zaman gonderilmemis islemler icin bekleyen kayit uretilir.
    it.each([['429', 'SOLANA_RPC_HTTP_429'], ['403', 'SOLANA_RPC_HTTP_403']])(
        '4xx (%s) BELIRSIZ SAYILMAZ: kayit yazilmaz, hata donulur',
        async (_ad, kod) => {
            broadcastSignedTransaction.mockRejectedValueOnce(new Error(kod))
            const res = await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

            expect(res.error).toBe(kod)
            expect(res.result).toBeUndefined()
            expect(localStore.pending_transactions || []).toHaveLength(0)
        })

    // Belirsiz dususte kayit da yazilamazsa: imza YINE donulur (kullanicinin
    // elindeki tek iz odur), ayri bir alanla isaretlenerek.
    it('BELIRSIZ dususte kayit yazilamazsa imza YINE donulur', async () => {
        broadcastSignedTransaction.mockRejectedValueOnce(new Error('SOLANA_RPC_TIMEOUT'))
        // YALNIZCA bekleyen liste yazimi duser: kosulsuz bir mockRejectedValueOnce
        // baska (ilgisiz) bir set cagrisina takilip yakalanmamis bir hata birakiyordu.
        const gercekSet = chrome.storage.local.set.getMockImplementation()
        chrome.storage.local.set.mockImplementation(async (obj) => {
            if (Object.prototype.hasOwnProperty.call(obj, 'pending_transactions')) throw new Error('QUOTA_BYTES')
            return gercekSet(obj)
        })

        const res = await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

        expect(res.error).toBeUndefined()
        expect(res.result.signature).toBeTruthy()
        expect(res.result.broadcastStatusUnknown).toBe(true)
        expect(res.result.bookkeepingError).toBeTruthy()
    })

    it('uzanti disi kokenden gelen istek reddedilir', async () => {
        const res = await callHandler(
            { type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 },
            { url: 'https://kotu.example/' }
        )
        expect(res?.error).toBeTruthy()
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })

    // HICBIR hata sinir otesine FALSY gecemez.
    //
    // @solana/spl-token'in TokenOwnerOffCurveError'i ARGUMANSIZ firlatilir:
    // message === ''. Handler bunu oldugu gibi gecirirse `{ error: '' }` doner;
    // `if (res.error) { hatayi goster } else { res.result.signature }` yazan bir
    // ekran BASARI dalina duser ve res.result undefined oldugu icin patlar --
    // yani gonderim BASARISIZ olmusken kullaniciya basarisiz oldugu bile
    // soylenemez. e.message bos/eksikse e.name, o da yoksa sabit bir kod.
    const FALSY_HATALAR = [
        ['mesaji BOS gercek bir hata sinifi', () => new TokenOwnerOffCurveError(), 'TokenOwnerOffCurveError'],
        ['bos mesajli duz Error', () => new Error(''), 'Error'],
        ['ne message ne name tasiyan nesne', () => ({}), 'SOLANA_SEND_FAILED'],
        ['undefined', () => undefined, 'SOLANA_SEND_FAILED'],
    ]

    it.each(FALSY_HATALAR)('hicbir hata FALSY gecmez: %s', async (_ad, uret, beklenen) => {
        prepareTransferContext.mockRejectedValueOnce(uret())

        const res = await callHandler({ type: 'SOLANA_SEND', to: TO, mint: MINT, amount: '1', decimals: 6 })

        expect(res.error).toBeTruthy()
        expect(res.error).toBe(beklenen)
        expect(res.result).toBeUndefined()
        expect(broadcastSignedTransaction).not.toHaveBeenCalled()
    })

    // withStorageList (saveOrUpdateTxInStorage icinde) dizi OLMAYAN bir anahtari
    // sessizce []'e indirger. Ham `const { pending_transactions = [] } = await
    // get(...)` yolu bunu YAPMAZ: varsayilan yalnizca `undefined` icin devreye
    // girer, dizi olmayan bir deger oldugu gibi gecer ve .push() TypeError
    // firlatir -- ZATEN YAYINLANMIS bir islemin kaydi hic yazilmaz.
    it('bekleyen liste BOZUKSA (dizi degil) kayit yine de yazilir', async () => {
        localStore.pending_transactions = 'bozuk'

        const res = await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

        expect(res.result.signature).toBe('SIG123')
        expect(Array.isArray(localStore.pending_transactions)).toBe(true)
        expect(localStore.pending_transactions).toHaveLength(1)
        expect(localStore.pending_transactions[0].hash).toBe('SIG123')
    })

    // F4'un ASIL degismezi: PENDING_TRANSACTIONS'a yazan HERKES AYNI kuyruktan
    // gecer. Yukaridaki test yalnizca yazimin BICIMINI (dizi olmayan anahtarin
    // []'e indirgenmesi) olcer; bicimi dogru yapip kuyrugu ATLAYAN bir yazim
    // ondan gecer. Burada olculen sey SERILESTIRME: bir yazim havadayken ayni
    // anahtara dokunan baska bir yazicinin kaydi KAYBOLMAMALI.
    //
    // Kurgu: gonderimin bekleyen-liste okumasi geciktirilir (anlik goruntu
    // SIMDI alinir, cagirana GEC verilir). Arada ikinci bir yazici ayni
    // anahtara yazar. Gonderim kuyruktan geciyorsa ikinci yazici onun ARDINDAN
    // sirasini alir ve iki kayit da yasar; gecmiyorsa gonderim kendi eski
    // goruntusunu geri yazar ve ikinci yazicinin kaydini EZER.
    it('gonderimin yazimi AYNI kuyruktan gecer: es zamanli yazici EZILMEZ', async () => {
        // background.js ile AYNI modul ornegi: beforeEach'teki vi.resetModules()
        // sonrasi yapilan dinamik import, background.js'in kullandigi
        // txStorage kuyrugunu paylasir. Dosya basindaki statik bir import
        // BASKA bir ornek olurdu ve kuyruk paylasilmazdi.
        const { saveOrUpdateTxInStorage } = await import('./utils/processTransaction')

        let birak
        const kapi = new Promise((r) => { birak = r })
        let kapandi = false
        const duzGet = chrome.storage.local.get
        chrome.storage.local.get = vi.fn(async (keys) => {
            const wanted = Array.isArray(keys) ? keys : [keys]
            if (!kapandi && wanted.includes('pending_transactions')) {
                kapandi = true
                const anlik = { pending_transactions: [...(localStore.pending_transactions || [])] }
                await kapi
                return anlik
            }
            return duzGet(keys)
        })

        const gonderim = callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })
        await vi.waitFor(() => { expect(kapandi).toBe(true) })

        const otekiYazici = saveOrUpdateTxInStorage({
            hash: 'OTEKI_YAZICI', chainId: 1, receipt_status: 'pending',
            block_timestamp: new Date().toISOString(),
        })
        // Gonderim kuyrugu TUTUYORSA bu yazici bekler (beklemesi gereken de
        // budur); tutmuyorsa hemen tamamlanir ve yarisi kurar.
        await Promise.race([otekiYazici, new Promise((r) => setTimeout(r, 50))])

        birak()
        const res = await gonderim
        await otekiYazici

        expect(res.result.signature).toBe('SIG123')
        const hashler = localStore.pending_transactions.map(t => t.hash)
        expect(hashler).toContain('SIG123')
        expect(hashler).toContain('OTEKI_YAZICI')
    })

    // HEARTBEAT checkAndRecoverPendingTxs'i AWAIT ETMEDEN tetikler, yani her
    // gonderim bir kurtarma calismasiyla AYNI ANDA olabilir.
    //
    // Kurtarma iki asamali: zincir sorgulari kilit DISINDA, birlestirme+budama
    // kilit ICINDE. 1. asamanin anlik goruntusu bu yuzden ESKIMIS olabilir.
    // Kilit icinde o eski goruntu geri YAZILIRSA, arada tamamlanmis bir
    // gonderimin kaydi SESSIZCE silinir: kullanici zincire gitmis bir islemi
    // gecmisinde hic gormez ve golge bakiye bozulur. Birlestirme, kilit icinde
    // TAZE okunan liste uzerinde HASH ILE yapilmali.
    //
    // Kurgu: listede suresi dolmus bir kayit var, yani kurtarma budama yuzunden
    // MUTLAKA yazacak. Kurtarmanin 1. asama okumasi geciktirilip arada gonderim
    // tamamen calistiriliyor.
    it('esZamanli HEARTBEAT yeni yazilan kaydi EZMEZ', async () => {
        localStore.pending_transactions = [{
            hash: '0xdead', receipt_status: 'pending',
            block_timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
        }]

        let birak
        const kapi = new Promise((r) => { birak = r })
        let kapandi = false
        const duzGet = chrome.storage.local.get
        chrome.storage.local.get = vi.fn(async (keys) => {
            const wanted = Array.isArray(keys) ? keys : [keys]
            if (!kapandi && wanted.includes('pending_transactions')) {
                kapandi = true
                // Anlik goruntu SIMDI alinir ama cagirana GEC verilir: kurtarma
                // listeyi okudu ve sonra durakladi. (Kopyalaniyor cunku gercek
                // chrome.storage.local.get yapisal bir KOPYA doner, stub'daki
                // gibi canli referans degil -- yarisin gercek sekli budur.)
                const anlik = { pending_transactions: [...(localStore.pending_transactions || [])] }
                await kapi
                return anlik
            }
            return duzGet(keys)
        })

        await callHandler({ type: 'HEARTBEAT' })
        await vi.waitFor(() => { expect(kapandi).toBe(true) })

        // Gonderim kurtarma DURAKLARKEN tamamlanir. Kilit su anda TUTULMUYOR
        // (kurtarma henuz 1. asamada), bu yuzden beklemesi gerekmez -- kilidin
        // ag turlari boyunca tutulmadiginin kendisi de burada olculuyor.
        const res = await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

        birak()
        await new Promise((r) => setTimeout(r, 50))

        expect(res.result.signature).toBe('SIG123')
        expect(localStore.pending_transactions.map(t => t.hash)).toContain('SIG123')
        expect(localStore.pending_transactions.map(t => t.hash)).not.toContain('0xdead')
    })

    // Kilit AG TURLARI BOYUNCA TUTULMAZ.
    //
    // Zincir sorgulari withStorageList'in mutate geri cagrisi icinde yapiliyordu,
    // yani PENDING_TRANSACTIONS kuyrugu (txStorage.js, anahtar basina TEK soz
    // zinciri) butun bir ag turu boyunca tutuluyordu. O kuyrugu paylasan herkes
    // bekliyordu -- ozellikle sendSolanaTransfer'in YAYINDAN SONRAKI kayit
    // yazimi. Takilan tek bir RPC ile o await hic donmez, dolayisiyla
    // sendResponse da hic cagrilmaz: popup ZATEN ZINCIRE GITMIS bir islem icin
    // donmeye devam eder ve kullanici gonderimi TEKRAR yapar. Bu, "yayindan
    // sonra hicbir sey duz hata olarak donmez" kuralinin onlemek icin var
    // oldugu CIFT GONDERIMIN ta kendisidir, yalnizca oteki yondan.
    it('takilmis bir zincir sorgusu bekleyen liste kilidini TUTMAZ', async () => {
        localStore.pending_transactions = [{
            hash: 'ONCEKI_SIG', chainId: 'solana-mainnet', receipt_status: 'pending',
            block_timestamp: new Date().toISOString(),
        }]
        // HIC SONUCLANMAYAN bir sorgu: takilmis bir proxy'nin tam karsiligi.
        // (solanaRpc'ye bu turda bir zaman asimi eklendi ama kilit, zaman asimi
        // sinirini bekleyerek de tutulmamalidir.)
        solanaRpc.mockReturnValue(new Promise(() => {}))

        await callHandler({ type: 'HEARTBEAT' })
        await vi.waitFor(() => { expect(solanaRpc).toHaveBeenCalled() })

        const res = await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

        expect(res.result.signature).toBe('SIG123')
        expect(localStore.pending_transactions.map(t => t.hash)).toContain('SIG123')
    })

    // Yayindan SONRA defter tutma duserse islem ZATEN zincirdedir. Bunu duz bir
    // "gonderim basarisiz" olarak dondurmek kullanicinin TEKRAR gondermesine yol
    // acar: prepareTransferContext TAZE bir blockhash alir, FARKLI imzali IKINCI
    // bir transfer zincire gider -- CIFT GONDERIM, ve gonderim bir kez daha
    // geri alinamaz. Imza elimizdeyse cagirana HER ZAMAN donulur.
    it('yayindan SONRA kayit yazilamazsa imza YINE DE donulur', async () => {
        const hataKaydi = vi.spyOn(console, 'error').mockImplementation(() => {})
        // YALNIZCA bekleyen liste yazimi dusurulur: handler ayrica oturum
        // tazeleme gibi ilgisiz yazimlar da yapiyor, onlari da dusurmek testin
        // olcmedigi bir yerde sahipsiz bir red uretir.
        const duzSet = chrome.storage.local.set
        chrome.storage.local.set = vi.fn(async (obj) => {
            if (Object.prototype.hasOwnProperty.call(obj, 'pending_transactions')) {
                throw new Error('QUOTA_BYTES_EXCEEDED')
            }
            return duzSet(obj)
        })

        const res = await callHandler({ type: 'SOLANA_SEND', to: TO, mint: 'native', amount: '1', decimals: 9 })

        expect(res.error).toBeUndefined()
        expect(res.result.signature).toBe('SIG123')
        // "yayinlandi ama defter tutulamadi", "yayinlanamadi"dan AYIRT EDILEBILIR
        // olmali; aksi halde cagiran ikisine de ayni tepkiyi verir.
        expect(res.result.bookkeepingError).toBeTruthy()

        hataKaydi.mockRestore()
    })
})
