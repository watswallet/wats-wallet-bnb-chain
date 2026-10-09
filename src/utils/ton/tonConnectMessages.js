// TonConnect `sendTransaction` istegini COZUMLEME ve DOGRULAMA -- saf katman.
//
// Buradaki her kapi IMZADAN ONCE calisir. Sonra calisan bir kontrol, kullanicinin
// ONAYLADIGI seyle IMZALANAN sey arasinda fark birakir -- bu farkin bedeli para.
//
// AG YOK, chrome YOK.

import { Address, Cell } from '@ton/core'
import { TON_MAINNET_ID, TON_TESTNET_ID } from '../chainKind'

// Sinir KENDI dosyasinda durur ve buradan yeniden disa verilir: bu dosyanin
// import zinciri `import.meta.env` okuyan modullere uzaniyor ve cihaz betimi
// (tonConnectDevice.js) artik derleme yapilandirmasindan da import ediliyor --
// gerekce tonConnectLimits.js'te. Mevcut cagiranlar degismesin diye ad buradan
// da gorunur kalir.
export { MAX_MESSAGES } from './tonConnectLimits'
import { MAX_MESSAGES } from './tonConnectLimits'

const BAD_REQUEST = 1

const err = (message) => ({ ok: false, code: BAD_REQUEST, message })

// TonConnect alanlarinda undefined ve null ayni sey: alan YOK.
const isPresent = (v) => v !== undefined && v !== null

/**
 * Cuzdanin TonConnect'e bildirecegi ag kimligi.
 *
 * TonConnect aktif agdan BAGIMSIZ (K3): kullanici Ethereum'da dururken de bir TON
 * dapp'ine baglanabilir ve o durumda TON kimligi MAINNET'tir. Testnet YALNIZCA
 * kullanici acikca TON testnet'e gectiyse secilir -- "EVM disi her sey testnet"
 * gibi bir sezgi, gercek parayi test agina yollamanin yolu olurdu.
 */
export function tonNetworkId(currentNetwork) {
    return Number(currentNetwork?.chainId) === TON_TESTNET_ID
        ? String(TON_TESTNET_ID)
        : String(TON_MAINNET_ID)
}

/**
 * Istekteki ag cuzdaninkiyle UYUSMUYOR mu? Ag OPAK bir kimliktir, TAM dize
 * esitligi aranir (wallet-guidelines.md): sayi -239 bile '-239' ile uyusmaz.
 * Alan yoksa uyumsuzluk da yoktur.
 */
export function networkMismatch(requested, walletNetwork) {
    if (!isPresent(requested)) return false
    return typeof requested !== 'string' || requested !== walletNetwork
}

/**
 * dApp'in verdigi mesaj adresini cozer: YALNIZ friendly bicim (rpc.md, raw
 * REDDEDILIR). Hic firlatmaz; gecersizse null, gecerliyse
 * { isBounceable, isTestOnly, address }. Cagiran dizeyi YENIDEN serilestirmez:
 * toString varsayilani bounceable, UQ'yu EQ yapar ve bayrak kaybolur.
 */
export function parseTonConnectAddress(a) {
    const s = typeof a === 'string' ? a.trim() : ''
    // isFriendly yalniz uzunluk + karakter kumesine bakar; CRC'yi parseFriendly dogrular.
    if (!Address.isFriendly(s)) return null
    // Ciplak catch BILEREK: gecersiz etikette Error degil duz DIZE firlatilir.
    try { return Address.parseFriendly(s) } catch { return null }
}

/**
 * Mesajin bounce davranisi ADRESTEKI bayraktan okunur (rpc.md), yukten degil.
 * testOnly bayragi yok sayilir.
 * @throws TON_ADDRESS_INVALID
 */
export function tonConnectBounce(a) {
    const p = parseTonConnectAddress(a)
    if (!p) throw new Error('TON_ADDRESS_INVALID')
    return p.isBounceable
}

function parseRaw(rawParams) {
    // Kopru tarafinda TonConnect params'i JSON METIN olarak tasiyabiliyor.
    // Iki bicimi de kabul etmek, "bazi dapp'lerde calisiyor" hatasinin onunu keser.
    if (typeof rawParams !== 'string') return rawParams
    try { return JSON.parse(rawParams) } catch (e) { return null }
}

// nanoton POZITIF TAM SAYI. '1.5' ya da '-5' BigInt'e cevrilirken patlar ya da
// (daha kotusu) sessizce yuvarlanip zincirde BASKA bir deger olur.
const isNanoAmount = (v) => /^\d+$/.test(v) && BigInt(v) >= 0n

// TON Coins = VarUInteger 16: deger en fazla 15 bayt, yani < 2^120. Ustu onay
// ekranina gelir ama imzada (storeCoins) patlardi.
const COINS_SINIRI = 2n ** 120n

// Cozulebilen TEK kokli BOC mu? Cell.fromBase64 iki koklu BOC'ta da firlatir.
function decodeBoc(v) {
    if (typeof v !== 'string' || !v) return null
    try { return Cell.fromBase64(v) } catch { return null }
}

// StateInit TAM okunmali: background onu loadStateInit ile cozup YENIDEN
// serilestirir, artan bit/ref sessizce duser ve imzalanan StateInit dapp'in
// gonderdiginden farkli olur. Hata metni doner; gecerliyse null.
//
// Baslik ELLE okunur, loadStateInit DEGIL: o kutuphane sozlugunu parseDict ile
// yurur ve paylasilan alt agaclari her yoldan yeniden gezer. Birkac yuz baytlik
// bir BOC servis calisanini dakikalarca kilitler. Dapp deploy'unda kutuphane
// olmaz; bit kuruluysa reddedilir.
function stateInitHatasi(v) {
    const cell = decodeBoc(v)
    if (!cell) return 'Malformed stateInit'
    try {
        const s = cell.beginParse()
        if (s.loadBit()) s.skip(5) // split_depth
        if (s.loadBit()) s.skip(2) // special: tick, tock
        s.loadMaybeRef() // code
        s.loadMaybeRef() // data
        if (s.loadBit()) return 'stateInit libraries are not supported'
        return s.remainingBits === 0 && s.remainingRefs === 0 ? null : 'Malformed stateInit'
    } catch { return 'Malformed stateInit' }
}

// Ek para birimi alani VAR ve bos nesne DEGIL mi?
function hasExtraCurrency(v) {
    if (!isPresent(v)) return false
    return typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 0
}

/**
 * Bu mesaj HICBIR SEY YAPIYOR MU?
 *
 * 0 nanoton tasiyan, govdesi (`payload`) ve kurulumu (`stateInit`) olmayan bir
 * mesaj hedefte hicbir sey yapmaz: deger gecmez, cagrilacak bir op yoktur, kod
 * kurulmaz. Geriye yalniz kullanicinin odedigi ag ucreti kalir.
 *
 * OLCULDU 2026-09-14 (canli paymaster):
 *   POST /paymaster/ton/quote  actions[0] = {kind:"raw", amountNano:"0"}
 *   -> 400 {"error":"actions[0] does nothing - amountNano is 0 and there is no payloadBoc"}
 * Sunucu boyle bir eylemi FIYATLANDIRMIYOR. Kuralin TEK anlami: ATS teklifi
 * istenmez (sunucu reddederdi). Cuzdan UYARIR ama yine de imzalar (self-pay).
 *
 * `stateInit` ISTISNADIR ve bilerek: 0 TON'la bile olsa alici adreste bir
 * kontrat kurmak ANLAMLI bir niyettir. Sunucunun metni stateInit'i anmaz cunku
 * o zaten ham yolu tumden reddediyor (bkz. tonFeeRelayer.js RAW_ACTION_KEYS
 * notu) -- yani sunucu icin boyle bir mesaj hic var olmuyor, bizim icin var.
 *
 * KARAR: `amountNano` burada DIZE de SAYI da olabilir. Normalize edilmis
 * mesajda hep dizedir (dogrulama yalniz dize kabul ediyor), ama kural ham bir
 * mesaja da uygulanabilsin diye ikisi de kabul edilir -- sayi 0'i "dize degil,
 * demek ki dolu" saymak kapiyi sessizce acardi.
 *
 * @param {{amountNano: string|number, payload?: string|null, stateInit?: string|null}} m
 * @returns {boolean}
 */
export function isNoopMessage(m) {
    if (!m) return false
    if (String(m.amountNano ?? '') !== '0') return false
    return !m.payload && !m.stateInit
}

/**
 * Bu istegin KULLANICININ KENDI TON bakiyesinden goturecegi toplam (nanoton).
 *
 * NEDEN VAR: "role acik" ile "bedava" AYNI SEY DEGIL. Paymaster ekibinin
 * 2026-09-14 cevabi (docs/backend-istek-2026-09-14c-uninit-cuzdan-role.md, ss5)
 * bunu acikca soyluyor: `amountNano` HICBIR ZAMAN sponsorlanmaz -- rolecinin
 * ilistirdigi TON (`gasTonNano`) yalniz HEDEF kontratin gazini fonlar, gonderilen
 * tutari DEGIL. Yani ATS karti gorunurken bile kullanicinin kendi TON'u yetmezse
 * ucret TAHSIL EDILIR ve islem zincirde duser: "ucret alindi, teslim edilmedi".
 *
 * ROLE ILE SELF-PAY AYRISIR, cunku niyetin sekli ayrisiyor (TonSendTx.vue
 * tonFeeActions ile AYNI dallanma -- ikisi ayrisirsa bakiye BASKA bir govde icin
 * olculur):
 *   - yuk VARSA  -> `kind:'raw'`, `amountNano:'0'` + `gasTonNano` (roleci fonlar)
 *   - yuk YOKSA  -> `kind:'raw'`, GERCEK `amountNano` (kullanici oder)
 * Self-pay'de dallanma YOKTUR: gonderen kullanicinin cuzdanidir, tutarin tamami
 * ondan cikar.
 *
 * AG UCRETI BURADA YOK. Bu fonksiyon yalniz "gonderilen tutar"i sayar; ihtiyat
 * payi (TON_FEE_RESERVE) cagiranin isidir -- role modunda o pay SIFIRDIR ve
 * ikisini burada birlestirmek, cagiranin modu bilmesine ragmen bu dosyaya da
 * bildirmesini gerektirirdi.
 *
 * BigInt: nanoton degerleri bir double'in tam temsil ettigi araligi asabilir
 * (toplamNano'daki AYNI gerekce).
 *
 * @param {Array<{amountNano: string|number, payload?: string|null}>} messages
 * @param {{relay?: boolean}} [opts]
 * @returns {bigint}
 */
export function userSpentNano(messages, { relay = false } = {}) {
    if (!Array.isArray(messages)) return 0n
    return messages.reduce((sum, m) => {
        if (relay && m?.payload) return sum
        return sum + BigInt(m?.amountNano ?? 0)
    }, 0n)
}

/**
 * @param {object|string} rawParams
 * @param {{nowSec: number, walletNetwork: string}} ctx
 */
export function validateSendTransactionRequest(rawParams, { nowSec, walletNetwork } = {}) {
    const raw = parseRaw(rawParams)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return err('Malformed sendTransaction params')

    // rpc.md: messages ile items'tan TAM OLARAK biri. itemTypes bildirmiyoruz,
    // yani yalniz items tasiyan istek de yapilamaz.
    if (isPresent(raw.items)) {
        return err(isPresent(raw.messages)
            ? 'messages and items are mutually exclusive'
            : 'Structured items are not supported')
    }

    // reason: cagiran (tonDappFunctions.js) bu reddi kullaniciya uyari
    // penceresiyle de gosterir (B2); diger kod 1 retleri etiket tasimaz.
    if (networkMismatch(raw.network, walletNetwork)) {
        return { ...err('Requested network does not match the wallet network'), reason: 'network' }
    }

    let validUntil = null
    if (isPresent(raw.valid_until)) {
        const vu = raw.valid_until
        // uint32 SANIYE. Dize, kesirli ya da milisaniye deger imzada patlardi
        // (storeUint(.., 32)); pencere ACILMADAN reddedilir.
        if (typeof vu !== 'number' || !Number.isInteger(vu) || vu <= 0 || vu > 0xFFFFFFFF) {
            return err('valid_until must be a uint32 unix time in seconds')
        }
        // GECMIS bir valid_until'i imzalamak anlamsiz: islem zincirde zaten
        // reddedilir, ama kullaniciya bir onay ekrani gostermis oluruz. Ekrani
        // ACMADAN reddetmek dogru olan.
        if (vu <= Number(nowSec)) return err('Request expired')
        validUntil = vu
    }

    const list = raw.messages
    if (!Array.isArray(list) || list.length === 0) return err('messages must be a non-empty array')
    if (list.length > MAX_MESSAGES) return err('Too many messages')

    const messages = []
    for (const m of list) {
        if (!m || typeof m !== 'object') return err('Malformed message')
        const address = typeof m.address === 'string' ? m.address.trim() : ''
        if (!address) return err('Message address is missing')
        // testOnly bayragi BILEREK yok sayilir: spec sessiz, Test Runner testnette UQ yolluyor.
        if (!parseTonConnectAddress(address)) return err('Message address must be a valid user-friendly address')

        // rpc.md amount'u DIZE tanimlar. JSON sayisi 2^53 ustunde sessizce
        // yuvarlanir ve orijinal deger KURTARILAMAZ -- tipten reddedilir.
        const amountRaw = typeof m.amount === 'string' ? m.amount.trim() : ''
        if (!isNanoAmount(amountRaw)) return err('Message amount must be a decimal string of nanotons')
        if (BigInt(amountRaw) >= COINS_SINIRI) return err('Message amount out of range')

        if (isPresent(m.payload) && !decodeBoc(m.payload)) return err('Malformed payload')
        const initHatasi = isPresent(m.stateInit) ? stateInitHatasi(m.stateInit) : null
        if (initHatasi) return err(initHatasi)

        // extraCurrencySupported:false bildiriyoruz. Alani sessizce dusurmek,
        // dapp'in istedigi DEGIL baska bir islemi imzalamak olurdu.
        if (hasExtraCurrency(m.extra_currency) || hasExtraCurrency(m.extraCurrency)) {
            return err('Extra currencies are not supported')
        }

        messages.push({
            address,
            amountNano: amountRaw,
            // BOC'un cozuldugu dogrulandi ama dize AYNEN saklanir: bu katman
            // icerigi OZETLEMEZ (onay ekraninda uydurma bir ozet olurdu).
            payload: isPresent(m.payload) ? m.payload : null,
            stateInit: isPresent(m.stateInit) ? m.stateInit : null,
        })
    }

    return { ok: true, validUntil, messages }
}
