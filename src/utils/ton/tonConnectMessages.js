// TonConnect `sendTransaction` istegini COZUMLEME ve DOGRULAMA -- saf katman.
//
// Buradaki her kapi IMZADAN ONCE calisir. Sonra calisan bir kontrol, kullanicinin
// ONAYLADIGI seyle IMZALANAN sey arasinda fark birakir -- bu farkin bedeli para.
//
// AG YOK, chrome YOK.

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

function parseRaw(rawParams) {
    // Kopru tarafinda TonConnect params'i JSON METIN olarak tasiyabiliyor.
    // Iki bicimi de kabul etmek, "bazi dapp'lerde calisiyor" hatasinin onunu keser.
    if (typeof rawParams !== 'string') return rawParams
    try { return JSON.parse(rawParams) } catch (e) { return null }
}

// nanoton POZITIF TAM SAYI. '1.5' ya da '-5' BigInt'e cevrilirken patlar ya da
// (daha kotusu) sessizce yuvarlanip zincirde BASKA bir deger olur.
const isNanoAmount = (v) => /^\d+$/.test(v) && BigInt(v) >= 0n

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
 * Sunucu boyle bir eylemi FIYATLANDIRMIYOR. Kural burada AYNALANIR ki cuzdan da
 * imzalamasin -- ucreti kim oderse odesin (relay ya da self-pay), sonuc degismez.
 *
 * `stateInit` ISTISNADIR ve bilerek: 0 TON'la bile olsa alici adreste bir
 * kontrat kurmak ANLAMLI bir niyettir. Sunucunun metni stateInit'i anmaz cunku
 * o zaten ham yolu tumden reddediyor (bkz. tonFeeRelayer.js RAW_ACTION_KEYS
 * notu) -- yani sunucu icin boyle bir mesaj hic var olmuyor, bizim icin var.
 *
 * KARAR: `amountNano` burada DIZE de SAYI da olabilir. Normalize edilmis
 * mesajda hep dizedir (asagida String'e cevriliyor), ama kural ham bir mesaja
 * da uygulanabilsin diye ikisi de kabul edilir -- sayi 0'i "dize degil, demek ki
 * dolu" saymak kapiyi sessizce acardi.
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

    if (raw.network !== undefined && raw.network !== null && String(raw.network) !== String(walletNetwork)) {
        return err('Requested network does not match the wallet network')
    }

    let validUntil = null
    if (raw.valid_until !== undefined && raw.valid_until !== null) {
        const vu = Number(raw.valid_until)
        if (!Number.isFinite(vu)) return err('valid_until is not a number')
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

        // Sayi TIPI amount'de: JSON.parse zaten BUYUK SAYILARI yanlislastirir
        // (2^53 usteri), ve bu noktada ORIJINAL DEGER KURTARILAMIYOR. Sessizce
        // yanlis imzalamak olurdu -- REDDETMEK tek dofru secenektir.
        if (typeof m.amount === 'number' && !Number.isSafeInteger(m.amount)) {
            return err('Message amount out of safe integer range')
        }

        const amountRaw = typeof m.amount === 'number' ? String(m.amount) : String(m.amount ?? '').trim()
        if (!isNanoAmount(amountRaw)) return err('Message amount must be a non-negative integer in nanotons')

        messages.push({
            address,
            amountNano: amountRaw,
            // payload/stateInit BOC'tur ve BU KATMAN ONU COZMEZ. Cozebiliyormus
            // gibi davranmak, onay ekraninda uydurma bir ozet gostermek olurdu.
            payload: typeof m.payload === 'string' && m.payload ? m.payload : null,
            stateInit: typeof m.stateInit === 'string' && m.stateInit ? m.stateInit : null,
        })
    }

    return { ok: true, validUntil, messages }
}
