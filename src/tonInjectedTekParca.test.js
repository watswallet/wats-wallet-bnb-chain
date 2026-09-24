import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tonConnectDeviceInfo } from './utils/ton/tonConnectDevice'

// SAYFA DUNYASINA ENJEKTE EDILEN BETIKLER TEK PARCA OLMALI.
//
// KOK NEDEN (olculdu 2026-09-13, canli sayfa + build ciktisi): crxjs bir icerik
// betiginde TEK bir `import` satiri gorurse onu DOGRUDAN degil bir YUKLEYICI ile
// kaydeder ve yukleyici `await import(...)` ile uzantidan ayri dosyalar ceker.
//
//   tonInjected.js importlu  -> manifest: "assets/tonInjected.js-loader-*.js"
//   tonInjected.js importsuz -> manifest: "assets/tonInjected.js-*.js"
//
// Bedeli iki katli:
//   (a) GECIKME -- kopru sayfa acildiktan ~82 ms sonra olusuyordu. Kopruyu
//       acilista senkron arayan bir dapp cuzdani BULAMAZ.
//   (b) KIRILGANLIK -- o dosyalarin indirilmesi engellenirse (korumali iframe,
//       kati CSP) kopru HIC kurulmaz. EVM saglayicisi ayni sayfada calismaya
//       devam eder, cunku injected.js hic import etmedigi icin tek parcadir --
//       yani kullanici "cuzdan var ama TON yok" gibi anlasilmaz bir durum gorur.
//
// injected.js'in importsuz olmasi BUGUNE KADAR TESADUFTU: oraya eklenecek tek
// bir import satiri EVM saglayicisini da ayni kirilganliga sokardi, sessizce.
// Bu dosya ikisini de kilitler.

const oku = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

// Yorumlari ve dize iclerini degil, GERCEK import ifadelerini arar.
const staticImportlar = (src) => src
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /^import\s/.test(s) || /^export\s+.*\sfrom\s/.test(s))

const SAYFA_BETIKLERI = [
    ['tonInjected.js', oku('./tonInjected.js')],
    ['injected.js', oku('./injected.js')],
]

describe.each(SAYFA_BETIKLERI)('%s -- sayfa dunyasi betigi', (_ad, SRC) => {
    it('hicbir static import tasimaz', () => {
        expect(staticImportlar(SRC)).toEqual([])
    })

    it('dinamik import de kullanmaz', () => {
        // `await import(...)` ayni dosya cekme adimini elle yapmak olurdu.
        expect(SRC).not.toMatch(/\bimport\s*\(/)
    })
})

describe('TON cihaz betimi -- tek kaynak korunuyor', () => {
    it('tonInjected.js kendi kopyasini YAZMAZ, gomulu degeri okur', () => {
        const SRC = oku('./tonInjected.js')
        // Derleme zamani sabiti. Elle yazilmis bir nesne literali olsaydi
        // tonConnectDevice.js'teki olum-sonrasi incelemenin anlattigi ucuncu
        // kopya geri gelirdi (iki kopya sessizce `features: []` ile kalmisti).
        expect(SRC).toContain('__TON_DEVICE_INFO__')
        expect(SRC).not.toMatch(/platform:\s*'browser'/)
        expect(SRC).not.toMatch(/appName:\s*'wats'/)
    })

    it('gomulu deger tek kaynakla BIREBIR ayni', () => {
        // Testin kendi derlemesi de ayni tanimi kullaniyor (vitest.config.js),
        // yani bu karsilastirma tanimin dogru fonksiyondan okundugunu olcer.
        expect(__TON_DEVICE_INFO__).toEqual(tonConnectDeviceInfo())
    })

    it('her cagri TAZE nesne doner (paylasilan referans DEGIL)', async () => {
        // Orijinal sozlesme: uc cagiran da yaniti kendi govdesine gomup
        // chrome.runtime ile gonderiyor; ortak bir nesneyi mutate eden biri
        // digerlerini etkilemesin.
        const a = tonConnectDeviceInfo()
        const b = tonConnectDeviceInfo()
        expect(a).toEqual(b)
        expect(a).not.toBe(b)
        expect(a.features).not.toBe(b.features)
    })
})

describe('Iki derleme yapilandirmasi AYNI kaynaktan okur', () => {
    it.each([
        ['vite.config.js', oku('../vite.config.js')],
        ['vitest.config.js', oku('../vitest.config.js')],
    ])('%s: degeri tonConnectDeviceInfo() ile uretir', (_ad, SRC) => {
        expect(SRC).toContain('__TON_DEVICE_INFO__: JSON.stringify(tonConnectDeviceInfo())')
        expect(SRC).toContain("from './src/utils/ton/tonConnectDevice.js'")
    })

    it('cihaz modulu ORTAM DEGISKENI okuyan bir zincire baglanmaz', () => {
        // Config Node'da calisir ve orada `import.meta.env` YOKTUR. Zincir
        // featureFlags'e uzandigi an vitest "Cannot read properties of
        // undefined (reading 'VITE_SOLANA_ENABLED')" ile HIC BASLAMIYORDU.
        const CIHAZ = oku('./utils/ton/tonConnectDevice.js')
        expect(CIHAZ).toContain("from './tonConnectLimits'")
        expect(CIHAZ).not.toContain("from './tonConnectMessages'")

        const LIMIT = oku('./utils/ton/tonConnectLimits.js')
        expect(staticImportlar(LIMIT)).toEqual([])
    })
})
