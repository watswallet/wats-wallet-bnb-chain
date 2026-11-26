// KOK NEDEN / KAPATILAN HATA (K25): allLocales.test.js yapisal butunlugu denetler ama kapinin hukuki sinirlarini ve
// dugme / kart boyutlarini bilmez. 10 dil insan incelemesi OLMADAN cevrilir; sessizce bozulabilecek dort sey
// burada kilitli: (1) ana dugme etiketleri 360 px'e sigmaz, (2) ihtiyat-yalniz metinlere ve etiketlere {issuer}
// sizar ("ihracci yasakliyor" izlenimi), (3) hukuki ihracci adlari, DB-IP atfi ve urun adlari cevrilir,
// (4) bir deger kontrolsuz uzar (kart / pencere tasar) ya da ham | @ HTML tasir.
// Kapsam: 48 kapi anahtari = 47 stockGate.* yaprak + settings.about.dbIp (K32: beyan arayuzu ve settings.stockDeclarations.* kalkti;
// K43: stockGate.warn.TR ve stockGate.warn.line kalkti; Bolum 2: stockGate.issuerName.{ondo,coinbase,robinhood,st0x} eklendi, 43 -> 47).
// Pozitif bekci: kapi anahtar kumesi en ile ayni degilse ya da bos kalirsa test vakumda gecmez.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SUPPORTED_LANGS } from '../languages'
import { flatten } from '../messageTools'

const here = dirname(fileURLToPath(import.meta.url))
const kapiAnahtari = (k) => k.startsWith('stockGate.') || k === 'settings.about.dbIp'
const tamOf = (kod) => new Map(flatten(JSON.parse(readFileSync(join(here, `${kod}.json`), 'utf8'))))
const gateOf = (kod) => new Map([...tamOf(kod)].filter(([k]) => kapiAnahtari(k)))
const EN = gateOf('en')
const len = (s) => Array.from(s).length
const CTA_MAX = 28 // ana dugme etiketi (360 px)
const ORAN = 1.35 // en uzunlugunun en cok 1,35 kati (+ 8 karakter dolgu: 2-5 karakterlik kisa degerler icin)
const MUTLAK_MAX = 650 // en uzun en degeri 484

describe.each(SUPPORTED_LANGS)('%s stockGate metinleri (12 dil kilitleri)', (kod) => {
  const tam = tamOf(kod)
  const m = gateOf(kod)

  it('pozitif bekci: kapi anahtar kumesi en ile ayni ve bos degil', () => {
    expect([...m.keys()].sort()).toEqual([...EN.keys()].sort())
    expect(EN.size).toBe(48) // 47 stockGate.* yaprak + settings.about.dbIp
    expect([...EN.keys()].filter((k) => k.startsWith('stockGate.')).length).toBe(47)
    expect([...m.keys()].filter((k) => k.startsWith('settings.stockDeclarations.'))).toEqual([])
  })

  it('ana dugme etiketleri (stockGate.cta.*) en cok 28 karakter ve yer tutucusuz; stockGate.action.* yok', () => {
    const cta = [...m].filter(([k]) => k.startsWith('stockGate.cta.'))
    expect(cta.length).toBeGreaterThanOrEqual(6) // 5 neden + checking
    expect(cta.map(([k]) => k)).toContain('stockGate.cta.COUNTRY_UNKNOWN')
    expect([...m.keys()].filter((k) => k.startsWith('stockGate.action.'))).toEqual([])
    expect(cta.filter(([, v]) => len(v) > CTA_MAX || /\{/.test(v)).map(([k]) => k)).toEqual([])
  })

  it('hicbir kapi degeri 650 karakteri ve en uzunlugunun 1,35 katini (+8) asmaz', () => {
    const asan = [...m].filter(([k, v]) => len(v) > MUTLAK_MAX || len(v) > Math.ceil(len(EN.get(k)) * ORAN) + 8).map(([k]) => k)
    expect(asan).toEqual([])
  })

  it('Task 42: stockGate.card.open ve stockGate.card.locationNote 12 dilde var, yer tutucusuz; locationNote <= 650 karakter ve en degerinin 1,35 kati (+8)', () => {
    for (const k of ['stockGate.card.open', 'stockGate.card.locationNote']) {
      const v = m.get(k)
      expect(typeof v, k).toBe('string')
      expect(v.trim().length, k).toBeGreaterThan(0)
      expect(v, k).not.toMatch(/[{}]/)
      expect(v, k).not.toMatch(/[|@<>]/)
    }
    const dugme = m.get('stockGate.card.open')
    expect(len(dugme)).toBeLessThanOrEqual(Math.ceil(len(EN.get('stockGate.card.open')) * ORAN) + 8)
    const not = m.get('stockGate.card.locationNote')
    expect(len(not)).toBeLessThanOrEqual(650)
    expect(len(not)).toBeLessThanOrEqual(Math.ceil(len(EN.get('stockGate.card.locationNote')) * ORAN) + 8)
    if (kod !== 'en') {
      expect(m.get('stockGate.card.open')).not.toBe(EN.get('stockGate.card.open'))
      expect(not).not.toBe(EN.get('stockGate.card.locationNote'))
    }
  })

  // Task 43 (K34): Hisseler listesi bos durumu. 10 dil insan incelemesi olmadan cevrilir: yer tutucu, HTML ve "ihracci
  // yasagi" dili (ihracci kelimesi) hicbir dilde sizmamali; uzunluk en ile orantili kalir.
  const IHRACCI_KELIMESI = {
    tr: /ihraçç|ihracc/i, en: /issuer/i, de: /Emittent/i, es: /emisor/i, fr: /émetteur/i, id: /penerbit/i,
    ja: /発行者|発行体/, ko: /발행자|발행인/, 'pt-BR': /emissor/i, ru: /эмитент/i, vi: /phát hành/i, 'zh-CN': /发行/,
  }

  it('Task 43: stockGate.empty.list ve stockGate.empty.unknown 12 dilde var, yer tutucusuz, ihracci kelimesi gecmez, en degerinin 1,35 kati (+8)', () => {
    expect(IHRACCI_KELIMESI[kod], `${kod} icin ihracci taramasi tanimsiz`).toBeInstanceOf(RegExp)
    for (const k of ['stockGate.empty.list', 'stockGate.empty.unknown']) {
      const v = m.get(k)
      expect(typeof v, k).toBe('string')
      expect(v.trim().length, k).toBeGreaterThan(0)
      expect(v, k).not.toMatch(/[{}]/)
      expect(v, k).not.toMatch(/[|@<>]/)
      expect(v, k).not.toMatch(IHRACCI_KELIMESI[kod])
      expect(v, k).not.toMatch(/issuer ban/i)
      expect(len(v), k).toBeLessThanOrEqual(Math.ceil(len(EN.get(k)) * ORAN) + 8)
      if (kod !== 'en') expect(v, k).not.toBe(EN.get(k))
    }
    expect(m.get('stockGate.empty.list')).not.toBe(m.get('stockGate.empty.unknown'))
    expect(m.get('stockGate.empty.list')).not.toBe(tam.get('home.stocksEmpty'))
  })

  // Task 44 (K34): hisse sayfasi tarafsiz bos notu. Ayni tarama: yer tutucu, HTML ve ihracci kelimesi hicbir dilde sizmamali.
  it('Task 44: stockGate.empty.detail 12 dilde var, yer tutucusuz, ihracci kelimesi gecmez, en degerinin 1,35 kati (+8), diger empty.* metinlerinden ayri', () => {
    expect(IHRACCI_KELIMESI[kod], `${kod} icin ihracci taramasi tanimsiz`).toBeInstanceOf(RegExp)
    const k = 'stockGate.empty.detail'
    const v = m.get(k)
    expect(typeof v, k).toBe('string')
    expect(v.trim().length, k).toBeGreaterThan(0)
    expect(v, k).not.toMatch(/[{}]/)
    expect(v, k).not.toMatch(/[|@<>]/)
    expect(v, k).not.toMatch(IHRACCI_KELIMESI[kod])
    expect(len(v), k).toBeLessThanOrEqual(Math.ceil(len(EN.get(k)) * ORAN) + 8)
    if (kod !== 'en') expect(v, k).not.toBe(EN.get(k))
    expect(v).not.toBe(m.get('stockGate.empty.list'))
    expect(v).not.toBe(m.get('stockGate.empty.unknown'))
  })

  it('stockGate.issuerName.* hukuki adlar VERBATIM; Bolum 2 marka adlari (Ondo, Coinbase, Robinhood, st0x) cevrilmez, 12 dilde AYNI', () => {
    expect(m.get('stockGate.issuerName.bstocks')).toBe('BTech Holdings')
    expect(m.get('stockGate.issuerName.xstocks')).toBe('Backed Assets')
    expect(m.get('stockGate.issuerName.ondo')).toBe('Ondo')
    expect(m.get('stockGate.issuerName.coinbase')).toBe('Coinbase')
    expect(m.get('stockGate.issuerName.robinhood')).toBe('Robinhood')
    expect(m.get('stockGate.issuerName.st0x')).toBe('st0x') // kucuk harfli yazim marka adinin parcasi
    expect([...m.keys()].filter((k) => k.startsWith('stockGate.issuerName.')).sort()).toEqual(
      ['bstocks', 'coinbase', 'ondo', 'robinhood', 'st0x', 'xstocks'].map((i) => `stockGate.issuerName.${i}`),
    )
  })

  it('DB-IP atfi VERBATIM (cevrilmez)', () => {
    expect(m.get('stockGate.attribution')).toBe('IP Geolocation by DB-IP')
    expect(m.get('settings.about.dbIp')).toBe('IP Geolocation by DB-IP')
  })

  // HUKUKI SINIR (K33): ihtiyat-yalniz kilit metni, ulke belirlenemedi kilidi, tum etiket metinleri ve bos durum
  // metinleri ihracci yasagi anlatmaz; bu yuzden {issuer} yer tutucusu tasimaz (yalniz IP_COUNTRY_ISSUER ihracciyi anar).
  it('ihtiyat-yalniz kilit metinleri ve tum etiket metinleri {issuer} tasimaz; COUNTRY_UNKNOWN ve empty.* da tasimaz', () => {
    const kontrol = ['stockGate.lock.IP_COUNTRY_PRECAUTION', 'stockGate.lock.COUNTRY_UNKNOWN',
      ...[...m.keys()].filter((k) => k.startsWith('stockGate.cta.') || k.startsWith('stockGate.empty.'))]
    expect(kontrol.filter((k) => !m.has(k))).toEqual([])
    expect(kontrol.length).toBeGreaterThanOrEqual(11) // pozitif bekci: 2 kilit + 6 etiket + 3 bos durum
    expect(kontrol.filter((k) => /\{issuer\}/.test(m.get(k))).sort()).toEqual([])
    // ihracciyi anan tek kilit hala yer tutucuyu tasir (kontrol vakumda gecmesin)
    expect(m.get('stockGate.lock.IP_COUNTRY_ISSUER')).toMatch(/\{issuer\}/)
  })

  // K43 (2026-11-14): uygun ihracci icin ulke uyumluluk uyarisi (stockGate.warn.TR ve stockGate.warn.line) hicbir dilde yoktur;
  // eski cumleyi tasiyan baska bir anahtar da yoktur. Kilit metinleri (stockGate.lock.*) ayridir ve durur (pozitif kontrol).
  it('K43: stockGate.warn.* hicbir dilde yok ve eski uyari cumlesi (Wats Wallet ... degerlendirmiyor / teyit etmiyor) kapinin hicbir degerinde yok', () => {
    expect([...m.keys()].filter((k) => k.startsWith('stockGate.warn'))).toEqual([])
    expect([...tam.keys()].filter((k) => k.startsWith('stockGate.warn'))).toEqual([])
    expect([...m].filter(([, v]) => /uygunluğunu değerlendirmiyor|does not assess or confirm whether this product complies/.test(v)).map(([k]) => k)).toEqual([])
    expect(m.get('stockGate.lock.IP_COUNTRY_ISSUER'), 'pozitif bekci: kilit metni duruyor').toBeTruthy()
  })

  it('ham | ve @ ve HTML etiketi yok', () => {
    expect([...m].filter(([, v]) => /[|@]|<[a-z/][^>]*>/i.test(v)).map(([k]) => k)).toEqual([])
  })
})
