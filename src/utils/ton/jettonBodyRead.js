// TEP-74 transfer govdesinin TEK okuyucusu.
//
// NEDEN AYRI DOSYA: bu govde artik IKI yerde okunuyor ve ikisi FARKLI sorular
// soruyor:
//   - tonQuoteVerify: "SUNUCUNUN kurdugu govde niyetimle ayni mi" (dusmanca)
//   - tonSwapRelayAction: "SDK'NIN kurdugu govdeden role eylemini cikar" (kendi
//     verimiz)
// Iki ayri ayristirici yazmak, birinin duzelip digerinin duzelmemesi demekti --
// bu depoda ayni gerekce `decimalToRawUnits` icin de yazili (jettonTransfer.js).
// Sorular farkli, OKUMA ayni.
//
// Olculen yapi (2026-08-29 canli jetton quote'u; STON.fi SDK'sinin
// createJettonTransferMessage'i de BIREBIR ayni sirayla kuruyor):
//   transfer#0f8a7ea5  query_id:uint64  amount:(VarUInteger 16)  destination:MsgAddress
//                      response_destination:MsgAddress  custom_payload:(Maybe ^Cell)
//                      forward_ton_amount:(VarUInteger 16)  forward_payload:(Either Cell ^Cell)
//
// BU DOSYA YALNIZ COZER, KARAR VERMEZ. Anlamadigi her seyde FIRLATIR; "herhalde
// iyidir" diye gecilen bir alan, hic acilmamis govdeyle ayni siniftadir. Kararin
// kendisi (niyetle karsilastirma, hangi hata kodu) cagiranindir.
import { JETTON_TRANSFER_OP } from './jettonTransfer'

export class JettonBodyReadError extends Error {
    constructor(detail) {
        super(detail)
        this.name = 'JettonBodyReadError'
        // Cagiran taraf kendi hata koduna CEVIRIR (tonQuoteVerify
        // TON_PAYLOAD_BODY_UNVERIFIED'a, takas donusturucusu kendi koduna).
        // `detail` yalniz teshis icindir - tanimadigimiz bir govdeyle
        // karsilastigimizda hangi ALANA takildigimiz tek ipucumuz.
        this.detail = detail
    }
}

const dur = (detail) => { throw new JettonBodyReadError(detail) }

/**
 * TEP-74 transfer govdesini cozer.
 *
 * @param {import('@ton/core').Slice} body  govdenin BASINDAN baslayan slice
 * @returns {{amount: bigint, destination: import('@ton/core').Address|null,
 *            responseDestination: import('@ton/core').Address|null,
 *            forwardTonAmount: bigint,
 *            forwardPayload: import('@ton/core').Cell|null}}
 * @throws {JettonBodyReadError}
 */
export function readJettonTransferBody(body) {
    const op = body.remainingBits >= 32 ? body.loadUint(32) : null
    // TANINMAYAN OP = DUR. Yalniz TANIDIGIMIZ transfer okunur; baska her govde
    // (swap yonlendiricisinin KENDI cagrisi, NFT, bilinmeyen kontrat) kapali.
    if (op !== JETTON_TRANSFER_OP) {
        dur(op === null ? `${body.remainingBits} bit` : '0x' + op.toString(16).padStart(8, '0'))
    }

    let amount, destination, responseDestination, forwardTonAmount
    let customPayloadVar, forwardPayloadRef
    try {
        // query_id transfer_notification/excesses mesajlarinda GERI ECHO edilen
        // bir etikettir; tutar, alici ya da deger uzerinde hicbir yetkisi yoktur.
        body.loadUintBig(64)
        amount = body.loadCoins()
        // addr_none MsgAddress icin GECERLI bir yazimdir ve loadAddress FIRLATIR;
        // maybe varyanti null doner ve null, cagiranda "esit degil"e duser.
        destination = body.loadMaybeAddress()
        responseDestination = body.loadMaybeAddress()
        customPayloadVar = body.loadBit()
        forwardTonAmount = body.loadCoins()
        forwardPayloadRef = body.loadBit()
    } catch {
        // Op TANINIYOR ama govde yapiya uymuyor.
        dur('kesik transfer govdesi')
    }

    // custom_payload KENDI jetton cuzdanimiza giden, ICERIGINI COZMEDIGIMIZ bir
    // talimattir. Ne olculen sunucu govdesinde ne de SDK'nin kurdugunda var.
    // SIRA ONEMLI: bu kontrol asagidaki loadRef'ten ONCE gelmeli - custom_payload
    // dolu olsaydi govdenin ILK ref'i o olurdu ve yanlis hucreyi okurduk.
    if (customPayloadVar) dur('custom_payload')

    // forward_payload:(Either Cell ^Cell). Hem sunucu hem STON.fi SDK'si
    // `bit 1 + ref` yaziyor (sozlesme ss05; SDK'da createJettonTransferMessage).
    // SATIR ICI (bit 0 + kalan bitler) sekli TANIMLI ama URETILMIYOR: ayri bir
    // hucre olmadigi icin tek basina hash'lenemez ve tasinamaz - yani
    // DOGRULANAMAZ. Uretildigi gun burada gurultuyle duser, sessizce gecmez.
    let forwardPayload = null
    if (forwardPayloadRef) {
        try {
            forwardPayload = body.loadRef()
        } catch {
            dur('forward_payload ref okunamadi')
        }
    }

    // Belgelenen alanlar bittikten SONRA kalan hicbir sey olmamali: artik veri
    // hem satir ici forward_payload'i hem de bilmedigimiz bir uzantiyi gizler.
    if (body.remainingBits > 0 || body.remainingRefs > 0) dur('govdede artik veri')

    return { amount, destination, responseDestination, forwardTonAmount, forwardPayload }
}
