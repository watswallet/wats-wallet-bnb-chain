// Jetton bakiyesi.
//
// ONDALIK ZORUNLU PARAMETREDIR ve VARSAYILANI YOKTUR. Jettonlar 9 ondalik degildir
// (USDT-TON 6 kullanir); bir varsayilan koymak o jettonu 1000 kat yanlis gosterirdi
// ve kullanici gonderirken de ayni carpani kullandigi icin bu DOGRUDAN para kaybidir.
//
// HATA 0'A CEVRILMEZ (tonBalance.js ile ayni kural) - ISTISNASIZ.
//
// DUZELTME TURU 1 - NOT_DEPLOYED REGEX'I KALDIRILDI: eskiden burada "exit_code: -13 /
// not deployed / ..." kalibina bakan bir regex vardi ve dagitilmamis cuzdani (kullanici
// o jettonu hic almamis) sessizce 0'a ceviriyordu. Bu YANLIS bir varsayima dayaniyordu.
// Gercekte @ton/ton'un kendisi bunu zaten hallediyor - kutuphane kaynagi:
// node_modules/@ton/ton/dist/jetton/JettonWallet.js:18-25
//     async getBalance(provider) {
//         let state = await provider.getState();
//         if (state.state.type !== "active") { return 0n; }   // HATA ATMADAN 0n
//         ...
//     }
// Yani dagitilmamis cuzdanda getBalance() zaten HATA ATMIYOR, sessizce 0n donuyor -
// bizim regex'imiz bu durumda hic ateslenmiyordu. Ateslendigi TEK gercek durum, AKTIF
// bir cuzdanda get-method GERCEKTEN patladiginda (gaz asimi, API arizasi, dugum hatasi)
// idi - o zaman regex bu GERCEK hatayi yutup kullaniciya SAHTE "bakiye 0" gosteriyordu.
// Kaldirmak niyeti (dagitilmamis -> 0) bozmaz - kutuphane zaten karsiliyor - ve tehlikeyi
// (gercek hatalari yutma) ortadan kaldirir.
import { Address } from '@ton/core'
import { JettonWallet } from '@ton/ton'

// Ku1 DUZELTMESI: jettonTransfer.js'teki MAX_JETTON_DECIMALS (30) ile AYNI sinir,
// AYNI yerel-sabit deseni (paylasilan import degil - digerleriyle AYNI desen).
// Eskiden burada YALNIZCA `Number.isInteger(decimals)` kontrol ediliyordu - negatif
// ya da anlamsiz buyuk bir "decimals" de tamsayi oldugu icin GECIYOR, sonraki
// `10 ** decimals` islemini anlamsiz bir sayiya (ya da 10**-1 gibi kesirli bir
// carpana) tasiyordu. Iki ayri hata anahtari jettonTransfer.js ile BIREBIR AYNI:
// eksik/tamsayi-degil -> JETTON_DECIMALS_MISSING, sinir disi -> JETTON_DECIMALS_INVALID.
const MAX_JETTON_DECIMALS = 30

export async function getJettonBalance({ client, walletAddress, decimals }) {
    if (!Number.isInteger(decimals)) throw new Error('JETTON_DECIMALS_MISSING')
    if (decimals < 0 || decimals > MAX_JETTON_DECIMALS) throw new Error('JETTON_DECIMALS_INVALID')

    const contract = client.open(JettonWallet.create(Address.parse(walletAddress)))
    const raw = await contract.getBalance()

    return Number(toDecimalString(raw, decimals))
}

// BigInt'i ONCE ondalik NOKTALI DIZGEYE cevirir, Number'a ANCAK EN SON o dizgeden gecilir.
// `Number(raw) / 10 ** decimals` (eski kod) raw'i BOLMEDEN ONCE Number'a cevirir; raw
// Number.MAX_SAFE_INTEGER'i (2^53-1, ~9e15) astiginda - 9 ondalikli bir jettonda bu yalnizca
// ~9 milyon token demektir, meme token'larda gercekci - bu donusum ZATEN yuvarlar ve
// sonraki bolme bu kaybi duzeltemez. tonBalance.js'teki fromNano + Number(...) deseniyle
// AYNI mantik (BigInt -> tam sayi dizgesi -> Number, tek seferde), keyfi ondalik icin
// genellestirildi: BigInt bolme/mod TAM SAYI oldugu icin kesin, tek yuvarlama Number(dize)
// adiminda (JS'in dize->double donusumu dogru-yuvarlanir) olur.
// DISA ACIK: takas yolu da ham cikti birimini kullaniciya gosterilecek ondalikli
// dizgeye cevirmek zorunda. swapValidation.js'teki toDecimalString FLOAT toFixed
// kullaniyor ve ham zincir birimleri icin GUVENLI DEGIL; dogru olan bu.
export function toDecimalString(raw, decimals) {
    const negative = raw < 0n
    const magnitude = negative ? -raw : raw
    const base = 10n ** BigInt(decimals)
    const whole = magnitude / base
    const frac = magnitude % base
    const fracDigits = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
    const value = fracDigits ? `${whole}.${fracDigits}` : `${whole}`
    return negative ? `-${value}` : value
}
