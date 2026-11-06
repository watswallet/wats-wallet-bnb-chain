import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { nesilKorumasi } from './nesilKorumasi.js'

const bekle = (ms) => new Promise((r) => setTimeout(r, ms))
const kor = nesilKorumasi()
beforeEach(() => { kor.yeniNesil() })
afterEach(() => { delete globalThis.chrome })

// Birimler: nesil ayni kaldiysa sonuc aynen doner; hata aynen yayilir; nesil degistiyse hic cozulmez.
describe('nesilKorumasi (birim)', () => {
    it('nesil degismediyse sonuc aynen doner', async () => {
        await expect(kor.sarmala(async () => 42)).resolves.toBe(42)
    })

    it('nesil degismediyse hata aynen yayilir', async () => {
        await expect(kor.sarmala(async () => { throw new Error('x') })).rejects.toThrow('x')
    })

    it('f() beklenirken nesil degisirse donen promise ASLA cozulmez', async () => {
        let ac
        const kapi = new Promise((r) => { ac = r })
        let cozuldu = false
        kor.sarmala(() => kapi).then(() => { cozuldu = true })
        kor.yeniNesil()
        ac('geldi')
        await bekle(30)
        expect(cozuldu).toBe(false)
    })
})

// KANIT (S1): gercek vitest akisi. Birinci test, govdesi hala bir await'te asili iken BITER (zaman asimina ugrayan
// testin davranisinin esdegeri). Kapi ikinci testte acilir: korumasiz govde ikinci testin chrome'una dokunur,
// korumali govde dokunmaz.
describe('bayat govde sonraki testin chrome una ULASAMAZ (S1)', () => {
    let ac
    const kapi = new Promise((r) => { ac = r })

    it('A: govdesi askida kalan test biter (korumasiz + korumali govde baslatilir)', () => {
        globalThis.chrome = { tabs: { sendMessage: async () => { throw new Error('A nin chrome u kullanilmamali') } } }
        // Korumasiz: kapi acilinca "o an" globalThis.chrome kimdeyse ona yazar.
        void (async () => { await kapi; await globalThis.chrome.tabs.sendMessage(6) })().catch(() => {})
        // Korumali: ayni govde yukle() sarmalayicisindan geciyor.
        void (async () => { await kor.sarmala(() => kapi); await globalThis.chrome.tabs.sendMessage(5) })().catch(() => {})
    })

    it('B: kapi acilinca yalniz KORUMASIZ govde B nin chrome una ulasir, korumali govde asili kalir', async () => {
        const gonderilen = []
        globalThis.chrome = { tabs: { sendMessage: async (id) => { gonderilen.push(id) } } }
        ac()
        await bekle(30)
        // Korumasiz govde (6) sizdi: sizinti mekanizmasi GERCEK; korumali govde (5) B ye ULASMADI.
        expect(gonderilen).toEqual([6])
    })
})
