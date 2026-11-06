// Para birimi katalogu: haric tutma, populer liste, bolge -> birim esleme,
// secilebilir liste, gruplama ve arama. Modul SAF (ag/depo/chrome yok).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
    EXCLUDED_CURRENCIES,
    POPULAR_CURRENCIES,
    REGION_CURRENCY,
    normalizeCurrencyCode,
    defaultCurrencyFor,
    selectableCurrencies,
    groupCurrencies,
    searchCurrencies,
    currencyDisplayName,
} from './currencyCatalog'

// Sunucu allowlist'i (server/utils/fx.js FIAT_CURRENCIES) METIN olarak okunur:
// modulu import etmek mongoose'u yukler, bu testin ise baglantiya ihtiyaci yok.
function serverAllowlist() {
    const text = readFileSync(fileURLToPath(new URL('../../../server/utils/fx.js', import.meta.url)), 'utf8')
    return new Set([...text.matchAll(/^\s*'([a-z]{3})':\s*\{ name:/gm)].map((m) => m[1]))
}

const entry = (code, name, symbol) => ({ code, name, symbol })

// /getRates `currencies` biciminde (code, name, symbol) kucuk bir katalog. vef ve xdr
// bilerek icinde: sunucu bugun bunlari donuyor, istemci ayiklamali.
const CATALOG = [
    entry('usd', 'US Dollar', '$'),
    entry('try', 'Turkish Lira', '₺'),
    entry('eur', 'Euro', '€'),
    entry('gbp', 'British Pound Sterling', '£'),
    entry('cad', 'Canadian Dollar', 'CA$'),
    entry('aud', 'Australian Dollar', 'A$'),
    entry('kwd', 'Kuwaiti Dinar', 'KWD'),
    entry('lbp', 'Lebanese Pound', 'LBP'),
    entry('zar', 'South African Rand', 'R'),
    entry('vef', 'Venezuelan Bolivar Fuerte', 'VEF'),
    entry('xdr', 'IMF Special Drawing Rights', 'XDR'),
]
const RATES = {
    usd: 1, try: 34.5, eur: 0.92, gbp: 0.78, cad: 1.36, aud: 1.5, kwd: 0.31, lbp: 89500, zar: 18, vef: 1, xdr: 0.75,
}
const codes = (list) => list.map((e) => e.code)

describe('sabit listeler', () => {
    it('haric tutma listesi kilitli', () => {
        expect(EXCLUDED_CURRENCIES).toEqual(['vef', 'xdr'])
    })

    it('populer liste ve SIRASI kilitli, haric tutulanlari icermez', () => {
        expect(POPULAR_CURRENCIES).toEqual([
            'usd', 'eur', 'try', 'gbp', 'rub', 'brl', 'cny', 'jpy', 'krw', 'vnd', 'idr', 'inr',
        ])
        for (const code of EXCLUDED_CURRENCIES) expect(POPULAR_CURRENCIES).not.toContain(code)
    })

    it('sabit listeler disaridan degistirilemez', () => {
        expect(() => EXCLUDED_CURRENCIES.push('usd')).toThrow()
        expect(() => POPULAR_CURRENCIES.sort()).toThrow()
        expect(() => { REGION_CURRENCY.XX = 'usd' }).toThrow()
    })
})

describe('normalizeCurrencyCode', () => {
    it('3 harfli kodu kucultur ve kirpar', () => {
        expect(normalizeCurrencyCode('TRY')).toBe('try')
        expect(normalizeCurrencyCode(' try ')).toBe('try')
        expect(normalizeCurrencyCode('Usd')).toBe('usd')
        expect(normalizeCurrencyCode('eur')).toBe('eur')
    })

    // Uyelik karari resolveDisplay'in (kur tablosu); burada yalniz soz dizimi denetlenir.
    it('soz diziminde gecerli ama bilinmeyen kod gecer (XYZ -> xyz)', () => {
        expect(normalizeCurrencyCode('XYZ')).toBe('xyz')
    })

    it('haric tutulanlar null', () => {
        expect(normalizeCurrencyCode('vef')).toBeNull()
        expect(normalizeCurrencyCode('VEF')).toBeNull()
        expect(normalizeCurrencyCode('xdr')).toBeNull()
        expect(normalizeCurrencyCode(' XDR ')).toBeNull()
    })

    it('3 harf olmayan her sey null', () => {
        for (const bad of ['tr', 'usdt', '', '   ', '123', 'tr1', 't r', 'tr_', 'US$']) {
            expect(normalizeCurrencyCode(bad), JSON.stringify(bad)).toBeNull()
        }
    })

    it('dize olmayan girdi null', () => {
        for (const bad of [123, null, undefined, {}, ['try'], true, NaN]) {
            expect(normalizeCurrencyCode(bad), String(bad)).toBeNull()
        }
    })

    // toLowerCase() bazi ASCII-disi harfleri ASCII'ye katlar (Kelvin isareti -> k);
    // kod once ASCII olarak dogrulanmali yoksa "KES" (Kenya) gibi bir kod uydurulabilir.
    it('ASCII-disi harfler ASCII koda katlanmaz', () => {
        expect(normalizeCurrencyCode('Kes')).toBeNull()
        expect(normalizeCurrencyCode('ＴＲＹ')).toBeNull() // tam genislikli TRY
        expect(normalizeCurrencyCode('TRİ')).toBeNull()
        expect(normalizeCurrencyCode('trı')).toBeNull()
    })
})

describe('defaultCurrencyFor', () => {
    it('bolge esleme', () => {
        expect(defaultCurrencyFor(['tr-TR', 'en-US'])).toBe('try')
        expect(defaultCurrencyFor(['de-DE'])).toBe('eur')
        expect(defaultCurrencyFor(['pt-BR'])).toBe('brl')
        expect(defaultCurrencyFor(['es-MX'])).toBe('mxn')
        expect(defaultCurrencyFor(['tr-tr'])).toBe('try') // buyuk/kucuk harf
        expect(defaultCurrencyFor(['zh-Hans-CN'])).toBe('cny') // betik alt etiketi
    })

    it('ilk dil kazanir, eslesmezse usd', () => {
        expect(defaultCurrencyFor(['en-US', 'tr-TR'])).toBe('usd')
        expect(defaultCurrencyFor(['xx-ZZ'])).toBe('usd')
        expect(defaultCurrencyFor([])).toBe('usd')
        expect(defaultCurrencyFor(undefined)).toBe('usd')
        expect(defaultCurrencyFor(null)).toBe('usd')
    })

    it('bolgesiz dil: yalniz tek ulkeli diller (tr, ja, ko, vi, id)', () => {
        expect(defaultCurrencyFor(['tr'])).toBe('try')
        expect(defaultCurrencyFor(['ja'])).toBe('jpy')
        expect(defaultCurrencyFor(['ko'])).toBe('krw')
        expect(defaultCurrencyFor(['vi'])).toBe('vnd')
        expect(defaultCurrencyFor(['id'])).toBe('idr')
        expect(defaultCurrencyFor(['en'])).toBe('usd')
        expect(defaultCurrencyFor(['de'])).toBe('usd')
        expect(defaultCurrencyFor(['es'])).toBe('usd')
        expect(defaultCurrencyFor(['pt'])).toBe('usd')
        expect(defaultCurrencyFor(['zh'])).toBe('usd')
    })

    it('bolge yoksa dil tablosu kasa duyarsiz', () => {
        expect(defaultCurrencyFor(['TR'])).toBe('try')
        expect(defaultCurrencyFor(['Ja'])).toBe('jpy')
    })

    it('betik alt etiketi ve sayisal bolge, bolge sayilmaz', () => {
        expect(defaultCurrencyFor(['zh-Hant-TW'])).toBe('twd')
        expect(defaultCurrencyFor(['zh-Hant-HK'])).toBe('hkd')
        expect(defaultCurrencyFor(['zh-Hans'])).toBe('usd') // bolge yok, zh tek ulkeli dil degil
        expect(defaultCurrencyFor(['sr-Latn'])).toBe('usd')
        expect(defaultCurrencyFor(['es-419'])).toBe('usd') // 419 = Latin Amerika, birim belirsiz
    })

    // "-u-" ile baslayan uzanti alt etiketlerinin anahtarlari (ca, nu, hc ...) iki harflidir;
    // bolge sanilirsa "en-US-u-ca-gregory" Kanada dolari olurdu.
    it('uzanti alt etiketleri bolge sanilmaz', () => {
        expect(defaultCurrencyFor(['en-US-u-ca-gregory'])).toBe('usd')
        expect(defaultCurrencyFor(['de-DE-u-nu-latn'])).toBe('eur')
        expect(defaultCurrencyFor(['tr-u-ca-gregory'])).toBe('try') // bolgesiz: dil tablosu
        expect(defaultCurrencyFor(['en-x-ab'])).toBe('usd')
    })

    it('alt cizgi ayirac, karisik harf kasasi ve bosluk kabul edilir', () => {
        expect(defaultCurrencyFor(['pt_BR'])).toBe('brl')
        expect(defaultCurrencyFor(['TR-tr'])).toBe('try')
        expect(defaultCurrencyFor(['  tr-TR '])).toBe('try')
    })

    it('dize olmayan ya da bos ilk eleman usd', () => {
        for (const bad of [[null], [undefined], [123], [{}], [''], ['   '], ['*']]) {
            expect(defaultCurrencyFor(bad), JSON.stringify(bad)).toBe('usd')
        }
    })

    it('cikti her zaman gecerli, haric tutulmayan kod', () => {
        for (const lang of ['tr-TR', 'de-DE', 'xx-ZZ', 'ja', 'en', '', 'es-VE']) {
            const code = defaultCurrencyFor([lang])
            expect(normalizeCurrencyCode(code), lang).toBe(code)
        }
    })
})

describe('REGION_CURRENCY', () => {
    it('degerleri haric degil ve server allowlist alt kumesi', () => {
        const allowlist = serverAllowlist()
        // Regex bozulursa test bos kumeyle sessizce yesil kalmasin.
        expect(allowlist.size).toBeGreaterThanOrEqual(50)
        expect(allowlist.has('usd')).toBe(true)
        expect(allowlist.has('try')).toBe(true)
        for (const [region, code] of Object.entries(REGION_CURRENCY)) {
            expect(region, 'bolge anahtari').toMatch(/^[A-Z]{2}$/)
            expect(normalizeCurrencyCode(code), `${region} -> ${code}`).toBe(code)
            expect(EXCLUDED_CURRENCIES, `${region} -> ${code}`).not.toContain(code)
            expect(allowlist.has(code), `${region} -> ${code} sunucu allowlist'inde yok`).toBe(true)
        }
    })

    it('euro bolgesi ulkeleri eur', () => {
        const euro = ['AT', 'BE', 'CY', 'DE', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PT', 'SI', 'SK']
        for (const region of euro) {
            expect(REGION_CURRENCY[region], region).toBe('eur')
            expect(defaultCurrencyFor([`en-${region}`]), region).toBe('eur')
        }
    })

    it('Bulgaristan 2026-01-01 den beri euro bolgesinde', () => {
        expect(REGION_CURRENCY.BG).toBe('eur')
        expect(defaultCurrencyFor(['bg-BG'])).toBe('eur')
    })

    it('euro disi AB uyeleri kendi birimini alir', () => {
        expect(defaultCurrencyFor(['pl-PL'])).toBe('pln')
        expect(defaultCurrencyFor(['sv-SE'])).toBe('sek')
        expect(defaultCurrencyFor(['da-DK'])).toBe('dkk')
        expect(defaultCurrencyFor(['cs-CZ'])).toBe('czk')
        expect(defaultCurrencyFor(['hu-HU'])).toBe('huf')
        expect(defaultCurrencyFor(['ro-RO'])).toBe('ron')
    })

    // Sunucu allowlist'indeki birimlerin ulkesi (2026-08-23 listesi: 60 birimin vef/xdr
    // disindaki 58'i; eur yukarida, svc asagida El Salvador istisnasi, kalan 56'si bu
    // tabloda). Tablo kasten SABIT yazildi: sunucuya yeni birim eklenince bu test
    // kirilmasin (istemcide statik izinli liste tutulmaz).
    const ULKE_BIRIM = [
        ['US', 'usd'], ['TR', 'try'], ['GB', 'gbp'], ['RU', 'rub'], ['AE', 'aed'], ['SA', 'sar'],
        ['JP', 'jpy'], ['CN', 'cny'], ['IN', 'inr'], ['KR', 'krw'], ['BR', 'brl'], ['CA', 'cad'],
        ['AU', 'aud'], ['CH', 'chf'], ['NG', 'ngn'], ['UA', 'uah'], ['PL', 'pln'], ['SE', 'sek'],
        ['NO', 'nok'], ['DK', 'dkk'], ['CZ', 'czk'], ['HU', 'huf'], ['RO', 'ron'], ['IL', 'ils'],
        ['ZA', 'zar'], ['MX', 'mxn'], ['AR', 'ars'], ['ID', 'idr'], ['PK', 'pkr'], ['TH', 'thb'],
        ['VN', 'vnd'], ['PH', 'php'], ['MY', 'myr'], ['SG', 'sgd'], ['HK', 'hkd'], ['TW', 'twd'],
        ['KW', 'kwd'], ['BH', 'bhd'], ['KE', 'kes'], ['CO', 'cop'], ['CL', 'clp'], ['PE', 'pen'],
        ['BD', 'bdt'], ['LK', 'lkr'], ['MM', 'mmk'], ['GE', 'gel'], ['AM', 'amd'], ['BA', 'bam'],
        ['GT', 'gtq'], ['HN', 'hnl'], ['CR', 'crc'], ['DO', 'dop'], ['ZM', 'zmw'], ['LB', 'lbp'],
        ['NZ', 'nzd'], ['BM', 'bmd'],
    ]

    it.each(ULKE_BIRIM)('%s -> %s', (region, code) => {
        expect(REGION_CURRENCY[region]).toBe(code)
        expect(defaultCurrencyFor([`en-${region}`])).toBe(code)
    })

    // Salvador 2001 den beri USD kullaniyor; svc (kolon) yasal ama dolasimda degil.
    // Varsayilan olarak svc gostermek Salvadorlu kullaniciya hic kullanmadigi bir birim verirdi.
    it('El Salvador usd (svc fiilen kullanimdan kalkmis)', () => {
        expect(REGION_CURRENCY.SV).toBe('usd')
        expect(defaultCurrencyFor(['es-SV'])).toBe('usd')
    })

    it('tabloda olmayan bolgeler usd', () => {
        expect(defaultCurrencyFor(['en-GH'])).toBe('usd')
        expect(defaultCurrencyFor(['es-VE'])).toBe('usd') // vef haric; VES allowlist'te yok
        expect(defaultCurrencyFor(['es-EC'])).toBe('usd')
    })
})

describe('selectableCurrencies', () => {
    it('vef/xdr sunucu listesinde ve rates icinde olsa da duser', () => {
        const result = selectableCurrencies(CATALOG, RATES)
        expect(codes(result)).not.toContain('vef')
        expect(codes(result)).not.toContain('xdr')
        expect(codes(result)).toEqual(['usd', 'try', 'eur', 'gbp', 'cad', 'aud', 'kwd', 'lbp', 'zar'])
    })

    it('rates icinde olmayan birim duser', () => {
        const kismi = { ...RATES }
        delete kismi.kwd
        delete kismi.lbp
        expect(codes(selectableCurrencies(CATALOG, kismi))).toEqual(['usd', 'try', 'eur', 'gbp', 'cad', 'aud', 'zar'])
    })

    it('kullanilamaz kur (0, negatif, NaN, Infinity, dize, null) birimi dusurur', () => {
        for (const bad of [0, -1, NaN, Infinity, '34', null, undefined, {}]) {
            const result = selectableCurrencies(CATALOG, { usd: 1, try: bad, eur: 0.92 })
            expect(codes(result), String(bad)).toEqual(['usd', 'eur'])
        }
    })

    it('usd rates icinde olmasa da hep kalir', () => {
        expect(codes(selectableCurrencies(CATALOG, {}))).toEqual(['usd'])
        expect(codes(selectableCurrencies(CATALOG, { try: 34.5 }))).toEqual(['usd', 'try'])
        expect(codes(selectableCurrencies(CATALOG, null))).toEqual(['usd'])
        expect(codes(selectableCurrencies(CATALOG, undefined))).toEqual(['usd'])
    })

    it('kod kasasi onemsiz, girdi nesneleri degismeden doner', () => {
        const upper = entry('TRY', 'Turkish Lira', '₺')
        const result = selectableCurrencies([upper], { try: 34.5 })
        expect(result).toHaveLength(1)
        expect(result[0]).toBe(upper)
        expect(upper.code).toBe('TRY')
    })

    it('soz dizimi bozuk kodlu girdiler duser', () => {
        const list = [entry('usd', 'US Dollar', '$'), entry('', 'x', 'x'), entry(5, 'x', 'x'), entry('usdt', 'x', 'x'), null, undefined]
        expect(codes(selectableCurrencies(list, { usd: 1, usdt: 1 }))).toEqual(['usd'])
    })

    it('liste dizi degilse bos dizi', () => {
        expect(selectableCurrencies(undefined, RATES)).toEqual([])
        expect(selectableCurrencies(null, RATES)).toEqual([])
        expect(selectableCurrencies({}, RATES)).toEqual([])
    })

    it('girdi listesini degistirmez', () => {
        const before = JSON.stringify(CATALOG)
        selectableCurrencies(CATALOG, RATES)
        expect(JSON.stringify(CATALOG)).toBe(before)
    })
})

describe('groupCurrencies', () => {
    const LIST = [
        entry('zar', 'South African Rand', 'R'),
        entry('try', 'Turkish Lira', '₺'),
        entry('kwd', 'Kuwaiti Dinar', 'KWD'),
        entry('inr', 'Indian Rupee', '₹'),
        entry('usd', 'US Dollar', '$'),
        entry('aud', 'Australian Dollar', 'A$'),
        entry('brl', 'Brazil Real', 'R$'),
        entry('eur', 'Euro', '€'),
    ]

    it('populerler POPULAR sirasinda ve yalniz listede olanlar', () => {
        const { popular } = groupCurrencies(LIST)
        // POPULAR sirasi: usd, eur, try, gbp, rub, brl, cny, jpy, krw, vnd, idr, inr
        expect(codes(popular)).toEqual(['usd', 'eur', 'try', 'brl', 'inr'])
    })

    it('rest populerleri icermez ve koda gore sirali', () => {
        const { rest } = groupCurrencies(LIST)
        expect(codes(rest)).toEqual(['aud', 'kwd', 'zar'])
    })

    it('her birim tam bir kez (kayip ya da kopya yok) ve ayni nesneler', () => {
        const { popular, rest } = groupCurrencies(LIST)
        expect([...popular, ...rest]).toHaveLength(LIST.length)
        for (const e of [...popular, ...rest]) expect(LIST).toContain(e)
    })

    it('girdi sirasini degistirmez', () => {
        const before = codes(LIST)
        groupCurrencies(LIST)
        expect(codes(LIST)).toEqual(before)
    })

    it('bos ya da dizi olmayan girdi bos gruplar', () => {
        expect(groupCurrencies([])).toEqual({ popular: [], rest: [] })
        expect(groupCurrencies(undefined)).toEqual({ popular: [], rest: [] })
        expect(groupCurrencies(null)).toEqual({ popular: [], rest: [] })
    })

    it('populer olmayan listede popular bos kalir', () => {
        const { popular, rest } = groupCurrencies([entry('zar', 'South African Rand', 'R'), entry('aud', 'Australian Dollar', 'A$')])
        expect(popular).toEqual([])
        expect(codes(rest)).toEqual(['aud', 'zar'])
    })

    it('tum populerler varsa hepsi POPULAR sirasinda', () => {
        const hepsi = [...POPULAR_CURRENCIES].reverse().map((c) => entry(c, c.toUpperCase(), c))
        expect(codes(groupCurrencies(hepsi).popular)).toEqual([...POPULAR_CURRENCIES])
        expect(groupCurrencies(hepsi).rest).toEqual([])
    })
})

describe('searchCurrencies', () => {
    it('kod, ad ve sembolde arar (buyuk-kucuk harfsiz)', () => {
        expect(codes(searchCurrencies(CATALOG, 'try'))).toEqual(['try'])
        expect(codes(searchCurrencies(CATALOG, 'TRY'))).toEqual(['try'])
        expect(codes(searchCurrencies(CATALOG, 'eur'))).toEqual(['eur'])
        expect(codes(searchCurrencies(CATALOG, 'dollar'))).toEqual(['usd', 'cad', 'aud'])
        expect(codes(searchCurrencies(CATALOG, 'DOLLAR'))).toEqual(['usd', 'cad', 'aud'])
        expect(codes(searchCurrencies(CATALOG, 'pound'))).toEqual(['gbp', 'lbp'])
    })

    it('sembol ve ad ile bulur: "₺" -> try, "lira" -> Turkish Lira', () => {
        expect(codes(searchCurrencies(CATALOG, '₺'))).toEqual(['try'])
        const lira = searchCurrencies(CATALOG, 'lira')
        expect(lira).toHaveLength(1)
        expect(lira[0].name).toBe('Turkish Lira')
        expect(codes(searchCurrencies(CATALOG, '$'))).toEqual(['usd', 'cad', 'aud'])
        expect(codes(searchCurrencies(CATALOG, '€'))).toEqual(['eur'])
    })

    it('bos sorgu listeyi aynen doner', () => {
        expect(searchCurrencies(CATALOG, '')).toBe(CATALOG)
        expect(searchCurrencies(CATALOG, '   ')).toBe(CATALOG)
        expect(searchCurrencies(CATALOG, undefined)).toBe(CATALOG)
        expect(searchCurrencies(CATALOG, null)).toBe(CATALOG)
    })

    it('sorgu kirpilir, cok sozcuklu ad aranabilir', () => {
        expect(codes(searchCurrencies(CATALOG, '  Turkish  '))).toEqual(['try'])
        expect(codes(searchCurrencies(CATALOG, 'south african'))).toEqual(['zar'])
    })

    it('eslesme yoksa bos dizi', () => {
        expect(searchCurrencies(CATALOG, 'zzzz')).toEqual([])
    })

    it('sorgu regex degil, ozel karakterler hata vermez', () => {
        expect(searchCurrencies(CATALOG, '.*')).toEqual([])
        expect(searchCurrencies(CATALOG, '(')).toEqual([])
        expect(searchCurrencies(CATALOG, '[a-z]')).toEqual([])
    })

    it('arama haric tutma yapmaz (o isi selectableCurrencies in)', () => {
        expect(codes(searchCurrencies(CATALOG, 'xdr'))).toEqual(['xdr'])
    })

    it('girdi sirasini korur ve listeyi degistirmez; eksik alanli kayitta hata vermez', () => {
        const eksik = [entry('usd', 'US Dollar', '$'), { code: 'try' }, null, { name: 'Euro' }]
        expect(searchCurrencies(eksik, 'euro')).toEqual([{ name: 'Euro' }])
        expect(searchCurrencies(eksik, 'try')).toEqual([{ code: 'try' }])
        expect(eksik).toHaveLength(4)
    })

    it('liste dizi degilse bos dizi', () => {
        expect(searchCurrencies(undefined, 'usd')).toEqual([])
        expect(searchCurrencies(null, '')).toEqual([])
    })
})

describe('currencyDisplayName', () => {
    it('uygulama dilinde ad doner', () => {
        expect(currencyDisplayName('try', 'tr', 'Turkish Lira')).toMatch(/türk lirası/i)
        expect(currencyDisplayName('TRY', 'en', 'x')).toBe('Turkish Lira')
        expect(currencyDisplayName('usd', 'de', 'US Dollar')).toBe('US-Dollar')
    })

    it('Intl atarsa ya da kodu aynen dondururse sunucu adi', () => {
        expect(currencyDisplayName('xyz', 'en', 'Sunucu Adi')).toBe('Sunucu Adi')
        expect(currencyDisplayName('try', 'gecersiz-@@', 'Turkish Lira')).toMatch(/lira/i)
        expect(currencyDisplayName('try', 'tr', undefined)).toMatch(/lirası/i)
        expect(currencyDisplayName('xyz', 'en', undefined)).toBe('')
    })
})

describe('searchCurrencies -- yerel ad', () => {
    const yerel = (e) => currencyDisplayName(e.code, 'tr', e.name)

    it('yerel ad, sunucu adi, kod ve sembol bulur; I/İ ve aksan duyarsiz', () => {
        for (const q of ['türk', 'turk', 'TÜRK', 'lira', 'LİRA', 'LIRA', 'turkish', 'try', '₺']) {
            expect(codes(searchCurrencies(CATALOG, q, yerel)), q).toContain('try')
        }
        expect(codes(searchCurrencies(CATALOG, 'türk', yerel))).toEqual(['try'])
    })

    it('ucuncu arguman verilmezse eski davranis', () => {
        expect(codes(searchCurrencies(CATALOG, 'lirası'))).toEqual([])
        expect(codes(searchCurrencies(CATALOG, 'dollar'))).toEqual(['usd', 'cad', 'aud'])
    })
})
