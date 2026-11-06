// ISLEM KARTLARININ GIZLI/NORMAL SUZMESI (spec 7.3) -- islenmis HTML uzerinden.
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

import { createApp, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'
import { useTransactionStore } from '../store/transaction.js'
import { privacyStore } from '../store/privacy.js'
import TransactionStatus from './TransactionStatus.vue'

afterEach(() => {
    delete globalThis.chrome
})

const kayit = (id, accountKey) => ({
    id, status: 'processing', timestamp: 1, accountKey,
    meta: { chainId: 56, amount: '1', symbol: 'BNB', type: 'Transaction', recipient: '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b349f' },
})

async function html({ privateActive, txs }) {
    installChromeStub({ current_transactions: txs })
    const app = createApp(TransactionStatus)
    app.use(createTestPinia())
    app.use(createTestI18n('tr'))
    useTransactionStore().transactions = txs
    const privacy = privacyStore()
    privacy.active = privateActive
    privacy.privateAccountKey = 'g-1'
    return render(app)
}

const kartSayisi = (out) => out.split('<article').length - 1

describe('TransactionStatus -- gizli/normal suzme', () => {
    const txs = [kayit('t-normal', 'a-1'), kayit('t-gizli', 'g-1'), kayit('t-eski', undefined)]

    it('normal modda Gizli Hesap kaydi cizilmez, digerleri cizilir', async () => {
        expect(kartSayisi(await html({ privateActive: false, txs }))).toBe(2)
    })

    it('gizli modda yalniz Gizli Hesap kaydi cizilir', async () => {
        expect(kartSayisi(await html({ privateActive: true, txs }))).toBe(1)
    })

    it('gorunur kayit yoksa kart hic cizilmez', async () => {
        expect(kartSayisi(await html({ privateActive: true, txs: [kayit('t-normal', 'a-1')] }))).toBe(0)
    })
})
