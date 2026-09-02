import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    SENT_RECIPIENTS, MAX_SENT_RECIPIENTS,
    upsertRecipient, getSentRecipients, recordSentRecipient
} from './sentRecipients'

const A = '0xAaAa' + '1'.repeat(32) + 'AaAa'
const B = '0xBbBb' + '2'.repeat(32) + 'BbBb'

// chrome.storage.local'i gercek bir depo gibi taklit et: "yaz sonra oku" testleri
// gercek davranisi olcer.
let store
beforeEach(() => {
    store = {}
    globalThis.chrome = {
        storage: {
            local: {
                get: vi.fn(async (key) => (key in store ? { [key]: store[key] } : {})),
                set: vi.fn(async (obj) => { Object.assign(store, obj) })
            }
        }
    }
})

describe('upsertRecipient', () => {
    it('yeni adresi listenin BASINA ekler', () => {
        const list = upsertRecipient([], { address: A, label: 'Borsa', at: 1000 })
        expect(list).toEqual([{ address: A, label: 'Borsa', lastSentAt: 1000, count: 1 }])
    })

    it('en son gonderilen basa gecer', () => {
        let list = upsertRecipient([], { address: A, label: 'A', at: 1000 })
        list = upsertRecipient(list, { address: B, label: 'B', at: 2000 })
        expect(list.map(r => r.address)).toEqual([B, A])
    })

    it('var olan adreste sayaci artirir ve tarihi tazeler, liste uzamaz', () => {
        let list = upsertRecipient([], { address: A, label: 'Borsa', at: 1000 })
        list = upsertRecipient(list, { address: A, label: 'Borsa', at: 5000 })
        expect(list).toHaveLength(1)
        expect(list[0].count).toBe(2)
        expect(list[0].lastSentAt).toBe(5000)
    })

    it('eslesme buyuk/kucuk harf duyarsizdir, KAYITLI adres yazimi korunur', () => {
        let list = upsertRecipient([], { address: A, label: 'Borsa', at: 1000 })
        list = upsertRecipient(list, { address: A.toLowerCase(), label: 'Borsa', at: 2000 })
        expect(list).toHaveLength(1)
        expect(list[0].address).toBe(A)
    })

    it('yeni etiket yoksa eskisi korunur', () => {
        let list = upsertRecipient([], { address: A, label: 'Borsa', at: 1000 })
        list = upsertRecipient(list, { address: A, label: null, at: 2000 })
        expect(list[0].label).toBe('Borsa')
    })

    it('yeni etiket varsa eskisinin yerine gecer', () => {
        let list = upsertRecipient([], { address: A, label: 'Borsa', at: 1000 })
        list = upsertRecipient(list, { address: A, label: 'Yeni Ad', at: 2000 })
        expect(list[0].label).toBe('Yeni Ad')
    })

    it('tavani asinca EN ESKI kayit duser', () => {
        let list = []
        for (let i = 0; i < MAX_SENT_RECIPIENTS; i++) {
            list = upsertRecipient(list, { address: '0x' + String(i).padStart(40, '0'), at: i })
        }
        const oldest = list[list.length - 1].address

        list = upsertRecipient(list, { address: A, at: 999999 })

        expect(list).toHaveLength(MAX_SENT_RECIPIENTS)
        expect(list[0].address).toBe(A)
        expect(list.some(r => r.address === oldest)).toBe(false)
    })

    it('gecersiz adres listeyi degistirmez', () => {
        const base = upsertRecipient([], { address: A, at: 1000 })
        expect(upsertRecipient(base, { address: '0x123', at: 2000 })).toEqual(base)
        expect(upsertRecipient(base, { address: null, at: 2000 })).toEqual(base)
        expect(upsertRecipient(base, {})).toEqual(base)
    })

    it('bozuk liste girdilerine toleranslidir', () => {
        expect(upsertRecipient(null, { address: A, at: 1 })).toHaveLength(1)
        expect(upsertRecipient([null, { address: 'coplu' }], { address: A, at: 1 })).toHaveLength(1)
    })
})

describe('getSentRecipients', () => {
    it('depo bossa bos liste doner', async () => {
        expect(await getSentRecipients()).toEqual([])
    })

    it('depoda liste olmayan bir deger varsa bos liste doner', async () => {
        store[SENT_RECIPIENTS] = { bozuk: true }
        expect(await getSentRecipients()).toEqual([])
    })
})

describe('recordSentRecipient', () => {
    it('gonderilen adresi depoya yazar ve geri okunur', async () => {
        await recordSentRecipient(A, 'Borsa', 1000)

        const list = await getSentRecipients()
        expect(list).toEqual([{ address: A, label: 'Borsa', lastSentAt: 1000, count: 1 }])
    })

    it('ayni adrese ikinci gonderimde sayac artar', async () => {
        await recordSentRecipient(A, 'Borsa', 1000)
        await recordSentRecipient(A, 'Borsa', 2000)

        const list = await getSentRecipients()
        expect(list).toHaveLength(1)
        expect(list[0].count).toBe(2)
    })

    it('gecersiz adres depoyu kirletmez', async () => {
        await recordSentRecipient('0x123', 'Bozuk', 1000)
        expect(await getSentRecipients()).toEqual([])
    })
})

// KOD INCELEMESI (Task 13, kritik 2): bu dosya EVM-only bir canonical()'a
// sahipti; her Solana alicisi burada SESSIZCE atiliyordu.
// ConfirmTransaction.vue Solana yolunda da recordSentRecipient'i cagirir —
// yazma GERCEKLESIYOR ama yutuluyordu. "sent" tam da gecmisin valf 2'sinden
// (birbirine benzeyen iki gecmis adayi birbirini goturur) ETKILENMEYEN kaynak
// oldugu icin bu, Solana'da zehirli adres tespitinin en kritik deligiydi.
describe('upsertRecipient / recordSentRecipient — Solana (base58) adresler', () => {
    const SOL_A = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
    const SOL_B = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
    // SOL_A ile YALNIZCA bas 4 karakterin harf kasasi farkli.
    const SOL_A_CASE_VARIANT = '9wzdXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

    it('Solana adresi de listenin BASINA eklenir (eskiden SESSIZCE atiliyordu)', () => {
        const list = upsertRecipient([], { address: SOL_A, label: 'Borsa', at: 1000 })
        expect(list).toEqual([{ address: SOL_A, label: 'Borsa', lastSentAt: 1000, count: 1 }])
    })

    it('ayni Solana adresine ikinci gonderimde sayac artar, liste uzamaz', () => {
        let list = upsertRecipient([], { address: SOL_A, label: 'Borsa', at: 1000 })
        list = upsertRecipient(list, { address: SOL_A, label: 'Borsa', at: 5000 })
        expect(list).toHaveLength(1)
        expect(list[0].count).toBe(2)
    })

    // BASE58 BUYUK/KUCUK HARF DUYARLIDIR: kucultulseydi bu iki adres AYNI
    // sayilir, kayitli SOL_A'nin sayaci YANLISLIKLA artardi ve gercekte FARKLI
    // olan SOL_A_CASE_VARIANT hic kaydedilmezdi.
    it('yalnizca harf kasasi farkli Solana adresi AYRI bir kayit olarak eklenir', () => {
        let list = upsertRecipient([], { address: SOL_A, label: 'Borsa', at: 1000 })
        list = upsertRecipient(list, { address: SOL_A_CASE_VARIANT, label: 'Baska', at: 2000 })
        expect(list).toHaveLength(2)
        expect(list.map(r => r.address)).toEqual([SOL_A_CASE_VARIANT, SOL_A])
    })

    it('EVM ve Solana adresleri AYNI listede bagimsiz kalir', () => {
        let list = upsertRecipient([], { address: A, label: 'EVM', at: 1000 })
        list = upsertRecipient(list, { address: SOL_B, label: 'Solana', at: 2000 })
        expect(list.map(r => r.address)).toEqual([SOL_B, A])
    })

    it('recordSentRecipient Solana adresini depoya yazar ve geri okunur', async () => {
        await recordSentRecipient(SOL_A, 'Borsa', 1000)

        const list = await getSentRecipients()
        expect(list).toEqual([{ address: SOL_A, label: 'Borsa', lastSentAt: 1000, count: 1 }])
    })
})
