import { describe, it, expect } from 'vitest'
import { isUserActivity, USER_ACTIVITY_ACTIONS } from './activityActions'
import { INTERNAL_ACTIONS } from './messageGate'

describe('activityActions -- "kullanici etkin" tanimi', () => {
    it('HEARTBEAT etkinliktir', () => {
        expect(isUserActivity('HEARTBEAT')).toBe(true)
    })

    it('kullanicinin bastigi kilit aksiyonlari etkinliktir', () => {
        expect(isUserActivity('UNLOCK_WALLET')).toBe(true)
        expect(isUserActivity('LOCK')).toBe(true)
        expect(isUserActivity('CHECK_UNLOCK')).toBe(true)
    })

    // ASIL KAPATILAN ACIK: bu iki dongu panelde saatlerce doner (Swap 10 sn,
    // Bridge 20 sn). Etkinlik sayilirlarsa lastActiveTime hic bayatlamaz ve
    // kullanici bilgisayardan kalksa bile cuzdan acik kalir.
    it('kotasyon yoklamalari etkinlik DEGILDIR', () => {
        expect(isUserActivity('SWAP_QUOTE')).toBe(false)
        expect(isUserActivity('BRIDGE_QUOTE')).toBe(false)
    })

    it('veri/durum yoklamalari etkinlik DEGILDIR', () => {
        expect(isUserActivity('CHECK_TX_STATUS')).toBe(false)
        expect(isUserActivity('SOLANA_GET_ADDRESS')).toBe(false)
    })

    it('bilinmeyen ad etkinlik DEGILDIR (fail-closed)', () => {
        expect(isUserActivity('WHATEVER')).toBe(false)
        expect(isUserActivity(undefined)).toBe(false)
        expect(isUserActivity(null)).toBe(false)
        expect(isUserActivity(42)).toBe(false)
    })

    // Kume ic aksiyonlarin ALT KUMESIDIR: etkinlik sayilan bir ad kapiyi da
    // gecebilmeli, yoksa arayuzden gelen mesaj reddedilirken damga tazelenir.
    it('her etkinlik adi ayni zamanda bir ic aksiyondur', () => {
        const disarida = [...USER_ACTIVITY_ACTIONS].filter(a => !INTERNAL_ACTIONS.has(a))
        expect(disarida).toEqual([])
    })
})
