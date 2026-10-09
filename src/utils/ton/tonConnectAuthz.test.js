import { describe, it, expect } from 'vitest'
import { grantedTonSession, putTonSession, removeTonSession, orphanTonHostnames, tonFromMatches } from './tonConnectAuthz'

const ADDR = '0:aaaa000000000000000000000000000000000000000000000000000000000001'
const SESSION = {
    address: ADDR,
    publicKey: 'ab12',
    walletStateInit: 'base64stringhere',
    accountKey: 'acc-1',
    chain: '-239',
    manifest: { name: 'DeDust', url: 'https://app.dedust.io', iconUrl: null, manifestUrl: 'https://app.dedust.io/m.json', sameOrigin: true },
    connectedAt: 1756000000,
}
const STORE = { 'app.dedust.io': SESSION }

describe('grantedTonSession', () => {
    it('kayitli origin ve adres istenmemisse oturum doner', () => {
        expect(grantedTonSession(STORE, 'app.dedust.io', undefined)).toEqual(SESSION)
    })

    it('istenen adres oturumunkiyle ayniysa doner', () => {
        expect(grantedTonSession(STORE, 'app.dedust.io', ADDR)).toEqual(SESSION)
    })

    // Baglantidan sonra dapp BASKA bir adres icin imza isteyebilir. O adres bu
    // origin'e HIC verilmedi: vermek, kullanicinin dapp'e gostermedigi bir
    // hesabindan islem hazirlatmak olurdu.
    it('YABANCI adres istenirse null', () => {
        const baska = '0:bbbb000000000000000000000000000000000000000000000000000000000002'
        expect(grantedTonSession(STORE, 'app.dedust.io', baska)).toBe(null)
    })

    it('kayitsiz origin null', () => {
        expect(grantedTonSession(STORE, 'evil.com', undefined)).toBe(null)
    })

    it('bos/bozuk depoda null', () => {
        expect(grantedTonSession(undefined, 'app.dedust.io')).toBe(null)
        expect(grantedTonSession({}, 'app.dedust.io')).toBe(null)
        expect(grantedTonSession({ 'app.dedust.io': null }, 'app.dedust.io')).toBe(null)
    })

    // TON ham adresi BUYUK/kucuk harf varyasyonlariyla yazilabiliyor; ayni
    // adres icin gereksiz bir yetki reddi vermemeliyiz.
    it('adres karsilastirmasi harf duyarsiz', () => {
        expect(grantedTonSession(STORE, 'app.dedust.io', ADDR.toUpperCase())).toEqual(SESSION)
    })

    // `from` ADRES olarak karsilastirilir (tonFromMatches): ayni hesabin friendly
    // ve bosluklu yazimlari da kabul, baska hesabin friendly yazimi red.
    it.each([
        ['EQ', 'EQCqqgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY7q'],
        ['UQ', 'UQCqqgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAdMv'],
        ['bosluklu EQ', '  EQCqqgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY7q '],
    ])('ayni hesabin %s yazimi oturumu doner', (_ad, from) => {
        expect(grantedTonSession(STORE, 'app.dedust.io', from)).toEqual(SESSION)
    })

    it('BASKA hesabin friendly yazimi null', () => {
        expect(grantedTonSession(STORE, 'app.dedust.io', 'EQAREREREREREREREREREREREREREREREREREREREREREeYT')).toBe(null)
    })
})

// Oturum adresi HAM (0:hex) saklanir; dapp `from`u ham YA DA friendly verebilir
// (rpc.md). Karsilastirma dizeyle degil ADRESLE yapilir.
describe('tonFromMatches', () => {
    const HAM = '0:1111111111111111111111111111111111111111111111111111111111111111'

    it.each([
        ['ayni ham', HAM],
        ['bosluklu ham', `  ${HAM} `],
        ['EQ', 'EQAREREREREREREREREREREREREREREREREREREREREREeYT'],
        ['UQ', 'UQAREREREREREREREREREREREREREREREREREREREREREbvW'],
        // testOnly bayragi yok sayilir (Address.equals): spec sessiz.
        ['kQ', 'kQAREREREREREREREREREREREREREREREREREREREREREV2Z'],
        ['0Q', '0QAREREREREREREREREREREREREREREREREREREREREREQBc'],
    ])('%s -> true', (_ad, from) => {
        expect(tonFromMatches(HAM, from)).toBe(true)
    })

    it.each([
        ['baska ham adres', '0:2222222222222222222222222222222222222222222222222222222222222222'],
        ['bozuk CRC', 'EQAREREREREREREREREREREREREREREREREREREREREREeYU'],
        ['63 hane', '0:111111111111111111111111111111111111111111111111111111111111111'],
        ['cop', 'zz'],
        ['bos dize', ''],
        ['sayi', 123],
        ['nesne', {}],
        ['null', null],
        ['undefined', undefined],
    ])('%s -> false', (_ad, from) => {
        expect(tonFromMatches(HAM, from)).toBe(false)
    })

    // HARFLI hex sart: '0:1111..' buyuk harfe cevrilince AYNI dize kalir ve
    // buyuk harf yolunu hic denemez.
    it('BUYUK harf ham (harfli hex) iki yonde de true', () => {
        const HARFLI = '0:' + 'ab'.repeat(32)
        expect(HARFLI.toUpperCase()).not.toBe(HARFLI)
        expect(tonFromMatches(HARFLI, HARFLI.toUpperCase())).toBe(true)
        expect(tonFromMatches(HARFLI.toUpperCase(), HARFLI)).toBe(true)
    })

    it('oturum adresi cozulemezse false, firlatmaz', () => {
        expect(tonFromMatches('bozuk', HAM)).toBe(false)
        expect(tonFromMatches(undefined, HAM)).toBe(false)
    })
})

describe('putTonSession / removeTonSession', () => {
    it('yeni nesne dondurur, girdiyi DEGISTIRMEZ', () => {
        const store = {}
        const sonuc = putTonSession(store, 'a.io', SESSION)
        expect(sonuc['a.io']).toEqual(SESSION)
        expect(store).toEqual({})
    })

    it('remove yalniz hedefi siler', () => {
        const store = { 'a.io': SESSION, 'b.io': SESSION }
        const sonuc = removeTonSession(store, 'a.io')
        expect(sonuc['a.io']).toBeUndefined()
        expect(sonuc['b.io']).toEqual(SESSION)
        expect(store['a.io']).toEqual(SESSION)
    })

    it('remove bilinmeyen hostname icin patlamaz', () => {
        expect(removeTonSession({}, 'yok.io')).toEqual({})
    })
})

describe('orphanTonHostnames', () => {
    // TonConnect'te accountsChanged YOK: oturum ADRESE bagli. Bagli hesap
    // silinirse oturumu tutmanin anlami kalmaz -- imzalayacak anahtar yok.
    it('hesabi artik var olmayan oturumlari listeler', () => {
        const store = { 'a.io': SESSION, 'b.io': { ...SESSION, accountKey: 'silindi' } }
        expect(orphanTonHostnames(store, ['acc-1'])).toEqual(['b.io'])
    })

    it('hepsi gecerliyse bos dizi', () => {
        expect(orphanTonHostnames({ 'a.io': SESSION }, ['acc-1', 'acc-2'])).toEqual([])
    })

    // FAIL-CLOSED DEGIL: hesap listesi okunamadiysa hicbir oturumu silmeyiz.
    // Bos liste "hicbir hesap yok" degil "bilmiyorum" demek olabilir ve
    // kullanicinin butun dapp baglantilarini silmek geri alinamaz.
    it('hesap listesi bos/gecersizse HICBIR oturum yetim sayilmaz', () => {
        expect(orphanTonHostnames({ 'a.io': SESSION }, [])).toEqual([])
        expect(orphanTonHostnames({ 'a.io': SESSION }, null)).toEqual([])
    })
})
