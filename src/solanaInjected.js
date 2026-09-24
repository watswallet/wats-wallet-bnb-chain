// Solana sayfa betigi -- HICBIR SEY IMPORT ETMEZ (bkz. tasarim belgesi 4.1).
// Asagidaki blok CODEGEN ile yazilir: scripts/gen-wallet-standard-metadata.mjs

// GENERATED — do not edit
// Kaynak: src/utils/solana/walletStandardFeatures.js
// Yeniden uretmek icin: cd client && npm run gen:wallet-standard
const WALLET_STANDARD_METADATA = {
    "version": "1.0.0",
    "name": "WATS Wallet",
    "icon": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0OCA0OCI+PHJlY3Qgd2lkdGg9IjQ4IiBoZWlnaHQ9IjQ4IiByeD0iMTIiIGZpbGw9IiMwQjBCMEYiLz48cGF0aCBkPSJNOSAxNWw2IDE4IDktMjAgOSAyMCA2LTE4IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmYiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+PC9zdmc+",
    "chains": [
        "solana:mainnet"
    ],
    "features": {
        "standard:connect": {
            "version": "1.0.0"
        },
        "standard:disconnect": {
            "version": "1.0.0"
        },
        "standard:events": {
            "version": "1.0.0"
        },
        "solana:signTransaction": {
            "version": "1.0.0",
            "supportedTransactionVersions": [
                "legacy",
                0
            ]
        },
        "solana:signAndSendTransaction": {
            "version": "1.0.0",
            "supportedTransactionVersions": [
                "legacy",
                0
            ]
        },
        "solana:signMessage": {
            "version": "1.0.0"
        },
        "solana:signIn": {
            "version": "1.0.0"
        }
    }
}
// GENERATED — do not edit

// Solana Wallet Standard sayfa koprusu -- SAYFA dunyasinda (world: MAIN) calisir.
//
// BU DOSYA HICBIR SEY IMPORT ETMEZ. @crxjs/vite-plugin v2, import tasiyan bir
// MAIN-world betigi `await import(...)` yapan ASENKRON bir yukleyiciye sariyor
// (dist/manifest.json'da tonInjected.js boyle cikiyor: tonInjected.js-loader-*.js).
// Sarilmis betikte cuzdan document_start'ta SENKRON var olmaz ve senkron yoklayan
// dapp kuyrugu cuzdani hic goremez. Bu kusur vitest'te GORUNMEZ, yalnizca gercek
// tarayicida cikar -- bu yuzden base64/base58/PublicKey yardimcilari paylasimli
// modulden alinmaz, BURAYA gomuludur.
//
// KOPRU GOVDESI TEK BIR try/catch icindedir: ziyaret edilen sayfaya hicbir hata
// sizmaz. Yukaridaki uretilen literal try'IN DISINDADIR ve orada KALMALIDIR: duz
// bir nesne literali FIRLATAMAZ, ama iceri alinsaydi dort bosluk girintilenir ve
// codegen'in bayt-birebir karsilastirdigi blok tutmazdi -- applyBlock isaretcileri
// bulamayinca SOLANA_INJECTED_MARKERS_MISSING firlatir, yani prebuild, yani
// `npm run build` coker.
try {
    const generateId = () => Math.random().toString(36).substring(2, 15)
    const callbacks = new Map()
    const changeListeners = new Set()

    /**
     * btoa(String.fromCharCode(...bytes)) yayilimi buyuk girdide RangeError atar:
     * cagri yigini bagimsiz deger sayisini asar. 8KB'lik parcalar guvenli araliktir
     * ve 1 MB'lik bir yuk bile tek bir dizgede toplanabilir.
     */
    function bytesToBase64(bytes) {
        const girdi = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
        const PARCA = 8192
        let ikili = ''
        for (let i = 0; i < girdi.length; i += PARCA) {
            ikili += String.fromCharCode.apply(null, girdi.subarray(i, i + PARCA))
        }
        return btoa(ikili)
    }

    function base64ToBytes(base64) {
        const ikili = atob(base64)
        const out = new Uint8Array(ikili.length)
        for (let i = 0; i < ikili.length; i += 1) out[i] = ikili.charCodeAt(i)
        return out
    }

    /**
     * base58 (Bitcoin alfabesi) -- utils/solana/base58.js'in GOMULU ikizi. Import
     * yasagi yuzunden kopyalanmak ZORUNDA; degeri her iki tarafta da bas sifirlari
     * '1' olarak geri koyar, aksi halde iki FARKLI bayt dizisi AYNI dizgeye kodlanir.
     */
    function base58EncodeInline(bytes) {
        const ALFABE = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
        const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
        if (input.length === 0) return ''

        let zeros = 0
        while (zeros < input.length && input[zeros] === 0) zeros += 1

        const size = Math.floor(((input.length - zeros) * 138) / 100) + 1
        const digits = new Uint8Array(size)

        let length = 0
        for (let i = zeros; i < input.length; i += 1) {
            let carry = input[i]
            let j = 0
            for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k -= 1, j += 1) {
                carry += 256 * digits[k]
                digits[k] = carry % 58
                carry = Math.floor(carry / 58)
            }
            length = j
        }

        let it = size - length
        while (it < size && digits[it] === 0) it += 1

        let out = '1'.repeat(zeros)
        for (; it < size; it += 1) out += ALFABE[digits[it]]
        return out
    }

    /**
     * Import'suz sayfa betigi yeni bir `PublicKey` KURAMAZ. Cozum: 32 ham baytlik
     * GERCEK bir Uint8Array uzerine kendi ozellikleri eklenir -- dapp'in
     * `new PublicKey(provider.publicKey)` cagrisi ancak boyle calisir, ve nesne
     * Wallet Standard sinirindaki `publicKey: Uint8Array(32)` sozlesmesini de bozmaz.
     */
    // Task 43: `toJSON` ve toBase58-once `equals` burada eklendi (Wallet Standard
    // VE legacy `connect` TEK sarmalayiciyi paylassin diye) -- ikinci bir
    // PublicKey-benzeri kurucu ACILMADI, bu fonksiyon GENISLETILDI.
    function makePublicKeyLike(bytes32) {
        const anahtar = bytes32 instanceof Uint8Array ? bytes32 : new Uint8Array(bytes32)
        const base58 = base58EncodeInline(anahtar)
        anahtar.toBase58 = () => base58
        anahtar.toString = () => base58
        anahtar.toJSON = () => base58
        anahtar.toBytes = () => Uint8Array.from(anahtar)
        anahtar.toBuffer = () => Uint8Array.from(anahtar)
        anahtar.equals = (digeri) => {
            if (!digeri) return false
            // ONCE toBase58 denenir: yalnizca toBase58 tasiyan bir nesne (duz bir
            // sarmalayici, ya da baska bir cuzdanin PublicKey-benzeri) bayt
            // karsilastirmasina hic girmeden esitlenir. web3.js'in gercek
            // PublicKey'i de toBase58 tasidigindan asagidaki bayt yolu hala
            // KULLANILIR (ozellikle toBase58'i olmayan ham Uint8Array girdisinde).
            if (typeof digeri.toBase58 === 'function') return digeri.toBase58() === base58
            const bayt = typeof digeri.toBytes === 'function' ? digeri.toBytes() : digeri
            if (!bayt || bayt.length !== anahtar.length) return false
            for (let i = 0; i < anahtar.length; i += 1) if (anahtar[i] !== bayt[i]) return false
            return true
        }
        return anahtar
    }

    // Wallet Standard'in kendi kod tablosu YOKTUR: hata Error olarak FIRLATILIR ve
    // dapp'in promise'i reject olur. Kod ve data KORUNUR -- legacy serit (M5) ayni
    // govdeden -32601/-32002'yi uretecek, dusurulen bir kod geri gelmez.
    const STANDART_MESAJ = {
        4001: 'User rejected the request.',
        4100: 'Unauthorized.',
        4200: 'Method not supported.',
        4900: 'Wallet is locked.',
    }

    function hataYap(error) {
        const kod = error && error.code
        const err = new Error(STANDART_MESAJ[kod] || (error && error.message) || 'Unknown error')
        if (error && typeof error === 'object') {
            if (error.code !== undefined) err.code = error.code
            if (error.data !== undefined) err.data = error.data
        }
        // Gorev 45b: STANDART_MESAJ .message'i EZER (yukarida, bilerek -- WS yuzeyi
        // normalize mesaj gorur, :259/:734 bunu pinler). Ama legacy serit (SS3.6)
        // 4001'in ALT ANLAMINI ayirt etmek zorunda: "kullanici reddetti" ile "istek
        // mesgul/degistirildi" farkli kodlardir (-32002). Ham metin dapp'e sizmadan
        // yalnizca sayfa-ici okunabilsin diye NON-ENUMERABLE saklanir.
        Object.defineProperty(err, 'hamMesaj', {
            value: (error && typeof error.message === 'string') ? error.message : undefined,
            enumerable: false, writable: false, configurable: false,
        })
        return err
    }

    /**
     * K5: bu alan SAYFANIN IDDIASIDIR, tamamen saldirgan kontrolundedir ve onay
     * ekraninda yalnizca "site sunu iddia ediyor" rozetinde gosterilir. Uzunluk
     * burada da kirpilir: sinirsiz metnin boruya HIC girmemesi icin.
     */
    function sayfaBilgisi() {
        try {
            const ikon = document.querySelector('link[rel~="icon"]')
            return {
                name: String(document.title || '').slice(0, 96),
                icon: String((ikon && ikon.href) || '').slice(0, 512),
            }
        } catch (e) {
            return { name: '', icon: '' }
        }
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.target !== 'wats_solana_inpage') return

        // Cuzdanin KENDI baslattigi itme olayi -- bir istegin yaniti degil, id TASIMAZ.
        if (event.data.event) {
            const olay = event.data.event
            if (olay.event !== 'change') return
            const yuk = olay.payload || {}
            // K10: oturum baglandigi hesaba SABITLENIR. Arka plan hesap degisince
            // {accounts: []} yollar; oturum askiya alinir, dapp yeniden baglanmalidir.
            if (Array.isArray(yuk.accounts) && yuk.accounts.length === 0) {
                hesap = null
                // Gorev 44 (SS7.3, obligation 2): TEK bu itmeden hem WS `change`
                // (asagidaki degisimYayinla) hem legacy `accountChanged`/`disconnect`
                // beslenir -- AYRI bir `wats_solana_inpage` dinleyicisi ACILMAZ,
                // ikinci bir dinleyici iki serit arasindaki sirayi tanimsiz birakirdi.
                legacySenkronla()
                legacyEmit('accountChanged', null)
                legacyEmit('disconnect')
            }
            degisimYayinla({ accounts: cuzdan.accounts })
            return
        }

        const { id, result, error } = event.data
        if (!id || !callbacks.has(id)) return
        const { resolve, reject } = callbacks.get(id)
        callbacks.delete(id)
        if (error) {
            reject(hataYap(error))
            return
        }
        resolve(result)
    })

    function callBackground(method, params) {
        return new Promise((resolve, reject) => {
            const id = generateId()
            // Nihai inceleme C4.1: `callbacks.set` postMessage'DAN SONRA cagrilir.
            // Klonlanamayan (structured-clone edilemez) bir dapp nesnesi -- bir
            // fonksiyon, bir Symbol -- postMessage'i SENKRON firlatir
            // (DataCloneError). Kayit ONCE yapilsaydi callback Map'te SONSUZA
            // dek kalirdi (asla gelmeyecek bir yanit bekleyerek) ve dapp ham
            // DOMException'i (code 25) gorurdu, sayfa-ici -32602 govdesini
            // DEGIL. Teslimat ASENKRON oldugu icin basarili bir post'tan SONRA
            // kaydetmek guvenlidir: mesaj olayi bu satirdan once ASLA gelmez.
            try {
                window.postMessage({ target: 'wats_content_script', id, payload: { method, params } }, '*')
            } catch (e) {
                const err = new Error('Invalid request parameters.')
                err.code = -32602
                reject(err)
                return
            }
            callbacks.set(id, { resolve, reject })
        })
    }

    function degisimYayinla(degisim) {
        for (const fn of changeListeners) {
            try { fn(degisim) } catch (e) { /* bir dinleyicinin hatasi digerlerini kesmemeli */ }
        }
    }

    /**
     * Nihai inceleme C4.5: legacy serit yanit sekli/uzunlugunu dogrular
     * (asagida :legacySerialize civarindaki K2 aynasi ve legacySignMessage'in
     * 64-bayt kontrolu), ama WS seridi `base64ToBytes`i KAPISIZ cagiriyordu --
     * eksik bir alan `atob(undefined)`e duser (ham InvalidCharacterError
     * DOMException dapp'e sizar) ve yanlis uzunluklu bir imza SESSIZCE gecerdi.
     * Tek noktadan WS seridinin butun cozme noktalarinda kullanilir.
     */
    function sonucBaytlari(b64, uzunluk) {
        if (typeof b64 !== 'string' || !b64) throw new Error('Wallet returned an unexpected response.')
        let out
        try {
            out = base64ToBytes(b64)
        } catch (e) {
            throw new Error('Wallet returned an unexpected response.')
        }
        if (uzunluk !== undefined && out.length !== uzunluk) throw new Error('Wallet returned an unexpected response.')
        return out
    }

    let hesap = null

    // Tasimadan gelen base64 publicKey sinira konmadan ONCE 32 baytlik Uint8Array'e
    // cevrilir. `accountKey` sinira ASLA cikmaz: o dahili bir oturum kimligidir.
    function hesapYap(yanit) {
        return Object.freeze({
            address: yanit.address,
            publicKey: makePublicKeyLike(sonucBaytlari(yanit.publicKey, 32)),
            chains: WALLET_STANDARD_METADATA.chains.slice(),
            // `features` bir string DIZISIDIR, nesne degil. Kaynagi kurulu metot
            // tablosudur: sonraki milestone'lar `metotlar`a ekledikce burasi
            // kendiliginden buyur, ikinci bir liste ACILMAZ.
            features: Object.keys(cuzdan.features).filter((k) => k.indexOf('solana:') === 0),
        })
    }

    async function connect(input) {
        const yanit = await callBackground('solana_connect', [{
            silent: !!(input && input.silent),
            appMeta: sayfaBilgisi(),
        }])
        const onceki = hesap
        hesap = hesapYap(yanit)
        // Gorev 44 obligation 1 (yon 1): legacyProvider.publicKey/isConnected
        // AYNI cagridan senkron kalir -- aksi halde bir adaptorle baglanan
        // hibrit bir dapp `window.solana.isConnected`i hala false okur
        // (Gorev 43 incelemesi).
        legacySenkronla()
        // Nihai inceleme C4.2: hesap DEGISTIYSE `standard:events` change
        // yayilir -- legacy connect (:833), WS signIn (:373) ve disconnect'lerin
        // HEPSI paylasimli hesap degisince yayinlar; WS connect bir istisnaydi.
        // AYNI adresle yeniden baglanmak (orn. onlyIfTrusted yoklamasi) YAYMAZ:
        // dapp'in gordugu hesap zaten degismedi. Ruling: legacy 'connect'
        // olayi burada YAYILMAZ -- o yalnizca legacy seridin KENDI eyleminde
        // anlamlidir (window.solana.connect() hic cagirilmamis bir dapp'e
        // uydurma bir olay gonderilmez, bkz. legacySenkronla yorumu).
        if (!onceki || onceki.address !== hesap.address) degisimYayinla({ accounts: cuzdan.accounts })
        // Tek nesne DEGIL, {accounts} dondurulur; adaptorlerin `const [a] = accounts`
        // kalibi tek nesnede undefined verir.
        return { accounts: cuzdan.accounts }
    }

    async function disconnect() {
        try {
            await callBackground('solana_disconnect', [{}])
        } finally {
            // Nihai inceleme C4.3: arka plan REDDETSE bile (oturum zaten
            // revoke edilmis, MV3 portu kapanmis, DataCloneError) yerel durum
            // TEMIZLENIR -- legacy `disconnect()`in ayni fail-safe'i (:844-852).
            // `try/finally` olmadan bir red burada ERKEN CIKARDI: `hesap` set
            // kalirdi (`wallet.accounts` bos degil), `window.solana.isConnected`
            // hala true okunurdu ve hicbir `change`/`disconnect` olayi
            // yayilmazdi -- dapp "hala bagli" sanip sonraki imzalarda sessizce
            // 4100 alirdi. Hata `finally`den SONRA yine FIRLATILMAYA devam eder.
            hesap = null
            // Gorev 44 obligation 1 (yon 2) -- SIRALAMA KURALI: legacyProvider
            // alanlari `degisimYayinla`den ONCE senkronlanir. Bir WS `change`
            // dinleyicisi bu cagridan SENKRON tetiklenir; senkron sonra gelseydi
            // dinleyici, calistigi anda hala eski `isConnected`i (true) okurdu
            // (Gorev 44 fix turu, "yon 2 siralama" testi).
            legacySenkronla()
            // Dapp'in kendi baslattigi kesmede de `change` yayinlanir: adaptorler
            // durumlarini bu olayla temizler, yalnizca promise'in cozulmesiyle degil.
            degisimYayinla({ accounts: [] })
            // Minor 2 (Gorev 44 fix turu): legacy dinleyiciler de ayni bilgiyi
            // ("artik imzalayamazsin") gorur. Connect yonundeki sessizlik BURAYA
            // TASINMAZ: orada susmak fail-safe'ti (hic girmedigi bir akisin
            // olayini uydurmamak), burada susmak GUVENSIZ olurdu -- bir legacy
            // dinleyici disconnect'i hic gormeyip bayat "bagli" arayuzu gosterirdi.
            // `legacyEmit` bos kumede no-op'tur ve dinleyici hatasindan izoledir;
            // burasi `legacyOturumuKapat`a YONLENMEZ, o yuzden `hesap`/alanlar
            // ikinci kez sifirlanmaz.
            legacyEmit('disconnect')
        }
        return undefined
    }

    function on(olay, dinleyici) {
        // Tanimadigimiz bir olay icin FIRLATMAK yerine no-op iptal doneriz:
        // sayfaya hata sizmaz ve adaptorun cleanup'i yine de calisir.
        if (olay !== 'change' || typeof dinleyici !== 'function') return () => {}
        changeListeners.add(dinleyici)
        return () => { changeListeners.delete(dinleyici) }
    }

    // §3.4: sinirda her yuk BAYTTIR ve her `solana:*` metodu DIZI dondurur.
    // DEGISKEN ARGUMANLI (K2): `solana:signAllTransactions` diye bir ozellik
    // olmadigi gibi, `signAllMessages` de yoktur -- toplu is, ayni metodun cok
    // argumanla cagrilmasidir.
    async function signMessage(...inputs) {
        const outputs = []
        for (const input of inputs) {
            // Nihai inceleme C4.6: `:406`teki signTransaction girdi-tipi
            // deseninin aynasi. Bir dizge/undefined/nesne `new
            // Uint8Array(...)`e dustugunde SESSIZCE BOS bir payload uretir
            // (orn. `new Uint8Array('abc').length === 0`); istek yine de arka
            // plana gider ve orada TX_DESERIALIZE_FAILED (-32603) ile
            // reddedilir -- ayni hata PENCERE ACILMADAN, acik bir kodla burada
            // yakalanir.
            if (!(input?.message instanceof Uint8Array)) throw new Error('Message must be a Uint8Array.')
            // Tasimada her yuk base64: chrome.runtime.sendMessage JSON serilestirir
            // ve bir Uint8Array'i {"0":1,"1":2,...} nesnesine cevirir.
            const res = await callBackground('solana_signMessage', [{
                message: bytesToBase64(input.message),
                account: input.account && input.account.address,
                display: input.display,
            }])
            outputs.push({
                signedMessage: sonucBaytlari(res.signedMessage),
                signature: sonucBaytlari(res.signature, 64),
                // Tasima bunu TASIMAZ, sayfa ekler (§3.3).
                signatureType: 'ed25519',
            })
        }
        return outputs
    }

    async function signIn(...inputs) {
        // Argumansiz `signIn()` mesrudur: SolanaSignInInput'un TUM alanlari
        // opsiyoneldir ve `domain` zaten gercek origin'den doldurulur. Bos dizi
        // donmek, bu cagriyi yapan dapp'i sessizce cevapsiz birakirdi.
        const girdiler = inputs.length ? inputs : [{}]
        const outputs = []
        for (const input of girdiler) {
            const res = await callBackground('solana_signIn', [{ input }])

            // Hesap ELLE KURULMAZ: M1'in `hesapYap` kurucusu YENIDEN KULLANILIR.
            // Elle kurulan bir nesne `standard:connect`/`standard:disconnect`/
            // `standard:events` anahtarlarini da features dizisine koyar ve
            // publicKey'i makePublicKeyLike ile sarmaz -- signIn hesabini connect
            // hesabiyla karsilastiran bir dapp (yaygin yeniden-baglanma kontrolu)
            // iki FARKLI nesne gorurdu.
            const account = hesapYap(res)

            // "signIn OTURUM DA KURAR": modul duzeyindeki `hesap` atanmazsa
            // `cuzdan.accounts` BOS kalir ve hicbir `change` yayinlanmaz. Arka plan
            // solana_dapps[origin] kaydini yazmis olsa bile HER Wallet Standard
            // adaptoru cuzdani hala BAGLI DEGIL sayar ve kullaniciyi tekrar
            // connect'e gonderir -- SIWS'in tum amaci (connect + signMessage TEK
            // adimda) tam burada kaybolurdu.
            hesap = account
            // Gorev 44 obligation 1 (yon 1) -- SIRALAMA KURALI (Minor 3/4, Gorev
            // 44 fix turu): legacyProvider alanlari `degisimYayinla`den ONCE
            // senkronlanir, WS `disconnect()` fonksiyonundaki AYNI kural. Senkron
            // sonra gelseydi, bu cagridan SENKRON tetiklenen bir WS `change`
            // dinleyicisi calistigi anda hala `publicKey === null` okurdu.
            legacySenkronla()
            degisimYayinla({ accounts: cuzdan.accounts })

            outputs.push({
                // §3.4: cikti `account`i connect'in donduru WalletAccount'un
                // AYNISIDIR. publicKey base64'ten cozulur -- sayfa betiginde base58
                // COZUCU yoktur ve acilmaz (§3.3'un bilincli borcu).
                // features NESNE DEGIL string DIZISIDIR, ve `standard:*` anahtarlari
                // ICERMEZ: hesapYap onlari eler, publicKey'i de makePublicKeyLike ile
                // sarar.
                account,
                signedMessage: sonucBaytlari(res.signedMessage),
                signature: sonucBaytlari(res.signature, 64),
                signatureType: 'ed25519',
            })
        }
        return outputs
    }

    /**
     * `solana:signTransaction` -- DEGISKEN ARGUMANLI (K2).
     *
     * `solana:signAllTransactions` diye bir ozellik YOKTUR: resmi
     * StandardWalletAdapter'in signAllTransactions'i tam olarak bu metodu cok
     * girdiyle cagirir. DIZI donmek ZORUNLU: adaptorlerin yaygin
     * `const [output] = await ...` kalibinda tek nesne `undefined` verir.
     */
    async function signTransaction(...inputs) {
        if (inputs.length === 0) throw new Error('No transaction to sign.')

        const transactions = inputs.map((input) => {
            // Sinirda her yuk BAYTTIR; tasimaya base64 olarak gecer (§3.3):
            // chrome.runtime.sendMessage JSON serilestirir ve bir Uint8Array'i
            // {"0":1,"1":2,...} nesnesine cevirir.
            if (!(input?.transaction instanceof Uint8Array)) throw new Error('Transaction must be a Uint8Array.')
            return bytesToBase64(input.transaction)
        })

        // `chain` adaptorde ZORUNLU alandir ve her zaman gonderilir; gelmezse
        // mainnet varsayilir. Bu alan olmadan arka plandaki cluster kapisi HIC
        // tetiklenemez ve devnet isteyen bir dapp sessizce mainnet'te imzalanir.
        const chain = inputs[0].chain || WALLET_STANDARD_METADATA.chains[0]

        const result = await callBackground('solana_signTransaction', [{
            transactions,
            chain,
            account: inputs[0].account?.address,
        }])

        const signed = result?.signedTransactions
        // SESSIZCE KIRPILMAZ: eksik bir dizi, dapp'in imzasiz bir islemi
        // imzalanmis sanip yayinlamasina yol acardi.
        if (!Array.isArray(signed) || signed.length !== transactions.length) {
            throw new Error('Wallet returned an unexpected response.')
        }
        return signed.map((base64) => ({ signedTransaction: sonucBaytlari(base64) }))
    }

    /**
     * `solana:signAndSendTransaction` -- DEGISKEN ARGUMANLI (K2), signMessage/
     * signIn/signTransaction ile AYNI kalip. "solana:signAndSendAllTransactions"
     * diye bir Wallet Standard ozelligi YOKTUR: toplu yayin, bu metodun SIRALI
     * cok girdiyle cagrilmasidir.
     *
     * Sirali `await` ZORUNLUDUR, `Promise.all` DEGIL: Task 38'in kapisi TEK
     * islem alir (params[0] bir dizi degil tek nesne), yani her girdi KENDI
     * istegini acar; ayrica openApprovalWindow TEK UCUSLUK bir kilit tutar,
     * once acilan pencere kapanmadan digeri acilamaz -- Promise.all yazsaydik
     * ilk girdiden SONRAKI HER girdi 4001 ile reddedilirdi (Task 24/33).
     *
     * Wallet Standard sinirinda her yuk BAYTTIR ve donus DIZIDIR (§3.4). Tek
     * nesne donmek, adaptorlerin `const [output] = await ...` kalibinda
     * undefined verir -- dapp'te bagla dugmesinden sonraki ilk islemde coker.
     */
    async function signAndSendTransaction(...inputs) {
        const outputs = []
        for (const input of inputs) {
            // Nihai inceleme C4.6: `:406`daki (WS signTransaction) girdi-tipi
            // deseninin aynasi -- girdi tipi burada da SESSIZCE bos bir
            // payload'a dusup TX_DESERIALIZE_FAILED (-32603) ile arka planda
            // reddedilmeden ONCE, acik bir kodla PENCERE ACILMADAN yakalanir.
            if (!(input?.transaction instanceof Uint8Array)) throw new Error('Transaction must be a Uint8Array.')
            const yanit = await callBackground('solana_signAndSendTransaction', [{
                transaction: bytesToBase64(input.transaction),
                // `chain` ZORUNLUDUR ve adaptor onu HER ZAMAN gonderir. Dusurulurse
                // arka plandaki cluster kapisi HIC tetiklenemez.
                chain: input.chain,
                account: input.account && input.account.address,
                options: input.options,
            }])

            // Imza `signatureBytes`ten (base64) uretilir, `signature` (base58)
            // dizgesinden DEGIL: import'suz sayfa betigine bir base58 COZUCU
            // borcu binmesin diye tasima ikisini birden tasiyor (§3.3). base58
            // dizge yalnizca legacy seridin isine yarar.
            outputs.push({ signature: sonucBaytlari(yanit.signatureBytes, 64) })
        }
        return outputs
    }

    // Metot tablosu TEK seamdir: M1b uc standart ozelligi kurar, sonraki
    // milestone'lar AYNI tabloya ekler. Ozelligin degeri surum isareti degil
    // metodu TASIYAN nesnedir -- yalnizca {version} bildirmek cuzdani
    // kesfedilebilir yapar, sonra adaptor `connect is not a function` ile coker.
    const metotlar = {
        'standard:connect': { connect },
        'standard:disconnect': { disconnect },
        'standard:events': { on },
        'solana:signTransaction': { signTransaction },
        'solana:signMessage': { signMessage },
        'solana:signIn': { signIn },
        // YALNIZCA METOT yazilir. `supportedTransactionVersions` (ve icindeki
        // SAYI 0) WALLET_STANDARD_METADATA.features'tan gelir ve
        // `ozellikleriBirlestir()` onu burayla birlestirir; metadata'yi elle
        // yaymak ayni degeri iki kaynakta tutup birinin bayatlamasi olurdu.
        'solana:signAndSendTransaction': { signAndSendTransaction },
    }

    function ozellikleriBirlestir() {
        const out = {}
        for (const anahtar of Object.keys(metotlar)) {
            out[anahtar] = { ...WALLET_STANDARD_METADATA.features[anahtar], ...metotlar[anahtar] }
        }
        return out
    }

    // `accounts` bir GETTER'dir: nesnenin donmasi `change` olayiyla celismesin diye.
    const cuzdan = Object.freeze({
        version: WALLET_STANDARD_METADATA.version,
        name: WALLET_STANDARD_METADATA.name,
        icon: WALLET_STANDARD_METADATA.icon,
        chains: WALLET_STANDARD_METADATA.chains,
        get accounts() { return hesap ? [hesap] : [] },
        features: ozellikleriBirlestir(),
    })

    // Referans uygulamanin (@wallet-standard/wallet register.js) yaptigi BIREBIR
    // budur ve olay `detail`i CUZDAN NESNESI DEGIL, BIR FONKSIYONDUR. Uygulama
    // tarafi detail'i yalnizca CAGIRIR; nesne koyulursa hicbir adaptor cuzdani
    // gormez ve hata da olusmaz -- cuzdan sadece listede hic cikmaz.
    const kayitGeriCagrimi = ({ register }) => register(cuzdan)

    // app-ready GEC gelebilir (adaptor betigi bizden sonra yuklenirse). O dalda
    // register-wallet'i yeniden YAYINLAMAK ise yaramaz: api.register cagrilmalidir.
    // Kendi try/catch'i icindedir -- bir adaptorun kayit hatasi sayfaya sizmamali.
    window.addEventListener('wallet-standard:app-ready', (event) => {
        try { kayitGeriCagrimi(event.detail) } catch (e) { /* adaptorun sorunu bizim degil */ }
    })

    window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', {
        detail: kayitGeriCagrimi, bubbles: false, cancelable: false, composed: false,
    }))

    // SAVUNMACI YAZIM: `window.wats` UC yazicili bir nesnedir (injected.js,
    // tonInjected.js, bu dosya) ve yuklenme sirasina GUVENILMEZ. Duz atama EVM ya
    // da TON koprusunu SESSIZCE silerdi -- bu yuzden ASLA yeniden atanmaz.
    if (!window.wats) window.wats = {}
    window.wats.solana = {
        walletStandard: true,
        wallet: cuzdan,
        // Legacy `window.solana` yuzeyi M5'in isidir; M1b yuvayi DOLDURMAZ.
        // Yuvanin bizde mi kaldigi yoksa baska bir cuzdana mi devredildigi
        // GARANTILI seritte, yani burada kaydedilir.
        legacySlotFree: !window.solana,
        // M5 DOLDURUR, M1 yalnizca yuvayi acar. Alanlar bastan var ki
        // `window.wats.solana` SEKLI milestone'lar arasinda DEGISMESIN:
        // M4'un testi `.wallet.features`i, M5'inki `.legacy`yi okur.
        legacy: null,
        legacySlot: null,
    }

    // ===================== LEGACY window.solana (SS3.5) =====================
    // K1'in ikinci yarisi. Modern adaptorler Wallet Standard ile kesfeder, ama
    // bir dapp kuyrugu hala `window.solana`yi SENKRON yokluyor -- bu blok o
    // yuzeyi kurar. `isPhantom` ASLA yazilmaz: kimlik taklidi olurdu.

    const legacyListeners = new Map()

    function legacyEmit(event, payload) {
        const set = legacyListeners.get(event)
        if (!set) return
        // Kopya uzerinde gezilir: bir dinleyici kendini off() ile sokebilir.
        // Bir dinleyicinin hatasi digerlerini KESMEMELI (tonInjected.js emsali).
        for (const fn of Array.from(set)) {
            try { fn(payload) } catch (e) { /* dapp'in dinleyicisi bizi ilgilendirmez */ }
        }
    }

    // SS3.6 -- LEGACY serit. Wallet Standard seridi ayni arizayi duz bir
    // `Error` metniyle firlatir; burada SAYISAL kod sarttir: legacy dapp'ler
    // `err.code`a bakar ve tanimadiklari bir kodda hatayi "beklenmedik cuzdan
    // arizasi" diye gosterirler. `hataYap` yukarida `.code`/`.data`yi KORUYARAK
    // bir Error uretti; `.message` STANDART_MESAJ tablosuyla normalize edilir,
    // ham metin `hataYap`'in `hamMesaj` alaninda sayfa-ici saklanir (Gorev 45b)
    // -- MESGUL_4001 asagida onu okuyup 4001'in "mesgul" alt-anlamini ayirt
    // eder. `.data` AYNEN tasinir; `.code` Phantom'un tablosuna gore yeniden
    // yazilir.

    // dappFunctions.js'in "mesgul" anlamli iki 4001 metni: closeExistingWindow
    // (onceki istegi tahliye) ve openApprovalWindow'un isOpeningWindow mutex'i.
    // "User closed the window." (chrome.windows.onRemoved dinleyicisi) ve
    // resolvePendingRequest'in varsayilan 'Request rejected by user' metni
    // 4001 KALIR.
    const MESGUL_4001 = new Set(['Request replaced by a new one.', 'Another request is being processed.'])

    function legacyError(e) {
        const kod = e && e.code
        const mesaj = (e && e.message) || 'Solana request failed.'
        const err = new Error(mesaj)
        if (e && e.data !== undefined) err.data = e.data
        // hataYap'in sakladigi ham metin (e.hamMesaj) burada TASINMAZSA kaybolur --
        // `err` legacyError'un kurdugu YENI bir Error, `e`nin hamMesaj'ini
        // miras ALMAZ. Ayni non-enumerable sekilde tasinir: sayfa-ici
        // okunabilir kalir, dapp'e (JSON/spread/Object.keys) yine sizmaz.
        if (e && e.hamMesaj !== undefined) {
            Object.defineProperty(err, 'hamMesaj', {
                value: e.hamMesaj, enumerable: false, writable: false, configurable: false,
            })
        }

        if (kod === 4200) {
            // JSON-RPC "Method Not Found". Phantom'un dondurdugu kod budur.
            err.code = -32601
        } else if (kod === 4001 && MESGUL_4001.has(e && e.hamMesaj)) {
            // Onay penceresi ZATEN acikken gelen ikinci istek ya da mutex
            // (dappFunctions.js -- closeExistingWindow / openApprovalWindow'un
            // isOpeningWindow'u). 4001 dondurmek, kullanicinin HIC GORMEDIGI bir
            // istek icin dapp'e "reddettiniz" dedirtirdi. Ayrim hataYap'in
            // sakladigi ham metinle (e.hamMesaj) yapilir -- `mesaj` (yukarida)
            // STANDART_MESAJ ile normalize oldugu icin burada ayirt edici
            // DEGILDIR.
            err.code = -32002
        } else if (kod === 4900) {
            // Kilit. Phantom'da 4900 "aga baglanamadi" demek, bu yuzden 4100.
            err.code = 4100
        } else if (typeof kod === 'number') {
            err.code = kod
        }
        // Kodsuz govde (content.js'in lastError dali): kod UYDURULMAZ.
        return err
    }

    // Gorev 44 obligation 1: WS ve legacy seritler AYNI paylasimli `hesap`i
    // okur; bu TEK fonksiyon legacyProvider'in gorunen alanlarini o degiskenle
    // hizalar. Cagrildigi noktada `hesap` HER ZAMAN guncel oldugu icin (WS
    // connect/signIn/disconnect'in hesap atamasindan HEMEN sonra cagrilir)
    // burada baska bir parametre almaz. WS tarafindan cagrildiginda legacy
    // olayi (legacyEmit) YAYINLAMAZ -- o olay yalnizca legacy seridin KENDI
    // eylemlerinde (connect/disconnect) ve cuzdan kaynakli itmede anlamlidir;
    // WS connect'in her cagrisinda bir legacy 'connect' olayi yaymak, hicbir
    // zaman window.solana.connect() cagirmamis bir dapp'e uydurma bir olay
    // gonderirdi.
    function legacySenkronla() {
        legacyProvider.publicKey = hesap ? hesap.publicKey : null
        legacyProvider.isConnected = !!hesap
    }

    // Dapp'in KENDI islem nesnesi -- bizim web3.js ornegimiz DEGIL. Ayrim
    // `'version' in tx` ile yapilir, ASLA instanceof ile (SS3.3): dapp'in
    // @solana/web3.js'i ayri bir modul ornegidir ve instanceof HER ZAMAN false doner.
    const legacyV0mu = (tx) => tx != null && typeof tx === 'object' && 'version' in tx

    function legacySerialize(tx) {
        // Nihai inceleme C4.4: null/primitif bir tx (dapp'in kendi hatasi ya
        // da bozuk bir adaptor) asagidaki `tx.feePayer`/`tx.instructions`
        // erisimlerinde HAM bir TypeError firlatirdi -- legacyError'un
        // sarmalamasini ATLAYARAK dapp'e motor hatasi olarak duserdi.
        if (tx == null || typeof tx !== 'object') {
            const err = new Error('Transaction must be an object.')
            err.code = -32602
            throw err
        }

        // v0: ARGUMANSIZ. Opsiyon nesnesi sessizce yok sayilir, yani "ise yariyor
        // gibi" gorunup legacy opsiyonlarini tasidigini sanmak kolaydir.
        if (legacyV0mu(tx)) {
            try {
                return bytesToBase64(tx.serialize())
            } catch (e) {
                // Nihai inceleme C4.4: uyumsuz/bozuk bir dapp nesnesinin ham
                // `serialize()` metni ("Cannot read properties..." vb.) dapp'e
                // SIZMAZ -- ayni "beklenmedik" govdesine dusurulur.
                const err = new Error('Transaction could not be serialized.')
                err.code = -32602
                throw err
            }
        }

        // Nihai inceleme C4.4 (K10 mainstream akisi): bir wallet itmesi
        // (arka plan hesap degistirir) `hesap`i null'lar ve `legacySenkronla`
        // `legacyProvider.publicKey`i de null'lar. Bu noktada feePayer'siz bir
        // tx, asagidaki "gercek anahtardan bul" daline hic GIRMEMELI -- aranacak
        // bir "bizim adresimiz" zaten yok. Acik bir 4100 ile, PENCERE
        // ACILMADAN, arka planin AYNI govdesiyle reddedilir; aksi halde bu tx
        // asagidaki bloklari atlayip `tx.serialize()`e duser ve web3.js'in ham
        // "Transaction fee payer required" hatasi dapp'e SIZAR -- arka planin
        // 4100'u HIC gorulmez.
        if (!tx.feePayer && !legacyProvider.publicKey) {
            const err = new Error('Unauthorized.')
            err.code = 4100
            throw err
        }

        if (!tx.feePayer && legacyProvider.publicKey) {
            // Dapp feePayer koymadiysa ucreti bagli hesap odeyecek demektir.
            // Atamazsak web3.js "Transaction fee payer required" ile patlar ve o
            // ham hata dapp'in promise'ine duser.
            //
            // AMA sarmalayicimiz ATANAMAZ: web3.js'in compileMessage'i
            // `uniqueMetas.findIndex((x) => x.pubkey.equals(feePayer))` cagiriyor ve
            // `PublicKey.equals` `this._bn.eq(other._bn)` yapiyor -- bizim
            // legacyPublicKeyOlustur ciktisinda `_bn` YOKTUR ve BN
            // `Cannot read properties of undefined (reading 'negative')` ile patlar.
            // (tx.addSignature'i cagirmamamizin AYNI sebebi; asagida da tekrarlanmasin.)
            // Cozum: dapp'in KENDI web3.js ornegiyle kurdugu GERCEK PublicKey
            // nesnesini islemin talimat anahtarlari arasindan bul.
            const bizim = legacyProvider.publicKey.toBase58()
            const gercek = (tx.instructions || [])
                .flatMap((ix) => ix.keys || [])
                .map((k) => k.pubkey)
                .find((p) => String(p) === bizim)
            if (!gercek) {
                // Adresimiz hicbir talimatta gecmiyor: uydurma bir feePayer atamak
                // yerine acik bir kodla, PENCERE ACILMADAN reddedilir.
                const err = new Error('Transaction fee payer required.')
                err.code = -32602
                throw err
            }
            tx.feePayer = gercek
        }
        if (!tx.recentBlockhash) {
            // Acik bir kod: aksi halde web3.js'in ham metni dapp'e giderdi.
            // -32602 JSON-RPC "Invalid params" -- istek arka plana HIC gitmedigi
            // icin SS3.6'nin uygulama katmani kodlarindan biri DEGIL.
            const err = new Error('Transaction recentBlockhash required.')
            err.code = -32602
            throw err
        }
        try {
            return bytesToBase64(tx.serialize({ requireAllSignatures: false, verifySignatures: false }))
        } catch (e) {
            // Nihai inceleme C4.4: legacy dalin ikinci serilestirme noktasi --
            // v0 dalindaki (yukarida) AYNI koruma, ham motor metni burada da
            // dapp'e sizmasin diye.
            const err = new Error('Transaction could not be serialized.')
            err.code = -32602
            throw err
        }
    }

    /**
     * R8 (Gorev 49): sayfa yalnizca GIRDI TIPINI kapilar, boyut/icerik kapisi
     * ARKA PLANDADIR (mesajYukKapisi, solanaDappFunctions.js:381-388). Kabul
     * edilen tipler Uint8Array (aynen), ArrayBuffer / ArrayBufferView / duz
     * sayi dizisi (Uint8Array'e cevrilir). Baska her sey -- dizge, null,
     * undefined, sayi, duz nesne -- PENCERE ACILMADAN, istek arka plana HIC
     * gitmeden -32602 ile reddedilir (:406'daki `signTransaction` girdi-tipi
     * deseninin aynasi).
     */
    function legacyMesajBaytlari(message) {
        if (message instanceof Uint8Array) return message
        const tanidikTip = message instanceof ArrayBuffer || ArrayBuffer.isView(message) || Array.isArray(message)
        if (tanidikTip) {
            try {
                if (message instanceof ArrayBuffer) return new Uint8Array(message)
                if (ArrayBuffer.isView(message)) {
                    return new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
                }
                return new Uint8Array(message)
            } catch (e) {
                // AYRIK (detached) bir ArrayBuffer -- ornegin structuredClone'un
                // transfer'i sonrasi -- view'in .buffer/.byteOffset/.byteLength'i
                // TypeError atar. Ham motor hatasi dapp'e SIZMAZ, asagidaki TEK
                // -32602 govdesine dusurulur (fix turu 1, F1c).
            }
        }
        const err = new Error('Message must be a Uint8Array.')
        err.code = -32602
        throw err
    }

    function legacyImzaIndeksi(tx, address) {
        if (legacyV0mu(tx)) {
            const keys = (tx.message && tx.message.staticAccountKeys) || []
            const limit = (tx.message && tx.message.header && tx.message.header.numRequiredSignatures) || 0
            for (let i = 0; i < keys.length && i < limit; i += 1) {
                if (String(keys[i]) === address) return i
            }
            return -1
        }
        // Legacy tx'te `signatures`, serilestirme sirasinda web3.js'in _compile()
        // adimi tarafindan ZORUNLU IMZACILARLA doldurulur -- bu yuzden indeks
        // serilestirmeden SONRA okunur.
        return (tx.signatures || []).findIndex((s) => s && s.publicKey && String(s.publicKey) === address)
    }

    function legacyImzaAl(wire, index) {
        // Tel bicimi: compact-u16 imza SAYISI + N*64 bayt imza. Sayi her zaman
        // 128'in altindadir (bir islemde en fazla ~19 imzaci olabilir), yani
        // shortvec TEK bayttir -- tam bir shortvec cozucusu yazmaya gerek yok.
        if (!wire || wire.length < 1) return null
        const count = wire[0]
        if (index < 0 || index >= count) return null
        const sig = wire.slice(1 + index * 64, 1 + index * 64 + 64)
        // Kirpilmis bir tel (baglanti kesilmesi vb.) 64'ten KISA bir dilim
        // uretebilir; boylesi bir dilim dapp'in nesnesine yazilirsa gercek
        // serilestirme cok daha sonra anlasilmaz bir web3.js assert'iyle
        // patlar (inceleme bulgusu #5, Gorev 46). NULL, legacyImzaYaz'i
        // no-op yapar -- yazilmamis (null) bir imza, BOZUK bir imzadan iyidir.
        return sig.length === 64 ? sig : null
    }

    function legacyImzaYaz(tx, sig, index) {
        if (index < 0 || !sig) return tx
        if (legacyV0mu(tx)) {
            tx.signatures[index] = sig
            return tx
        }
        // `tx.addSignature(...)` CAGRILMAZ: gercek bir PublicKey ornegi ister ve
        // bizim sarmalayicimizda `_bn` yoktur -- orada patlardi (SS3.5).
        if (tx.signatures && tx.signatures[index]) tx.signatures[index].signature = sig
        return tx
    }

    /** signTransaction ve signAllTransactions'in ORTAK govdesi. */
    async function legacyCoklukImzala(txs) {
        const account = legacyProvider.publicKey ? legacyProvider.publicKey.toBase58() : null
        const transactions = txs.map((tx) => legacySerialize(tx))
        const sonuc = await callBackground('solana_signTransaction', [{
            transactions,
            // K4: tek cluster. Sabit metin, uretilen metadata blogundaki
            // chains[0] ile AYNI olmak zorunda.
            chain: 'solana:mainnet',
            account,
        }])
        const imzalilar = (sonuc && sonuc.signedTransactions) || []
        // Inceleme bulgusu #1 (Gorev 46): WS seridi (`:424-426`) AYNI
        // korumayi tasir -- SESSIZCE KIRPILMAZ. Bu kontrol olmadan kisa bir
        // yanit, asagidaki dongude eksik indeksleri sessizce atlar ve
        // `sonuc === tx` (imzasiz) dapp'e "basarili" gibi doner; dapp
        // imzasiz bir islemi yayinlayabilir.
        if (!Array.isArray(imzalilar) || imzalilar.length !== transactions.length) {
            throw new Error('Wallet returned an unexpected response.')
        }
        // Inceleme bulgusu (a) (Gorev 46, tur 2): yukaridaki kontrol yalnizca
        // DIZI UZUNLUGUNU sinar -- tek bir elemanin ICI (kisa bir dilim, bkz.
        // legacyImzaAl bulgu #5; ya da `index < 0`: adresimiz bu YEREL
        // nesnenin imzacilari arasinda YOK) o kontrolden GECER. IKI GECIS
        // ZORUNLU: tek geciste yaz-sonra-firlat, KISMI bir toplu yazmaya yol
        // acardi -- txs[0] yazilir, txs[1] bozuksa ORADA firlanir ve dapp
        // yarim-imzali bir dizi gorur. Once TUM elemanlar (hicbir yazma
        // olmadan) dogrulanir, sonra TUMU yazilir.
        const kayitlar = txs.map((tx, i) => {
            // Indeks serilestirmeden SONRA okunur (bkz. legacyImzaIndeksi).
            const index = legacyImzaIndeksi(tx, account)
            // Fix turu 1, F4: bozuk base64 `atob`'dan ham bir DOMException
            // firlatir -- signMessage'daki AYNI korumanin buradaki karsiligi.
            let wire = null
            if (imzalilar[i]) {
                try {
                    wire = base64ToBytes(imzalilar[i])
                } catch (e) {
                    throw new Error('Wallet returned an unexpected response.')
                }
            }
            const sig = legacyImzaAl(wire, index)
            // `sig` null iki nedenden biriyle gelir: kisa bir dilim ya da
            // `index < 0`. Ikisi de ayni "beklenmedik yanit" sinifidir --
            // sessizce atlanirsa dapp yarim/bozuk bir imza gorur (bulgu
            // #1'in onledigi sinifin bir alt kumesi, tek eleman duzeyinde).
            if (!sig) throw new Error('Wallet returned an unexpected response.')
            return { tx, index, sig }
        })
        kayitlar.forEach(({ tx, index, sig }) => legacyImzaYaz(tx, sig, index))
        // AYNI nesneler doner: dapp `.serialize()`i KENDI nesnesi uzerinde cagirir.
        return txs
    }

    const legacyProvider = {
        isWatsWallet: true,
        publicKey: null,
        isConnected: false,

        // `onlyIfTrusted` legacy adi, tasimada `silent` (SS3.3). Tasima adini
        // Wallet Standard belirliyor (`StandardConnectInput.silent`) ve legacy
        // adi Phantom'dan miras -- ikisini AYNI isimde tutmak istenirdi ama
        // yapilamaz. Pencere acip acmama karari BURADA degil, arka planda
        // verilir (`solana_connect`in `silent` alanina bakarak): sayfa betigi
        // sessizligi kendi kendine ZORLAMAZ, yalnizca bayragi tasir.
        //
        // TEK OTURUM (M1 ile PAYLASIMLI): modul-duzeyi `hesap`, M1'in
        // `hesapYap`i ile AYNI sekilde burada da guncellenir. Yalniz
        // `legacyProvider.publicKey/isConnected`i doldurmak, legacy seritten
        // baglanan bir dapp'in yaninda Wallet Standard adaptoru kullanan baska
        // bir kutuphanenin `window.wats.solana.wallet.accounts`i HALA BOS
        // gormesine yol acardi -- ayni arka uc oturumunun uzerinde IKI BAGIMSIZ
        // sayfa-tarafi durumu.
        async connect(opts) {
            try {
                const sonuc = await callBackground('solana_connect', [{
                    silent: !!(opts && opts.onlyIfTrusted),
                    appMeta: sayfaBilgisi(),
                }])
                hesap = hesapYap(sonuc)
                // Nihai inceleme C4.7: iki alan icin iki ayri yazici yerine TEK
                // ortak fonksiyon -- degerler bugun ayni ("hesap" ATANDIKTAN
                // hemen sonra `hesap.publicKey`/`true` ile `hesap ?
                // hesap.publicKey : null`/`!!hesap` matematiksel olarak
                // ESDEGERDIR) ama iki BAGIMSIZ yazim noktasi yarin sessizce
                // birbirinden SAPABILIR.
                legacySenkronla()
                // Gorev 44 obligation 1 (yon 3): legacy connect de WS `change`i
                // tetikler -- WS `signIn`deki emsalin (degisimYayinla cagrisinin)
                // simetri eksigiydi (Gorev 43 incelemesi): bir adaptorle AYNI
                // oturumu izleyen bir dapp, legacy
                // seritten baglanildigini hic gormeden "hala bagli degil" sanirdi.
                degisimYayinla({ accounts: cuzdan.accounts })
                legacyEmit('connect', legacyProvider.publicKey)
                return { publicKey: legacyProvider.publicKey }
            } catch (e) {
                throw legacyError(e)
            }
        },

        // Arka plan hata donse BILE yerel durum TEMIZLENIR: dapp'in gordugu sey
        // KESILMIS bir oturumdur, `isConnected`i "bagli" birakmak gercekle
        // celisir. Hata OLDUGU GIBI (kod/data korunarak) firlatilmaya devam eder.
        async disconnect() {
            try {
                await callBackground('solana_disconnect', [{}])
            } catch (e) {
                legacyOturumuKapat()
                throw legacyError(e)
            }
            legacyOturumuKapat()
        },

        async signTransaction(tx) {
            try {
                const [sonuc] = await legacyCoklukImzala([tx])
                return sonuc
            } catch (e) {
                throw legacyError(e)
            }
        },

        // Wallet Standard'da bu ozellik YOKTUR (SS3.2): toplu imzalama,
        // `solana:signTransaction`in degisken argumanli cagrisidir. Legacy
        // seritte ayri bir ad olarak durur cunku dapp kuyrugu onu boyle cagirir.
        async signAllTransactions(txs) {
            const liste = Array.isArray(txs) ? txs : []
            // Bos dizi icin pencere ACMAK anlamsiz olurdu; arka plana da gitmez.
            if (liste.length === 0) return liste
            try {
                return await legacyCoklukImzala(liste)
            } catch (e) {
                throw legacyError(e)
            }
        },

        async signAndSendTransaction(tx, opts) {
            try {
                const sonuc = await callBackground('solana_signAndSendTransaction', [{
                    transaction: legacySerialize(tx),
                    chain: 'solana:mainnet',
                    account: legacyProvider.publicKey ? legacyProvider.publicKey.toBase58() : null,
                    // Dapp'in options'i AYNEN gider: `skipPreflight` yok sayma,
                    // `maxRetries` kirpma gibi kararlar ARKA PLANDA verilir (SS6.4).
                    // Sayfada filtrelemek, guvenlik kararini saldirganin
                    // erisebildigi katmana tasirdi.
                    options: opts,
                }])
                // Base58 AYNEN gecer: legacy dapp'ler imzayi dizge bekler ve
                // boylece sayfa betigine base58 COZUCU borcu binmez (SS3.3).
                // Sekil kapisi: arka plan yanitinda dizge imza yoksa
                // {signature: undefined} ile COZULMEK yerine reddedilir.
                if (!sonuc || typeof sonuc.signature !== 'string' || sonuc.signature.length === 0) {
                    throw new Error('Wallet returned an unexpected response.')
                }
                return { signature: sonuc.signature }
            } catch (e) {
                throw legacyError(e)
            }
        },

        // `display` GIRDI KODLAMASI DEGIL, onay ekranina render ipucudur (SS3.5).
        // Baytlari onunla cozmek dapp'e "kullaniciya ne gorunecegini" sectirirdi;
        // imzalanan sey ile gorunen sey ayrisirdi. (Ekran ipucunu su an kullanmiyor;
        // tasima sozlesmesi icin gonderilir.)
        async signMessage(message, display) {
            try {
                const bytes = legacyMesajBaytlari(message)
                const sonuc = await callBackground('solana_signMessage', [{
                    message: bytesToBase64(bytes),
                    account: legacyProvider.publicKey ? legacyProvider.publicKey.toBase58() : null,
                    display: display === 'hex' ? 'hex' : 'utf8',
                }])
                // Sekil kapisi (Gorev 48 K2'nin aynasi): ed25519 imzasi HER ZAMAN 64 bayttir.
                if (!sonuc || typeof sonuc.signature !== 'string' || sonuc.signature.length === 0) {
                    throw new Error('Wallet returned an unexpected response.')
                }
                // Fix turu 1, F4: bozuk base64 `atob`'dan ham bir DOMException
                // (InvalidCharacterError, sayisal `.code`) firlatir -- yakalanmazsa
                // legacyError'un sayisal-kod dalindan GECER ve dapp motor hatasi
                // gorur. Ayni "beklenmedik yanit" govdesine dusurulur.
                let signature
                try {
                    signature = base64ToBytes(sonuc.signature)
                } catch (e) {
                    throw new Error('Wallet returned an unexpected response.')
                }
                if (signature.length !== 64) throw new Error('Wallet returned an unexpected response.')
                return { signature, publicKey: legacyProvider.publicKey }
            } catch (e) {
                throw legacyError(e)
            }
        },

        // KASITLI SAPMA (inceleme bulgusu M3): `Set` AYNI dinleyiciyi TEKRAR
        // eklemeyi yutar -- iki kez `on` + bir `off` tumunu SUSTURUR. Node'un
        // EventEmitter'i (ve eventemitter3) burada COKLU KUME olur: iki `on`
        // iki cagri ister, tek `off` yalnizca birini soker. Yon guvenlidir --
        // yanlislikla iki kez abone olan bir adaptor ciftlenmis olay ALMAZ --
        // ama sessiz bir farktir, bu yuzden burada kayda geciriliyor.
        on(event, listener) {
            if (typeof listener !== 'function') return
            let set = legacyListeners.get(event)
            if (!set) { set = new Set(); legacyListeners.set(event, set) }
            set.add(listener)
        },

        // Adaptorler disconnect'te wallet.off(...) cagirir; eksikse TAM ORADA
        // patlar (SS3.5). Tablo BOSKEN de cagrilir -- bu yuzden set kontrolu var.
        off(event, listener) {
            const set = legacyListeners.get(event)
            if (set) set.delete(listener)
        },
    }
    // Iki ad da vahsi dogada kullaniliyor; AYNI fonksiyon olmalari, birini
    // sarmalayip digerini unutma hatasini bastan imkansiz kilar.
    legacyProvider.removeListener = legacyProvider.off

    function legacyOturumuKapat() {
        // Paylasimli `hesap` da temizlenir: aksi halde WS tarafi (`cuzdan.accounts`)
        // legacy disconnect'ten SONRA da hala "bagli" gorunur -- ayni arka uc
        // oturumunun uzerinde iki celisen sayfa-tarafi durumu olurdu.
        hesap = null
        legacySenkronla()
        legacyEmit('disconnect')
        // Gorev 44 obligation 1 (yon 4): legacy kesme de WS `change`i tetikler --
        // WS `disconnect()`in kendi cagrisindaki degisimYayinla ile AYNI simetri,
        // ters yonde.
        degisimYayinla({ accounts: cuzdan.accounts })
    }

    // KURULUM -- SS3.1. YALNIZCA DUZ ATAMA (yukaridaki `window.wats` ile
    // birebir ayni kural): Object.defineProperty ile writable:false yazmak,
    // sonradan gelen baska bir cuzdanin enjeksiyonunu PATLATIR.
    //
    // `if (!window.solana)` bir politika degil bir YARIS: document_start'ta
    // oncelik bizde ama sayfanin kendi betigi ya da baska bir uzanti ayni tick'te
    // yazmis olabilir. Bir mikro-gorev ve bir gec tick'te yeniden denenir.
    // Yarisi KAYBETSEK BILE `window.wats.solana` GARANTILI serittir; `legacySlot`
    // yuvanin bizde mi devredilmis mi oldugunu kaydeder. (Bizden SONRA yazan bir
    // cuzdan yuvayi geri alabilir -- o durumda bayrak bayat kalir, ama garantili
    // serit dogru nesneyi tasimaya devam eder.)
    function installLegacySolana() {
        // GEC TICK KORUMASI: bu fonksiyon queueMicrotask ve setTimeout ile de
        // cagriliyor. Testte bir suit kendi `globalThis.window` duzenegini
        // temizledikten SONRA bekleyen bir zamanlayici atesleyebilir ve bu
        // `window is not defined` seklinde YAKALANMAMIS bir hataya donusur --
        // dosya capindaki try/catch yalnizca SENKRON govdeyi sarar. Gercek
        // sayfada bu dal hic calismaz.
        if (typeof window === 'undefined') return
        if (window.solana === legacyProvider) return
        if (!window.solana) {
            window.solana = legacyProvider
            legacyProvider.legacySlot = 'ours'
            if (window.wats && window.wats.solana) window.wats.solana.legacySlot = 'ours'
            return
        }
        legacyProvider.legacySlot = 'ceded'
        if (window.wats && window.wats.solana) window.wats.solana.legacySlot = 'ceded'
    }

    // `window.wats.solana` GARANTILI serittir (yukarida kuruldu). M5 onu
    // DEGISTIRMEZ, `legacy` alanini DOLDURUR: kaydi legacy saglayiciyla ezmek,
    // M4'un `window.wats.solana.wallet.features` okumasini sessizce bozardi --
    // ayni alan, iki uyumsuz sekil.
    window.wats.solana.legacy = legacyProvider

    installLegacySolana()
    queueMicrotask(installLegacySolana)
    setTimeout(installLegacySolana, 0)
} catch (hata) {
    // Ziyaret edilen sayfaya hicbir hata sizmaz: konsola bile yazmayiz. Enjekte
    // edilen betigin bir arizasi, o sayfanin kendi hata izlemesini kirletmemeli.
}
