// TokenAvatar.vue (SSR) -- normal modda token logosu: kaynak SIRASI, onerror ADIMLAMASI, notr monogram (gri yer tutucu / renkli palet / gradyan YOK).
// Adimlama (img.onerror) DOM gerektirmez: bilesenin `onError` isleyicisi setupState uzerinden cagrilir ve `current` okunur.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, captureInstance, render } from '../test-utils/ssrRender.js'
import TokenAvatar from './TokenAvatar.vue'
import { setLocalLogosOnly } from '../utils/tokenLogo'
import { isLogoMissing, reportLogoLoaded, resetLogoState } from '../utils/tokenLogoState'

const LINK = '0x514910771af9ca656af840dff83e8264ecf986ca'
const IMG = { large: 'https://cdn.example/large.png', small: 'https://cdn.example/small.png', thumb: 'https://cdn.example/thumb.png' }

beforeEach(() => resetLogoState())
afterEach(() => setLocalLogosOnly(false))

async function ciz(props, attrs = {}) {
    const app = createApp(TokenAvatar, { props: { ...props, ...attrs } })
    const captured = captureInstance(app, 'TokenAvatar')
    const html = await render(app)
    return { html, state: captured.instance.setupState }
}

describe('TokenAvatar -- kaynak sirasi (paketli > sunucu gorseli > Trust Wallet)', () => {
    it('paketli dosya varsa ilk o cizilir', async () => {
        const { html } = await ciz({ token: { chainId: 1, address: LINK, symbol: 'LINK', image: IMG } })
        expect(html).toContain('<img src="/tokens/1/' + LINK + '.png"')
    })

    it('paketli yoksa sunucu gorseli (large) cizilir', async () => {
        const { html } = await ciz({ token: { chainId: 137, address: '0x' + '11'.repeat(20), symbol: 'X', image: IMG } })
        expect(html).toContain('<img src="https://cdn.example/large.png"')
    })

    it('sunucu gorseli de yoksa Trust Wallet adayi (checksum adres) cizilir', async () => {
        const { html } = await ciz({ token: { chainId: 137, address: '0x' + '11'.repeat(20), symbol: 'X' } })
        expect(html).toContain('src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/assets/0x1111111111111111111111111111111111111111/logo.png"')
    })

    it('yerel coin = coinin logosu (Base uzerinde ETH elmasi)', async () => {
        const { html } = await ciz({ token: { chainId: 8453, address: '0x0', symbol: 'ETH', native: true, image: IMG } })
        expect(html).toContain('<img src="/chains/1.png"')
    })

    it('acik `sources` cozucuyu atlar ve sirayi korur', async () => {
        const { html, state } = await ciz({ sources: ['/ats.png', 'https://cdn.example/b.png'], symbol: 'ATS' })
        expect(html).toContain('<img src="/ats.png"')
        state.onError()
        expect(state.current).toBe('https://cdn.example/b.png')
    })

    it('sinif / boyut cagirandan aktarilir (img ve monogram icin)', async () => {
        const logolu = await ciz({ sources: ['/ats.png'] }, { class: 'w-6 h-6 rounded-full' })
        expect(logolu.html).toMatch(/<img[^>]*class="w-6 h-6 rounded-full"/)
        const monogram = await ciz({ sources: [], symbol: 'abc' }, { class: 'w-6 h-6 rounded-full' })
        expect(monogram.html).toMatch(/<svg[^>]*class="w-6 h-6 rounded-full"/)
    })
})

describe('TokenAvatar -- onerror ADIMLAMASI: bir sonraki kaynaga, sonunda monograma (gri yer tutucuya ASLA)', () => {
    it('her hatada sonraki kaynak; sonuncu da hata verirse kaynak kalmaz', async () => {
        const { state } = await ciz({ token: { chainId: 137, address: '0x' + '11'.repeat(20), symbol: 'X', image: IMG } })
        const gorulen = [state.current]
        for (let i = 0; i < 10 && state.current; i++) { state.onError(); gorulen.push(state.current) }
        // large -> small -> thumb -> Trust Wallet -> (kaynak yok)
        expect(gorulen).toEqual([
            IMG.large, IMG.small, IMG.thumb,
            'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/polygon/assets/0x1111111111111111111111111111111111111111/logo.png',
            null,
        ])
        expect(gorulen.join('|')).not.toMatch(/default-/)
    })

    it('paketli dosya hata verirse sunucu gorseline gecer', async () => {
        const { state } = await ciz({ token: { chainId: 1, address: LINK, symbol: 'LINK', image: IMG } })
        expect(state.current).toBe('/tokens/1/' + LINK + '.png')
        state.onError()
        expect(state.current).toBe(IMG.large)
    })

    it('tum kaynaklar tukenince token "logosuz" isaretlenir: yerel kaynakli hemen, uzak kaynakli ag kaniti gelince', async () => {
        const yerel = { chainId: 1, address: LINK, symbol: 'LINK' }
        const a = await ciz({ token: yerel, chainId: 1 })
        // paketli + Trust Wallet (uzak) -> uzak denendi -> ag kaniti yok -> beklemede
        a.state.onError(); a.state.onError()
        expect(a.state.current).toBeNull()
        expect(isLogoMissing(yerel)).toBe(false)
        reportLogoLoaded('https://cdn.example/ok.png')
        expect(isLogoMissing(yerel)).toBe(true)
    })

    it('ag kaniti VARKEN tukenen token hemen logosuz sayilir', async () => {
        reportLogoLoaded('https://cdn.example/ok.png')
        const t = { chainId: 137, address: '0x' + '22'.repeat(20), symbol: 'Y' }
        const { state } = await ciz({ token: t })
        state.onError()
        expect(state.current).toBeNull()
        expect(isLogoMissing(t)).toBe(true)
    })
})

describe('TokenAvatar -- notr monogram', () => {
    it('kaynak yoksa sembolun ILK harfi, grafit zemin, ince renk sinifi yok', async () => {
        const { html } = await ciz({ sources: [], symbol: 'usdc' })
        expect(html).toContain('data-token-monogram')
        expect(html).toMatch(/<text[^>]*>U<\/text>/)
        expect(html).toContain('fill-slate-200 dark:fill-zinc-700')
        expect(html).toContain('fill-slate-600 dark:fill-zinc-200')
    })

    it('gradyan, parlama, golge, renkli palet ve gri yer tutucu dosyasi YOK', async () => {
        const { html } = await ciz({ sources: [], symbol: 'ABC' })
        expect(html).not.toMatch(/gradient|linear|blur|shadow|glow|from-|via-|to-/)
        expect(html).not.toMatch(/(bg|text|fill)-(blue|violet|amber|rose|cyan|indigo|teal|fuchsia|emerald|red|green|purple)-/)
        expect(html).not.toContain('default-token')
        expect(html).not.toContain('<img')
    })

    it('sembol yoksa ad, o da yoksa ?; ilk harf buyuk', async () => {
        expect((await ciz({ token: { name: 'zeta coin' } })).html).toMatch(/<text[^>]*>Z<\/text>/)
        expect((await ciz({ sources: [] })).html).toMatch(/<text[^>]*>\?<\/text>/)
        expect((await ciz({ sources: [], symbol: '1inch' })).html).toMatch(/<text[^>]*>1<\/text>/)
    })

    it('yer tutucu dosyalar (default-token.png) kaynak sayilmaz: monogram cizilir', async () => {
        const { html } = await ciz({ token: { symbol: 'FOO', image: { large: '/default-token.png', small: '/default-token.png', thumb: '/default-token.png' } } })
        expect(html).toContain('data-token-monogram')
        expect(html).not.toContain('default-token')
    })

    it('erisilebilirlik: monogram role=img ve ad etiketi tasir', async () => {
        const { html } = await ciz({ sources: [], symbol: 'ABC', alt: 'Alpha Beta' })
        expect(html).toContain('role="img"')
        expect(html).toContain('aria-label="Alpha Beta"')
    })
})

describe('TokenAvatar -- gizli mod anahtari acikken uzak kaynak YOK', () => {
    it('sunucu gorseli ve Trust Wallet cizilmez, monogram cizilir', async () => {
        setLocalLogosOnly(true)
        const { html } = await ciz({ token: { chainId: 137, address: '0x' + '11'.repeat(20), symbol: 'X', image: IMG } })
        expect(html).not.toContain('<img')
        expect(html).not.toMatch(/cdn\.example|raw\.githubusercontent/)
        expect(html).toContain('data-token-monogram')
    })
})
