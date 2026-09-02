import { describe, it, expect, vi } from 'vitest'
import { loadSolanaHistory, pendingSolanaTxToRow } from './loadHistory'
import { SOLANA_CHAIN_ID } from './constants'

const ME = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const OTHER = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'

describe('loadSolanaHistory', () => {
    it('active_account.solanaAddress varsa sendMessage HIC CAGRILMAZ', async () => {
        const sendMessage = vi.fn()
        const fetchHistory = vi.fn(async () => [])
        const r = await loadSolanaHistory({ activeAccount: { solanaAddress: ME }, sendMessage, fetchHistory })

        expect(sendMessage).not.toHaveBeenCalled()
        expect(r).toEqual({ transactions: [], error: null, address: ME })
    })

    it('solanaAddress yoksa SOLANA_GET_ADDRESS mesajiyla adres cozulur', async () => {
        const sendMessage = vi.fn(async () => ({ result: { address: ME } }))
        const fetchHistory = vi.fn(async () => [])
        const r = await loadSolanaHistory({ activeAccount: {}, sendMessage, fetchHistory })

        expect(sendMessage).toHaveBeenCalledWith({ type: 'SOLANA_GET_ADDRESS' })
        expect(fetchHistory).toHaveBeenCalledWith(ME)
        expect(r.address).toBe(ME)
    })

    // Bos liste "hic islemin yok" ile "adresin cozulemedi"yi AYNILASTIRIR ve
    // kullaniciya parasi kaybolmus gibi gorunur (bkz. Task 14 brief).
    it('adres hicbir yoldan cozulemezse error: "address" ile doner, fetchHistory CAGRILMAZ', async () => {
        const sendMessage = vi.fn(async () => ({ error: 'VAULT_LOCKED' }))
        const fetchHistory = vi.fn()
        const r = await loadSolanaHistory({ activeAccount: {}, sendMessage, fetchHistory })

        expect(r).toEqual({ transactions: [], error: 'address', address: '' })
        expect(fetchHistory).not.toHaveBeenCalled()
    })

    it('sendMessage FIRLATIRSA da error: "address" ile doner (cokmez)', async () => {
        const sendMessage = vi.fn(async () => { throw new Error('baglanti yok') })
        const fetchHistory = vi.fn()
        const r = await loadSolanaHistory({ activeAccount: null, sendMessage, fetchHistory })

        expect(r.error).toBe('address')
        expect(fetchHistory).not.toHaveBeenCalled()
    })

    it('fetchHistory basarili donerse satirlar toRow ile cevrilir, null olanlar dusurulur', async () => {
        const raw = [{ signature: 'S1' }, { signature: 'S2' }]
        const fetchHistory = vi.fn(async () => raw)
        const toRow = vi.fn((r) => (r.signature === 'S1' ? { hash: 'S1' } : null))

        const r = await loadSolanaHistory({ activeAccount: { solanaAddress: ME }, fetchHistory, toRow })

        expect(r).toEqual({ transactions: [{ hash: 'S1' }], error: null, address: ME })
        expect(toRow).toHaveBeenCalledWith(raw[0], ME)
        expect(toRow).toHaveBeenCalledWith(raw[1], ME)
    })

    // fetchHistory SOLANA_HISTORY_TIMEOUT / SOLANA_HISTORY_HTTP_<status> firlatir
    // (bkz. history.js); ekran SONSUZA DEK "yukleniyor" gostermemeli.
    it('fetchHistory firlatirsa error: "fetch" ile doner, transactions bos', async () => {
        const fetchHistory = vi.fn(async () => { throw new Error('SOLANA_HISTORY_TIMEOUT') })
        const r = await loadSolanaHistory({ activeAccount: { solanaAddress: ME }, fetchHistory })

        expect(r).toEqual({ transactions: [], error: 'fetch', address: ME })
    })

    it('fetchHistory dizi-disi bir sey donerse (savunma) bos listeye duser, firlatmaz', async () => {
        const fetchHistory = vi.fn(async () => null)
        const r = await loadSolanaHistory({ activeAccount: { solanaAddress: ME }, fetchHistory })

        expect(r).toEqual({ transactions: [], error: null, address: ME })
    })

    // Adres HARF KASASI KORUNARAK dolasir: kucultulen bir base58 adres zehirli
    // adres tespitinde BASKA bir adres olur.
    it('adres hicbir asamada kucultulmez', async () => {
        const mixedCase = ME
        const sendMessage = vi.fn(async () => ({ result: { address: mixedCase } }))
        const fetchHistory = vi.fn(async () => [])
        const r = await loadSolanaHistory({ activeAccount: {}, sendMessage, fetchHistory })

        expect(r.address).toBe(mixedCase)
        expect(r.address).not.toBe(mixedCase.toLowerCase())
        expect(fetchHistory).toHaveBeenCalledWith(mixedCase)
    })

    it('OTHER adresi de oldugu gibi gecer (sabit degeri kanit olarak)', async () => {
        const fetchHistory = vi.fn(async () => [])
        await loadSolanaHistory({ activeAccount: { solanaAddress: OTHER }, fetchHistory })
        expect(fetchHistory).toHaveBeenCalledWith(OTHER)
    })

    // KOD INCELEMESI (review round 1, Bulgu 3): `.filter(Boolean)` sadece null
    // (transferi olmayan) satirlari dusurur. Bu test, o davranisi `status`e
    // GORE eleme yapacak sekilde MUTASYONA UGRATILIRSA (orn. `.filter(r =>
    // Boolean(r) && r.status !== 'failed')`) KIRMIZIYA duser -- basarisiz
    // islem de gecmiste GORUNMELI, ucret odenmistir ve kullanici gonderiminin
    // neden gerceklesmedigini bilmelidir (bkz. Task 14 brief, historyRow.test.js).
    it('fetchHistory basarisiz (status: failed) bir satir donerse SONUCTA KALIR, dusurulmez', async () => {
        const raw = [{ signature: 'FAILED_TX' }]
        const fetchHistory = vi.fn(async () => raw)
        const toRow = vi.fn(() => ({ hash: 'FAILED_TX', status: 'failed', direction: 'out' }))

        const r = await loadSolanaHistory({ activeAccount: { solanaAddress: ME }, fetchHistory, toRow })

        expect(r.transactions).toHaveLength(1)
        expect(r.transactions[0]).toMatchObject({ hash: 'FAILED_TX', status: 'failed' })
    })
})

describe('pendingSolanaTxToRow', () => {
    // background.js SOLANA_SEND handler'inin yazdigi TAM kayit sekli (bkz.
    // background.js: hash/chainId/from_address/to_address/value/asset/
    // receipt_status/block_timestamp).
    const pendingNative = {
        hash: 'PENDING_SIG', chainId: SOLANA_CHAIN_ID,
        from_address: ME, to_address: OTHER,
        value: '2.5', asset: 'native', receipt_status: 'pending',
        block_timestamp: '2026-01-01T00:00:00.000Z',
    }

    it('native SOL gonderimi SOL sembolu ve pending durumuyla satira cevrilir', () => {
        const row = pendingSolanaTxToRow(pendingNative)
        expect(row).toEqual({
            hash: 'PENDING_SIG', direction: 'out', counterparty: OTHER,
            amount: 2.5, symbol: 'SOL', mint: null,
            timestamp: Date.parse('2026-01-01T00:00:00.000Z'), status: 'pending',
        })
    })

    it('SPL gonderimi (asset bir mint adresi) mint ile satira cevrilir, symbol null kalir', () => {
        const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
        const row = pendingSolanaTxToRow({ ...pendingNative, asset: mint })
        expect(row.symbol).toBe(null)
        expect(row.mint).toBe(mint)
    })

    it('yon HER ZAMAN out doner (yerel kayit HER ZAMAN kendi gonderimimizdir)', () => {
        expect(pendingSolanaTxToRow(pendingNative).direction).toBe('out')
    })

    // review round 2, Bulgu B: status artik SABIT 'pending' DEGIL, kaydin
    // KENDI receipt_status'undan TURETILIR -- background.js bu alani '0'
    // (basarisiz) / '1' (basarili) olarak GUNCELLEYIP AYNI kilit icinde
    // budasa da, iki adim arada bir heartbeat turuna dusebilir; sabit
    // 'pending' o pencerede basarisiz bir gonderiyi SONSUZA DEK "Bekliyor..."
    // gosterirdi.
    it('receipt_status "pending" ya da taninmiyorsa status pending doner', () => {
        expect(pendingSolanaTxToRow(pendingNative).status).toBe('pending')
        expect(pendingSolanaTxToRow({ ...pendingNative, receipt_status: undefined }).status).toBe('pending')
    })

    it('receipt_status "0" ise status failed doner (cozulmus ama HENUZ budanmamis kayit)', () => {
        expect(pendingSolanaTxToRow({ ...pendingNative, receipt_status: '0' }).status).toBe('failed')
    })

    it('receipt_status "1" ise status success doner', () => {
        expect(pendingSolanaTxToRow({ ...pendingNative, receipt_status: '1' }).status).toBe('success')
    })

    // Adres HARF KASASI KORUNARAK dolasir.
    it('karsi taraf adresi (to_address) kucultulmez', () => {
        expect(pendingSolanaTxToRow(pendingNative).counterparty).toBe(OTHER)
        expect(pendingSolanaTxToRow(pendingNative).counterparty).not.toBe(OTHER.toLowerCase())
    })
})

describe('loadSolanaHistory — yerel bekleyen Solana islemleri (Bulgu 2)', () => {
    // KOK NEDEN: History.vue'nun Solana dali fetchSolanaTxHistory'i cagirdiktan
    // hemen sonra `return`e giriyordu; background.js'in yazdigi
    // `pending_transactions` kaydina HIC bakmiyordu. Kullanici 5 SOL gonderir,
    // Helius henuz indekslemeden Gecmis'i acar, "Islem bulunamadi" gorur,
    // gonderiminin basarisiz oldugunu sanip TEKRAR gonderir -- cift gonderim.
    const pendingMine = {
        hash: 'SIG_PENDING', chainId: SOLANA_CHAIN_ID,
        from_address: ME, to_address: OTHER,
        value: '5', asset: 'native', receipt_status: 'pending',
        block_timestamp: '2026-01-01T00:00:00.000Z',
    }

    it('Helius henuz hicbir sey dondurmese bile yerel bekleyen islem SONUCA girer', async () => {
        const fetchHistory = vi.fn(async () => [])
        const r = await loadSolanaHistory({
            activeAccount: { solanaAddress: ME },
            pendingTransactions: [pendingMine],
            fetchHistory,
        })

        expect(r.transactions).toHaveLength(1)
        expect(r.transactions[0]).toMatchObject({ hash: 'SIG_PENDING', status: 'pending', direction: 'out' })
    })

    // Bu, review'in tam olarak isaret ettigi senaryo: /solana/history hata
    // verirken de yerel kayit KAYBOLMAMALI.
    it('fetchHistory FIRLATSA bile yerel bekleyen islem transactions icinde doner (error: "fetch" ile birlikte)', async () => {
        const fetchHistory = vi.fn(async () => { throw new Error('SOLANA_HISTORY_TIMEOUT') })
        const r = await loadSolanaHistory({
            activeAccount: { solanaAddress: ME },
            pendingTransactions: [pendingMine],
            fetchHistory,
        })

        expect(r.error).toBe('fetch')
        expect(r.transactions).toHaveLength(1)
        expect(r.transactions[0].hash).toBe('SIG_PENDING')
    })

    it('Helius ayni imzayi ARTIK dondurusudurse yerel kopya DUSURULUR (cift satir gosterilmez)', async () => {
        const fetchHistory = vi.fn(async () => [{ signature: 'SIG_PENDING' }])
        const toRow = vi.fn(() => ({ hash: 'SIG_PENDING', status: 'success', direction: 'out', counterparty: OTHER, amount: 5, symbol: 'SOL', mint: null, timestamp: 1 }))

        const r = await loadSolanaHistory({
            activeAccount: { solanaAddress: ME },
            pendingTransactions: [pendingMine],
            fetchHistory,
            toRow,
        })

        expect(r.transactions).toHaveLength(1)
        expect(r.transactions[0].status).toBe('success')
    })

    it('BASKA bir hesabin (from_address farkli) bekleyen kaydi katilmaz', async () => {
        const fetchHistory = vi.fn(async () => [])
        const r = await loadSolanaHistory({
            activeAccount: { solanaAddress: ME },
            pendingTransactions: [{ ...pendingMine, from_address: OTHER }],
            fetchHistory,
        })
        expect(r.transactions).toHaveLength(0)
    })

    it('EVM bekleyen kaydi (chainId farkli/yok) katilmaz', async () => {
        const fetchHistory = vi.fn(async () => [])
        const r = await loadSolanaHistory({
            activeAccount: { solanaAddress: ME },
            pendingTransactions: [{ ...pendingMine, chainId: 1 }],
            fetchHistory,
        })
        expect(r.transactions).toHaveLength(0)
    })

    it('adres KUCULTULEREK karsilastirilmaz (from_address ile solanaAddress case-sensitive eslesir)', async () => {
        const fetchHistory = vi.fn(async () => [])
        const r = await loadSolanaHistory({
            activeAccount: { solanaAddress: ME },
            pendingTransactions: [{ ...pendingMine, from_address: ME.toLowerCase() }],
            fetchHistory,
        })
        // ME zaten karisik/buyuk harf iceriyor; kucultulmus hali ESLESMEMELI.
        expect(r.transactions).toHaveLength(0)
    })
})

// KOK NEDEN (review round 1, Bulgu 5): mint->sembol cozulmezse Gecmis'te
// "EPjFWd...Dt1v" gibi bir mint kisaltmasi sembol yerine gecerdi -- oysa AYNI
// cuzdan Home'da (useSolanaAssets) AYNI token icin "USDC" gosteriyordu.
describe('loadSolanaHistory — SPL satirlari mint->sembol ile zenginlestirilir (Bulgu 5)', () => {
    const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

    it('Helius satiri symbol: null donduruyorsa fetchMetadata ile doldurulur', async () => {
        const fetchHistory = vi.fn(async () => [{ signature: 'S1' }])
        const toRow = vi.fn(() => ({ hash: 'S1', direction: 'out', counterparty: OTHER, amount: 25.5, symbol: null, mint: MINT, timestamp: 1, status: 'success' }))
        const fetchMetadata = vi.fn(async (mints) => {
            expect(mints).toEqual([MINT])
            return new Map([[MINT, { mint: MINT, symbol: 'USDC' }]])
        })

        const r = await loadSolanaHistory({ activeAccount: { solanaAddress: ME }, fetchHistory, toRow, fetchMetadata })

        expect(r.transactions[0].symbol).toBe('USDC')
        // mint alani KORUNUR -- yalniz symbol doldurulur.
        expect(r.transactions[0].mint).toBe(MINT)
    })

    it('yerel bekleyen SPL kaydi da (fetchHistory basarili yolunda) zenginlestirilir', async () => {
        const pendingSpl = {
            hash: 'SIG_SPL_PENDING', chainId: SOLANA_CHAIN_ID,
            from_address: ME, to_address: OTHER,
            value: '10', asset: MINT, receipt_status: 'pending',
            block_timestamp: '2026-01-01T00:00:00.000Z',
        }
        const fetchHistory = vi.fn(async () => [])
        const fetchMetadata = vi.fn(async () => new Map([[MINT, { mint: MINT, symbol: 'USDC' }]]))

        const r = await loadSolanaHistory({
            activeAccount: { solanaAddress: ME },
            pendingTransactions: [pendingSpl],
            fetchHistory,
            fetchMetadata,
        })

        expect(r.transactions[0]).toMatchObject({ symbol: 'USDC', mint: MINT, status: 'pending' })
    })

    it('sembolu ZATEN bilinen (SOL) satirlar icin fetchMetadata cagrilmaz', async () => {
        const fetchHistory = vi.fn(async () => [{ signature: 'S1' }])
        const toRow = vi.fn(() => ({ hash: 'S1', direction: 'out', counterparty: OTHER, amount: 1, symbol: 'SOL', mint: null, timestamp: 1, status: 'success' }))
        const fetchMetadata = vi.fn()

        await loadSolanaHistory({ activeAccount: { solanaAddress: ME }, fetchHistory, toRow, fetchMetadata })

        expect(fetchMetadata).not.toHaveBeenCalled()
    })

    // Metadata YARDIMCIDIR: bir cikma (fetchTokenMetadata KENDI ICINDE hata
    // yutar, bkz. tokenMetadata.js) gecmis LISTESINI ASLA bosaltmamali --
    // satir sembolsuz (symbol: null) ama VAR olmaya devam eder; gorunum
    // katmani (solanaSymbolLabel) mint kisaltmasina duser.
    it('fetchMetadata bos harita donerse (metadata bulunamadi/cikti) satir KAYBOLMAZ, symbol null kalir', async () => {
        const fetchHistory = vi.fn(async () => [{ signature: 'S1' }])
        const toRow = vi.fn(() => ({ hash: 'S1', direction: 'out', counterparty: OTHER, amount: 25.5, symbol: null, mint: MINT, timestamp: 1, status: 'success' }))
        const fetchMetadata = vi.fn(async () => new Map())

        const r = await loadSolanaHistory({ activeAccount: { solanaAddress: ME }, fetchHistory, toRow, fetchMetadata })

        expect(r.transactions).toHaveLength(1)
        expect(r.transactions[0].symbol).toBe(null)
        expect(r.transactions[0].mint).toBe(MINT)
    })

    it('mint yoksa (native SOL) fetchMetadata hic cagrilmaz', async () => {
        const fetchHistory = vi.fn(async () => [{ signature: 'S1' }])
        const toRow = vi.fn(() => ({ hash: 'S1', direction: 'out', counterparty: OTHER, amount: 1, symbol: 'SOL', mint: null, timestamp: 1, status: 'success' }))
        const fetchMetadata = vi.fn(async () => new Map())

        await loadSolanaHistory({ activeAccount: { solanaAddress: ME }, fetchHistory, toRow, fetchMetadata })
        expect(fetchMetadata).not.toHaveBeenCalled()
    })

    it('ayni mint BIRDEN FAZLA satirda gecse bile fetchMetadata TEK SEFER, TEKRARSIZ mint listesiyle cagrilir', async () => {
        const fetchHistory = vi.fn(async () => [{ signature: 'S1' }, { signature: 'S2' }])
        let call = 0
        const toRow = vi.fn(() => {
            call += 1
            return { hash: `S${call}`, direction: 'out', counterparty: OTHER, amount: 1, symbol: null, mint: MINT, timestamp: 1, status: 'success' }
        })
        const fetchMetadata = vi.fn(async () => new Map([[MINT, { mint: MINT, symbol: 'USDC' }]]))

        const r = await loadSolanaHistory({ activeAccount: { solanaAddress: ME }, fetchHistory, toRow, fetchMetadata })

        expect(fetchMetadata).toHaveBeenCalledTimes(1)
        expect(fetchMetadata).toHaveBeenCalledWith([MINT])
        expect(r.transactions.every((t) => t.symbol === 'USDC')).toBe(true)
    })
})

// review round 2, Bulgu C: fetchTokenMetadata (varsayilan) hicbir zaman
// firlatmaz, ama enjekte edilen bir fetchMetadata firlatirsa loadSolanaHistory
// KENDISI de firlamamali -- aksi halde Bulgu 2'nin korumaya calistigi yerel
// bekleyen satir, sunucu hatasi YOLUNDA bile BOSALIRDI.
describe('loadSolanaHistory — fetchMetadata FIRLARSA yerel bekleyen satir yine de doner (Bulgu C)', () => {
    const MINT_C = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    // asset BILEREK bir mint (native DEGIL): enrichWithTokenSymbols yalniz
    // mint dolu + symbol null satirlar icin fetchMetadata'yi CAGIRIR (bkz.
    // enrichWithTokenSymbols'un erken-donus filtresi) -- native SOL satiri bu
    // cagriyi HIC TETIKLEMEZ ve mutasyonu YAKALAMAZ, bu yuzden SPL kullanilir.
    const pendingSpl = {
        hash: 'SIG_C', chainId: SOLANA_CHAIN_ID,
        from_address: ME, to_address: OTHER,
        value: '3', asset: MINT_C, receipt_status: 'pending',
        block_timestamp: '2026-01-01T00:00:00.000Z',
    }

    it('fetchHistory de FIRLARSA ve fetchMetadata de FIRLARSA loadSolanaHistory CoKMEZ, yerel satir doner', async () => {
        const fetchHistory = vi.fn(async () => { throw new Error('SOLANA_HISTORY_TIMEOUT') })
        const fetchMetadata = vi.fn(async () => { throw new Error('metadata ucu da coktu') })

        const r = await loadSolanaHistory({
            activeAccount: { solanaAddress: ME },
            pendingTransactions: [pendingSpl],
            fetchHistory,
            fetchMetadata,
        })

        expect(fetchMetadata).toHaveBeenCalled()
        expect(r.error).toBe('fetch')
        expect(r.transactions).toHaveLength(1)
        expect(r.transactions[0].hash).toBe('SIG_C')
        // Zenginlestirme cikince symbol null KALIR (mint kisaltmasi fallback'i
        // gorunum katmaninda devreye girer) -- satir yine de KAYBOLMAZ.
        expect(r.transactions[0].symbol).toBe(null)
    })
})
