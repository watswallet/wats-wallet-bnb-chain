import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useTransactionStore } from './transaction.js'

// chrome.storage taklidi: get ilk yuklemeyi, onChanged dinleyicisi sonraki yazimlari verir.
function kurChrome(ilk) {
    const dinleyiciler = []
    globalThis.chrome = {
        storage: {
            local: { get: (_k, cb) => cb({ current_transactions: ilk }) },
            onChanged: { addListener: (fn) => dinleyiciler.push(fn) },
        },
    }
    return (liste) => dinleyiciler.forEach(fn => fn({ current_transactions: { newValue: liste } }, 'local'))
}

const kart = (id, status = 'processing') => ({ id, status, meta: { chainId: 56 } })

describe('store/transaction: yeni kart gelince panel kucultulur', () => {
    beforeEach(() => setActivePinia(createPinia()))
    afterEach(() => { delete globalThis.chrome })

    it('bos listeden dolu listeye gecisde isMinimized true olur', () => {
        const yaz = kurChrome(undefined)
        const store = useTransactionStore()
        store.initListener()
        expect(store.isMinimized).toBe(false)
        yaz([kart('a')])
        expect(store.isMinimized).toBe(true)
    })

    it('kullanici acinca ayni kartin guncellemesi tekrar kucultmez; YENI id kucultur', () => {
        const yaz = kurChrome(undefined)
        const store = useTransactionStore()
        store.initListener()
        yaz([kart('a')])
        store.maximize()
        yaz([kart('a', 'success')])
        expect(store.isMinimized).toBe(false)
        yaz([kart('a', 'success'), kart('b', 'queued')])
        expect(store.isMinimized).toBe(true)
    })

    it('acilista depoda hazir kartlar varsa da kucuk balonla baslar', () => {
        kurChrome([kart('a', 'error')])
        const store = useTransactionStore()
        store.initListener()
        expect(store.isMinimized).toBe(true)
    })
})
