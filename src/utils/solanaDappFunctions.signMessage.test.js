// client/src/utils/solanaDappFunctions.signMessage.test.js
//
// KOK NEDEN: §4.3.1'in kapilarinin TAMAMI onay penceresi ACILMADAN once
// calismak zorunda. Bir kapi pencereden SONRAYA kayarsa kullanici imzalayamaz
// bir seyi onaylar, imza aninda patlar ve dapp'in promise'i asili kalir --
// bu yuzden HER red testinde ayrica "sifir pencere" iddiasi var.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import nacl from 'tweetnacl'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

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
    const imzaIstegi = (extra = {}) => ({
        type: 'SOLANA_DAPP_SIGN_MESSAGE',
        message: { mode: 'message', origin: ORIGIN, from: ADRES, accountKey: 'k1', message: MESAJ_B64, ...extra },
    })

    it('imza BAGIMSIZ dogrulayiciyla gecerlidir ve publicKey base64 doner', async () => {
        kurChrome()
        const { handleSolanaDappSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaDappSignMessage(imzaIstegi(), { url: 'chrome-extension://x/' }, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))

        expect(yanitlar[0].success).toBe(true)
        const imza = Uint8Array.from(atob(yanitlar[0].signature), (c) => c.charCodeAt(0))
        const acikAnahtar = Uint8Array.from(atob(yanitlar[0].publicKey), (c) => c.charCodeAt(0))
        expect(acikAnahtar).toHaveLength(32)
        expect(nacl.sign.detached.verify(new TextEncoder().encode('merhaba dunya'), imza, CIFT.publicKey)).toBe(true)
        expect(yanitlar[0].address).toBe(ADRES)
    })

    it('§6.1 kilidi: onaylanan from cozulen anahtardan farkliysa SOLANA_DAPP_FROM_MISMATCH', async () => {
        kurChrome()
        const { handleSolanaDappSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaDappSignMessage(imzaIstegi({ from: YABANCI }), { url: 'chrome-extension://x/' }, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].success).toBe(false)
        expect(yanitlar[0].error).toBe('SOLANA_DAPP_FROM_MISMATCH')
    })

    // Bulgu 1 (task-30 incelemesi): bu iki kilit eskiden `if (from && ...)` /
    // `if (kayitliAdres && ...)` seklindeydi -- deger EKSIK ya da BOS gelirse
    // kontrolun KENDISI atlaniyordu (grantedSolanaSession('') ile AYNI sinif
    // fail-open). Dogrulandi: `from`, HEM 'message' HEM 'signIn' icin pencere
    // ACILMADAN once dolduruluyor (handleSolanaSignMessage kapi 2'nin
    // grantedSolanaSession'i, handleSolanaSignIn'in ise ayri bir bos-adres
    // kapisinin ELEDIGI `address`), yani pencere acildiysa HER ZAMAN vardir --
    // eksik gelmesi yalnizca kirik bir cagirandan olur ve GECMEMELIDIR.
    it('bulgu 1 (task-30 incelemesi): from EKSIKSE artik SOLANA_DAPP_FROM_MISMATCH (eskiden fail-open gecerdi)', async () => {
        kurChrome()
        const { handleSolanaDappSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaDappSignMessage(imzaIstegi({ from: undefined }), { url: 'chrome-extension://x/' }, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].success).toBe(false)
        expect(yanitlar[0].error).toBe('SOLANA_DAPP_FROM_MISMATCH')
    })

    // IKINCI kilit MODA GORE kapanir: duz signMessage'da (mode !== 'signIn')
    // KAPI 2 zaten bir oturumu ZORUNLU kildigi icin pencere acildiginda
    // solana_dapps[origin] HER ZAMAN vardir -- yoksa (onay ekrani acikken
    // baglanti kesildi) reddetmek DOGRUDUR. signIn'de ise SS3.4 geregi ilk
    // baglanmada bu kayit HENUZ YOK (asagidaki "signIn basarili onayda..."
    // testi bunu KANITLAR) -- o yuzden kapanma sadece `mode !== 'signIn'`
    // dalinda.
    it('bulgu 1 (task-30 incelemesi): solana_dapps kaydi YOKSA (signIn DISI) artik SOLANA_DAPP_FROM_MISMATCH (eskiden fail-open gecerdi)', async () => {
        kurChrome({ solana_dapps: {} })
        const { handleSolanaDappSignMessage } = await import('./solanaDappFunctions.js')
        const yanitlar = []
        await handleSolanaDappSignMessage(imzaIstegi(), { url: 'chrome-extension://x/' }, (r) => yanitlar.push(r))
        await new Promise((r) => setTimeout(r, 0))
        expect(yanitlar[0].success).toBe(false)
        expect(yanitlar[0].error).toBe('SOLANA_DAPP_FROM_MISMATCH')
    })

    it('signIn basarili onayda oturumu connect ile AYNI sekilde kurar', async () => {
        const { store } = kurChrome({ solana_dapps: {} })
        const { handleSolanaDappSignMessage } = await import('./solanaDappFunctions.js')
        await handleSolanaDappSignMessage(
            imzaIstegi({ mode: 'signIn', signInInput: { domain: 'app.jup.ag' }, appMeta: { name: 'Jupiter' } }),
            { url: 'chrome-extension://x/' }, () => {},
        )
        await new Promise((r) => setTimeout(r, 0))

        const kayit = store.solana_dapps[ORIGIN]
        // Adres COZULEN anahtardan yazilir: ekranin gonderdigi bir dizeden
        // degil. Aksi halde oturum, cuzdanin hic imzalamadigi bir adrese
        // sabitlenebilirdi.
        expect(kayit.address).toBe(ADRES)
        expect(kayit.accountKey).toBe('k1')
        expect(kayit.cluster).toBe('solana:mainnet')
        expect(kayit.appMeta.name).toBe('Jupiter')
        expect(typeof kayit.connectedAt).toBe('number')
    })

    // C1.4 -- SAVUNMA DERINLIGI: onay ekrani NORMALDE zaten clamp'lenmis bir
    // appMeta gonderir, ama bu kayit KALICIDIR (solana_dapps) -- gonderenin
    // gucune BAKMAKSIZIN 64/512 sinirini burada da zorlamak, ekranin arasina
    // giren bir hata kalici depoyu sinirsiz birakamaz.
    it('C1.4: onay ekranindan devasa bir appMeta gelse bile kalici kayit CLAMP LENIR', async () => {
        const { store } = kurChrome({ solana_dapps: {} })
        const { handleSolanaDappSignMessage } = await import('./solanaDappFunctions.js')
        await handleSolanaDappSignMessage(
            imzaIstegi({ mode: 'signIn', signInInput: { domain: 'app.jup.ag' }, appMeta: { name: 'z'.repeat(500), icon: 'y'.repeat(5000) } }),
            { url: 'chrome-extension://x/' }, () => {},
        )
        await new Promise((r) => setTimeout(r, 0))

        const kayit = store.solana_dapps[ORIGIN]
        expect(kayit.appMeta.name.length).toBe(64)
        expect(kayit.appMeta.icon.length).toBe(512)
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
