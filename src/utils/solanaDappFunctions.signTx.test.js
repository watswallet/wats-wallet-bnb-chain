// GENEL KISIT: @solana/web3.js'i DOGRUDAN iceren her dosyanin (kaynak VE test)
// ILK import'u bufferGlobal olmak zorunda -- Gorev 26 bunu test dosyasindan
// eksik biraktigi icin bir inceleme turu kaybetti. bufferGlobal.js
// `solana/` altinda oldugu icin buradan goreli yol `./solana/bufferGlobal.js`.
import './solana/bufferGlobal.js'
// KOK NEDEN (§4.3.1): duz bir kapi listesi YANLIS olurdu. Ayrica her red
// PENCERE ACILMADAN verilmeli -- pencere acildiktan sonra reddetmek, dapp'in
// promise'ini bekletirken kullaniciya anlamsiz bir ekran gostermek demektir.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js'
import { MAX_TX_BASE64_LENGTH } from './solana/walletStandardFeatures'

// F5 (fix turu 1): `resolveSenderOrigin` stub'i kaldirildi -- handleSolanaSignTransaction
// artik onu import ETMIYOR (C1.3, solanaSayfaKapisi bu modulun ICINDE tanimli),
// olu bir stub'i canli tutmak modul gercekten neyi kullandigini yanlis anlatirdi.
const openApprovalWindow = vi.fn(async () => {})
vi.mock('./dappFunctions', () => ({
    openApprovalWindow: (...a) => openApprovalWindow(...a),
}))

import { handleSolanaSignTransaction } from './solanaDappFunctions'

const ORIGIN = 'https://app.jup.ag'
const SENDER = { origin: ORIGIN, frameId: 0, tab: { favIconUrl: 'https://app.jup.ag/f.ico' } }
const BLOCKHASH = '11111111111111111111111111111111'

let localStore
let BIZ
let BASKASI

// Bu dosya `globalThis.chrome`i tanimlar ve `globalThis.crypto.randomUUID`i
// SABIT bir degerle EZER, ama hicbiri geri ALINMIYORDU -- ayni worker'da
// calisan BASKA test dosyalari (chrome global'i TANIMLI olmayan varsayimla
// yazilmis, ya da kendi randomUUID sahtesini bekleyen) bu sizintidan
// SESSIZCE etkilenebilirdi. Orijinal deger MODUL YUKLENIRKEN saklanir --
// beforeEach icinde DEGIL, aksi halde ilk `beforeEach` cagrisi zaten
// EZILMIS degeri "orijinal" diye kaydederdi.
const ozgunRandomUUID = globalThis.crypto.randomUUID

function tekImzaliTx(payer) {
    const tx = new Transaction()
    tx.recentBlockhash = BLOCKHASH
    tx.feePayer = payer.publicKey
    tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 }))
    return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString('base64')
}

// compact-u16 (shortvec) yazici -- parseDappTransaction.js'in okuyucusunun
// (readShortVec) TERSI. 2000 baytlik veri uzunlugu icin 2 baytlik shortvec
// gerekir.
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

// Inceleme Bulgu 1: GECERLI, COZULEBILIR ama MAX_TX_BASE64_LENGTH'i asan bir
// islem. Kucuk bir "!!! degil" dizesi boyut kapisini TETIKLEMEZ (parseDappTransaction
// zaten onu TX_DESERIALIZE_FAILED ile reddeder, kapinin varligini KANITLAMAZ).
// Boyut kapisinin GERCEKTEN pahali `parseDappTransaction` cagrisindan ONCE
// calistigini kanitlamak icin islem, parseDappTransaction'in COZEBILECEGI
// yapisal olarak TUTARLI bir islem olmali -- boyut kapisi olmasaydi bu islem
// parseDappTransaction'i BASARIYLA gecer, kapi 7'yi de gecer ve pencere ACARDI.
//
// `Transaction.serialize()` BURADA KULLANILAMAZ: web3.js legacy mesaji SABIT
// 1232 baytlik bir arabellege yazar ve tasarsa RangeError firlatir (v0 mesaji
// da ayni pakete gore boyutlanmis bir arabellek kullanir) -- yani web3.js'in
// KENDI serialize yolundan asla MAX_TX_BASE64_LENGTH'i (2048 karakter, ~1536
// bayt) asan bir cikti elde edilemez. Bu, sinirin neden 2048'de "comert"
// oldugunu da dogrular: web3.js'le kurulmus GERCEK bir islem zaten hicbir
// zaman oraya ulasamaz. parseDappTransaction ise `Transaction.from` ile
// COZER, kendi serialize'ini yeniden CAGIRMAZ -- yani sinirin gercek saldiri
// yuzeyi, serialize'i hic gormeden ELLE forge edilmis buyuk bir tel govdesidir
// (parseDappTransaction.js'teki "K1 review bulgusu" yorumunun ayni sinifi).
// Tel sekli asagida ELLE kuruluyor: [1 imza][baslik][2 hesap anahtari]
// [blockhash][1 talimat, verisi 2000 bayt].
function asiriBuyukTx(payer) {
    const veri = new Array(2000).fill(1)
    const bytes = [
        1, // imza sayisi (shortvec, 1 imzaci)
        ...new Array(64).fill(0), // imzasiz yuva (parseDappTransaction eksik imzayi missingCosigners'a yazar, TX_DESERIALIZE_FAILED atmaz)
        1, 0, 1, // numRequiredSignatures=1, numReadonlySigned=0, numReadonlyUnsigned=1
        2, // hesap anahtari sayisi (shortvec)
        ...payer.publicKey.toBytes(), // hesap 0: odeyen/imzaci
        ...SystemProgram.programId.toBytes(), // hesap 1: program kimligi
        ...new Array(32).fill(0), // blockhash (32 sifir bayt, gecerlilik burada onemsiz)
        1, // talimat sayisi (shortvec)
        1, // programIdIndex -> hesap 1
        1, 0, // talimatin hesap sayisi (shortvec) + hesap 0 (odeyen)
        ...shortvecEncode(veri.length),
        ...veri,
    ]
    return Buffer.from(Uint8Array.from(bytes)).toString('base64')
}

// Inceleme Bulgu 2: surum bayti 0x81 (legacy/v0 DISI) olacak sekilde ELLE
// PATCHLENMIS, aksi halde TAMAMEN gecerli tek-imzali bir islem. Tel sekli:
// [1 baytlik shortvec imza sayisi=1][64 baytlik imza yuvasi][mesaj]. Mesaj bu
// yuzden 65. bayttan basliyor -- parseDappTransaction.test.js'teki
// legacyIkiImzaci/0x81 kalibinin AYNISI, tek imzaciya uyarlanmis hali.
function surumBozukTx(payer) {
    const bytes = Buffer.from(tekImzaliTx(payer), 'base64')
    bytes[1 + 1 * 64] = 0x81
    return bytes.toString('base64')
}

// BASARI yolunda `sendResponse` HIC cagrilmaz -- isleyici onun yerine
// openApprovalWindow(requestId, sendResponse, kayit) cagirir ve o mock
// sendResponse'u yutar. Promise'i sendResponse'a baglamak bu yuzden UC testi
// (chain varsayilani, mode sign, mode signAll) vitest zaman asimina kadar
// asili birakirdi. Task 22'nin ayni durumda kullandigi kalip: yanitlari
// diziye topla, bir tur mikro/makro gorev bekle, ilkini dondur.
async function cagir(params) {
    const yanitlar = []
    handleSolanaSignTransaction({ method: 'solana_signTransaction', params: [params] }, SENDER, (r) => yanitlar.push(r))
    await new Promise((r) => setTimeout(r, 0))
    return yanitlar[0]
}

beforeEach(() => {
    vi.clearAllMocks()
    BIZ = Keypair.generate()
    BASKASI = Keypair.generate()
    localStore = {
        active_account: { key: 'k1', type: 'hd', index: 0, address: '0xabc', solanaAddress: BIZ.publicKey.toBase58() },
        solana_dapps: {
            [ORIGIN]: {
                address: BIZ.publicKey.toBase58(),
                publicKey: 'ee'.repeat(32),
                accountKey: 'k1',
                cluster: 'solana:mainnet',
                appMeta: { name: 'Jupiter' },
                connectedAt: 1,
            },
        },
    }
    globalThis.chrome = {
        storage: {
            local: {
                get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((k) => [k, localStore[k]])),
                set: async (obj) => { Object.assign(localStore, obj) },
            },
        },
    }
    globalThis.crypto.randomUUID = () => 'req-solana-1'
})

afterEach(() => {
    globalThis.crypto.randomUUID = ozgunRandomUUID
    delete globalThis.chrome
})

describe('handleSolanaSignTransaction -- kapilar (HEPSI pencere acilmadan)', () => {
    it('kapi 2: oturum YOKSA 4100 ve SIFIR pencere', async () => {
        localStore.solana_dapps = {}
        const res = await cagir({ transactions: [tekImzaliTx(BIZ)], chain: 'solana:mainnet' })
        expect(res.error.code).toBe(4100)
        expect(openApprovalWindow).not.toHaveBeenCalled()
    })

    // K10/§7.3.1: oturum accountKey'e SABITLENIR. Kullanici aktif hesabi
    // degistirdiginde oturum ASKIYA ALINIR -- kayit silinmez, ama imza
    // isteklerine 4100 doner ve dapp yeniden baglanmak zorunda kalir.
    it('kapi 2: aktif hesap degistiyse oturum ASKIDA -> 4100, kayit SILINMEZ', async () => {
        localStore.active_account = { ...localStore.active_account, key: 'k2' }
        const res = await cagir({ transactions: [tekImzaliTx(BIZ)], chain: 'solana:mainnet' })
        expect(res.error.code).toBe(4100)
        expect(localStore.solana_dapps[ORIGIN]).toBeTruthy()
        expect(openApprovalWindow).not.toHaveBeenCalled()
    })

    // Inceleme Bulgu 3 (Minor): `request.account` kolu (grantedSolanaSession'in
    // UCUNCU argumani) hicbir testte KULLANILMIYORDU. YABANCI bir base58 dizesi
    // oturumun adresiyle TAM eslesmeyince grantedSolanaSession null doner --
    // bu ayni zamanda K8'in (base58 kucultulmez) TAM esitlik sozlesmesini
    // account kolu icin de kilitler.
    it('kapi 2: request.account YABANCI bir adresle eslesmezse 4100', async () => {
        const res = await cagir({
            transactions: [tekImzaliTx(BIZ)],
            chain: 'solana:mainnet',
            account: BASKASI.publicKey.toBase58(),
        })
        expect(res.error.code).toBe(4100)
        expect(openApprovalWindow).not.toHaveBeenCalled()
    })

    it('kapi 3: ed25519 uretemeyen hesapta SOLANA_ACCOUNT_UNSUPPORTED', async () => {
        localStore.active_account = { ...localStore.active_account, type: 'imported' }
        const res = await cagir({ transactions: [tekImzaliTx(BIZ)], chain: 'solana:mainnet' })
        expect(res.error.data.code).toBe('SOLANA_ACCOUNT_UNSUPPORTED')
        expect(openApprovalWindow).not.toHaveBeenCalled()
    })

    // `chain` alani OLMADAN cluster kapisi HIC tetiklenemez ve devnet isteyen
    // bir dapp sessizce mainnet'te imzalanir.
    it('kapi 4: mainnet disi cluster SOLANA_WRONG_CLUSTER', async () => {
        const res = await cagir({ transactions: [tekImzaliTx(BIZ)], chain: 'solana:devnet' })
        expect(res.error.data.code).toBe('SOLANA_WRONG_CLUSTER')
        expect(openApprovalWindow).not.toHaveBeenCalled()
    })

    it('kapi 4: chain HIC gelmezse mainnet varsayilir ve gecer', async () => {
        await cagir({ transactions: [tekImzaliTx(BIZ)] })
        expect(openApprovalWindow).toHaveBeenCalledOnce()
        expect(openApprovalWindow.mock.calls[0][2].chain).toBe('solana:mainnet')
    })

    it('kapi 5: bos dizi ve bozuk base64 TX_DESERIALIZE_FAILED', async () => {
        expect((await cagir({ transactions: [] })).error.data.code).toBe('TX_DESERIALIZE_FAILED')
        expect((await cagir({ transactions: ['!!! degil'] })).error.data.code).toBe('TX_DESERIALIZE_FAILED')
        expect(openApprovalWindow).not.toHaveBeenCalled()
    })

    it('kapi 5: politika siniri (20) asilinca SOLANA_TOO_MANY_TRANSACTIONS', async () => {
        const bir = tekImzaliTx(BIZ)
        const res = await cagir({ transactions: new Array(21).fill(bir) })
        expect(res.error.data.code).toBe('SOLANA_TOO_MANY_TRANSACTIONS')
        expect(openApprovalWindow).not.toHaveBeenCalled()
    })

    // Inceleme Bulgu 1 (Important): spec 4.3.1 satir 5 "base64, surum, sayi,
    // BOYUT" der -- boyut UCUZ pasta, pahali parseDappTransaction'dan ONCE
    // calismali. Girdi BIZIM gecerli imzamizla kurulu (asiriBuyukTx): boyut
    // kapisi olmasaydi bu islem parseDappTransaction'i ve kapi 7'yi GECIP
    // pencere ACARDI -- test bu yuzden yalniz boyut kapisini tetikler.
    it('kapi 5: MAX_TX_BASE64_LENGTH asilinca TX_DESERIALIZE_FAILED, pahali coz cagrilmadan', async () => {
        const buyuk = asiriBuyukTx(BIZ)
        expect(buyuk.length).toBeGreaterThan(MAX_TX_BASE64_LENGTH)
        const res = await cagir({ transactions: [buyuk], chain: 'solana:mainnet' })
        expect(res.error.data.code).toBe('TX_DESERIALIZE_FAILED')
        expect(openApprovalWindow).not.toHaveBeenCalled()
    })

    // Inceleme Bulgu 2 (Minor): tek karsilastirma `e?.message === 'UNSUPPORTED_TX_VERSION'`
    // uzerine kurulu. Bir yazim hatasi butun v1+ islemleri sessizce
    // TX_DESERIALIZE_FAILED'e dusurur ve kullaniciya YANLIS ceviri gosterilir
    // -- kod hala yesil kalirdi. Bu test o dalin GERCEKTEN tetiklendigini kilitler.
    it('kapi 5: desteklenmeyen surum (0x81) UNSUPPORTED_TX_VERSION doner', async () => {
        const res = await cagir({ transactions: [surumBozukTx(BIZ)], chain: 'solana:mainnet' })
        expect(res.error.data.code).toBe('UNSUPPORTED_TX_VERSION')
        expect(openApprovalWindow).not.toHaveBeenCalled()
    })

    it('kapi 7: anahtarimiz imzaci degilse SOLANA_NOT_A_SIGNER', async () => {
        const res = await cagir({ transactions: [tekImzaliTx(BASKASI)], chain: 'solana:mainnet' })
        expect(res.error.data.code).toBe('SOLANA_NOT_A_SIGNER')
        expect(openApprovalWindow).not.toHaveBeenCalled()
    })

    // K8: base58 buyuk/kucuk harf duyarlidir. Kucultulmus bir adresle eslesme
    // KURULMAMALI -- kurulsaydi bambaska bir anahtarla imza atilirdi.
    it('kapi 7: adres KUCULTULEREK eslestirilmez', async () => {
        localStore.solana_dapps[ORIGIN].address = BIZ.publicKey.toBase58().toLowerCase()
        const res = await cagir({ transactions: [tekImzaliTx(BIZ)], chain: 'solana:mainnet' })
        expect(res.error.data.code).toBe('SOLANA_NOT_A_SIGNER')
        expect(openApprovalWindow).not.toHaveBeenCalled()
    })
})

describe('handleSolanaSignTransaction -- onay kaydi', () => {
    it('tek islem mode sign ile kaydedilir', async () => {
        await cagir({ transactions: [tekImzaliTx(BIZ)], chain: 'solana:mainnet' })

        const [requestId, , kayit] = openApprovalWindow.mock.calls[0]
        expect(requestId).toBe('req-solana-1')
        expect(kayit.type).toBe('SOLANA_SIGN_TX')
        expect(kayit.mode).toBe('sign')
        // resolvePendingRequest (dappFunctions.js) kaydi `id` ile esler; §4.5
        // ise alani `requestId` diye adlandiriyor -- IKISI de yazilir.
        expect(kayit.id).toBe('req-solana-1')
        expect(kayit.requestId).toBe('req-solana-1')
        expect(kayit.origin).toBe(ORIGIN)
        expect(kayit.from).toBe(BIZ.publicKey.toBase58())
        expect(kayit.accountKey).toBe('k1')
        expect(kayit.appMeta).toEqual({ name: 'Jupiter' })
        expect(kayit.transactions).toHaveLength(1)
    })

    // K2: `solana:signAllTransactions` diye bir ozellik YOKTUR; toplu imzalama
    // signTransaction'in degisken argumanli cagrilmasidir.
    it('birden fazla islem mode signAll ile kaydedilir', async () => {
        await cagir({ transactions: [tekImzaliTx(BIZ), tekImzaliTx(BIZ)], chain: 'solana:mainnet' })
        expect(openApprovalWindow.mock.calls[0][2].mode).toBe('signAll')
        expect(openApprovalWindow.mock.calls[0][2].transactions).toHaveLength(2)
    })
})

// C5.3 -- nihai inceleme: hicbir test handleSolanaSignTransaction'i catch
// dalina SURMUYORDU. KAYNAKTAN dogrulandi: bu isleyicinin dis catch'i
// `uygulamaHatasi('SOLANA_SEND_FAILED')` DEGIL jenerik
// `{ error: { code: -32603, message: 'Internal error' } }` doner
// (handleSolanaSignMessage/handleSolanaSignIn'in AKSINE).
describe('handleSolanaSignTransaction -- catch dali', () => {
    it('chrome.storage.local.get FIRLATIRSA jenerik Internal error doner, SIFIR pencere, ham mesaj SIZMAZ', async () => {
        globalThis.chrome.storage.local.get = async () => { throw new Error('secret-ish text') }
        const res = await cagir({ transactions: [tekImzaliTx(BIZ)], chain: 'solana:mainnet' })
        expect(res).toEqual({ error: { code: -32603, message: 'Internal error' } })
        expect(openApprovalWindow).not.toHaveBeenCalled()
        expect(JSON.stringify(res)).not.toContain('secret-ish')
    })
})

describe('handleSolanaSignTransaction -- gonderen kapisi (C1.3)', () => {
    async function cagirWithSender(params, sender) {
        const yanitlar = []
        handleSolanaSignTransaction({ method: 'solana_signTransaction', params: [params] }, sender, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        return yanitlar[0]
    }

    it.each([
        ['ust cerceve DEGIL (frameId 3)', { ...SENDER, frameId: 3 }],
        ['sender.tab YOK', { ...SENDER, tab: undefined }],
        ['http yabanci host (localhost/127.0.0.1 DEGIL)', { ...SENDER, frameId: 0, origin: 'http://app.jup.ag' }],
        ["origin 'null' (sandbox'li cerceve)", { ...SENDER, origin: 'null' }],
        ['file:// semasi', { ...SENDER, origin: 'file:///C:/x.html' }],
    ])('%s -> 4100, SIFIR pencere', async (_ad, gonderen) => {
        const res = await cagirWithSender({ transactions: [tekImzaliTx(BIZ)], chain: 'solana:mainnet' }, gonderen)
        expect(res.error).toEqual({ code: 4100, message: 'Unauthorized.' })
        expect(openApprovalWindow).not.toHaveBeenCalled()
    })

    it.each([
        ['http://localhost', { origin: 'http://localhost:3000', frameId: 0, tab: { id: 9 } }],
        ['http://127.0.0.1', { origin: 'http://127.0.0.1:8080', frameId: 0, tab: { id: 9 } }],
    ])('%s -> kapi GECER, o origin e verilmis oturumla pencere acilir', async (_ad, gonderen) => {
        localStore.solana_dapps = {
            [gonderen.origin]: {
                address: BIZ.publicKey.toBase58(), publicKey: 'ee'.repeat(32), accountKey: 'k1',
                cluster: 'solana:mainnet', appMeta: { name: 'Jupiter' }, connectedAt: 1,
            },
        }
        await cagirWithSender({ transactions: [tekImzaliTx(BIZ)], chain: 'solana:mainnet' }, gonderen)
        expect(openApprovalWindow).toHaveBeenCalledOnce()
        expect(openApprovalWindow.mock.calls[0][2].origin).toBe(gonderen.origin)
    })
})
