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
    function makePublicKeyLike(bytes32) {
        const anahtar = bytes32 instanceof Uint8Array ? bytes32 : new Uint8Array(bytes32)
        const base58 = base58EncodeInline(anahtar)
        anahtar.toBase58 = () => base58
        anahtar.toString = () => base58
        anahtar.toBytes = () => Uint8Array.from(anahtar)
        anahtar.toBuffer = () => Uint8Array.from(anahtar)
        anahtar.equals = (digeri) => {
            if (!digeri) return false
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
            if (Array.isArray(yuk.accounts) && yuk.accounts.length === 0) hesap = null
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
            callbacks.set(id, { resolve, reject })
            window.postMessage({ target: 'wats_content_script', id, payload: { method, params } }, '*')
        })
    }

    function degisimYayinla(degisim) {
        for (const fn of changeListeners) {
            try { fn(degisim) } catch (e) { /* bir dinleyicinin hatasi digerlerini kesmemeli */ }
        }
    }

    let hesap = null

    // Tasimadan gelen base64 publicKey sinira konmadan ONCE 32 baytlik Uint8Array'e
    // cevrilir. `accountKey` sinira ASLA cikmaz: o dahili bir oturum kimligidir.
    function hesapYap(yanit) {
        return Object.freeze({
            address: yanit.address,
            publicKey: makePublicKeyLike(base64ToBytes(yanit.publicKey)),
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
        hesap = hesapYap(yanit)
        // Tek nesne DEGIL, {accounts} dondurulur; adaptorlerin `const [a] = accounts`
        // kalibi tek nesnede undefined verir.
        return { accounts: cuzdan.accounts }
    }

    async function disconnect() {
        await callBackground('solana_disconnect', [{}])
        hesap = null
        // Dapp'in kendi baslattigi kesmede de `change` yayinlanir: adaptorler
        // durumlarini bu olayla temizler, yalnizca promise'in cozulmesiyle degil.
        degisimYayinla({ accounts: [] })
        return undefined
    }

    function on(olay, dinleyici) {
        // Tanimadigimiz bir olay icin FIRLATMAK yerine no-op iptal doneriz:
        // sayfaya hata sizmaz ve adaptorun cleanup'i yine de calisir.
        if (olay !== 'change' || typeof dinleyici !== 'function') return () => {}
        changeListeners.add(dinleyici)
        return () => { changeListeners.delete(dinleyici) }
    }

    // Metot tablosu TEK seamdir: M1b uc standart ozelligi kurar, sonraki
    // milestone'lar AYNI tabloya ekler. Ozelligin degeri surum isareti degil
    // metodu TASIYAN nesnedir -- yalnizca {version} bildirmek cuzdani
    // kesfedilebilir yapar, sonra adaptor `connect is not a function` ile coker.
    const metotlar = {
        'standard:connect': { connect },
        'standard:disconnect': { disconnect },
        'standard:events': { on },
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
} catch (hata) {
    // Ziyaret edilen sayfaya hicbir hata sizmaz: konsola bile yazmayiz. Enjekte
    // edilen betigin bir arizasi, o sayfanin kendi hata izlemesini kirletmemeli.
}
