// scripts/i18n-delta.mjs: yeni anahtarlari MEVCUT dil dosyalarina ekleyen delta araci (K25).
//
// KOK NEDEN: i18n-chunk.mjs merge tum dosyayi en.json'dan yeniden uretir ve delta modu yoktur; kapinin 91 yeni
// anahtari 10 dile eklenirken mevcut ~1535 ceviri bozulmamali, eksik / fazla / yinelenen anahtar sessizce
// gecmemeli, dosyanin satir sonu (CRLF) degismemeli. Pozitif bekciler: her "yazilmadi / degismedi" iddiasinin
// yaninda ayni yolun GERCEKTEN calistigi bir test var.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { flatten } from './messageTools'
import { SUPPORTED_LANGS } from './languages'
import { extractMissing, applyDelta, runCli } from '../../scripts/i18n-delta.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const betik = join(here, '..', '..', 'scripts', 'i18n-delta.mjs')
const dilDosyasi = (kod) => join(here, 'locales', `${kod}.json`)
const gercek = (kod) => JSON.parse(readFileSync(dilDosyasi(kod), 'utf8'))
const HEDEF_DILLER = SUPPORTED_LANGS.filter((kod) => kod !== 'en' && kod !== 'tr')

const EN = { a: { x: 'X', y: 'Y' }, b: 'B', c: { z: 'Z' } }
const LOCALE = { a: { x: 'x-ceviri' }, c: { z: 'z-ceviri' } }
const DELTA = { a: { y: 'Y-ceviri' }, b: 'B-ceviri' }

const yazi = (nesne) => JSON.stringify(nesne, null, 2) + '\n'
const kopya = (nesne) => JSON.parse(JSON.stringify(nesne))

describe('extractMissing', () => {
    it('yalniz eksik yapraklari en sirasinda ve ic ice sekilde doner', () => {
        const sonuc = extractMissing(EN, LOCALE)
        expect(sonuc).toEqual({ a: { y: 'Y' }, b: 'B' })
        expect(Object.keys(sonuc)).toEqual(['a', 'b'])
    })

    it('eksik yoksa bos nesne doner', () => {
        expect(extractMissing(EN, EN)).toEqual({})
    })

    it('locale tamamen bossa en in kendisi (kopya) doner', () => {
        const sonuc = extractMissing(EN, {})
        expect(sonuc).toEqual(EN)
        expect(sonuc).not.toBe(EN)
    })

    it('locale de fazla anahtar varsa firlatir ve noktali yolu listeler', () => {
        const fazla = { ...kopya(LOCALE), a: { x: 'x-ceviri', extra: 'e' } }
        expect(() => extractMissing(EN, fazla)).toThrow(/Fazla anahtarlar[\s\S]*a\.extra/)
    })

    it('yapi uyusmazligi (en de yaprak, locale de nesne) fazla anahtar olarak bildirilir', () => {
        expect(() => extractMissing(EN, { ...kopya(LOCALE), b: { alt: 'x' } })).toThrow(/b\.alt/)
    })

    it('girdileri DEGISTIRMEZ', () => {
        const enOnce = kopya(EN)
        const localeOnce = kopya(LOCALE)
        extractMissing(EN, LOCALE)
        expect(EN).toEqual(enOnce)
        expect(LOCALE).toEqual(localeOnce)
    })
})

describe('applyDelta', () => {
    it('mevcut cevirileri AYNEN korur ve en sirasini uygular', () => {
        const sonuc = applyDelta(EN, LOCALE, DELTA)
        expect(sonuc).toEqual({ a: { x: 'x-ceviri', y: 'Y-ceviri' }, b: 'B-ceviri', c: { z: 'z-ceviri' } })
        expect(Object.keys(sonuc)).toEqual(['a', 'b', 'c'])
        expect(Object.keys(sonuc.a)).toEqual(['x', 'y'])
    })

    it('eksik anahtar birakan delta ile firlatir (b verilmedi)', () => {
        expect(() => applyDelta(EN, LOCALE, { a: { y: 'Y-ceviri' } })).toThrow(/Eksik anahtarlar[\s\S]*- b\b/)
    })

    it('fazla anahtar iceren delta ile firlatir', () => {
        expect(() => applyDelta(EN, LOCALE, { ...kopya(DELTA), q: { r: 'x' } })).toThrow(/Fazla anahtarlar[\s\S]*q\.r/)
    })

    it('mevcut bir anahtari yeniden ceviren delta ile firlatir (a.x zaten dilde)', () => {
        expect(() => applyDelta(EN, LOCALE, { a: { x: 'yeni', y: 'Y-ceviri' }, b: 'B-ceviri' })).toThrow(/Yinelenen anahtarlar[\s\S]*a\.x/)
    })

    it('girdileri DEGISTIRMEZ ve sonuc girdilerle nesne paylasmaz', () => {
        const enOnce = kopya(EN)
        const localeOnce = kopya(LOCALE)
        const deltaOnce = kopya(DELTA)
        const sonuc = applyDelta(EN, LOCALE, DELTA)
        sonuc.a.x = 'degisti'
        expect(EN).toEqual(enOnce)
        expect(LOCALE).toEqual(localeOnce)
        expect(DELTA).toEqual(deltaOnce)
    })

    // Yapisal sagalama, ceviriden bagimsiz: delta degerleri en in kendisi. Cevirilar eklendikten sonra da gecer
    // (delta bos olur ve applyDelta dosyayi en sirasinda yeniden kurar).
    it('gercek en ve gercek de ile extractMissing sonucu applyDelta ile tam esitlenir', () => {
        const en = gercek('en')
        const de = gercek('de')
        const delta = extractMissing(en, de)
        expect(flatten(applyDelta(en, de, delta)).length).toBe(flatten(en).length)
    })

    // "Mevcut cevirilere DOKUNULMAZ" iddiasinin dayanagi: dosya JSON.stringify gidis-donusunde birebir ayni
    // (aksi halde apply, ceviri satirlarini sessizce yeniden bicimlerdi ve diff bunu gosterirdi).
    it.each(HEDEF_DILLER)('gercek %s dosyasi 2 bosluk + sonda satir sonu bicimiyle gidis-donusunde birebir ayni', (kod) => {
        const ham = readFileSync(dilDosyasi(kod), 'utf8').replace(/\r\n/g, '\n')
        expect(ham).toBe(yazi(JSON.parse(ham)))
    })
})

describe('runCli', () => {
    let gecici
    let localesDir
    let enPath
    beforeEach(() => {
        gecici = mkdtempSync(join(tmpdir(), 'i18n-delta-'))
        localesDir = join(gecici, 'locales')
        enPath = join(gecici, 'en.json')
        mkdirSync(localesDir)
        writeFileSync(enPath, yazi(EN))
        writeFileSync(join(localesDir, 'tr.json'), yazi(EN))
        for (const kod of HEDEF_DILLER) writeFileSync(join(localesDir, `${kod}.json`), yazi(LOCALE))
    })
    afterEach(() => {
        rmSync(gecici, { recursive: true, force: true })
    })

    const calistir = (argv) => {
        const satirlar = []
        runCli(argv, { log: (satir) => satirlar.push(satir), localesDir, enPath })
        return satirlar
    }
    const dizin = () => join(gecici, 'delta')
    const dosya = (kod) => join(localesDir, `${kod}.json`)
    const deltaYaz = (kod, nesne = DELTA) => {
        mkdirSync(dizin(), { recursive: true })
        writeFileSync(join(dizin(), `delta.${kod}.json`), yazi(nesne))
    }

    describe('extract', () => {
        it('on dilin eksik kumesi aynidir: delta.en.json yalniz eksik yapraklari yazar (LF, 2 bosluk, sonda satir sonu)', () => {
            const satirlar = calistir(['extract', dizin()])
            const ham = readFileSync(join(dizin(), 'delta.en.json'), 'utf8')
            expect(ham).toBe(yazi({ a: { y: 'Y' }, b: 'B' }))
            expect(ham.includes('\r')).toBe(false)
            expect(satirlar.join('\n')).toMatch(/extract: 2 yaprak/)
        })

        it('hedef dizin yoksa olusturulur', () => {
            calistir(['extract', join(gecici, 'ic', 'ice', 'dizin')])
            expect(existsSync(join(gecici, 'ic', 'ice', 'dizin', 'delta.en.json'))).toBe(true)
        })

        it('bir dilin eksik kumesi farkliysa dil kodu ve yollarla durur; delta YAZILMAZ', () => {
            writeFileSync(dosya('ja'), yazi({ a: { x: 'x-ceviri', y: 'y-ceviri' }, c: { z: 'z-ceviri' } }))
            let hata
            try {
                calistir(['extract', dizin()])
            } catch (e) {
                hata = e
            }
            expect(hata).toBeInstanceOf(Error)
            expect(hata.message).toMatch(/AYNI degil/)
            expect(hata.message).toContain('ja')
            expect(hata.message).toContain('a.y')
            expect(existsSync(join(dizin(), 'delta.en.json'))).toBe(false)
        })

        it('tr eksikse durur ve eksik yolu bildirir; delta YAZILMAZ', () => {
            writeFileSync(dosya('tr'), yazi(LOCALE))
            expect(() => calistir(['extract', dizin()])).toThrow(/tr\.json[\s\S]*- b\b/)
            expect(existsSync(join(dizin(), 'delta.en.json'))).toBe(false)
        })

        it('hedef dilde en de olmayan anahtar varsa durur (fazla anahtar)', () => {
            writeFileSync(dosya('ko'), yazi({ ...kopya(LOCALE), fazla: 'x' }))
            expect(() => calistir(['extract', dizin()])).toThrow(/Fazla anahtarlar[\s\S]*fazla/)
        })

        it('eksik anahtar yoksa dosya YAZILMAZ, "eksik anahtar yok" bildirilir', () => {
            for (const kod of HEDEF_DILLER) writeFileSync(dosya(kod), yazi(EN))
            const satirlar = calistir(['extract', dizin()])
            expect(satirlar).toEqual(['extract: eksik anahtar yok'])
            expect(existsSync(join(dizin(), 'delta.en.json'))).toBe(false)
        })
    })

    describe('apply', () => {
        it('delta yi mevcut dosyaya ekler: eski ceviriler AYNEN, en sirasi, LF + 2 bosluk + sonda satir sonu', () => {
            deltaYaz('de')
            const satirlar = calistir(['apply', 'de', dizin()])
            const ham = readFileSync(dosya('de'), 'utf8')
            expect(ham).toBe(yazi({ a: { x: 'x-ceviri', y: 'Y-ceviri' }, b: 'B-ceviri', c: { z: 'z-ceviri' } }))
            expect(satirlar.join('\n')).toMatch(/apply: 4 yaprak \(\+2 yeni\)/)
            // pozitif bekci: yalniz hedef dil degisti
            expect(readFileSync(dosya('es'), 'utf8')).toBe(yazi(LOCALE))
        })

        it('CRLF dosya CRLF kalir (satir sonu cevrimi yapilmaz), LF dosya LF kalir', () => {
            writeFileSync(dosya('fr'), yazi(LOCALE).replace(/\n/g, '\r\n'))
            deltaYaz('fr')
            calistir(['apply', 'fr', dizin()])
            const crlf = readFileSync(dosya('fr'), 'utf8')
            expect(crlf).toBe(yazi({ a: { x: 'x-ceviri', y: 'Y-ceviri' }, b: 'B-ceviri', c: { z: 'z-ceviri' } }).replace(/\n/g, '\r\n'))
            expect(crlf.replace(/\r\n/g, '').includes('\n')).toBe(false)

            deltaYaz('id')
            calistir(['apply', 'id', dizin()])
            expect(readFileSync(dosya('id'), 'utf8').includes('\r')).toBe(false)
        })

        it('bolgeli kod (pt-BR, zh-CN) kabul edilir', () => {
            for (const kod of ['pt-BR', 'zh-CN']) {
                deltaYaz(kod)
                calistir(['apply', kod, dizin()])
                expect(readFileSync(dosya(kod), 'utf8')).toContain('"B-ceviri"')
            }
        })

        it.each(['en', 'tr', 'xx', 'pt_BR', '../de', 'DE'])('desteklenen ceviri hedefi olmayan kod (%s) reddedilir; dosyalar degismez', (kod) => {
            deltaYaz(kod.replace(/[^\w-]/g, '_'))
            const trOnce = readFileSync(dosya('tr'), 'utf8')
            expect(() => calistir(['apply', kod, dizin()])).toThrow(/Gecersiz dil kodu/)
            expect(readFileSync(dosya('tr'), 'utf8')).toBe(trOnce)
            expect(readFileSync(enPath, 'utf8')).toBe(yazi(EN))
        })

        it('delta dosyasi yoksa dosya adiyla bildirilir; hedef dosya degismez', () => {
            expect(() => calistir(['apply', 'de', dizin()])).toThrow(/delta\.de\.json/)
            expect(readFileSync(dosya('de'), 'utf8')).toBe(yazi(LOCALE))
        })

        it('eksik, fazla ve yinelenen anahtarlar durdurur; hedef dosya YAZILMAZ', () => {
            const once = readFileSync(dosya('de'), 'utf8')
            deltaYaz('de', { a: { y: 'Y-ceviri' } })
            expect(() => calistir(['apply', 'de', dizin()])).toThrow(/Eksik anahtarlar[\s\S]*- b\b/)
            deltaYaz('de', { ...kopya(DELTA), q: 'x' })
            expect(() => calistir(['apply', 'de', dizin()])).toThrow(/Fazla anahtarlar[\s\S]*q/)
            deltaYaz('de', { a: { x: 'yeni', y: 'Y-ceviri' }, b: 'B-ceviri' })
            expect(() => calistir(['apply', 'de', dizin()])).toThrow(/Yinelenen anahtarlar[\s\S]*a\.x/)
            expect(readFileSync(dosya('de'), 'utf8')).toBe(once)
        })

        it('bozuk JSON delta dosyasi adiyla bildirilir', () => {
            mkdirSync(dizin(), { recursive: true })
            writeFileSync(join(dizin(), 'delta.de.json'), '{ "bozuk": ')
            expect(() => calistir(['apply', 'de', dizin()])).toThrow(/delta\.de\.json/)
        })
    })

    it.each([
        [[]],
        [['bilinmeyen']],
        [['extract']],
        [['extract', 'a', 'b']],
        [['apply']],
        [['apply', 'de']],
        [['apply', 'de', 'x', 'fazla']],
    ])('kullanim hatasi: %j', (argv) => {
        expect(() => calistir(argv)).toThrow(/Kullanim/)
    })
})

describe('betik (dis surec)', () => {
    it('ice aktarmak yan etki uretmez: hicbir sey yazilmaz ya da yazdirilmaz', () => {
        const kod = `await import(${JSON.stringify(pathToFileURL(betik).href)})`
        const sonuc = spawnSync(process.execPath, ['--input-type=module', '-e', kod], { encoding: 'utf8' })
        expect(sonuc.status).toBe(0)
        expect(sonuc.stdout).toBe('')
        expect(sonuc.stderr).toBe('')
    })

    it('dogrudan calistirilinca gecersiz kod cikis kodu 1 ve stderr mesaji verir', () => {
        const sonuc = spawnSync(process.execPath, [betik, 'apply', 'en', tmpdir()], { encoding: 'utf8' })
        expect(sonuc.status).toBe(1)
        expect(sonuc.stderr).toMatch(/Gecersiz dil kodu/)
        expect(sonuc.stdout).toBe('')
    })

    it('kullanim hatasinda cikis kodu 2 olur', () => {
        const sonuc = spawnSync(process.execPath, [betik], { encoding: 'utf8' })
        expect(sonuc.status).toBe(2)
        expect(sonuc.stderr).toMatch(/Kullanim/)
    })
})
