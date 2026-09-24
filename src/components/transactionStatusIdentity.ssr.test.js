// ISLEM KARTININ KIMLIK SATIRI ve AG LOGOSU -- kartin ISLENMIS HTML'i uzerinden.
//
// NEDEN BU DOSYA: TransactionStatus.vue bugun 371 satir ve render edilmis
// ciktisini dogrulayan TEK BIR test bile yok. Karttaki tum iddialar ya kaynak
// METNI okuyan tonFeeUiWiring.test.js'te ya da davranisi olcen
// transactionStatusAutoDismiss.ssr.test.js'te; ikisi de "kart kullaniciya NE
// SOYLUYOR" sorusunu sormuyor. Kart bes AYRI turu (Transaction/Swap/Bridge/
// Jetton/TonConnect) tek sablonla ciziyor ve bugun hepsi AYNI gorunuyor:
// "Gonderim 1" -- kime, hangi tokenla, hangi aga gittigi YAZMIYOR.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { useTransactionStore } from '../store/transaction.js'
import { shortenAddress } from '../utils/shortenAddress.js'
import { ALL_CHAINS } from '../data/chains.js'
import TransactionStatus from './TransactionStatus.vue'

const zincir = (id) => ALL_CHAINS.find((c) => String(c.chainId) === String(id))

const BNB = zincir(56)
const BASE = zincir(8453)
const TON = zincir(-239)

// EVM alicisi 6/4, TON alicisi 8/6 ile kisaltilir -- genislikler depoda
// YERLESIK (TonSendTx.vue:234, shortenAddress.js varsayilani). Beklenen dize
// ELLE yazilmaz, ayni utilden TURETILIR: kisaltma kurali degisirse testin
// degil utilin tek dogru olmasi icin.
const EVM_ALICI = '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b349f'
const TON_ALICI = 'EQC1x2Yj9kLmNoPqRsTuVwXyZ0123456789abcdefghij9f'
const EVM_KISA = shortenAddress(EVM_ALICI, 6, 4)
const TON_KISA = shortenAddress(TON_ALICI, 8, 6)

const GRAM_LOGO = 'https://logo.test/gram.png'
const USDT_LOGO = 'https://logo.test/usdt.png'

afterEach(() => {
    delete globalThis.chrome
})

// Kart yalniz liste BOS DEGILKEN ve kuculmemisken cizilir. Durum 'processing'
// secildi: 'success' kendiliginden kapanma sayacini kurar (txAutoDismiss) ve
// testin konusu o degil.
async function kartHtml(meta, status = 'processing') {
    const txs = [{ id: 'tx1', status, timestamp: 1, meta }]
    installChromeStub({ current_transactions: txs })
    const app = createApp(TransactionStatus)
    app.use(createTestPinia())
    app.use(createTestI18n('tr'))
    const store = useTransactionStore()
    store.transactions = txs
    return render(app)
}

const kez = (html, parca) => html.split(parca).length - 1

// KIMLIK SATIRININ KENDI DILIMI.
//
// `expect(html).toContain('USDT')` gibi iddialar kartin TAMAMINA bakiyordu ve
// sembol zaten MIKTAR satirinda, ag adi zaten BAGLAM satirinda geciyor: iddia
// kimlik satiri hic cizilmese bile yesil kaliyordu (inceleme bulgusu). Bu yuzden
// bilesenin koku `data-tx-identity` ile isaretli ve iddialar YALNIZ o dilimde
// yapiliyor. Satirin icinde `<div>` YOKTUR (TokenLogo dahil hepsi `<span>`), bu
// yuzden ilk `</div>` guvenle sinirdir.
// YORUMLAR ONCE ATILIR: SSR sablon yorumlarini da ciktiya basiyor, yani bir
// bilesenin ACIKLAMA metni iddialarin icine sizip onlari sessizce yaniltiyor
// (ornegin isaretcinin kendi adi yorumda gectigi icin satir "bulunmus" gorunur).
const kimlik = (html) => {
    const temiz = html.replace(/<!--[\s\S]*?-->/g, '')
    const i = temiz.indexOf('data-tx-identity')
    if (i === -1) return ''
    return temiz.slice(temiz.lastIndexOf('<div', i), temiz.indexOf('</div>', i) + 6)
}

// OLUMSUZ IDDIALAR ICIN: `kimlik()` satir hic cizilmediginde de BOS DIZE doner,
// yani `expect(satir).not.toContain(...)` satirin yoklugunda da yesil kalir --
// mutasyon sinamasinda (bilesenin tamami devre disi birakilarak) tam olarak bu
// gorundu. Satirin GERCEKTEN cizildigini once sabitler.
const cizilenKimlik = (html) => {
    const satir = kimlik(html)
    expect(satir, 'kimlik satiri HIC cizilmemis').not.toBe('')
    return satir
}

describe('kimlik satiri -- Transaction', () => {
    it('adres defterindeki AD varsa ad + kisa adres birlikte gorunur', async () => {
        const html = await kartHtml({
            chainId: 56, amount: '1', symbol: 'BNB', type: 'Transaction',
            recipient: EVM_ALICI, recipientLabel: 'Ahmet',
        })

        expect(html).toContain('Ahmet')
        // Ad VARKEN bile kisa adres KALIR: ad kullanicinin kendi etiketi,
        // adres ise dogrulanabilir olan sey.
        expect(html).toContain(EVM_KISA)
        expect(html).toContain('→')
    })

    it('ad YOKKEN yalniz kisa adres gorunur -- TAM adres ASLA basilmaz', async () => {
        const html = await kartHtml({
            chainId: 56, amount: '1', symbol: 'BNB', type: 'Transaction',
            recipient: EVM_ALICI,
        })

        expect(html).toContain(EVM_KISA)
        // 280px'lik icerik genisliginde 42 karakterlik adres satiri kirar.
        expect(html).not.toContain(EVM_ALICI)
    })

    // Kullanicinin acikca istedigi seylerden biri token ISMIYDI. Sembol zaten
    // MIKTAR satirinda duruyor; isim yalnizca bir `title` ozniteligine
    // dusuruldugunde ekranda HIC gorunmuyordu (inceleme bulgusu).
    it('token ADI ekranda GORUNUR, logoyla birlikte', async () => {
        const satir = kimlik(await kartHtml({
            chainId: 56, amount: '25', symbol: 'USDT', type: 'Transaction',
            tokenName: 'Tether USD', tokenLogo: USDT_LOGO,
            recipient: EVM_ALICI,
        }))

        expect(satir).toContain(USDT_LOGO)
        expect(satir).toContain('Tether USD')
    })

    it('token adi YOKKEN satir yine de alici gosterir', async () => {
        const satir = kimlik(await kartHtml({
            chainId: 56, amount: '25', symbol: 'USDT', type: 'Transaction',
            tokenLogo: USDT_LOGO, recipient: EVM_ALICI,
        }))

        expect(satir).toContain(EVM_KISA)
    })

    // OKSUZ OK: dapp islemlerinde meta'da token bilgisi HIC olmuyor (Dapp.vue
    // assetData gondermiyor) ve satir "→ 0x28C6...1d60" seklinde, okun SOLUNDA
    // hicbir sey olmadan ciziliyordu. Ok bir ILISKI isaretidir; tek tarafi
    // olmayan bir iliski yoktur.
    it('okun SOLUNDA bir sey yoksa ok cizilmez', async () => {
        const satir = kimlik(await kartHtml({
            chainId: 56, amount: '1', type: 'Transaction', recipient: EVM_ALICI,
        }))

        expect(satir).toContain(EVM_KISA)
        expect(satir).not.toContain('→')
    })

    // IKI `truncate` YARISIYOR: 280px'te ad ve etiket ayni anda uzunsa ikisi de
    // yariya iniyordu ("Wrapped Liq…" + "Binance Sicak…"). Etiket "kime"nin
    // cevabi ve kullanicinin KENDI verdigi ad; token zaten miktar satirinda
    // sembolüyle duruyor. Etiket varken ad basilmaz.
    it('adres defteri etiketi VARKEN token adi basilmaz', async () => {
        const satir = kimlik(await kartHtml({
            chainId: 56, amount: '25', symbol: 'USDT', type: 'Transaction',
            tokenName: 'Tether USD', recipientLabel: 'Ahmet', recipient: EVM_ALICI,
        }))

        expect(satir).toContain('Ahmet')
        expect(satir).not.toContain('Tether USD')
    })

    // Kirpilan metnin TAMI bir yerde okunabilmeli -- host'ta zaten boyle.
    it('kirpilan ad ve etiket title tasir', async () => {
        const adli = kimlik(await kartHtml({
            chainId: 56, amount: '25', symbol: 'USDT', type: 'Transaction',
            tokenName: 'Wrapped Liquid Staked Ether 2.0', recipient: EVM_ALICI,
        }))
        expect(adli).toContain('title="Wrapped Liquid Staked Ether 2.0"')

        const etiketli = kimlik(await kartHtml({
            chainId: 56, amount: '25', symbol: 'USDT', type: 'Transaction',
            recipientLabel: 'Binance Sicak Cuzdan', recipient: EVM_ALICI,
        }))
        expect(etiketli).toContain('title="Binance Sicak Cuzdan"')
    })

    // Kartta RENK yalniz durum satirinda olmali. Logo cozulemedinde TokenLogo
    // 8 renkli pastel paletten bir monogram rozeti ciziyor; 11px'lik SESSIZ
    // satirda bu, renk kuralini kartin icinde deliyordu. Ad zaten yaninda yazili.
    it('logo URL i YOKKEN renkli monogram rozeti cizilmez', async () => {
        const satir = kimlik(await kartHtml({
            chainId: 56, amount: '25', symbol: 'USDT', type: 'Transaction',
            tokenName: 'Tether USD', recipient: EVM_ALICI,
        }))

        expect(satir).toContain('Tether USD')
        // Palet tokenMark.js'ten AYNEN alindi: uydurma bir renk listesi, hicbir
        // sey eslemedigi icin bosuna gecen bir iddia uretirdi.
        expect(satir).not.toMatch(/bg-(blue|violet|amber|rose|cyan|indigo|teal|fuchsia)-100/)
    })
})

describe('kimlik satiri -- Swap', () => {
    it('iki token sembolu ve IKI logo satir ici cizilir', async () => {
        const satir = kimlik(await kartHtml({
            chainId: -239, amount: '5', type: 'Swap',
            fromSymbol: 'GRAM', fromLogo: GRAM_LOGO,
            toSymbol: 'USDT', toLogo: USDT_LOGO,
        }))

        expect(satir).toContain('GRAM')
        expect(satir).toContain('USDT')
        expect(satir).toContain(GRAM_LOGO)
        expect(satir).toContain(USDT_LOGO)
        // Yon oku olmadan "GRAM USDT" hangi yone gittigini soylemez.
        expect(satir).toContain('→')
    })

    // Tek tarafi cozulmus bir takas hangi yone gittigini soylemez; yarim bir ok
    // bilgi degil gurultudur.
    it('tek taraf cozulemezse satir HIC cizilmez', async () => {
        const satir = kimlik(await kartHtml({
            chainId: -239, amount: '5', type: 'Swap', fromSymbol: 'GRAM',
        }))

        expect(satir).toBe('')
    })

    // TON'un yerel para sembolu bu depoda GRAM'dir (Home.vue, ConfirmTransaction.vue,
    // TonSendTx.vue, supported_chains.json hepsi boyle yaziyor) -- kart meta'daki
    // sembolu OLDUGU GIBI basar, "TON"a CEVIRMEZ.
    it('GRAM sembolu oldugu gibi basilir, TON a CEVRILMEZ', async () => {
        const html = await kartHtml({
            chainId: -239, amount: '5', type: 'Swap',
            fromSymbol: 'GRAM', toSymbol: 'USDT',
        })

        expect(html).toContain('GRAM')
    })

    // Takasin ana tokeni MIKTAR satirinda birim olarak da gorunmeli: "Takas 12.5"
    // birimsiz bir sayidir ve kullanicinin sikayet ettigi tam olarak buydu.
    it('takasta miktarin BIRIMI de yazar', async () => {
        const html = await kartHtml({
            chainId: -239, amount: '5', type: 'Swap',
            symbol: 'GRAM', fromSymbol: 'GRAM', toSymbol: 'USDT',
        })

        expect(kez(html, 'GRAM')).toBeGreaterThanOrEqual(2)
    })
})

describe('kimlik satiri -- Bridge', () => {
    // KOPRUDE EKSEN AGDIR, TOKEN DEGIL. Ikisini birden basmak "BNB BNB Smart
    // Chain → ETH Base" uretiyordu: hem okunmuyor hem 280px'e sigmiyordu
    // (inceleme bulgusu). Token zaten miktar satirinda birim olarak duruyor.
    it('KAYNAK ve HEDEF agin ADI ve LOGOSU cizilir', async () => {
        const satir = kimlik(await kartHtml({
            chainId: 56, amount: '10', type: 'Bridge',
            toChainId: 8453, symbol: 'BNB',
        }))

        expect(satir).toContain(BNB.name)
        expect(satir).toContain(BNB.logoURI)
        expect(satir).toContain(BASE.name)
        expect(satir).toContain(BASE.logoURI)
        expect(satir).toContain('→')
    })

    it('kimlik satirinda TOKEN sembolu YAZMAZ -- eksen ag', async () => {
        // `cizilenKimlik`: iddia YALNIZ olumsuz, satir hic cizilmese de yesil
        // kalirdi. Once satirin GERCEKTEN cizildigi sabitlenir.
        const satir = cizilenKimlik(await kartHtml({
            chainId: 56, amount: '10', type: 'Bridge',
            toChainId: 8453, symbol: 'BNB', fromSymbol: 'BNB', toSymbol: 'ETH',
        }))

        expect(satir).not.toContain('ETH')
    })

    // toChainId metin yazimiyla da gelebilir; === ve Number() ikisi de sessizce
    // yanlis sonuc verir (bkz. utils/vm.js isSameChainId).
    it('toChainId METIN yazimiyla gelse de cozulur', async () => {
        const satir = kimlik(await kartHtml({
            chainId: 56, amount: '10', type: 'Bridge', toChainId: '8453',
        }))

        expect(satir).toContain(BASE.name)
    })

    // Hedef ag COZULEMEZSE tek tarafli bir ok basmak yerine satir hic cizilmez:
    // "BNB Smart Chain →" kullaniciya nereye gittigini soylemez.
    it('hedef ag YOKKEN satir HIC cizilmez', async () => {
        const satir = kimlik(await kartHtml({ chainId: 56, amount: '10', type: 'Bridge' }))
        expect(satir).toBe('')
    })
})

describe('kimlik satiri -- Jetton', () => {
    it('TON alicisi 8/6 genisligiyle kisaltilir', async () => {
        const html = await kartHtml({
            chainId: -239, amount: '3', symbol: 'USDT', type: 'Jetton',
            recipient: TON_ALICI, tokenName: 'Tether USD', tokenLogo: USDT_LOGO,
        })

        expect(html).toContain(TON_KISA)
        expect(html).not.toContain(TON_ALICI)
        expect(html).toContain('→')
    })
})

describe('kimlik satiri -- TonConnect', () => {
    it('dapp alan adi ve alici birlikte gorunur', async () => {
        const satir = kimlik(await kartHtml({
            chainId: -239, amount: '0.5', symbol: 'GRAM', type: 'TonConnect',
            dappHost: 'getgems.io', recipient: TON_ALICI, msgCount: 1,
        }))

        expect(satir).toContain('getgems.io')
        expect(satir).toContain(TON_KISA)
        expect(satir).toContain('·')
    })

    // CSS `truncate` SONDAN kirpar ve alan adinin ayirt edici parcasi tam da
    // sonda durur: "app.marketplace.get…" kullaniciya hangi siteye baktigini
    // SOYLEMEZ (inceleme bulgusu). Kirpma BASTAN yapilir (utils/shortHost.js).
    it('uzun alan adinda KAYITLI alan adi gorunur kalir', async () => {
        const satir = kimlik(await kartHtml({
            chainId: -239, amount: '0.5', symbol: 'GRAM', type: 'TonConnect',
            dappHost: 'cok-uzun-bir-alt-alan.baska-alt-alan.getgems.io',
            recipient: TON_ALICI, msgCount: 1,
        }))

        // GORUNEN METIN olculur, ham HTML degil: tam alan adi `title` ozniteliginde
        // BILEREK duruyor (uzerine gelince okunur), kirpilan yalniz gosterimdir.
        const metin = satir.replace(/<[^>]+>/g, ' ')
        expect(metin).toContain('getgems.io')
        expect(metin).not.toContain('cok-uzun-bir-alt-alan.baska-alt-alan.getgems.io')
        expect(satir).toContain('title="cok-uzun-bir-alt-alan.baska-alt-alan.getgems.io"')
    })

    // Toplu gonderimde kart TEK bir alici gosterirken geri kalan mesajlari
    // SAKLAMIS olur -- sayi yazilmazsa kullanici tek islem onayladigini sanir.
    it('msgCount > 1 iken mesaj SAYISI yazilir', async () => {
        const html = await kartHtml({
            chainId: -239, amount: '0.5', symbol: 'GRAM', type: 'TonConnect',
            dappHost: 'getgems.io', recipient: TON_ALICI, msgCount: 4,
        })

        expect(html).toContain('4 mesaj')
    })

    it('msgCount === 1 iken sayi YAZILMAZ -- tek mesajda "1 mesaj" gurultudur', async () => {
        const html = await kartHtml({
            chainId: -239, amount: '0.5', symbol: 'GRAM', type: 'TonConnect',
            dappHost: 'getgems.io', recipient: TON_ALICI, msgCount: 1,
        })

        expect(html).not.toContain('1 mesaj')
    })
})

describe('baglam satiri -- ag logosu', () => {
    it('ag logosu ag ADININ SOLUNDA cizilir', async () => {
        const html = await kartHtml({ chainId: 56, amount: '1', type: 'Transaction' })

        const logoIdx = html.indexOf(BNB.logoURI)
        const adIdx = html.indexOf(BNB.name)
        expect(logoIdx, 'ag logosu HIC cizilmiyor').toBeGreaterThan(-1)
        expect(adIdx, 'ag adi HIC cizilmiyor').toBeGreaterThan(-1)
        expect(logoIdx).toBeLessThan(adIdx)
    })

    it('TON aginda da logo cizilir', async () => {
        const html = await kartHtml({ chainId: -239, amount: '1', type: 'Transaction' })
        expect(html).toContain(TON.logoURI)
    })

    // '/default-chain.png' dosyasi GERCEKTEN YOK (client/public altinda o isimde
    // bir sey bulunmuyor): bilinmeyen bir ag icin o yolu basmak KIRIK RESIM
    // cizer. Kart yedegi ACIKCA null verip TokenLogo monogramina dusmeli.
    it('bilinmeyen ag KIRIK RESIM degil monogram cizer', async () => {
        const html = await kartHtml({ chainId: 999999, amount: '1', type: 'Transaction' })
        expect(html).not.toContain('default-chain')
    })
})

// KRITIK REGRESYON: butun yeni alanlar ISTEGE BAGLI. Eski kayitlar (ve
// transactionStatusAutoDismiss.ssr.test.js'in fiksturu) bu alanlarin HICBIRINI
// tasimiyor; yeni baglamalar v-if / ?. ile korunmazsa o kayitlar ya patlar ya
// da ekrana "undefined" basar.
describe('yeni alanlarin HICBIRI yokken kart YINE DE render olur', () => {
    const ESKI_META = { chainId: 56, amount: '1', type: 'Transaction' }

    it('render patlamaz ve tur etiketi ile miktar hala gorunur', async () => {
        const html = await kartHtml(ESKI_META)

        expect(html).toContain('Gönderim')
        expect(html).toContain('>1<')
    })

    it('bos kimlik satiri ok/ayrac ARTIGI birakmaz', async () => {
        const html = await kartHtml(ESKI_META)

        expect(html).not.toContain('→')
        expect(html).not.toContain('·')
    })

    it('hicbir yere "undefined" / "null" sizmaz', async () => {
        const html = await kartHtml(ESKI_META)

        expect(html).not.toContain('undefined')
        expect(html).not.toContain('>null<')
    })

    it('bes turun HEPSI bos meta ile render olur', async () => {
        for (const type of ['Transaction', 'Swap', 'Bridge', 'Jetton', 'TonConnect']) {
            const html = await kartHtml({ chainId: 56, amount: '1', type })
            expect(html, type + ' bos meta ile cizilmedi').toContain('<article')
            expect(html, type + ' undefined sizdirdi').not.toContain('undefined')
        }
    })
})

// NOT: burada bir zamanlar "TransactionStatus.vue TxIdentityLine.vue'yi import
// eder" testi vardi. Bilesen sablondan TAMAMEN silinse bile gecerdi (import
// satiri kalir), yani hicbir sey korumuyordu -- yukaridaki render testleri
// bilesenin GERCEKTEN cizildigini zaten kanitliyor. Dosya buyuklugu kaygisinin
// yeri test degil, incelemedir.
