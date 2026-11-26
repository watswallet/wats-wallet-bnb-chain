// Balon (kucultulmus gorunum) tonu/etiketi: hata karti ve "Gonderildi" ayrimi.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { useTransactionStore } from '../store/transaction.js'
import TransactionStatus from './TransactionStatus.vue'
import tr from '../i18n/locales/tr.json'
import { readFileSync } from 'node:fs'

afterEach(() => { delete globalThis.chrome })

const kart = (id, status, extra = {}) => ({ id, status, timestamp: 1, meta: { chainId: 56, amount: '1', type: 'Transaction', ...extra } })

async function balon(txs) {
    installChromeStub({ current_transactions: txs })
    const app = createApp(TransactionStatus)
    app.use(createTestPinia())
    app.use(createTestI18n('tr'))
    const store = useTransactionStore()
    store.transactions = txs
    store.isMinimized = true
    return render(app)
}

describe('balon hata tonu', () => {
    it('yalniz error karti varken hata tonu + Islem Basarisiz etiketi, Tamamlandi degil', async () => {
        const html = await balon([kart('e', 'error')])
        expect(html).toContain(tr.transactionStatus.failed)
        expect(html).not.toContain(tr.transactionStatus.completed)
        expect(html).toContain('text-rose-600')
        expect(html).not.toContain('d="M5 13l4 4L19 7"')
        expect(html).toContain('d="M6 18L18 6M6 6l12 12"')
    })

    it('aktif islem varken hata karti da varsa hata rengi onceliklidir, sayi etiketi kalir', async () => {
        const html = await balon([kart('e', 'error'), kart('p', 'processing')])
        expect(html).toContain('text-rose-600')
        expect(html).toContain(tr.transactionStatus.pillProcessingOne)
    })

    it('hata karti yokken eski davranis: tamamlandi + yesil', async () => {
        const html = await balon([kart('s', 'success')])
        expect(html).toContain(tr.transactionStatus.completed)
        expect(html).toContain('text-emerald-600')
    })
})

describe('transactionStatus.failed 12 dilde dolu', () => {
    for (const l of ['tr', 'en', 'es', 'pt-BR', 'ru', 'zh-CN', 'vi', 'id', 'ko', 'ja', 'de', 'fr']) {
        it(l, () => {
            const j = JSON.parse(readFileSync(new URL(`../i18n/locales/${l}.json`, import.meta.url), 'utf-8'))
            expect(typeof j.transactionStatus.failed).toBe('string')
            expect(j.transactionStatus.failed.length).toBeGreaterThan(0)
        })
    }
})

describe('Gonderildi ayrimi (hash gelmis processing)', () => {
    it('hash gelmis processing balonda Gonderildi der', async () => {
        const html = await balon([kart('p', 'processing', { txHash: '0xabc' })])
        expect(html).toContain(tr.transactionStatus.pillSentOne)
        expect(html).not.toContain(tr.transactionStatus.pillProcessingOne)
    })
    it('hash yoksa processing sureyor der', async () => {
        const html = await balon([kart('p', 'processing')])
        expect(html).toContain(tr.transactionStatus.pillProcessingOne)
        expect(html).not.toContain(tr.transactionStatus.pillSentOne)
    })
    it('hashli ve hashsiz karisikken surucu etiket (Gonderildi demez)', async () => {
        const html = await balon([kart('a', 'processing', { txHash: '0xabc' }), kart('b', 'processing')])
        expect(html).toContain('2 işlem sürüyor')
    })
    it('hashli processing + kuyrukta kart: Gonderildi demez', async () => {
        const html = await balon([kart('a', 'processing', { txHash: '0xabc' }), kart('b', 'queued')])
        expect(html).not.toContain(tr.transactionStatus.pillSentOne)
    })
    it('acik panelde kart durum sozcugu Gonderildi, hashsiz Islem Suruyor', async () => {
        installChromeStub({ current_transactions: [] })
        const txs = [kart('a', 'processing', { txHash: '0xabc' }), kart('b', 'processing')]
        const app = createApp(TransactionStatus)
        app.use(createTestPinia())
        app.use(createTestI18n('tr'))
        const store = useTransactionStore()
        store.transactions = txs
        store.isMinimized = false
        const html = await render(app)
        expect(html).toContain('>Gönderildi<')
        expect(html).toContain('>İşlem Sürüyor<')
    })
})

describe('Gonderildi anahtarlari 12 dilde dolu', () => {
    for (const l of ['tr', 'en', 'es', 'pt-BR', 'ru', 'zh-CN', 'vi', 'id', 'ko', 'ja', 'de', 'fr']) {
        it(l, () => {
            const j = JSON.parse(readFileSync(new URL(`../i18n/locales/${l}.json`, import.meta.url), 'utf-8'))
            for (const k of ['sent', 'pillSentOne', 'pillSentMany']) {
                expect(j.transactionStatus[k], k).toBeTruthy()
            }
            expect(j.transactionStatus.pillSentMany).toContain('{count}')
        })
    }
})
