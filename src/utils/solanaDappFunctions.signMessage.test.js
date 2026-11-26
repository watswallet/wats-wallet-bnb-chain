// client/src/utils/solanaDappFunctions.signMessage.test.js
//
// KOK NEDEN: §4.3.1'in kapilarinin TAMAMI onay penceresi ACILMADAN once
// calismak zorunda. Bir kapi pencereden SONRAYA kayarsa kullanici imzalayamaz
// bir seyi onaylar, imza aninda patlar ve dapp'in promise'i asili kalir --
// bu yuzden HER red testinde ayrica "sifir pencere" iddiasi var.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import nacl from 'tweetnacl'
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, TransactionMessage, AddressLookupTableAccount } from '@solana/web3.js'

// GERCEK bir ed25519 cifti. Imza, uretim kodunun signMessageBytes'i yeniden
// cagrilarak degil, BAGIMSIZ bir dogrulayiciyla (nacl.sign.detached.verify)
// olculur -- aksi halde iki taraf AYNI hatayi yaptiginda test yesil kalirdi.
const CIFT = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(7))
const ADRES = new PublicKey(CIFT.publicKey).toBase58()
const YABANCI = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const ORIGIN = 'https://app.jup.ag'
const SENDER = { origin: ORIGIN, frameId: 0, tab: { id: 3, favIconUrl: ORIGIN + '/f.ico' } }
const OTURUM = {
    address: ADRES, publicKey: '07'.repeat(32), accountKey: 'k1',
    cluster: 'solana:mainnet', appMeta: { name: 'Jupiter' }, connectedAt: 1,
}
const HESAP = { key: 'k1', address: '0xabc', type: 'hd', index: 0 }
const VAULTS = [{ id: 'v1', type: 'hd', accounts: [HESAP] }]
const MESAJ_B64 = btoa('merhaba dunya')

// GERCEK bir islem bayt vektoru: uydurma baytlar looksLikeTransaction'in
// gercekten calistigini KANITLAMAZ (kapi 6, Solana'nin en bilinen signMessage
// saldirisi -- mesaj susu verilmis islemi kor imzalatmak).
const ISLEM_B64 = (() => {
    const tx = new Transaction({ feePayer: new PublicKey(ADRES), recentBlockhash: '11111111111111111111111111111111' })
    tx.add(SystemProgram.transfer({ fromPubkey: new PublicKey(ADRES), toPubkey: new PublicKey(YABANCI), lamports: 1 }))
    return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
})()

vi.mock('./solana/derive', () => ({
    deriveSolanaKeypair: vi.fn(async () => ({ publicKey: new PublicKey(CIFT.publicKey), secretKey: CIFT.secretKey })),
    deriveSolanaAddress: vi.fn(),
}))
vi.mock('./crypto-utils', () => ({
    unlockVault: vi.fn(async () => 'abandon abandon abandon about'),
    decryptSecret: vi.fn(),
}))
// buildSiwsMessage GERCEK KALIR (validateSiwsInput de oyle) -- yalnizca bir
// CAGRI-SAYACI vi.fn ile SARILIR. Asagidaki "erken kapi" testleri bunun HIC
// CAGRILMADIGINI kanitlar: eski sirada (govde kurulup SONRA boyut kontrol
// edilirdi) bu fonksiyon devasa girdilerde de cagrilirdi.
vi.mock('./solana/siwsMessage', async (importOriginal) => {
    const gercek = await importOriginal()
    return { ...gercek, buildSiwsMessage: vi.fn(gercek.buildSiwsMessage) }
})

function kurChrome(local = {}) {
    const store = {
        solana_dapps: { [ORIGIN]: OTURUM },
        vaults: VAULTS,
        active_account: { key: 'k1', type: 'hd', index: 0, solanaAddress: ADRES },
        ...local,
    }
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
            session: { get: async () => ({ sessionMasterKeyJwk: { kty: 'oct', k: 'x' } }) },
        },
        windows: {
            create: async (o) => { acilanPencereler.push(o); return { id: acilanPencereler.length } },
            remove: async () => {}, get: async () => ({}),
            getLastFocused: async () => ({ width: 1200, left: 0, top: 0 }),
            onRemoved: { addListener: () => {} },
        },
        tabs: { sendMessage: async () => {} },
        runtime: { getURL: (p) => 'chrome-extension://x/' + p },
    }
    return { store, acilanPencereler }
}

const istek = (params) => ({ method: 'solana_signMessage', params: [params] })

beforeEach(() => {
    vi.resetModules()
    // vi.resetModules() modul KAYDINI temizler, ama vi.mock fabrikasinin
    // ONCEDEN urettigi sahte nesne (buildSiwsMessage spy'i dahil) TESTLER
    // ARASINDA AYNI kalir -- fabrika bir daha calismaz. clearAllMocks bu
    // spy'in cagri GECMISINI sifirlar (uygulamasini DEGISTIRMEZ), aksi halde
    // "erken kapi" testleri onceki testin buildSiwsMessage cagrisini
    // gorup YANLIS BASARISIZ olurdu.
    vi.clearAllMocks()
    globalThis.crypto.subtle.importKey = vi.fn(async () => ({}))
})
afterEach(() => { delete globalThis.chrome; vi.unstubAllGlobals() })

describe('handleSolanaSignMessage -- §4.3.1 kapilari (hepsi PENCERE ACILMADAN)', () => {
    it('kapi 2: oturum yoksa 4100 ve SIFIR pencere', async () => {
        const { acilanPencereler } = kurChrome({ solana_dapps: {} })
        const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignMessage(istek({ message: MESAJ_B64, account: ADRES }), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error.code).toBe(4100)
        expect(acilanPencereler.length).toBe(0)
    })

    // Task 55 fix turu 1 (G1): handleSolanaSignTransaction (:633) ve
    // handleSolanaSignAndSend (:873) K10 askiya alma kapisini ZATEN
    // uyguluyordu, handleSolanaSignMessage UYGULAMIYORDU -- hesap
    // degistirildikten sonra dapp signMessage onay penceresi acabiliyor ve
    // ESKI hesap (session.accountKey) imzalayabiliyordu.
    it('kapi 2 (K10): aktif hesap degisince 4100 ve SIFIR pencere', async () => {
        // structuredClone: OTURUM'un KENDISI degil bir ANLIK GORUNTUSU
        // saklanir -- `toEqual(OTURUM)` ayni referansla karsilastirirsa
        // yerinde (in-place) bir migrasyon/mutasyon fark edilmez.
        const anlik = structuredClone(OTURUM)
        const { store, acilanPencereler } = kurChrome({ active_account: { key: 'k2', type: 'hd', index: 1 } })
        const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignMessage(istek({ message: MESAJ_B64, account: ADRES }), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error.code).toBe(4100)
        expect(acilanPencereler.length).toBe(0)
        // Oturum SILINMEZ/TASINMAZ: kullanici eski hesaba (k1) donerse
        // kendiliginden yeniden gecerli olur (K10).
        expect(store.solana_dapps[ORIGIN]).toEqual(anlik)
        expect(store.solana_dapps[ORIGIN].accountKey).toBe('k1')
    })

    it('kapi 2 (K10): eski hesaba donunce oturum kendiliginden gecer', async () => {
        // active_account KASITLI OLARAK solanaAddress TASIMAZ: kapi ADRES
        // karsilastirmasi (session.address vs active_account.solanaAddress)
        // DEGIL, ANAHTAR karsilastirmasi (session.accountKey vs
        // active_account.key) yapiyorsa BILE bu test gecmelidir -- aksi halde
        // adres-tabanli bir kapi mutasyonu bu testi YAKALAMAZ.
        const { acilanPencereler } = kurChrome({ active_account: { key: 'k1', type: 'hd', index: 0 } })
        const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignMessage(istek({ message: MESAJ_B64, account: ADRES }), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar.length).toBe(0)
        expect(acilanPencereler.length).toBe(1)
    })

    it('kapi 2 (K10): active_account HIC yoksa (undefined) 4100', async () => {
        const { acilanPencereler } = kurChrome({ active_account: undefined })
        const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignMessage(istek({ message: MESAJ_B64, account: ADRES }), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error.code).toBe(4100)
        expect(acilanPencereler.length).toBe(0)
    })

    it.each([
        // [ad, istek yuku, store ustyazimi, beklenen data.code]
        ['kapi 3 -- ed25519 uretemeyen hesap', { message: MESAJ_B64 },
            { vaults: [{ id: 'v1', accounts: [{ ...HESAP, type: 'imported' }] }] }, 'SOLANA_ACCOUNT_UNSUPPORTED'],
        ['kapi 4 -- mainnet disi cluster', { message: MESAJ_B64, chain: 'solana:devnet' }, {}, 'SOLANA_WRONG_CLUSTER'],
        ['kapi 5 -- cozulemeyen base64', { message: '@@@ bu base64 degil @@@' }, {}, 'TX_DESERIALIZE_FAILED'],
        ['kapi 5 -- boyut siniri', { message: btoa('a'.repeat(9000)) }, {}, 'SOLANA_MESSAGE_TOO_LARGE'],
        ['kapi 6 -- islem sekilli baytlar', { message: ISLEM_B64 }, {}, 'SOLANA_MESSAGE_LOOKS_LIKE_TX'],
    ])('%s reddedilir, SIFIR pencere', async (_ad, yuk, ustyazim, kod) => {
        const { acilanPencereler } = kurChrome(ustyazim)
        const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignMessage(istek(yuk), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error.data.code).toBe(kod)
        expect(acilanPencereler.length).toBe(0)
    })

    it('gecerli mesaj SOLANA_SIGN_MESSAGE penceresi acar, kayit mode message tasir', async () => {
        const { store, acilanPencereler } = kurChrome()
        const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
        await handleSolanaSignMessage(istek({ message: MESAJ_B64, display: 'utf8' }), SENDER, () => {})
        await new Promise((r) => setTimeout(r, 0))
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.type).toBe('SOLANA_SIGN_MESSAGE')
        expect(store.current_request.mode).toBe('message')
        expect(store.current_request.origin).toBe(ORIGIN)
        expect(store.current_request.from).toBe(ADRES)
        expect(store.current_request.accountKey).toBe('k1')
        expect(store.current_request.message).toBe(MESAJ_B64)
        expect(store.current_request.display).toBe('utf8')
    })

    // C1.4 -- RAW base64 uzunlugu, `base64Coz` (atob) COZMEDEN once denetlenir.
    // `atob` BOSLUK karakterlerini SESSIZCE atar: 2.000.000 bosluk + gecerli
    // kucuk bir base64 kuyrugu COZULEN baytlarda kucuk kalir, yani yalniz
    // cozulmus uzunlugu olcen kapi 5 (mesajYukKapisi) bunu YAKALAYAMAZ.
    it('C1.4: bosluklu devasa ham dize (atob KISALTIR) RAW uzunlukta reddedilir, current_request YAZILMAZ', async () => {
        const { store, acilanPencereler } = kurChrome()
        const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignMessage(istek({ message: ' '.repeat(2_000_000) + MESAJ_B64 }), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error.data.code).toBe('SOLANA_MESSAGE_TOO_LARGE')
        expect(acilanPencereler.length).toBe(0)
        expect(store.current_request).toBeUndefined()
    })

    // C1.4 -- sinirli alan: `display` sayfadan gelir, 'hex' DISINDA HERHANGI
    // bir deger (buyuk bir nesne dahil) onay ekraninda 'utf8' GIBI islenir.
    it('C1.4: display sinirli iki degerden birine SIKISTIRILIR ("hex" DISI -> "utf8")', async () => {
        const { store, acilanPencereler } = kurChrome()
        const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
        await handleSolanaSignMessage(istek({ message: MESAJ_B64, display: { huge: 'x'.repeat(1e6) } }), SENDER, () => {})
        await new Promise((r) => setTimeout(r, 0))
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.display).toBe('utf8')
    })
})

describe('handleSolanaSignMessage -- gonderen kapisi (C1.3)', () => {
    it.each([
        ['ust cerceve DEGIL (frameId 3)', { ...SENDER, frameId: 3 }],
        ['sender.tab YOK', { ...SENDER, tab: undefined }],
        ['http yabanci host (localhost/127.0.0.1 DEGIL)', { ...SENDER, frameId: 0, origin: 'http://app.jup.ag' }],
        ["origin 'null' (sandbox'li cerceve)", { ...SENDER, origin: 'null' }],
        ['file:// semasi', { ...SENDER, origin: 'file:///C:/x.html' }],
    ])('%s -> 4100, SIFIR pencere, kayit DEGISMEZ', async (_ad, gonderen) => {
        const { store, acilanPencereler } = kurChrome()
        const oncesi = structuredClone(store.solana_dapps)
        const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignMessage(istek({ message: MESAJ_B64 }), gonderen, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error).toEqual({ code: 4100, message: 'Unauthorized.' })
        expect(acilanPencereler.length).toBe(0)
        expect(store.solana_dapps).toEqual(oncesi)
        expect(store.current_request).toBeUndefined()
    })

    it.each([
        ['http://localhost', { origin: 'http://localhost:3000', frameId: 0, tab: { id: 3 } }],
        ['http://127.0.0.1', { origin: 'http://127.0.0.1:8080', frameId: 0, tab: { id: 3 } }],
    ])('%s -> kapi GECER, o origin e verilmis oturumla pencere acilir', async (_ad, gonderen) => {
        const { store, acilanPencereler } = kurChrome({ solana_dapps: { [gonderen.origin]: OTURUM } })
        const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
        await handleSolanaSignMessage(istek({ message: MESAJ_B64 }), gonderen, () => {})
        await new Promise((r) => setTimeout(r, 0))
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.origin).toBe(gonderen.origin)
    })
})

describe('handleSolanaSignIn -- kapi 2 UYGULANMAZ, kapi 9 UYGULANIR', () => {
    const siwsIstegi = (input) => ({ method: 'solana_signIn', params: [{ input }] })

    it('oturum YOKKEN de pencere acar ve domain gercek origin ile EZILIR', async () => {
        // Kapi 2 signIn'e uygulansaydi SIWS'in tum amaci (connect + signMessage
        // TEK adimda) calismazdi: her ilk giris 4100 alirdi.
        const { store, acilanPencereler } = kurChrome({ solana_dapps: {} })
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        await handleSolanaSignIn(siwsIstegi({ domain: 'phishing.example', statement: 'Giris yap' }), SENDER, () => {})
        await new Promise((r) => setTimeout(r, 0))
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.mode).toBe('signIn')
        expect(store.current_request.signInInput.domain).toBe('app.jup.ag')
        // Imzalanacak metin ARKA PLANDA kuruldu: sayfanin verdigi ham metin
        // degil, ezilmis domain'li EIP-4361 govdesi.
        expect(atob(store.current_request.message)).toContain('app.jup.ag')
    })

    // C1.1 -- nihai inceleme ruling A: signIn KAPI 2'yi (spec 3.4) UYGULAMAZ ama
    // oturum VARSA (dapp DAHA ONCE connect ile baglanmis) ve aktif hesap o
    // oturumun SABITLENDIGI hesaptan FARKLIYSA, signMessage'daki AYNI K10
    // askiya alma burada da PENCEREDEN ONCE gecerlidir -- onay tarafindaki
    // kilit (handleSolanaDappSignMessage) AYNI bayat kaydi karsilastirdigi
    // icin TEK BASINA YETMEZ.
    it('kapi 2 (K10): oturumlu origin, aktif hesap degisince 4100 ve SIFIR pencere', async () => {
        const { store, acilanPencereler } = kurChrome({ active_account: { key: 'k2', type: 'hd', index: 1 } })
        const anlik = structuredClone(OTURUM)
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignIn(siwsIstegi({}), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error).toEqual({ code: 4100, message: 'Unauthorized.' })
        expect(acilanPencereler.length).toBe(0)
        // Kayit SILINMEZ/DEGISMEZ: kullanici eski hesaba (k1) donerse
        // kendiliginden yeniden gecerli olur (K10).
        expect(store.solana_dapps[ORIGIN]).toEqual(anlik)
        expect(store.current_request).toBeUndefined()
    })

    it('kapi 2 (K10): active_account HIC yoksa (undefined) oturumlu origin 4100 alir', async () => {
        const { store, acilanPencereler } = kurChrome({ active_account: undefined })
        // F4 (fix turu 1): red durumunda depoya HIC dokunulmadigini da
        // kanitlar -- yalniz yanit kodunu degil.
        const oncesi = structuredClone(store.solana_dapps)
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignIn(siwsIstegi({}), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error).toEqual({ code: 4100, message: 'Unauthorized.' })
        expect(acilanPencereler.length).toBe(0)
        expect(store.solana_dapps).toEqual(oncesi)
        expect(store.current_request).toBeUndefined()
    })

    it('kapi 2 (K10): oturumun accountKey i aktif hesapla ESLESIRSE pencere acilir', async () => {
        // kurChrome varsayilani zaten active_account.key === 'k1' === session.accountKey.
        const { store, acilanPencereler } = kurChrome()
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignIn(siwsIstegi({}), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar.length).toBe(0)
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.accountKey).toBe('k1')
    })

    it('kapi 9 -- yabanci address ile SOLANA_SIGNIN_ADDRESS_MISMATCH, SIFIR pencere', async () => {
        const { acilanPencereler } = kurChrome()
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignIn(siwsIstegi({ address: YABANCI }), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error.data.code).toBe('SOLANA_SIGNIN_ADDRESS_MISMATCH')
        expect(acilanPencereler.length).toBe(0)
    })

    // ADI BILEREK "kapi 5": iddia edilen kod SOLANA_MESSAGE_TOO_LARGE, yani
    // BOYUT kapisidir. Kapi 6 (SOLANA_MESSAGE_LOOKS_LIKE_TX) signIn yolunda
    // YAPISAL OLARAK tetiklenemez -- imzalanan govdeyi CUZDAN kuruyor ve ilk
    // bayt her zaman domain'in ilk harfidir; gerekcesi handleSolanaSignIn
    // icindeki yorumda yazili. Testi "kapi 6" diye adlandirmak, spesifikasyonun
    // 4.3.1 tablosundaki dolu hucreyi kanitlanmis gosterirdi -- oysa kanit
    // yapisaldir, iddia degil.
    it('kapi 5 signIn icin de calisir (boyut siniri)', async () => {
        const { acilanPencereler } = kurChrome()
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        // statement'a islem baytlarinin metin karsiligini gommek yetmez; kapi
        // KURULAN mesajin baytlarina bakar -- mesaji SIWS govdesi yaptigimiz
        // icin kapi 5/6 zinciri yine calisir ve BOYUT siniri asilir.
        await handleSolanaSignIn(siwsIstegi({ statement: 'a'.repeat(9000) }), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error.data.code).toBe('SOLANA_MESSAGE_TOO_LARGE')
        expect(acilanPencereler.length).toBe(0)
    })

    // ERKEN KAPI (siwsMessage.js icindeki rawFieldsLength): gate 2 signIn'e
    // UYGULANMADIGI icin buraya BAGLANTISIZ herhangi bir origin erisebilir.
    // Eski sirada govde ONCE kurulur (buildSiwsMessage + TextEncoder), boyut
    // kontrolu SONRA calisirdi -- paylasilan arka plan servis calisanini
    // sayfa kontrolundeki sinirsiz bir dizeyle mesgul ederdi. Asagidaki iki
    // test SADECE hata kodunu degil, buildSiwsMessage'in HIC CAGRILMADIGINI
    // da kanitlar -- eski sirada bu sahte (spy'lanmis) fonksiyon YINE cagrilir
    // ve testler KIRILIRDI.
    it('erken kapi -- devasa statement buildSiwsMessage cagrilmadan reddedilir', async () => {
        const { acilanPencereler } = kurChrome()
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        const { buildSiwsMessage } = await import('./solana/siwsMessage.js')
        const yanitlar = []
        await handleSolanaSignIn(siwsIstegi({ statement: 'a'.repeat(50_000) }), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error.data.code).toBe('SOLANA_MESSAGE_TOO_LARGE')
        expect(acilanPencereler.length).toBe(0)
        expect(buildSiwsMessage).not.toHaveBeenCalled()
    })

    it('erken kapi -- tek tek kucuk ama toplamda devasa resources buildSiwsMessage cagrilmadan reddedilir', async () => {
        const { acilanPencereler } = kurChrome()
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        const { buildSiwsMessage } = await import('./solana/siwsMessage.js')
        const yanitlar = []
        const resources = Array.from({ length: 2000 }, (_, i) => `https://example.com/kaynak/${i}`)
        await handleSolanaSignIn(siwsIstegi({ resources }), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error.data.code).toBe('SOLANA_MESSAGE_TOO_LARGE')
        expect(acilanPencereler.length).toBe(0)
        expect(buildSiwsMessage).not.toHaveBeenCalled()
    })

    // 2. TUR BULGUSU: rawFieldsLength yalnizca DIZGELERI olcuyordu; bir DIZI
    // ya da NESNE toplama 0 katkiyla SESSIZCE geciyordu. buildSiwsMessage
    // sablon enterpolasyonuyla (`${i.statement}`) toString()'i tetikler --
    // bir dizi icin bu virgullu birlestirmedir (Array.prototype.toString) ve
    // govde, ESKI kodda TAM DA bu yuzden KURULUP SONRA reddediliyordu. Asagidaki
    // iki test buildSiwsMessage'in HIC CAGRILMADIGINI kanitlar.
    it('erken kapi -- dizi seklindeki (dizge disi) statement buildSiwsMessage cagrilmadan reddedilir', async () => {
        const { acilanPencereler } = kurChrome()
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        const { buildSiwsMessage } = await import('./solana/siwsMessage.js')
        const yanitlar = []
        await handleSolanaSignIn(
            siwsIstegi({ statement: Array.from({ length: 5000 }, () => 'a') }),
            SENDER, (r) => yanitlar.push(r)
        )
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error.data.code).toBe('SOLANA_MESSAGE_TOO_LARGE')
        expect(acilanPencereler.length).toBe(0)
        expect(buildSiwsMessage).not.toHaveBeenCalled()
    })

    // GENELLIK + NESNE VARYANTI: statement'a OZEL bir kural degil (baska bir
    // alan, nonce) ve DIZI DEGIL bir NESNE de (toString'i farkli davranir,
    // "[object Object]" sabit dizesi -- yine de TIP GUVENLIGI ihlalidir).
    it('erken kapi -- nesne seklindeki (dizge disi) nonce buildSiwsMessage cagrilmadan reddedilir', async () => {
        const { acilanPencereler } = kurChrome()
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        const { buildSiwsMessage } = await import('./solana/siwsMessage.js')
        const yanitlar = []
        await handleSolanaSignIn(
            siwsIstegi({ nonce: { zararli: 'x'.repeat(100) } }),
            SENDER, (r) => yanitlar.push(r)
        )
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error.data.code).toBe('SOLANA_MESSAGE_TOO_LARGE')
        expect(acilanPencereler.length).toBe(0)
        expect(buildSiwsMessage).not.toHaveBeenCalled()
    })

    // C1.4 -- signIn KAPI 2'yi (spec 3.4) UYGULAMADIGI icin appMeta BAGLANMAMIS
    // bir origin'den de gelebilir; connect'in clampAppMeta(params.appMeta)
    // ile AYNI sinir burada da zorlanir.
    it('C1.4: appMeta uzunlugu SINIRLANIR (oturum YOKKEN)', async () => {
        const { store } = kurChrome({ solana_dapps: {} })
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        await handleSolanaSignIn(
            { method: 'solana_signIn', params: [{ input: {}, appMeta: { name: 'a'.repeat(200), icon: 'b'.repeat(1000), extra: 1, nested: {} } }] },
            SENDER, () => {},
        )
        await new Promise((r) => setTimeout(r, 0))
        expect(store.current_request.appMeta).toEqual({ name: 'a'.repeat(64), icon: 'b'.repeat(512) })
    })

    it('C1.4: appMeta nesne DEGILSE null a duser', async () => {
        const { store } = kurChrome({ solana_dapps: {} })
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        await handleSolanaSignIn(
            { method: 'solana_signIn', params: [{ input: {}, appMeta: 'string' }] },
            SENDER, () => {},
        )
        await new Promise((r) => setTimeout(r, 0))
        expect(store.current_request.appMeta).toBeNull()
    })

    it('C1.4: oturum VARSA session appMeta si KAZANIR (sayfanin verdigi appMeta yoksayilir)', async () => {
        // kurChrome varsayilani: solana_dapps[ORIGIN] = OTURUM (appMeta: { name: 'Jupiter' }).
        const { store } = kurChrome()
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        await handleSolanaSignIn(
            { method: 'solana_signIn', params: [{ input: {}, appMeta: { name: 'baska-bir-ad' } }] },
            SENDER, () => {},
        )
        await new Promise((r) => setTimeout(r, 0))
        expect(store.current_request.appMeta).toEqual(OTURUM.appMeta)
    })
})

describe('handleSolanaSignIn -- gonderen kapisi (C1.3)', () => {
    const siwsIstegi = (input) => ({ method: 'solana_signIn', params: [{ input }] })

    it.each([
        ['ust cerceve DEGIL (frameId 3)', { ...SENDER, frameId: 3 }],
        ['sender.tab YOK', { ...SENDER, tab: undefined }],
        ['http yabanci host (localhost/127.0.0.1 DEGIL)', { ...SENDER, frameId: 0, origin: 'http://app.jup.ag' }],
        ["origin 'null' (sandbox'li cerceve)", { ...SENDER, origin: 'null' }],
        ['file:// semasi', { ...SENDER, origin: 'file:///C:/x.html' }],
    ])('%s -> 4100, SIFIR pencere, kayit DEGISMEZ', async (_ad, gonderen) => {
        const { store, acilanPencereler } = kurChrome({ solana_dapps: {} })
        const oncesi = structuredClone(store.solana_dapps)
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignIn(siwsIstegi({}), gonderen, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error).toEqual({ code: 4100, message: 'Unauthorized.' })
        expect(acilanPencereler.length).toBe(0)
        expect(store.solana_dapps).toEqual(oncesi)
        expect(store.current_request).toBeUndefined()
    })

    it('http://localhost -> kapi GECER, domain host ile EZILIR ve pencere acilir', async () => {
        const gonderen = { origin: 'http://localhost:3000', frameId: 0, tab: { id: 3 } }
        const { store, acilanPencereler } = kurChrome({ solana_dapps: {} })
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        await handleSolanaSignIn(siwsIstegi({}), gonderen, () => {})
        await new Promise((r) => setTimeout(r, 0))
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.origin).toBe('http://localhost:3000')
    })
})

describe('handleSolanaDappSignMessage -- onay SONRASI imza', () => {
    // K5 (Gorev 3): onay tarafi DISKTEKI `current_request` kaydini AUTORITE
    // sayar. Popup mesaji kayitla BIREBIR ayni degilse imza uretilmez.
    const RID = 'rid-1'
    const kayit = (extra = {}) => ({
        type: 'SOLANA_SIGN_MESSAGE', id: RID, requestId: RID, origin: ORIGIN,
        accountKey: 'k1', from: ADRES, mode: 'message', message: MESAJ_B64,
        appMeta: { name: 'Jupiter' }, ...extra,
    })
    const imzaIstegi = (extra = {}) => ({
        type: 'SOLANA_DAPP_SIGN_MESSAGE',
        message: { requestId: RID, mode: 'message', origin: ORIGIN, from: ADRES, accountKey: 'k1', message: MESAJ_B64, ...extra },
    })
    const GONDEREN = { url: 'chrome-extension://x/' }
    // Imza uretimini BAGIMSIZ olcmek icin ed25519 spy'i: kilit reddettiginde HIC cagrilmamali.
    // spyOn detached'in KENDISINI sarar ve .verify ozelligini tasimaz: dogrulayiciyi ONCEDEN al.
    const dogrula = nacl.sign.detached.verify
    let imzaSpy
    beforeEach(() => { imzaSpy = vi.spyOn(nacl.sign, 'detached') })
    afterEach(() => { imzaSpy.mockRestore() })

    const calistir = async (yerel, istekExtra) => {
        const { store } = kurChrome({ current_request: kayit(), ...yerel })
        const { handleSolanaDappSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaDappSignMessage(imzaIstegi(istekExtra), GONDEREN, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        return { store, yanit: yanitlar[0] }
    }
    const reddedildi = (yanit, kod = 'SOLANA_DAPP_FROM_MISMATCH') => {
        expect(yanit.success).toBe(false)
        expect(yanit.error).toBe(kod)
        expect(imzaSpy).not.toHaveBeenCalled()
    }

    it('(g) imza BAGIMSIZ dogrulayiciyla gecerlidir ve publicKey base64 doner (kayit == UI)', async () => {
        const { yanit } = await calistir()
        expect(yanit.success).toBe(true)
        // Spy gercekten ayni nacl nesnesini sarmis mi: basari yolunda CAGRILMALI
        // (aksi halde asagidaki "HIC cagrilmaz" iddialari bos olurdu).
        expect(imzaSpy).toHaveBeenCalledTimes(1)
        const imza = Uint8Array.from(atob(yanit.signature), (c) => c.charCodeAt(0))
        const acikAnahtar = Uint8Array.from(atob(yanit.publicKey), (c) => c.charCodeAt(0))
        expect(acikAnahtar).toHaveLength(32)
        expect(dogrula(new TextEncoder().encode('merhaba dunya'), imza, CIFT.publicKey)).toBe(true)
        expect(yanit.address).toBe(ADRES)
    })

    it('(a) current_request YOKSA SOLANA_DAPP_FROM_MISMATCH', async () => {
        const { yanit } = await calistir({ current_request: undefined })
        reddedildi(yanit)
    })

    it.each([
        ['requestId EKSIK', { requestId: undefined }],
        ['requestId FARKLI', { requestId: 'baska-id' }],
    ])('(b) %s -> SOLANA_DAPP_FROM_MISMATCH', async (_ad, extra) => {
        const { yanit } = await calistir({}, extra)
        reddedildi(yanit)
    })

    it('(b2) KAYITTA requestId yoksa (undefined === undefined tuzagi) SOLANA_DAPP_FROM_MISMATCH', async () => {
        const { yanit } = await calistir({ current_request: kayit({ requestId: undefined }) }, { requestId: undefined })
        reddedildi(yanit)
    })

    it('(c) kayit type SOLANA_SIGN_TX iken SIGN_MESSAGE onayi -> SOLANA_DAPP_FROM_MISMATCH', async () => {
        const { yanit } = await calistir({ current_request: kayit({ type: 'SOLANA_SIGN_TX' }) })
        reddedildi(yanit)
    })

    it('(d) kayit mesaji A, UI mesaji B -> SOLANA_DAPP_FROM_MISMATCH ve ed25519 imzasi HIC uretilmez', async () => {
        const { yanit } = await calistir({ current_request: kayit({ message: btoa('A mesaji') }) }, { message: btoa('B mesaji') })
        reddedildi(yanit)
    })

    it('(e) kayit mode message, UI mode signIn -> SOLANA_DAPP_FROM_MISMATCH ve solana_dapps DEGISMEZ', async () => {
        const anlik = structuredClone({ [ORIGIN]: OTURUM })
        const { store, yanit } = await calistir({}, { mode: 'signIn' })
        reddedildi(yanit)
        expect(store.solana_dapps).toEqual(anlik)
    })

    it('(e2) kayit origin i UI origin inden farkli -> SOLANA_DAPP_FROM_MISMATCH', async () => {
        const { yanit } = await calistir({ solana_dapps: { [ORIGIN]: OTURUM, 'https://baska.example': OTURUM } }, { origin: 'https://baska.example' })
        reddedildi(yanit)
    })

    it('(e3) kayit from i UI from undan farkli -> SOLANA_DAPP_FROM_MISMATCH', async () => {
        const { yanit } = await calistir({}, { from: YABANCI })
        reddedildi(yanit)
    })

    it('(f) kayit mesaji islem-benzeri (elle yazilmis) -> SOLANA_MESSAGE_LOOKS_LIKE_TX, imza uretilmez', async () => {
        const { yanit } = await calistir({ current_request: kayit({ message: ISLEM_B64 }) }, { message: ISLEM_B64 })
        reddedildi(yanit, 'SOLANA_MESSAGE_LOOKS_LIKE_TX')
    })

    it('(h) pencere acikken active_account baska hesaba gecti -> SOLANA_DAPP_FROM_MISMATCH (message), imza yok', async () => {
        const { yanit } = await calistir({ active_account: { key: 'k2', type: 'hd', index: 1 } })
        reddedildi(yanit)
    })

    it('(h) pencere acikken active_account baska hesaba gecti -> SOLANA_DAPP_FROM_MISMATCH (signIn), imza yok, oturum yazilmaz', async () => {
        const { store, yanit } = await calistir(
            { solana_dapps: {}, active_account: { key: 'k2', type: 'hd', index: 1 }, current_request: kayit({ mode: 'signIn' }) },
            { mode: 'signIn', signInInput: { domain: 'app.jup.ag' } },
        )
        reddedildi(yanit)
        expect(store.solana_dapps[ORIGIN]).toBeUndefined()
    })

    it('(h2) active_account HIC yoksa SOLANA_DAPP_FROM_MISMATCH', async () => {
        const { yanit } = await calistir({ active_account: undefined })
        reddedildi(yanit)
    })

    it('(i) popup mesajindaki accountKey kayittakinden farkli -> SOLANA_DAPP_FROM_MISMATCH', async () => {
        const { yanit } = await calistir({}, { accountKey: 'k2' })
        reddedildi(yanit)
    })

    it('(i2) popup mesajinda accountKey EKSIKSE (kayittakiyle esit degil) SOLANA_DAPP_FROM_MISMATCH', async () => {
        const { yanit } = await calistir({}, { accountKey: undefined })
        reddedildi(yanit)
    })

    it('(j) iki dapp ayni anda istek yapar: ikinci kayit birincinin ustune yazar, ilk onay SOLANA_DAPP_FROM_MISMATCH doner', async () => {
        const ORIGIN2 = 'https://app.baska.example'
        const { store } = kurChrome({ solana_dapps: { [ORIGIN]: OTURUM, [ORIGIN2]: OTURUM } })
        const { handleSolanaSignMessage, handleSolanaDappSignMessage } = await import('./solanaDappFunctions.js')
        await handleSolanaSignMessage(istek({ message: MESAJ_B64 }), SENDER, () => {})
        await new Promise((r) => setTimeout(r, 0))
        const birinci = structuredClone(store.current_request)
        expect(birinci.origin).toBe(ORIGIN)
        await handleSolanaSignMessage(istek({ message: btoa('ikinci dapp') }),
            { origin: ORIGIN2, frameId: 0, tab: { id: 4 } }, () => {})
        await new Promise((r) => setTimeout(r, 0))
        expect(store.current_request.origin).toBe(ORIGIN2)
        const yanitlar = []
        await handleSolanaDappSignMessage({
            type: 'SOLANA_DAPP_SIGN_MESSAGE',
            message: { requestId: birinci.requestId, mode: 'message', origin: ORIGIN, from: ADRES, accountKey: 'k1', message: MESAJ_B64 },
        }, GONDEREN, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        reddedildi(yanitlar[0])
    })

    it('kayit YAZIMI: handleSolanaSignMessage kaydi requestId (= id) ve accountKey tasir', async () => {
        const { store } = kurChrome()
        const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
        await handleSolanaSignMessage(istek({ message: MESAJ_B64 }), SENDER, () => {})
        await new Promise((r) => setTimeout(r, 0))
        expect(store.current_request.requestId).toBeTruthy()
        expect(store.current_request.requestId).toBe(store.current_request.id)
        expect(store.current_request.accountKey).toBe('k1')
    })

    it('kayit YAZIMI: handleSolanaSignIn kaydi requestId (= id) ve accountKey tasir (oturumsuz da)', async () => {
        const { store } = kurChrome({ solana_dapps: {} })
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        await handleSolanaSignIn({ method: 'solana_signIn', params: [{ input: {} }] }, SENDER, () => {})
        await new Promise((r) => setTimeout(r, 0))
        expect(store.current_request.requestId).toBeTruthy()
        expect(store.current_request.requestId).toBe(store.current_request.id)
        expect(store.current_request.accountKey).toBe('k1')
    })

    it('§6.1 kilidi: kayit ve UI ayni ama from cozulen anahtardan farkliysa SOLANA_DAPP_FROM_MISMATCH', async () => {
        const { yanit } = await calistir({ current_request: kayit({ from: YABANCI }) }, { from: YABANCI })
        reddedildi(yanit)
    })

    // Bulgu 1 (task-30 incelemesi): `from` EKSIK/BOS ise kilit GECMEMELI.
    it('bulgu 1 (task-30 incelemesi): from EKSIKSE (kayit ve UI) SOLANA_DAPP_FROM_MISMATCH', async () => {
        const { yanit } = await calistir({ current_request: kayit({ from: undefined }) }, { from: undefined })
        reddedildi(yanit)
    })

    it('bulgu 1 (task-30 incelemesi): solana_dapps kaydi YOKSA (signIn DISI) SOLANA_DAPP_FROM_MISMATCH', async () => {
        const { yanit } = await calistir({ solana_dapps: {} })
        reddedildi(yanit)
    })

    it('mode message: oturumun accountKey i onay aninda DEGISMISSE (solana_dapps[origin].accountKey !== hesap) SOLANA_DAPP_FROM_MISMATCH', async () => {
        const { yanit } = await calistir({ solana_dapps: { [ORIGIN]: { ...OTURUM, accountKey: 'k9' } } })
        reddedildi(yanit)
    })

    it('signIn basarili onayda oturumu connect ile AYNI sekilde kurar (appMeta KAYITTAN, UI iddiasindan degil)', async () => {
        const { store, yanit } = await calistir(
            { solana_dapps: {}, current_request: kayit({ mode: 'signIn', appMeta: { name: 'Jupiter' } }) },
            { mode: 'signIn', appMeta: { name: 'UI-nin-iddiasi' } },
        )
        expect(yanit.success).toBe(true)
        const k = store.solana_dapps[ORIGIN]
        // Adres COZULEN anahtardan yazilir; appMeta popup mesajindan DEGIL kayittan.
        expect(k.address).toBe(ADRES)
        expect(k.accountKey).toBe('k1')
        expect(k.cluster).toBe('solana:mainnet')
        expect(k.appMeta.name).toBe('Jupiter')
        expect(typeof k.connectedAt).toBe('number')
    })

    // C1.4 -- SAVUNMA DERINLIGI: kayit KALICIDIR; devasa appMeta burada da CLAMP edilir.
    it('C1.4: kayittaki devasa appMeta olsa bile kalici kayit CLAMP LENIR', async () => {
        const { store } = await calistir(
            { solana_dapps: {}, current_request: kayit({ mode: 'signIn', appMeta: { name: 'z'.repeat(500), icon: 'y'.repeat(5000) } }) },
            { mode: 'signIn' },
        )
        const k = store.solana_dapps[ORIGIN]
        expect(k.appMeta.name.length).toBe(64)
        expect(k.appMeta.icon.length).toBe(512)
    })
})

// C5.3 -- nihai inceleme: hicbir test handleSolanaSignMessage/handleSolanaSignIn'i
// catch dalina SURMUYORDU. Ikisi de `uygulamaHatasi('SOLANA_SEND_FAILED')`
// doner (KAYNAKTAN dogrulandi -- handleSolanaSignTransaction/gateSolanaSignAndSend'in
// AKSINE, onlar jenerik 'Internal error' doner).
describe('handleSolanaSignMessage / handleSolanaSignIn -- catch dali', () => {
    it('signMessage: chrome.storage.local.get FIRLATIRSA SOLANA_SEND_FAILED doner, SIFIR pencere, ham mesaj SIZMAZ', async () => {
        const { acilanPencereler } = kurChrome()
        globalThis.chrome.storage.local.get = async () => { throw new Error('secret-ish text') }
        const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignMessage(istek({ message: MESAJ_B64, account: ADRES }), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error.data.code).toBe('SOLANA_SEND_FAILED')
        expect(acilanPencereler.length).toBe(0)
        expect(JSON.stringify(yanitlar[0])).not.toContain('secret-ish')
    })

    it('signIn: chrome.storage.local.get FIRLATIRSA SOLANA_SEND_FAILED doner, SIFIR pencere, ham mesaj SIZMAZ', async () => {
        const { acilanPencereler } = kurChrome()
        globalThis.chrome.storage.local.get = async () => { throw new Error('secret-ish text') }
        const { handleSolanaSignIn } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignIn({ method: 'solana_signIn', params: [{ input: {} }] }, SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error.data.code).toBe('SOLANA_SEND_FAILED')
        expect(acilanPencereler.length).toBe(0)
        expect(JSON.stringify(yanitlar[0])).not.toContain('secret-ish')
    })
})

describe('dagitici ve kapi kaydi', () => {
    it('background.js uc yeni case i tasir ve messageGate onlari SINIFLANDIRIR', async () => {
        const kaynak = readFileSync(new URL('../background.js', import.meta.url), 'utf8')
        for (const satir of ["case 'solana_signMessage':", "case 'solana_signIn':", "case 'SOLANA_DAPP_SIGN_MESSAGE':"]) {
            expect(kaynak).toContain(satir)
        }
        const { DAPP_METHODS, INTERNAL_ACTIONS } = await import('./messageGate.js')
        expect(DAPP_METHODS.has('solana_signMessage')).toBe(true)
        expect(DAPP_METHODS.has('solana_signIn')).toBe(true)
        // SOLANA_DAPP_SIGN_MESSAGE KASA ACAR: sayfadan gelebilseydi kullanicinin
        // hic gormedigi bir mesaj imzalanirdi. DAPP_METHODS'a DEGIL buraya girer.
        expect(INTERNAL_ACTIONS.has('SOLANA_DAPP_SIGN_MESSAGE')).toBe(true)
    })
})

// E1 / Gorev 2 -- mesajYukKapisi'na IMZASIZ islem MESAJI tarayicisi baglandi.
// Eskiden yalniz tel bicimi (imza yuvalari + mesaj) yakalaniyordu: dapp
// imzalanacak islem MESAJININ ham baytini "signMessage" diye gonderirse pencere
// aciliyor ve ayni ed25519 imzasi zincirde gecerli bir islem imzasi oluyordu.
//
// "WS ve legacy yolu": sayfa betigi iki yerden AYNI arka plan yontemini
// (`solana_signMessage`) cagirir (Wallet Standard adaptoru ve legacy provider);
// ikisi de `handleSolanaSignMessage`'a ulasir, yani kapi tek ve ayni. Bu yuzden
// vektorler dogrudan o isleyiciden gecirilir.
const BLOKHASH = '11111111111111111111111111111111'
const KULLANICI_KP = Keypair.fromSeed(CIFT.secretKey.slice(0, 32))
const BASKA_KP = Keypair.fromSeed(new Uint8Array(32).fill(9))
const ALICI_KP = Keypair.fromSeed(new Uint8Array(32).fill(11))
const b64 = (bytes) => Buffer.from(bytes).toString('base64')
const birlestirB = (...p) => {
    const o = new Uint8Array(p.reduce((t, x) => t + x.length, 0))
    let k = 0
    for (const x of p) { o.set(x, k); k += x.length }
    return o
}

function legacyTx({ payer, kimden }) {
    const tx = new Transaction({ feePayer: payer.publicKey, recentBlockhash: BLOKHASH })
    tx.add(SystemProgram.transfer({ fromPubkey: kimden.publicKey, toPubkey: ALICI_KP.publicKey, lamports: 1000 }))
    return tx
}
const legacyMesajBytes = (o) => new Uint8Array(legacyTx(o).compileMessage().serialize())

function v0MesajBytes({ altIle = false } = {}) {
    const tablolar = altIle
        ? [new AddressLookupTableAccount({
            key: Keypair.generate().publicKey,
            state: {
                deactivationSlot: BigInt('18446744073709551615'),
                lastExtendedSlot: 0,
                lastExtendedSlotStartIndex: 0,
                authority: undefined,
                addresses: [Keypair.generate().publicKey, ALICI_KP.publicKey, Keypair.generate().publicKey],
            },
        })]
        : []
    const m = new TransactionMessage({
        payerKey: KULLANICI_KP.publicKey,
        recentBlockhash: BLOKHASH,
        instructions: [SystemProgram.transfer({ fromPubkey: KULLANICI_KP.publicKey, toPubkey: ALICI_KP.publicKey, lamports: 1000 })],
    }).compileToV0Message(tablolar)
    return new Uint8Array(m.serialize())
}

// final SU-15: TUM hesaplari imzaci olan tek talimatli mesaj (n imzaci; program kimligi imzaci degil).
// MAX_REQUIRED_SIGNATURES (19) sinirinin icinde bir deger: 11 imzacili mesaj da islem mesajidir.
function nImzaciTalimat(n) {
    const imzacilar = Array.from({ length: n }, (_, i) => Keypair.fromSeed(new Uint8Array(32).fill(100 + i)))
    const ix = new TransactionInstruction({
        programId: SystemProgram.programId,
        keys: imzacilar.map((k) => ({ pubkey: k.publicKey, isSigner: true, isWritable: true })),
        data: Buffer.from([1, 2, 3]),
    })
    return { imzacilar, ix }
}
const legacyNImzaciBytes = (n) => {
    const { imzacilar, ix } = nImzaciTalimat(n)
    const tx = new Transaction({ feePayer: imzacilar[0].publicKey, recentBlockhash: BLOKHASH })
    tx.add(ix)
    return new Uint8Array(tx.compileMessage().serialize())
}
const v0NImzaciBytes = (n) => {
    const { imzacilar, ix } = nImzaciTalimat(n)
    return new Uint8Array(new TransactionMessage({ payerKey: imzacilar[0].publicKey, recentBlockhash: BLOKHASH, instructions: [ix] }).compileToV0Message().serialize())
}

// Tel bicimi: legacy imzasiz / tam imzali / kismen imzali
const legacyTelImzasiz = () =>
    new Uint8Array(legacyTx({ payer: KULLANICI_KP, kimden: KULLANICI_KP }).serialize({ requireAllSignatures: false, verifySignatures: false }))
const legacyTelImzali = () => {
    const tx = legacyTx({ payer: KULLANICI_KP, kimden: KULLANICI_KP })
    tx.sign(KULLANICI_KP)
    return new Uint8Array(tx.serialize())
}
const legacyTelKismen = () => {
    // payer=BASKA, kimden=KULLANICI: iki imzaci, yalniz biri imzali
    const tx = legacyTx({ payer: BASKA_KP, kimden: KULLANICI_KP })
    tx.partialSign(KULLANICI_KP)
    return new Uint8Array(tx.serialize({ requireAllSignatures: false, verifySignatures: false }))
}
// v0 tel bicimi: [shortvec 1][64 sifir imza][v0 mesaji]
const v0Tel = () => birlestirB(new Uint8Array([1]), new Uint8Array(64), v0MesajBytes())

describe('E1: mesajYukKapisi imzasiz islem mesajlarini reddeder (pencere ACILMADAN)', () => {
    const RED_VEKTORLERI = [
        ['legacy mesaj, payer=kullanici', () => legacyMesajBytes({ payer: KULLANICI_KP, kimden: KULLANICI_KP })],
        ['legacy mesaj, payer=baska (kullanici ikinci imzaci)', () => legacyMesajBytes({ payer: BASKA_KP, kimden: KULLANICI_KP })],
        ['legacy mesaj, kullanici HIC imzaci degil', () => legacyMesajBytes({ payer: BASKA_KP, kimden: BASKA_KP })],
        ['v0 mesaj', () => v0MesajBytes()],
        ['v0 mesaj + adres arama tablosu', () => v0MesajBytes({ altIle: true })],
        ['legacy mesaj + 1 bayt', () => birlestirB(legacyMesajBytes({ payer: KULLANICI_KP, kimden: KULLANICI_KP }), new Uint8Array([7]))],
        ['iki mesaj arka arkaya', () => {
            const m = legacyMesajBytes({ payer: KULLANICI_KP, kimden: KULLANICI_KP })
            return birlestirB(m, m)
        }],
        ['legacy tel, imzasiz', legacyTelImzasiz],
        ['legacy tel, imzali', legacyTelImzali],
        ['legacy tel, kismen imzali', legacyTelKismen],
        ['v0 tel', v0Tel],
        ['0x81 onekli 100 bayt', () => birlestirB(new Uint8Array([0x81]), new Uint8Array(99).fill(5))],
        // final SU-15: sinir icinde cok imzacili mesajlar (MAX_REQUIRED_SIGNATURES = 19) de reddedilir.
        ['legacy mesaj, 11 imzaci', () => legacyNImzaciBytes(11)],
        ['v0 mesaj, 11 imzaci', () => v0NImzaciBytes(11)],
        ['legacy mesaj, 19 imzaci (sinir)', () => legacyNImzaciBytes(19)],
        // Brief bunu "mesru, pencere acilir" listesine yazmisti; patron hukmu Q9
        // (SOFT_HEADER_RULE=true, progress.md) ile CELISIR: baslik makulse tam
        // ayristirma basarisiz olsa da mesaj supheli sayilir. Son bayti eksik
        // mesaj zincirde gecerli islem olamaz ama baslik makuldur -> reddedilir.
        // Hukum geri alinirsa (sabit false) bu vektor mesru listesine tasinir.
        ['legacy mesaj bir bayt eksik (yumusak baslik kurali, Q9)', () => {
            const m = legacyMesajBytes({ payer: KULLANICI_KP, kimden: KULLANICI_KP })
            return m.slice(0, m.length - 1)
        }],
    ]

    it.each(RED_VEKTORLERI)('%s -> SOLANA_MESSAGE_LOOKS_LIKE_TX, SIFIR pencere, current_request YAZILMAZ', async (_ad, uret) => {
        const { store, acilanPencereler } = kurChrome()
        const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignMessage(istek({ message: b64(uret()), account: ADRES }), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].error.data.code).toBe('SOLANA_MESSAGE_LOOKS_LIKE_TX')
        expect(acilanPencereler.length).toBe(0)
        expect(store.current_request).toBeUndefined()
    })

    // Review Focus 1: mesru yukler REDDEDILMEZ (pencere acilir).
    const rastgele = (n, tohum) => {
        const o = new Uint8Array(n)
        let a = tohum >>> 0
        for (let i = 0; i < n; i++) {
            a = (a + 0x6d2b79f5) >>> 0
            let t = a
            t = Math.imul(t ^ (t >>> 15), t | 1)
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
            o[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff
        }
        return o
    }
    const utf8 = (m) => new TextEncoder().encode(m)
    const SIWS = 'app.jup.ag wants you to sign in with your Solana account:\n' + ADRES +
        '\n\nSign in to Jupiter\n\nURI: https://app.jup.ag\nVersion: 1\nChain ID: mainnet\nNonce: abc12345\nIssued At: 2026-11-11T00:00:00.000Z'
    const MESRU_VEKTORLERI = [
        ['SIWS metni', () => utf8(SIWS)],
        ['"Hello"', () => utf8('Hello')],
        ['"Merhaba dunya"', () => utf8('Merhaba dunya')],
        ['emoji ve CJK', () => utf8('Merhaba \u{1F600} 你好 世界 こんにちは')],
        ['[0x01]', () => new Uint8Array([0x01])],
        ['[0x80]', () => new Uint8Array([0x80])],
        ['8192 bayt rastgele ikili', () => rastgele(8192, 1)],
        ['0x80 ile baslayan 100 rastgele bayt', () => { const b = rastgele(100, 2); b[0] = 0x80; return b }],
        ['32 bayt nonce', () => rastgele(32, 3)],
        ['offchain basligi (0xff + "solana offchain")', () =>
            birlestirB(new Uint8Array([0xff]), utf8('solana offchain'), new Uint8Array([0, 0, 5, 0]), utf8('Hello'))],
    ]

    it.each(MESRU_VEKTORLERI)('mesru yuk: %s -> pencere ACILIR', async (_ad, uret) => {
        const { store, acilanPencereler } = kurChrome()
        const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaSignMessage(istek({ message: b64(uret()), account: ADRES }), SENDER, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar.length).toBe(0)
        expect(acilanPencereler.length).toBe(1)
        expect(store.current_request.type).toBe('SOLANA_SIGN_MESSAGE')
    })

    it('sira: bos -> TX_DESERIALIZE_FAILED, 10240 bayt -> SOLANA_MESSAGE_TOO_LARGE (yeni tespitlerden ONCE)', async () => {
        for (const [yuk, kod] of [['', 'TX_DESERIALIZE_FAILED'], [b64(new Uint8Array(10240).fill(1)), 'SOLANA_MESSAGE_TOO_LARGE']]) {
            const { acilanPencereler } = kurChrome()
            const { handleSolanaSignMessage } = await import('./solanaDappFunctions.js')
            const yanitlar = []
            await handleSolanaSignMessage(istek({ message: yuk, account: ADRES }), SENDER, (r) => yanitlar.push(r))
            await new Promise((r) => setTimeout(r, 0))
            expect(yanitlar[0].error.data.code).toBe(kod)
            expect(acilanPencereler.length).toBe(0)
        }
    })
})

// final SU-4: mesajYukKapisi Uint8Array olmayan girdide uc dedektorun HEPSI sessizce
// false/null donerdi ve kapi `null` (gecis) verirdi -- fail-OPEN. Bugun yalniz base64Coz
// (hep Uint8Array uretir) cagirir; yarin baska bir cagri noktasi dizi/Buffer-benzeri
// bir deger verirse kapi sessizce acilirdi.
describe('SU-4: mesajYukKapisi Uint8Array olmayan girdiyi reddeder (fail-closed)', () => {
    const ISLEM_BAYTLARI = () => Array.from(legacyMesajBytes({ payer: KULLANICI_KP, kimden: KULLANICI_KP }))

    it.each([
        ['bayt dizisi (Array)', ISLEM_BAYTLARI],
        ['dizge', () => 'Hello'],
        ['uzunluk alanli nesne', () => ({ length: 5 })],
        ['ArrayBuffer', () => new ArrayBuffer(16)],
        ['DataView', () => new DataView(new ArrayBuffer(16))],
        ['sayi', () => 123],
        ['null', () => null],
        ['undefined', () => undefined],
    ])('%s -> TX_DESERIALIZE_FAILED', async (_ad, uret) => {
        kurChrome()
        const { mesajYukKapisi } = await import('./solanaDappFunctions.js')
        expect(mesajYukKapisi(uret())).toBe('TX_DESERIALIZE_FAILED')
    })

    it('Uint8Array ve Buffer (Uint8Array alt sinifi) mesru yuk icin gecer (null)', async () => {
        kurChrome()
        const { mesajYukKapisi } = await import('./solanaDappFunctions.js')
        expect(mesajYukKapisi(new TextEncoder().encode('Hello'))).toBeNull()
        expect(mesajYukKapisi(Buffer.from('Hello'))).toBeNull()
    })

    it('Uint8Array olarak verilen islem baytlari ise hala SOLANA_MESSAGE_LOOKS_LIKE_TX (regresyon)', async () => {
        kurChrome()
        const { mesajYukKapisi } = await import('./solanaDappFunctions.js')
        expect(mesajYukKapisi(Uint8Array.from(ISLEM_BAYTLARI()))).toBe('SOLANA_MESSAGE_LOOKS_LIKE_TX')
    })
})
