// KAYMAK G15: simge ucusunun baglanmasi (spec 7.5, K5, H7). Kaynak kilitleri yorumsuz okunur: bir yorum ya da
// kullanilmayan import iddiayi yesil tutamaz. Denetleyicinin davranisi iconFlight.test.js'te; burada yalniz baglar.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { yorumsuz, cagriGovdesi } from '../test-utils/kaynakTarama'

const oku = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const APP_HAM = oku('./App.vue')
const HOME_HAM = oku('../components/Home.vue')
const TOKEN_HAM = oku('../components/Token.vue')
const STOCK_DETAIL_HAM = oku('../components/stocks/StockDetail.vue')

const APP = yorumsuz(APP_HAM)
const HOME = yorumsuz(HOME_HAM)
const HOME_SABLON = HOME.slice(0, HOME.indexOf('<script'))
const HOME_SCRIPT = HOME.slice(HOME.indexOf('<script'))
const TOKEN = yorumsuz(TOKEN_HAM)
const TOKEN_SABLON = TOKEN.slice(0, TOKEN.indexOf('<script'))

const tekBosluk = (s) => s.replace(/\s+/g, ' ')
const say = (metin, parca) => metin.split(parca).length - 1
// `needle`i iceren acilis etiketi (`<` ... `>`); etiket icinde `>` gecmeyen sablonlar icin.
const etiket = (kaynak, needle) => {
    const i = kaynak.indexOf(needle)
    if (i === -1) return null
    return kaynak.slice(kaynak.lastIndexOf('<', i), kaynak.indexOf('>', i) + 1)
}
const sinifi = (tag) => tag?.match(/\sclass="([^"]*)"/)?.[1] ?? null

describe('App.vue: ucus denetleyicisi (G15, spec 7.5)', () => {
    const govde = () => tekBosluk(cagriGovdesi(APP_HAM, 'const ucus = createIconFlight(') ?? '')

    it('createIconFlight hisse sayfasi, gizli mod, secili anahtar ve hatirlanan sekmeyle kurulur', () => {
        expect(APP).toContain('const ucus = createIconFlight({')
        const g = govde()
        expect(g).toContain('isStockPage: () => isStockPage.value')
        expect(g).toContain('isPrivate: () => privacy.active')
        expect(g).toContain('homeTab: () => page.homeTab')
        expect(say(APP, 'createIconFlight(')).toBe(1)
    })

    it("selectedKey: crypto.selected_token_ref'ten tokenBucketKey(normalizeBucketChainId(...)) (Home satirAnahtari ile ayni bicim)", () => {
        const g = govde()
        expect(g).toMatch(/selectedKey: \(\) => \{/)
        expect(g).toContain('crypto.selected_token_ref')
        expect(g).toContain('tokenBucketKey(normalizeBucketChainId(')
        expect(g).toContain('r.address')
        // Ham birlestirme '0x38' gibi kimliklerde satir anahtariyla eslesmezdi.
        expect(g).not.toMatch(/chainId\s*\+\s*['"]_['"]/)
        expect(g).not.toMatch(/`\$\{[^}]*chainId[^}]*\}_/)
    })

    it('importlar: createIconFlight ./iconFlight, anahtar yardimcilari utils/homeTokenBucket, provide vue', () => {
        expect(APP).toMatch(/import \{ createIconFlight \} from '\.\/iconFlight'/)
        expect(APP).toMatch(/import \{[^}]*\bnormalizeBucketChainId\b[^}]*\} from '\.\.\/utils\/homeTokenBucket'/)
        expect(APP).toMatch(/import \{[^}]*\btokenBucketKey\b[^}]*\} from '\.\.\/utils\/homeTokenBucket'/)
        expect(APP).toMatch(/import \{[^}]*\bprovide\b[^}]*\} from 'vue'/)
    })

    it('sayfa yonu denetleyicisinin pickNav i ucusun onPageChange ine bagli; ucus ondan once kurulur', () => {
        const nav = tekBosluk(cagriGovdesi(APP_HAM, 'const pageNav = createPageNavController(') ?? '')
        expect(nav).toContain('pickNav: (n, p, d) => ucus.onPageChange(n, p, d)')
        expect(APP.indexOf('const ucus = createIconFlight(')).toBeLessThan(APP.indexOf('const pageNav = createPageNavController('))
    })

    it('post izleyici: sayfa DOM u guncellenince afterPatch; currentPage yazmaz', () => {
        expect(APP).toContain("watch(() => page.currentPage, () => ucus.afterPatch(), { flush: 'post' })")
        expect(say(APP, 'ucus.afterPatch(')).toBe(1)
    })

    it("provide('kaymakUcus', ucus) bir kez", () => {
        expect(APP).toContain("provide('kaymakUcus', ucus)")
        expect(say(APP, "provide('kaymakUcus'")).toBe(1)
    })
})

describe('Home.vue: ucus isaretleri ve hazir sinyali (G15)', () => {
    it('data-flight-icon yalniz varlik satirinin simge kabinda, bir kez: :data-flight-icon="satirAnahtari(token)"', () => {
        expect(say(HOME_SABLON, 'data-flight-icon')).toBe(1)
        expect(HOME_SABLON).toContain(':data-flight-icon="satirAnahtari(token)"')
        const tag = etiket(HOME_SABLON, ':data-flight-icon=')
        expect(sinifi(tag)).toMatch(/^relative min-w-10 h-10 rounded-full bg-slate-100 /)
        // Kap varlik satirinin (v-for token) icinde, hisse satirinda (v-for stock) degil.
        const varlikBas = HOME_SABLON.indexOf('v-for="token in displayedTokens"')
        const varlikSon = HOME_SABLON.indexOf('</button>', varlikBas)
        const i = HOME_SABLON.indexOf(':data-flight-icon=')
        expect(i).toBeGreaterThan(varlikBas)
        expect(i).toBeLessThan(varlikSon)
        const hisseBas = HOME_SABLON.indexOf('v-for="stock in group.rows"')
        expect(hisseBas).toBeGreaterThan(-1)
        expect(HOME_SABLON.slice(hisseBas, HOME_SABLON.indexOf('</button>', hisseBas))).not.toContain('data-flight')
    })

    it('kok kaydiricida data-home-scroller, sekme satirinda data-home-tabs (birer kez)', () => {
        expect(say(HOME_SABLON, 'data-home-scroller')).toBe(1)
        expect(say(HOME_SABLON, 'data-home-tabs')).toBe(1)
        expect(etiket(HOME_SABLON, 'data-home-scroller')).toContain('ref="kok"')
        expect(etiket(HOME_SABLON, 'data-home-tabs')).toContain('ref="sekmeSatiri"')
    })

    it("inject('kaymakUcus', null); kaydirma.settled.then icinde homeReady", () => {
        expect(HOME_SCRIPT).toContain("const ucus = inject('kaymakUcus', null)")
        expect(HOME_SCRIPT).toMatch(/import \{[^}]*\binject\b[^}]*\} from 'vue'/)
        expect(tekBosluk(HOME_SCRIPT)).toContain('kaydirma.settled.then((ok) => ucus?.homeReady(ok))')
        expect(say(HOME_SCRIPT, 'homeReady(')).toBe(1)
        // Hazir sinyali kaydirma denetleyicisi kurulduktan SONRA baglanir.
        expect(HOME_SCRIPT.indexOf('kaydirma.settled.then(')).toBeGreaterThan(HOME_SCRIPT.indexOf('const kaydirma = useHomeScrollMemory('))
    })

    it('tiklama bagi aynen: @click="selectToken(token)"', () => {
        const dugme = HOME_SABLON.match(/<button[^>]*?v-for="token in displayedTokens"[\s\S]*?>/)
        expect(dugme).not.toBeNull()
        expect(dugme[0]).toContain('@click="selectToken(token)"')
    })
})

describe('Token.vue: ucus hedefi (G15)', () => {
    it('data-flight-target baslik cercevesinde bir kez; sinif aynen', () => {
        expect(say(TOKEN_SABLON, 'data-flight-target')).toBe(1)
        expect(sinifi(etiket(TOKEN_SABLON, 'data-flight-target'))).toBe('w-10 h-10 rounded-full bg-white dark:bg-zinc-800 border border-slate-200 dark:border-white/10 p-1 shadow-sm transition-colors duration-300')
    })

    it('hedef, basligin ilk 40 px cercevesi (kapat dugmesinden once)', () => {
        const i = TOKEN_SABLON.indexOf('data-flight-target')
        expect(i).toBeGreaterThan(-1)
        expect(i).toBeLessThan(TOKEN_SABLON.indexOf("@click=\"page.currentPage = 'home'\""))
    })

    it('StockDetail.vue ucus isareti tasimaz (hisse sayfasinda ucus yok)', () => {
        expect(STOCK_DETAIL_HAM).not.toContain('data-flight')
    })
})
