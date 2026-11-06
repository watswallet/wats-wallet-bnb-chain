// Gizli mod sade transfer ekrani KAYNAK KILITLERI (spec Bolum 8 "Yeni kilitler" 2, 3, 4).
// Kilit (1) sourceAssets.test.js icindedir. Burada ekran ve yardimci dosyalar yorumsuz okunur:
// bir iddia yalniz YORUMLA saglanamaz, yorumda gecen yasak ad da kilidi kirmaz.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz, importsuz, blokGovdesi } from '../../test-utils/kaynakTarama'

const oku = (yol) => readFileSync(fileURLToPath(new URL(yol, import.meta.url)), 'utf8')

const DOSYALAR = {
    'PrivateTransfer.vue': './PrivateTransfer.vue',
    'PrivateFeeCard.vue': './PrivateFeeCard.vue',
    'PrivateAssetChip.vue': './PrivateAssetChip.vue',
    'PrivateTokenLogo.vue': './PrivateTokenLogo.vue',
    'PrivateAssetPicker.vue': './PrivateAssetPicker.vue',
    'PrivateInfoSheet.vue': './PrivateInfoSheet.vue',
    'quoteScheduler.js': '../../utils/privacy/quoteScheduler.js',
    'feeBreakdown.js': '../../utils/privacy/feeBreakdown.js',
    'sourceAssets.js': '../../utils/privacy/sourceAssets.js',
}

const HAM = Object.fromEntries(Object.entries(DOSYALAR).map(([ad, yol]) => [ad, oku(yol)]))
const KOD = Object.fromEntries(Object.entries(HAM).map(([ad, ham]) => [ad, yorumsuz(ham)]))
const EKRAN = KOD['PrivateTransfer.vue']

// SVG ad alani bildirimi (xmlns="http://www.w3.org/...") bir ag istegi degildir (X9): taramadan once atilir.
const xmlnsSiz = (metin) => metin.replace(/\sxmlns(:\w+)?\s*=\s*("[^"]*"|'[^']*')/g, ' ')

// <template> govdesi (ilk acilis ile son kapanis arasi).
const sablonu = (kod) => {
    const bas = kod.indexOf('<template>')
    const son = kod.lastIndexOf('</template>')
    return bas === -1 || son === -1 ? '' : kod.slice(bas + '<template>'.length, son)
}

const VOID = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'source', 'col', 'area', 'base', 'wbr'])

// Basit etiket yigini: `konum` aninda acik olan ata etiketlerin { ad, nitelik } listesini doner.
// Tirnakli nitelik degerleri icindeki `>` etiketi bitirmez.
function ataEtiketler(sablon, konum) {
    const re = /<(\/?)([A-Za-z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g
    const yigin = []
    let m
    while ((m = re.exec(sablon)) !== null) {
        if (m.index >= konum) break
        const [, kapanis, ad, nitelik] = m
        if (kapanis) {
            for (let i = yigin.length - 1; i >= 0; i--) {
                if (yigin[i].ad === ad) { yigin.length = i; break }
            }
            continue
        }
        if (VOID.has(ad.toLowerCase()) || /\/\s*$/.test(nitelik)) continue
        yigin.push({ ad, nitelik })
    }
    return yigin
}

describe('PrivateTransfer kaynak kilitleri: tarama saglamligi', () => {
    it('yorumsuz okuma yorumdaki yasak adlari gercekten siler', () => {
        // Ekranin yorumlarinda bu adlar gecer; kod iceriginde gecmemeli.
        expect(HAM['PrivateTransfer.vue']).toContain('PRIVATE_ORDER_ATS')
        expect(EKRAN).not.toContain('PRIVATE_ORDER_ATS')
        for (const kod of Object.values(KOD)) expect(kod).not.toContain('<!--')
    })

    it('xmlnsSiz yalniz ad alani bildirimlerini atar', () => {
        expect(xmlnsSiz('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">')).not.toMatch(/https?:/)
        expect(xmlnsSiz('<a href="https://ornek.test/x">')).toContain('https://ornek.test/x')
    })

    it('ataEtiketler v-if zincirini ve tirnak ici > i dogru okur', () => {
        const s = '<div v-if="a > 1"><p v-else>x</p><span v-if="mode === \'send\'"><b/><X /></span></div>'
        expect(ataEtiketler(s, s.indexOf('<X')).map((e) => e.ad)).toEqual(['div', 'span'])
        expect(ataEtiketler(s, s.indexOf('<X'))[1].nitelik).toContain("mode === 'send'")
    })
})

describe('Kilit 2: ag ucreti her zaman ATS, ATS al dugmesi yalniz Gonder, Takas ve Kopru dalinda (mode !== fund)', () => {
    it("PrivateTransfer.vue: gas: 'ats' tam bir yerde gecer", () => {
        expect(EKRAN.match(/\bgas\s*:\s*(['"`])ats\1/g) ?? []).toHaveLength(1)
    })

    it("PrivateTransfer.vue: 'native' hicbir gas atamasinda ya da mesajinda gecmez", () => {
        expect(EKRAN).not.toMatch(/\bgas\s*[:=]\s*(['"`])native\1/)
        expect(EKRAN).not.toMatch(/\bgas\s*:\s*[^,}\n]*\bnative\b/)
        const govde = blokGovdesi(HAM['PrivateTransfer.vue'], /const\s+message\s*=\s*\{/)
        expect(govde).not.toBeNull()
        expect(govde).not.toMatch(/native/)
    })

    it('AtsBuyButton TAM bir kez cizilir ve ata zincirinde mode !== fund kosulu vardir', () => {
        const sablon = sablonu(EKRAN)
        const acilislar = [...sablon.matchAll(/<(AtsBuyButton|ats-buy-button)\b/g)]
        expect(acilislar).toHaveLength(1)
        const ataIfler = ataEtiketler(sablon, acilislar[0].index).map((e) => e.nitelik)
        const sendKosulu = /\bv-(?:else-)?if\s*=\s*"[^"]*\bmode\s*!==\s*['`]fund['`][^"]*"/
        expect(ataIfler.some((n) => sendKosulu.test(n))).toBe(true)
        // Para yukle dalinin kosulu ya da kosulsuz v-else atasi olamaz.
        expect(ataIfler.some((n) => /\bmode\s*===\s*['`]fund['`]/.test(n))).toBe(false)
        expect(ataIfler.some((n) => /\sv-else(?![\w-])/.test(' ' + n))).toBe(false)
    })

    it('AtsBuyButton adi import satiri disinda yalniz o tek etikette gecer', () => {
        const kullanim = importsuz(EKRAN).match(/\bAtsBuyButton\b/g) ?? []
        expect(kullanim).toHaveLength(1)
        expect(EKRAN.match(/^[^\S\r\n]*import\s+AtsBuyButton\b/gm) ?? []).toHaveLength(1)
    })
})

describe('Kilit 3: gizlilik yuzeyi (fiyat, uzak ag, ters cevir)', () => {
    const YASAKLAR = [
        ['"≈ $"', /(?:≈|\\u2248|&asymp;|&approx;)\s*\$(?!\{)/],
        ['usdText', /usdText/],
        ['useUsdPrice', /useUsdPrice/],
        ['getTokensDataById', /getTokensDataById/],
        ['coingecko', /coingecko/i],
        ['http(s)://', /https?:\/\//],
        ['http(s): (bolunmus)', /https?:(?!\/\/)\s*$/m],
    ]

    for (const ad of Object.keys(DOSYALAR)) {
        it(`${ad}: fiyat, coingecko ve uzak adres yok`, () => {
            const kod = xmlnsSiz(KOD[ad])
            for (const [etiket, re] of YASAKLAR) {
                expect(re.test(kod), `${ad} icinde yasak: ${etiket}`).toBe(false)
            }
        })
    }

    it('PrivateTransfer.vue: ters cevir dugmesi yok', () => {
        expect(EKRAN).not.toMatch(/swap-reverse/)
        const sablon = sablonu(EKRAN)
        expect(sablon).not.toMatch(/reverse/i)
        expect(EKRAN).not.toMatch(/\b(?:reverseSwap|onReverse|toggleReverse|swapDirection|flipPair)\b/)
    })
})

describe('Kilit 4: PRIVATE_ORDER mesaji ve yasakli adlar', () => {
    it("send('PRIVATE_ORDER', message) bir kez cagrilir; message ticket, gas: 'ats' ve atsQuoted kurar", () => {
        expect(EKRAN.match(/\bsend\(\s*(['"`])PRIVATE_ORDER\1\s*,\s*message\s*\)/g) ?? []).toHaveLength(1)
        const govde = blokGovdesi(HAM['PrivateTransfer.vue'], /const\s+message\s*=\s*\{/)
        expect(govde).not.toBeNull()
        expect(govde).toMatch(/(?:^|[\s,{])ticket\s*:/)
        expect(govde).toMatch(/(?:^|[\s,{])gas\s*:\s*(['"`])ats\1/)
        expect(govde).toMatch(/(?:^|[\s,{])atsQuoted\s*:/)
    })

    it('PRIVATE_ORDER_ATS, PrivateReviewCard ve PrivateOption' + 'Field adlari kodda yok', () => {
        expect(EKRAN).not.toMatch(/PRIVATE_ORDER_ATS/)
        expect(EKRAN).not.toMatch(/PrivateReviewCard/)
        expect(EKRAN).not.toMatch(new RegExp('PrivateOption' + 'Field'))
        expect(EKRAN).not.toMatch(/private-option-field/i)
    })

    it('quoteScheduler.js hicbir import ya da require icermez', () => {
        const kod = KOD['quoteScheduler.js']
        expect(kod).not.toMatch(/^\s*import\b/m)
        expect(kod).not.toMatch(/\bimport\s*\(/)
        expect(kod).not.toMatch(/\brequire\s*\(/)
        expect(kod).not.toMatch(/\bexport\s+[^;\n]*\bfrom\s+['"]/)
    })
})
