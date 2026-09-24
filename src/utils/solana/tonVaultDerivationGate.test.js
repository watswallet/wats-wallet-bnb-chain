import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * TON kasasi Solana anahtar turetmesine ULASAMAZ (spec §8 R1).
 *
 * NEDEN DAGITICIDAN GECMIYORUZ: VITE_SOLANA_ENABLED yayin derlemesinde KAPALI
 * ve background.js:1075 bayrak kapaliyken her SOLANA_* aksiyonunu
 * 'SOLANA_DISABLED' ile reddediyor. vitest.config.js:35 bayragi testlerde
 * 'true'ya ZORLUYOR; o satir bir gun kalkarsa dagiticiya dayanan bir test
 * SESSIZCE anlamsizlasir -- turetme cagrilmadigi icin GECER, oysa olcmek
 * istedigimiz kapi hic denenmemis olur. Bu yuzden:
 *   - dapp cikislari EXPORT EDILMIS fonksiyon olarak DOGRUDAN cagrilir,
 *   - background.js'in iki cikisi (resolveSolanaAddress / sendSolanaTransfer
 *     disari verilmiyor) FONKSIYON GOVDESI taramasiyla kilitlenir.
 *
 * Alti cikisin DORDU deriveSolanaKeypair, IKISI deriveSolanaAddress cagiriyor;
 * asagida ALTISI da dogrudan olculur: background.js'in ikisi govde SIRASI
 * (kapi turetmeden ONCE mi) karsilastirmasiyla, solanaDappFunctions.js'in
 * dordu ise DOGRUDAN cagriyla -- handleSolanaConnectIdentity,
 * handleSolanaDappSignMessage, handleSolanaDappSignTx ('sign' modu) ve
 * signAndSendFromApproval (disari verilmedigi icin handleSolanaDappSignTx'in
 * 'signAndSend' modu UZERINDEN, gercek dagitim yoluyla).
 *
 * SADECE toplu `assertSolanaDerivable(` SAYISI ve `includes(' ')` YOKLUGU
 * YETERSIZDIR: bu ikisi degismeden, kapiyi bir fonksiyon icinde turetme
 * cagrisindan SONRAYA tasiyan bir mutasyon hala 4/2 sayisini ve bos
 * `includes(' ')` aramasini KORUR, ama kapiyi FIILEN etkisiz birakir. Bu
 * yuzden asagida her DOGRUDAN-cagri testi hem POZITIF KONTROL (hd kasa/hesap
 * icin turetme GERCEKTEN cagrilir) hem de NEGATIF olcum (tonMnemonic kasasi
 * icin turetme ve unlockVault HIC cagrilmaz) iceriyor -- ikincisi, kapi
 * turetmeden SONRAYA kaysa yakalanamaz, ta ki turetme mocklu oldugu ve
 * "cagrilmadi" iddiasi tam da o sirayi olctugu icin.
 */

const oku = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const BACKGROUND = oku('../../background.js')
const DAPP = oku('../solanaDappFunctions.js')

// Iddialar DOSYAYA degil FONKSIYON GOVDESINE bakmali: toContain('assertSolanaDerivable')
// import satiriyla da karsilanir, yani asil CAGRIYI silen mutasyon kacardi.
// (Desen: utils/tonAccountLockWiring.test.js)
function govde(kaynak, imza) {
    const bas = kaynak.indexOf(imza)
    if (bas === -1) throw new Error(`bulunamadi: ${imza}`)
    const kalan = kaynak.slice(bas + imza.length)
    // Sinir bir sonraki ust-duzey (girinti YOK) bildirim YA DA yorumdur.
    // Yorum da sayilir: sendSolanaTransfer'dan hemen sonra createTonKeyPair'i
    // aciklayan ust-duzey bir yorum bloğu gelir ve o blok (govde disi, TON'a
    // ait, bu gorevin kapsami disinda) tesadufen eski `includes(' ')`
    // sezgisinden bahsediyor -- yorumu sinirin DISINDA tutmazsak "govde"
    // aslinda fonksiyonun kendisi degil, bir sonraki bildirime kadar her seyi
    // kapsar ve ilgisiz bir yorumu govdeye ait sanabiliriz.
    const son = kalan.search(/\n(?:async function |function |const |export |\/\/|\/\*)/)
    return son === -1 ? kalan : kalan.slice(0, son)
}

describe('background.js -- iki turetme cikisi kasa tipi kapisindan geciyor', () => {
    const RESOLVE = govde(BACKGROUND, 'async function resolveSolanaAddress()')
    const SEND = govde(BACKGROUND, 'async function sendSolanaTransfer(')

    it('resolveSolanaAddress: kapi deriveSolanaAddress ten ONCE', () => {
        const kapi = RESOLVE.indexOf('assertSolanaDerivable(active_account, targetVault)')
        const turet = RESOLVE.indexOf('deriveSolanaAddress(')
        expect(kapi).toBeGreaterThan(-1)
        expect(turet).toBeGreaterThan(kapi)
    })

    // Kapi unlockVault'tan da ONCE: kullanmayacagimiz bir sirri cozmenin sebebi yok.
    it('resolveSolanaAddress: kapi unlockVault tan ONCE', () => {
        const kapi = RESOLVE.indexOf('assertSolanaDerivable(active_account, targetVault)')
        expect(kapi).toBeGreaterThan(-1)
        expect(RESOLVE.indexOf('unlockVault(')).toBeGreaterThan(kapi)
    })

    it('sendSolanaTransfer: kapi deriveSolanaKeypair ten ONCE', () => {
        const kapi = SEND.indexOf('assertSolanaDerivable(active_account, targetVault)')
        const turet = SEND.indexOf('deriveSolanaKeypair(')
        expect(kapi).toBeGreaterThan(-1)
        expect(turet).toBeGreaterThan(kapi)
    })

    // Sezgi GERI GELMEMELI: TON ifadesini BIP39 sayan sey oydu.
    it('iki govdede de includes( ) sezgisi KALMADI', () => {
        expect(RESOLVE).not.toContain("includes(' ')")
        expect(SEND).not.toContain("includes(' ')")
    })

    it('background.js te kapi TAM IKI kez cagriliyor', () => {
        expect((BACKGROUND.match(/assertSolanaDerivable\(/g) || []).length).toBe(2)
    })
})

describe('solanaDappFunctions.js -- dort turetme cikisinin hepsi kapiya bagli', () => {
    it('includes( ) sezgisi dosyada HIC kalmadi', () => {
        expect(DAPP).not.toContain("includes(' ')")
    })

    // Import satiri parantez ICERMEZ, bu yuzden dorde saymaz.
    it('kapi TAM DORT kez cagriliyor', () => {
        expect((DAPP.match(/assertSolanaDerivable\(/g) || []).length).toBe(4)
    })
})

// ---------------------------------------------------------------------------
// DOGRUDAN CAGRI katmani: iki farkli turetme fonksiyonu, iki farkli handler.
// ---------------------------------------------------------------------------

const ORIGIN = 'https://app.jup.ag'
const SENDER = { url: 'chrome-extension://x/' }
const SOL_ADRES = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const PUB_HEX = 'ee'.repeat(32)

// 24 kelime + bosluk: eski `includes(' ')` sezgisini GECERDI. Icerik onemsiz,
// unlockVault mocklu -- onemli olan sekli.
const TON_IFADESI = ('abandon '.repeat(23) + 'about').trim()

// Hesap EVM GORUNUYOR ama kasa TON ifadesi tasiyor: kapinin asil olcumu bu.
const HD_HESAP = { key: 'k1', type: 'hd', index: 0, address: '0xabc' }
const TON_KASALARI = [{ id: 'v1', type: 'tonMnemonic', accounts: [HD_HESAP] }]
const HD_KASALARI = [{ id: 'v1', type: 'hd', accounts: [HD_HESAP] }]
const TON_HESAP = { key: 'k1', type: 'ton', index: 0, address: 'UQBvW8Z5huBkMJYdnfAEM5JqTNkuWX3diqYENkWsIL0XggGG' }

const deriveSolanaAddress = vi.fn()
const deriveSolanaKeypair = vi.fn()
vi.mock('./derive', () => ({
    deriveSolanaAddress: (...a) => deriveSolanaAddress(...a),
    deriveSolanaKeypair: (...a) => deriveSolanaKeypair(...a),
}))
const unlockVault = vi.fn()
vi.mock('../crypto-utils', () => ({ unlockVault: (...a) => unlockVault(...a), decryptSecret: vi.fn() }))

function kurChrome(local = {}, session = {}) {
    const store = { ...local }
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
            session: { get: async (k) => ({ [k]: session[k] }) },
        },
        windows: {
            create: async () => ({ id: 1 }), remove: async () => {}, get: async () => ({}),
            getLastFocused: async () => ({ width: 1200, left: 0, top: 0 }),
            onRemoved: { addListener: () => {} },
        },
        tabs: { query: async () => [], sendMessage: async () => {} },
        runtime: { getURL: (p) => 'chrome-extension://x/' + p },
    }
    return store
}

beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
    unlockVault.mockResolvedValue(TON_IFADESI)
    deriveSolanaAddress.mockResolvedValue({ address: SOL_ADRES, publicKey: PUB_HEX })
    deriveSolanaKeypair.mockResolvedValue({
        publicKey: { toBase58: () => SOL_ADRES },
        secretKey: new Uint8Array(64),
    })
})
afterEach(() => { delete globalThis.chrome })

describe('handleSolanaConnectIdentity -- deriveSolanaAddress cikisi', () => {
    async function kimlik(hesap, kasalar) {
        kurChrome({ vaults: kasalar, active_account: hesap }, { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } })
        const { handleSolanaConnectIdentity } = await import('../solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaConnectIdentity(
            { type: 'SOLANA_CONNECT_IDENTITY', message: { accountKey: 'k1' } },
            SENDER,
            (r) => yanitlar.push(r),
        )
        return yanitlar
    }

    // POZITIF KONTROL: bu olmadan asagidaki iki test, HICBIR SEY YAPMAYAN bir
    // handler'a karsi da GECERDI.
    it('hd kasasindaki hd hesap: adres turetilir', async () => {
        const yanitlar = await kimlik(HD_HESAP, HD_KASALARI)
        expect(yanitlar[0]).toEqual({ success: true, address: SOL_ADRES, publicKey: PUB_HEX })
        expect(deriveSolanaAddress).toHaveBeenCalledOnce()
    })

    it('tonMnemonic kasasi: deriveSolanaAddress CAGRILMAZ, kasa ACILMAZ', async () => {
        const yanitlar = await kimlik(HD_HESAP, TON_KASALARI)
        expect(yanitlar[0]).toEqual({ success: false, error: 'SOLANA_ACCOUNT_UNSUPPORTED' })
        expect(deriveSolanaAddress).not.toHaveBeenCalled()
        expect(unlockVault).not.toHaveBeenCalled()
    })

    // DUZELTILDI (R8, 2026-09-11 koordinatorden -- eski Y2 okumasi geri alindi).
    // Asagidaki iddia eskiden "kasa GERCEKTEN hd ise type:'ton' hesap da Solana
    // turetebilir" diyordu ve bunu Y2 karariyla (ice aktarilan TON hesabinin
    // EVM+Solana kazanmasi) AYNI karar sanmisti. YANLISTI: Y2'nin ice aktarilan/
    // hibrit hesabi `type:'hd'`dir (+ `tonFingerprint`, buildHybridTonAccount,
    // accountKind.js R6) -- `type:'ton'` DEGIL. Kalan `type:'ton'` kayitlar
    // YALNIZCA eski/legacy profiller: kasalari 'tonMnemonic'dir ve icinde
    // BIP-39 sirri hic YOKTUR, yani boyle bir hesabin GERCEKTEN 'hd' bir
    // kasayla eslesmesi bugunku kayitlarda hic OLUSMAZ -- olustuysa bozuk bir
    // kayittir. `isSolanaUnsupportedAccount` artik `type:'ton'`i erken elerdi
    // (accountSupport.js, R8): bu ON KAPI ile alttaki kasa-tipi kapisi
    // (`vault.type !== 'hd'`) ARTIK AYNI CEVABI veriyor -- ikisi de reddeder,
    // hangi kombinasyon olursa olsun. `assertSolanaDerivable`/
    // `accountSupport.test.js` bu kararin TEK kaynagidir; burasi yalnizca
    // DAVRANISI dogruluyor.
    it('legacy type:ton hesap: hesap turu erken elenir, kasa GERCEKTEN hd olsa bile Solana turetilmez', async () => {
        const yanitlar = await kimlik(TON_HESAP, [{ id: 'v1', type: 'hd', accounts: [TON_HESAP] }])
        expect(yanitlar[0]).toEqual({ success: false, error: 'SOLANA_ACCOUNT_UNSUPPORTED' })
        expect(deriveSolanaAddress).not.toHaveBeenCalled()
    })
})

describe('handleSolanaDappSignMessage -- deriveSolanaKeypair cikisi', () => {
    async function imzala(hesap, kasalar) {
        kurChrome(
            { vaults: kasalar, active_account: hesap, solana_dapps: {} },
            { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } },
        )
        const { handleSolanaDappSignMessage } = await import('../solanaDappFunctions.js')
        const yanitlar = []
        handleSolanaDappSignMessage(
            {
                type: 'SOLANA_DAPP_SIGN_MESSAGE',
                message: {
                    mode: 'message', origin: ORIGIN, from: SOL_ADRES,
                    accountKey: 'k1', appMeta: null, message: btoa('merhaba dunya'),
                },
            },
            SENDER,
            (r) => yanitlar.push(r),
        )
        // Govde bir async IIFE: bir makro gorev tum bekleyen mikro gorevleri bosaltir.
        await new Promise((r) => setTimeout(r, 0))
        return yanitlar
    }

    it('tonMnemonic kasasi: deriveSolanaKeypair CAGRILMAZ, kasa ACILMAZ', async () => {
        const yanitlar = await imzala(HD_HESAP, TON_KASALARI)
        expect(yanitlar[0]).toEqual({ success: false, error: 'SOLANA_UNSUPPORTED_ACCOUNT' })
        expect(deriveSolanaKeypair).not.toHaveBeenCalled()
        expect(unlockVault).not.toHaveBeenCalled()
    })
})

// Icerigi ONEMSIZ: her iki asagidaki testte de kapi (assertSolanaDerivable ya
// da onun ONCESINDEki icerik-baglama kilidi) turetmeden ONCE calisir --
// parseDappTransaction bu baytlara HIC BAKILMADAN once devreye giremez.
const SAHTE_TX_B64 = 'dGVzdC1pc2xlbQ=='

describe('handleSolanaDappSignTx -- deriveSolanaKeypair cikisi ("sign" yolu)', () => {
    const REQUEST_ID = 'req-locktest-sign'

    async function imzala(hesap, kasalar) {
        kurChrome(
            {
                vaults: kasalar,
                active_account: hesap,
                solana_dapps: { [ORIGIN]: { address: SOL_ADRES, accountKey: 'k1' } },
                // Icerik baglama kilidi (task-30 incelemesi Bulgu 2): bu kayit
                // olmadan handleSolanaDappSignTx assertSolanaDerivable'a hic
                // ULASAMAZ, SOLANA_DAPP_FROM_MISMATCH'te durur -- test o zaman
                // kapiyi degil, BASKA bir kilidi olcmus olurdu.
                current_request: { type: 'SOLANA_SIGN_TX', requestId: REQUEST_ID, origin: ORIGIN, transactions: [SAHTE_TX_B64] },
            },
            { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } },
        )
        const { handleSolanaDappSignTx } = await import('../solanaDappFunctions.js')
        const yanitlar = []
        // handleSolanaDappSignTx'in "sign" dali GOVDENIN KENDISI (ayri bir IIFE
        // degil), yani onu await etmek sendResponse cagrilana kadar bekler.
        await handleSolanaDappSignTx(
            {
                type: 'SOLANA_DAPP_SIGN_TX',
                message: { transactions: [SAHTE_TX_B64], origin: ORIGIN, from: SOL_ADRES, requestId: REQUEST_ID },
            },
            SENDER,
            (r) => yanitlar.push(r),
        )
        return yanitlar
    }

    // POZITIF KONTROL: sahte islem baytlari parseDappTransaction'da patlayacagi
    // icin nihai yanitin BASARILI olmasi beklenmiyor -- olculen tek sey,
    // turetmenin gercekten DENENDIGI (kapi turetmeden SONRAYA kaysa da, ONCEYE
    // kalsa da bu tek basina GECERDI; asil olcum asagidaki NEGATIF testte).
    it('hd kasasindaki hd hesap: deriveSolanaKeypair CAGRILIR', async () => {
        await imzala(HD_HESAP, HD_KASALARI)
        expect(deriveSolanaKeypair).toHaveBeenCalledOnce()
    })

    // ASIL OLCUM: kapi turetmeden ONCE olmasaydi, tonMnemonic kasasi ACILIR ve
    // deriveSolanaKeypair CAGRILIRDI (sahte baytlar ancak ONDAN SONRA patlar).
    it('tonMnemonic kasasi: deriveSolanaKeypair CAGRILMAZ, kasa ACILMAZ', async () => {
        const yanitlar = await imzala(HD_HESAP, TON_KASALARI)
        expect(yanitlar[0]).toEqual({ success: false, error: 'SOLANA_UNSUPPORTED_ACCOUNT' })
        expect(deriveSolanaKeypair).not.toHaveBeenCalled()
        expect(unlockVault).not.toHaveBeenCalled()
    })
})

describe('signAndSendFromApproval -- deriveSolanaKeypair cikisi (disari verilmez, handleSolanaDappSignTx "signAndSend" modu uzerinden)', () => {
    const REQUEST_ID = 'req-locktest-signandsend'

    async function gonder(hesap, kasalar) {
        kurChrome(
            {
                vaults: kasalar,
                active_account: hesap,
                solana_dapps: { [ORIGIN]: { address: SOL_ADRES, accountKey: 'k1' } },
                current_request: {
                    type: 'SOLANA_SIGN_TX', mode: 'signAndSend', requestId: REQUEST_ID, origin: ORIGIN,
                    accountKey: 'k1', from: SOL_ADRES, transactions: [SAHTE_TX_B64],
                },
            },
            { sessionMasterKeyJwk: { kty: 'oct', k: 'x' } },
        )
        const { handleSolanaDappSignTx } = await import('../solanaDappFunctions.js')
        const yanitlar = []
        // handleSolanaDappSignTx 'signAndSend' modunda signAndSendFromApproval'i
        // AWAIT ETMEDEN baslatir (govdesi "fire-and-forget"): bir makro gorev
        // tum bekleyen mikro gorevleri bosaltir (Desen: handleSolanaDappSignMessage,
        // yukarida).
        handleSolanaDappSignTx(
            { type: 'SOLANA_DAPP_SIGN_TX', requestId: REQUEST_ID, mode: 'signAndSend' },
            SENDER,
            (r) => yanitlar.push(r),
        )
        await new Promise((r) => setTimeout(r, 0))
        return yanitlar
    }

    // POZITIF KONTROL: brief'in Dogrulanan gercek #4'unun kapattigi tam bu yol
    // -- ONCEDEN burada hicbir hesap kapisi yoktu. Sahte islem baytlari
    // parseDappTransaction'da patlayacagi icin nihai yanit basarili degildir;
    // olculen turetmenin DENENDIGI.
    it('hd kasasindaki hd hesap: deriveSolanaKeypair CAGRILIR', async () => {
        await gonder(HD_HESAP, HD_KASALARI)
        expect(deriveSolanaKeypair).toHaveBeenCalledOnce()
    })

    // ASIL OLCUM: kapi assertSolanaDerivable(account, targetVault) yerine
    // deriveSolanaKeypair(...)'DAN SONRAYA kaysa bu test BASARISIZ olurdu --
    // sahte baytlar ancak keypair turetildikten SONRA patlar.
    it('tonMnemonic kasasi: deriveSolanaKeypair CAGRILMAZ, kasa ACILMAZ', async () => {
        const yanitlar = await gonder(HD_HESAP, TON_KASALARI)
        expect(yanitlar[0]).toEqual({ error: 'SOLANA_ACCOUNT_UNSUPPORTED' })
        expect(deriveSolanaKeypair).not.toHaveBeenCalled()
        expect(unlockVault).not.toHaveBeenCalled()
    })
})

// ---------------------------------------------------------------------------
// Receive.vue'nun yerel kopyasi kalkti.
//
// O kopya bu gorevden ONCE kullaniciyi TON->Solana turetmesinden koruyan TEK
// kapiydi ve kendi yorumu (Receive.vue:292) "kural accountSupport.js'e
// TASINMALI" diyordu. Tasindi. Iki kopya birakmak, birinin gun gelip otekinden
// AYRISMASI demektir -- bu dosyanin ustundeki "kural TEK YERDE" sozlesmesinin
// tam ihlali.
//
// Iddia DOSYAYA degil COMPUTED GOVDESINE bakar. Gorev 4 (accountKindOf/
// isTonOnlyAccount temizligi, 2026-09-10) o sembolu TUM kod tabanindan kaldirdi;
// Receive.vue'da evmSupported/evmAddress icin de kullaniliyordu (:322-323).
//
// GUNCELLEME (inceleme turu 2, Critical 1): ilk ceviri dogrudan
// `account.type === 'ton'` esitligiydi ve `activeAccount` henuz `null`ken
// (yerel ref, onMounted'da asenkron dolar) `user.address`i (Pinia store'dan
// HEMEN hazir) SIZDIRIYORDU. Duzeltme `activeAccount.value &&
// accountHasEvm(activeAccount.value)` guard'ina gecti -- `accountHasEvm`
// (accountKind.js, inceleme turu 2'de duzeltildi: eski/legacy `type:'ton'`
// icin fail-closed `false` doner) hem dogru soruyu soruyor hem `null`
// durumunda KOSULSUZ `null` donduruyor.
// ---------------------------------------------------------------------------
describe('Receive.vue -- Solana kurali yalnizca accountSupport tan okunur', () => {
    const RECEIVE = oku('../../components/popups/Receive.vue')

    function computedGovdesi(kaynak, imza) {
        const bas = kaynak.indexOf(imza)
        if (bas === -1) throw new Error(`bulunamadi: ${imza}`)
        const kalan = kaynak.slice(bas)
        const son = kalan.indexOf('\n})')
        return son === -1 ? kalan : kalan.slice(0, son)
    }

    const SOLANA_SUPPORTED = computedGovdesi(RECEIVE, 'const solanaSupported = computed(')

    it('solanaSupported yalnizca isSolanaUnsupportedAccount a bakar', () => {
        expect(SOLANA_SUPPORTED).toContain('isSolanaUnsupportedAccount(account)')
        expect(SOLANA_SUPPORTED).not.toContain('isTonOnlyAccount')
    })

    // EVM satiri kurali AYRI bir sorudur ve TASINMADI, ama SEMBOLU degisti:
    // isTonOnlyAccount artik hicbir yerde yok.
    // 2026-09-11: `accountHasEvm` FAIL-CLOSED'dir ve `type` alani olmayan ESKI bir
    // kayitta `false` donuyordu -- EVM satiri tumden kalkiyor, kullanici kendi
    // alis adresini goremiyor, QR bos kaliyordu. Ayni hesap icin Header.vue
    // adresi GOSTERIYORDU; iki ekran celisiyordu (final inceleme bulgusu).
    // Ikisi artik AYNI fail-open fonksiyonu soruyor: `accountShowsEvmRow`.
    it('evmSupported/evmAddress GORUNUM sorusunu sorar (accountShowsEvmRow)', () => {
        expect(RECEIVE).not.toContain('isTonOnlyAccount')
        expect(RECEIVE).toContain('evmSupported: accountShowsEvmRow(activeAccount.value)')
        expect(RECEIVE).toContain('accountShowsEvmRow(activeAccount.value) ? user.address : null')
    })
})
