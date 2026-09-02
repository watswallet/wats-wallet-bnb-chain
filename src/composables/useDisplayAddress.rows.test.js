import { describe, it, expect } from 'vitest'
import { buildAddressRows } from './useDisplayAddress'

// Kopyalama bolumu artik EVM ve TON adresini ALT ALTA gosteriyor. Iki adres yan yana
// dururken en tehlikeli hata, bir satirin YANLIS adresi tasimasidir: kullanici etikete
// guvenip o zincirden gonderir ve varlik KALICI OLARAK KAYBOLUR. Tek adres gosteren
// ekrandan daha risklidir, cunku dogru adres de ekranda oldugu icin kullanici
// "kontrol ettim" hissiyle hareket eder.

const EVM = { kind: 'evm', chainId: 1, name: 'Ethereum' }
const TON = { kind: 'ton', chainId: -239, name: 'TON' }

const EVM_ADDR = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F'
const TON_ADDR = 'UQDHMWKzTPGWZyEK8xgNb8-4jfFnjLu-cx84ZCU0zGlR5N8r'

const rowOf = (rows, kind) => rows.find(r => r.kind === kind)

describe('buildAddressRows — adresler karismaz', () => {
    it('TON adresi yokken TON satiri 0x adresine DUSMEZ', () => {
        const rows = buildAddressRows({ chain: TON, evmAddress: EVM_ADDR, tonAddress: null })
        expect(rowOf(rows, 'ton').address).toBeNull()
    })

    it('EVM adresi yokken EVM satiri TON adresine DUSMEZ', () => {
        const rows = buildAddressRows({ chain: EVM, evmAddress: null, tonAddress: TON_ADDR })
        expect(rowOf(rows, 'evm').address).toBeNull()
    })

    it('iki adres de varken her satir KENDI adresini tasir', () => {
        const rows = buildAddressRows({ chain: EVM, evmAddress: EVM_ADDR, tonAddress: TON_ADDR })
        expect(rowOf(rows, 'evm').address).toBe(EVM_ADDR)
        expect(rowOf(rows, 'ton').address).toBe(TON_ADDR)
    })

    it('adres yoksa satir SILINMEZ — arayuz "hazirlaniyor" gosterebilsin', () => {
        const rows = buildAddressRows({ chain: TON, evmAddress: null, tonAddress: null })
        expect(rows).toHaveLength(2)
        expect(rows.map(r => r.kind)).toEqual(['evm', 'ton'])
    })
})

describe('buildAddressRows — sira sabit, yalnizca vurgu degisir', () => {
    it('EVM agindayken sira evm -> ton', () => {
        const rows = buildAddressRows({ chain: EVM, evmAddress: EVM_ADDR, tonAddress: TON_ADDR })
        expect(rows.map(r => r.kind)).toEqual(['evm', 'ton'])
    })

    it('TON agindayken sira AYNI kalir — liste ag degisiminde ziplamaz', () => {
        const rows = buildAddressRows({ chain: TON, evmAddress: EVM_ADDR, tonAddress: TON_ADDR })
        expect(rows.map(r => r.kind)).toEqual(['evm', 'ton'])
    })

    it('EVM agindayken yalnizca EVM satiri aktif', () => {
        const rows = buildAddressRows({ chain: EVM, evmAddress: EVM_ADDR, tonAddress: TON_ADDR })
        expect(rowOf(rows, 'evm').active).toBe(true)
        expect(rowOf(rows, 'ton').active).toBe(false)
    })

    it('TON agindayken yalnizca TON satiri aktif', () => {
        const rows = buildAddressRows({ chain: TON, evmAddress: EVM_ADDR, tonAddress: TON_ADDR })
        expect(rowOf(rows, 'ton').active).toBe(true)
        expect(rowOf(rows, 'evm').active).toBe(false)
    })

    it('zincir bilinmiyorsa EVM aktif sayilir — chainKind ile ayni guvenli yon', () => {
        for (const chain of [null, undefined, {}, { chainId: 999999 }]) {
            const rows = buildAddressRows({ chain, evmAddress: EVM_ADDR, tonAddress: TON_ADDR })
            expect(rowOf(rows, 'evm').active).toBe(true)
            expect(rowOf(rows, 'ton').active).toBe(false)
        }
    })
})

// "HENUZ YOK" ile "HIC OLMAYACAK" AYRI SEYLERDIR.
//
// Bulundugu hata: TON ifadesiyle ice aktarilmis (TON'a kilitli) bir hesapta EVM satiri
// SONSUZA KADAR "Hazirlaniyor…" yaziyordu. Iki cagiran da (Header.vue, Receive.vue)
// "bu hesabin EVM adresi YOK" durumunu `evmAddress: null` diye geciyordu - yani
// "adres henuz turetilmedi" ile AYNI deger. Saf katman ikisini ayirt edemeyince
// arayuz "asla"yi "birazdan" diye gosterdi.
//
// Bekleme mesaji burada yalnizca yanlis degil, ZARARLI: kullaniciya var olmayan bir
// adresi beklemesini soyluyor. Kullanici bekler, gelmez, cuzdanin bozuk oldugunu
// dusunur - oysa hesap TAM OLARAK tasarlandigi gibi calisiyor (spec §5).
describe('buildAddressRows — TON a kilitli hesapta EVM satiri YOKTUR', () => {
    it('evmSupported false ise EVM satiri hic uretilmez', () => {
        const rows = buildAddressRows({
            chain: TON, evmAddress: null, tonAddress: TON_ADDR, evmSupported: false,
        })
        expect(rows.map(r => r.kind)).toEqual(['ton'])
        expect(rowOf(rows, 'ton').address).toBe(TON_ADDR)
    })

    // "Hazirlaniyor" durumu KORUNMALI: EVM satiri gercekten turetiliyorken silinirse
    // liste kullanicinin gozunun onunde bir satir uzar. Yukaridaki dorduncu test bunu
    // zaten kilitliyor; burada bayragin o durumu BOZMADIGI ayrica dogrulaniyor.
    it('evmSupported verilmezse davranis AYNEN korunur - satir durur', () => {
        const rows = buildAddressRows({ chain: TON, evmAddress: null, tonAddress: TON_ADDR })
        expect(rows.map(r => r.kind)).toEqual(['evm', 'ton'])
        expect(rowOf(rows, 'evm').address).toBeNull()
    })

    // Bayrak ADRESI GIZLEMEZ, SATIRI kaldirir. Biri ileride `evmSupported: false` ile
    // birlikte bir EVM adresi gecerse (tutarsiz cagri), satirin sessizce geri gelmesi
    // TON'a kilitli hesapta EVM etiketli bir adres basmak demektir.
    it('evmSupported false iken bir EVM adresi gecilse bile satir geri GELMEZ', () => {
        const rows = buildAddressRows({
            chain: TON, evmAddress: EVM_ADDR, tonAddress: TON_ADDR, evmSupported: false,
        })
        expect(rows.map(r => r.kind)).toEqual(['ton'])
        expect(JSON.stringify(rows)).not.toContain(EVM_ADDR)
    })

    // Tek satir kalinca TON satiri aktif vurguyu tasimali: TON'a kilitli hesap zaten
    // TON aginda olmak zorunda (accountKind.js), vurgusuz bir liste "secili hicbir sey
    // yok" gibi gorunurdu.
    it('tek satir kalinca TON satiri aktif kalir', () => {
        const rows = buildAddressRows({
            chain: TON, evmAddress: null, tonAddress: TON_ADDR, evmSupported: false,
        })
        expect(rowOf(rows, 'ton').active).toBe(true)
    })
})
