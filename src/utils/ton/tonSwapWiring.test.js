import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// TON takas akisinin BAGLANTI testleri.
//
// Saf katmanlar (tonSwap.js yedi kapi, tonSwapQuote.js dogrulama) kendi
// dosyalarinda test ediliyor. Ama dogru calisan bir kapi CAGRILMAZSA hicbir sey
// yapmaz - bu depoda tam olarak bu yasandi (K1: jetton satirindaki Gonder
// duğmesi sessizce native TON gonderiyordu).
//
// O3 DERSI: bu testler YORUM METNINI eslemez. Her esleme CAGRILABILIR bir
// ifadeyi hedefler ve kritik olanlarda ayrica onu KORUYAN KAPI dogrulanir.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const codeOnly = (src) => src
    .split('\n')
    .filter((line) => {
        const t = line.trim()
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('<!--')
    })
    .join('\n')

const BACKGROUND = read('../../background.js')
const BG = codeOnly(BACKGROUND)

describe('TON dali PROVIDER KURULMADAN ONCE ayrilir', () => {
    // TON kaydinin `rpc` dizisi BOS. Dallanma provider'dan sonra olsaydi
    // `found.rpc[0].url` TypeError firlatirdi ve ozellik ILK CAGRIDA patlardi.
    // Bu, akis kapisi (chainKind.js) TON takasa acildigi ANDAN itibaren canli
    // bir hata olurdu.
    for (const [fn, call] of [
        ['swapQuote', 'tonSwapQuoteInternal(message, sendResponse)'],
        ['swap', 'tonSwapExecute(message, txId)'],
    ]) {
        it(`${fn}: TON dali JsonRpcProvider dan ONCE`, () => {
            const start = BG.indexOf(`async function ${fn}(`)
            expect(start).toBeGreaterThan(-1)
            const tonAt = BG.indexOf(call, start)
            const providerAt = BG.indexOf('new ethers.JsonRpcProvider', start)
            expect(tonAt).toBeGreaterThan(-1)
            expect(providerAt).toBeGreaterThan(-1)
            expect(tonAt).toBeLessThan(providerAt)
        })
    }

    // Guvenlik kapisi ATLANMAMALI: TON dali assertChainFlow'dan SONRA gelmeli.
    // Once gelseydi TON, akis kapisinin ikinci savunma katmanini atlardi.
    for (const fn of ['swapQuote', 'swap']) {
        it(`${fn}: TON dali assertChainFlow tan SONRA - kapi atlanmiyor`, () => {
            const start = BG.indexOf(`async function ${fn}(`)
            const gateAt = BG.indexOf("assertChainFlow(found, 'swap')", start)
            const tonAt = BG.indexOf('if (isTon(chainId))', start)
            expect(gateAt).toBeGreaterThan(-1)
            expect(tonAt).toBeGreaterThan(gateAt)
        })
    }
})

describe('teklif yolu bagli', () => {
    it('saf teklif modulu cagriliyor', () => {
        expect(BACKGROUND).toContain("import { getTonSwapQuote } from './utils/ton/tonSwapQuote'")
        expect(BG).toContain('await getTonSwapQuote({')
    })

    // Arayuz kaymayi YUZDE gonderiyor (0.5 = %0.5), teklif ucu ORAN bekliyor.
    // Cevrilmezse kullanici %0.5 isterken %50 kayma ile takas ederdi - yuz kat.
    it('kayma YUZDEDEN ORANA cevriliyor', () => {
        expect(BG).toContain('Number(msg.slippage) / 100')
    })

    // Arayuz insan-okur ondalik gonderiyor ('1.5'), teklif ucu ham tamsayi
    // bekliyor. Donusum DIZE TABANLI olmali - kayan nokta carpimi miktari
    // sessizce degistirir (P2'de 2.675 @ 2 ondalik 268 cikiyordu, 267 degil).
    it('miktar DIZE TABANLI donusumle ham birime cevriliyor', () => {
        expect(BG).toContain('decimalToRawUnits(msg.amount, offerAsset.decimals)')
    })

    // Ondalik VARSAYILMAZ. Jettonlar 9 ondalik degildir (USDT-TON 6); bir
    // varsayilan gosterilen ciktiyi 1000 kat yanlis yapar ve kullanici o rakama
    // bakarak takas onaylar.
    it('ondalik icin YEDEK DEGER kullanilmiyor', () => {
        expect(BG).toContain("throw new Error('JETTON_DECIMALS_MISSING')")
        expect(BG).not.toMatch(/inDecimals\s*\|\|\s*\d/)
        expect(BG).not.toMatch(/outDecimals\s*\|\|\s*\d/)
    })
})

describe('yanit sekli EVM ile AYNI', () => {
    // Arayuz (Swap.vue) saglayiciyi HIC bilmiyor; bu dort alani okuyor. Sekil
    // ayrisirsa takas ekrani TON'da bos gorunur ve sebebi hicbir yerde cikmaz.
    it('arayuzun OKUDUGU dort alan uretiliyor', () => {
        for (const field of ['expectedOutput', 'exchangeRate', 'depthGateWarning', 'estimatedGasFee']) {
            expect(BG, field).toContain(`${field}`)
        }
        expect(BG).toContain('totalCost: String(TON_SWAP_GAS_DISPLAY)')
    })

    // Kapilar (tazelik, cift eslesmesi) teklif NESNESI olmadan calisamaz;
    // Gorev 10 bunu geri gonderiyor.
    it('teklif nesnesi arayuze GERI TASINIYOR', () => {
        expect(BG).toContain('tonQuote: quote')
    })
})

describe('gerceklestirme yolu bagli', () => {
    it('saf takas modulu cagriliyor', () => {
        expect(BACKGROUND).toContain("import { sendTonSwap, MAX_PRICE_IMPACT } from './utils/ton/tonSwap'")
        expect(BG).toContain('await sendTonSwap({')
    })

    // Teklif nesnesi kapilara ULASMALI: ulasmazsa tazelik ve cift eslesmesi
    // kapilari undefined gorup her seyi reddeder ya da (daha kotusu) atlanir.
    it('teklif kapilara GECIRILIYOR', () => {
        expect(BG).toContain('quote: msg.tonQuote')
    })

    // SDK fabrikalari disaridan veriliyor (saf katman test edilebilir kalsin diye);
    // gecirilmezse sendTonSwap router kuramaz.
    it('SDK fabrikalari GECIRILIYOR', () => {
        expect(BACKGROUND).toContain("import { routerFactory, dexFactory } from '@ston-fi/sdk'")
        expect(BG).toContain('routerFactory, dexFactory,')
    })

    // Fiyat etkisi onayi kullanicidan gelir; sabit true gecilirse kapi olur.
    it('fiyat etkisi onayi MESAJDAN geliyor - sabitlenmemis', () => {
        expect(BG).toContain('priceImpactAcknowledged: Boolean(msg.priceImpactAcknowledged)')
    })

    it('gecmis kaydi Swap tipiyle yaziliyor', () => {
        expect(BG).toContain("type: 'Swap'")
    })
})

describe('hata yolu', () => {
    // MUTASYON BOSLUGU: bu iddia once TUM dosyada araniyordu ve ayni dize native
    // TON ile jetton gonderim yollarinda da geciyor - takas yolundan SILINSE bile
    // test yesil kaliyordu. Yani test bu yolu degil KOMSULARINI olcuyordu.
    // Kapsam artik yalnizca TON takas teklifi fonksiyonunun GOVDESI.
    const quoteFn = (() => {
        const start = BG.indexOf('async function tonSwapQuoteInternal(')
        const end = BG.indexOf('async function tonSwapExecute(', start)
        return BG.slice(start, end)
    })()

    it('takas yolunun govdesi cozulebildi', () => {
        expect(quoteFn.length).toBeGreaterThan(200)
    })

    // Ham anahtar SIZMAZ: native TON/jetton yollariyla AYNI tablo ve AYNI yedek.
    it('hata mesaji eslenmis, ham anahtar degil', () => {
        expect(quoteFn).toContain('TON_SEND_ERROR_MESSAGES[error.message] || TON_SEND_ERROR_FALLBACK')
    })

    // EVM kolu hata TURUNU metin icerigiyle ayirt ediyor; TON makine anahtari
    // kullaniyor. `code` EK alan olarak tasiniyor - EVM kolu onu hic yazmiyor,
    // yani mevcut davranis degismiyor.
    it('makine anahtari EK alan olarak tasiniyor', () => {
        expect(quoteFn).toContain('code: error.message')
    })
})

// ---------------------------------------------------------------------------
// ARAYUZ BAGLANTISI (Swap.vue)
//
// Kapilar dogru calissa da arayuz onlara gereken veriyi GONDERMEZSE hicbir sey
// yapmaz. Testler CAGRILABILIR ifadeyi ve onu KORUYAN KAPIYI esler.
// ---------------------------------------------------------------------------
const SWAP_VUE = codeOnly(read('../../components/Swap.vue'))

describe('Swap.vue — teklif istegi', () => {
    // Ondalik gonderilmezse arka plan JETTON_DECIMALS_MISSING ile reddeder ve
    // TON'da takas HIC calismaz. Yedek deger de KULLANILMAZ - bir varsayilan
    // gosterilen ciktiyi 1000 kat yanlis yapar (USDT-TON 6 ondalik).
    // MUTASYON BOSLUGU: bu iddia once yalnizca dizenin VARLIGINI ariyordu, ama
    // ayni satir GONDERIM mesajinda da geciyor - teklif yolundan silinse bile
    // test yesil kaliyordu. Iki yolun IKISI DE ondalik gondermek zorunda:
    // teklif icin gosterilen cikti, gonderim icin ham birim cevrimi.
    it('ondaliklar HER IKI mesaja da KONULUYOR - teklif ve gonderim', () => {
        const inCount = (SWAP_VUE.match(/message\.inDecimals = crypto\.swap\.inToken\?\.decimals/g) || []).length
        const outCount = (SWAP_VUE.match(/message\.outDecimals = crypto\.swap\.outToken\?\.decimals/g) || []).length
        expect(inCount).toBe(2)
        expect(outCount).toBe(2)
    })

    it('ondalik icin YEDEK DEGER kullanilmiyor', () => {
        expect(SWAP_VUE).not.toMatch(/inToken\?\.decimals\s*\|\|\s*\d/)
        expect(SWAP_VUE).not.toMatch(/outToken\?\.decimals\s*\|\|\s*\d/)
    })

    // Bu alanlar YALNIZCA TON'da eklenmeli: EVM kolunun mesaji degismemeli.
    it('TON alanlari isTonNetwork kapisinin ARDINDA', () => {
        const at = SWAP_VUE.indexOf('message.inDecimals')
        const guardAt = SWAP_VUE.lastIndexOf('if (', at)
        expect(SWAP_VUE.slice(guardAt, SWAP_VUE.indexOf(')', guardAt) + 1)).toBe('if (isTonNetwork.value)')
    })
})

describe('Swap.vue — TON bakiye kontrolu ethers KURMUYOR', () => {
    // `network.rpc` TON'da null ve ethers v6 JsonRpcProvider(null) SESSIZCE
    // localhost:8545'e duser: gorunmeyen, hicbir zaman cevap vermeyecek bir
    // cagri. Bu, akis kapisi acildigi ANDAN itibaren canli bir hataydi.
    // Eskiden burada dosya SIRASI olculuyordu: ilk getTonBalance, ilk
    // JsonRpcProvider'dan once mi. O olcum bir VEKILDI ve ekrana ikinci bir
    // provider eklenince (yuzde ciplerinin gaz payi) yanlis alarm verdi -
    // oysa yeni provider TON'da erisilemez bir dalda duruyordu.
    //
    // Olculen sey artik degismezin KENDISI: provider kuran her yolda, AYNI
    // fonksiyon icinde ve provider'dan ONCE bir isTonNetwork kapisi olmali.
    // Bu hem eski hatayi yakalar hem de siraya bagli degil.
    it('provider kuran HER yol once isTonNetwork kapisindan geciyor', () => {
        const NEEDLE = 'new ethers.JsonRpcProvider(network.rpc)'

        // `<script setup>` icindeki ust seviye tanimlar sutun 0'da baslar.
        const enclosingBody = (at) => {
            const start = Math.max(
                SWAP_VUE.lastIndexOf('\nconst ', at),
                SWAP_VUE.lastIndexOf('\nasync function ', at),
                SWAP_VUE.lastIndexOf('\nfunction ', at),
            )
            return SWAP_VUE.slice(start, at)
        }

        const spots = []
        for (let at = SWAP_VUE.indexOf(NEEDLE); at !== -1; at = SWAP_VUE.indexOf(NEEDLE, at + 1)) spots.push(at)

        // Once VARLIK: butun provider kurulumlari silinirse dongu bos gecer ve
        // test anlamsizca yesil kalirdi.
        expect(spots.length).toBeGreaterThan(0)

        for (const at of spots) expect(enclosingBody(at)).toContain('isTonNetwork')
    })

    // TON bakiye kontrolu hala TON istemcisiyle yapiliyor - ethers'la degil.
    it('TON bakiyesi TON istemcisinden okunur', () => {
        expect(SWAP_VUE).toContain('getTonBalance(getTonClient(config.api)')
    })

    // MUTASYON BOSLUGU: yukaridaki sira testi, dali OLU HALE GETIREN bir
    // degisikligi (kosulu `false` yapmak) goremiyordu - metin yerinde kaliyor ve
    // sira bozulmuyor. Kapinin KENDISI dogrulaniyor.
    it('TON bakiye dali GERCEKTEN isTonNetwork kapisinin ardinda', () => {
        const at = SWAP_VUE.indexOf('getTonBalance(getTonClient(config.api)')
        const guardAt = SWAP_VUE.lastIndexOf('if (', at)
        const guard = SWAP_VUE.slice(guardAt, SWAP_VUE.indexOf(') {', guardAt) + 1)
        expect(guard).toContain('isTonNetwork.value')
    })

    // FAIL-CLOSED: bakiye okunamadiysa yeterli oldugunu BILMIYORUZ. Bir
    // RPC/kasa hiccup'i takas dugmesini ACMAMALI.
    it('bakiye okunamazsa dugme KAPALI kalir', () => {
        const at = SWAP_VUE.indexOf("console.error('TON bakiye kontrolu basarisiz:")
        expect(at).toBeGreaterThan(-1)
        expect(SWAP_VUE.slice(at, at + 200)).toContain('insufficientGas.value = true')
    })

    // GASLESS bir EVM paymaster akisi; TON'da kavram yok.
    it('GASLESS kesfi TON da CALISMAZ', () => {
        expect(SWAP_VUE).toContain('if (!isTonNetwork.value && isGaslessChain(')
    })
})

describe('Swap.vue — gonderim', () => {
    // Kapilar (tazelik, cift eslesmesi) teklif NESNESI olmadan calisamaz.
    it('teklif nesnesi gonderim mesajina KONULUYOR', () => {
        expect(SWAP_VUE).toContain('message.tonQuote = swapData.value?.tonQuote')
    })

    it('fiyat etkisi onayi KULLANICIDAN geciriliyor - sabitlenmemis', () => {
        expect(SWAP_VUE).toContain('message.priceImpactAcknowledged = priceImpactAcknowledged.value')
        expect(SWAP_VUE).not.toContain('message.priceImpactAcknowledged = true')
    })
})

describe('Swap.vue — fiyat etkisi kapisi', () => {
    // Onay verilene kadar Takas dugmesi KILITLI olmali; aksi halde uyari
    // yalnizca bir suslemedir.
    it('onaysiz yuksek fiyat etkisi dugmeyi KILITLER', () => {
        expect(SWAP_VUE).toContain('!(priceImpactHigh.value && !priceImpactAcknowledged.value)')
    })

    // Onay HER YENI TEKLIFTE dusmeli: onceki teklif icin verilen onay yenisine
    // tasinirsa kapi hic sorulmadan acilmis olur.
    it('yeni teklif onayi DUSURUR', () => {
        const at = SWAP_VUE.indexOf('swapData.value = data.data')
        expect(at).toBeGreaterThan(-1)
        expect(SWAP_VUE.slice(at, at + 160)).toContain('priceImpactAcknowledged.value = false')
    })

    // Esik TEK YERDE (tonSwap.js MAX_PRICE_IMPACT); arayuz onu yeniden
    // hesaplamiyor, arka planin `depthGateWarning` bayragini okuyor. Iki ayri
    // esik, birinin degisip digerinin degismemesi demektir.
    it('esik arayuzde YENIDEN HESAPLANMIYOR', () => {
        expect(SWAP_VUE).toContain("swapData.value?.depthGateWarning === true")
        expect(SWAP_VUE).not.toContain('MAX_PRICE_IMPACT')
    })
})

describe('Swap.vue — hata siniflandirmasi', () => {
    // TON makine anahtari kullaniyor, EVM serbest metin. `code` ONCE okunmali;
    // sonra bakilsaydi TON hatalari EVM metin eslemesine dusup 'unknown' olurdu.
    it('TON makine anahtari EVM metin eslemesinden ONCE okunur', () => {
        const codeAt = SWAP_VUE.indexOf("data.code === 'TON_SWAP_NO_ROUTE'")
        const textAt = SWAP_VUE.indexOf('data.error.includes(LIQUIDITY_GATE_ERROR)')
        expect(codeAt).toBeGreaterThan(-1)
        expect(textAt).toBeGreaterThan(-1)
        expect(codeAt).toBeLessThan(textAt)
    })
})
