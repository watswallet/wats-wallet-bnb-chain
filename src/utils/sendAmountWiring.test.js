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

    it('fiyat yoksa dolar girisi kapali', () => {
        expect(SEND).toContain('const hasPrice = computed(() => price.value !== null)')
        expect(SEND).toContain(':disabled="!hasPrice"')
    })
})

describe('gonderilen miktar HER ZAMAN token cinsinden', () => {
    // En pahali hata sinifi: dolar kutusuna yazilan sayinin token miktari
    // sanilmasi. Kullanici "100" yazar, cuzdan 100 TOKEN gonderir.
    it('kutu ham metne baglanir, token miktarina DEGIL', () => {
        expect(SEND).toContain('v-model="rawInput"')
        expect(SEND).not.toContain('v-model="amount"')
    })

    it('gonderilecek miktar ham metinden TURETILIR', () => {
        const at = SEND.indexOf('const amount = computed(() => {')
        expect(at).toBeGreaterThan(-1)
        const body = SEND.slice(at, SEND.indexOf('})', at))
        expect(body).toContain("if (inputMode.value !== 'usd') return rawInput.value")
        expect(body).toContain('usdToToken(rawInput.value, price.value, crypto.sendAsset?.decimals)')
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
        expect(body).toContain('tokenToUsdInput(tokenAmount, price.value)')
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
    it('dolar modu acilamadiysa metin token miktari olarak YAZILMAZ', () => {
        expect(SEND).toContain("rawInput.value = draft.mode === 'usd' && !hasPrice.value ? '' : draft.amount")
    })

    it('geri yuklemede dolar modu FIYAT KAPISININ ardinda', () => {
        expect(SEND).toContain("inputMode.value = draft.mode === 'usd' && hasPrice.value ? 'usd' : 'token'")
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
