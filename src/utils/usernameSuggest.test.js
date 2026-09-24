import { describe, it, expect } from 'vitest'
import {
    USERNAME_PREFIXES, USERNAME_NOUNS, MAX_USERNAME_LENGTH, generateUsername,
} from './usernameSuggest'

// CreateUsername.vue'nun input'una uyguladigi SUZGECIN aynisi. Uretilen ad bu
// suzgecten DEGISMEDEN gecmeli: gecmezse kullanici ekrani acar acmaz kendi
// adinin harflerinin silindigini gorur.
const EKRAN_SUZGECI = (s) => s.replace(/[^a-zA-Z0-9]/g, '')

// Deterministik "rastgele": testler Math.random'a bagli OLMAMALI, yoksa
// kirmizi/yesil tesadufe kalir.
const sabit = (deger) => () => deger
const sirayla = (...degerler) => { let i = 0; return () => degerler[i++ % degerler.length] }

const ADRES = '0xAaaa000000000000000000000000000000052E739'

describe('kelime havuzlari', () => {
    it('onek havuzu eskisinden BELIRGIN buyuk', () => {
        // Eski liste 30 onekti. Isteğin kendisi "cogalt" oldugu icin sayi
        // olculur: 60'in altina duserse bu is geri alinmis demektir.
        expect(USERNAME_PREFIXES.length).toBeGreaterThanOrEqual(60)
    })

    it('isim havuzu eskisinden BELIRGIN buyuk', () => {
        expect(USERNAME_NOUNS.length).toBeGreaterThanOrEqual(60)
    })

    it('her kelime YALNIZCA kucuk harf a-z', () => {
        for (const w of [...USERNAME_PREFIXES, ...USERNAME_NOUNS]) {
            expect(w, w).toMatch(/^[a-z]+$/)
        }
    })

    // Kirpma, adresten gelen BENZERSIZLIK EKINI yiyor (asagidaki teste bak).
    // Tek onlem: kelimelerin kendisi kisa olsun.
    it('her kelime 3-7 harf', () => {
        for (const w of [...USERNAME_PREFIXES, ...USERNAME_NOUNS]) {
            expect(w.length, w).toBeGreaterThanOrEqual(3)
            expect(w.length, w).toBeLessThanOrEqual(7)
        }
    })

    it('havuzlarda TEKRAR yok ve iki liste CAKISMIYOR', () => {
        expect(new Set(USERNAME_PREFIXES).size).toBe(USERNAME_PREFIXES.length)
        expect(new Set(USERNAME_NOUNS).size).toBe(USERNAME_NOUNS.length)
        const kesisim = USERNAME_PREFIXES.filter((w) => USERNAME_NOUNS.includes(w))
        expect(kesisim).toEqual([])
    })

    // Havuzu buyutmenin TEK amaci bu: ayni ada denk gelme olasiligini dusurmek.
    it('kirpilmadan kullanilabilen cift sayisi eski havuzun TAMAMINDAN cok', () => {
        let uygun = 0
        for (const p of USERNAME_PREFIXES) for (const n of USERNAME_NOUNS) {
            if (p.length + n.length + 3 <= MAX_USERNAME_LENGTH) uygun++
        }
        // Eski havuz 30x30 = 900 HAM cift uretiyordu (kirpilanlar dahil).
        expect(uygun).toBeGreaterThan(900)
    })
})

describe('generateUsername', () => {
    // SEKIL olculur, tam dize DEGIL: uygulama ciftleri uzunluga gore eliyor
    // (onek+isim <= 12) ve "havuzun 0. elemani" o elemeden gecmeyebilir. Tam
    // dize beklemek, testi uygulamanin kendi secim mantigina baglardi.
    it('iki kelime kalibi: onek + BasHarfiBuyuk isim + adresin son 3 hanesi', () => {
        // rastgele() sirasi: [kalip secimi, onek indeksi, isim indeksi]
        const ad = generateUsername({ address: ADRES, rastgele: sirayla(0.9, 0, 0) })
        const m = ad.match(/^([a-z]+)([A-Z][a-z]+)739$/)
        expect(m, ad).not.toBeNull()
        expect(USERNAME_PREFIXES).toContain(m[1])
        expect(USERNAME_NOUNS).toContain(m[2].charAt(0).toLowerCase() + m[2].slice(1))
    })

    it('tek kelime kalibi: kelime + adresin son 6 hanesi', () => {
        const ad = generateUsername({ address: ADRES, rastgele: sirayla(0.1, 0) })
        expect(ad.endsWith(ADRES.slice(-6)), ad).toBe(true)
        expect([...USERNAME_PREFIXES, ...USERNAME_NOUNS]).toContain(ad.slice(0, -6))
    })

    // ASIL DUZELTILEN HATA. Eskiden ad 15 harfi gecince substring(0,15) ile
    // kirpiliyordu ve kirpilan sey TAM OLARAK adresten gelen ektir:
    //   quantum + Crimson + 739  ->  "quantumCrimson7"
    // Ek gidince ad artik benzersiz DEGIL -- iki kullanici ayni ada duser.
    it('adres eki HER ZAMAN korunur -- hicbir uretimde kirpilmaz', () => {
        for (let i = 0; i < 3000; i++) {
            const ad = generateUsername({ address: ADRES })
            expect(ad.endsWith('739'), ad).toBe(true)
        }
    })

    it('uretilen ad HER ZAMAN 3-15 karakter (input maxlength)', () => {
        for (let i = 0; i < 3000; i++) {
            const ad = generateUsername({ address: ADRES })
            expect(ad.length, ad).toBeGreaterThanOrEqual(3)
            expect(ad.length, ad).toBeLessThanOrEqual(MAX_USERNAME_LENGTH)
        }
    })

    it('uretilen ad ekranin suzgecinden DEGISMEDEN gecer', () => {
        for (let i = 0; i < 3000; i++) {
            const ad = generateUsername({ address: ADRES })
            expect(EKRAN_SUZGECI(ad), ad).toBe(ad)
        }
    })

    // Adres henuz cozulmemis olabilir (kasa acilmadan bu ekrana gelinebiliyor).
    it('adres YOKSA da gecerli bir ad uretir', () => {
        for (let i = 0; i < 500; i++) {
            const ad = generateUsername({ address: null })
            expect(ad.length, ad).toBeGreaterThanOrEqual(3)
            expect(ad.length, ad).toBeLessThanOrEqual(MAX_USERNAME_LENGTH)
            expect(EKRAN_SUZGECI(ad), ad).toBe(ad)
        }
        expect(() => generateUsername()).not.toThrow()
    })

    // Havuzun GERCEKTEN kullanildiginin kaniti: 400 uretimde en az 50 farkli ad.
    // Sabit bir dize donduren bir uygulama bu testi GECEMEZ.
    it('havuzdan gercekten cesitlilik uretir', () => {
        const set = new Set()
        for (let i = 0; i < 400; i++) set.add(generateUsername({ address: ADRES }))
        expect(set.size).toBeGreaterThan(50)
    })

    it('rastgele 1"e cok yakinken bile havuz disina TASMAZ', () => {
        const ad = generateUsername({ address: ADRES, rastgele: sabit(0.999999) })
        expect(EKRAN_SUZGECI(ad)).toBe(ad)
        expect(ad.endsWith('739')).toBe(true)
    })
})
