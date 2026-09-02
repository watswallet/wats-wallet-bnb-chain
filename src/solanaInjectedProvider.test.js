// solanaInjected.js bir modul degil, dogrudan bir <script>: hicbir sey disari
// vermiyor, yalnizca `window`a dokunuyor. Bu yuzden kaynak SAHTE bir `window`
// (gercek bir EventTarget) ile `new Function` icinde CALISTIRILIR --
// injectedProvider.test.js'teki desenin aynisi.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

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

    // Legacy `window.solana` yuzeyi M5'in isidir. M1b onu KURMAZ, yalnizca
    // yuvanin bos olup olmadigini KAYDEDER.
    //
    // M5 UYARISI (Gorev 42): o gorev solanaInjected.js'e installLegacySolana()
    // ekleyip BOS yuvayi DOLDURUYOR, yani asagidaki `expect(win.solana)
    // .toBeUndefined()` iddiasini BILEREK tersine ceviriyor. Gorev 42 kendi
    // suitini eklerken bu IKI SATIRLIK bakimi da yapmalidir: iddiayi SILMEK ve
    // testi 'legacySlotFree yuvanin M1 anindaki durumunu kaydeder' olarak
    // yeniden adlandirmak. `legacySlotFree` iddiasi YERINDE KALIR -- M1 onu
    // kaydi kurarken, M5'in blogu calismadan ONCE hesaplar, yani hala true'dur.
    // Silinmezse Gorev 42'nin 4. adimi (`npx vitest run
    // src/solanaInjectedProvider.test.js` PASS beklentisi) bu dosyada KIRMIZI
    // doner ve suclu M5'te degil burada aranir.
    it('legacy window.solana yuvasi DOLDURULMAZ, yalnizca durumu kaydedilir', () => {
        const win = kurSayfa()
        solanayiYukle(win)

        expect(win.solana).toBeUndefined()
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
