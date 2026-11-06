// History.vue'yu GERCEKTEN render eden testler (bkz. src/test-utils/ssrRender.js).
//
// KOK NEDEN (review round 1, Bulgu 1): historyWiring.test.js SADECE kaynak
// metnini tarar, bilesen HIC CALISTIRILMAZ. Reviewer'in bulgusu buydu: uc kilit
// (base58 kucultme, Number(chainId), chainVm gecidi) YENIDEN ADLANDIRMAYLA
// (rename) YENILEBILIYORDU -- orn. `explorerTxUrl(chainId, hash?.toLowerCase())`
// dort `.toLowerCase()` kontrolunun TUMUNU gecip tam suite'i yesil birakiyordu;
// `chainVm(...) === 'solana' || chainVm(...) === 'evm'` (HER ZAMAN dogru) ayni
// sekilde literal-koruyan bir mutasyonla gecidi atlatiyordu. Bu dosya o UC
// KILIDI DAVRANISLA (bilesen GERCEKTEN render edilip GERCEK HTML/durum
// okunarak) DEGISTIRIR; ayrica review'in isaret ettigi iki veri-akisi bulgusunu
// (yerel bekleyen islem, basarisiz islem) da RENDER EDILMIS listede dogrular.
//
// 'vue' mock'u BURADA, dosyanin KENDISINDE olmak ZORUNDA (bkz. ssrRender.js
// basindaki KULLANIM notu -- hoisting, bilesen import edilmeden ONCE devreye
// girmesi gerekir).
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('vue', async (importOriginal) => {
    const actual = await importOriginal()
    return { ...actual, onMounted: actual.onServerPrefetch }
})

const axiosPostMock = vi.fn(async () => ({ data: { history: [] } }))
vi.mock('axios', () => ({ default: { post: (...args) => axiosPostMock(...args) } }))

import { createApp, captureInstance, render, installChromeStub, createTestPinia, createTestI18n } from '../test-utils/ssrRender.js'

/**
 * Yalnizca METIN DUGUMLERI: tum etiketleri (dolayisiyla aria-label/title gibi
 * NITELIKLERI de) atar.
 *
 * KOD INCELEMESI (aktivite yenilemesi): satira `:aria-label="satirOzeti(tx)"`
 * eklendi ve bu ozet durum metnini de iceriyor. Ham HTML uzerinde yapilan
 * `toContain('Failed')` artik GORUNMEZ bir erisilebilirlik niteligiyle de
 * doyuyordu: gorunur durum etiketi sablondan TAMAMEN silinse bile test yesil
 * kaliyordu -- olculdu. "Ekranda GORUNUR" iddiasi metin dugumleri uzerinde
 * kurulmak zorunda.
 */
const gorunurMetin = (html) => html.replace(/<[^>]*>/g, ' ')
import { networkStore } from '../store/network'
import History from './History.vue'
import supported_chains from '../data/supported_chains.json'

const SOLANA_CHAIN = supported_chains.find((c) => c.chainId === 'solana-mainnet')
const ETH_CHAIN = supported_chains.find((c) => c.chainId === 1)

const ME = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const OTHER_MIXED_CASE = 'DrPbCbmxVNdk7maPM5tGv6MvB3v1sRMC86PZ8okm21hY'

afterEach(() => {
    vi.unstubAllGlobals()
    axiosPostMock.mockClear()
    delete globalThis.chrome
})

/**
 * Pinia + i18n kurulu bir SSR uygulamasi. `network.currentNetwork` render'dan
 * ONCE senkron olarak ayarlanir: networkStore'un KENDI `initializeCurrentNetwork()`si
 * (store olusunca fire-and-forget cagrilir) chrome.storage'i ASENKRON okur; bu
 * yarisla CAKISMAMAK icin BURADA hem store hem de (installChromeStub'a verilen
 * `currentNetwork`) AYNI kayitla senkronize edilir.
 */
function setup(chainRecord) {
    const app = createApp(History, { props: { embedded: true } })
    app.use(createTestPinia())
    app.use(createTestI18n())

    const network = networkStore()
    network.currentNetwork = chainRecord

    return { app, network }
}

describe('History.vue (SSR) — EVM/Solana yol ayrimi GERCEK render ile (Bulgu 4, "mutasyon 7")', () => {
    // KOK NEDEN: `chainVm(network.currentNetwork) === 'solana'` kontrolu
    // `=== 'solana' || chainVm(...) === 'evm'`e (HER ZAMAN DOGRU) donusturulse
    // eski kaynak-tarama kilidi (fn.indexOf ile literal arama) YINE de satiri
    // BULURDU -- cunku aranan alt-dizgi hala METIN icinde. Bu test DAVRANISA
    // bakar: EVM seciliyken Solana ucu (/solana/history) HIC cagrilmamali.
    it('EVM zincirinde /solana/history HIC CAGRILMAZ, /wallet/history CAGRILIR', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        installChromeStub({
            currentNetwork: ETH_CHAIN,
            active_account: { address: '0xAbCdEf0000000000000000000000000000000001' },
            pending_transactions: [],
        })

        const { app } = setup(ETH_CHAIN)
        await render(app)

        expect(fetchMock).not.toHaveBeenCalled()
        expect(axiosPostMock).toHaveBeenCalledTimes(1)
        expect(axiosPostMock.mock.calls[0][0]).toContain('/wallet/history')
    })

    // Ayna testi: Solana seciliyken axios.post (EVM ucu) HIC cagrilmamali --
    // "erken doner" kilidinin (eski kaynak-tarama testi) davranisla karsiligi.
    // Ayni zamanda "Number(chainId)" kilidinin de davranissal karsiligi: bu
    // test 'solana-mainnet' GERCEK (metin, sayiya CEVRILEMEZ) chainId'siyle
    // calisir -- yolun Number() donusumune DAYANMADIGINI kanitlar.
    it('Solana zincirinde axios.post (EVM ucu) HIC CAGRILMAZ, /solana/history CAGRILIR', async () => {
        const fetchMock = vi.fn(async () => ({
            ok: true, status: 200, json: async () => ({ success: true, history: [] }),
        }))
        vi.stubGlobal('fetch', fetchMock)
        installChromeStub({
            currentNetwork: SOLANA_CHAIN,
            active_account: { solanaAddress: ME },
            pending_transactions: [],
        })

        const { app } = setup(SOLANA_CHAIN)
        await render(app)

        expect(axiosPostMock).not.toHaveBeenCalled()
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock.mock.calls[0][0]).toContain('/solana/history')
    })
})

describe('History.vue (SSR) — base58 imza/adres modalde KUCULTULMEDEN gorunur (Bulgu 4)', () => {
    // KOK NEDEN: `getExplorerUrl`/`modalFrom`/`modalTo` gibi <script setup>
    // kapanislari, tikla-madan disaridan ULASILAMAZ (bkz. ssrRender.js'teki
    // teknik not). `captureInstance`'in `onCapture` callback'i ile HAM
    // instance'a erisilip `setupState.selectedTx` DOGRUDAN atanarak modal,
    // gercek bir click OLMADAN, AYNI render turunde acilir.
    it('explorer baglantisi ve ekrandaki adresler HARF KASASI KORUNARAK gosterilir', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, history: [] }) })))
        installChromeStub({
            currentNetwork: SOLANA_CHAIN,
            active_account: { solanaAddress: ME },
            pending_transactions: [],
        })

        const { app } = setup(SOLANA_CHAIN)

        const mixedCaseRow = {
            hash: 'SiGnAtUrEwItHmIxEdCaSe1111111111111111111111',
            direction: 'out',
            counterparty: OTHER_MIXED_CASE,
            amount: 1.5,
            symbol: 'SOL',
            mint: null,
            timestamp: Date.now(),
            status: 'success',
        }
        captureInstance(app, 'History', (instance) => {
            instance.setupState.selectedTx = mixedCaseRow
        })

        const html = await render(app)

        // Explorer baglantisi: imza AYNEN (kucultulmeden) URL'e gecmeli.
        expect(html).toContain(`https://solscan.io/tx/${mixedCaseRow.hash}`)
        expect(html).not.toContain(mixedCaseRow.hash.toLowerCase())

        // "Etkilesim" alani (out yonu -> karsi taraf gosterilir) karsi tarafin
        // KISALTILMIS ama KUCULTULMEMIS halini icermeli (formatAddress: ilk 6 +
        // son 4 karakter).
        const expectedTruncated = `${mixedCaseRow.counterparty.slice(0, 6)}...${mixedCaseRow.counterparty.slice(-4)}`
        expect(html).toContain(expectedTruncated)
        expect(html).not.toContain(expectedTruncated.toLowerCase())
    })

    // Kendi adresimiz (solanaMyAddress) de "Gonderen" alaninda AYNI SEKILDE
    // kucultulmeden gosterilmeli.
    it('"Gonderen" alani KENDI adresimizi (solanaMyAddress) kucultmeden gosterir', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, history: [] }) })))
        installChromeStub({
            currentNetwork: SOLANA_CHAIN,
            active_account: { solanaAddress: ME },
            pending_transactions: [],
        })

        const { app } = setup(SOLANA_CHAIN)
        captureInstance(app, 'History', (instance) => {
            instance.setupState.selectedTx = {
                hash: 'SIG', direction: 'out', counterparty: OTHER_MIXED_CASE,
                amount: 1, symbol: 'SOL', mint: null, timestamp: Date.now(), status: 'success',
            }
        })

        const html = await render(app)

        const expectedFrom = `${ME.slice(0, 6)}...${ME.slice(-4)}`
        expect(html).toContain(expectedFrom)
        expect(html).not.toContain(expectedFrom.toLowerCase())
    })
})

describe('History.vue (SSR) — yerel bekleyen Solana islemi listede GORUNUR (Bulgu 2)', () => {
    // KOK NEDEN: History.vue'nun Solana dali `pending_transactions`e HIC
    // BAKMIYORDU; kullanici 5 SOL gonderir, Helius henuz indekslemeden Gecmis'i
    // acar, "Islem bulunamadi" gorur, gonderiminin basarisiz oldugunu sanip
    // TEKRAR gonderir (cift gonderim). Bu test bilesini GERCEKTEN render edip
    // olusan HTML'de satirin VAR OLDUGUNU dogrular (loadHistory.test.js'teki
    // pure testler mantigi kanitlar, burasi WIRING'in KENDISINI kanitlar).
    it('Helius bos donse bile yerel bekleyen islem listede satir olarak gorunur', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true, history: [] }) })))
        installChromeStub({
            currentNetwork: SOLANA_CHAIN,
            active_account: { solanaAddress: ME },
            pending_transactions: [{
                hash: 'PENDING_SIG_1', chainId: 'solana-mainnet',
                from_address: ME, to_address: OTHER_MIXED_CASE,
                value: '5', asset: 'native', receipt_status: 'pending',
                block_timestamp: new Date().toISOString(),
            }],
        })

        const { app } = setup(SOLANA_CHAIN)
        const captured = captureInstance(app, 'History')
        const html = await render(app)

        // "Islem bulunamadi" (bos-liste metni) GORUNMEMELI -- bilinen bir
        // islem var.
        expect(html).not.toContain('No transactions found')
        expect(captured.instance.setupState.transactions).toHaveLength(1)
        expect(captured.instance.setupState.transactions[0]).toMatchObject({ hash: 'PENDING_SIG_1', status: 'pending' })
    })

    // KOD INCELEMESI (review round 2, Bulgu A): onceki turde /solana/history
    // hata verirken (yerel kayit VARKEN) hata sinyalinin ve "tekrar dene"
    // dugmesinin TAMAMEN kayboldugu (asagida negatif olarak dogrulanan eski
    // davranis) bir kullaniciya "gecmisim silinmis, elimde basacak hicbir
    // sey yok" izlenimi verirdi. Duzeltme: hata INCE bir banner olarak
    // listenin USTUNDE kalir, "tekrar dene" ULASILABILIR olur, satir da
    // GORUNMEYE devam eder -- hicbiri digerini EZMEZ.
    it('/solana/history HATA VERSE bile yerel bekleyen islem listede kalir, hata + "tekrar dene" banner olarak GORUNUR', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) })))
        installChromeStub({
            currentNetwork: SOLANA_CHAIN,
            active_account: { solanaAddress: ME },
            pending_transactions: [{
                hash: 'PENDING_SIG_2', chainId: 'solana-mainnet',
                from_address: ME, to_address: OTHER_MIXED_CASE,
                value: '2', asset: 'native', receipt_status: 'pending',
                block_timestamp: new Date().toISOString(),
            }],
        })

        const { app } = setup(SOLANA_CHAIN)
        const captured = captureInstance(app, 'History')
        const html = await render(app)

        expect(captured.instance.setupState.historyError).toBe('fetch')
        expect(captured.instance.setupState.transactions).toHaveLength(1)
        // Hata metni VE "tekrar dene" dugmesi GORUNUR (tam ekranda DEGIL,
        // listenin ustunde bir banner olarak) -- FINDING A'nin tam istedigi.
        expect(gorunurMetin(html)).toContain('Could not load history')
        expect(gorunurMetin(html)).toContain('Try again')
        // Bos-liste durumunun metni GORUNMEMELI: bilinen bir satir var.
        expect(html).not.toContain('No transactions found')
    })
})

describe('History.vue (SSR) — basarisiz Solana islemi listeden DUSMEZ (Bulgu 3)', () => {
    // KOK NEDEN: `.filter(Boolean)` -> `.filter(r => Boolean(r) && r.status !== 'failed')`
    // mutasyonu loadHistory.test.js'te KIRMIZIYA duser (bkz. Task 14 review
    // round 1 rapor), ama bu WIRING'in KENDISINI (History.vue'nun bu satiri
    // GERCEKTEN render ettigini) kanitlamaz -- burasi onu kapatir.
    it('status: failed satir HTML de "Basarisiz" olarak GORUNUR, listeden dusmez', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true, status: 200,
            json: async () => ({
                success: true,
                history: [{
                    signature: 'FAILED_SIG', timestamp: Math.floor(Date.now() / 1000), type: 'TRANSFER',
                    nativeTransfers: [{ fromUserAccount: ME, toUserAccount: OTHER_MIXED_CASE, amount: 1_000_000_000 }],
                    tokenTransfers: [],
                    transactionError: { InstructionError: [0, 'Custom'] },
                }],
            }),
        })))
        installChromeStub({
            currentNetwork: SOLANA_CHAIN,
            active_account: { solanaAddress: ME },
            pending_transactions: [],
        })

        const { app } = setup(SOLANA_CHAIN)
        const captured = captureInstance(app, 'History')
        const html = await render(app)

        expect(captured.instance.setupState.transactions).toHaveLength(1)
        expect(captured.instance.setupState.transactions[0].status).toBe('failed')
        expect(gorunurMetin(html)).toContain('Failed')
    })
})

// Task 25 (Review Focus 5): CoW emri satirlari Gecmis'te dogru gorunur.
describe('History.vue (SSR) - CoW emri rozetleri (Review Focus 5)', () => {
    const EVM_ME = '0xAbCdEf0000000000000000000000000000000001'
    const UID_A = '0x' + 'a1'.repeat(56)
    const UID_B = '0x' + 'b2'.repeat(56)
    const yorumsuz = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
    const cowRow = (extra = {}) => ({
        hash: UID_A, cow_uid: UID_A, source: 'cow', chainId: 1, chain_id: 1,
        from_address: EVM_ME, to_address: '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110',
        category: 'token swap', summary: 'Swap 100 USDC to 0.4 TSLAx', nonce: null,
        receipt_status: 'pending', block_timestamp: new Date().toISOString(), ...extra,
    })

    async function renderList(rows, onCapture) {
        installChromeStub({ currentNetwork: ETH_CHAIN, active_account: { address: EVM_ME }, pending_transactions: rows })
        const { app } = setup(ETH_CHAIN)
        if (onCapture) captureInstance(app, 'History', onCapture)
        return yorumsuz(await render(app))
    }

    it('(a) expired satir "Expired" gosterir, kirmizi sinif ve "Failed" metni YOK', async () => {
        const html = await renderList([cowRow({ receipt_status: 'expired' })])
        expect(gorunurMetin(html)).toContain('Expired')
        expect(gorunurMetin(html)).not.toContain('Failed')
        expect(html).not.toContain('text-red')
        expect(html).not.toContain('line-through')
        // rozet notr (swap kategorisinin indigo rengine dusmez)
        expect(html).not.toContain('bg-indigo-500/10')
    })

    it('(a2) cancelled satir "Cancelled" gosterir, kirmizi DEGIL', async () => {
        const html = await renderList([cowRow({ receipt_status: 'cancelled' })])
        expect(gorunurMetin(html)).toContain('Cancelled')
        expect(gorunurMetin(html)).not.toContain('Failed')
        expect(html).not.toContain('text-red')
    })

    it('(b) pending satir amber', async () => {
        const html = await renderList([cowRow()])
        expect(html).toContain('text-amber-700')
        expect(gorunurMetin(html)).toContain('Pending')
    })

    it('(c) fulfilled satir "Done" gosterir ve gezgin baglantisi VAR', async () => {
        const txHash = '0x' + 'c3'.repeat(32)
        const row = cowRow({ receipt_status: '1', hash: txHash, nonce: '7' })
        const html = await renderList([row], (instance) => { instance.setupState.selectedTx = row })
        expect(gorunurMetin(html)).toContain('Done')
        expect(html).toContain('/tx/ethereum/' + txHash)
    })

    it('(d) UID li pending satirin detayinda gezgin baglantisi ve Nonce YOK, hash kutusu VAR', async () => {
        const row = cowRow()
        const html = await renderList([row], (instance) => { instance.setupState.selectedTx = row })
        expect(html).not.toContain('/tx/ethereum/')
        expect(gorunurMetin(html)).not.toContain('View on Explorer')
        expect(html).not.toContain('target="_blank"')
        expect(gorunurMetin(html)).not.toContain('Nonce')
        expect(gorunurMetin(html)).toContain(UID_A.slice(0, 10) + '...' + UID_A.slice(-10))
    })

    it('(d2) nonce i olan duz EVM satirinda Nonce hala gorunur', async () => {
        const row = { hash: '0x' + 'd4'.repeat(32), chainId: 1, from_address: EVM_ME, category: 'send', nonce: '5', receipt_status: '1', block_timestamp: new Date().toISOString() }
        const html = await renderList([row], (instance) => { instance.setupState.selectedTx = row })
        expect(gorunurMetin(html)).toContain('Nonce')
        expect(html).toContain('/tx/ethereum/' + row.hash)
    })

    it('(e) duz EVM receipt_status 0 satiri hala "Failed" ve kirmizi', async () => {
        const row = { hash: '0x' + 'e5'.repeat(32), chainId: 1, from_address: EVM_ME, category: 'send', nonce: '5', receipt_status: '0', block_timestamp: new Date().toISOString() }
        const html = await renderList([row])
        expect(gorunurMetin(html)).toContain('Failed')
        expect(html).toContain('text-red')
    })

    it('uc zincirde ayni adres iki bekleyen CoW satiri AYRI satir cizilir', async () => {
        const rows = [cowRow({ hash: UID_A, cow_uid: UID_A, chainId: 1, chain_id: 1 }), cowRow({ hash: UID_B, cow_uid: UID_B, chainId: 56, chain_id: 56 })]
        const html = await renderList(rows)
        expect((html.match(/<button aria-label="Swap/g) || []).length).toBe(2)
    })
})

// Faz 3 Task 15: CoW satirlarinin altinda ATS ucret / iade durumu.
describe('History.vue (SSR) - CoW ucret ve iade alt satirlari (Faz 3)', () => {
    const EVM_ME = '0xAbCdEf0000000000000000000000000000000001'
    const UID_A = '0x' + 'a1'.repeat(56)
    const REFUND_HASH = '0x' + 'f6'.repeat(32)
    const yorumsuz = (html) => html.replace(/<!--[\s\S]*?-->/g, '')
    const cowRow = (extra = {}) => ({
        hash: UID_A, cow_uid: UID_A, source: 'cow', chainId: 1, chain_id: 1,
        from_address: EVM_ME, to_address: '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110',
        category: 'token swap', summary: 'Swap 100 USDC to 0.4 TSLAx', nonce: null,
        receipt_status: '1', block_timestamp: new Date().toISOString(), ...extra,
    })
    const paidView = (refund) => ({ uid: UID_A, state: 'paid', refund })

    async function renderList(rows, fees, onCapture) {
        const stub = installChromeStub({ currentNetwork: ETH_CHAIN, active_account: { address: EVM_ME }, pending_transactions: rows })
        const sent = []
        stub.setSendMessage(async (msg) => {
            sent.push(msg)
            return msg?.type === 'COW_FEE_STATUS' ? { success: true, fees: fees ?? [] } : {}
        })
        const { app } = setup(ETH_CHAIN)
        if (onCapture) captureInstance(app, 'History', onCapture)
        const html = yorumsuz(await render(app))
        return { html, sent }
    }
    const feeCalls = (sent) => sent.filter((m) => m?.type === 'COW_FEE_STATUS').length

    it('paid + iade hesaplaniyor -> alt satir metni', async () => {
        const { html } = await renderList([cowRow()], [paidView({ state: 'claimable' })])
        expect(gorunurMetin(html)).toContain('Transaction fee paid. Calculating the refund')
    })

    it('iade gonderildi -> liste alt satiri ve detayda tutar + iade karmasi baglantisi', async () => {
        const row = cowRow()
        const fees = [paidView({ state: 'sent', atsRaw: '31000000000000000', txHash: REFUND_HASH })]
        const { html } = await renderList([row], fees, (i) => { i.setupState.selectedTx = row })
        expect(gorunurMetin(html)).toContain('Network fee refund: +0.031 ATS')
        expect(html).toContain('data-cow-refund')
        expect(html).toContain('/tx/binance-smart-chain/' + REFUND_HASH)
    })

    it('Faz 2 CoW satiri (view yok): cikti ucret satiri icermez', async () => {
        const { html } = await renderList([cowRow()], [])
        expect(html).not.toContain('data-cow-fee')
        expect(gorunurMetin(html)).toContain('Done')
    })

    it('expired satirda ucret satiri YOK ve "Failed" cikmaz', async () => {
        const { html } = await renderList([cowRow({ receipt_status: 'expired' })], [{ uid: UID_A, state: 'owed', refund: { state: 'none' } }])
        expect(html).not.toContain('data-cow-fee')
        expect(gorunurMetin(html)).toContain('Expired')
        expect(gorunurMetin(html)).not.toContain('Failed')
    })

    it('rejected iade kirmizi "Failed" uretmez, kisa kod gorunur', async () => {
        const { html } = await renderList([cowRow()], [paidView({ state: 'rejected', code: 'NO_FUNDS' })])
        expect(gorunurMetin(html)).toContain('NO_FUNDS')
        expect(gorunurMetin(html)).not.toContain('Failed')
    })

    it('COW_FEE_STATUS yalniz CoW satiri varken, tek kez cagrilir', async () => {
        const duz = { hash: '0x' + 'd4'.repeat(32), chainId: 1, from_address: EVM_ME, category: 'send', nonce: '5', receipt_status: '1', block_timestamp: new Date().toISOString() }
        const a = await renderList([duz], [])
        expect(feeCalls(a.sent)).toBe(0)
        const b = await renderList([cowRow()], [])
        expect(feeCalls(b.sent)).toBe(1)
    })

    it('COW_FEE_STATUS hata verse de liste cizilir', async () => {
        installChromeStub({ currentNetwork: ETH_CHAIN, active_account: { address: EVM_ME }, pending_transactions: [cowRow()] }).setSendMessage(async () => { throw new Error('x') })
        const { app } = setup(ETH_CHAIN)
        const html = yorumsuz(await render(app))
        expect(gorunurMetin(html)).toContain('Done')
    })
})
