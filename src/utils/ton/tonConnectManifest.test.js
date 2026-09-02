import { describe, it, expect } from 'vitest'
import { validateManifest, MANIFEST_CONTENT_ERROR } from './tonConnectManifest'

const OK_RAW = { url: 'https://app.dedust.io', name: 'DeDust', iconUrl: 'https://app.dedust.io/icon.png' }

describe('validateManifest', () => {
    it('gecerli manifest ve AYNI origin -> sameOrigin true', () => {
        const r = validateManifest(OK_RAW, {
            manifestUrl: 'https://app.dedust.io/tonconnect-manifest.json',
            dappOrigin: 'https://app.dedust.io',
        })
        expect(r.ok).toBe(true)
        expect(r.manifest.name).toBe('DeDust')
        expect(r.manifest.sameOrigin).toBe(true)
    })

    // K5: manifest BASKA origin'de olabilir ve bu BAGLANTIYI ENGELLEMEZ --
    // isaretlenir, ekran uyarir. Engelleseydik manifest'ini CDN'de tutan mesru
    // dapp'ler bizde calismazdi.
    it('manifest BASKA origin de olsa yine ok, ama sameOrigin false', () => {
        const r = validateManifest(OK_RAW, {
            manifestUrl: 'https://cdn.example.com/manifest.json',
            dappOrigin: 'https://app.dedust.io',
        })
        expect(r.ok).toBe(true)
        expect(r.manifest.sameOrigin).toBe(false)
    })

    it('zorunlu alan yoksa kod 3', () => {
        for (const eksik of ['url', 'name']) {
            const raw = { ...OK_RAW }
            delete raw[eksik]
            const r = validateManifest(raw, { manifestUrl: 'https://a/b.json', dappOrigin: 'https://a' })
            expect(r.ok).toBe(false)
            expect(r.code).toBe(MANIFEST_CONTENT_ERROR)
        }
    })

    it('raw JSON degilse kod 3', () => {
        for (const bozuk of [null, undefined, 'metin', 42, []]) {
            const r = validateManifest(bozuk, { manifestUrl: 'https://a/b.json', dappOrigin: 'https://a' })
            expect(r.ok).toBe(false)
            expect(r.code).toBe(MANIFEST_CONTENT_ERROR)
        }
    })

    // Ikon OPSIYONEL: eksikse manifest gecerli sayilir, ekran ikonsuz cizer.
    // Zorunlu tutmak, ikonu olmayan mesru bir dapp'i tamamen kilitlerdi.
    it('iconUrl eksik olabilir', () => {
        const raw = { url: OK_RAW.url, name: OK_RAW.name }
        const r = validateManifest(raw, { manifestUrl: 'https://app.dedust.io/m.json', dappOrigin: 'https://app.dedust.io' })
        expect(r.ok).toBe(true)
        expect(r.manifest.iconUrl).toBe(null)
    })

    // Ikon URL'i http(s) DISI olamaz: javascript:/data: bir ikon alanindan
    // ekrana enjekte edilebilecek TEK sey degil ama en kolay olani.
    it('http(s) DISI iconUrl reddedilir (kod 3)', () => {
        const raw = { ...OK_RAW, iconUrl: 'javascript:alert(1)' }
        const r = validateManifest(raw, { manifestUrl: 'https://a/b.json', dappOrigin: 'https://a' })
        expect(r.ok).toBe(false)
        expect(r.code).toBe(MANIFEST_CONTENT_ERROR)
    })

    it('cok uzun ad KIRPILIR (onay ekrani tasmasin)', () => {
        const raw = { ...OK_RAW, name: 'x'.repeat(200) }
        const r = validateManifest(raw, { manifestUrl: 'https://a/b.json', dappOrigin: 'https://a' })
        expect(r.ok).toBe(true)
        expect(r.manifest.name.length).toBe(64)
    })

    // URL sehasi http(s) DISI olamaz: javascript: ve data: URL'ler burada bir
    // enjeksiyon vektoru degil ama daha guvenli olmak icin, gercek dapp'ler
    // sadece http(s) URL'lere ihtiyac duyar.
    it('javascript: sehali url reddedilir (kod 3)', () => {
        const raw = { ...OK_RAW, url: 'javascript:alert(1)' }
        const r = validateManifest(raw, { manifestUrl: 'https://a/b.json', dappOrigin: 'https://a' })
        expect(r.ok).toBe(false)
        expect(r.code).toBe(MANIFEST_CONTENT_ERROR)
    })

    it('data: sehali url reddedilir (kod 3)', () => {
        const raw = { ...OK_RAW, url: 'data:text/html,<script>alert(1)</script>' }
        const r = validateManifest(raw, { manifestUrl: 'https://a/b.json', dappOrigin: 'https://a' })
        expect(r.ok).toBe(false)
        expect(r.code).toBe(MANIFEST_CONTENT_ERROR)
    })

    it('normal https url gecerli kaliyor', () => {
        const raw = { ...OK_RAW, url: 'https://example.com/app' }
        const r = validateManifest(raw, { manifestUrl: 'https://a/b.json', dappOrigin: 'https://a' })
        expect(r.ok).toBe(true)
        expect(r.manifest.url).toBe('https://example.com/app')
    })
})
