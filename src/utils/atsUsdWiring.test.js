import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ATS_COINGECKO_ID } from './atsConfig'

// ATS UCRET KARTLARI - LOGO VE DOLAR KARSILIGI.
//
// Kartlar UC ekrana dagilmis (Onayla, Takas, Kopru) ve ayni seyi anlatiyorlar:
// "su kadar ATS kesilecek". Ayrisirlarsa kullanici ayni ucreti bir ekranda
// dolariyla, digerinde yalniz ATS olarak gorur -- bu depoda ayni sinif hata
// daha once yasandi (ucret notlari bir ekranda vardi digerinde yoktu).
//
// Iddialar YORUM METNINI ESLEMEZ: her esleme ya calisabilir bir ifadeyi ya da
// gercekten cizilen bir isaretlemeyi hedefler.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const codeOnly = (src) => src
    .split('\n')
    .filter((line) => {
        const t = line.trim()
        return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && !t.startsWith('<!--')
    })
    .join('\n')

const CONFIRM = codeOnly(read('../components/ConfirmTransaction.vue'))
const SWAP = codeOnly(read('../components/Swap.vue'))
const BRIDGE = codeOnly(read('../components/Bridge.vue'))
// Dapp onay ekrani da ATS kesiyor (2026-09-13): ucret ATS zincirinde akisa degil
// ZINCIRE bagli. Ayni kurallara girmezse kullanici ayni ucreti Gonder ekraninda
// dolariyla, dapp ekraninda yalniz ATS olarak gorur.
const DAPP = codeOnly(read('../components/Dapp.vue'))
// UCRET KARTININ GOVDESI ARTIK PAYLASILAN BILESENDE. Ekranlar degeri prop olarak
// veriyor (`:usd-text`, `:logo-uri`), satiri cizme KURALI kartta. Iddialar bu yuzden
// iki yerde birden aranir -- olculen sey degismedi, yeri degisti.
const KART = codeOnly(read('../components/AtsFeeCard.vue'))

// Ekran ya satiri KENDI ciziyordur (kart disindaki bloklar) ya da paylasilan karta
// prop olarak veriyordur. Ikisi de kuralin korunmasi demek.
const dolarBaglar = (SRC) => /v-if="[^"]*UsdText"/.test(SRC) || /:usd-text="[A-Za-z.]*UsdText"/.test(SRC)
const logoBaglar = (SRC) => SRC.includes('src="/ats.png"') || SRC.includes('logo-uri="/ats.png"')

const EKRANLAR = [
    ['Onayla', CONFIRM],
    ['Takas', SWAP],
    ['Kopru', BRIDGE],
    ['Dapp', DAPP],
]

describe.each(EKRANLAR)('%s ekrani - ATS ucreti dolariyla gosterilir', (_ad, SRC) => {
    it('dolar metni tokenToUsd + formatUsd uzerinden uretilir', () => {
        // Elle bir carpma/yuvarlama yapilsaydi "<0.01" ve "fiyat yok" ayrimi
        // (formatUsd'nin tasidigi kural) bu ekranda kaybolurdu.
        expect(SRC).toMatch(/formatUsd\(tokenToUsd\(/)
    })

    it('ATS fiyati PAYLASILAN kimlikle okunur - ekranda dizge YOK', () => {
        expect(SRC).toMatch(/loadById\(ATS_COINGECKO_ID\)/)
        // Kimlik ekrana elle yazilsaydi, kimlik degistiginde ekranlar ayrisirdi.
        expect(SRC).not.toContain(`'${ATS_COINGECKO_ID}'`)
        expect(SRC).not.toContain(`"${ATS_COINGECKO_ID}"`)
    })

    it('fiyat BEKLENMEZ - ikincil satir ekranin acilmasini geciktirmez', () => {
        expect(SRC).not.toMatch(/await\s+atsPrice\.loadById/)
    })

    it('dolar satiri KENDI metnine bagli - fiyat yoksa cizilmez', () => {
        // Kosul tutara baglansaydi (orn. `atsFee != null`), fiyat gelmemisken de
        // satir cizilir ve icinde bos/0 bir deger gorunurdu.
        // Kural ya ekranda (kart disi bloklar) ya paylasilan kartta; ikisi de gecerli.
        expect(dolarBaglar(SRC), 'dolar satiri tutara baglanmis olabilir').toBe(true)
        expect(KART, 'kart dolar satirini KENDI metnine baglamiyor').toMatch(/v-if="usdText"/)
    })

    it('fiyat icin YEDEK DEGER yok - "$0.00" bir ucret kartinda "bedava" demek', () => {
        expect(SRC).not.toMatch(/atsPrice\.price\.value\s*(\|\||\?\?)/)
        expect(SRC).not.toContain('$0.00')
    })
})

describe('ATS ucret satirlari ATS LOGOSU tasir', () => {
    it.each([
        ['Takas', SWAP],
        ['Kopru', BRIDGE],
        ['Dapp', DAPP],
    ])('%s: yerel ats.png kullanir', (_ad, SRC) => {
        // Uzak URL kullanilmaz: atsConfig.js'in bas yorumu bunu acikca yaziyor
        // (uc 404 verdiginde <img @error> sonsuz fetch dongusune giriyordu).
        // Dizge ya dogrudan bir <img>'de ya paylasilan karta verilen prop'ta.
        expect(logoBaglar(SRC), 'yerel ats.png kullanilmiyor').toBe(true)
    })

    // Bu iddia once "logo atsCfg kaydindan gelir" diyordu. YANLIS DEGISMEZDI:
    // mevcut kodu tarif ediyordu, gereksinimi degil. `atsCfg` TON'da NULL
    // (ATS_CHAINS yalnizca EVM zincirlerini tutar) ve logo `v-if`e takilip
    // GIZLENIYORDU -- kullanici bunu ekranda gordu. Olculen sey artik dogru
    // degismez: logo ASLA bos kalmaz.
    it.each([
        ['Onayla', CONFIRM],
        ['Dapp', DAPP],
    ])('%s: logo zincire bagli DEGIL - kayit yoksa paylasilan sabite duser', (_ad, SRC) => {
        const at = SRC.indexOf('const atsLogoURI = computed(')
        expect(at).toBeGreaterThan(-1)
        const govde = SRC.slice(at, at + 160)

        expect(govde).toContain('ATS_LOGO_URI')
        // Bos dizgeye dusen eski hali geri gelirse bu iddia duser.
        expect(govde).not.toMatch(/\|\|\s*''/)
        expect(govde).not.toMatch(/\|\|\s*""/)
        // Logo artik karta PROP olarak gidiyor; <img> kartin icinde cizilir.
        expect(SRC, 'logo karta baglanmamis').toMatch(/:logo-uri="atsLogoURI"/)
        expect(KART, 'kart logoyu hic cizmiyor').toMatch(/:src="logoUri"/)
    })

    it('paylasilan logo sabiti ile sablonlardaki dizge AYNI', () => {
        // Swap/Bridge/Pill dizgeyi dogrudan yaziyor. Sabit degisip onlar
        // degismezse ekranlar ayrisir; bu iddia ikisini birbirine baglar.
        const ATS_CONFIG = read('./atsConfig.js')
        expect(ATS_CONFIG).toContain("export const ATS_LOGO_URI = '/ats.png'")
        for (const SRC of [SWAP, BRIDGE, DAPP]) expect(logoBaglar(SRC)).toBe(true)
    })

    it('logo GERCEKTEN paketleniyor - public/ats.png var', () => {
        // Yoklukla saglanan iddia tuzagi: dizge dogru ama dosya yoksa kullanici
        // her kartta kirik ikon gorur.
        expect(() => readFileSync(fileURLToPath(new URL('../../public/ats.png', import.meta.url)))).not.toThrow()
    })
})

describe('ATS kimligi TEK yerde', () => {
    it('atsConfig disinda tanimlanmamis', () => {
        const ATS_CONFIG = read('./atsConfig.js')
        expect(ATS_CONFIG).toContain(`export const ATS_COINGECKO_ID = '${ATS_COINGECKO_ID}'`)
    })

    it('sembolden TURETILMIYOR - ayni sembolu tasiyan baska tokenler var', () => {
        // Sunucunun listesinde 'ats' sembollu en az iki kayit var (Alltoscan ve
        // Atlas DEX); sembolle arama yanlis tokenin fiyatini getirirdi.
        expect(ATS_COINGECKO_ID).not.toBe('ats')
        expect(ATS_COINGECKO_ID).toBe('alltoscan')
    })
})

describe('ATS bakiye paneli (AtsFuelPill) - logo ve dolar', () => {
    const PILL = codeOnly(read('../components/AtsFuelPill.vue'))

    it('panelde de ATS logosu var - hap ile ayni varlik, ayni isaret', () => {
        // Logo yalniz hapta olsaydi, ayni varligi anlatan iki yuzey birbirinden
        // kopuk gorunurdu. Iki gecis: hap + panel.
        expect(PILL.split('src="/ats.png"').length - 1).toBeGreaterThanOrEqual(2)
    })

    it('bakiyenin dolar karsiligi ayni kaynaktan okunur', () => {
        expect(PILL).toMatch(/formatUsd\(tokenToUsd\(fuel\.balance\.value/)
        expect(PILL).toMatch(/loadById\(ATS_COINGECKO_ID\)/)
        expect(PILL).not.toContain("'alltoscan'")
    })

    it('fiyat YALNIZ panel acilinca istenir - hap her ekranda duruyor', () => {
        // onMounted'ta istenseydi, basliktaki hap yuzunden HER ekran acilisinda
        // bir fiyat sorgusu baslardi.
        expect(PILL).toMatch(/watch\(open,[\s\S]{0,80}?loadById/)
        expect(PILL).not.toMatch(/onMounted\([\s\S]{0,200}?loadById/)
    })

    it('fiyat yoksa satir cizilmez - bos hesap ile fiyatsizlik karistirilmaz', () => {
        expect(PILL).toMatch(/v-if="atsUsdText"/)
    })
})

describe('ATS UYARI kartlari - logo ve dolar', () => {
    // Bu iki kartta tutar bir CUMLENIN ICINDE geciyor. Dolar cumleye sokulmaz
    // (ceviriyi bozardi); cumlenin altinda kendi satirinda durur ve tutari
    // TEKRARLAMAZ - yalnizca hangi varlik oldugunu (logo) ve ne ettigini soyler.
    const KARTLAR = [
        ['Yetersiz ATS', CONFIRM, 'atsRequiredUsdText', 'atsInsufficientDesc'],
        ['ATS satis tavani', SWAP, 'atsCapUsdText', 'atsCapDesc'],
    ]

    it.each(KARTLAR)('%s: dolar satiri var ve kendi metnine bagli', (_ad, SRC, metin) => {
        expect(SRC).toContain(`v-if="${metin}"`)
        expect(SRC).toContain(`const ${metin} = computed(`)
    })

    it.each(KARTLAR)('%s: satirda ATS logosu var', (_ad, SRC, metin) => {
        // Logo dolar satirinin ICINDE olmali; baska bir yerdeki bir ats.png
        // bu iddiayi tatmin etmemeli.
        const at = SRC.indexOf(`v-if="${metin}"`)
        expect(at).toBeGreaterThan(-1)
        expect(SRC.slice(at, at + 400)).toContain('src="/ats.png"')
    })

    it.each(KARTLAR)('%s: cumle KORUNUR, tutar iki kez yazilmaz', (_ad, SRC, metin, ceviriAnahtari) => {
        // Ceviri anahtari yerinde duruyor: dolar eklerken cumleyi degistirmedik.
        expect(SRC).toContain(ceviriAnahtari)
        // Dolar satirinda tutar TEKRARLANMIYOR (yalniz logo + dolar metni).
        const at = SRC.indexOf(`v-if="${metin}"`)
        const blok = SRC.slice(at, at + 400)
        expect(blok).not.toContain('atsRequiredDisplay')
        expect(blok).not.toContain('atsCapDisplay')
    })

    it('tavan dolari BICIMLENMIS metinden degil HAM degerden hesaplanir', () => {
        // `atsCapDisplay` bir METIN ve '—' de olabiliyor; ondan dolar hesaplamak
        // sessizce null/NaN uretirdi.
        const at = SWAP.indexOf('const atsCapUsdText = computed(')
        const govde = SWAP.slice(at, at + 400)
        expect(govde).toContain('maxAtsSellRaw')
        expect(govde).not.toContain('atsCapDisplay')
    })
})
