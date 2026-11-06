// NORMAL MODDA LOGOSUZ TOKEN KALMAZ -- kaynak tarama kilidi (sahip karari 2026-11-03).
// Gri yer tutucu (default-token.png, satir ici gri daire SVG'si) normal mod bilesenlerine geri girmesin; token logosu yalniz TEK cozucudan
// (tokenLogoSources.js -> TokenAvatar.vue) cizilsin; gizli modun cozucusu normal cozucuden BAGIMSIZ kalsin.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../', import.meta.url))

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p, out)
        else out.push(p)
    }
    return out
}

const rel = (p) => relative(SRC, p).replace(/\\/g, '/')
// Normal mod bilesenleri: components/ altindaki .vue dosyalari, gizli modun KENDI bilesenleri (components/privacy/) haric.
const NORMAL_VUE = walk(join(SRC, 'components')).filter((f) => f.endsWith('.vue') && !rel(f).startsWith('components/privacy/'))
const kaynak = (f) => readFileSync(f, 'utf8')

describe('normal mod bilesenlerinde gri yer tutucu yok', () => {
    it('hicbir normal mod bileseninde /default-token.png gecmez', () => {
        expect(NORMAL_VUE.length).toBeGreaterThan(40)
        const hits = NORMAL_VUE.filter((f) => kaynak(f).includes('default-token.png')).map(rel)
        expect(hits).toEqual([])
    })

    it('satir ici gri daire SVG yer tutucusu (data:image/svg+xml;base64 @error yedegi) token listelerinde kalmadi', () => {
        const TOKEN_LISTELERI = [
            'components/SelectAssets.vue', 'components/SearchTokens.vue', 'components/swap/swapFrom.vue', 'components/swap/swapTo.vue',
            'components/bridge/bridgeFrom.vue', 'components/bridge/bridgeTo.vue', 'components/Home.vue',
        ]
        for (const ad of TOKEN_LISTELERI) expect(kaynak(join(SRC, ad)), ad).not.toContain('data:image/svg+xml;base64')
    })

    it('hicbir normal mod bileseni <img :src="tokenLogo(...)"> ile token logosu cizmez (tek cozucu: TokenAvatar)', () => {
        const hits = NORMAL_VUE.filter((f) => /<img[^>]*:src="[^"]*\btokenLogo\(/.test(kaynak(f))).map(rel)
        expect(hits).toEqual([])
    })

    it('token logosu cizen her ekran TokenAvatar (ya da ona sarili TokenLogo) kullanir', () => {
        const EKRANLAR = [
            'Home.vue', 'Token.vue', 'Send.vue', 'Swap.vue', 'Bridge.vue', 'SelectAssets.vue', 'SearchTokens.vue', 'BuyToken.vue', 'ImportToken.vue',
            'History.vue', 'ConfirmTransaction.vue', 'Dapp.vue', 'AtsFeeCard.vue', 'AtsShortfallNote.vue', 'TokenLogo.vue',
            'swap/swapFrom.vue', 'swap/swapTo.vue', 'bridge/bridgeFrom.vue', 'bridge/bridgeTo.vue', 'stocks/StockTrade.vue',
        ]
        for (const ad of EKRANLAR) expect(kaynak(join(SRC, 'components', ad)), ad).toMatch(/TokenAvatar/)
    })

    it('logosuz token secicilerde tek ortak suzgecten gecer', () => {
        const SECICILER = {
            'components/SearchTokens.vue': 'hideLogoless',
            'components/swap/swapTo.vue': 'hideLogoless',
            'components/bridge/bridgeTo.vue': 'hideLogoless',
            'components/swap/swapFrom.vue': 'hideLogolessUnlessHeld',
            'components/bridge/bridgeFrom.vue': 'hideLogolessUnlessHeld',
            'components/SelectAssets.vue': 'hideLogolessUnlessHeld',
            'components/Home.vue': 'hideLogolessZero',
        }
        for (const [ad, islev] of Object.entries(SECICILER)) expect(kaynak(join(SRC, ad)), ad).toContain(islev + '(')
    })
})

describe('TokenAvatar: gizli modla ve renkli palette BAGLANTISI yok', () => {
    const avatar = kaynak(join(SRC, 'components/TokenAvatar.vue'))

    it('monogram notr: gradyan / parlama / renkli palet sinifi yok', () => {
        expect(avatar).not.toMatch(/gradient|blur|shadow|glow|bg-linear|from-|via-/)
        expect(avatar).not.toMatch(/(bg|text|fill)-(blue|violet|amber|rose|cyan|indigo|teal|fuchsia|emerald|red|green|purple)-/)
        expect(avatar).not.toContain('default-token')
    })

    it('onerror bir sonraki kaynaga gecer ve kaynak kalmazsa tukenmeyi bildirir', () => {
        expect(avatar).toMatch(/@error="onError"/)
        expect(avatar).toMatch(/index\.value \+= 1/)
        expect(avatar).toContain('reportLogoExhausted')
    })
})

describe('gizli mod cozucusu normal cozucuden bagimsiz', () => {
    it('privateTokenLogo / privateCoinLogo / localTokenLogos normal cozucuyu ve durum modulunu import etmez', () => {
        for (const ad of ['utils/privacy/privateTokenLogo.js', 'utils/privacy/privateCoinLogo.js', 'utils/privacy/localTokenLogos.js']) {
            const s = kaynak(join(SRC, ad))
            expect(s, ad).not.toMatch(/tokenLogoSources|tokenLogoState|TokenAvatar/)
        }
    })

    it('normal cozucu uzak adresi YALNIZ gizli mod anahtari kapaliyken uretir (Trust Wallet dali anahtara bagli)', () => {
        const s = kaynak(join(SRC, 'utils/tokenLogoSources.js'))
        expect(s).toMatch(/if \(!localLogosOnly\(\) && !isNativeToken\(token\)\)/)
        expect(s).toMatch(/if \(localLogosOnly\(\)\) return null/)
    })

    it('manifest CSP degismedi: img-src / default-src kisitlamasi yok (Trust Wallet gorseli zaten serbest), connect-src degismedi', () => {
        const m = readFileSync(fileURLToPath(new URL('../../manifest.config.js', import.meta.url)), 'utf8')
        expect(m).not.toMatch(/img-src|default-src 'self'/)
        expect(m).toContain("connect-src 'self' https: http: ws: wss:;")
    })
})
