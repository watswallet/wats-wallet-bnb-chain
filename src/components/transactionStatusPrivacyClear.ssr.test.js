// "Tamamlananlari temizle" ve otomatik kapanma GORUNMEYEN tarafin kayitlarina
// dokunmaz (C-I3, spec 7.3 ile ayni sinif).
//
// KOK NEDEN: clearTransactions TUM listeyi suzuyordu ve otomatik kapanma izleyicisi
// txStore.transactions (iki taraf birden) uzerinde calisiyordu. Normal tarafta "temizle"ye
// basmak gizli tarafin BASARISIZ kartini siliyor, gizli taraftaki basarili kart de
// kullanici hic gormeden 6 sn sonra dusuyordu. txAutoDismiss.js'in iki kurali (basarisiz
// kart gorulmeden kaybolmaz; sure kartin GORUNDUGU andan sayilir) gorunmeyen tarafta bozuluyordu.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { useTransactionStore } from '../store/transaction.js'
import { privacyStore } from '../store/privacy.js'
import { SUCCESS_TTL_MS } from '../utils/txAutoDismiss.js'
import TransactionStatus from './TransactionStatus.vue'

afterEach(() => {
    vi.useRealTimers()
    delete globalThis.chrome
})

const kayit = (id, status, accountKey) => ({
    id, status, timestamp: 1, accountKey,
    meta: { chainId: 56, amount: '1', symbol: 'BNB', type: 'Transaction' },
})

async function kur({ privateActive, txs }) {
    vi.useFakeTimers()
    const stub = installChromeStub({ current_transactions: txs })
    const app = createApp(TransactionStatus)
    app.use(createTestPinia())
    app.use(createTestI18n('tr'))
    const store = useTransactionStore()
    store.transactions = txs
    const privacy = privacyStore()
    privacy.active = privateActive
    privacy.privateAccountKey = 'g-1'
    const captured = captureInstance(app, 'TransactionStatus')
    await render(app)
    return { store, privacy, stub, state: captured.instance.setupState }
}

const idler = (store) => store.transactions.map((t) => t.id)

describe('Tamamlananlari temizle -- yalniz GORUNEN taraf', () => {
    it('normal tarafta temizlemek gizli tarafin BASARISIZ kaydini silmez', async () => {
        const { store, stub, state } = await kur({
            privateActive: false,
            txs: [kayit('n-ok', 'success', 'a-1'), kayit('n-err', 'error', 'a-1'), kayit('g-err', 'error', 'g-1'), kayit('g-ok', 'success', 'g-1'), kayit('n-run', 'processing', 'a-1')],
        })
        stub.localStore.current_transactions = store.transactions

        await state.clearCompleted()

        expect(idler(store)).toEqual(['g-err', 'g-ok', 'n-run'])
        // DEPODA da ayni: bellekteki liste degil, kalici liste
        expect(stub.localStore.current_transactions.map((t) => t.id)).toEqual(['g-err', 'g-ok', 'n-run'])
    })

    it('gizli tarafta temizlemek normal tarafin kayitlarina dokunmaz', async () => {
        const { store, stub, state } = await kur({
            privateActive: true,
            txs: [kayit('n-err', 'error', 'a-1'), kayit('g-err', 'error', 'g-1'), kayit('eski', 'error', undefined)],
        })
        stub.localStore.current_transactions = store.transactions

        await state.clearCompleted()

        // accountKey'siz eski kayit normal taraftir
        expect(idler(store)).toEqual(['n-err', 'eski'])
    })

    it('store kapsami: id listesi disindaki tamamlanmis kayit KALIR, suren kayit hic silinmez', async () => {
        const { store, stub } = await kur({
            privateActive: false,
            txs: [kayit('a', 'success', 'a-1'), kayit('b', 'error', 'a-1'), kayit('c', 'processing', 'a-1')],
        })
        stub.localStore.current_transactions = store.transactions

        await store.clearTransactions(['a', 'c'])

        expect(idler(store)).toEqual(['b', 'c'])
    })
})

describe('otomatik kapanma -- yalniz GORUNEN taraf', () => {
    it('gizli taraftaki basarili kayit, kullanici gormeden SURESI DOLUP SILINMEZ', async () => {
        const { store } = await kur({
            privateActive: false,
            txs: [kayit('g-ok', 'success', 'g-1'), kayit('n-ok', 'success', 'a-1')],
        })

        await vi.advanceTimersByTimeAsync(SUCCESS_TTL_MS + 500)

        // Normal taraftaki kayit dustu, gizli taraftaki ise duruyor.
        expect(idler(store)).toEqual(['g-ok'])
    })

    // SSR'da watch yalniz ilk (immediate) calismayi yapar, taraf degisimine tepki VERMEZ:
    // bu yuzden "tarafa gecince sayac baslar / ayrilinca iptal olur" davranisi burada
    // calistirilamaz. Onun yerine mekanizmanin KAYNAGI kilitlenir: izleyici gorunen liste
    // uzerinde olmali (computed taraf degisince yeni dizi uretir, izleyici yeniden kosar ve
    // gorunmeyen kayitlarin sayaclarini iptal eder).
    it('izleyici TUM listeyi degil GORUNEN listeyi izler (kaynak kilidi)', () => {
        const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'TransactionStatus.vue'), 'utf8')
        expect(src).toContain('watch(visibleTransactions, (list) => {')
        expect(src).toContain('autoDismissIds(list, tonFeeTone)')
        expect(src).not.toContain('watch(() => txStore.transactions')
        expect(src).toContain('txStore.clearTransactions(clearableIds.value)')
    })
})

describe('kucultulmus balon GORUNEN listeden turer', () => {
    it('gorunen liste bosalinca kucultme sifirlanir (gizli taraftaki kayit sayilmaz)', async () => {
        const { store, state } = await kur({
            privateActive: false,
            txs: [kayit('n-err', 'error', 'a-1'), kayit('g-err', 'error', 'g-1')],
        })
        store.minimize()
        expect(store.isMinimized).toBe(true)

        await state.clearCompleted()

        // Depoda gizli taraf kaydi KALDI ama gorunen liste bos: yeni gelen kart
        // kucuk balonda degil acik panelde gorunmeli.
        expect(idler(store)).toEqual(['g-err'])
        expect(store.isMinimized).toBe(false)
    })
})
