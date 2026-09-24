// Kendiliginden kapanma UCTAN UCA: bilesen GERCEKTEN render edilir, sayac
// gercekten isler ve kayit DEPODAN dusme kadar izlenir.
//
// NEDEN kaynak-sekil testi YETMEZ: txAutoDismiss.test.js "ne kapanmali"yi, bu
// dosya "gercekten kapaniyor mu"yu olcer. Ikisi ayrisirsa (or. watch hic
// tetiklenmezse ya da clearTransaction yanlis argumanla cagrilirsa) yalniz bu
// dosya kirmiziya doner.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { useTransactionStore } from '../store/transaction.js'
import { SUCCESS_TTL_MS } from '../utils/txAutoDismiss.js'
import TransactionStatus from './TransactionStatus.vue'

const meta = { chainId: 56, amount: '1', type: 'Transaction' }

const kayit = (id, status, tonFeeState) => ({
    id, status, timestamp: 1,
    meta: tonFeeState ? { ...meta, tonFeeState } : { ...meta },
})

afterEach(() => {
    vi.useRealTimers()
    delete globalThis.chrome
})

async function kur(txs) {
    vi.useFakeTimers()
    installChromeStub({ current_transactions: txs })
    const app = createApp(TransactionStatus)
    app.use(createTestPinia())
    app.use(createTestI18n('tr'))
    const store = useTransactionStore()
    store.transactions = txs
    await render(app)
    return store
}

const kalanlar = (store) => store.transactions.map((t) => t.id)

describe('islem karti kendiliginden kapanir (uctan uca)', () => {
    it('basarili kayit sure dolunca DEPODAN duser, basarisiz KALIR', async () => {
        const store = await kur([kayit('ok', 'success'), kayit('err', 'error')])

        // Sure DOLMADAN hicbir sey silinmez: erken kaybolan bir onay,
        // gosterilmemis onaydir.
        await vi.advanceTimersByTimeAsync(SUCCESS_TTL_MS - 500)
        expect(kalanlar(store)).toEqual(['ok', 'err'])

        await vi.advanceTimersByTimeAsync(1000)
        expect(kalanlar(store)).toEqual(['err'])
    })

    it('suren ve kuyruktaki kayitlar KAPANMAZ', async () => {
        const store = await kur([kayit('p', 'processing'), kayit('q', 'queued')])
        await vi.advanceTimersByTimeAsync(SUCCESS_TTL_MS * 3)
        expect(kalanlar(store)).toEqual(['p', 'q'])
    })

    // Ucret ALINMIS ama sonuc BILINMIYOR. Kaydi sessizce silmek, kullaniciyi
    // islemin hic olmadigini sanip TEKRAR gondermeye iter -- ikinci bir ucret.
    it.each(['recovering', 'unresolved', 'not-charged'])(
        "TON ucret durumu '%s' iken tx.status 'success' OLSA BILE kapanmaz",
        async (state) => {
            const store = await kur([kayit('ton', 'success', state)])
            await vi.advanceTimersByTimeAsync(SUCCESS_TTL_MS * 3)
            expect(kalanlar(store)).toEqual(['ton'])
        },
    )

    it('son kayit da dusunce liste BOSALIR -- ekranda hicbir sey kalmaz', async () => {
        const store = await kur([kayit('ok', 'success')])
        await vi.advanceTimersByTimeAsync(SUCCESS_TTL_MS + 500)
        expect(kalanlar(store)).toEqual([])
    })
})
