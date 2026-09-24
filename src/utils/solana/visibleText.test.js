// visibleText.js -- uc onay ekraninin (SolanaSignTx/SolanaSignMessage/
// SolanaConnectApprove) ve Dapps.vue'nun PAYLASTIGI tek gorunmezlik/homoglif
// isaretleme katmani (C3.2, Task 23/31 deferred). Onceden SolanaSignTx.vue ve
// SolanaSignMessage.vue AYNI mantigi BAGIMSIZ kopyalar halinde tasiyordu --
// biri guncellenip digeri unutulursa yeni bir karakter sinifi TEK ekranda
// kapanirdi.
import { describe, it, expect } from 'vitest'
import { gorunurKil } from './visibleText.js'

describe('visibleText.js -- gorunurKil', () => {
    // Sifir genislikli karakter EKRANDA GORUNMEZ: "Log" + U+200B + "in" ile
    // "Login" ayni goruntuyu verir.
    it('gorunmez kod noktasini kod-noktasi etiketiyle DEGISTIRIR', () => {
        expect(gorunurKil('Log​in')).toBe('Log[U+200B]in')
    })

    // Kiril 'а' (U+0430) Latin 'a'ya GORSEL olarak ozdestir. Homoglif
    // SILINMEZ, yaninda isaretlenir -- kullanici metni yine oldugu gibi okur
    // ama tuzagi gorur.
    it('homoglif karakteri SILMEDEN yaninda isaretler', () => {
        expect(gorunurKil('аpple')).toBe('а[U+0430]pple')
    })

    // Duz ASCII/Latin metinde isaretlenecek hicbir sey yoktur -- asiri
    // isaretleme de KABUL EDILMEZ (K5: yanlis alarm gurultudur).
    it('duz ASCII metin DEGISMEDEN doner', () => {
        expect(gorunurKil('Jupiter')).toBe('Jupiter')
    })

    // Cagiran taraf her zaman string gecirmeyebilir (orn. sayisal/nesne
    // degerler) -- String() donusumu FIRLATMADAN calismali.
    it('string olmayan girdi String() ile donusturulup islenir', () => {
        expect(gorunurKil(42)).toBe('42')
    })
})
