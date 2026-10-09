import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tonConnectDeviceInfo } from './utils/ton/tonConnectDevice'
import { yorumsuz } from './test-utils/kaynakTarama.js'

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

// Import satirinin modul yolu; `from` yoksa satirin kendisi (liste yine tutmaz).
const importKaynagi = (satir) => satir.match(/\sfrom\s+['"]([^'"]+)['"]/)?.[1] ?? satir

// Beklenen surum DOSYADAN okunur, literal degil: surum artisi testi bozmaz.
const PAKET_SURUMU = JSON.parse(oku('../package.json')).version

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

    it('appVersion uzantinin package.json surumu', () => {
        // Bos/undefined surum iki tarafi da undefined yapip testi bos yere gecirirdi.
        expect(PAKET_SURUMU).toMatch(/^\d+\.\d+\.\d+$/)
        expect(tonConnectDeviceInfo().appVersion).toBe(PAKET_SURUMU)
    })

    it('gomulu degerin appVersion alani da package.json surumu', () => {
        expect(__TON_DEVICE_INFO__.appVersion).toBe(PAKET_SURUMU)
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
        // Liste TAM: eklenen her import zinciri yeniden acabilir.
        expect(staticImportlar(CIHAZ).map(importKaynagi)).toEqual(['./tonConnectLimits', '../../../package.json'])
        expect(CIHAZ).not.toContain("from './tonConnectMessages'")

        const LIMIT = oku('./utils/ton/tonConnectLimits.js')
        expect(staticImportlar(LIMIT)).toEqual([])
    })

    it('package.json ADLI import ile ve import niteligi OLMADAN alinir', () => {
        // Varsayilan import tum package.json'u (bagimlilik listeleri dahil) pakete
        // gomer. `with { type: 'json' }` ise adli importu iki config
        // yukleyicisinde de (esbuild) kirar.
        const CIHAZ = oku('./utils/ton/tonConnectDevice.js')
        const satir = staticImportlar(CIHAZ).find((s) => importKaynagi(s) === '../../../package.json')
        expect(satir).toMatch(/^import\s*\{\s*version\s*\}\s*from\s*'\.\.\/\.\.\/\.\.\/package\.json'\s*;?$/)
    })
})

// Uygulama kaynaklari: testler ve test yardimcilari pakete girmez.
const SRC_KOKU = fileURLToPath(new URL('.', import.meta.url))
const uygulamaKaynaklari = () => readdirSync(SRC_KOKU, { recursive: true })
    .map((p) => String(p).replaceAll('\\', '/'))
    .filter((p) => /\.(?:[cm]?js|ts|vue)$/.test(p))
    .filter((p) => !/\.test\.[cm]?[jt]s$/.test(p) && !p.startsWith('test-utils/'))

describe('package.json pakete YALNIZ surumuyle girer', () => {
    // OLCULDU (vite build, 2026-10-05): cihaz betigi package.json'u servis
    // calisaninin da yukledigi ortak chunk'a tasidi. Bir ekrandaki TEK bir
    // varsayilan import, tum nesneyi (scripts, dependencies, devDependencies)
    // o chunk'a geri getiriyordu.
    it('src altinda package.json yalniz `{ version }` adli importuyla alinir', () => {
        const kabul = []
        const ihlaller = []
        for (const dosya of uygulamaKaynaklari()) {
            const kod = yorumsuz(readFileSync(join(SRC_KOKU, dosya), 'utf8'))
            for (const m of kod.matchAll(/['"`][^'"`\r\n]*package\.json[^'"`\r\n]*['"`]/g)) {
                if (/\bimport\s*\{\s*version\s*\}\s*from\s*$/.test(kod.slice(0, m.index))) kabul.push(dosya)
                else ihlaller.push(dosya)
            }
        }
        // Tarama bos yere gecmesin: bilinen adli import GORULMUS olmali.
        expect(kabul).toContain('utils/ton/tonConnectDevice.js')
        expect(ihlaller).toEqual([])
    })
})
