import { describe, it, expect } from 'vitest'
import { tonSignerReady } from './tonIdentity'

// TonConnect'in UC arka plan ucu ve onay ekrani BU fonksiyona bagli.
//
// NEDEN VAR: 2026-09-11 oncesinde o dort yer dogrudan `account.type === 'ton'`
// yaziyordu. O tur artik HICBIR akis tarafindan uretilmiyor (kayit defteri R6) --
// yeni hesaplar da, ice aktarilan Tonkeeper hesabi da `type:'hd'`. Sonuc
// TonConnect'in cuzdanin olusturabildigi HER hesapta OLU olmasiydi: kullanici
// hicbir sey reddetmeden `code 300 / "User rejected the request"` aliyordu.
//
// Asagidaki ilk iki test o regresyonun kapisidir: kapi tekrar ture baglanirsa
// ikisi de KIRILIR.

const HD_KASA = { fingerprint: 'f-hd', type: 'hd', accounts: [] }
const TON_KASA = { fingerprint: 'f-ton', type: 'tonMnemonic', accounts: [] }
const OZEL_KASA = { fingerprint: 'f-ozel', type: 'privateKey', accounts: [] }

describe('tonSignerReady -- GECEN nufus', () => {
    it('yeni HD hesap (bugun olusturulan her hesap) GECER', () => {
        const hesap = { key: 'a-0', type: 'hd', index: 0, fingerprint: 'f-hd' }
        HD_KASA.accounts = [hesap]
        expect(tonSignerReady([HD_KASA], hesap)).toBe(true)
    })

    it('ice aktarilan Tonkeeper hesabi (type hd + tonFingerprint) GECER', () => {
        // Y2'nin urettigi kayit: EVM kasasinin accounts dizisinde yasar, TON'u
        // tonFingerprint ile BASKA bir kasadan gelir.
        const hesap = { key: 'a-1', type: 'hd', index: 0, fingerprint: 'f-hd', tonFingerprint: 'f-ton' }
        HD_KASA.accounts = [hesap]
        expect(tonSignerReady([HD_KASA, TON_KASA], hesap)).toBe(true)
    })

    it('eski legacy type:ton kaydi GECER', () => {
        const hesap = { key: 'a-2', type: 'ton', index: 0, address: 'UQtest' }
        TON_KASA.accounts = [hesap]
        expect(tonSignerReady([TON_KASA], hesap)).toBe(true)
        TON_KASA.accounts = []
    })
})

describe('tonSignerReady -- REDDEDILEN nufus (fail-closed korunuyor)', () => {
    it('DANGLING tonFingerprint reddedilir', () => {
        // Eski hibrit kayit, TON kasasi artik yok. Turetme TON_VAULT_NOT_FOUND
        // ile duserdi; onay penceresi ACILMAMALI ("her redde sifir pencere").
        const hesap = { key: 'a-3', type: 'hd', fingerprint: 'f-hd', tonFingerprint: 'YOK' }
        HD_KASA.accounts = [hesap]
        expect(tonSignerReady([HD_KASA], hesap)).toBe(false)
    })

    it('ozel anahtardan ice aktarilan hesap reddedilir', () => {
        const hesap = { key: 'a-4', type: 'privateKey', fingerprint: 'f-ozel' }
        OZEL_KASA.accounts = [hesap]
        expect(tonSignerReady([OZEL_KASA], hesap)).toBe(false)
    })

    it('imported hesap reddedilir', () => {
        const hesap = { key: 'a-5', type: 'imported', fingerprint: 'f-ozel' }
        OZEL_KASA.accounts = [hesap]
        expect(tonSignerReady([OZEL_KASA], hesap)).toBe(false)
    })

    // INV-1: type:'ton' hesap TANIM GEREGI tonMnemonic kasasinda yasar. Bozuk bir
    // kayit (type:'ton' + hd kasasi) gecerse sir hd kasasindan cozulur ve SESSIZCE
    // yanlis adres uretilirdi.
    it('type:ton hesap hd kasasinda reddedilir (INV-1)', () => {
        const hesap = { key: 'a-6', type: 'ton', fingerprint: 'f-hd' }
        HD_KASA.accounts = [hesap]
        expect(tonSignerReady([HD_KASA], hesap)).toBe(false)
    })

    it('kasasi hic bulunamayan hesap reddedilir', () => {
        expect(tonSignerReady([], { key: 'yok', type: 'hd' })).toBe(false)
    })

    // FIRLATMAZ: cagiran taraf bunu bir SORU olarak soruyor.
    it('cop girdi FIRLATMAZ, false doner', () => {
        expect(tonSignerReady(null, null)).toBe(false)
        expect(tonSignerReady(undefined, undefined)).toBe(false)
        expect(tonSignerReady([], {})).toBe(false)
    })
})
