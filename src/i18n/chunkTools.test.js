// scripts/i18n-chunk.mjs: ceviri bolme/birlestirme araci.
//
// KOK NEDEN: 10 yeni dilin ceviri ajanlari en.json'u (~1500 yaprak) tek seferde ceviremez;
// arac onu ~150 yaprakli parcalara boler, her parca ayri cevrilir, sonra birlestirilir.
// Birlestirme sessizce bir anahtari dusurur ya da fazladan anahtar kabul ederse eksik/artik
// ceviri allLocales.test.js'e kadar fark edilmez; bu yuzden birlestirme eksik/fazla/yinelenen
// anahtarlarin HEPSINI noktali yolla listeleyen bir hatayla durmalidir.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import { flatten } from './messageTools'
import { splitLeaves, mergeChunks, runCli } from '../../scripts/i18n-chunk.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const betik = join(here, '..', '..', 'scripts', 'i18n-chunk.mjs')
const gercekEn = JSON.parse(readFileSync(join(here, 'locales', 'en.json'), 'utf8'))

const KUCUK_EN = {
    common: { ok: 'OK', cancel: 'Cancel', retry: 'Retry' },
    send: { title: 'Send', errors: { empty: 'Enter an amount', low: 'Balance too low' } },
    footer: 'Done',
}

const nesneMi = (deger) => deger !== null && typeof deger === 'object' && !Array.isArray(deger)
const yaprakSayisi = (nesne) => flatten(nesne).length
const yazi = (nesne) => JSON.stringify(nesne, null, 2) + '\n'
const kopya = (nesne) => JSON.parse(JSON.stringify(nesne))
// Her yaprak degerini donusturur (ceviri ajaninin isini taklit eder).
const degerleriDegistir = (nesne, donustur) =>
    Object.fromEntries(Object.entries(nesne).map(([k, v]) => [k, nesneMi(v) ? degerleriDegistir(v, donustur) : donustur(v)]))
// Anahtar sirasini her duzeyde tersine cevirir.
const tersSirala = (nesne) =>
    Object.fromEntries(Object.entries(nesne).reverse().map(([k, v]) => [k, nesneMi(v) ? tersSirala(v) : v]))

describe('splitLeaves', () => {
    it('her parca en fazla `size` yaprak tasir ve yaprak sirasi korunur', () => {
        const parcalar = splitLeaves(KUCUK_EN, 2)
        expect(parcalar.length).toBe(4)
        for (const parca of parcalar) expect(yaprakSayisi(parca)).toBeLessThanOrEqual(2)
        // Parcalar art arda okununca yaprak dizisi kaynakla birebir ayni.
        expect(parcalar.flatMap((parca) => flatten(parca))).toEqual(flatten(KUCUK_EN))
    })

    it('ic ice yapiyi korur ve bir ad alani birden fazla parcaya bolunebilir', () => {
        const parcalar = splitLeaves(KUCUK_EN, 2)
        expect(parcalar[0]).toEqual({ common: { ok: 'OK', cancel: 'Cancel' } })
        expect(parcalar[1]).toEqual({ common: { retry: 'Retry' }, send: { title: 'Send' } })
        expect(parcalar[2]).toEqual({ send: { errors: { empty: 'Enter an amount', low: 'Balance too low' } } })
        expect(parcalar[3]).toEqual({ footer: 'Done' })
    })

    it('size yaprak sayisindan buyukse tek parca doner', () => {
        expect(splitLeaves(KUCUK_EN, 150)).toEqual([KUCUK_EN])
    })

    it('size yaprak sayisina tam bolunurse son parca bos kalmaz', () => {
        expect(splitLeaves({ a: '1', b: '2', c: '3', d: '4' }, 2)).toEqual([{ a: '1', b: '2' }, { c: '3', d: '4' }])
    })

    it('bos nesne -> parca yok', () => {
        expect(splitLeaves({}, 150)).toEqual([])
    })

    it('kaynak nesneyi degistirmez', () => {
        const once = JSON.stringify(KUCUK_EN)
        splitLeaves(KUCUK_EN, 2)
        expect(JSON.stringify(KUCUK_EN)).toBe(once)
    })

    it.each([0, -1, 1.5, NaN, '2', undefined])('gecersiz size (%s) hata verir', (size) => {
        expect(() => splitLeaves(KUCUK_EN, size)).toThrow(/size/)
    })
})

describe('mergeChunks', () => {
    it('kucuk en: parcalar birlesince JSON olarak en ile esittir (sira dahil)', () => {
        const sonuc = mergeChunks(KUCUK_EN, splitLeaves(KUCUK_EN, 2))
        expect(JSON.stringify(sonuc)).toBe(JSON.stringify(KUCUK_EN))
    })

    it('sonuc en anahtar sirasindadir: parca ve anahtar sirasi ters olsa da', () => {
        const parcalar = splitLeaves(KUCUK_EN, 2).reverse().map(tersSirala)
        const sonuc = mergeChunks(KUCUK_EN, parcalar)
        expect(JSON.stringify(sonuc)).toBe(JSON.stringify(KUCUK_EN))
        expect(Object.keys(sonuc)).toEqual(['common', 'send', 'footer'])
        expect(Object.keys(sonuc.send)).toEqual(['title', 'errors'])
    })

    it('ceviri degerleri korunur: anahtarlar en ile ayni, degerler farkli', () => {
        const ceviri = splitLeaves(KUCUK_EN, 3).map((parca) => degerleriDegistir(parca, (deger) => `${deger}!`))
        const sonuc = mergeChunks(KUCUK_EN, ceviri)
        expect(sonuc).toEqual(degerleriDegistir(KUCUK_EN, (deger) => `${deger}!`))
        expect(Object.keys(sonuc)).toEqual(['common', 'send', 'footer'])
    })

    it('bir anahtar silinince hata o anahtarin noktali yolunu icerir', () => {
        const parcalar = splitLeaves(KUCUK_EN, 2)
        delete parcalar[2].send.errors.low
        expect(() => mergeChunks(KUCUK_EN, parcalar)).toThrow(/send\.errors\.low/)
    })

    it('fazladan anahtar eklenince hata onu icerir', () => {
        const parcalar = splitLeaves(KUCUK_EN, 2)
        parcalar[3].extra = { yeni: 'x' }
        expect(() => mergeChunks(KUCUK_EN, parcalar)).toThrow(/extra\.yeni/)
    })

    it('eksik VE fazla anahtarlarin HEPSINI listeler (ilkinde durmaz)', () => {
        const parcalar = splitLeaves(KUCUK_EN, 2)
        delete parcalar[0].common.ok
        delete parcalar[2].send.errors.empty
        parcalar[3].a = { b: 'x' }
        parcalar[3].c = 'y'
        let hata
        try {
            mergeChunks(KUCUK_EN, parcalar)
        } catch (e) {
            hata = e
        }
        expect(hata).toBeInstanceOf(Error)
        for (const yol of ['common.ok', 'send.errors.empty', 'a.b', 'c']) expect(hata.message).toContain(yol)
        // Eksik ve fazla ayri bolumlerde: eksikler once, fazlalar sonra.
        const eksik = hata.message.indexOf('Eksik')
        const fazla = hata.message.indexOf('Fazla')
        expect(eksik).toBeGreaterThanOrEqual(0)
        expect(fazla).toBeGreaterThan(eksik)
        expect(hata.message.indexOf('common.ok')).toBeGreaterThan(eksik)
        expect(hata.message.indexOf('common.ok')).toBeLessThan(fazla)
        expect(hata.message.indexOf('a.b')).toBeGreaterThan(fazla)
    })

    it('ayni anahtar iki parcada gecerse yinelenen olarak bildirilir', () => {
        const parcalar = splitLeaves(KUCUK_EN, 2)
        parcalar[3].common = { ok: 'Tamam' }
        expect(() => mergeChunks(KUCUK_EN, parcalar)).toThrow(/Yinelenen[\s\S]*common\.ok/)
    })

    it('yaprak yerine nesne gelirse (yapi uyusmazligi) hem eksik hem fazla bildirilir', () => {
        const parcalar = splitLeaves(KUCUK_EN, 2)
        parcalar[3] = { footer: { icerik: 'Done' } }
        let hata
        try {
            mergeChunks(KUCUK_EN, parcalar)
        } catch (e) {
            hata = e
        }
        expect(hata.message).toContain('footer.icerik')
        expect(hata.message).toMatch(/Eksik[\s\S]*- footer\n/)
    })

    it('nesne olmayan parca sira numarasiyla bildirilir', () => {
        expect(() => mergeChunks(KUCUK_EN, [null])).toThrow(/parca 1/)
        expect(() => mergeChunks(KUCUK_EN, [['a']])).toThrow(/parca 1/)
    })

    it('girdileri degistirmez ve sonuc en ile ortak nesne paylasmaz', () => {
        const parcalar = splitLeaves(KUCUK_EN, 2)
        const once = JSON.stringify(parcalar)
        const sonuc = mergeChunks(KUCUK_EN, parcalar)
        expect(JSON.stringify(parcalar)).toBe(once)
        sonuc.common.ok = 'degisti'
        expect(KUCUK_EN.common.ok).toBe('OK')
        expect(parcalar[0].common.ok).toBe('OK')
    })

    it('gercek en.json: mergeChunks(en, splitLeaves(en, 150)) en ile esittir', () => {
        const parcalar = splitLeaves(gercekEn, 150)
        expect(parcalar.length).toBe(Math.ceil(yaprakSayisi(gercekEn) / 150))
        for (const parca of parcalar) expect(yaprakSayisi(parca)).toBeLessThanOrEqual(150)
        expect(JSON.stringify(mergeChunks(gercekEn, parcalar))).toBe(JSON.stringify(gercekEn))
    })
})

describe('runCli', () => {
    let gecici
    let dilDizini
    beforeEach(() => {
        gecici = mkdtempSync(join(tmpdir(), 'i18n-chunk-'))
        dilDizini = join(gecici, 'locales')
    })
    afterEach(() => {
        rmSync(gecici, { recursive: true, force: true })
    })

    // runCli kaynak olarak GERCEK en.json'u okur; merge hedefi (locales dizini) gecicidir.
    const calistir = (argv) => {
        const satirlar = []
        runCli(argv, { log: (satir) => satirlar.push(satir), localesDir: dilDizini })
        return satirlar
    }
    // NN.en.json dosyalarini NN.<kod>.json olarak, degerleri `donustur` ile cevirip yazar.
    const ceviriTaklidi = (dizin, kod, donustur = (deger) => deger) => {
        for (const ad of readdirSync(dizin).filter((a) => a.endsWith('.en.json'))) {
            const parca = JSON.parse(readFileSync(join(dizin, ad), 'utf8'))
            writeFileSync(join(dizin, ad.replace('.en.json', `.${kod}.json`)), yazi(degerleriDegistir(parca, donustur)))
        }
    }

    it('split: varsayilan boyut 150, NN.en.json dosyalari LF + 2 bosluk girintili', () => {
        const cikti = join(gecici, 'es')
        const satirlar = calistir(['split', cikti])
        const dosyalar = readdirSync(cikti).sort()
        expect(dosyalar[0]).toBe('01.en.json')
        expect(dosyalar.every((ad) => /^\d{2,}\.en\.json$/.test(ad))).toBe(true)
        expect(dosyalar.length).toBe(Math.ceil(yaprakSayisi(gercekEn) / 150))
        const ham = readFileSync(join(cikti, '01.en.json'), 'utf8')
        expect(ham).toBe(yazi(JSON.parse(ham)))
        expect(yaprakSayisi(JSON.parse(ham))).toBeLessThanOrEqual(150)
        expect(satirlar.join('\n')).toMatch(new RegExp(`${yaprakSayisi(gercekEn)}.*${dosyalar.length}`))
    })

    it('split: boyut argumani uygulanir', () => {
        const cikti = join(gecici, 'de')
        calistir(['split', cikti, '400'])
        expect(readdirSync(cikti).length).toBe(Math.ceil(yaprakSayisi(gercekEn) / 400))
    })

    it('split -> ceviri taklidi -> merge: locales/<kod>.json yazilir (en sirasinda, LF, sondaki satir sonu)', () => {
        const dizin = join(gecici, 'de')
        calistir(['split', dizin, '200'])
        ceviriTaklidi(dizin, 'de', (deger) => `${deger}~`)
        calistir(['merge', 'de', dizin])
        const hedef = join(dilDizini, 'de.json')
        const ham = readFileSync(hedef, 'utf8')
        expect(ham).toBe(yazi(degerleriDegistir(gercekEn, (deger) => `${deger}~`)))
        expect(ham.includes('\r')).toBe(false)
    })

    it('merge: 30+ parcayi (iki haneli numaralar dahil) birlestirir', () => {
        const dizin = join(gecici, 'fr')
        calistir(['split', dizin, '50']) // 30+ parca: 01..31
        ceviriTaklidi(dizin, 'fr')
        calistir(['merge', 'fr', dizin])
        expect(JSON.parse(readFileSync(join(dilDizini, 'fr.json'), 'utf8'))).toEqual(gercekEn)
        expect(readFileSync(join(dilDizini, 'fr.json'), 'utf8')).toBe(yazi(gercekEn))
    })

    it('merge: eksik anahtar varsa hata verir ve hedef dosya YAZILMAZ', () => {
        const dizin = join(gecici, 'ja')
        calistir(['split', dizin, '150'])
        ceviriTaklidi(dizin, 'ja')
        const [ilkAnahtar] = flatten(JSON.parse(readFileSync(join(dizin, '01.ja.json'), 'utf8')))[0]
        const parca = JSON.parse(readFileSync(join(dizin, '01.ja.json'), 'utf8'))
        let imlec = parca
        const yol = ilkAnahtar.split('.')
        for (const ad of yol.slice(0, -1)) imlec = imlec[ad]
        delete imlec[yol[yol.length - 1]]
        writeFileSync(join(dizin, '01.ja.json'), yazi(parca))
        expect(() => calistir(['merge', 'ja', dizin])).toThrow(ilkAnahtar)
        expect(existsSync(join(dilDizini, 'ja.json'))).toBe(false)
    })

    it('merge: bozuk JSON dosyasi adiyla bildirilir', () => {
        const dizin = join(gecici, 'ko')
        calistir(['split', dizin, '150'])
        ceviriTaklidi(dizin, 'ko')
        writeFileSync(join(dizin, '02.ko.json'), '{ "bozuk": ')
        expect(() => calistir(['merge', 'ko', dizin])).toThrow(/02\.ko\.json/)
    })

    it('merge: dizinde o dile ait parca yoksa hata verir', () => {
        const dizin = join(gecici, 'bos')
        calistir(['split', dizin, '150']) // yalniz *.en.json var
        expect(() => calistir(['merge', 'ru', dizin])).toThrow(/ru/)
        expect(() => calistir(['merge', 'ru', join(gecici, 'yok')])).toThrow()
    })

    it.each(['en', 'tr', 'xx', 'pt_BR', '../de', 'DE'])('merge: desteklenen ceviri hedefi olmayan kod (%s) reddedilir', (kod) => {
        const dizin = join(gecici, 'kaynak')
        calistir(['split', dizin, '150'])
        expect(() => calistir(['merge', kod, dizin])).toThrow(/kod/i)
        expect(existsSync(dilDizini)).toBe(false)
    })

    it('merge: bolgeli kod (pt-BR, zh-CN) kabul edilir', () => {
        const dizin = join(gecici, 'pt')
        calistir(['split', dizin, '500'])
        ceviriTaklidi(dizin, 'pt-BR')
        calistir(['merge', 'pt-BR', dizin])
        expect(existsSync(join(dilDizini, 'pt-BR.json'))).toBe(true)
    })

    it.each([
        [[]],
        [['bilinmeyen']],
        [['split']],
        [['merge']],
        [['merge', 'de']],
        [['split', 'x', 'abc']],
        [['split', 'x', '0']],
        [['split', 'x', '1.5']],
        [['split', 'x', '-3']],
        [['split', 'x', '150', 'fazla']],
    ])('kullanim hatasi: %j', (argv) => {
        expect(() => calistir(argv)).toThrow(/Kullanim/)
    })
})

describe('betik (dis surec)', () => {
    let gecici
    beforeEach(() => {
        gecici = mkdtempSync(join(tmpdir(), 'i18n-chunk-proc-'))
    })
    afterEach(() => {
        rmSync(gecici, { recursive: true, force: true })
    })

    it('ice aktarmak yan etki uretmez: hicbir sey yazilmaz ya da yazdirilmaz', () => {
        const kod = `await import(${JSON.stringify(pathToFileURL(betik).href)})`
        const sonuc = spawnSync(process.execPath, ['--input-type=module', '-e', kod], { encoding: 'utf8' })
        expect(sonuc.status).toBe(0)
        expect(sonuc.stdout).toBe('')
        expect(sonuc.stderr).toBe('')
    })

    it('dogrudan calistirilinca split calisir (elle duman testi): 01.en.json olusur', () => {
        const cikti = execFileSync(process.execPath, [betik, 'split', gecici, '150'], { encoding: 'utf8' })
        expect(existsSync(join(gecici, '01.en.json'))).toBe(true)
        expect(cikti).toContain(String(yaprakSayisi(gercekEn)))
    })

    it('dogrudan calistirilinca hata cikis kodu 1 ve stderr mesaji verir', () => {
        const sonuc = spawnSync(process.execPath, [betik, 'merge', 'en', gecici], { encoding: 'utf8' })
        expect(sonuc.status).toBe(1)
        expect(sonuc.stderr).toMatch(/kod/i)
        expect(sonuc.stdout).toBe('')
    })

    it('kullanim hatasinda cikis kodu 2 olur', () => {
        const sonuc = spawnSync(process.execPath, [betik], { encoding: 'utf8' })
        expect(sonuc.status).toBe(2)
        expect(sonuc.stderr).toMatch(/Kullanim/)
    })
})
