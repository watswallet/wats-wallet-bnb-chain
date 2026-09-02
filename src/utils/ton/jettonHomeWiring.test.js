// SAF KATMANI EKRANA BAGLAYAN TELLER — kaynak uzerinden kilitlenir.
//
// NEDEN BOYLE BIR TEST: bu depoda bilesen (mount) testi YOK (bkz. jettonHistoryWiring.test.js
// bas yorumu, ayni gerekce burada da gecerli).
//
// O3 DUZELTMESI — UYARI: YORUM TUZAGI: naif bir `toContain` kontrolu SADECE bir aciklama
// yorumunda gecen bir kelimeyle de yesil kalabilir. Bu dosya TAM OLARAK bu tuzaga
// dusmustu: eski hali `HOME.toContain('jettonsFromTokens')` ve `HOME.toContain('allSettled')`
// seklindeydi ve Home.vue:496/506 bu dizeleri bir ACIKLAMA YORUMU icinde tasiyordu — yani
// Home.vue'deki jetton kodu TAMAMEN silinse bile (kod satirlari gitse de yorumlar kalsa)
// iki iddia da YESIL kalirdi. Kardes dosya jettonHistoryWiring.test.js bu tuzagi zaten
// yorumlari siyirarak onluyordu; ayni koruma burada da uygulaniyor.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const HOME_RAW = readFileSync(fileURLToPath(new URL('../../components/Home.vue', import.meta.url)), 'utf8')

const stripComments = (src) => src
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\/\/.*$/, ''))
    .join(String.fromCharCode(10))

const HOME = stripComments(HOME_RAW)

describe('Home jetton okumasi', () => {
    it('jetton listesini kullanir', () => {
        expect(HOME).toContain('jettonsFromTokens')
    })

    it('bakiyeleri PARALEL okur - bir jetton digerlerini bloklamaz', () => {
        expect(HOME).toContain('allSettled')
    })

    it('basarisiz okumayi 0 YAPMAZ', () => {
        // `|| 0` kalibi girerse kullanici parasinin kayboldugunu dusunur.
        expect(HOME).not.toMatch(/jettonBalance\s*\|\|\s*0/)
    })
})

// O1 DUZELTMESI: ondaligi olmayan/gecersiz bir TON jetton kaydi displayedTokens
// icinde SUZULMUYORDU - formatTokenAmount(undefined) sessizce "0" donup kullaniciya
// sahte bir "0 <SEMBOL>" bakiyesi gosteriyordu (spec §3.2/§3.3 ihlali). Asagidaki
// testler yorumlari siyirilmis kaynak uzerinde, kilidin GERCEKTEN displayedTokens
// govdesinde (baska bir yerde degil) oldugunu dogrular.
describe('Home displayedTokens - ondaligi gecersiz jetton kaydi dusurulur (O1)', () => {
    const start = HOME.indexOf('const displayedTokens = computed')
    const end = start > -1 ? HOME.indexOf('return [...result].sort', start) : -1
    const body = start > -1 && end > -1 ? HOME.slice(start, end) : ''

    it('displayedTokens computed i kaynakta bulunur', () => {
        expect(start).toBeGreaterThan(-1)
        expect(end).toBeGreaterThan(start)
    })

    it('decimals gecerliligini (tamsayi + sinirlar) displayedTokens govdesinde kontrol eder', () => {
        expect(body).toContain('Number.isInteger(t.decimals)')
    })

    it('native TON satirini (NATIVE_TOKEN_ADDRESS) bu elemeden MUAF tutar', () => {
        expect(body).toContain('NATIVE_TOKEN_ADDRESS')
    })

    it('elemeyi yalnizca TON zincirine (isTon) uygular - EVM kayitlari etkilenmez', () => {
        expect(body).toContain('isTon(t.chainId)')
    })
})
