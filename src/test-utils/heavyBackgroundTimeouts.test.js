import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { heavyBackgroundTimeouts, HEAVY_BACKGROUND_TEST_TIMEOUT_MS, HEAVY_BACKGROUND_HOOK_TIMEOUT_MS } from './heavyBackgroundTimeouts.js'

// Yardimci yalniz BU dosyanin sinirini degistirir (vitest.config.js'e dokunulmaz).
heavyBackgroundTimeouts()

describe('heavyBackgroundTimeouts (T28)', () => {
    it('test 30 sn, hook 60 sn: istek degerleri', () => {
        expect(HEAVY_BACKGROUND_TEST_TIMEOUT_MS).toBe(30000)
        expect(HEAVY_BACKGROUND_HOOK_TIMEOUT_MS).toBe(60000)
    })

    // Gercek etki: kosucunun bu dosya icin kullandigi sinirlar (vitest.config.js 15 sn / 30 sn verir).
    // NOT (T29, M3): vitest 2.1.9 toplanan testin GECERLI zaman asimini acik bir API ile vermiyor (task.timeout
    // doldurulmaz; sinir yalniz runner.config.testTimeout'tan withTimeout'a kapanir). Gercek bir testin 15 sn'yi
    // asmasini beklemek ise bu dosyayi yarim dakika yavaslatirdi. Bu yuzden kosucunun yapilandirmasi okunur:
    // vitest test zaman asimini TOPLAMA aninda bu nesneden okur, yardimci modul yuklenirken cagrildigi icin
    // sonraki tum testler icin gecerlidir. Surum yukselip task.timeout / test baglami API'si gelirse burasi
    // onunla degistirilmelidir.
    it('yardimci kosucunun gercek test ve hook sinirini degistirir', () => {
        const config = globalThis.__vitest_worker__.config
        expect(config.testTimeout).toBe(30000)
        expect(config.hookTimeout).toBe(60000)
    })

    // Yeni bir test dosyasi gercek background.js'i (dogrudan ya da bir harness uzerinden) ayaga kaldirir da
    // yardimci unutulursa yuk altinda yine 15 sn'de sahte hata verirdi. Tarama ADA degil ICERIGE bakar ve harness
    // modullerinin adlarini ELLE TUTMAZ (T29 M4): src/ altindaki TEST OLMAYAN modullerden background.js'i ice
    // aktaranlar harness'tir; onlari (ve onlari ice aktaran modulleri) ice aktaran her *.test.js "ayaga kaldirir"
    // sayilir.
    const kok = fileURLToPath(new URL('..', import.meta.url))
    const tumDosyalar = readdirSync(kok, { recursive: true }).map((p) => String(p).replace(/\\/g, '/'))
    const testMi = (p) => /\.test\.js$/.test(p)
    const kaynakOku = (p) => readFileSync(kok + p, 'utf-8')
    const cagirir = (kaynak) => /^heavyBackgroundTimeouts\(\)$/m.test(kaynak)
    // Belirleyici ice aktarma bicimleri: `from '../background.js'`, `import('../background')`, `importActual('./background.js')`.
    const BG_IMPORT = /(?:from\s*|(?:import|importActual)\(\s*)['"](?:\.\.?\/)+background(?:\.js)?['"]/
    const modulAdi = (p) => p.split('/').pop().replace(/\.(?:js|vue)$/, '')
    const importEder = (kaynak, ad) =>
        new RegExp(String.raw`(?:from\s*|(?:import|importActual)\(\s*)['"][^'"]*\/` + ad + String.raw`(?:\.js)?['"]`).test(kaynak)

    // background.js'i ayaga kaldiran modullerin kapanisi: dogrudan ice aktaranlar + onlari ice aktaran test olmayan moduller.
    function harnessModulleri() {
        const moduller = tumDosyalar.filter((p) => /\.(?:js|vue)$/.test(p) && !testMi(p) && p !== 'background.js')
        const harness = new Set(moduller.filter((p) => BG_IMPORT.test(kaynakOku(p))))
        let buyudu = true
        while (buyudu) {
            buyudu = false
            for (const p of moduller) {
                if (harness.has(p)) continue
                const kaynak = kaynakOku(p)
                if ([...harness].some((h) => importEder(kaynak, modulAdi(h)))) { harness.add(p); buyudu = true }
            }
        }
        return [...harness]
    }
    const ayagaKaldirir = (kaynak, harnessAdlari) =>
        BG_IMPORT.test(kaynak) || harnessAdlari.some((ad) => importEder(kaynak, ad))

    it('background.js i ADI NE OLURSA OLSUN (harness dahil) ayaga kaldiran HER test dosyasi yardimciyi cagirir', () => {
        const harness = harnessModulleri()
        // Tarama bilinen harness'leri gercekten buluyor mu? (Bulamazsa asagidaki tarama bos kalir ve her sey gecerdi.)
        expect(harness).toEqual(expect.arrayContaining(['test-utils/backgroundHarness.js', 'test-utils/dappProtocolHarness.js']))
        const adlar = harness.map(modulAdi)
        const dosyalar = tumDosyalar.filter((p) => testMi(p) && p !== 'test-utils/heavyBackgroundTimeouts.test.js')
        const ayaktaOlanlar = dosyalar.filter((p) => ayagaKaldirir(kaynakOku(p), adlar))
        // Tarama harness uzerinden kaldiranlari (background.* adini tasimayanlari) gercekten yakaliyor mu?
        expect(ayaktaOlanlar).toContain('evmDappProtocolConformance.test.js')
        const eksik = ayaktaOlanlar.filter((p) => !cagirir(kaynakOku(p)))
        expect(eksik).toEqual([])
    })

    // Agir anahtar turetme (PBKDF2 / TON turetme) ve manifest cozumleme dosyalari background'u yuklemez ama ayni yukte 15 sn'yi asiyordu.
    it('agir turetme ve manifest dosyalari da yardimciyi cagirir', () => {
        const adlar = [
            'utils/solanaDappFunctions.disconnect.test.js',
            'utils/ton/hybridTonAccount.test.js', 'utils/ton/tonMamMnemonic.test.js', 'utils/ton/tonExport.test.js',
            'utils/ton/tonFromSeed.test.js', 'utils/ton/newAccountTonAddress.test.js',
            'utils/ton/tonAccount.test.js', 'utils/ton/evmFromTon.test.js',
            'utils/cryptoUtils.reencrypt.test.js', 'utils/ton/tonIdentity.test.js', 'utils/passwordChange.test.js',
            'components/screenSetupPageWrite.ssr.test.js',
            'manifestDevKey.test.js', 'manifestSolanaGate.test.js',
        ]
        const eksik = adlar.filter((p) => !cagirir(kaynakOku(p)))
        expect(eksik).toEqual([])
    })

    // Tarama kendi kendini sinar: harness'i kullanan ama yardimciyi cagirmayan kaynak YAKALANMALI.
    it('tarama harness kullanip yardimciyi unutan sentetik kaynagi yakalar', () => {
        const unutulmus = "import { createDappEnv } from './test-utils/dappProtocolHarness.js'\nit('x', () => {})\n"
        expect(ayagaKaldirir(unutulmus, ['dappProtocolHarness']) && !cagirir(unutulmus)).toBe(true)
        const dogru = unutulmus + 'heavyBackgroundTimeouts()\n'
        expect(ayagaKaldirir(dogru, ['dappProtocolHarness']) && !cagirir(dogru)).toBe(false)
        expect(ayagaKaldirir("const m = await import('../background.js')\n", [])).toBe(true)
        // Ilgisiz bir ice aktarma yakalanmaz.
        expect(ayagaKaldirir("import { x } from './utils/backgroundTasks.js'\n", ['dappProtocolHarness'])).toBe(false)
    })
})
