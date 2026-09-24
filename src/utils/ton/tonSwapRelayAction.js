// STON.fi SDK'sinin kurdugu takas mesajini ROLE EYLEMINE cevirir.
//
// NEDEN CEVIRMEK GEREKIYOR: takas govdesini SDK kuruyor, biz degil - ve bu bir
// tercih degil olcum sonucu (tonSwap.js dosya basi): `TON -> jetton` yonu ROUTER
// SURUMUNE gore bambaska bir mekanizma kullaniyor (v1'de TEP-74, v2.2'de pTON'a
// giden ayri bir opcode). Role ucu ise ANLAMSAL bir eylem listesi istiyor. Yani
// SDK'nin urettigi mesajdan sunucunun anladigi alanlari CIKARMAK zorundayiz.
//
// BU DOSYA SAF: zincire, chrome'a, aga DOKUNMAZ. Girdi SDK'nin `{to, value, body}`
// ciktisi, cikti tonFeeRelayer'in eylem sekli. Boylece cevrim gercek bir SDK
// cagrisi olmadan olculebilir.
//
// ANLAMADIGI HER SEYDE FIRLATIR. Sessizce "role yok" demek yerine gurultu
// cikarmasinin sebebi: cagiran (onizleme) hatayi YAKALAYIP karti cizmez, ama
// GONDERIM yolunda ayni hata gercek bir tutarsizliktir ve gorunmesi gerekir.
import { Address } from '@ton/core'
import { readJettonTransferBody } from './jettonBodyRead'

export class TonSwapRelayError extends Error {
    constructor(code) {
        super(code)
        this.name = 'TonSwapRelayError'
        this.code = code
    }
}

const dur = (code) => { throw new TonSwapRelayError(code) }

// Sunucunun beyan ettigi sinir (GET /paymaster/ton/routers -> limits).
// Sabit BURADA, cunku asilmasi /quote'u tumden dusurur: kullaniciya once ucret
// gosterip sonra reddetmek, donebilecegi bir secenegi olmayan bir cikmazdir.
// Liste yanitindaki deger ile AYRISABILIR - cagiran taze limiti tasiyabilsin
// diye parametre olarak da kabul ediliyor.
export const MAX_PAYLOAD_BYTES = 1024

// TON adresleri KANONIK RAW bicimde gonderilir (0:<hex>). Sunucunun router
// beyaz listesi de bu bicimde (tonRouters.js:rawAdres ile ayni indirgeme) -
// iki tarafi ayni bicime getirmek, "listede var ama eslesmiyor" sinifindaki
// sessiz reddi tumden kapatir.
const raw = (adres) => Address.parse(String(adres)).toRawString()

/**
 * SDK mesajini role eylemine cevirir.
 *
 * @param {object} args
 * @param {'j2j'|'j2t'|'t2j'} args.direction  takas yonu (tonSwap.js ile AYNI ad)
 * @param {{to: any, value: any, body: import('@ton/core').Cell}} args.params
 *   SDK'nin `get*TxParams` ciktisi
 * @param {string} args.offerJettonMaster  verilen jetton'un master adresi
 *   (`t2j`'de kullanilmaz)
 * @param {bigint} args.offerUnits  kullanicinin verdigi HAM tutar
 * @param {number} [args.maxPayloadBytes]  taze sunucu siniri
 * @returns {object} tonFeeRelayer'in `actions` elemani
 * @throws {TonSwapRelayError}
 */
export function swapRelayAction({ direction, params, offerJettonMaster, offerUnits, maxPayloadBytes = MAX_PAYLOAD_BYTES }) {
    if (!params?.body) dur('TON_SWAP_RELAY_NO_BODY')

    // --- TON -> jetton: HAM mesaj -------------------------------------------
    // Hedef pTON/router, govde DEX'in cagrisi, deger ise gonderilen TON + gaz.
    // Bu yon `kind:'jetton'` OLAMAZ: ortada bir TEP-74 transferi yok.
    if (direction === 't2j') {
        const toplam = BigInt(params.value ?? 0)
        // GAZ PAYI SDK'NIN KENDI DEGERINDEN TURER, ayri bir sabitten DEGIL:
        // SDK iliştirilecek toplami zaten "gonderilen + gaz" olarak hesapliyor
        // (tonSwap.js:gasNano notu). Ikinci bir kaynak tutmak, SDK guncellendiginde
        // sessiz ayrisma uretirdi.
        const gaz = toplam - BigInt(offerUnits)
        // Gaz payi POZITIF olmali: sifir ya da negatif, SDK'nin bizim
        // bekledigimizden BASKA bir sey kurdugu anlamina gelir ve gazsiz giden
        // bir DEX cagrisi zincirde SESSIZCE duser - ucret ise alinmistir.
        if (gaz <= 0n) dur('TON_SWAP_RELAY_GAS_UNRESOLVED')

        const yuk = bocBase64(params.body, maxPayloadBytes)
        return {
            kind: 'raw',
            to: raw(params.to),
            // KULLANICININ CEBINDEN CIKAR ve bu dogru: sponsorlanan sey GAZ,
            // takasa GIREN TON degil (sozlesme ss00: `amountNano` asla
            // sponsorlanmaz). Bakiye kapisi cagiranda.
            amountNano: String(offerUnits),
            payloadBoc: yuk,
            gasTonNano: String(gaz),
            // Cagri duserse iliştirilen TON GERI DONSUN. false secilirse hedef
            // kontratta kilitli kalir (tonSwap.js'in kendi self-pay yolundaki
            // ayni karar).
            bounce: true,
        }
    }

    if (direction !== 'j2j' && direction !== 'j2t') dur('TON_SWAP_RELAY_UNKNOWN_DIRECTION')

    // --- jetton -> * : TEP-74 transferi --------------------------------------
    // Dis hedef KENDI jetton cuzdanimiz, govdedeki `destination` ise ROUTER.
    // Sunucu eylemi bu ANLAMDAN yeniden kurar; biz alanlari cikariyoruz.
    let govde
    try {
        govde = readJettonTransferBody(params.body.beginParse())
    } catch (e) {
        // SDK bizim ANLAMADIGIMIZ bir govde kurduysa role eylemi uretilemez.
        // Sessizce duz bir transfere cevirmek, takasi transfere dondururdu.
        if (e?.name === 'JettonBodyReadError') dur('TON_SWAP_RELAY_BODY_UNREADABLE')
        throw e
    }

    // TAKASIN TANIMI: forward_payload DEX'in swap talimatidir. Yoksa bu bir
    // takas degil duz bir jetton transferidir ve buraya hic gelmemeliydi.
    if (!govde.forwardPayload) dur('TON_SWAP_RELAY_NO_FORWARD_PAYLOAD')
    if (!govde.destination) dur('TON_SWAP_RELAY_NO_ROUTER')
    // Forward payi DEX'in gazidir; sifir olursa router cagriyi hic islemez.
    // Sunucunun varsayilani (1 nanoton) da yetmez - bu yuzden tutar ACIKCA
    // tasinir (sozlesme ss04: "Backend alt sinir dayatmaz").
    if (govde.forwardTonAmount <= 0n) dur('TON_SWAP_RELAY_NO_FORWARD_TON')

    // SDK BIZIM ISTEDIGIMIZ TUTARI MI GONDERIYOR? Ayrisirsa ekranda gorulen
    // miktar ile zincire giden miktar farklidir - ve bakiye kapilari ekrandaki
    // tutara gore kurulmustu.
    if (govde.amount !== BigInt(offerUnits)) dur('TON_SWAP_RELAY_AMOUNT_MISMATCH')

    return {
        kind: 'jetton',
        jettonMaster: String(offerJettonMaster),
        to: raw(govde.destination),
        amount: String(govde.amount),
        // GONDERENIN kendi jetton cuzdani: sunucuya GITMEZ, yalniz
        // tonQuoteVerify'in "hangi token" dogrulamasinin girdisidir.
        jettonWallet: raw(params.to),
        forwardTonNano: String(govde.forwardTonAmount),
        forwardPayloadBoc: bocBase64(govde.forwardPayload, maxPayloadBytes),
    }
}

// STANDART base64 - base64url DEGIL ve padding KIRPILMAZ (sozlesme ss04).
// `Buffer.toString('base64')` tam olarak bunu uretir; kirpan bir yardimci
// kullanmak istegi sunucuda dusururdu.
function bocBase64(cell, maxPayloadBytes) {
    const bayt = cell.toBoc()
    // Sinir SUNUCUNUN (limits.maxPayloadBytes). Burada kontrol etmek, once ucret
    // gosterip sonra reddetmeyi onler.
    if (bayt.length > maxPayloadBytes) dur('TON_SWAP_RELAY_PAYLOAD_TOO_LARGE')
    return bayt.toString('base64')
}
