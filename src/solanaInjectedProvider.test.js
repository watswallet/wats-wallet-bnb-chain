// solanaInjected.js bir modul degil, dogrudan bir <script>: hicbir sey disari
// vermiyor, yalnizca `window`a dokunuyor. Bu yuzden kaynak SAHTE bir `window`
// (gercek bir EventTarget) ile `new Function` icinde CALISTIRILIR --
// injectedProvider.test.js'teki desenin aynisi.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
    PublicKey, Transaction, VersionedTransaction, TransactionMessage, SystemProgram,
} from '@solana/web3.js'

const SOLANA_KAYNAK = readFileSync(new URL('./solanaInjected.js', import.meta.url), 'utf8')
const EVM_KAYNAK = readFileSync(new URL('./injected.js', import.meta.url), 'utf8')

function kurSayfa() {
    const win = new EventTarget()
    win.gonderilen = []
    win.postMessage = (data) => { win.gonderilen.push(data) }
    win.location = { origin: 'https://app.jup.ag', hostname: 'app.jup.ag' }
    globalThis.window = win
    globalThis.document = { title: 'Jupiter', querySelector: () => null }
    return win
}

/** Kayit olayini yakalar; betik yuklenirken DUYURDUGU icin dinleyici ONCE takilir. */
function solanayiYukle(win) {
    const olaylar = []
    win.addEventListener('wallet-standard:register-wallet', (e) => olaylar.push(e))
    new Function('window', SOLANA_KAYNAK)(win)
    return olaylar
}

function cuzdaniAl(olaylar) {
    let cuzdan = null
    olaylar[0].detail({ register: (w) => { cuzdan = w; return () => {} } })
    return cuzdan
}

// Gomulu yardimcilar sayfa yuzeyine ACILMAZ (bir dapp'in gorecegi tek sey cuzdan
// nesnesidir). Testte kaynak AYNEN calistirilip fonksiyon govdesinden geri
// dondurulur: blok icindeki `function` bildirimleri sloppy modda fonksiyon
// kapsamina cikar ve enjekte edilen betik de tarayicida sloppy modda calisir.
function yardimcilar(win) {
    return new Function(
        'window',
        SOLANA_KAYNAK + '\nreturn { bytesToBase64, base64ToBytes, base58EncodeInline, makePublicKeyLike }',
    )(win)
}

afterEach(() => {
    vi.resetModules()
    delete globalThis.window
    delete globalThis.document
})

describe('solanaInjected -- Wallet Standard kaydi', () => {
    // KOK NEDEN: referans uygulama (@wallet-standard/wallet register.js) `detail`i
    // yalnizca CAGIRIR. detail'e cuzdan NESNESI koyulursa hicbir adaptor cuzdani
    // gormez -- ve hata da vermez, cuzdan sadece listede hic cikmaz.
    it('kayit olayinin detail alani bir FONKSIYONDUR, cuzdan nesnesi DEGIL', () => {
        const win = kurSayfa()
        const olaylar = solanayiYukle(win)

        expect(olaylar.length).toBe(1)
        expect(typeof olaylar[0].detail).toBe('function')

        const cuzdan = cuzdaniAl(olaylar)
        expect(cuzdan.chains).toEqual(['solana:mainnet'])
        expect(cuzdan.accounts).toEqual([])
        // M1b yalnizca UC ozelligi CAGRILABILIR yapar; imza ozellikleri sonraki
        // milestone'larda AYNI dosyada `metotlar` tablosuna eklenir.
        //
        // TAM ESITLIK DEGIL, arayan-icerir: M2 (signMessage/signIn), M3
        // (signTransaction) ve M4 (signAndSendTransaction) ayni tabloya ekliyor ve
        // hicbirinde "Gorev 7'nin listesini de guncelle" adimi yok. Sabit liste
        // yazsaydik suit Gorev 24'te, sonra 33'te, sonra 41'de -- her defasinda
        // ALAKASIZ bir dosyada -- kirmizi yanardi. Kilitlenmesi gereken sey uc
        // anahtarin VARLIGI ve uydurma anahtarin YOKLUGUDUR.
        expect(Object.keys(cuzdan.features)).toEqual(expect.arrayContaining([
            'standard:connect', 'standard:disconnect', 'standard:events',
        ]))
        // Wallet Standard'da boyle bir ozellik YOKTUR: toplu imzalama
        // solana:signTransaction'in degisken argumanli cagrilmasidir. Uydurma
        // anahtar adaptorde sessizce yok sayilir, bizde ise olu kod uretir.
        expect(Object.keys(cuzdan.features)).not.toContain('solana:signAllTransactions')
        // Ozelligin degeri surum isareti DEGIL, metodu TASIYAN nesnedir:
        // yalnizca {version} bildirmek her dapp'i baglan dugmesinde oldururdu.
        expect(typeof cuzdan.features['standard:connect'].connect).toBe('function')
        expect(typeof cuzdan.features['standard:disconnect'].disconnect).toBe('function')
        expect(typeof cuzdan.features['standard:events'].on).toBe('function')
    })

    // app-ready GEC gelebilir (adaptor betigi bizden sonra yuklenir). O dalda
    // register-wallet'i yeniden YAYINLAMAK ise yaramaz; api.register cagrilmalidir.
    it('app-ready gelince cuzdan api.register ile YENIDEN kaydedilir', () => {
        const win = kurSayfa()
        solanayiYukle(win)

        let kayitli = null
        win.dispatchEvent(new CustomEvent('wallet-standard:app-ready', {
            detail: { register: (w) => { kayitli = w } },
        }))

        expect(kayitli).not.toBeNull()
        expect(kayitli.chains).toEqual(['solana:mainnet'])
    })
})

// window.wats UC YAZICILI bir nesnedir ve iki MAIN-world betigin yuklenme
// sirasina GUVENILMEZ. Duz atama yapan yazici otekilerin koprusunu SESSIZCE
// siler -- dapp cuzdani bulamaz, hata da gorunmez.
describe('solanaInjected -- window.wats HER IKI yukleme sirasinda korunur', () => {
    it('solana ONCE, injected.js SONRA: EVM ve tonconnect seritleri hayatta kalir', async () => {
        const win = kurSayfa()
        await import('./tonInjected.js')
        solanayiYukle(win)
        new Function('window', 'crypto', EVM_KAYNAK)(win, globalThis.crypto)

        expect(win.wats.isWatsWallet).toBe(true)
        expect(typeof win.wats.request).toBe('function')
        expect(win.wats.tonconnect.protocolVersion).toBe(2)
        expect(win.wats.solana).toBeTruthy()
    })

    it('injected.js ONCE, solana SONRA: ucu de hayatta kalir', async () => {
        const win = kurSayfa()
        new Function('window', 'crypto', EVM_KAYNAK)(win, globalThis.crypto)
        await import('./tonInjected.js')
        solanayiYukle(win)

        expect(win.wats.isWatsWallet).toBe(true)
        expect(win.wats.tonconnect.protocolVersion).toBe(2)
        expect(win.wats.solana).toBeTruthy()
    })

    // `legacySlotFree` M1'in ANINDA hesaplanan STATIK bir kayittir: ayni betik
    // calismasinin M1 kismi `!window.solana`yi, M5'in installLegacySolana()
    // blogu `window.solana`yi doldurmadan ONCE okur. Bu yuzden `window.solana`
    // artik DOLU olsa bile (bkz. asagidaki 'legacy window.solana -- kurulum'
    // suiti) bu alan `true` kalir -- yuvanin M1 ANINDAKI durumunu kaydeder,
    // GUNCEL durumunu degil.
    it('legacySlotFree yuvanin M1 anindaki durumunu kaydeder', () => {
        const win = kurSayfa()
        solanayiYukle(win)

        expect(win.wats.solana.legacySlotFree).toBe(true)
    })
})

describe('solanaInjected -- gomulu yardimcilar', () => {
    // btoa(String.fromCharCode(...bytes)) yayilimi buyuk girdide RangeError atar.
    // 1 MB'lik bir v0 islem/mesaj yuku bu siniri asar; 8KB'lik parcalama tam da
    // bunun icin var ve regresyonu ANCAK bu boyutta gorunur.
    it('bytesToBase64 1 MB girdide RangeError ATMAZ ve gidis-donusu birebirdir', () => {
        const win = kurSayfa()
        const { bytesToBase64, base64ToBytes } = yardimcilar(win)

        const buyuk = new Uint8Array(1024 * 1024)
        for (let i = 0; i < buyuk.length; i += 1) buyuk[i] = i % 256

        const b64 = bytesToBase64(buyuk)
        expect(typeof b64).toBe('string')
        const geri = base64ToBytes(b64)
        expect(geri.length).toBe(buyuk.length)
        expect(geri[0]).toBe(0)
        expect(geri[buyuk.length - 1]).toBe(buyuk[buyuk.length - 1])
    })

    // base58 BUYUK/KUCUK HARF DUYARLIDIR ve bas sifirlar '1' olarak geri konmazsa
    // iki FARKLI bayt dizisi AYNI dizgeye kodlanir.
    it('base58EncodeInline bas sifirlari korur', () => {
        const win = kurSayfa()
        const { base58EncodeInline } = yardimcilar(win)

        expect(base58EncodeInline(new Uint8Array([0, 0, 1]))).toBe('112')
        expect(base58EncodeInline(new Uint8Array(32))).toBe('1'.repeat(32))
    })

    // Dapp'in `new PublicKey(provider.publicKey)` cagrisi ANCAK gercek bir
    // Uint8Array uzerine kendi ozellikleri eklenirse calisir.
    it('makePublicKeyLike GERCEK Uint8Array uzerine PublicKey yuzeyi ekler', () => {
        const win = kurSayfa()
        const { makePublicKeyLike } = yardimcilar(win)

        const pk = makePublicKeyLike(new Uint8Array(32).fill(7))
        expect(pk instanceof Uint8Array).toBe(true)
        expect(pk.length).toBe(32)
        expect(typeof pk.toBase58()).toBe('string')
        expect(pk.toString()).toBe(pk.toBase58())
        expect(pk.toBytes()).toEqual(new Uint8Array(32).fill(7))
        expect(pk.toBuffer().length).toBe(32)
        expect(pk.equals(makePublicKeyLike(new Uint8Array(32).fill(7)))).toBe(true)
        expect(pk.equals(makePublicKeyLike(new Uint8Array(32).fill(8)))).toBe(false)
    })
})

describe('solanaInjected -- standard:connect / disconnect / events', () => {
    function yanitla(win, gonderi, govde) {
        const olay = new Event('message')
        olay.source = win
        olay.data = { target: 'wats_solana_inpage', id: gonderi.id, ...govde }
        win.dispatchEvent(olay)
    }

    it('connect solana_connect gonderir ve WalletAccount dondurur', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const p = cuzdan.features['standard:connect'].connect()
        const gonderi = win.gonderilen[0]
        expect(gonderi.target).toBe('wats_content_script')
        expect(gonderi.payload.method).toBe('solana_connect')
        expect(gonderi.payload.params[0].silent).toBe(false)
        expect(gonderi.payload.params[0].appMeta.name).toBe('Jupiter')

        yanitla(win, gonderi, {
            result: {
                address: 'So11111111111111111111111111111111111111112',
                publicKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(3))),
                accountKey: 'acc-1',
            },
        })

        const { accounts } = await p
        expect(accounts.length).toBe(1)
        expect(accounts[0].address).toBe('So11111111111111111111111111111111111111112')
        expect(accounts[0].publicKey instanceof Uint8Array).toBe(true)
        expect(accounts[0].publicKey.length).toBe(32)
        // K8 / K5: accountKey sinira ASLA cikmaz.
        expect(accounts[0].accountKey).toBeUndefined()
        expect(cuzdan.accounts.length).toBe(1)
    })

    // Iptal DONDURMEMEK adaptorlerin cleanup'inda dinleyici sizdirir ve
    // bazilarinda dogrudan hata firlatir.
    it("on('change') abonelik IPTAL fonksiyonu dondurur ve itilen olay dinleyiciye ULASIR", () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const gorulen = []
        const dur = cuzdan.features['standard:events'].on('change', (d) => gorulen.push(d))
        expect(typeof dur).toBe('function')

        const itme = new Event('message')
        itme.source = win
        itme.data = { target: 'wats_solana_inpage', event: { event: 'change', payload: { accounts: [] } } }
        win.dispatchEvent(itme)
        expect(gorulen).toEqual([{ accounts: [] }])

        dur()
        win.dispatchEvent(itme)
        expect(gorulen.length).toBe(1)
    })

    it('hata yaniti REJECT eder ve kodu KORUR (4100 -> Unauthorized.)', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const p = cuzdan.features['standard:connect'].connect({ silent: true })
        yanitla(win, win.gonderilen[0], { error: { code: 4100, message: 'no session' } })

        await expect(p).rejects.toThrow('Unauthorized.')
        await p.catch((e) => { expect(e.code).toBe(4100) })
    })

    // WS lane'de hataYap'in ciktisi DOGRUDAN dapp'e gider (callBackground'in
    // TEK reddi, legacyError'dan GECMEDEN) -- burada hamMesaj'in non-enumerable
    // kalmasi tek koruma. Kod tarafinda da lane'ler AYRISIR: Phantom'un -32002
    // tablosu SS3.6 legacy sinirina ait, Wallet Standard'in kendi kod tablosu
    // YOKTUR (:160) -- ayni 4001 govdesi burada 4001 OLARAK kalir.
    it('hamMesaj non-enumerable kalir; WS lane -32002ye ESLENMEZ (4001 kalir)', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const p = cuzdan.features['standard:connect'].connect()
        yanitla(win, win.gonderilen[0], { error: { code: 4001, message: 'Request replaced by a new one.' } })

        const err = await p.catch((e) => e)
        expect(Object.keys(err)).not.toContain('hamMesaj')
        expect(JSON.parse(JSON.stringify({ ...err }))).not.toHaveProperty('hamMesaj')
        expect(err.hamMesaj).toBe('Request replaced by a new one.')
        expect(err.message).toBe('User rejected the request.')
        expect(err.code).toBe(4001)
    })

    it('EVM seridine (wats_inpage) gelen yanit Solana koprusunu ETKILEMEZ', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        let cozuldu = false
        cuzdan.features['standard:connect'].connect().then(() => { cozuldu = true })
        const olay = new Event('message')
        olay.source = win
        olay.data = { target: 'wats_inpage', id: win.gonderilen[0].id, result: {} }
        win.dispatchEvent(olay)

        await Promise.resolve()
        expect(cozuldu).toBe(false)
    })
})

// §3.4: SINIRDA HER YUK BAYTTIR ve her `solana:*` metodu DIZI dondurur.
// Tek nesne donmek, adaptorlerin yaygin `const [output] = await ...` kalibinda
// `undefined` verir -- dapp'te "cannot read properties of undefined" olarak
// patlar ve cuzdanda hicbir iz birakmaz.
describe('solanaInjected -- solana:signMessage / solana:signIn', () => {
    const ADRES = 'FzYbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'

    // Bu blok BILEREK kendi sayfa kurulumunu tasir: dosyanin ust kismindaki
    // yardimcilara baglanmak, iki bagimsiz iddia kumesini birbirine kilitler.
    function kurSayfa() {
        const dinleyiciler = []
        const gonderilen = []
        const kayitlar = []
        if (!globalThis.CustomEvent) {
            globalThis.CustomEvent = class {
                constructor(type, init) { this.type = type; this.detail = init && init.detail }
            }
        }
        globalThis.window = {
            addEventListener: (tip, fn) => { if (tip === 'message') dinleyiciler.push(fn) },
            removeEventListener: () => {},
            postMessage: (data) => { gonderilen.push(data) },
            // Kayit olayinin detail'i bir FONKSIYONDUR: uygulama tarafi onu
            // yalnizca CAGIRIR. Nesne koyulsaydi hicbir adaptor cuzdani gormezdi.
            dispatchEvent: (ev) => {
                if (ev.type === 'wallet-standard:register-wallet') ev.detail({ register: (w) => { kayitlar.push(w); return () => {} } })
            },
            location: { origin: 'https://app.jup.ag', host: 'app.jup.ag' },
        }
        globalThis.window.self = globalThis.window
        globalThis.document = { title: 'Jupiter', querySelector: () => null }
        return { dinleyiciler, gonderilen, kayitlar }
    }

    /** Bekleyen her istege sirayla yanit verir (metotlar DEGISKEN ARGUMANLI ve sirali calisir). */
    async function yanitDongusu(dinleyiciler, gonderilen, uret, tur = 6) {
        const yanitlanan = new Set()
        for (let t = 0; t < tur; t++) {
            for (const m of gonderilen) {
                if (yanitlanan.has(m.id)) continue
                yanitlanan.add(m.id)
                for (const fn of dinleyiciler) {
                    fn({ source: globalThis.window, data: { target: 'wats_solana_inpage', id: m.id, result: uret(m) } })
                }
            }
            await new Promise((r) => setTimeout(r, 0))
        }
    }

    beforeEach(() => { vi.resetModules() })
    afterEach(() => { delete globalThis.window; delete globalThis.document })

    it('signMessage DIZI dondurur, baytlari cozer ve signatureType ed25519 ekler', async () => {
        const { dinleyiciler, gonderilen, kayitlar } = kurSayfa()
        await import('./solanaInjected.js')
        const ozellik = kayitlar[0].features['solana:signMessage']
        expect(typeof ozellik.signMessage).toBe('function')
        expect(ozellik.version).toBe('1.0.0')

        const sozler = ozellik.signMessage({ account: { address: ADRES }, message: new TextEncoder().encode('merhaba') })
        await yanitDongusu(dinleyiciler, gonderilen, () => ({
            signature: btoa('s'.repeat(64)),
            signedMessage: btoa('merhaba'),
        }))
        const cikti = await sozler

        const istek = gonderilen[gonderilen.length - 1]
        expect(istek.payload.method).toBe('solana_signMessage')
        expect(istek.payload.params[0].message).toBe(btoa('merhaba'))
        expect(istek.payload.params[0].account).toBe(ADRES)

        expect(Array.isArray(cikti)).toBe(true)
        expect(cikti).toHaveLength(1)
        expect(cikti[0].signature).toBeInstanceOf(Uint8Array)
        expect(cikti[0].signature).toHaveLength(64)
        expect(new TextDecoder().decode(cikti[0].signedMessage)).toBe('merhaba')
        // signatureType TASIMADAN gelmez, sayfada eklenir (§3.3).
        expect(cikti[0].signatureType).toBe('ed25519')
    })

    // Toplu imzalama AYRI bir ozellik DEGILDIR (K2): degisken argumanli cagri
    // budur ve cikti dizisi girdi sayisiyla AYNI uzunlukta olmali.
    it('signMessage DEGISKEN ARGUMANLI: iki girdi iki cikti verir', async () => {
        const { dinleyiciler, gonderilen, kayitlar } = kurSayfa()
        await import('./solanaInjected.js')
        const soz = kayitlar[0].features['solana:signMessage'].signMessage(
            { account: { address: ADRES }, message: new TextEncoder().encode('bir') },
            { account: { address: ADRES }, message: new TextEncoder().encode('iki') },
        )
        await yanitDongusu(dinleyiciler, gonderilen, (m) => ({
            signature: btoa('s'.repeat(64)),
            signedMessage: m.payload.params[0].message,
        }))
        const cikti = await soz
        expect(cikti).toHaveLength(2)
        expect(new TextDecoder().decode(cikti[0].signedMessage)).toBe('bir')
        expect(new TextDecoder().decode(cikti[1].signedMessage)).toBe('iki')
    })

    it('signIn WalletAccount tasir: publicKey 32 baytlik Uint8Array, features STRING DIZISI', async () => {
        const { dinleyiciler, gonderilen, kayitlar } = kurSayfa()
        await import('./solanaInjected.js')
        const soz = kayitlar[0].features['solana:signIn'].signIn({ statement: 'Giris yap' })
        await yanitDongusu(dinleyiciler, gonderilen, () => ({
            address: ADRES,
            publicKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(9))),
            signedMessage: btoa('app.jup.ag wants you to sign in'),
            signature: btoa('s'.repeat(64)),
        }))
        const cikti = await soz

        expect(gonderilen[gonderilen.length - 1].payload.method).toBe('solana_signIn')
        expect(Array.isArray(cikti)).toBe(true)
        expect(cikti[0].account.address).toBe(ADRES)
        expect(cikti[0].account.publicKey).toBeInstanceOf(Uint8Array)
        expect(cikti[0].account.publicKey).toHaveLength(32)
        // features NESNE DEGIL, string DIZISIDIR (§3.4).
        expect(Array.isArray(cikti[0].account.features)).toBe(true)
        expect(cikti[0].account.features).toContain('solana:signIn')
        expect(cikti[0].account.chains).toContain('solana:mainnet')
        expect(cikti[0].signature).toBeInstanceOf(Uint8Array)
        expect(cikti[0].signatureType).toBe('ed25519')
        // `account` hesapYap'in urettigi nesnedir: SADECE `solana:*` anahtarlari.
        // Bir `standard:*` anahtarinin sizmasi, ciktinin connect'inkiyle
        // "AYNISI" OLMADIGININ kanitidir.
        expect(cikti[0].account.features.some((k) => k.indexOf('standard:') === 0)).toBe(false)
    })

    // 3.4: signIn OTURUM DA KURAR. Bu iddia olmadan arka plan
    // solana_dapps[origin] kaydini yazar ama SAYFA tarafi hala BAGLI DEGIL
    // gorunur: `accounts` bos kalir, hicbir `change` yayilmaz ve adaptor
    // kullaniciyi tekrar connect'e gonderir. Kusur yalnizca gercek bir dapp'te
    // ortaya cikardi -- imza dogru doner, oturum yok sayilir.
    it('signIn OTURUM da kurar: accounts dolar ve change YAYINLANIR', async () => {
        const { dinleyiciler, gonderilen, kayitlar } = kurSayfa()
        await import('./solanaInjected.js')
        const cuzdan = kayitlar[0]
        const degisimler = []
        cuzdan.features['standard:events'].on('change', (d) => degisimler.push(d))

        expect(cuzdan.accounts).toHaveLength(0)

        const soz = cuzdan.features['solana:signIn'].signIn({ statement: 'Giris yap' })
        await yanitDongusu(dinleyiciler, gonderilen, () => ({
            address: ADRES,
            publicKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(9))),
            signedMessage: btoa('app.jup.ag wants you to sign in'),
            signature: btoa('s'.repeat(64)),
        }))
        const cikti = await soz

        expect(cuzdan.accounts).toHaveLength(1)
        expect(cuzdan.accounts[0].address).toBe(ADRES)
        // Dondurulen hesap ile `accounts` icindeki hesap AYNI nesnedir; iki ayri
        // kopya, dapp'in kimlik karsilastirmasini sessizce dusururdu.
        expect(cuzdan.accounts[0]).toBe(cikti[0].account)
        expect(degisimler).toHaveLength(1)
        expect(degisimler[0].accounts[0].address).toBe(ADRES)
    })
})

// DOSYA SECIMI KASITLI: solanaProviderConformance.test.js, Task 6'nin metadata
// CODEGEN testidir (renderMetadataBlock/extractBlock/applyBlock) ve sayfa-kayit
// yardimcisi TASIMAZ; sayfa betigini calistiran yardimcilar Task 7'de BU
// dosyaya yazildi.
//
// KOK NEDEN (§3.2): tonConnectDevice.js'teki olum-sonrasi inceleme, yetenek
// listesinin uc yerde kopyalandigini ve ikisinin islevsiz kaldigini kaydediyor.
// Solana'da sayfa betigine gomulen metadata O IKINCI KOPYAYI yeniden yaratir;
// tek koruma bu dosyadir.
describe('solanaInjected -- solana:signTransaction (M3)', () => {
    const ADRES = 'FzYbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'

    // Task 7'nin connect/disconnect blogundaki AYNI blok-yerel yardimci: yanit,
    // sayfa seridine (`wats_solana_inpage`) bir message olayi olarak dusurulur.
    function yanitla(win, gonderi, govde) {
        const olay = new Event('message')
        olay.source = win
        olay.data = { target: 'wats_solana_inpage', id: gonderi.id, ...govde }
        win.dispatchEvent(olay)
    }

    const hesapYap = () => ({
        address: ADRES, publicKey: new Uint8Array(32), chains: ['solana:mainnet'], features: [],
    })

    it('ozellik STANDART ADLI bir FONKSIYON tasir', () => {
        const cuzdan = cuzdaniAl(solanayiYukle(kurSayfa()))
        const ozellik = cuzdan.features['solana:signTransaction']
        expect(typeof ozellik.signTransaction).toBe('function')
        expect(ozellik.version).toBe('1.0.0')
    })

    // ['legacy','0'] ya da ['legacy','v0'] yazmak adaptoru SESSIZCE
    // legacy-only'ye dusurur -- K3'un onlemek icin var oldugu sonucun ta kendisi.
    it('supportedTransactionVersions icinde SAYI 0 vardir', () => {
        const cuzdan = cuzdaniAl(solanayiYukle(kurSayfa()))
        const v = cuzdan.features['solana:signTransaction'].supportedTransactionVersions
        expect(v).toEqual(['legacy', 0])
        expect(v.includes(0)).toBe(true)
        expect(v.includes('0')).toBe(false)
    })

    // K2: `solana:signAllTransactions` diye bir ozellik YOKTUR. Bildirmek,
    // adaptorun var olmayan bir sozlesmeye guvenmesine yol acar.
    it('solana:signAllTransactions BILDIRILMEZ', () => {
        const cuzdan = cuzdaniAl(solanayiYukle(kurSayfa()))
        expect(cuzdan.features['solana:signAllTransactions']).toBeUndefined()
    })

    it('degisken argumanlidir ve DIZI doner', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const sozler = cuzdan.features['solana:signTransaction'].signTransaction(
            { account: hesapYap(), transaction: new Uint8Array([1, 2, 3]), chain: 'solana:mainnet' },
            { account: hesapYap(), transaction: new Uint8Array([4, 5, 6]), chain: 'solana:mainnet' },
        )

        // Cok girdi TEK istege biner: toplu imzalama AYRI bir metot degildir.
        const giden = win.gonderilen[win.gonderilen.length - 1]
        expect(giden.payload.method).toBe('solana_signTransaction')
        // Tasimada HER yuk base64: chrome.runtime.sendMessage JSON serilestirir
        // ve typed array'i {"0":1,"1":2,...} nesnesine cevirir (§3.3).
        expect(giden.payload.params[0].transactions).toEqual(['AQID', 'BAUG'])
        expect(giden.payload.params[0].chain).toBe('solana:mainnet')
        // account NESNE degil, base58 ADRES DIZGISIDIR: arka plan
        // grantedSolanaSession'i bu dizgiyle eslestirir. WalletAccount
        // NESNESI gitseydi (`inputs[0].account?.address`'teki `?.address`
        // dusseydi) hicbir oturum eslesmez, dapp'in imzala dugmesi HER ZAMAN
        // 4100 Unauthorized doner -- Task 24'un signMessage bloguyla (:355)
        // AYNI iddia.
        expect(giden.payload.params[0].account).toBe(ADRES)

        // Yanit baytlari BILEREK girdi baytlarindan FARKLI: cikti bunlarla
        // eslestirilirse asagidaki iddia yalniz "istek nesnesi geri mi
        // gecti"yi olcer, wallet'in yanitinin GERCEKTEN okundugunu kanitlamaz.
        yanitla(win, giden, { result: { signedTransactions: ['CQkJ', 'CAgI'] } })
        const cikti = await sozler

        // Tek nesne donmek, adaptorlerin yaygin `const [output] = await ...`
        // kalibinda undefined verirdi.
        expect(Array.isArray(cikti)).toBe(true)
        expect(cikti).toHaveLength(2)
        expect(cikti[0].signedTransaction).toBeInstanceOf(Uint8Array)
        expect(Array.from(cikti[0].signedTransaction)).toEqual([9, 9, 9])
        // ikinci girdinin ciktisi da AYRICA sinanir: yalniz cikti[0]'a bakmak
        // `signed.map(() => signed[0])` gibi kopyala-yapistir bir indeksleme
        // hatasini -- ilk imzanin HER islemeye yapistirilmasini -- yakalayamazdi.
        expect(cikti[1].signedTransaction).toBeInstanceOf(Uint8Array)
        expect(Array.from(cikti[1].signedTransaction)).toEqual([8, 8, 8])
    })

    it('beklenmedik yanit uzunlugunda HATA FIRLATIR (sessizce kirpmaz)', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))
        const soz = cuzdan.features['solana:signTransaction'].signTransaction(
            { account: hesapYap(), transaction: new Uint8Array([1]), chain: 'solana:mainnet' },
            { account: hesapYap(), transaction: new Uint8Array([2]), chain: 'solana:mainnet' },
        )
        const giden = win.gonderilen[win.gonderilen.length - 1]
        yanitla(win, giden, { result: { signedTransactions: ['AQ=='] } })
        await expect(soz).rejects.toThrow()
    })

    // K3: `chain` SolanaSignTransactionInput'ta OPSIYONELDIR. Butun diger
    // testler chain'i ACIKCA gonderdigi icin 359. satirdaki varsayilan dal hic
    // calismazdi -- import'suz bu dosyada yanlis yazilmis bir sabit (bilinen
    // tehlike) ANCAK boyle yakalanir.
    it('chain GECMEZSE WALLET_STANDARD_METADATA.chains[0] varsayilir', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const soz = cuzdan.features['solana:signTransaction'].signTransaction(
            { account: hesapYap(), transaction: new Uint8Array([1, 2, 3]) },
        )
        const giden = win.gonderilen[win.gonderilen.length - 1]
        expect(giden.payload.params[0].chain).toBe('solana:mainnet')

        yanitla(win, giden, { result: { signedTransactions: ['CQkJ'] } })
        await soz
    })

    // Onceki iddia varsayilanla AYNI dizgiyi (`solana:mainnet`) sinadigi icin
    // 359. satir tumden `WALLET_STANDARD_METADATA.chains[0]`'a sabitlenip
    // `inputs[0].chain`'i yok saysa bile GECERDI. Arka plandaki cluster
    // kapisi dapp'in ISTEDIGI kumeyi gorebilsin diye chain, varsayilandan
    // FARKLI bir degerle sinanmali.
    it('chain FARKLI bir kume istenirse degistirilmeden iletilir', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const soz = cuzdan.features['solana:signTransaction'].signTransaction(
            { account: hesapYap(), transaction: new Uint8Array([1, 2, 3]), chain: 'solana:devnet' },
        )
        const giden = win.gonderilen[win.gonderilen.length - 1]
        expect(giden.payload.params[0].chain).toBe('solana:devnet')

        yanitla(win, giden, { result: { signedTransactions: ['CQkJ'] } })
        await soz
    })
})

// M4: solana:signAndSendTransaction. K2 (duzeltme, task-41 incelemesi): bu
// metot da -- signMessage/signIn/signTransaction gibi -- DEGISKEN ARGUMANLIDIR.
// "solana:signAndSendAllTransactions" diye bir Wallet Standard ozelligi
// YOKTUR (onceki surumun ret mantigi yanlisti); toplu yayin, ayni metodun
// SIRALI cok girdiyle cagrilmasidir. Task 38'in kapisi TEK islem aldigi icin
// (params[0] bir dizi degil tek nesne) HER girdi KENDI istegini acar.
describe('solanaInjected -- solana:signAndSendTransaction (M4)', () => {
    const ADRES = 'FzYbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
    // 64 baytlik SABIT bir desen: istekteki islem baytlarindan (`[1,2,3]` / `[9]`)
    // BILEREK FARKLI, ciktinin arka plan yanitindan GERCEKTEN okundugunu (istek
    // baytlarinin geri yansitilmadigini) kanitlar.
    const IMZA = new Uint8Array(64).fill(7)
    const IMZA_B64 = btoa(String.fromCharCode(...IMZA))

    // Task 7'nin connect/disconnect blogundaki AYNI blok-yerel yardimci.
    function yanitla(win, gonderi, govde) {
        const olay = new Event('message')
        olay.source = win
        olay.data = { target: 'wats_solana_inpage', id: gonderi.id, ...govde }
        win.dispatchEvent(olay)
    }

    const hesapYap = () => ({
        address: ADRES, publicKey: new Uint8Array(32), chains: ['solana:mainnet'], features: [],
    })

    it('ozellik STANDART ADLI bir FONKSIYON tasir ve supportedTransactionVersions icinde SAYI 0 vardir', () => {
        const cuzdan = cuzdaniAl(solanayiYukle(kurSayfa()))
        const ozellik = cuzdan.features['solana:signAndSendTransaction']
        expect(typeof ozellik.signAndSendTransaction).toBe('function')
        expect(ozellik.version).toBe('1.0.0')
        // '0' (dizge) yazmak adaptoru SESSIZCE legacy-only'ye dusurur -- bunu
        // onlemek icin bu iddia var.
        expect(ozellik.supportedTransactionVersions).toContain(0)
        expect(ozellik.supportedTransactionVersions).not.toContain('0')
    })

    // K2: `solana:signAndSendAllTransactions` diye bir ozellik YOKTUR. Bildirmek,
    // adaptorun var olmayan bir sozlesmeye guvenmesine yol acar.
    it('solana:signAndSendAllTransactions BILDIRILMEZ', () => {
        const cuzdan = cuzdaniAl(solanayiYukle(kurSayfa()))
        expect(cuzdan.features['solana:signAndSendAllTransactions']).toBeUndefined()
    })

    it('istek base64 islem, chain, hesap adresi ve options ile arka plana gider', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const soz = cuzdan.features['solana:signAndSendTransaction'].signAndSendTransaction({
            account: hesapYap(),
            transaction: new Uint8Array([1, 2, 3]),
            chain: 'solana:mainnet',
            options: { maxRetries: 2 },
        })

        const giden = win.gonderilen.find((m) => m.payload?.method === 'solana_signAndSendTransaction')
        expect(giden.target).toBe('wats_content_script')
        const p = giden.payload.params[0]
        expect(p.transaction).toBe(btoa(String.fromCharCode(1, 2, 3)))
        // `chain` ZORUNLUDUR: olmadan arka plandaki cluster kapisi HIC
        // tetiklenemez ve devnet isteyen bir dapp sessizce mainnet'te yayinlanir.
        expect(p.chain).toBe('solana:mainnet')
        // account NESNE degil, base58 ADRES DIZGISIDIR: arka plan
        // grantedSolanaSession'i bu dizgiyle eslestirir. WalletAccount NESNESI
        // gitseydi (`.address` dusseydi) hicbir oturum eslesmez, dapp'in
        // "gonder" dugmesi HER ZAMAN 4100 Unauthorized doner -- Task 24/33
        // ile AYNI iddia.
        expect(p.account).toBe(ADRES)
        expect(p.options).toEqual({ maxRetries: 2 })

        yanitla(win, giden, { result: { signature: 'SIG58', signatureBytes: IMZA_B64 } })
        await soz
    })

    it('DIZI doner ve imza 64 baytlik Uint8Array tir (base58 DIZGE DEGIL)', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const soz = cuzdan.features['solana:signAndSendTransaction'].signAndSendTransaction({
            account: hesapYap(), transaction: new Uint8Array([9]), chain: 'solana:mainnet',
        })
        const giden = win.gonderilen.find((m) => m.payload?.method === 'solana_signAndSendTransaction')
        yanitla(win, giden, { result: { signature: 'SIG58', signatureBytes: IMZA_B64 } })

        const cikti = await soz
        // `const [output] = await ...` adaptorlerin yaygin kalibidir; tek nesne
        // donmek burada `undefined` verirdi.
        expect(Array.isArray(cikti)).toBe(true)
        expect(cikti).toHaveLength(1)
        const [out] = cikti
        expect(out.signature).toBeInstanceOf(Uint8Array)
        expect(out.signature).toHaveLength(64)
        expect(Array.from(out.signature)).toEqual(Array.from(IMZA))
        expect(typeof out.signature).not.toBe('string')
    })

    // DEGISKEN ARGUMANLI (K2 duzeltmesi): iki girdi iki AYRI istek acar, SIRAYLA.
    // Ikinci istek ilki cozulmeden ASLA gitmez -- openApprovalWindow'un TEK
    // UCUSLUK kilidi yuzunden (Task 24/33); Promise.all yazsaydik ikinci girdi
    // 4001 ile reddedilirdi. Iki yanit da BILEREK farkli 64 baytlik desenler
    // (fill(7) / fill(9)): cikti[1]'in cikti[0] ile AYNI olmadigini kanitlar --
    // Task 33'un "ilk sonucu her girdiye tekrarlama" mutanti burada da olur.
    it('iki girdi SIRALI iki istek gonderir ve DIZI 2 eleman doner', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))
        const IMZA2 = new Uint8Array(64).fill(9)
        const IMZA2_B64 = btoa(String.fromCharCode(...IMZA2))

        const soz = cuzdan.features['solana:signAndSendTransaction'].signAndSendTransaction(
            { account: hesapYap(), transaction: new Uint8Array([1, 2, 3]), chain: 'solana:mainnet' },
            { account: hesapYap(), transaction: new Uint8Array([4, 5, 6]), chain: 'solana:mainnet' },
        )

        // Ilk `await`e kadar sencron calisir: ikinci girdinin istegi HENUZ
        // gonderilmemis olmali.
        let istekler = win.gonderilen.filter((m) => m.payload?.method === 'solana_signAndSendTransaction')
        expect(istekler).toHaveLength(1)
        expect(istekler[0].payload.params[0].transaction).toBe(btoa(String.fromCharCode(1, 2, 3)))

        yanitla(win, istekler[0], { result: { signature: 'SIG58A', signatureBytes: IMZA_B64 } })
        // Async fonksiyonun devami bir mikro-gorev turu ISTER; setTimeout(0) ile
        // guvenli bir tik beklenir (dosyadaki yanitDongusu ile AYNI teknik).
        await new Promise((r) => setTimeout(r, 0))

        istekler = win.gonderilen.filter((m) => m.payload?.method === 'solana_signAndSendTransaction')
        expect(istekler).toHaveLength(2)
        expect(istekler[1].payload.params[0].transaction).toBe(btoa(String.fromCharCode(4, 5, 6)))

        yanitla(win, istekler[1], { result: { signature: 'SIG58B', signatureBytes: IMZA2_B64 } })

        const cikti = await soz
        expect(cikti).toHaveLength(2)
        expect(Array.from(cikti[0].signature)).toEqual(Array.from(IMZA))
        expect(Array.from(cikti[1].signature)).toEqual(Array.from(IMZA2))
    })

    // Wallet Standard/Phantom referans davranisi: girdisiz cagri BOS DIZI doner,
    // istek ACILMAZ. Eskiden `inputs.length !== 1` FIRLATIRDI -- var olmayan
    // "solana:signAndSendAllTransactions" varsayimina dayanan yanlis bir kisit.
    it('sifir girdi ile cagrilirsa BOS DIZI doner ve HICBIR istek gonderilmez', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const cikti = await cuzdan.features['solana:signAndSendTransaction'].signAndSendTransaction()

        expect(cikti).toEqual([])
        expect(win.gonderilen.find((m) => m.payload?.method === 'solana_signAndSendTransaction')).toBeUndefined()
    })

    // Paylasimli hataYap() yolu burada da CALISMALI: Reddet'e tiklayan
    // kullanici dapp'e 4001'i KORUNMUS gormeli, `undefined.signature` okuyan
    // bir cokme degil. `standard:connect`in :262-268'deki AYNI iddiasi.
    it('hata yaniti REJECT eder ve kodu KORUR (4001 -> User rejected the request.)', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const soz = cuzdan.features['solana:signAndSendTransaction'].signAndSendTransaction({
            account: hesapYap(), transaction: new Uint8Array([1]), chain: 'solana:mainnet',
        })
        const giden = win.gonderilen.find((m) => m.payload?.method === 'solana_signAndSendTransaction')
        yanitla(win, giden, { error: { code: 4001, message: 'User rejected the request' } })

        await expect(soz).rejects.toThrow('User rejected the request.')
        await soz.catch((e) => { expect(e.code).toBe(4001) })
    })

    // chain FARKLI bir kume istenirse degistirilmeden iletilir. signTransaction'in
    // aksine burada varsayilan UYGULANMAZ: SolanaSignAndSendTransactionInput'ta
    // `chain` OPSIYONEL DEGILDIR, adaptor onu HER ZAMAN gonderir.
    it('chain FARKLI bir kume istenirse degistirilmeden iletilir', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const soz = cuzdan.features['solana:signAndSendTransaction'].signAndSendTransaction({
            account: hesapYap(), transaction: new Uint8Array([1, 2, 3]), chain: 'solana:devnet',
        })
        const giden = win.gonderilen.find((m) => m.payload?.method === 'solana_signAndSendTransaction')
        expect(giden.payload.params[0].chain).toBe('solana:devnet')

        yanitla(win, giden, { result: { signature: 'SIG58', signatureBytes: IMZA_B64 } })
        await soz
    })
})

// LEGACY window.solana yuzeyi (SS3.5) -- kaynak taramasi DEGIL, sahte bir
// pencerede GERCEKTEN calistirilarak (injectedProvider.test.js'in deseni).
//
// KOK NEDEN: solanaInjected.js hicbir sey EXPORT ETMEZ ve hicbir sey IMPORT
// ETMEZ (SS4.1) -- bir <script> gibi modul kapsaminda `window`a dokunur. Tek
// dogru olcum yontemi kaynagi `new Function` ile calistirmaktir.
//
// DIKKAT: betigin TAMAMI tek bir try/catch icindedir (SS4.1) -- bir hata
// ziyaret edilen sayfaya sizmaz, ama TESTTE de gorunmez: kurulum yarida
// kalirsa `window.solana` sessizce undefined kalir. Asagidaki iddialarin
// "undefined" ile patlamasi neredeyse her zaman betigin ICINDE atilmis bir
// hatadir, eksik bir uye degil.
//
// IMPORT BASLIGI YOK, KAYNAK SABITI YOK: `describe`, `it`, `expect`,
// `readFileSync` ve `SOLANA_KAYNAK` / `EVM_KAYNAK` M1 Gorev 7'de dosyanin
// basinda ZATEN bildirildi. Modul kapsaminda ikinci kez bildirmek sozcuksel
// bir yeniden bildirimdir: `SyntaxError: Identifier 'describe' has already
// been declared` -- dosya hic ayrisamaz, M1/M2/M5 suitleri birlikte gider.
// Blok bu yuzden dogrudan asagidaki yardimciyla baslar.

/**
 * Sahte sayfa dunyasi. `document` de parametre olarak verilir: sayfa betigi
 * appMeta'yi document.title + link[rel=icon]'dan uretir ve node'da boyle bir
 * global YOKTUR -- eksik birakmak betigi tek try/catch'inde sessizce oldururdu.
 *
 * AD BILEREK FARKLI: bu dosyanin MODUL KAPSAMINDA M1 Gorev 7'nin `kurSayfa()`
 * bildirimi ZATEN var. ES modulunde ayni adin iki kez bildirilmesi SyntaxError'dur
 * -- dosya hic yuklenmez ve M1/M2'nin butun iddialari da onunla birlikte gider.
 */
function kurLegacySayfa({ mevcutSolana, onceInjected } = {}) {
    const dinleyiciler = []
    const gonderilen = []
    const win = {
        addEventListener: (tip, fn) => { if (tip === 'message') dinleyiciler.push(fn) },
        removeEventListener: () => {},
        postMessage: (data) => { gonderilen.push(data) },
        dispatchEvent: () => {},
        location: { origin: 'https://app.jup.ag', hostname: 'app.jup.ag' },
    }
    win.self = win
    if (mevcutSolana) win.solana = mevcutSolana
    // TERS SIRA: manifest dizisi injected.js'i once yaziyor, ama siraya
    // GUVENILMEZ (tonInjected.test.js'teki ayni gerekce).
    if (onceInjected) new Function('window', 'crypto', EVM_KAYNAK)(win, globalThis.crypto)
    const doc = { title: 'Jupiter', querySelector: () => null }
    new Function('window', 'document', 'crypto', SOLANA_KAYNAK)(win, doc, globalThis.crypto)
    const ctx = { win, dinleyiciler, gonderilen }
    // Garantili serit bir KAYITTIR (M1 kurar); legacy saglayici onun
    // `.legacy` alanindadir. Kaydin kendisini saglayici sanmak, M4'un
    // `.wallet.features` okumasiyla ayni alani iki sekle sokardi.
    ctx.solana = win.wats && win.wats.solana ? win.wats.solana.legacy : undefined
    return ctx
}

/** content.js'in sayfaya geri gonderdigi mesajin esdegeri. */
function yanitla(ctx, data) {
    for (const fn of ctx.dinleyiciler) fn({ source: ctx.win, data })
}

/** Bir metot icin giden SON istek. Baslangic trafigine karsi dayanikli. */
function istek(ctx, method) {
    for (let i = ctx.gonderilen.length - 1; i >= 0; i -= 1) {
        const m = ctx.gonderilen[i]
        if (m && m.target === 'wats_content_script' && m.payload && m.payload.method === method) return m
    }
    throw new Error(method + ' icin giden istek YOK')
}

const cozumle = (ctx, method, result) =>
    yanitla(ctx, { target: 'wats_solana_inpage', id: istek(ctx, method).id, result })
const reddet = (ctx, method, error) =>
    yanitla(ctx, { target: 'wats_solana_inpage', id: istek(ctx, method).id, error })

// `export` YOK. Bu dosyayi hicbir sey import etmiyor; disari acmak, baska bir
// dosyanin onu iceri alip BUTUN describe'lari ikinci kez calistirmasina
// davetiye olurdu. `yanitla` / `istek` / `cozumle` / `reddet` adlari bu dosyada
// baska hicbir yerde bildirilmiyor (M1 Gorev 7 modul kapsaminda yalnizca
// `SOLANA_KAYNAK`, `EVM_KAYNAK`, `kurSayfa`, `solanayiYukle`, `cuzdaniAl` ve
// `yardimcilar`i bildiriyor; M2 Gorev 24'unkiler kendi describe'inin ICINDE)
// -- bu yuzden korundular. Ilk iki sabit BURADA YENIDEN OKUNMAZ, aynen
// KULLANILIR: ayni adi ikinci kez bildirmek de, ayni dosyayi ikinci kez
// okuyan yeni bir ad acmak da gereksiz.

describe('legacy window.solana -- kurulum', () => {
    it('bos yuvada window.solana ve window.wats.solana.legacy AYNI nesnedir', () => {
        const ctx = kurLegacySayfa()
        expect(ctx.solana).toBeTruthy()
        expect(ctx.win.solana).toBe(ctx.solana)
        expect(ctx.solana.legacySlot).toBe('ours')
        expect(ctx.solana.isConnected).toBe(false)
        expect(ctx.solana.publicKey).toBe(null)
        // KOK NEDEN (inceleme bulgusu I2): M5'in KAYDI EZMEDIGINI (yalnizca
        // `.legacy`/`.legacySlot` ALANLARINI doldurdugunu) hicbir test dogrudan
        // OLCMUYORDU -- M3/M4 cuzdani `register-wallet` olayindan (`cuzdaniAl`)
        // aliyor, KAYITTAN degil. `window.wats.solana = { ...window.wats.solana,
        // legacy }` gibi bir YENIDEN OLUSTURMA da BURAYA kadar butun testleri
        // yesil birakirdi. `.wallet.features`in HALA M1'in kurdugu nesnede
        // olmasi, kaydin MUTASYONLA doldurulmus olmasinin tek dogrudan kaniti.
        expect(Object.keys(ctx.win.wats.solana.wallet.features)).toContain('solana:signAndSendTransaction')
    })

    // K1: `window.phantom` ve `isPhantom` kimlik taklididir ve kullanicinin
    // saglayici secim arayuzunu bozar. Bunu bir kez yazip birakmak yetmez --
    // "dapp X bizi gormuyor" baskisi altinda eklenen ilk satir tam budur.
    it('isPhantom ASLA yazilmaz, window.phantom ASLA kurulmaz', () => {
        const ctx = kurLegacySayfa()
        expect('isPhantom' in ctx.solana).toBe(false)
        expect(ctx.win.phantom).toBeUndefined()
    })

    // SS3.1: yuvayi baskasi kapmissa OZERINE YAZILMAZ. Yazsaydik, o cuzdanin
    // `Object.defineProperty` ile kilitledigi bir yuvada bizim atamamiz
    // patlar ve tek try/catch tum Solana seridini sessizce oldururdu.
    it('yuva DOLUYSA devredilir, garantili serit (window.wats.solana) yine BIZDE', () => {
        const baskaCuzdan = { baska: true }
        const ctx = kurLegacySayfa({ mevcutSolana: baskaCuzdan })
        expect(ctx.win.solana).toBe(baskaCuzdan)
        expect(ctx.solana.legacySlot).toBe('ceded')
        expect(typeof ctx.solana.on).toBe('function')
    })

    // `if (!window.solana)` bir POLITIKA degil bir YARIS (SS3.1): sayfanin
    // kendi betigi ya da baska bir uzanti ayni tick'te yazmis olabilir ve
    // sonra kendi yuvasini bosaltabilir.
    it('yuva SONRADAN bosalirsa mikro-gorevde geri alinir', async () => {
        const ctx = kurLegacySayfa({ mevcutSolana: { baska: true } })
        expect(ctx.solana.legacySlot).toBe('ceded')

        delete ctx.win.solana
        await Promise.resolve()

        expect(ctx.win.solana).toBe(ctx.solana)
        expect(ctx.solana.legacySlot).toBe('ours')
    })
})

describe('legacy window.solana -- on/off/removeListener', () => {
    it('uc olay uyesi de vardir ve removeListener off un TAKMA ADIDIR', () => {
        const ctx = kurLegacySayfa()
        for (const ad of ['on', 'off', 'removeListener']) {
            expect(typeof ctx.solana[ad], ad).toBe('function')
        }
        expect(ctx.solana.removeListener).toBe(ctx.solana.off)
    })

    // `off` ZORUNLUDUR: adaptorler disconnect'te wallet.off(...) cagirir ve
    // eksikse TAM ORADA patlar (SS3.5). Hic abone olunmamis bir olayda
    // cagrilmasi da yaygin -- dinleyici tablosu bos iken PATLAMAMALI.
    it('hic abone olunmamis bir olayda off PATLAMAZ', () => {
        const ctx = kurLegacySayfa()
        expect(() => ctx.solana.off('accountChanged', () => {})).not.toThrow()
    })

    // KOK NEDEN (inceleme bulgusu I1): yukaridaki iki test ne `on`in dinleyiciyi
    // GERCEKTEN kaydettigini ne de `off`in teslimati GERCEKTEN durdurdugunu
    // kanitliyor -- ikisi de yalnizca uye varligini/takma adi olcuyor. `legacyEmit`
    // sayfaya ACILMAZ (M5'in urettigi yuzeyde yok), ama disari acilmasi da
    // GEREKMEZ: M1'in `yardimcilar()` deseninin aynisi ile (SOLANA_KAYNAK'a
    // `\nreturn {...}` eklemek, sloppy modda blok-ici `function` bildirimi
    // fonksiyon kapsamina cikar) kaynaktan DOGRUDAN sokulebilir. Kaynak
    // tekrar calistirilmaz -- AYNI `new Function` cagrisi hem `window.wats`i
    // kurar hem de `legacyEmit`i geri dondurur; ikisi AYNI kapanistadir.
    it('off SONRASI dinleyici ARTIK cagrilmaz', () => {
        const win = {
            addEventListener: () => {}, removeEventListener: () => {}, postMessage: () => {},
            dispatchEvent: () => {}, location: { origin: 'https://app.jup.ag', hostname: 'app.jup.ag' },
        }
        win.self = win
        const doc = { title: 'Jupiter', querySelector: () => null }
        const { legacyEmit } = new Function(
            'window', 'document', 'crypto',
            SOLANA_KAYNAK + '\nreturn { legacyEmit }',
        )(win, doc, globalThis.crypto)
        const p = win.wats.solana.legacy

        const dinleyici = vi.fn()
        p.on('accountChanged', 1) // fonksiyon olmayan sessizce yok sayilir
        p.on('accountChanged', dinleyici)
        legacyEmit('accountChanged', { a: 1 })
        expect(dinleyici).toHaveBeenCalledTimes(1)

        p.removeListener('accountChanged', dinleyici)
        legacyEmit('accountChanged', { a: 2 })
        expect(dinleyici).toHaveBeenCalledTimes(1)
    })
})

describe('window.wats UC yazicili -- iki yukleme sirasinda da serit KAYBOLMAZ', () => {
    it('injected.js SONRA yuklenirse window.wats.solana kaydi KORUNUR', () => {
        const ctx = kurLegacySayfa()
        new Function('window', 'crypto', EVM_KAYNAK)(ctx.win, globalThis.crypto)

        // EVM saglayicisinin KENDI uyeleri de gelmis olmali: yalnizca solana'nin
        // hayatta kalmasi yetmez, duz atamanin ustune binen savunmaci kod EVM
        // tarafini da kirmamali (tonInjected.test.js'teki ayni iddia).
        expect(ctx.win.wats.isWatsWallet).toBe(true)
        expect(typeof ctx.win.wats.request).toBe('function')
        expect(ctx.win.wats.solana.legacy).toBe(ctx.solana)
    })

    it('injected.js ONCE yuklenirse EVM seridi KORUNUR (wats yeniden ATANMAZ)', () => {
        const ctx = kurLegacySayfa({ onceInjected: true })
        expect(ctx.win.wats.isWatsWallet).toBe(true)
        expect(typeof ctx.win.wats.request).toBe('function')
        expect(ctx.win.wats.solana.legacy).toBe(ctx.solana)
    })
})

// ===================== Task 43: legacy connect =====================
// BAGIMSIZ ORAKL: PublicKey, gomulu base58 kodlayicimizin dogrulugunu KENDI
// iddiamizla degil, web3.js'in kendi uygulamasiyla olcer (base58.test.js'te
// alinan ayni karar).
const ADRES = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const PK_BAYT = new PublicKey(ADRES).toBytes()
const PK_B64 = Buffer.from(PK_BAYT).toString('base64')

/** Legacy seritte oturum acar. */
async function baglan(ctx) {
    const p = ctx.solana.connect()
    // postMessage senkron gider; yine de bir mikro-gorev birakiyoruz ki
    // callBackground'in ileride degisebilecek ic zamanlamasi testi kirmasin.
    await Promise.resolve()
    cozumle(ctx, 'solana_connect', { address: ADRES, publicKey: PK_B64 })
    return p
}

describe('legacy connect', () => {
    it('onlyIfTrusted tasimanin silent alanina cevrilir', async () => {
        const ctx = kurLegacySayfa()
        const p = ctx.solana.connect({ onlyIfTrusted: true })
        await Promise.resolve()
        const m = istek(ctx, 'solana_connect')
        expect(m.payload.params[0].silent).toBe(true)
        cozumle(ctx, 'solana_connect', { address: ADRES, publicKey: PK_B64 })
        await p
    })

    // Sessiz yoklamanin TUM amaci budur: oturum yoksa arka plan pencere
    // ACMADAN reddeder. Sayfa betigi bunu KENDI KENDINE zorlamaz -- yalnizca
    // `silent` bayragini tasimaya gecirir (yukaridaki test) ve karari arka
    // plana birakir. Buradaki test o kararin REDDEDEN ucunu, VE sayfa
    // tarafinin ikinci bir "onay" ya da "pencere ac" istegi ATMADIGINI
    // (tasimadan cikan TEK istegin silent:true tasidigini) dogrular --
    // yalnizca "reddetti" degil.
    it('onlyIfTrusted oturum YOKKEN, pencere acan bir istek gitmeden 4100 ile reddedilir', async () => {
        const ctx = kurLegacySayfa()
        const p = ctx.solana.connect({ onlyIfTrusted: true })
        await Promise.resolve()
        const m = istek(ctx, 'solana_connect')
        expect(m.payload.params[0].silent).toBe(true)

        // Arka plan `silent:true` + oturum yok halinde SOLANA_YETKISIZ = {code:4100,
        // message:'Unauthorized.'} yollar (solanaDappFunctions.js:49, :133-136) --
        // 4001 hicbir zaman gonderilmez, bu yuzden stub gercek zarfi yansitir
        // (Gorev 45 incelemesi, Gorev 43'un burada yanlis kodla kurdugu stub'i duzeltir).
        reddet(ctx, 'solana_connect', { code: 4100, message: 'Unauthorized.' })
        await expect(p).rejects.toMatchObject({ code: 4100 })

        // TEK istek gitti: arka plan pencere acmadan reddetti, sayfa ikinci
        // bir istekle onay/pencere ACMAYA calismadi.
        const solanaConnectIstekleri = ctx.gonderilen.filter(
            (g) => g && g.target === 'wats_content_script' && g.payload && g.payload.method === 'solana_connect',
        )
        expect(solanaConnectIstekleri.length).toBe(1)
    })

    it('argumansiz connect silent:false gonderir ve appMeta tasir', async () => {
        const ctx = kurLegacySayfa()
        const p = ctx.solana.connect()
        await Promise.resolve()
        const m = istek(ctx, 'solana_connect')
        expect(m.payload.params[0].silent).toBe(false)
        // appMeta sayfa betiginin urettigi bir TASIMA alanidir (SS3.3) ve
        // ekranda YALNIZCA "iddia edilen" rozetinde gosterilir.
        expect(m.payload.params[0].appMeta).toBeTruthy()
        cozumle(ctx, 'solana_connect', { address: ADRES, publicKey: PK_B64 })
        await p
    })

    it('cozulunce {publicKey} doner, isConnected true olur, connect olayi yayilir', async () => {
        const ctx = kurLegacySayfa()
        const gorulen = []
        ctx.solana.on('connect', (pk) => gorulen.push(pk))

        const sonuc = await baglan(ctx)

        expect(sonuc.publicKey).toBe(ctx.solana.publicKey)
        expect(ctx.solana.isConnected).toBe(true)
        expect(gorulen).toEqual([ctx.solana.publicKey])
    })

    // TEK OTURUM: legacy seritten baglanan bir dapp'in yaninda Wallet Standard
    // adaptorunu kullanan bir baska kutuphane de AYNI hesabi gormeli --
    // arka uc TEK oturum tutuyor, sayfa tarafinda IKI BAGIMSIZ durum olursa
    // biri bagli biri degil sanan iki kutuphane ayni sekmede CELISIR.
    it('legacy connect SONRASI window.wats.solana.wallet AYNI hesabi gorur (tek oturum)', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)

        const standartHesaplar = ctx.win.wats.solana.wallet.accounts
        expect(standartHesaplar.length).toBe(1)
        expect(standartHesaplar[0].publicKey.toBase58()).toBe(ADRES)
        expect(standartHesaplar[0].publicKey.toBase58()).toBe(ctx.solana.publicKey.toBase58())
    })
})

describe('legacy publicKey -- PublicKey-benzeri sarmalayici (SS3.5)', () => {
    // ASIL IDDIA: dapp'in `new PublicKey(provider.publicKey)` cagrisi. Duz bir
    // nesne dondurulseydi web3.js bunu "Invalid public key input" ile
    // patlatirdi -- sarmalayicinin GERCEK bir Uint8Array olmasinin tek sebebi budur.
    it('new PublicKey(provider.publicKey) CALISIR ve ayni adresi verir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        expect(new PublicKey(ctx.solana.publicKey).toBase58()).toBe(ADRES)
    })

    it('gercek bir Uint8Array dir ve 32 ham bayt tasir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        expect(ctx.solana.publicKey).toBeInstanceOf(Uint8Array)
        expect(Uint8Array.from(ctx.solana.publicKey)).toEqual(PK_BAYT)
    })

    it('toBase58 / toString / toJSON base58 verir; kucultme YOKTUR (K8)', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const pk = ctx.solana.publicKey
        expect(pk.toBase58()).toBe(ADRES)
        expect(pk.toString()).toBe(ADRES)
        expect(pk.toJSON()).toBe(ADRES)
        expect(String(pk)).toBe(ADRES)
        expect(pk.toBase58()).not.toBe(ADRES.toLowerCase())
    })

    it('toBytes / toBuffer KOPYA verir -- cagiran icerigi bozamaz', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const pk = ctx.solana.publicKey
        const kopya = pk.toBytes()
        kopya[0] = 255
        expect(pk[0]).toBe(PK_BAYT[0])
        expect(Uint8Array.from(pk.toBuffer())).toEqual(PK_BAYT)
    })

    it('equals hem gercek PublicKey hem ham bayt ile calisir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const pk = ctx.solana.publicKey
        expect(pk.equals(new PublicKey(ADRES))).toBe(true)
        expect(pk.equals(PK_BAYT)).toBe(true)
        expect(pk.equals(new PublicKey('11111111111111111111111111111111'))).toBe(false)
        expect(pk.equals(null)).toBe(false)
    })

    // toBytes'i OLMAYAN, yalnizca toBase58 tasiyan bir nesneyle karsilastirma:
    // duz bir nesne sarmalayici ya da yalnizca bayt karsilastiran bir equals
    // burada `bayt.length` tanimsiz kalip HER ZAMAN false dondururdu -- bu test
    // O YOLU KAPATMAK icin var.
    it('equals yalnizca toBase58 tasiyan bir nesneyle de calisir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const pk = ctx.solana.publicKey
        expect(pk.equals({ toBase58: () => ADRES })).toBe(true)
        expect(pk.equals({ toBase58: () => '11111111111111111111111111111111' })).toBe(false)
    })
})

// ===================== Gorev 44: disconnect, olay yayini, cuzdan kaynakli change =====================
describe('legacy disconnect', () => {
    it('solana_disconnect gonderir, durumu temizler ve disconnect olayini yayar', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const gorulen = []
        ctx.solana.on('disconnect', () => gorulen.push('disconnect'))

        const p = ctx.solana.disconnect()
        await Promise.resolve()
        cozumle(ctx, 'solana_disconnect', {})
        await expect(p).resolves.toBeUndefined()

        expect(ctx.solana.isConnected).toBe(false)
        expect(ctx.solana.publicKey).toBe(null)
        expect(gorulen).toEqual(['disconnect'])
    })

    // Arka plan hata donse bile dapp'in gordugu sey KESILMIS bir oturumdur.
    // Yerel durumu "bagli" birakmak `isConnected` ile gercegi celiskiye dusurur.
    it('arka plan hata donse de yerel durum TEMIZLENIR, hata yine de firlatilir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)

        const p = ctx.solana.disconnect()
        await Promise.resolve()
        reddet(ctx, 'solana_disconnect', { code: 4100, message: 'Unauthorized.' })

        await expect(p).rejects.toThrow('Unauthorized.')
        expect(ctx.solana.isConnected).toBe(false)
        expect(ctx.solana.publicKey).toBe(null)
    })
})

describe('legacy -- cuzdanin KENDI baslattigi change olayi (SS7.3)', () => {
    it('{accounts: []} accountChanged(null) + disconnect yayar', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const gorulen = []
        ctx.solana.on('accountChanged', (pk) => gorulen.push(['accountChanged', pk]))
        ctx.solana.on('disconnect', () => gorulen.push(['disconnect']))

        yanitla(ctx, { target: 'wats_solana_inpage', event: { event: 'change', payload: { accounts: [] } } })

        expect(gorulen).toEqual([['accountChanged', null], ['disconnect']])
        expect(ctx.solana.isConnected).toBe(false)
        expect(ctx.solana.publicKey).toBe(null)
    })

    it('istek YANITLARI (id tasiyan govde) olay hattina DUSMEZ', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const gorulen = []
        ctx.solana.on('disconnect', () => gorulen.push('disconnect'))

        // connect yanitinin kendisi: `event` alani yok, `accounts` yok.
        yanitla(ctx, { target: 'wats_solana_inpage', id: 'x', result: { address: ADRES } })

        expect(gorulen).toEqual([])
        expect(ctx.solana.isConnected).toBe(true)
    })

    it('baska bir hedefe gelen olay legacy seridi ETKILEMEZ', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const gorulen = []
        ctx.solana.on('disconnect', () => gorulen.push('disconnect'))

        yanitla(ctx, { target: 'wats_ton_inpage', event: { event: 'change', payload: { accounts: [] } } })

        expect(gorulen).toEqual([])
        expect(ctx.solana.isConnected).toBe(true)
    })

    // Minor 1 (Gorev 44 fix turu): M1'in `event.source !== window` bekcisi
    // (:198) legacy yayinin da bekcisidir, ama hicbir test bunu DOGRUDAN
    // olcmuyordu -- bekci sokulse butun 63 test hala YESIL kalirdi. Kaynagi
    // sahte pencere DEGIL bos bir nesne olan bir mesaj, dinleyiciye DOGRUDAN
    // (harness'in `yanitla`sini atlayarak) verilir; bu, farkli bir iframe'in
    // ya da sayfanin gordugu farkli bir `window`in gonderdigi mesajin
    // MODELIDIR.
    it('yanlis source tasiyan mesaj legacy seridi ETKILEMEZ (M1 bekcisi, :198)', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const gorulen = []
        ctx.solana.on('disconnect', () => gorulen.push('disconnect'))
        ctx.solana.on('accountChanged', (pk) => gorulen.push(['accountChanged', pk]))

        ctx.dinleyiciler.forEach((fn) => fn({
            source: {},
            data: { target: 'wats_solana_inpage', event: { event: 'change', payload: { accounts: [] } } },
        }))

        expect(gorulen).toEqual([])
        expect(ctx.solana.isConnected).toBe(true)
        expect(ctx.solana.publicKey).not.toBe(null)
    })

    it('off ile sokulen dinleyici bir daha CAGRILMAZ', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const gorulen = []
        const cb = (pk) => gorulen.push(pk)
        ctx.solana.on('accountChanged', cb)
        ctx.solana.off('accountChanged', cb)

        yanitla(ctx, { target: 'wats_solana_inpage', event: { event: 'change', payload: { accounts: [] } } })

        expect(gorulen).toEqual([])
    })

    it('bir dinleyicinin hatasi digerlerini KESMEZ', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const gorulen = []
        ctx.solana.on('accountChanged', () => { throw new Error('dapp patladi') })
        ctx.solana.on('accountChanged', (pk) => gorulen.push(pk))

        yanitla(ctx, { target: 'wats_solana_inpage', event: { event: 'change', payload: { accounts: [] } } })

        expect(gorulen).toEqual([null])
    })

    // Obligation 2 (Gorev 43 incelemesi): M1'in Wallet Standard dinleyicisi
    // (degisimYayinla) ve buradaki legacy yayini AYNI itmeden, AYNI dinleyiciden
    // beslenmeli -- IKI AYRI `wats_solana_inpage` dinleyicisi olsaydi siralama
    // tanimsiz kalirdi. Bu test TEK bir push'un HER IKI seridi de tetikledigini
    // ve HER BIRINI TAM BIR KEZ tetikledigini dogrudan olcer.
    it('TEK itme hem WS change hem legacy accountChanged/disconnect FIRLATIR (obligation 2)', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const wallet = ctx.win.wats.solana.wallet
        const wsGorulen = []
        wallet.features['standard:events'].on('change', (d) => wsGorulen.push(d))
        const legacyGorulen = []
        ctx.solana.on('accountChanged', (pk) => legacyGorulen.push(['accountChanged', pk]))
        ctx.solana.on('disconnect', () => legacyGorulen.push(['disconnect']))

        yanitla(ctx, { target: 'wats_solana_inpage', event: { event: 'change', payload: { accounts: [] } } })

        expect(wsGorulen).toEqual([{ accounts: [] }])
        expect(legacyGorulen).toEqual([['accountChanged', null], ['disconnect']])
    })
})

// Gorev 43 incelemesi (obligation 1): tek-oturum garantisi TEK YONLUYDU --
// legacy connect paylasimli `hesap`i guncelliyordu ama WS `change` hic
// yayilmiyordu, ve WS connect legacyProvider.publicKey/isConnected'i BOS
// birakiyordu. Asagidaki dort test dort yonu de TEK TEK kilitler.
describe('WS <-> legacy senkronizasyonu (Gorev 44 obligation 1)', () => {
    it('yon 1: WS connect legacyProvider.publicKey/isConnected alanlarini gunceller', async () => {
        const ctx = kurLegacySayfa()
        const wallet = ctx.win.wats.solana.wallet
        const p = wallet.features['standard:connect'].connect()
        await Promise.resolve()
        cozumle(ctx, 'solana_connect', { address: ADRES, publicKey: PK_B64 })
        await p

        expect(ctx.solana.isConnected).toBe(true)
        expect(ctx.solana.publicKey).not.toBe(null)
        expect(ctx.solana.publicKey.toBase58()).toBe(ADRES)
    })

    // Finding 1 (Gorev 44 fix turu): `yon 1` yalnizca `standard:connect`i
    // surer -- signIn AYRI bir giris noktasidir (:344-348) ve kendi hesap
    // atamasini kendi yapar. `yon 1` tek basina signIn'deki senkron cagrisinin
    // (:348) kaldirilmasini YAKALAYAMAZ; bu yuzden AYRI bir test gerekir.
    it('yon 1 (signIn): WS signIn de legacyProvider.publicKey/isConnected alanlarini gunceller', async () => {
        const ctx = kurLegacySayfa()
        const wallet = ctx.win.wats.solana.wallet
        const p = wallet.features['solana:signIn'].signIn()
        await Promise.resolve()
        cozumle(ctx, 'solana_signIn', {
            address: ADRES,
            publicKey: PK_B64,
            signedMessage: btoa('app.jup.ag wants you to sign in'),
            signature: btoa('s'.repeat(64)),
        })
        await p

        expect(ctx.solana.isConnected).toBe(true)
        expect(ctx.solana.publicKey.toBase58()).toBe(ADRES)
    })

    it('yon 2: WS disconnect legacyProvider.publicKey/isConnected alanlarini temizler', async () => {
        const ctx = kurLegacySayfa()
        const wallet = ctx.win.wats.solana.wallet
        const p1 = wallet.features['standard:connect'].connect()
        await Promise.resolve()
        cozumle(ctx, 'solana_connect', { address: ADRES, publicKey: PK_B64 })
        await p1
        expect(ctx.solana.isConnected).toBe(true)

        const legacyGorulen = []
        ctx.solana.on('disconnect', () => legacyGorulen.push('disconnect'))

        const p2 = wallet.features['standard:disconnect'].disconnect()
        await Promise.resolve()
        cozumle(ctx, 'solana_disconnect', {})
        await p2

        expect(ctx.solana.isConnected).toBe(false)
        expect(ctx.solana.publicKey).toBe(null)
        // Minor 2 (Gorev 44 fix turu): WS disconnect artik legacy `disconnect`i
        // de yayar -- iki serit AYNI bilgiyi ("artik imzalayamazsin") tasir ve
        // burada SESSIZ kalmak (connect yonundeki fail-safe'in aksine) legacy
        // dinleyicide bayat "bagli" UI'si birakirdi.
        expect(legacyGorulen).toEqual(['disconnect'])
    })

    // Minor 3/4 (Gorev 44 fix turu): legacyProvider alanlari WS `change`den
    // ONCE senkronlanmali. Dinleyici `degisimYayinla` SIRASINDA senkron
    // calisir; senkron ONCE gelmezse ayni itmeyi dinleyen bir WS `change`
    // dinleyicisi eski (henuz guncellenmemis) `isConnected`i okur -- bu test
    // dinleyicinin GORDUGU degeri, cozulen promise'in DEGIL, olcer.
    it('yon 2 siralama: WS change SIRASINDA legacyProvider ZATEN guncel', async () => {
        const ctx = kurLegacySayfa()
        const wallet = ctx.win.wats.solana.wallet
        const p1 = wallet.features['standard:connect'].connect()
        await Promise.resolve()
        cozumle(ctx, 'solana_connect', { address: ADRES, publicKey: PK_B64 })
        await p1

        let dinleyiciAninda = null
        wallet.features['standard:events'].on('change', () => { dinleyiciAninda = ctx.solana.isConnected })

        const p2 = wallet.features['standard:disconnect'].disconnect()
        await Promise.resolve()
        cozumle(ctx, 'solana_disconnect', {})
        await p2

        expect(dinleyiciAninda).toBe(false)
    })

    // Residual (Gorev 44 fix turu): yukaridaki siralama testi yalnizca
    // disconnect'i surer -- signIn AYRI bir kod yolu oldugu icin (:334-362)
    // KENDI siralama hatasini KENDI testi olmadan yakalamaz. Bu, `yon 1
    // (signIn)` testinin ("cozulen promise'in gordugu SON durum") ONCESINDE,
    // dinleyicinin `degisimYayinla` SIRASINDA GORDUGU degeri olcer.
    it('yon 1 siralama (signIn): WS change SIRASINDA legacyProvider ZATEN guncel', async () => {
        const ctx = kurLegacySayfa()
        const wallet = ctx.win.wats.solana.wallet

        let dinleyiciAninda = 'HENUZ-CAGRILMADI'
        wallet.features['standard:events'].on('change', () => { dinleyiciAninda = ctx.solana.publicKey })

        const p = wallet.features['solana:signIn'].signIn()
        await Promise.resolve()
        cozumle(ctx, 'solana_signIn', {
            address: ADRES,
            publicKey: PK_B64,
            signedMessage: btoa('app.jup.ag wants you to sign in'),
            signature: btoa('s'.repeat(64)),
        })
        await p

        expect(dinleyiciAninda).not.toBe('HENUZ-CAGRILMADI')
        expect(dinleyiciAninda).not.toBe(null)
        expect(dinleyiciAninda.toBase58()).toBe(ADRES)
    })

    it('yon 3: legacy connect WS change olayini tetikler', async () => {
        const ctx = kurLegacySayfa()
        const wallet = ctx.win.wats.solana.wallet
        const degisimler = []
        wallet.features['standard:events'].on('change', (d) => degisimler.push(d))

        await baglan(ctx)

        expect(degisimler).toHaveLength(1)
        expect(degisimler[0].accounts).toHaveLength(1)
        expect(degisimler[0].accounts[0].address).toBe(ADRES)
    })

    it('yon 4: legacy disconnect WS change olayini tetikler', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const wallet = ctx.win.wats.solana.wallet
        const degisimler = []
        wallet.features['standard:events'].on('change', (d) => degisimler.push(d))

        const p = ctx.solana.disconnect()
        await Promise.resolve()
        cozumle(ctx, 'solana_disconnect', {})
        await p

        expect(degisimler).toEqual([{ accounts: [] }])
    })
})

describe('legacy hata eslemesi (SS3.6)', () => {
    /** connect uzerinden bir red gecirir; eslemenin cikisini doner. */
    async function reddiGecir(error) {
        const ctx = kurLegacySayfa()
        const p = ctx.solana.connect()
        await Promise.resolve()
        reddet(ctx, 'solana_connect', error)
        return p.catch((e) => e)
    }

    // Tanimadigimiz metot -> JSON-RPC "Method Not Found". Legacy dapp'ler
    // 4200'u tanimaz; -32601 gorunce ozelligi zarifce kapatirlar.
    it('4200 -> -32601', async () => {
        const err = await reddiGecir({ code: 4200, message: 'Method not supported.' })
        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBe(-32601)
        expect(err.message).toBe('Method not supported.')
    })

    // AYRIM ONEMLI: 4001 goren dapp kullaniciya HIC GORMEDIGI bir istek icin
    // "reddettiniz" der. Pencere zaten acikken gelen ikinci istek Phantom'da
    // -32002'dir (dappFunctions.js:35'in metni).
    //
    // Gorev 45 incelemesi bu dali kod uzerinde CALISTIRARAK OLU buldu:
    // legacyError, paylasimli hataYap()'tan (solanaInjected.js:170) GECMIS bir
    // govde gorur; hataYap kod 4001 icin STANDART_MESAJ tablosunu
    // (solanaInjected.js:163) mesajin ONUNE koydugu icin arka planin GERCEK
    // metni ('Request replaced by a new one.') legacyError'a hic ULAsMAZDI --
    // -32002 dali YAZILI ve DOGRU ama tetiklenemezdi (olu kod, o zaman
    // it.fails ile sertifikalanmisti; Gorev 45 raporu).
    //
    // Gorev 45b bunu KAPATTI: hataYap artik ham metni non-enumerable
    // `hamMesaj` alaninda saklar (dapp'e JSON/spread/Object.keys ile SIZMAZ),
    // legacyError kararini `e.hamMesaj` uzerinden verir. `.message` ise
    // STANDART_MESAJ ile normalize GORUNMEYE devam eder -- ':259' ve ':734'
    // pinli WS testleri DOKUNULMADAN yesil kalir (asagidaki ilk testin ikinci
    // iddiasi da bunu dogrudan kilitler).
    it("4001 + 'Request replaced by a new one.' -> -32002 (hamMesaj uzerinden)", async () => {
        const err = await reddiGecir({ code: 4001, message: 'Request replaced by a new one.' })
        expect(err.code).toBe(-32002)
        // WS normalizasyonu KORUNUR: gorunen mesaj hala STANDART_MESAJ'dan gelir.
        expect(err.message).toBe('User rejected the request.')
    })

    // Onay penceresi muteksi (dappFunctions.js:60) de "mesgul" anlamindadir --
    // ayni MESGUL_4001 seti (solanaInjected.js, legacyError'un hemen ustunde)
    // bunu da -32002'ye esler.
    it("4001 + 'Another request is being processed.' (mutex) -> -32002", async () => {
        const err = await reddiGecir({ code: 4001, message: 'Another request is being processed.' })
        expect(err.code).toBe(-32002)
    })

    // Kullanicinin GERCEKTEN reddettigi/kapattigi iki metin 4001 KALIR -- eslesme
    // "mesgul" anlamina, 4001'e toptan DEGIL.
    it("4001 + 'User closed the window.' 4001 KALIR", async () => {
        const err = await reddiGecir({ code: 4001, message: 'User closed the window.' })
        expect(err.code).toBe(4001)
    })

    // hamMesaj sayfa-icidir: dapp'e sizmaz.
    it('hamMesaj non-enumerable -- JSON/spread/keys onu gormez', async () => {
        const err = await reddiGecir({ code: 4001, message: 'Request replaced by a new one.' })
        expect(Object.keys(err)).not.toContain('hamMesaj')
        expect(JSON.parse(JSON.stringify({ ...err }))).not.toHaveProperty('hamMesaj')
        expect(err.hamMesaj).toBe('Request replaced by a new one.')
    })

    // Cuzdan kilitli ve sessiz yol mumkun degil. Phantom'da 4900 "aga
    // baglanamadi" demektir; kilit legacy seritte 4100'dur.
    it('4900 (kilitli) -> 4100', async () => {
        const err = await reddiGecir({ code: 4900, message: 'Wallet is locked.' })
        expect(err.code).toBe(4100)
    })

    it('4100 (yetkisiz) OLDUGU GIBI gecer', async () => {
        const err = await reddiGecir({ code: 4100, message: 'Unauthorized.' })
        expect(err.code).toBe(4100)
    })

    // Uygulama katmani kodu `data.code` ile gelir ve KAYBOLMAMALI: dapp'in
    // hata ekrani bunu gosterebilsin diye.
    // Gorev 49 kararlari (R9 ii): brief'in uydurdugu {code:4001, ...} zarfi
    // yerine arka planin GERCEK pencere-ONCESI zarfi -- SOLANA_MESSAGE_LOOKS_LIKE_TX
    // `uygulamaHatasi(kod)`tan gelir (solanaDappFunctions.js:50): {code:-32603,
    // message:kod, data:{code:kod}}. legacyError -32603'u ESLEMEZ (kod
    // degismeden gecer, STANDART_MESAJ'da -32603 yok).
    it('data.code korunur (SOLANA_MESSAGE_LOOKS_LIKE_TX)', async () => {
        const err = await reddiGecir({
            code: -32603,
            message: 'SOLANA_MESSAGE_LOOKS_LIKE_TX',
            data: { code: 'SOLANA_MESSAGE_LOOKS_LIKE_TX' },
        })
        expect(err.code).toBe(-32603)
        expect(err.data).toEqual({ code: 'SOLANA_MESSAGE_LOOKS_LIKE_TX' })
    })

    // .data'nin korunmasi eslenmemis bir kodda kolay olur (govde OLDUGU GIBI
    // tasinir); asil sinav ESLENEN bir kodda da korunup korunmadigidir --
    // Error'u SIFIRDAN kuran bir uygulama burada sessizce data'yi dusurur.
    it('.data mapped bir kodda (4200) da korunur', async () => {
        const err = await reddiGecir({
            code: 4200,
            message: 'Method not supported.',
            data: { code: 'SOLANA_NOT_A_SIGNER' },
        })
        expect(err.code).toBe(-32601)
        expect(err.data).toEqual({ code: 'SOLANA_NOT_A_SIGNER' })
    })

    // content.js'in lastError dali KODSUZ bir govde gonderir. Uydurma bir kod
    // yazmak dapp'i yanlis yola sokar -- kod ALANI HIC OLMAMALI.
    it('kodsuz tasima hatasi kod UYDURMAZ', async () => {
        const err = await reddiGecir({
            message: 'Could not establish communication with the wallet background service.',
        })
        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBeUndefined()
        expect(err.message).toContain('Could not establish communication')
    })
})

// ===================== Task 46: legacy signTransaction =====================
const ALICI = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const BLOCKHASH = '11111111111111111111111111111111'
const IMZA = Uint8Array.from({ length: 64 }, (_, i) => (i + 7) % 251)
// Inceleme bulgusu #2 (Gorev 46): korunmasi gereken DIGER (cosigner) imzasi
// icin AYRI bir bayt deseni -- IMZA ile CAKISMAZ, "yanlis slota yazildi" ile
// "dogru slotta ama tesadufen ayni deger" birbirinden ayirt edilebilir.
const DIGER = Uint8Array.from({ length: 64 }, () => 0xab)

function transferTalimati() {
    return SystemProgram.transfer({
        fromPubkey: new PublicKey(ADRES),
        toPubkey: new PublicKey(ALICI),
        lamports: 1000,
    })
}

function legacyIslem({ feePayer = true, blockhash = true } = {}) {
    const tx = new Transaction()
    if (blockhash) tx.recentBlockhash = BLOCKHASH
    if (feePayer) tx.feePayer = new PublicKey(ADRES)
    tx.add(transferTalimati())
    return tx
}

function v0Islem() {
    const mesaj = new TransactionMessage({
        payerKey: new PublicKey(ADRES),
        recentBlockhash: BLOCKHASH,
        instructions: [transferTalimati()],
    }).compileToV0Message()
    return new VersionedTransaction(mesaj)
}

/**
 * Arka planin dondurecegi TEL govdesi: ayni islem, index'inci imza dolu.
 * Tel bicimi = compact-u16 imza SAYISI + N*64 bayt imza; burada GERCEK bir
 * web3.js serilestirmesi uzerine yaziyoruz, yani sayfa betiginin cikarim
 * varsayimi uydurma bir govdeye degil kutuphanenin kendi ciktisina karsi olculuyor.
 */
function imzaliTel(bytes, index, sig) {
    const wire = Uint8Array.from(bytes)
    wire.set(sig, 1 + index * 64)
    return Buffer.from(wire).toString('base64')
}

describe('legacy signTransaction (SS3.5 -- yerinde mutasyon)', () => {
    it('legacy islemde DONEN NESNE girdiyle AYNIDIR (===) ve imza yerine yazilir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = legacyIslem()
        const ham = tx.serialize({ requireAllSignatures: false, verifySignatures: false })

        const p = ctx.solana.signTransaction(tx)
        await Promise.resolve()
        const m = istek(ctx, 'solana_signTransaction')
        expect(m.payload.params[0].transactions).toEqual([Buffer.from(ham).toString('base64')])
        expect(m.payload.params[0].chain).toBe('solana:mainnet')
        expect(m.payload.params[0].account).toBe(ADRES)

        cozumle(ctx, 'solana_signTransaction', { signedTransactions: [imzaliTel(ham, 0, IMZA)] })
        const sonuc = await p

        // ASIL IDDIA: base64 dizge dondurmek her legacy dapp'te TypeError
        // uretirdi -- dapp .serialize()'i KENDI nesnesi uzerinde cagiriyor.
        expect(sonuc).toBe(tx)
        expect(Uint8Array.from(tx.signatures[0].signature)).toEqual(IMZA)

        // Inceleme bulgusu #3 (Gorev 46): yukaridaki iki iddia sadece ALANI
        // okur -- kodun YAZDIGI deger web3.js'in KENDI serilestirmesinden
        // gecmeden dogrulanmiyordu. Dapp bir sonraki adimda tam bunu yapar.
        const imzali = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        expect(Uint8Array.from(imzali.slice(1, 65))).toEqual(IMZA)
    })

    it('v0 islemde de AYNI nesne doner ve signatures[index] yazilir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = v0Islem()
        const ham = tx.serialize()

        const p = ctx.solana.signTransaction(tx)
        await Promise.resolve()
        // v0 serilestirmesi ARGUMANSIZDIR: opsiyon nesnesi sessizce yok sayilir.
        expect(istek(ctx, 'solana_signTransaction').payload.params[0].transactions)
            .toEqual([Buffer.from(ham).toString('base64')])

        cozumle(ctx, 'solana_signTransaction', { signedTransactions: [imzaliTel(ham, 0, IMZA)] })
        const sonuc = await p

        expect(sonuc).toBe(tx)
        expect(Uint8Array.from(tx.signatures[0])).toEqual(IMZA)

        // Inceleme bulgusu #3 (Gorev 46): v0 icin de GERCEK (argumansiz)
        // serilestirme uzerinden dogrulama.
        const imzali = tx.serialize()
        expect(Uint8Array.from(imzali.slice(1, 65))).toEqual(IMZA)
    })

    // Inceleme bulgusu #2 (Gorev 46): yukaridaki iki testte de TEK zorunlu
    // imzaci var -- adresimiz HER ZAMAN indeks 0. "indeksi hep 0 varsay" gibi
    // bir mutasyon bunlarla YAKALANAMAZ. Burada feePayer BASKA bir hesap
    // (ALICI, indeks 0) ve bizim adresimiz (ADRES) instruction'in KENDI
    // imzaci anahtarindan gelen IKINCI zorunlu imzaci -- indeks 1. DIGER
    // slotu ONCEDEN doldurulur ve DEGISMEDEN kalmalidir (cosigner imzasi
    // korunur, tx.addSignature CAGRILMAZ ilkesiyle tutarli).
    it('legacy -- iki imzacili islemde bizim slotumuz 1, DIGER slot DOKUNULMAZ', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = new Transaction()
        tx.recentBlockhash = BLOCKHASH
        tx.feePayer = new PublicKey(ALICI)
        tx.add(transferTalimati())
        // _compile'i BIR KEZ tetikleyip tx.signatures'i doldur (feePayer=ALICI
        // indeks 0, ADRES -- instruction'in imzaci anahtari -- indeks 1).
        tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        // v0 ikizindeki (`staticAccountKeys[1] === ADRES`) AYNI onkosul:
        // ADRES'in GERCEKTEN indeks 1'e derlendigini, testin sonraki
        // `imzaliTel(ham, 1, IMZA)` varsayimindan ONCE dogrular.
        expect(String(tx.signatures[1].publicKey)).toBe(ADRES)
        tx.signatures[0].signature = Buffer.from(DIGER)

        const p = ctx.solana.signTransaction(tx)
        await Promise.resolve()
        const ham = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        cozumle(ctx, 'solana_signTransaction', { signedTransactions: [imzaliTel(ham, 1, IMZA)] })
        const sonuc = await p

        expect(sonuc).toBe(tx)
        expect(Uint8Array.from(tx.signatures[1].signature)).toEqual(IMZA)
        expect(Uint8Array.from(tx.signatures[0].signature)).toEqual(DIGER)

        // Inceleme bulgusu #3: GERCEK serilestirme HER IKI slotu da dogru
        // ofsette tasimali.
        const imzali = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        expect(Uint8Array.from(imzali.slice(1, 65))).toEqual(DIGER)
        expect(Uint8Array.from(imzali.slice(65, 129))).toEqual(IMZA)
    })

    it('v0 -- iki imzacili islemde bizim slotumuz 1, DIGER slot DOKUNULMAZ', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const mesaj = new TransactionMessage({
            payerKey: new PublicKey(ALICI),
            recentBlockhash: BLOCKHASH,
            instructions: [transferTalimati()],
        }).compileToV0Message()
        const tx = new VersionedTransaction(mesaj)
        expect(String(tx.message.staticAccountKeys[1])).toBe(ADRES)
        tx.signatures[0] = Buffer.from(DIGER)

        const p = ctx.solana.signTransaction(tx)
        await Promise.resolve()
        const ham = tx.serialize()
        cozumle(ctx, 'solana_signTransaction', { signedTransactions: [imzaliTel(ham, 1, IMZA)] })
        const sonuc = await p

        expect(sonuc).toBe(tx)
        expect(Uint8Array.from(tx.signatures[1])).toEqual(IMZA)
        expect(Uint8Array.from(tx.signatures[0])).toEqual(DIGER)

        // Inceleme bulgusu #3: GERCEK serilestirme HER IKI slotu da dogru
        // ofsette tasimali.
        const imzali = tx.serialize()
        expect(Uint8Array.from(imzali.slice(1, 65))).toEqual(DIGER)
        expect(Uint8Array.from(imzali.slice(65, 129))).toEqual(IMZA)
    })

    // Ayrim `'version' in tx` ile yapilir, ASLA instanceof ile: dapp'in
    // web3.js'i AYRI bir modul ornegidir ve instanceof her zaman false doner.
    // Bu testin sahte nesnesi tam olarak o durumu taklit eder.
    it('YABANCI bir modulden gelmis v0 benzeri nesne de v0 olarak islenir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const gercek = v0Islem()
        const ham = gercek.serialize()
        const yabanci = {
            version: 0,
            serialize: (...args) => { expect(args.length).toBe(0); return ham },
            message: gercek.message,
            signatures: [new Uint8Array(64)],
        }

        const p = ctx.solana.signTransaction(yabanci)
        await Promise.resolve()
        cozumle(ctx, 'solana_signTransaction', { signedTransactions: [imzaliTel(ham, 0, IMZA)] })

        expect(await p).toBe(yabanci)
        expect(yabanci.signatures[0]).toEqual(IMZA)
    })

    // feePayer'a atanan sey web3.js'in KENDI PublicKey ornegi olmak ZORUNDA:
    // compileMessage `pubkey.equals(feePayer)` cagiriyor ve bizim
    // sarmalayicimizda `_bn` YOK -- BN orada `undefined.negative` ile patlar
    // (tx.addSignature'dan kacinmamizin AYNI sebebi). Bu yuzden deger islemin
    // KENDI talimat anahtarlarindan bulunur.
    it('feePayer yoksa bagli hesap islemin KENDI anahtarlarindan atanir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = legacyIslem({ feePayer: false })

        const p = ctx.solana.signTransaction(tx)
        await Promise.resolve()
        expect(String(tx.feePayer)).toBe(ADRES)
        // Sarmalayici DEGIL, gercek PublicKey: `_bn` olmadan serilestirme patlar.
        expect(tx.feePayer).toBeInstanceOf(PublicKey)

        const ham = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        cozumle(ctx, 'solana_signTransaction', { signedTransactions: [imzaliTel(ham, 0, IMZA)] })
        expect(await p).toBe(tx)
    })

    // Adresimiz islemin HICBIR talimatinda gecmiyorsa gercek bir PublicKey
    // ornegi BULAMAYIZ. Sarmalayiciyi atamak web3.js'i anlasilmaz bir
    // `Cannot read properties of undefined (reading 'negative')` ile
    // patlatirdi; acik bir kodla, PENCERE ACILMADAN reddedilir.
    it('feePayer yok ve adresimiz talimatlarda GECMIYORSA -32602', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = new Transaction()
        tx.recentBlockhash = BLOCKHASH
        tx.add(SystemProgram.transfer({
            fromPubkey: new PublicKey(ALICI), toPubkey: new PublicKey(ALICI), lamports: 1,
        }))
        const oncekiSayi = ctx.gonderilen.length

        const err = await ctx.solana.signTransaction(tx).catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBe(-32602)
        expect(err.message).toBe('Transaction fee payer required.')
        expect(ctx.gonderilen.length).toBe(oncekiSayi)
    })

    // recentBlockhash yoksa web3.js'in HAM hatasi ("Transaction recentBlockhash
    // required") dapp'in promise'ine duserdi. Acik bir kodla, PENCERE
    // ACILMADAN reddedilir.
    it('recentBlockhash yoksa istek arka plana HIC gitmez', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const oncekiSayi = ctx.gonderilen.length

        const err = await ctx.solana.signTransaction(legacyIslem({ blockhash: false })).catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBe(-32602)
        expect(err.message).toBe('Transaction recentBlockhash required.')
        expect(ctx.gonderilen.length).toBe(oncekiSayi)
    })

    // Inceleme bulgusu #1 (Gorev 46): WS seridi (`:424-426`) SESSIZCE
    // KIRPILMAZ der ve uzunluk uyusmazliginda ATAR; legacy serit bu
    // korumadan yoksundu -- kisa bir yanit, dapp'e "imzalandi" diye SESSIZCE
    // imzasiz bir nesne dondururdu (dapp sonra onu YAYINLARDI).
    it('signedTransactions KISA donerse REDDEDER, tx.signatures DEGISMEZ', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = legacyIslem()

        const p = ctx.solana.signTransaction(tx).catch((e) => e)
        await Promise.resolve()
        cozumle(ctx, 'solana_signTransaction', { signedTransactions: [] })
        const err = await p

        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('Wallet returned an unexpected response.')
        expect(tx.signatures[0].signature).toBe(null)
    })

    // Inceleme bulgusu #5 (Gorev 46, Minor) + (a) (Gorev 46, tur 2): tel
    // govdesinin SAYI baytindan (compact-u16) daha az bayt tasimasi --
    // ornegin baglanti kesilirse -- 64'ten KISA bir dilim uretir. Boyle bir
    // dilim dapp'in nesnesine yazilirsa gercek serilestirme cok daha sonra,
    // anlasilmaz bir web3.js `assert`iyle patlar. `legacyImzaAl` boyle bir
    // dilimi NULL'a cevirir; ONCEKI turde bu SADECE yazmayi atlayip
    // SESSIZCE cozuluyordu -- (a) bunun #1 ile AYNI "beklenmedik yanit"
    // sinifi oldugunu tanidi: dizi UZUNLUGU dogruysa da bir ELEMANIN ICI
    // bozuk olabilir. Artik ayni sekilde REDDEDER.
    it('tel govdesi imza uzunlugundan KISAYSA REDDEDER, tx.signatures DEGISMEZ', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = legacyIslem()

        const p = ctx.solana.signTransaction(tx).catch((e) => e)
        await Promise.resolve()
        // SAYI bayti 1 der ama govde yalnizca 40 bayt tasir (64 degil).
        const kisaTel = Buffer.from(Uint8Array.from([1, ...Array(40).fill(9)])).toString('base64')
        cozumle(ctx, 'solana_signTransaction', { signedTransactions: [kisaTel] })
        const err = await p

        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('Wallet returned an unexpected response.')
        expect(tx.signatures[0].signature).toBe(null)
    })

    // Inceleme bulgusu #4 (Gorev 46): mutant 6 -- `throw legacyError(e)` bu
    // seritte HIC sinanmamisti. `hamMesaj` (Gorev 45b) burada da OKUNMALI:
    // arka planin "mesgul" metni -32002'ye eslenmeli, dapp'e sizmemeli.
    it('arka plan reddi legacyError uzerinden gecer (4001 duz kalir)', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = legacyIslem()

        const p = ctx.solana.signTransaction(tx).catch((e) => e)
        await Promise.resolve()
        reddet(ctx, 'solana_signTransaction', { code: 4001, message: 'User rejected the request.' })
        const err = await p

        expect(err.code).toBe(4001)
    })

    it("arka plan reddi 'mesgul' 4001'i -32002'ye cevirir, hamMesaj sizmaz", async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = legacyIslem()

        const p = ctx.solana.signTransaction(tx).catch((e) => e)
        await Promise.resolve()
        reddet(ctx, 'solana_signTransaction', { code: 4001, message: 'Request replaced by a new one.' })
        const err = await p

        expect(err.code).toBe(-32002)
        expect(err.message).toBe('User rejected the request.')
        expect(Object.keys(err)).not.toContain('hamMesaj')
    })
})

// ===================== Task 47: legacy signAllTransactions =====================
describe('legacy signAllTransactions', () => {
    // Toplu imzalama TEK bir solana_signTransaction cagrisidir: Wallet
    // Standard'da `solana:signAllTransactions` diye bir ozellik YOKTUR (SS3.2)
    // ve iki ayri cagri iki ayri onay penceresi demek olurdu.
    it('TEK istek gonderir ve AYNI nesneleri sirayla doner', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const a = legacyIslem()
        const b = v0Islem()
        const hamA = a.serialize({ requireAllSignatures: false, verifySignatures: false })
        const hamB = b.serialize()
        const imzaB = Uint8Array.from({ length: 64 }, (_, i) => (i + 40) % 251)

        const oncekiSayi = ctx.gonderilen.length
        // Reader Minor #3: girdi dizisi ADIYLA saklanir ki sonuc onunla ===
        // karsilastirilabilsin -- `return txs.slice()` gibi bir mutasyon
        // eleman kimligini korur ama dizi kimligini KIRAR, brief'in
        // `Promise<AYNI txs>` sozunu ELEMAN duzeyinde degil DIZI duzeyinde de
        // sinamak gerekir.
        const girdi = [a, b]
        const p = ctx.solana.signAllTransactions(girdi)
        await Promise.resolve()

        expect(ctx.gonderilen.length).toBe(oncekiSayi + 1)
        const m = istek(ctx, 'solana_signTransaction')
        expect(m.payload.params[0].transactions).toEqual([
            Buffer.from(hamA).toString('base64'),
            Buffer.from(hamB).toString('base64'),
        ])

        cozumle(ctx, 'solana_signTransaction', {
            signedTransactions: [imzaliTel(hamA, 0, IMZA), imzaliTel(hamB, 0, imzaB)],
        })
        const sonuc = await p

        expect(sonuc).toBe(girdi)
        expect(sonuc[0]).toBe(a)
        expect(sonuc[1]).toBe(b)
        expect(Uint8Array.from(a.signatures[0].signature)).toEqual(IMZA)
        expect(Uint8Array.from(b.signatures[0])).toEqual(imzaB)
    })

    it('bos dizi arka plana GITMEDEN bos dizi doner', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const oncekiSayi = ctx.gonderilen.length

        await expect(ctx.solana.signAllTransactions([])).resolves.toEqual([])
        expect(ctx.gonderilen.length).toBe(oncekiSayi)
    })

    // Reader Minor #4: `Array.isArray(txs) ? txs : []` (:821) brief tarafindan
    // ZORUNLU KILINIR -- dusmesi `signAllTransactions(undefined)`i HAM bir
    // TypeError'a cevirir ve bu, `legacyError` sarmalamasini ATLAR (dapp
    // Error DEGIL bir TypeError gorur). `[]` dalindaki gibi arka plana da
    // HIC gidilmemelidir.
    it('signAllTransactions(undefined) bos dizi doner, arka plana GITMEZ', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const oncekiSayi = ctx.gonderilen.length

        await expect(ctx.solana.signAllTransactions(undefined)).resolves.toEqual([])
        expect(ctx.gonderilen.length).toBe(oncekiSayi)
    })

    // Reader Important #1: Gorev 46'nin mutant 6 dersinin AYNISI -- bu seritte
    // HICBIR test `legacyError`e OZGU bir donusumu sinamiyordu (kismi-yazma
    // testi ham `hataYap` mesajini degismeden gecirir, 21-islem testi
    // `-32603`i degismeden gecirir; ikisi de `throw e` ile de YESIL kalirdi).
    // `hamMesaj` (Gorev 45b) burada da OKUNMALI: arka planin "mesgul" metni
    // -32002'ye eslenmeli, dapp'e sizmemeli -- Gorev 46'nin signTransaction
    // icin yaptigi AYNI sinama, toplu yol icin.
    it("arka plan reddi 'mesgul' 4001'i -32002'ye cevirir (legacyError), hamMesaj sizmaz", async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = legacyIslem()

        const p = ctx.solana.signAllTransactions([tx]).catch((e) => e)
        await Promise.resolve()
        reddet(ctx, 'solana_signTransaction', { code: 4001, message: 'Request replaced by a new one.' })
        const err = await p

        expect(err.code).toBe(-32002)
        expect(err.message).toBe('User rejected the request.')
        // Gorev 49 (R9 i): Gorev 47'nin ileri yukumlulugu -- hamMesaj VARLIGI
        // da dogrudan sinanir, yalnizca dapp'e SIZMADIGI degil.
        expect(err.hamMesaj).toBe('Request replaced by a new one.')
        expect(Object.keys(err)).not.toContain('hamMesaj')
    })

    // Gorev 47 obligation 1: Gorev 46'nin bu testi bir test-ici disari-actarma
    // kancasiyla `legacyCoklukImzala`i DOGRUDAN cagiriyordu (henuz
    // `signAllTransactions` yoktu). Artik GERCEK genel API uzerinden gecer --
    // bu da toplu yolun `legacyError` sarmalamasini KANITLAR (kanca bunu
    // atliyordu, dogrudan fonksiyonu cagirdigi icin).
    it('toplu imzada IKINCI eleman bozuksa HICBIRI yazilmaz (kismi write-back engellenir)', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx0 = legacyIslem()
        const tx1 = legacyIslem()
        const ham0 = tx0.serialize({ requireAllSignatures: false, verifySignatures: false })
        tx1.serialize({ requireAllSignatures: false, verifySignatures: false })

        const p = ctx.solana.signAllTransactions([tx0, tx1]).catch((e) => e)
        await Promise.resolve()
        // Birinci eleman GECERLI (gercek IMZA), ikinci eleman KISA (40 bayt).
        const iyiTel = imzaliTel(ham0, 0, IMZA)
        const kisaTel = Buffer.from(Uint8Array.from([1, ...Array(40).fill(9)])).toString('base64')
        cozumle(ctx, 'solana_signTransaction', { signedTransactions: [iyiTel, kisaTel] })
        const err = await p

        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('Wallet returned an unexpected response.')
        // ASIL IDDIA: tx0'IN GECERLI imzasi bile yazilmamis olmali -- ikinci
        // eleman bozuk oldugu icin TUM parti reddedilir, TEK bir eleman degil.
        expect(tx0.signatures[0].signature).toBe(null)
        expect(tx1.signatures[0].signature).toBe(null)
    })

    // Gorev 47 obligation 2: `legacyImzaIndeksi` adresimizi bu YEREL nesnenin
    // zorunlu imzacilari arasinda BULAMAZSA -1 doner (solanaInjected.js:679);
    // `legacyImzaAl` bunu `index < 0` dalinda NULL'a cevirir
    // (solanaInjected.js:688). ADRES burada feePayer DEGIL, yalnizca bir
    // talimatin imzaci-OLMAYAN anahtaridir -- `tx.signatures` (feePayer +
    // zorunlu imzacilar) hicbir zaman ADRES icermez.
    it('adresimiz zorunlu imzacilar arasinda yoksa (index -1) REDDEDER, hicbir sey yazilmaz', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = new Transaction()
        tx.recentBlockhash = BLOCKHASH
        tx.feePayer = new PublicKey(ALICI)
        tx.add(SystemProgram.transfer({
            fromPubkey: new PublicKey(ALICI), toPubkey: new PublicKey(ADRES), lamports: 1,
        }))

        const p = ctx.solana.signAllTransactions([tx]).catch((e) => e)
        await Promise.resolve()
        const ham = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        cozumle(ctx, 'solana_signTransaction', { signedTransactions: [imzaliTel(ham, 0, IMZA)] })
        const err = await p

        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('Wallet returned an unexpected response.')
        expect(tx.signatures[0].signature).toBe(null)
    })

    // Gorev 47 obligation 3: dizi-uzunlugu korumasi (solanaInjected.js:727-729)
    // UC nesnenin ikisiyle degil UCUYLE sinanmali -- iki elemanli senaryo
    // (yukarida) "N=uzunluk sinamasi"ni yanlislikla "iki elemanli ozel durum"
    // ile karistirmaya acikti.
    it('3 islemde arka plan 2 imzali tel donerse REDDEDER, UCU de DOKUNULMAZ kalir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx0 = legacyIslem()
        const tx1 = legacyIslem()
        const tx2 = legacyIslem()
        const ham0 = tx0.serialize({ requireAllSignatures: false, verifySignatures: false })
        const ham1 = tx1.serialize({ requireAllSignatures: false, verifySignatures: false })
        tx2.serialize({ requireAllSignatures: false, verifySignatures: false })

        const p = ctx.solana.signAllTransactions([tx0, tx1, tx2]).catch((e) => e)
        await Promise.resolve()
        cozumle(ctx, 'solana_signTransaction', {
            signedTransactions: [imzaliTel(ham0, 0, IMZA), imzaliTel(ham1, 0, IMZA)],
        })
        const err = await p

        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('Wallet returned an unexpected response.')
        expect(tx0.signatures[0].signature).toBe(null)
        expect(tx1.signatures[0].signature).toBe(null)
        expect(tx2.signatures[0].signature).toBe(null)
    })

    // Gorev 47 obligation 4: ust sinir POLITIKADIR ve arka planda uygulanir
    // (Gorev 29 kapi 5, solanaDappFunctions.js:654-655); zarf
    // `uygulamaHatasi(kod)`tan gelir (solanaDappFunctions.js:50):
    // `{ error: { code: -32603, message: kod, data: { code: kod } } }`.
    // Sayfa betigi kendi sinirini KOYMAZ -- burada 21 GERCEK islem TEK
    // istekte gonderilir ve arka planin GERCEK zarfi legacyError'dan
    // degismeden gecmelidir.
    it('21 islem TEK istekte gider, arka planin GERCEK SOLANA_TOO_MANY_TRANSACTIONS zarfi degismeden gecer', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const txs = Array.from({ length: 21 }, () => legacyIslem())
        const oncekiSayi = ctx.gonderilen.length

        const p = ctx.solana.signAllTransactions(txs).catch((e) => e)
        await Promise.resolve()

        expect(ctx.gonderilen.length).toBe(oncekiSayi + 1)
        const m = istek(ctx, 'solana_signTransaction')
        expect(m.payload.params[0].transactions.length).toBe(21)

        reddet(ctx, 'solana_signTransaction', {
            code: -32603,
            message: 'SOLANA_TOO_MANY_TRANSACTIONS',
            data: { code: 'SOLANA_TOO_MANY_TRANSACTIONS' },
        })
        const err = await p

        expect(err.code).toBe(-32603)
        expect(err.data).toEqual({ code: 'SOLANA_TOO_MANY_TRANSACTIONS' })
    })

    // Fix turu 1, F4 (Minor): tek decode noktasi (legacyCoklukImzala icindeki
    // `base64ToBytes(imzalilar[i])`) -- bozuk base64 `atob`'dan ham bir
    // DOMException firlatir. legacyError'un sayisal-kod dalindan GECIP dapp'e
    // motor hatasi sizmasin diye ayni 'unexpected response' govdesine
    // dusurulmeli. signMessage'daki AYNI korumanin toplu-imza karsiligi.
    it("bozuk base64 signedTransactions ('!!!!') unexpected response ile reddeder, motor hatasi SIZMAZ", async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = legacyIslem()

        const p = ctx.solana.signAllTransactions([tx]).catch((e) => e)
        await Promise.resolve()
        cozumle(ctx, 'solana_signTransaction', { signedTransactions: ['!!!!'] })
        const err = await p

        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('Wallet returned an unexpected response.')
    })
})

// ===================== Task 48: legacy signAndSendTransaction =====================
describe('legacy signAndSendTransaction', () => {
    const IMZA_B58 = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW'

    /** K3: bu metot icin giden mesaj SAYISI -- her basarili cagri TEK kare acar. */
    function kareSayisi(ctx) {
        return ctx.gonderilen
            .filter((m) => m && m.payload && m.payload.method === 'solana_signAndSendTransaction').length
    }

    it('imzayi base58 DIZGE olarak AYNEN doner (cozmez)', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = legacyIslem()
        const ham = tx.serialize({ requireAllSignatures: false, verifySignatures: false })
        const oncekiSayi = ctx.gonderilen.length

        const p = ctx.solana.signAndSendTransaction(tx)
        await Promise.resolve()
        const m = istek(ctx, 'solana_signAndSendTransaction')
        expect(m.payload.params[0].transaction).toBe(Buffer.from(ham).toString('base64'))
        expect(m.payload.params[0].chain).toBe('solana:mainnet')
        expect(m.payload.params[0].account).toBe(ADRES)

        cozumle(ctx, 'solana_signAndSendTransaction', {
            signature: IMZA_B58,
            signatureBytes: Buffer.from(IMZA).toString('base64'),
        })
        const sonuc = await p

        // Legacy serit base58'i AYNEN gecirir; boylece sayfa betigine bir
        // base58 COZUCU borcu binmez (SS3.3). Wallet Standard seridi ayni
        // yanitin `signatureBytes` alanini kullanir.
        expect(sonuc).toEqual({ signature: IMZA_B58 })
        expect(typeof sonuc.signature).toBe('string')
        // K3: TEK kare -- ne cift istek ne de sessizce dusen bir istek.
        // kareSayisi METOT-FILTRELI oldugu icin baska bir metotla acilmis
        // fazladan bir kareyi GOREMEZ; toplam-uzunluk anlik goruntusu
        // (oncekiSayi + 1) bu bosluk kapatir.
        expect(kareSayisi(ctx)).toBe(1)
        expect(ctx.gonderilen.length).toBe(oncekiSayi + 1)
    })

    // Dapp'in options'i AYNEN gecer; kirpma/yok sayma arka planda yapilir
    // (SS6.4). Sayfada filtrelemek, guvenlik kararini saldirganin
    // erisebildigi katmana tasirdi.
    it('options alani OLDUGU GIBI iletilir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const p = ctx.solana.signAndSendTransaction(legacyIslem(), { skipPreflight: true, maxRetries: 99 })
        await Promise.resolve()

        expect(istek(ctx, 'solana_signAndSendTransaction').payload.params[0].options)
            .toEqual({ skipPreflight: true, maxRetries: 99 })

        cozumle(ctx, 'solana_signAndSendTransaction', { signature: IMZA_B58, signatureBytes: '' })
        await p
        expect(kareSayisi(ctx)).toBe(1)
    })

    // K5 (Task 48 fix turu, F4 duzeltmesi): opts hic verilmezse `options`in
    // DEGERI `undefined`dir -- alanin KENDISI dusmez. Structured clone
    // (gercek postMessage) undefined-degerli own property'yi KORUR; yalnizca
    // JSON.stringify duser (bu dosyanin sahte postMessage'i da nesneyi
    // dogrudan itiyor, hic serilestirmiyor). Iddia "deger undefined"dir --
    // bu yuzden `options: opts ?? {}` gibi bir varsayilan-deger mutanti da
    // burada YAKALANIR. Yukaridaki test sayfanin FILTRELEMEDIGINI kanitlar,
    // bu test dapp opts vermedigi zaman fazladan bir DEGER UYDURMADIGINI
    // kanitlar.
    it('opts verilmezse options alani gitmez (undefined)', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const p = ctx.solana.signAndSendTransaction(legacyIslem())
        await Promise.resolve()

        expect(istek(ctx, 'solana_signAndSendTransaction').payload.params[0].options).toBeUndefined()

        cozumle(ctx, 'solana_signAndSendTransaction', { signature: IMZA_B58, signatureBytes: '' })
        await p
    })

    it('v0 islemi argumansiz serilestirir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = v0Islem()
        const p = ctx.solana.signAndSendTransaction(tx)
        await Promise.resolve()

        expect(istek(ctx, 'solana_signAndSendTransaction').payload.params[0].transaction)
            .toBe(Buffer.from(tx.serialize()).toString('base64'))

        cozumle(ctx, 'solana_signAndSendTransaction', { signature: IMZA_B58, signatureBytes: '' })
        await p
    })

    // K2: sekil kapisi -- arka plan yaniti dizge bir `signature` tasimiyorsa
    // {signature: undefined} ile SESSIZCE cozulmek yerine reddedilir. Mutasyon
    // kaniti: kapiyi kaldir -> ayni yanitla COZULUR -> bu test kirmizi.
    it('sonucta dizge bir signature YOKSA "unexpected response" ile reddeder', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const p = ctx.solana.signAndSendTransaction(legacyIslem())
        await Promise.resolve()

        cozumle(ctx, 'solana_signAndSendTransaction', { signatureBytes: '' })

        await expect(p).rejects.toThrow('Wallet returned an unexpected response.')
    })

    // Task 48 fix turu, F2 (Important): K2 kapisinin UC DALI da ayri ayri
    // sinanir -- yukaridaki test yalnizca "signature ALANI YOK" dalini
    // kapsiyordu. (c) push-lane dinleyicisi `data.result`i OLDUGU GIBI
    // cozer (solanaInjected.js:238 `resolve(result)`); `result: null` ile
    // `sonuc` da `null` olur.
    it.each([
        ['bos DIZGE signature', { signature: '', signatureBytes: '' }],
        ['dizge OLMAYAN signature (number)', { signature: 7, signatureBytes: '' }],
        ['sonuc BASTAN null (result: null)', null],
    ])('K2 -- %s -- unexpected response ile reddeder', async (_ad, yanit) => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const p = ctx.solana.signAndSendTransaction(legacyIslem())
        await Promise.resolve()

        cozumle(ctx, 'solana_signAndSendTransaction', yanit)

        await expect(p).rejects.toThrow('Wallet returned an unexpected response.')
    })

    // K4: arka planin :1084 varyanti (yayin durumu belirsiz) fazladan alanlar
    // tasir; legacy serit yalnizca `signature`i disari verir -- dapp'in
    // gormedigi ic muhasebe alanlari (broadcastStatusUnknown/broadcastError)
    // SIZMAZ.
    it('arka planin fazladan alanlari (broadcastStatusUnknown/broadcastError) SIZMAZ', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const p = ctx.solana.signAndSendTransaction(legacyIslem())
        await Promise.resolve()

        cozumle(ctx, 'solana_signAndSendTransaction', {
            signature: IMZA_B58,
            signatureBytes: Buffer.from(IMZA).toString('base64'),
            broadcastStatusUnknown: true,
            broadcastError: 'SOLANA_SEND_FAILED',
        })
        const sonuc = await p

        expect(sonuc).toEqual({ signature: IMZA_B58 })
        expect(Object.keys(sonuc)).toEqual(['signature'])
    })

    // K1: brief'in uydurma SOLANA_BLOCKHASH_EXPIRED zarfi yerine, dapp'in bu
    // seritte GERCEKTEN gorebilecegi dort zarf (dappFunctions.js :18/:35/:60,
    // solanaDappFunctions.js :49). Blockhash tazelik hatasi onay-SONRASI
    // olusur (signAndSendFromApproval, solanaDappFunctions.js ~:1052) ve
    // ekran acik kaldigi surece dapp'e KOD OLARAK ULASMAZ -- bu yuzden burada
    // sinanmaz.
    it('K1(a) kullanici reddi -- 4001 duz kalir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const p = ctx.solana.signAndSendTransaction(legacyIslem()).catch((e) => e)
        await Promise.resolve()
        reddet(ctx, 'solana_signAndSendTransaction', { code: 4001, message: 'User rejected the request.' })
        const err = await p

        expect(err.code).toBe(4001)
        expect(err.message).toBe('User rejected the request.')
    })

    it("K1(b) 'User closed the window.' -- 4001 KALIR", async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const p = ctx.solana.signAndSendTransaction(legacyIslem()).catch((e) => e)
        await Promise.resolve()
        reddet(ctx, 'solana_signAndSendTransaction', { code: 4001, message: 'User closed the window.' })
        const err = await p

        expect(err.code).toBe(4001)
    })

    it("K1(c) 'Request replaced by a new one.' -- -32002'ye cevirir (hamMesaj sizmaz)", async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const p = ctx.solana.signAndSendTransaction(legacyIslem()).catch((e) => e)
        await Promise.resolve()
        reddet(ctx, 'solana_signAndSendTransaction', { code: 4001, message: 'Request replaced by a new one.' })
        const err = await p

        expect(err.code).toBe(-32002)
        expect(err.message).toBe('User rejected the request.')
        expect(err.hamMesaj).toBe('Request replaced by a new one.')
        expect(Object.keys(err)).not.toContain('hamMesaj')
    })

    // K1(d): BAGLANMADAN istek yine GIDER -- sayfa betigi kapi DEGILDIR,
    // guvenlik karari arka plandadir. `account` null gider; arka planin
    // GERCEK SOLANA_YETKISIZ zarfi budur (solanaDappFunctions.js:49):
    // { code: 4100, message: 'Unauthorized.' } -- mesajsiz DEGIL.
    it('K1(d) baglanmadan istek yine gider (account null), arka plan 4100 ile reddeder', async () => {
        const ctx = kurLegacySayfa()
        const p = ctx.solana.signAndSendTransaction(legacyIslem()).catch((e) => e)
        await Promise.resolve()
        expect(istek(ctx, 'solana_signAndSendTransaction').payload.params[0].account).toBe(null)
        reddet(ctx, 'solana_signAndSendTransaction', { code: 4100, message: 'Unauthorized.' })
        const err = await p

        expect(err.code).toBe(4100)
        expect(err.message).toBe('Unauthorized.')
    })

    // Task 48 fix turu, F1 (Important): K7 YANLIS ATLANDI -- 'legacy
    // signTransaction' describe'indeki IKI gecersiz-girdi pini ('feePayer yok
    // ve adresimiz talimatlarda GECMIYORSA -32602' ve 'recentBlockhash yoksa
    // istek arka plana HIC gitmez') burada BIREBIR aynalanir: ayni yardimci
    // cagrilar, ayni mesaj literalleri. (Fix turu 1, F5: satir numarasi yerine
    // TEST ADI -- satir numaralari dosya buyudukce kayar.)
    // legacySerialize'in fee payer / blockhash kapilarindan hicbiri bu
    // metoda OZGU degildir -- ikisi de PENCERE ACILMADAN, istek arka plana
    // HIC gitmeden reddeder.
    it('feePayer yok ve adresimiz talimatlarda GECMIYORSA -32602', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const tx = new Transaction()
        tx.recentBlockhash = BLOCKHASH
        tx.add(SystemProgram.transfer({
            fromPubkey: new PublicKey(ALICI), toPubkey: new PublicKey(ALICI), lamports: 1,
        }))
        const oncekiSayi = ctx.gonderilen.length

        const err = await ctx.solana.signAndSendTransaction(tx).catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBe(-32602)
        expect(err.message).toBe('Transaction fee payer required.')
        expect(ctx.gonderilen.length).toBe(oncekiSayi)
    })

    it('recentBlockhash yoksa istek arka plana HIC gitmez', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const oncekiSayi = ctx.gonderilen.length

        const err = await ctx.solana.signAndSendTransaction(legacyIslem({ blockhash: false })).catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBe(-32602)
        expect(err.message).toBe('Transaction recentBlockhash required.')
        expect(ctx.gonderilen.length).toBe(oncekiSayi)
    })
})

// ===================== Task 49: legacy signMessage =====================
describe('legacy signMessage', () => {
    const MESAJ = new TextEncoder().encode('Wats cuzdan testi: bu mesaji imzaliyorum.')

    it('baytlari base64 e cevirir ve imzayi Uint8Array olarak doner', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)

        const p = ctx.solana.signMessage(MESAJ)
        await Promise.resolve()
        const m = istek(ctx, 'solana_signMessage')
        expect(m.payload.params[0].message).toBe(Buffer.from(MESAJ).toString('base64'))
        expect(m.payload.params[0].account).toBe(ADRES)

        cozumle(ctx, 'solana_signMessage', {
            signature: Buffer.from(IMZA).toString('base64'),
            signedMessage: Buffer.from(MESAJ).toString('base64'),
        })
        const sonuc = await p

        expect(sonuc.signature).toBeInstanceOf(Uint8Array)
        expect(sonuc.signature).toEqual(IMZA)
        // R6: duz veri ozelligi -- AYNI referans, kopya degil.
        expect(sonuc.publicKey).toBe(ctx.solana.publicKey)
    })

    // `display` GIRDI KODLAMASI DEGIL, ekrana render ipucudur (SS3.5).
    // Baytlari onunla cozmek, dapp'in kullaniciya gosterileni SECMESI demek
    // olurdu -- imzalanan sey ile gorunen sey ayrisirdi.
    it('display ipucu AYNEN iletilir ama baytlari ETKILEMEZ', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)

        const p = ctx.solana.signMessage(MESAJ, 'hex')
        await Promise.resolve()
        const m = istek(ctx, 'solana_signMessage')
        expect(m.payload.params[0].display).toBe('hex')
        expect(m.payload.params[0].message).toBe(Buffer.from(MESAJ).toString('base64'))

        cozumle(ctx, 'solana_signMessage', {
            signature: Buffer.from(IMZA).toString('base64'),
            signedMessage: Buffer.from(MESAJ).toString('base64'),
        })
        await p
    })

    it('bilinmeyen display degeri utf8 e duser', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const p = ctx.solana.signMessage(MESAJ, 'kendi-uydurdugum')
        await Promise.resolve()
        expect(istek(ctx, 'solana_signMessage').payload.params[0].display).toBe('utf8')
        cozumle(ctx, 'solana_signMessage', {
            signature: Buffer.from(IMZA).toString('base64'),
            signedMessage: Buffer.from(MESAJ).toString('base64'),
        })
        await p
    })

    // btoa(String.fromCharCode(...bytes)) yayilimi buyuk girdilerde RangeError
    // atar (SS3.3); 8KB parcali kodlayici tam bunun icin var.
    it('buyuk mesaj RangeError ATMAZ (base64 gidis-donusu)', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const buyuk = new Uint8Array(200000).map((_, i) => i % 251)

        const p = ctx.solana.signMessage(buyuk)
        await Promise.resolve()
        expect(istek(ctx, 'solana_signMessage').payload.params[0].message)
            .toBe(Buffer.from(buyuk).toString('base64'))

        cozumle(ctx, 'solana_signMessage', {
            signature: Buffer.from(IMZA).toString('base64'),
            signedMessage: '',
        })
        await p
    })

    // R1 (Gorev 49 controller karari): brief'in uydurdugu {code:4001, data:{...}}
    // zarfi YERINE arka planin GERCEK pencere-ONCESI zarfi -- SOLANA_MESSAGE_LOOKS_LIKE_TX
    // `uygulamaHatasi(kod)`tan gelir (solanaDappFunctions.js:50/:409): {code:-32603,
    // message:kod, data:{code:kod}}. legacyError -32603'u ESLEMEZ (typeof kod
    // === 'number' dalindan degismeden gecer) ve STANDART_MESAJ'da -32603 yok,
    // yani ham mesaj (kod dizgesi) dapp'e OLDUGU GIBI ulasir.
    it('SOLANA_MESSAGE_LOOKS_LIKE_TX reddi GERCEK zarfla ulasir (-32603, data korunur)', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const p = ctx.solana.signMessage(MESAJ)
        await Promise.resolve()
        reddet(ctx, 'solana_signMessage', {
            code: -32603,
            message: 'SOLANA_MESSAGE_LOOKS_LIKE_TX',
            data: { code: 'SOLANA_MESSAGE_LOOKS_LIKE_TX' },
        })
        const err = await p.catch((e) => e)
        expect(err.code).toBe(-32603)
        expect(err.message).toBe('SOLANA_MESSAGE_LOOKS_LIKE_TX')
        expect(err.data).toEqual({ code: 'SOLANA_MESSAGE_LOOKS_LIKE_TX' })
    })

    // R2: sayfa betigi GUVENLIK KAPISI DEGILDIR -- baglanmadan bile istek
    // GIDER (account null ile), karar arka planda verilir (SOLANA_YETKISIZ,
    // solanaDappFunctions.js:49).
    it('baglanmadan istek yine gider (account null), arka plan 4100 ile reddeder', async () => {
        const ctx = kurLegacySayfa()
        const oncekiSayi = ctx.gonderilen.length
        const p = ctx.solana.signMessage(MESAJ).catch((e) => e)
        await Promise.resolve()
        expect(ctx.gonderilen.length).toBe(oncekiSayi + 1)
        expect(istek(ctx, 'solana_signMessage').payload.params[0].account).toBe(null)
        reddet(ctx, 'solana_signMessage', { code: 4100, message: 'Unauthorized.' })
        const err = await p

        expect(err.code).toBe(4100)
        expect(err.message).toBe('Unauthorized.')
    })

    // R3: 4001'in GERCEK metinleri -- "reddettim" ile "mesgul/degistirildi"
    // farkli kodlardir (Gorev 45b, legacyError'un MESGUL_4001 seti).
    it("4001 + 'User rejected the request.' -- 4001 KALIR", async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const p = ctx.solana.signMessage(MESAJ).catch((e) => e)
        await Promise.resolve()
        reddet(ctx, 'solana_signMessage', { code: 4001, message: 'User rejected the request.' })
        const err = await p

        expect(err.code).toBe(4001)
        expect(err.message).toBe('User rejected the request.')
    })

    it("4001 + 'Request replaced by a new one.' -- -32002'ye cevirir (hamMesaj sizmaz)", async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const p = ctx.solana.signMessage(MESAJ).catch((e) => e)
        await Promise.resolve()
        reddet(ctx, 'solana_signMessage', { code: 4001, message: 'Request replaced by a new one.' })
        const err = await p

        expect(err.code).toBe(-32002)
        expect(err.message).toBe('User rejected the request.')
        expect(err.hamMesaj).toBe('Request replaced by a new one.')
        expect(Object.keys(err)).not.toContain('hamMesaj')
    })

    // R7: sekil kapisi (Gorev 48 K2'nin aynasi) -- ed25519 imzasi HER ZAMAN
    // 64 bayttir; sonuc yoksa, signature dizge degilse/bossa ya da cozulen
    // imza 64 bayt degilse SESSIZCE cozulmek yerine reddedilir.
    it.each([
        ['sonuc BASTAN null', null],
        ['signature ALANI YOK', { signedMessage: '' }],
        ['bos DIZGE signature', { signature: '', signedMessage: '' }],
        ['dizge OLMAYAN signature (number)', { signature: 7, signedMessage: '' }],
        ['cozulen imza 64 bayt DEGIL (10 bayt)', {
            signature: Buffer.from(new Uint8Array(10)).toString('base64'), signedMessage: '',
        }],
        // Fix turu 1, F2 (Minor): SINIR degerleri -- 63 (bir eksik) ve 65 (bir
        // fazla). `!== 64` yerine `< 64` gibi bir mutasyon yalnizca 63'u
        // yakalar, 65'i KACIRIR -- 65 satiri bu bosluga ozel.
        ['cozulen imza 63 bayt (bir eksik)', {
            signature: Buffer.from(new Uint8Array(63)).toString('base64'), signedMessage: '',
        }],
        ['cozulen imza 65 bayt (bir fazla)', {
            signature: Buffer.from(new Uint8Array(65)).toString('base64'), signedMessage: '',
        }],
    ])('K2 aynasi -- %s -- unexpected response ile reddeder', async (_ad, yanit) => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const p = ctx.solana.signMessage(MESAJ)
        await Promise.resolve()
        cozumle(ctx, 'solana_signMessage', yanit)

        await expect(p).rejects.toThrow('Wallet returned an unexpected response.')
    })

    // Fix turu 1, F4 (Minor): bozuk base64 `atob`'dan ham bir DOMException
    // (InvalidCharacterError, sayisal `.code`) firlatir -- typeof/length
    // kapilarindan GECER (dizge ve bos degil) ama `atob` patlar. Yakalanmazsa
    // legacyError'un sayisal-kod dalindan GECIP dapp'e motor hatasi sizardi.
    it("bozuk base64 signature ('!!!!') unexpected response ile reddeder, motor hatasi SIZMAZ", async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const p = ctx.solana.signMessage(MESAJ)
        await Promise.resolve()
        cozumle(ctx, 'solana_signMessage', { signature: '!!!!', signedMessage: '' })

        await expect(p).rejects.toThrow('Wallet returned an unexpected response.')
    })

    // R8: GIRDI TIPI KAPISI -- sayfa yalnizca TIP ve YANIT SEKLI kapilar;
    // boyut/icerik kapisi ARKA PLANDADIR (mesajYukKapisi). Kabul edilmeyen
    // tipte istek arka plana HIC gitmez (:406 WS deseninin aynasi).
    it.each([
        ['dizge', 'merhaba'],
        ['undefined', undefined],
        ['null', null],
        ['sayi', 7],
        ['duz nesne', {}],
    ])('gecersiz tip (%s) -32602 ile PENCERE ACILMADAN reddeder', async (_ad, girdi) => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const oncekiSayi = ctx.gonderilen.length

        const err = await ctx.solana.signMessage(girdi).catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBe(-32602)
        expect(err.message).toBe('Message must be a Uint8Array.')
        expect(ctx.gonderilen.length).toBe(oncekiSayi)
    })

    it('ArrayBuffer girdisi Uint8Array e cevrilir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const dizi = [1, 2, 3]
        const p = ctx.solana.signMessage(new Uint8Array(dizi).buffer)
        await Promise.resolve()
        expect(istek(ctx, 'solana_signMessage').payload.params[0].message)
            .toBe(Buffer.from(dizi).toString('base64'))
        cozumle(ctx, 'solana_signMessage', {
            signature: Buffer.from(IMZA).toString('base64'), signedMessage: '',
        })
        await p
    })

    it('duz sayi dizisi (Array) Uint8Array e cevrilir', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const dizi = [1, 2, 3]
        const p = ctx.solana.signMessage(dizi)
        await Promise.resolve()
        expect(istek(ctx, 'solana_signMessage').payload.params[0].message)
            .toBe(Buffer.from(dizi).toString('base64'))
        cozumle(ctx, 'solana_signMessage', {
            signature: Buffer.from(IMZA).toString('base64'), signedMessage: '',
        })
        await p
    })

    // Fix turu 1, F1(b) (Important): OFFSETLI bir view -- :406 WS deseninin
    // aynasinda `ArrayBuffer.isView` dali `.byteOffset/.byteLength`i
    // KULLANMAK ZORUNDA, `new Uint8Array(view.buffer)` gibi bir kisayol
    // altta yatan TAM buffer'i (offsetten ONCEKI baytlarla birlikte) tasir.
    it.each([
        ['DataView', (buf) => new DataView(buf, 2, 3)],
        ['Int8Array', (buf) => new Int8Array(buf, 2, 3)],
    ])('offsetli %s view SADECE kendi dilimini tasir', async (_ad, kurView) => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const buf = new Uint8Array([9, 9, 1, 2, 3, 9]).buffer
        const p = ctx.solana.signMessage(kurView(buf))
        await Promise.resolve()
        expect(istek(ctx, 'solana_signMessage').payload.params[0].message)
            .toBe(Buffer.from([1, 2, 3]).toString('base64'))
        cozumle(ctx, 'solana_signMessage', {
            signature: Buffer.from(IMZA).toString('base64'), signedMessage: '',
        })
        await p
    })

    // Fix turu 1, F1(c) (Important): AYRIK (detached) bir ArrayBuffer --
    // structuredClone'un transfer'i sonrasi view'in .buffer/.byteOffset/
    // .byteLength'i motor-duzeyinde TypeError atar (Node 22, dogrulandi).
    // legacyMesajBaytlari bu ham hatayi YUTUP ayni -32602 govdesine dusurmeli
    // -- yutmazsa dapp bir motor mesaji gorur, PENCERE ACILMADAN kurali da
    // (istek arka plana hic gitmemesi) bu yolda ayrica sinanir.
    it('ayrik (detached) ArrayBuffer view -32602 ile PENCERE ACILMADAN reddeder', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const buf = new ArrayBuffer(4)
        const view = new DataView(buf)
        structuredClone(buf, { transfer: [buf] })
        const oncekiSayi = ctx.gonderilen.length

        const err = await ctx.solana.signMessage(view).catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBe(-32602)
        expect(err.message).toBe('Message must be a Uint8Array.')
        expect(ctx.gonderilen.length).toBe(oncekiSayi)
    })

    // Bos mesaj SAYFADA kapilanmaz: istek arka plana gider, karar orada
    // verilir (mesajYukKapisi -- TX_DESERIALIZE_FAILED, Gorev 22 mirasi).
    it('bos mesaj SAYFADA kapilanmaz, istek gider', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const oncekiSayi = ctx.gonderilen.length
        const p = ctx.solana.signMessage(new Uint8Array(0)).catch((e) => e)
        await Promise.resolve()

        expect(ctx.gonderilen.length).toBe(oncekiSayi + 1)
        expect(istek(ctx, 'solana_signMessage').payload.params[0].message).toBe('')

        cozumle(ctx, 'solana_signMessage', {
            signature: Buffer.from(IMZA).toString('base64'), signedMessage: '',
        })
        await p
    })
})

describe('legacy yuzeyin TAMAMI (SS3.5 tablosu)', () => {
    // Eksik TEK bir uye, o uyeyi yoklayan her dapp'i kirar; tablo bu yuzden
    // tek bir yerde ve tek seferde kilitlenir.
    it('SS3.5 uye kumesinin tamami vardir', () => {
        const ctx = kurLegacySayfa()
        for (const ad of [
            'connect', 'disconnect', 'signTransaction', 'signAllTransactions',
            'signAndSendTransaction', 'signMessage', 'on', 'off', 'removeListener',
        ]) {
            expect(typeof ctx.solana[ad], ad).toBe('function')
        }
        expect('publicKey' in ctx.solana).toBe(true)
        expect('isConnected' in ctx.solana).toBe(true)
        expect('isPhantom' in ctx.solana).toBe(false)
    })

    // R4 (Gorev 49 controller karari): uye kumesi TAM 13 addir -- ne fazla ne
    // eksik. Yukaridaki typeof-function dongusu var-olmayan bir uyeyi hic
    // yoklamaz, bu yuzden liste burada AYRICA ve TAM olarak kilitlenir.
    // Mutasyon kaniti: legacyProvider literaline `isPhantom: false` eklenirse
    // bu test KIRMIZI olur (Object.keys 14 elemanli olur).
    it('uye kumesi TAM 13 addir, fazlasi yoktur', () => {
        const ctx = kurLegacySayfa()
        expect(Object.keys(ctx.solana).sort()).toEqual([
            'isWatsWallet', 'publicKey', 'isConnected', 'connect', 'disconnect',
            'signTransaction', 'signAllTransactions', 'signAndSendTransaction',
            'signMessage', 'on', 'off', 'removeListener', 'legacySlot',
        ].sort())
    })

    // Fix turu 1, F3 (Minor): `Object.keys` NON-ENUMERABLE ve Symbol
    // anahtarlari GORMEZ -- `Reflect.ownKeys` butun sahiplik anahtarlarini
    // (enumerable olsun olmasin, Symbol dahil) doner. Mutasyon kaniti:
    // legacyProvider'a `Object.defineProperty(..., 'isBraveWallet', {value:
    // true, enumerable: false})` eklenirse Object.keys testi YESIL kalir ama
    // bu test KIRMIZI olur.
    it('Reflect.ownKeys de TAM 13 addir -- non-enumerable/Symbol uye yok', () => {
        const ctx = kurLegacySayfa()
        expect(Reflect.ownKeys(ctx.solana).map(String).sort()).toEqual([
            'isWatsWallet', 'publicKey', 'isConnected', 'connect', 'disconnect',
            'signTransaction', 'signAllTransactions', 'signAndSendTransaction',
            'signMessage', 'on', 'off', 'removeListener', 'legacySlot',
        ].sort())
        expect(Reflect.ownKeys(ctx.solana).some((k) => typeof k === 'symbol')).toBe(false)
    })

    it('legacySlot kurLegacySayfa da claim aninda atanir', () => {
        const ctx = kurLegacySayfa()
        expect(ctx.solana.legacySlot).toBe('ours')
    })

    it('prototip uzerinden gizli uye yok (Object.prototype)', () => {
        const ctx = kurLegacySayfa()
        expect(Object.getPrototypeOf(ctx.solana)).toBe(Object.prototype)
    })

    // SS2.1: genel `request({method, params})` giris noktasi KAPSAM DISI --
    // varsa dapp'ler onun uzerinden adlandirilmamis metotlar dener ve kapi
    // matrisi (SS4.3.1) atlanmis olur.
    it('genel request() giris noktasi YOKTUR', () => {
        const ctx = kurLegacySayfa()
        expect(ctx.solana.request).toBeUndefined()
    })
})

// ===================== NIHAI INCELEME C4.1: callBackground DataCloneError =====================
// Task 48 deferred, confirmed: `callbacks.set` postMessage'DAN ONCE calisiyordu.
// Klonlanamayan (structured-clone edilemez) bir dapp nesnesi (fonksiyon, Symbol)
// gercek `window.postMessage`i SENKRON firlatir; callback kaydi ZATEN Map'e
// girmis oldugundan orada SONSUZA dek kalir (yetim callback) VE dapp ham
// DataCloneError'u (code 25) gorur, sayfa-ici -32602 govdesini DEGIL.
describe('solanaInjected -- callBackground DataCloneError korumasi (C4.1)', () => {
    function yanitla(win, gonderi, govde) {
        const olay = new Event('message')
        olay.source = win
        olay.data = { target: 'wats_solana_inpage', id: gonderi.id, ...govde }
        win.dispatchEvent(olay)
    }

    /** Gercek postMessage'in davranisini taklit eder: klonlanamaz bir deger (fonksiyon) SENKRON firlatir. */
    function fonksiyonIceriyorMu(v, gorulmus = new Set()) {
        if (typeof v === 'function') return true
        if (v && typeof v === 'object') {
            if (gorulmus.has(v)) return false
            gorulmus.add(v)
            return Object.values(v).some((c) => fonksiyonIceriyorMu(c, gorulmus))
        }
        return false
    }

    function postMesajiKlonlanamazYap(win) {
        const asil = win.postMessage.bind(win)
        win.postMessage = (data) => {
            if (fonksiyonIceriyorMu(data)) {
                throw Object.assign(new Error('x'), { name: 'DataCloneError', code: 25 })
            }
            asil(data)
        }
    }

    const hesapYap = () => ({
        address: ADRES, publicKey: new Uint8Array(32), chains: ['solana:mainnet'], features: [],
    })

    it('WS signAndSendTransaction: klonlanamayan options -32602 ile reddeder, yetim callback BIRAKMAZ', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))
        postMesajiKlonlanamazYap(win)

        const soz = cuzdan.features['solana:signAndSendTransaction'].signAndSendTransaction({
            account: hesapYap(), transaction: new Uint8Array([1]), chain: 'solana:mainnet',
            options: { fn() {} },
        })

        await expect(soz).rejects.toMatchObject({ code: -32602, message: 'Invalid request parameters.' })
        // Klonlanamayan cagri hic postMessage'a ULASMADI (harness'in gonderilen
        // dizisine dusmedi): asil sinama budur, Map'e dogrudan erisim yoktur.
        expect(win.gonderilen.find((m) => m.payload?.method === 'solana_signAndSendTransaction')).toBeUndefined()

        // Dolayli sizinti kaniti: SONRAKI normal cagri sorunsuz cozulur --
        // yetim bir callback varsa bile yeni id'nin cozulmesini engellemez,
        // ama en azindan cagrinin KENDISI PROMISE seviyesinde bozulmadigini
        // gosterir.
        const soz2 = cuzdan.features['solana:signAndSendTransaction'].signAndSendTransaction({
            account: hesapYap(), transaction: new Uint8Array([2]), chain: 'solana:mainnet',
        })
        const giden2 = win.gonderilen.find((m) => m.payload?.method === 'solana_signAndSendTransaction')
        yanitla(win, giden2, { result: { signature: 'S', signatureBytes: btoa('s'.repeat(64)) } })
        await expect(soz2).resolves.toBeTruthy()
    })

    it('legacy signAndSendTransaction: klonlanamayan options -32602 ile legacyError uzerinden gecer (kod 25 DEGIL)', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        postMesajiKlonlanamazYap(ctx.win)

        const err = await ctx.solana.signAndSendTransaction(legacyIslem(), { fn() {} }).catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBe(-32602)
        expect(err.message).toBe('Invalid request parameters.')
        expect(err.code).not.toBe(25)
        expect(ctx.gonderilen.find((m) => m.payload?.method === 'solana_signAndSendTransaction')).toBeUndefined()
    })
})

// ===================== NIHAI INCELEME C4.2: WS connect change yayini =====================
// Her DIGER yol paylasimli hesabi degistirdiginde `change` yayinlar (legacy
// connect :827-833 -- 'yon 3' testi asagida aynalanir --, WS signIn :373,
// disconnect'ler, cuzdan kaynakli itme); WS `standard:connect` bu kuraldan
// bir istisnaydi. `standard:events`i tek gercek kaynagi sayan bir dapp WS
// connect'ten hesabi HICBIR ZAMAN ogrenmezdi.
describe('solanaInjected -- WS connect change yayini (C4.2)', () => {
    function yanitla(win, gonderi, govde) {
        const olay = new Event('message')
        olay.source = win
        olay.data = { target: 'wats_solana_inpage', id: gonderi.id, ...govde }
        win.dispatchEvent(olay)
    }

    const PK1 = btoa(String.fromCharCode(...new Uint8Array(32).fill(3)))
    const PK2 = btoa(String.fromCharCode(...new Uint8Array(32).fill(4)))
    const ADRES1 = 'So11111111111111111111111111111111111111112'
    const ADRES2 = 'So11111111111111111111111111111111111111113'

    it('yon 3 (WS aynasi): ilk connect standard:events change YAYAR, tek eleman ve hesap AYNI', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))
        const degisimler = []
        cuzdan.features['standard:events'].on('change', (d) => degisimler.push(d))

        const p = cuzdan.features['standard:connect'].connect()
        yanitla(win, win.gonderilen[0], { result: { address: ADRES1, publicKey: PK1 } })
        await p

        expect(degisimler).toHaveLength(1)
        expect(degisimler[0].accounts).toHaveLength(1)
        expect(degisimler[0].accounts[0].address).toBe(ADRES1)
        // Ruling: WS connect legacy 'connect' olayini YAYMAZ -- o yalnizca
        // legacy seridin KENDI eyleminde anlamlidir.
    })

    it('AYNI adresle YENIDEN baglaninca change TEKRAR YAYILMAZ', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))
        const degisimler = []

        const p1 = cuzdan.features['standard:connect'].connect()
        yanitla(win, win.gonderilen[0], { result: { address: ADRES1, publicKey: PK1 } })
        await p1

        cuzdan.features['standard:events'].on('change', (d) => degisimler.push(d))

        const p2 = cuzdan.features['standard:connect'].connect()
        const gonderi2 = win.gonderilen[win.gonderilen.length - 1]
        yanitla(win, gonderi2, { result: { address: ADRES1, publicKey: PK1 } })
        await p2

        expect(degisimler).toHaveLength(0)
    })

    it('FARKLI adresle baglaninca change YENIDEN yayilir (iki connect -> iki change)', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))
        const degisimler = []
        cuzdan.features['standard:events'].on('change', (d) => degisimler.push(d))

        const p1 = cuzdan.features['standard:connect'].connect()
        yanitla(win, win.gonderilen[0], { result: { address: ADRES1, publicKey: PK1 } })
        await p1

        const p2 = cuzdan.features['standard:connect'].connect()
        const gonderi2 = win.gonderilen[win.gonderilen.length - 1]
        yanitla(win, gonderi2, { result: { address: ADRES2, publicKey: PK2 } })
        await p2

        expect(degisimler).toHaveLength(2)
        expect(degisimler[0].accounts[0].address).toBe(ADRES1)
        expect(degisimler[1].accounts[0].address).toBe(ADRES2)
    })
})

// ===================== NIHAI INCELEME C4.3: WS disconnect arka plan reddinde bile temizler =====================
// Onceki govde `await callBackground(...)`in reddiyle ERKEN CIKARDI: `hesap`
// set kalirdi (`wallet.accounts` bos degil), `legacySenkronla()` hic
// cagrilmazdi (`window.solana.isConnected` hala true), `change` YAYILMAZDI ve
// legacy 'disconnect' olayi hic gorulmezdi. Oturum arka planda zaten kesilmis
// (revoke edilmis oturum, kapanan MV3 portu, DataCloneError) olsa bile dapp
// "hala bagli" sanardi ve sonraki imzalar sessizce 4100 donerdi.
describe('solanaInjected -- WS disconnect arka plan reddinde de temizler (C4.3)', () => {
    it('red -- hesap/change/legacy disconnect yine de TEMIZLENIR, hata YINE FIRLATILIR', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const wallet = ctx.win.wats.solana.wallet

        const degisimler = []
        wallet.features['standard:events'].on('change', (d) => degisimler.push(d))
        const legacyGorulen = []
        ctx.solana.on('disconnect', () => legacyGorulen.push('disconnect'))

        const p = wallet.features['standard:disconnect'].disconnect()
        await Promise.resolve()
        reddet(ctx, 'solana_disconnect', { code: 4100, message: 'Unauthorized.' })

        await expect(p).rejects.toMatchObject({ code: 4100 })
        expect(wallet.accounts).toEqual([])
        expect(ctx.solana.isConnected).toBe(false)
        expect(ctx.solana.publicKey).toBeNull()
        expect(degisimler).toEqual([{ accounts: [] }])
        expect(legacyGorulen).toEqual(['disconnect'])
    })
})

// ===================== NIHAI INCELEME C4.4: legacySerialize girdi kapilari =====================
// Task 48 deferred, refined: null/primitif bir tx HAM bir TypeError firlatiyordu
// (legacyError sarmalamasini ATLAYARAK); baglanmadan (feePayer'siz, publicKey
// null) gelen bir tx, web3.js'in KENDI ham "Transaction fee payer required"
// hatasini dapp'e SIZDIRIYORDU -- K10'un mainstream akisinda (wallet itmesi
// publicKey'i null'lar) arka planin 4100'u HIC gorulmuyordu. Ve `tx.serialize`
// firlatirsa (bozuk/uyumsuz bir dapp nesnesi) o ham metin de dapp'e duserdi.
describe('legacy legacySerialize girdi kapilari (C4.4)', () => {
    it.each([
        ['null', null],
        ['sayi (42)', 42],
        ['dizge (x)', 'x'],
    ])('signTransaction(%s) -32602 Transaction must be an object ile reddeder, transport SIFIR', async (_ad, girdi) => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const oncekiSayi = ctx.gonderilen.length

        const err = await ctx.solana.signTransaction(girdi).catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBe(-32602)
        expect(err.message).toBe('Transaction must be an object.')
        expect(ctx.gonderilen.length).toBe(oncekiSayi)
    })

    it('signAllTransactions([null]) -32602 Transaction must be an object ile reddeder, transport SIFIR', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const oncekiSayi = ctx.gonderilen.length

        const err = await ctx.solana.signAllTransactions([null]).catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBe(-32602)
        expect(err.message).toBe('Transaction must be an object.')
        expect(ctx.gonderilen.length).toBe(oncekiSayi)
    })

    it('signAndSendTransaction(undefined) -32602 Transaction must be an object ile reddeder, transport SIFIR', async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const oncekiSayi = ctx.gonderilen.length

        const err = await ctx.solana.signAndSendTransaction(undefined).catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBe(-32602)
        expect(err.message).toBe('Transaction must be an object.')
        expect(ctx.gonderilen.length).toBe(oncekiSayi)
    })

    // K10 mainstream akisi: bir wallet itmesi (arka plan hesap degistirir)
    // `hesap`i null'lar, `legacySenkronla` `legacyProvider.publicKey`i de
    // null'lar. Bu andan sonra feePayer'siz bir tx artik "gercek anahtardan
    // bul" dalina hic GIRMEMELI -- publicKey zaten yok, aranacak bir "bizim
    // adresimiz" tanimsizdir. Acik bir 4100 ile, PENCERE ACILMADAN reddedilir.
    it("wallet itmesi hesabi NULL'ladiktan SONRA feePayer'siz tx 4100 Unauthorized ile reddeder, transport SIFIR", async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        yanitla(ctx, { target: 'wats_solana_inpage', event: { event: 'change', payload: { accounts: [] } } })
        expect(ctx.solana.publicKey).toBeNull()

        const tx = legacyIslem({ feePayer: false })
        const oncekiSayi = ctx.gonderilen.length

        const err = await ctx.solana.signTransaction(tx).catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBe(4100)
        expect(err.message).toBe('Unauthorized.')
        expect(ctx.gonderilen.length).toBe(oncekiSayi)
    })

    // `tx.serialize` FIRLATIRSA (uyumsuz/bozuk bir dapp nesnesi) ham motor
    // metni ("boom") dapp'e SIZMAMALI -- ayni "beklenmedik" sinifina dusurulur.
    // `feePayer`/`recentBlockhash` BILEREK doldurulmus: yalnizca serialize
    // kapisi sinansin, ust guard'lar devreye GIRMESIN.
    it("tx.serialize() FIRLATIRSA -32602 Transaction could not be serialized ile reddeder, ham metin SIZMAZ", async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const sahteTx = {
            feePayer: 'x', recentBlockhash: 'y',
            serialize() { throw new Error('boom') },
        }
        const oncekiSayi = ctx.gonderilen.length

        const err = await ctx.solana.signTransaction(sahteTx).catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBe(-32602)
        expect(err.message).toBe('Transaction could not be serialized.')
        expect(err.message).not.toContain('boom')
        expect(ctx.gonderilen.length).toBe(oncekiSayi)
    })

    // v0 dalindaki (:632) argumansiz `tx.serialize()` de AYNI korumayi tasir --
    // `'version' in tx` onu v0 saydigi icin uc AYRI cagri noktasi var, ikisi de
    // sinanmali.
    it("v0 tx.serialize() FIRLATIRSA -32602 Transaction could not be serialized ile reddeder, ham metin SIZMAZ", async () => {
        const ctx = kurLegacySayfa()
        await baglan(ctx)
        const sahteV0 = { version: 0, serialize() { throw new Error('boom') } }
        const oncekiSayi = ctx.gonderilen.length

        const err = await ctx.solana.signTransaction(sahteV0).catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.code).toBe(-32602)
        expect(err.message).toBe('Transaction could not be serialized.')
        expect(err.message).not.toContain('boom')
        expect(ctx.gonderilen.length).toBe(oncekiSayi)
    })
})

// ===================== NIHAI INCELEME C4.5: WS yanit sekli guvenligi (sonucBaytlari) =====================
// Task 47 deferred, confirmed: legacy serit yanit sekli/uzunlugunu dogruluyor
// (:772-781 sekil kapisi, :908-922 K2 aynasi) ama WS seridi `base64ToBytes`i
// KAPISIZ cagiriyordu -- eksik bir alan `atob(undefined)` -> ham
// InvalidCharacterError DOMException'a, yanlis uzunluklu bir imza da SESSIZCE
// gecen bir sonuca yol acardi.
describe('solanaInjected -- WS yanit sekli guvenligi sonucBaytlari (C4.5)', () => {
    const ADRES = 'FzYbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'

    function yanitla(win, gonderi, govde) {
        const olay = new Event('message')
        olay.source = win
        olay.data = { target: 'wats_solana_inpage', id: gonderi.id, ...govde }
        win.dispatchEvent(olay)
    }

    const hesapYap = () => ({
        address: ADRES, publicKey: new Uint8Array(32), chains: ['solana:mainnet'], features: [],
    })

    it('solana_connect 31 baytlik (bir eksik) publicKey ile cozulurse unexpected response ile reddeder', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const p = cuzdan.features['standard:connect'].connect()
        yanitla(win, win.gonderilen[0], {
            result: { address: ADRES, publicKey: btoa(String.fromCharCode(...new Uint8Array(31))) },
        })

        const err = await p.catch((e) => e)
        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('Wallet returned an unexpected response.')
        expect(err).not.toBeInstanceOf(DOMException)
    })

    it('solana_signMessage signature ALANI EKSIK sonuc ile cozulurse unexpected response ile reddeder (ham DOMException SIZMAZ)', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const soz = cuzdan.features['solana:signMessage'].signMessage({
            account: { address: ADRES }, message: new Uint8Array([1, 2, 3]),
        })
        const giden = win.gonderilen[win.gonderilen.length - 1]
        // `signature` alani EKSIK: kapisiz kod `base64ToBytes(undefined)` ->
        // `atob('undefined')`e duser -- ham bir InvalidCharacterError.
        yanitla(win, giden, { result: { signedMessage: 'aGk=' } })

        const err = await soz.catch((e) => e)
        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('Wallet returned an unexpected response.')
        expect(err).not.toBeInstanceOf(DOMException)
    })

    it('solana:signTransaction bozuk base64 elemani unexpected response ile reddeder (ham DOMException SIZMAZ)', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const soz = cuzdan.features['solana:signTransaction'].signTransaction({
            account: hesapYap(), transaction: new Uint8Array([1, 2, 3]), chain: 'solana:mainnet',
        })
        const giden = win.gonderilen[win.gonderilen.length - 1]
        yanitla(win, giden, { result: { signedTransactions: ['!!!!'] } })

        const err = await soz.catch((e) => e)
        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('Wallet returned an unexpected response.')
        expect(err).not.toBeInstanceOf(DOMException)
    })

    it('solana:signAndSendTransaction 63 baytlik (bir eksik) signatureBytes ile cozulurse unexpected response ile reddeder', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))

        const soz = cuzdan.features['solana:signAndSendTransaction'].signAndSendTransaction({
            account: hesapYap(), transaction: new Uint8Array([1]), chain: 'solana:mainnet',
        })
        const giden = win.gonderilen.find((m) => m.payload?.method === 'solana_signAndSendTransaction')
        yanitla(win, giden, {
            result: { signature: 'SIG58', signatureBytes: btoa(String.fromCharCode(...new Uint8Array(63))) },
        })

        const err = await soz.catch((e) => e)
        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('Wallet returned an unexpected response.')
        expect(err).not.toBeInstanceOf(DOMException)
    })
})

// ===================== NIHAI INCELEME C4.6: WS girdi tip kapilari =====================
// `solana:signTransaction` :406'da (yukarida) zaten `!(input?.transaction
// instanceof Uint8Array)` kapisi tasiyor. WS `signMessage` ve
// `signAndSendTransaction` bu kapidan YOKSUNDU: bir dizge/undefined/nesne
// girdi `new Uint8Array('abc')` gibi BOS bir payload'a duser (`.length === 0`),
// istek yine de arka plana GIDER ve orada TX_DESERIALIZE_FAILED (-32603) ile
// reddedilir -- ayni hata sinifi metot/seride gore UC FARKLI kod uretir.
describe('solanaInjected -- WS girdi tip kapilari (C4.6)', () => {
    const ADRES = 'FzYbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
    const hesapYap = () => ({
        address: ADRES, publicKey: new Uint8Array(32), chains: ['solana:mainnet'], features: [],
    })

    it("signMessage({message:'abc'}) -32602 Message must be a Uint8Array ile reddeder, transport SIFIR", async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))
        const oncekiSayi = win.gonderilen.length

        const err = await cuzdan.features['solana:signMessage']
            .signMessage({ account: { address: ADRES }, message: 'abc' })
            .catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('Message must be a Uint8Array.')
        expect(win.gonderilen.length).toBe(oncekiSayi)
    })

    it('signAndSendTransaction({transaction:{}}) Transaction must be a Uint8Array ile reddeder, transport SIFIR', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))
        const oncekiSayi = win.gonderilen.length

        const err = await cuzdan.features['solana:signAndSendTransaction']
            .signAndSendTransaction({ account: hesapYap(), transaction: {}, chain: 'solana:mainnet' })
            .catch((e) => e)

        expect(err).toBeInstanceOf(Error)
        expect(err.message).toBe('Transaction must be a Uint8Array.')
        expect(win.gonderilen.length).toBe(oncekiSayi)
    })

    // PIN -- sifir-girdi davranisi DEGISMEZ: bu ucu de degisken argumanli
    // metotlar, bos cagriyi "toplu islemin sifir elemani" sayar ve istek hic
    // ACMAZ (signTransaction'daki tek FIRLATAN dal HARIC -- K2'nin
    // `inputs.length === 0` erken kapisi).
    it('PIN -- signAndSendTransaction() BOS DIZI doner, istek gitmez', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))
        const oncekiSayi = win.gonderilen.length

        await expect(cuzdan.features['solana:signAndSendTransaction'].signAndSendTransaction())
            .resolves.toEqual([])
        expect(win.gonderilen.length).toBe(oncekiSayi)
    })

    it('PIN -- signMessage() BOS DIZI doner, istek gitmez', async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))
        const oncekiSayi = win.gonderilen.length

        await expect(cuzdan.features['solana:signMessage'].signMessage()).resolves.toEqual([])
        expect(win.gonderilen.length).toBe(oncekiSayi)
    })

    it("PIN -- signTransaction() 'No transaction to sign.' ile reddeder, istek gitmez", async () => {
        const win = kurSayfa()
        const cuzdan = cuzdaniAl(solanayiYukle(win))
        const oncekiSayi = win.gonderilen.length

        await expect(cuzdan.features['solana:signTransaction'].signTransaction())
            .rejects.toThrow('No transaction to sign.')
        expect(win.gonderilen.length).toBe(oncekiSayi)
    })
})
