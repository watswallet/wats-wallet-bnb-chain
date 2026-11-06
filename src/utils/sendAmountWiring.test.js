import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// DOLAR GIRISI + YUZDE CIPLERI - BAGLANTI TESTLERI.
//
// Saf katmanlar (assetPrice.js, sendPercent.js) kendi dosyalarinda test ediliyor.
// Burasi cagrilarin GERCEKTEN yerinde oldugunu ve para yolunun bozulmadigini olcer.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const codeOnly = (src) => src
    .split('\n')
    .filter((line) => {
        const t = line.trim()
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('<!--')
    })
    .join('\n')

const SEND_RAW = read('../components/Send.vue')
const SEND = codeOnly(SEND_RAW)
const EN = JSON.parse(read('../i18n/locales/en.json'))
const TR = JSON.parse(read('../i18n/locales/tr.json'))

describe('fiyat TEK kapidan okunur', () => {
    it('assetPriceUSD kullanilir', () => {
        expect(SEND).toContain('assetPriceUSD(crypto.sendAsset)')
    })

    // HATANIN TA KENDISI: dogrudan `market.priceUSD` okumak, Token.vue'nun
    // `market_data` tasiyan kaydinda fiyati bulamiyor ve "$0.00" yaziyordu.
    it('market.priceUSD DOGRUDAN okunmaz', () => {
        expect(SEND).not.toContain('market?.priceUSD')
        expect(SEND).not.toContain('market.priceUSD')
    })

    // "Dolar" girisi artik SECILI BIRIMLE giris: kapi birim basina fiyatta
    // (priceUSD x kur). Kur uygulanamiyorsa fiat girisi acilamaz.
    it('fiyat yoksa fiat girisi kapali', () => {
        expect(SEND).toContain('const unitPriceFiat = computed(() => fiatPrice(price.value))')
        expect(SEND).toContain('const hasPrice = computed(() => unitPriceFiat.value !== null)')
        expect(SEND).toContain(':disabled="!hasPrice"')
    })
})

describe('gonderilen miktar HER ZAMAN token cinsinden', () => {
    // En pahali hata sinifi: dolar kutusuna yazilan sayinin token miktari
    // sanilmasi. Kullanici "100" yazar, cuzdan 100 TOKEN gonderir.
    it('kutu ham metne baglanir, token miktarina DEGIL', () => {
        expect(SEND).toContain(':value="rawInput"')
        expect(SEND).toContain('@input="onAmountInput"')
        expect(SEND).not.toContain('v-model="amount"')
    })

    it('gonderilecek miktar ham metinden TURETILIR', () => {
        const at = SEND.indexOf('const amount = computed(() => {')
        expect(at).toBeGreaterThan(-1)
        const body = SEND.slice(at, SEND.indexOf('})', at))
        expect(body).toContain("if (inputMode.value !== 'usd') return trimDecimalTail(rawInput.value)")
        expect(body).toContain('usdToToken(rawInput.value, unitPriceFiat.value, crypto.sendAsset?.decimals)')
        // Dogrudan USD fiyatiyla cevirmek TRY yazan kutuyu dolar sanirdi.
        expect(body).not.toContain('price.value,')
    })

    // Turetilmis olmasi cevrimi TEK yere hapseder. Ikinci bir cagri, bir kod
    // yolunun token -> dolar -> token gidip gelmesine ve degerin oynamasina
    // izin verirdi; %100'de bu, harcanabilirin USTUNE cikmak demektir.
    it('usdToToken BASKA hicbir yerde cagrilmaz', () => {
        expect(SEND.split('usdToToken(').length - 1).toBe(1)
    })

    // `amount` turetilmis: hicbir yerde ATANMAMALI. Atama, kutuyla gonderilen
    // deger arasindaki bagi koparir.
    it('miktar hicbir yerde dogrudan ATANMAZ', () => {
        expect(SEND).not.toContain('amount.value =')
    })

    // Programatik yazma (yuzde cipleri, birim degisimi) dolar tarafinda ASAGI
    // kirpan yolu kullanir; yukari yuvarlanan bir dolar, token'a geri
    // cevrildiginde bakiyeyi asardi.
    it('programatik yazma asagi kirpan yolu kullanir', () => {
        const at = SEND.indexOf('const writeTokenAmount = (tokenAmount) => {')
        expect(at).toBeGreaterThan(-1)
        const body = SEND.slice(at, SEND.indexOf('}', at))
        expect(body).toContain('tokenToUsdInput(tokenAmount, unitPriceFiat.value)')
        expect(body).not.toContain('usdToToken(')
    })

    // Onay ekranina giden deger hala token miktari; bu satir degistiyse
    // yukaridaki her sey bosa gider.
    it('confirm hala token miktarini bicimleyip gonderir', () => {
        expect(SEND).toContain('const formattedAmount = formatSafeAmount(amount.value, decimals)')
        expect(SEND).toContain('amount: formattedAmount')
    })
})

describe('yuzde cipleri', () => {
    it('cipler SEND_PERCENTS uzerinden uretilir', () => {
        expect(SEND).toContain('v-for="percent in SEND_PERCENTS"')
        expect(SEND).toContain('@click="setPercent(percent)"')
    })

    it('tutar percentAmount ile hesaplanir', () => {
        const at = SEND.indexOf('writeTokenAmount(percentAmount({')
        expect(at).toBeGreaterThan(-1)
        const call = SEND.slice(at, SEND.indexOf('}))', at) + 3)
        expect(call).toContain('balance: balance.value')
        expect(call).toContain('reserve: await percentReserve()')
        expect(call).toContain('decimals: crypto.sendAsset?.decimals')
    })

    // MAX ayri bir kod yolu OLMAMALI: iki yol ayrisirsa biri gas payini
    // dusurup digeri dusurmez ve MAX yine tamamlanamaz hale gelir.
    it('ayri bir setMax kalmadi', () => {
        expect(SEND).not.toContain('const setMax')
        expect(SEND).not.toContain('@click="setMax"')
    })

    it('ucret payi jetton ve ERC-20 icin 0', () => {
        const at = SEND.indexOf('const percentReserve = async () => {')
        expect(at).toBeGreaterThan(-1)
        const body = SEND.slice(at, SEND.indexOf('\n}', at))
        expect(body).toContain('if (isTonJetton.value) return 0')
        expect(body).toContain("if (!isNativeAsset(crypto.sendAsset?.address || crypto.sendAsset?.ca)) return 0")
        expect(body).toContain('return await estimateNativeGasReserve()')
    })
})

describe('taslak girdi birimini de tasir', () => {
    it('onizlemeye gecerken birim ve HAM metin saklanir', () => {
        const at = SEND.indexOf('crypto.sendDraft = captureSendDraft({')
        expect(at).toBeGreaterThan(-1)
        const call = SEND.slice(at, SEND.indexOf('})', at) + 2)
        expect(call).toContain('mode: inputMode.value')
        // Turetilmis `amount` DEGIL: kullanici alani tam biraktigi gibi bulmali.
        expect(call).toContain('amount: rawInput.value')
    })

    // Fiyat bilinmiyorken dolar modu acilirsa kutu cevrilemez ve kullaniciya
    // bos bir alan gorunur.
    // Dolar metnini token miktari olarak yazmak "100 dolar"i "100 TOKEN"
    // yapardi; para dogrudan kaybolur.
    it('fiat modu acilamadiysa metin token miktari olarak YAZILMAZ', () => {
        expect(SEND).toContain("rawInput.value = draft.mode === 'usd' && !fiatOpen ? '' : draft.amount")
    })

    it('geri yuklemede fiat modu FIYAT KAPISININ ardinda', () => {
        expect(SEND).toContain("const fiatOpen = fiat.mode === 'usd' && hasPrice.value")
        expect(SEND).toContain("inputMode.value = fiatOpen ? 'usd' : 'token'")
    })

    it('onizlemeye gecerken giris para birimi de saklanir', () => {
        const at = SEND.indexOf('crypto.sendDraft = captureSendDraft({')
        const call = SEND.slice(at, SEND.indexOf('})', at) + 2)
        expect(call).toContain('currency: display.value.code')
    })
})

// SECILI BIRIMLE GIRIS (Para birimi Bolum B, Gorev 9). Mod adi 'usd' ayni kaldi
// (taslak/test uyumu) ama anlami "secili birimle giris"; ekranda ne "USD" sabiti
// ne de "$" kalmali.
describe('fiat girisi secili birimde', () => {
    it('sabit USD etiketi, $ onekli karsi deger ve dogrudan USD fiyatla cevrim kalmadi', () => {
        expect(SEND).not.toContain("'USD'")
        expect(SEND).not.toContain('$${')
        expect(SEND).not.toContain('formatUsd')
        expect(SEND).not.toContain('usdToToken(rawInput.value, price.value')
        expect(SEND).not.toContain('tokenToUsdInput(tokenAmount, price.value')
    })

    it('para birimi composable baglidir', () => {
        expect(SEND).toContain("from '../composables/useMoney'")
        expect(SEND).toContain('useMoney()')
        expect(SEND).toContain('fiatPrice')
    })

    it('birim etiketi secili birimin kodudur', () => {
        const at = SEND.indexOf('const unitLabel = computed(')
        expect(at).toBeGreaterThan(-1)
        const body = SEND.slice(at, SEND.indexOf('\n', at))
        expect(body).toContain('display.value.code.toUpperCase()')
    })

    it('karsi deger token modunda money() ile secili birimde yazilir', () => {
        const at = SEND.indexOf('const counterValue = computed(() => {')
        expect(at).toBeGreaterThan(-1)
        const body = SEND.slice(at, SEND.indexOf('\n})', at))
        expect(body).toContain("money(tokenToUsd(amount.value || '0', price.value))")
        // Fiyat yoksa money(null) -> null: sablon "fiyat bilinmiyor" der, "0" degil.
        expect(body).toContain("`${amount.value || '0'} ${assetSymbol.value}`")
    })

    // Review Focus 4: birim degisince yazilan sayi baska paraya donusmemeli.
    it('birim degisince watch reconcileFiatMode sonucunu uygular', () => {
        const at = SEND.indexOf('watch(() => display.value.code,')
        expect(at).toBeGreaterThan(-1)
        const block = SEND.slice(at, SEND.indexOf('\n})', at))
        expect(block).toContain('reconcileFiatMode({ mode: inputMode.value, from: oldCode, to: newCode })')
        expect(block).toContain('inputMode.value = next.mode')
        expect(block).toContain("if (next.clearInput) rawInput.value = ''")
    })

    it('taslak geri yuklemede AYNI fonksiyon taslagin birimiyle cagrilir', () => {
        const at = SEND.indexOf('const draft = restoreSendDraft(')
        expect(at).toBeGreaterThan(-1)
        const block = SEND.slice(at)
        expect(block).toContain('reconcileFiatMode({ mode: draft.mode, from: draft.currency, to: display.value.code })')
        // Yalniz iki cagri: watch ve taslak yolu.
        expect(SEND.split('reconcileFiatMode(').length - 1).toBe(2)
    })
})

describe('birim dugmesi metni birimden bagimsiz', () => {
    it('Send.vue basligi hala send.switchUnit okur', () => {
        expect(SEND).toContain("$t('send.switchUnit')")
    })

    it('send.switchUnit usd/dolar/dollar icermez', () => {
        expect(EN.send.switchUnit).not.toMatch(/usd|dolar|dollar/i)
        expect(TR.send.switchUnit).not.toMatch(/usd|dolar|dollar/i)
    })

    it('metinler birimden bagimsiz olarak sabitlenmistir', () => {
        expect(EN.send.switchUnit).toBe('Switch between token and currency')
        expect(TR.send.switchUnit).toBe('Token ve para birimi arasında geçiş yap')
    })
})

describe('yapistir dugmesi', () => {
    // Fonksiyon dosyada zaten duruyordu ve `send.paste` cevirisi iki dilde de
    // vardi; yalnizca dugme bir tasarim turunde dusmustu - olu kod.
    it('dugme handlePaste cagirir', () => {
        expect(SEND).toContain('@click="handlePaste"')
        expect(SEND).toContain('const handlePaste = async () => {')
    })

    // Pano okunamayabilir (uzantinin `clipboardRead` izni yok). Sessizce
    // hicbir sey yapan bir dugme, bozuk bir dugmeden beterdir: kullanici
    // elle yapistirmasi gerektigini bilemez.
    it('pano okunamazsa sebep SOYLENIR - sessizce yutulmaz', () => {
        const at = SEND.indexOf('const handlePaste = async () => {')
        expect(at).toBeGreaterThan(-1)
        const body = SEND.slice(at, SEND.indexOf('}', SEND.indexOf('catch', at)))
        expect(body).toContain('pasteFailed.value = true')
        expect(SEND).toContain('v-if="pasteFailed"')
    })
})
