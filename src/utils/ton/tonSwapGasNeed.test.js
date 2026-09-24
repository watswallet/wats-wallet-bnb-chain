// Takas ekraninin gaz yeterlilik kurali - KAPI 6'nin (tonSwap.js) aynasi.
//
// 2026-09-15 KUSURU: ekran gaz payini KOSULSUZ istiyordu. GRAM->USDT (jetton->jetton)
// role takasinda prepareTonSwap kullanicidan SIFIR TON isterken ekran "Yetersiz Bakiye
// (Gas)" kartini ciziyor ve swapGuard dugmeyi kilitliyordu. Iddialar ESLENMIS yazildi:
// her "role odeyince dusuyor" iddiasinin yaninda "role kapaliyken AYNEN duruyor" ve
// "satilan native TON hala isteniyor" iddialari var - biri gevsetilirse digeri duser.
import { describe, it, expect } from 'vitest'
import { ref, computed } from 'vue'
import { tonSwapGasNeed, tonSwapGasBlocked } from './tonSwapGasNeed'

describe('tonSwapGasNeed - role kolu', () => {
    it('jetton satisinda role odiyorsa kullanicidan TON CIKMAZ (0 = zincire cikma)', () => {
        expect(tonSwapGasNeed({
            isNativeIn: false, amount: '100', gasCost: '0.3', relayPaysGas: true,
        })).toBe(0)
    })

    it('ESLENMIS: role KAPALIYKEN ayni jetton takasi gazi ISTER', () => {
        expect(tonSwapGasNeed({
            isNativeIn: false, amount: '100', gasCost: '0.3', relayPaysGas: false,
        })).toBe(0.3)
    })

    it('native TON satiliyorsa role odese bile MIKTAR kullanicidan cikar', () => {
        // "Role acik" ile "bedava" ayni sey degil: `amountNano` hicbir zaman
        // sponsorlanmaz (sozlesme ss00/ss04). Gaz duser, miktar KALIR.
        expect(tonSwapGasNeed({
            isNativeIn: true, amount: '5', gasCost: '0.3', relayPaysGas: true,
        })).toBe(5)
    })

    it('native TON + role kapali: miktar + gaz', () => {
        expect(tonSwapGasNeed({
            isNativeIn: true, amount: '5', gasCost: '0.3', relayPaysGas: false,
        })).toBeCloseTo(5.3, 10)
    })
})

describe('tonSwapGasNeed - cozulemeyen girdi 0 SAYILMAZ', () => {
    // 0 "ihtiyac yok, zincire cikma" demek. Bozuk bir alani 0 saymak kirmizi karti
    // HAKSIZ YERE kaldirir ve dugmeyi acardi.
    it.each([
        ['gaz cozulemiyor', { isNativeIn: false, gasCost: 'abc', relayPaysGas: false }],
        ['miktar cozulemiyor', { isNativeIn: true, amount: 'abc', gasCost: '0.3' }],
        ['negatif gaz', { isNativeIn: false, gasCost: '-1' }],
    ])('%s -> null', (_ad, girdi) => {
        expect(tonSwapGasNeed(girdi)).toBeNull()
    })

    it('role odiyorsa BOZUK GAZ ALANI sonucu bozmaz - o sayi zaten kullanilmiyor', () => {
        expect(tonSwapGasNeed({
            isNativeIn: false, amount: '100', gasCost: 'abc', relayPaysGas: true,
        })).toBe(0)
    })

    it('alan hic yoksa gaz 0 sayilir (mevcut `totalCost || 0` davranisi korunur)', () => {
        expect(tonSwapGasNeed({ isNativeIn: false })).toBe(0)
    })
})


// ============================================================================
// GAZ ENGELI - 2026-09-15 GERILEMESININ DAVRANISSAL KILIDI
// ============================================================================
//
// Kusur bir SIRALAMA yarisiydi, bir formul hatasi degil: karar `swapRelayPaysGas`
// HENUZ COZULMEMISKEN yaziliyor ve yazilan cevap DONUYORDU. Kablolama/metin testi
// bunu yapisal olarak yakalayamaz - yakalayan tek sey, ayni olcumun iki farkli
// role durumunda YENIDEN degerlendirilip FARKLI cevap verdigini gostermektir.
describe('tonSwapGasBlocked - sira BAGLAYICI', () => {
    it('ihtiyac COZULEMEDI -> fail-closed (bilmiyorken dugme ACILMAZ)', () => {
        expect(tonSwapGasBlocked({ need: null, balance: 100 })).toBe(true)
        expect(tonSwapGasBlocked({ need: undefined, balance: 100 })).toBe(true)
    })

    it('ihtiyac 0 -> engel YOK, bakiye SORULMAZ (KAPI 6 aynasi)', () => {
        // Bakiyenin okunamamis olmasi bile engel uretmemeli: sorulmayan bir soru,
        // cevaplanamadi diye dugmeyi kapatamaz. Onceki surumde bu dal okuma
        // ATLIYORDU; simdi okuma yapiliyor ama sonucu KULLANILMIYOR.
        expect(tonSwapGasBlocked({ need: 0, balance: null })).toBe(false)
        expect(tonSwapGasBlocked({ need: 0, balance: null, unreadable: true })).toBe(false)
        expect(tonSwapGasBlocked({ need: 0, balance: 0 })).toBe(false)
    })

    it('ihtiyac VARKEN bakiye okunamadi/okunmadi -> fail-closed', () => {
        expect(tonSwapGasBlocked({ need: 0.3, balance: 5, unreadable: true })).toBe(true)
        expect(tonSwapGasBlocked({ need: 0.3, balance: null })).toBe(true)
        expect(tonSwapGasBlocked({ need: 0.3, balance: undefined })).toBe(true)
        expect(tonSwapGasBlocked({ need: 0.3, balance: 'abc' })).toBe(true)
    })

    it('normal karsilastirma: yeterli ACAR, yetersiz KILITLER', () => {
        expect(tonSwapGasBlocked({ need: 0.3, balance: 0.3 })).toBe(false)
        expect(tonSwapGasBlocked({ need: 0.3, balance: 0.2999 })).toBe(true)
        // Sifir bakiye GERCEK bir cevaptir, "okunmadi" degil.
        expect(tonSwapGasBlocked({ need: 0.3, balance: 0 })).toBe(true)
    })
})

// ZAMANLAMA YARISI - GERCEK REAKTIF ZINCIRLE.
//
// Asagidaki `blocked` ifadesi Swap.vue'nun `tonInsufficientGas`i ile AYNI iki saf
// cagridan kuruludur (kablolamasi tonFeeUiWiring.test.js'te kilitli). Burada olculen
// sey ifadenin KENDISI degil, ZAMANI: olcum BIR KEZ yazildiktan sonra role durumu
// degistiginde cevabin kendini yenileyip yenilemedigi.
describe('role kolu SONRADAN cozulur/coker - karar kendini YENILER', () => {
    // Kullanicinin sikayet ettigi senaryo: jetton->jetton takas, cuzdanda 0 TON.
    const olculer = { isNativeIn: false, amount: '100', gasCost: '0.3' }

    const kur = (bakiye) => {
        const relayPaysGas = ref(false)
        const olcum = ref(null)
        const need = computed(() => (olcum.value === null ? null : tonSwapGasNeed({
            ...olcum.value,
            relayPaysGas: relayPaysGas.value,
        })))
        const blocked = computed(() => (olcum.value === null
            ? false
            : tonSwapGasBlocked({ need: need.value, balance: bakiye })))
        return { relayPaysGas, olcum, blocked }
    }

    it('A1: role cozulmemisken buton ACILMAZ, cozulunce KENDILIGINDEN acilir', () => {
        const { relayPaysGas, olcum, blocked } = kur(0)

        // Mount sonrasi ILK teklif: refreshTonFee henuz eylem kurmadi.
        olcum.value = olculer
        expect(blocked.value, 'role cozulmemisken buton acilmamali').toBe(true)

        // 1-2 sn sonra role cozuldu. OLCUM YENIDEN YAZILMADI - yalniz bayrak degisti.
        relayPaysGas.value = true
        expect(blocked.value, 'role cozulunce karar yenilenmedi (2026-09-15 kusuru)').toBe(false)
    })

    it('A2 (FAIL-OPEN): role cokerse kilit GERI GELIR', () => {
        const { relayPaysGas, olcum, blocked } = kur(0)

        relayPaysGas.value = true
        olcum.value = olculer
        expect(blocked.value).toBe(false)

        // Teklif dustu / liste disi router / TON_SWAP_FEE_ACTION hatasi: gonderim
        // self-pay'e duser ve gazi KULLANICI oder. Yazilan bir cevap burada false'ta
        // kalir ve TON'u olmayan kullaniciya YESIL dugme gosterirdi.
        relayPaysGas.value = false
        expect(blocked.value, 'role cokunce buton yesil kaldi (fail-open)').toBe(true)
    })

    it('ESLENMIS: TON u YETEN kullanici her iki durumda da ACIK kalir', () => {
        // Yoklukla saglanan iddia tuzagina karsi: yukaridaki iki test, kapi her zaman
        // "true" donse de (A1'in ilk yarisi) ya da hep "false" donse de kismen gecerdi.
        const { relayPaysGas, olcum, blocked } = kur(5)
        olcum.value = olculer
        expect(blocked.value).toBe(false)
        relayPaysGas.value = true
        expect(blocked.value).toBe(false)
    })

    it('SATILAN native TON role acikken de kullanicidan cikar', () => {
        const { relayPaysGas, olcum, blocked } = kur(4)
        relayPaysGas.value = true
        olcum.value = { isNativeIn: true, amount: '5', gasCost: '0.3' }
        // Gaz duser (0.3 istenmez) ama MIKTAR (5) kalir: 4 < 5 -> engel.
        expect(blocked.value, 'role miktari da sponsorluyor sanildi').toBe(true)
    })
})
