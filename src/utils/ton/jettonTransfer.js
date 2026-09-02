// TEP-74 jetton transfer govdesi. BU PLANIN PARA-KRITIK TEK DOSYASI.
//
// transfer#0f8a7ea5 query_id:uint64 amount:(VarUInteger 16) destination:MsgAddress
//   response_destination:MsgAddress custom_payload:(Maybe ^Cell)
//   forward_ton_amount:(VarUInteger 16) forward_payload:(Either Cell ^Cell)
//
// SAF ve AGSIZ tutuluyor: para riski burada yogunlastigi icin altin vektorlerle
// kapsamli test edilebilmesi sart. Ayni disiplin P0'da SLIP-0010 turetmesinde
// uygulanmisti ve dogru karar cikmisti.
//
// `@ton/ton`in JettonWallet sinifi jetton OKUMAYI (getBalance vb.) veriyor ama
// GONDERMEYI vermiyor — transfer metodu yok. Bu yuzden govde burada elle kuruluyor.
//
// KAPILAR, hepsi para kaybini onluyor:
//   1. forward_ton_amount ASLA SIFIR OLAMAZ - sifirsa bildirim mesaji (transfer_notification)
//      hic olusmaz ve icindeki yorum/memo TESLIM EDILMEZ; borsalar yatirimi memo ile
//      eslestirdigi icin memo gitmezse para borsada KAYIP sayilir. Zincirden okunan
//      gercek islemlerde (Gorev 2 altin vektorleri) bu deger her zaman 1 nanoton,
//      hicbirinde 0 degil - zincir de "asla sifir degil" kuralini dogruluyor.
//   2. ONDALIK ZORUNLU ve MAKUL SINIRLI - jettonlar 9 ondalik degildir (USDT-TON 6
//      kullanir); varsayilan bir deger gonderilen miktari 1000 kat yanlis yapardi.
//      Negatif ya da anlamsiz buyuk (or. 100) bir ondalik da gecerli bir jetton
//      kaydi degildir - bozuk/kotu niyetli girdiye isaret eder, reddedilir.
//   3. DONUSUMDEN SONRA sifir kontrolu - `amount > 0` yukarida GECEBILIR ama
//      ondaliga cevrilirken 0'a duserse zincirde GERCEK bir sifir-degerli islem
//      kurulur: gaz yanar, aliciya hicbir sey gitmez, ve hic hata firlamadigi
//      icin gonderim "basarili" gorunur. Ayni sinif hata bu depoda tonSend.js'te
//      (buildTonTransfer) bulunmustu.
//   4. response_destination ZORUNLU - eksikse artan TON (fazladan gonderilen gaz)
//      geri gonderilecegi adres olmaz, iade edilmez.
//   5. DIZE TABANLI DONUSUM, KAYAN NOKTA CARPIMI YOK - bkz. decimalToRawUnits
//      altindaki yorum. Ondaliktan FAZLA basamak tasiyan miktar YUVARLANMAZ,
//      REDDEDILIR.
import { beginCell, Address, toNano } from '@ton/core'

// Gorev 2'de hem TEP-74 metniyle hem zincirden okunan gercek islemlerle DOGRULANDI
// (docs/superpowers/notes/2026-08-24-tep74-dogrulama.md). transfer_notification'in
// opcode'u (0x7362d09c) FARKLIDIR ve bu fonksiyonun uretmedigi ayri bir mesajdir.
export const JETTON_TRANSFER_OP = 0x0f8a7ea5

// Bilinen hicbir TON jetton'u bu kadar ondalik kullanmiyor (TON'un kendisi 9,
// USDT-TON 6). 30'un uzeri (ya da negatif) bir deger gercek bir jetton kaydini
// degil, bozuk/kotu niyetli bir girdiyi gosterir - erken reddedilir.
const MAX_JETTON_DECIMALS = 30

// DUZELTME TURU 1 (B1, KRITIK): burada eskiden `BigInt(Math.round(numeric * 10 ** decimals))`
// vardi - kayan nokta CARPIMI. IEEE-754 double'da ondalik kesirler TAM temsil
// edilemez: 2.675 ikili tabanda aslinda 2.67499999999999982236... olarak
// saklanir. Bu yuzden 2.675 * 100 = 267.49999999999997 cikar ve Math.round bunu
// 267 DEGIL 268'e yuvarlar - kullanicinin yazdigi miktardan 1 birim FAZLASI
// SESSIZCE gonderilirdi. Altin vektor testlerindeki miktarlar (41.4874,
// 10.638297) bu hatayi TESADUFEN tetiklemiyordu - o testlerin gecmesi bu satirin
// guvenli oldugunu KANITLAMIYORDU.
//
// Ayni dosyada `toNano(forwardTon)` zaten DIZE tabanli ayristirma yapan bir
// kutuphane fonksiyonudur (node_modules/@ton/core/dist/utils/convert.js) -
// kutuphane bu riski zaten kabul ediyor. Asil kritik deger olan jetton `amount`
// ise bu disiplinden GECMIYORDU; simdi geciyor: miktar hicbir asamada Number
// carpimindan/bolmesinden gecmez, ONCE dizgeye cevrilir, tam ve ondalik kisim
// elle ayrilir, BigInt'e elle birlestirilir.
//
// Ondaliktan FAZLA basamak tasiyan bir miktar YUVARLANMAZ veya KESILMEZ -
// REDDEDILIR (JETTON_AMOUNT_PRECISION). Miktari sessizce degistirmek - yukari da
// olsa asagi da olsa - bu dosyanin diger kapilariyla AYNI sinifta bir ihlal
// olurdu. Kirpma ARAYUZ katmaninin bilincli/gorunur islevidir (bkz.
// clampToDecimals, client/src/utils/swapValidation.js) - bu dosya onun yerine
// GECMEZ, ondan SONRA gelir ve kati davranir: savunma katmanlari.
// DISA ACIK: takas yolu da (tonSwap) ondalikli kullanici girdisini ham birime
// cevirmek zorunda ve bu donusum KOPYALANAMAZ - kayan nokta tuzagi tam olarak
// burada cozuldu (bkz. yukaridaki B1 notu). Ikinci bir gercek kaynak uretmek,
// birinin duzelip digerinin duzelmemesi demektir.
export function decimalToRawUnits(amount, decimals) {
    let text = amount === null || amount === undefined ? '' : String(amount).trim()
    if (!text) throw new Error('JETTON_AMOUNT_INVALID')

    // String(0.000000001) === '1e-9' - asagidaki duz-ondalik regex'i ustel
    // gosterimi hic eslemez, sessizce "gecersiz" sayilirdi. clampToDecimals'daki
    // (swapValidation.js) AYNI teknikle once duz ondalik dizgeye acilir.
    if (/e/i.test(text)) {
        const expanded = Number(amount)
        if (!Number.isFinite(expanded)) throw new Error('JETTON_AMOUNT_INVALID')
        text = expanded.toFixed(Math.min(100, Math.max(decimals, 18)))
    }

    if (text === '.' || !/^\d*\.?\d*$/.test(text)) throw new Error('JETTON_AMOUNT_INVALID')

    const [wholeRaw, fractionRaw = ''] = text.split('.')
    const whole = wholeRaw || '0'

    // Sondaki sifirlar GERCEK hassasiyet degildir (2.670 === 2.67); yalnizca
    // ANLAMLI basamak sayisi decimals'i asarsa reddedilir.
    const significantFraction = fractionRaw.replace(/0+$/, '')
    if (significantFraction.length > decimals) throw new Error('JETTON_AMOUNT_PRECISION')

    const fraction = fractionRaw.padEnd(decimals, '0').slice(0, decimals)
    const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '')
    return BigInt(digits || '0')
}

export function buildJettonTransferBody({
    amount, decimals, destination, responseDestination,
    forwardTon, comment, queryId = 0n,
}) {
    if (!Number.isInteger(decimals)) throw new Error('JETTON_DECIMALS_MISSING')
    if (decimals < 0 || decimals > MAX_JETTON_DECIMALS) throw new Error('JETTON_DECIMALS_INVALID')
    if (!responseDestination) throw new Error('JETTON_RESPONSE_DESTINATION_MISSING')

    const forward = Number(forwardTon)
    if (!Number.isFinite(forward) || forward <= 0) throw new Error('JETTON_FORWARD_TON_ZERO')

    // DONUSUMDEN ONCE kaba gecerlilik: NaN/Infinity/negatif/sifir burada erken
    // elenir. decimalToRawUnits kendi ayristirmasinda da ayni girdileri
    // reddedebilir (ayni JETTON_AMOUNT_INVALID ile), ama bu satir niyeti acikca
    // "miktar sayisal olarak anlamli mi" diye ayirdigi icin birlikte tutuluyor.
    const numeric = Number(amount)
    if (!Number.isFinite(numeric) || numeric <= 0) throw new Error('JETTON_AMOUNT_INVALID')

    const raw = decimalToRawUnits(amount, decimals)
    if (raw <= 0n) throw new Error('JETTON_AMOUNT_INVALID')

    const note = typeof comment === 'string' ? comment.trim() : ''
    // Bos yorum govdeye GIRMEZ (bos hucre bosuna alan/ucret ekler) - tonSend.js'teki
    // ayni kararla tutarli. Yorum varsa TEP-74 metin yorumu onekiyle (0x00000000)
    // kodlanir; zincirdeki altin vektorlerde (GV1/GV3) birebir bu bicimde gorulup
    // dogrulandi.
    const forwardPayload = note
        ? beginCell().storeUint(0, 32).storeStringTail(note).endCell()
        : null

    return beginCell()
        .storeUint(JETTON_TRANSFER_OP, 32)
        .storeUint(queryId, 64)
        .storeCoins(raw)
        .storeAddress(Address.parse(destination))
        .storeAddress(Address.parse(responseDestination))
        .storeBit(0)                      // custom_payload: yok
        .storeCoins(toNano(forwardTon))
        .storeMaybeRef(forwardPayload)
        .endCell()
}
