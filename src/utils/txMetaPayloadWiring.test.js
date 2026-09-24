import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Kart alanlarinin KAYNAGI: arayuzun arka plana gonderdigi mesaj govdesi.
 *
 * Arka plan yalnizca kendisine VERILENI yazabilir. background.txMeta.test.js ve
 * background.tonTxMeta.test.js "gelen veri meta'ya yaziliyor mu" sorusunu
 * davranisla olcuyor; bu dosya bir onceki halkayi kilitler: veri gercekten
 * gonderiliyor mu. Ikisi olmadan ozellik test yesilken OLU kalabilir - bu depoda
 * tam olarak o yasandi (O3 dersi, jettonSendWiring.test.js basi).
 *
 * Bu testler YORUM METNINI eslemez (codeOnly) ve SABIT UZUNLUKLU pencere
 * kullanmaz: her esleme ilgili mesaj govdesinin kendi araligindan okunur.
 */

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const codeOnly = (src) => src
    .split('\n')
    .filter((line) => {
        const t = line.trim()
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('<!--')
    })
    .join('\n')

const SWAP = codeOnly(read('../components/Swap.vue'))
const BRIDGE = codeOnly(read('../components/Bridge.vue'))
const CONFIRM = codeOnly(read('../components/ConfirmTransaction.vue'))
const TON_SEND_TX = codeOnly(read('../components/dapp/TonSendTx.vue'))

// Iki isaret arasindaki GERCEK araligi verir. Sabit uzunluklu pencere yerine
// govdenin kendi siniri kullanilir; araya satir eklenmesi testi bozmaz.
// BITIS ISARETI DE ZORUNLU: bulunamadiginda sessizce DOSYA SONUNA kadar okumak,
// "govde" diye dosyanin tamamini olcmek demekti -- o halde her iddia dosyanin
// herhangi bir yerinden beslenip yesil kaliyordu (inceleme bulgusu).
const between = (src, from, to) => {
    const start = src.indexOf(from)
    expect(start, `baslangic bulunamadi: ${from}`).toBeGreaterThan(-1)
    const end = src.indexOf(to, start)
    expect(end, `bitis bulunamadi: ${to}`).toBeGreaterThan(start)
    return src.slice(start, end)
}

describe('Takas gonderimi token kimligini tasir', () => {
    // SWAP_QUOTE govdesi (getSwapData) AYRI bir mesaj kurar; olculen govde
    // Onayla akisindaki olan, yani `swap_slippage` okumasindan sonraki.
    const body = () => between(SWAP, "const { swap_slippage, active_account }", 'await chrome.runtime.sendMessage')

    it('kaynak ve hedef token kayitlari mesaja konur', () => {
        expect(body()).toMatch(/inTokenData:\s*crypto\.swap\.inToken/)
        expect(body()).toMatch(/outTokenData:\s*crypto\.swap\.outToken/)
    })

    // BEKLENEN CIKTI GONDERILMEZ. Kartta gosterilen sey yalnizca TEKLIFTI
    // (gerceklesen cikti hicbir yolda okunmuyor) ve etiketlense bile kullanici
    // onu alinan miktar sanmaya acikti; ustelik 280px'lik satirda tasmayi
    // tetikleyen parcaydi. Gonderilmedigini SABITLIYORUZ: geri sizarsa kirmizi.
    it('beklenen cikti mesaja KONMAZ', () => {
        expect(body()).not.toContain('expectedOut')
    })
})

describe('Kopru gonderimi HEDEF AGI tasir', () => {
    const body = () => between(BRIDGE, 'const fromChainId = bridgeData.value.action.fromChainId', 'await chrome.runtime.sendMessage')

    // GERCEK EKSIK BUYDU: payload yalnizca `chain` (kaynak ag) tasiyordu, hedef
    // ag HIC gonderilmiyordu - kart "nereye" sorusunu cevaplayamiyordu.
    it('hedef ag kimligi mesaja konur', () => {
        expect(body()).toMatch(/toChain:\s*bridgeData\.value\.action\.toChainId/)
    })

    // Yalniz KAYNAK token: sembolu miktar satirinin birimi olarak kullaniliyor.
    // Hedef token kaydi kartta HIC okunmuyor (koprude eksen AGDIR), gondermek
    // depoya okunmayan alan yazmak olurdu.
    it('yalniz kaynak token kaydi mesaja konur', () => {
        expect(body()).toMatch(/fromTokenData:\s*bridgeData\.value\.action\.fromToken/)
        expect(body()).not.toContain('toTokenData')
    })

    it('beklenen cikti mesaja KONMAZ', () => {
        expect(body()).not.toContain('expectedOut')
    })
})

describe('EVM gonderimi adres defteri etiketini tasir', () => {
    const body = () => between(CONFIRM, 'type: "SEND_TRANSACTION"', '})')

    // `assetData` ZATEN gonderiliyor; eksik olan, ekranda gosterilen etiketti.
    it('assetData ve toLabel birlikte gonderilir', () => {
        expect(body()).toContain('assetData: crypto.sendAsset')
        expect(body()).toMatch(/toLabel:\s*crypto\.transactionData\.toLabel/)
    })
})

describe('Jetton gonderimi token kaydini tasir', () => {
    const body = () => between(CONFIRM, 'type: "SEND_TON_JETTON"', 'type: "SEND_TON_TRANSACTION"')

    // master/decimals/symbol zaten gidiyor ama LOGO ve TAM AD gitmiyor: kart
    // jetton satirini gri yer tutucuyla cizerdi.
    it('assetData mesaja konur', () => {
        expect(body()).toContain('assetData: crypto.sendAsset')
    })
})

describe('TonConnect gonderimi dapp alan adini tasir', () => {
    const body = () => between(TON_SEND_TX, "type: 'TON_DAPP_SEND'", '})')

    // Alan adi arka planda BILINMIYOR: istek onay penceresinden geliyor, gonderen
    // sekme degil. Arayuz tasimazsa kart "hangi dapp" sorusunu hic cevaplayamaz.
    it('hostname dappHost olarak gonderilir', () => {
        expect(body()).toMatch(/dappHost:\s*hostname\.value/)
    })
})
