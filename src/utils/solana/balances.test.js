import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { parseSolBalance, parseTokenAccounts, fetchSolanaAssets, fetchSolanaAssetsDetailed } from './balances'
import { SOL_NATIVE_MARKER } from './constants'

afterEach(() => { vi.unstubAllGlobals() })

// GERCEK adresler: ATA turetmesi gercek base58 mint/owner ister, uydurma
// ('MintA') dizeler cozulemez. Fixture'in ATA'si de GERCEKTEN turetilir --
// elle yazilmis bir sabit, uretim koduyla ayni hatayi paylasabilirdi.
const OWNER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const MINT_A = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'   // USDC
const MINT_B = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'   // BONK
const MINT_C = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'   // USDT
const MINT_D = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'    // mSOL

const ataOf = (mint, owner = OWNER) =>
    getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner)).toBase58()

// ATA'da duran hesap (normal durum).
const tokenAccount = (mint, amountRaw, decimals, owner = OWNER) => ({
    pubkey: ataOf(mint, owner),
    account: { data: { parsed: { info: {
        mint,
        tokenAmount: { amount: amountRaw, decimals, uiAmountString: null }
    } } } }
})

// ATA OLMAYAN (elle acilmis) ikinci hesap: adresi ATA'ya esit DEGIL.
const auxTokenAccount = (mint, amountRaw, decimals) => ({
    pubkey: 'AuxAcct1111111111111111111111111111111111111',
    account: { data: { parsed: { info: {
        mint,
        tokenAmount: { amount: amountRaw, decimals, uiAmountString: null }
    } } } }
})

describe('parseSolBalance', () => {
    it('lamports u SOL a cevirir', () => {
        expect(parseSolBalance(1_000_000_000)).toBe(1)
        expect(parseSolBalance(1_500_000_000)).toBe(1.5)
        expect(parseSolBalance(0)).toBe(0)
    })

    it('gecersiz girdi 0', () => {
        expect(parseSolBalance(null)).toBe(0)
        expect(parseSolBalance(undefined)).toBe(0)
        expect(parseSolBalance('abc')).toBe(0)
    })
})

describe('parseTokenAccounts', () => {
    it('mint, miktar ve ondalik cikarir', () => {
        const rows = parseTokenAccounts({ value: [tokenAccount(MINT_A, '2500000', 6)] }, OWNER)
        expect(rows).toEqual([{ mint: MINT_A, amount: 2.5, decimals: 6 }])
    })

    // Kullanici bir tokenin tamamini gonderdiginde ATA acik kalir ama bakiyesi
    // sifirdir. Elenmezse liste zamanla olu satirlarla dolar.
    it('bakiyesi sifir olan hesaplar elenir', () => {
        const rows = parseTokenAccounts({ value: [
            tokenAccount(MINT_A, '0', 6),
            tokenAccount(MINT_B, '1', 0),
        ] }, OWNER)
        expect(rows).toEqual([{ mint: MINT_B, amount: 1, decimals: 0 }])
    })

    // --- HARCANABILIRLIK (nihai inceleme, Bulgu 4) ---
    //
    // Eskiden ayni mint'in TUM hesaplari TOPLANIYORDU, ama transferin kaynagi
    // KOSULSUZ ATA'dir (buildTransferPlan.js:201). ATA'da 10, elle acilmis bir
    // hesapta 90 varsa ekran 100 gosteriyor, Maks 100 oneriyor ve
    // gonderilebilecek tek rakam 10 oluyordu.
    it('ATA DISI hesap bakiyeye KATILMAZ -- gosterilen sayi gonderilebilir sayidir', () => {
        const rows = parseTokenAccounts({ value: [
            tokenAccount(MINT_A, '10000000', 6),      // ATA: 10
            auxTokenAccount(MINT_A, '90000000', 6),   // ATA disi: 90
        ] }, OWNER)
        expect(rows).toEqual([{ mint: MINT_A, amount: 10, decimals: 6 }])
    })

    it('YALNIZCA ATA disi hesapta duran mint listelenmez', () => {
        const rows = parseTokenAccounts({ value: [auxTokenAccount(MINT_A, '90000000', 6)] }, OWNER)
        expect(rows).toEqual([])
    })

    // Toplama ARITMETIK olarak da bozuktu: 0,1 + 0,2 = 0,30000000000000004 ve bu
    // deger toBaseUnits'te AMOUNT_EXCEEDS_PRECISION firlatiyordu -- cuzdan KENDI
    // urettigi sayi icin kullaniciyi 'en fazla 6 ondalik' diye sucluyordu.
    it('cuzdanin urettigi bakiye kayan nokta artigi TASIMAZ', () => {
        const rows = parseTokenAccounts({ value: [
            tokenAccount(MINT_A, '100000', 6),        // ATA: 0,1
            auxTokenAccount(MINT_A, '200000', 6),     // ATA disi: 0,2
        ] }, OWNER)
        expect(rows[0].amount).toBe(0.1)
        // Eski toplama 0.30000000000000004 uretiyordu.
        expect(String(rows[0].amount)).not.toMatch(/0000000000000/)
    })

    // BASKA bir sahibin ATA'si bu sahibin hesabi degildir.
    it('baska bir sahibin ATA si sayilmaz', () => {
        const other = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
        const rows = parseTokenAccounts({ value: [tokenAccount(MINT_A, '1000000', 6, other)] }, OWNER)
        expect(rows).toEqual([])
    })

    // Sahip cozulemezse ATA turetilemez; 'belki ATA'dir' varsayimi tam olarak
    // kaldirilan hatadir.
    it('sahip yok/gecersizse bos dizi', () => {
        const value = [tokenAccount(MINT_A, '1000000', 6)]
        expect(parseTokenAccounts({ value })).toEqual([])
        expect(parseTokenAccounts({ value }, '')).toEqual([])
        expect(parseTokenAccounts({ value }, 'gecersiz-adres!!')).toEqual([])
    })

    it('bicimsiz yanit bos dizi', () => {
        expect(parseTokenAccounts(null, OWNER)).toEqual([])
        expect(parseTokenAccounts({}, OWNER)).toEqual([])
        expect(parseTokenAccounts({ value: 'x' }, OWNER)).toEqual([])
        expect(parseTokenAccounts({ value: [{}] }, OWNER)).toEqual([])
    })

    // 9 ondaligin ustunde Number kayan nokta hassasiyeti kaybeder; ham dize
    // uzerinden bolunur.
    //
    // toBe (yaklasik degil TAM esitlik): donusum TEK bir dizge->double parse'i
    // ile deterministiktir. Not: bu ozel girdide (18 ondalik) naive
    // `Number(raw)/Math.pow(10, decimals)` de AYNI sonucu verir -- yani bu testin
    // TEK BASINA regresyon yakalama gucu yok; onu asagidaki test saglar.
    it('yuksek ondalikli token dogru cevrilir', () => {
        const rows = parseTokenAccounts({ value: [tokenAccount(MINT_C, '123456789012345678', 18)] }, OWNER)
        expect(rows[0].amount).toBe(0.123456789012345678)
    })

    // AYIRT EDICI test: raw, Number.MAX_SAFE_INTEGER'i asiyor ve decimals
    // gercekci (6).
    //   naive : 9007199254.740992  (YANLIS)
    //   dogru : 9007199254.740993
    it('MAX_SAFE_INTEGER ustundeki ham deger naive yontemden AYRISIR', () => {
        const rows = parseTokenAccounts({ value: [tokenAccount(MINT_D, '9007199254740993', 6)] }, OWNER)
        expect(rows[0].amount).toBe(9007199254.740993)
    })
})
describe('fetchSolanaAssets', () => {
    it('SOL ve SPL satirlarini birlikte doner', async () => {
        const fetchMock = vi.fn(async (_url, options) => {
            const { method } = JSON.parse(options.body)
            if (method === 'getBalance') {
                return { ok: true, status: 200, json: async () => ({ result: { value: 2_000_000_000 } }) }
            }
            return { ok: true, status: 200, json: async () => ({
                result: { value: [tokenAccount(MINT_A, '1000000', 6)] }
            }) }
        })
        vi.stubGlobal('fetch', fetchMock)

        const assets = await fetchSolanaAssets(OWNER)

        expect(assets[0]).toEqual({ mint: SOL_NATIVE_MARKER, amount: 2, decimals: 9 })
        expect(assets[1]).toEqual({ mint: MINT_A, amount: 1, decimals: 6 })
    })

    it('adres yoksa ag cagrisi YAPILMAZ', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        await expect(fetchSolanaAssets(null)).resolves.toEqual([])
        expect(fetchMock).not.toHaveBeenCalled()
    })

    // SPL cagrisi duserse SOL bakiyesi yine de gosterilmeli: tek bir arizali
    // cagri yuzunden kullanicinin TUM bakiyesini gizlemek, parasi kaybolmus
    // gibi gorunmesine yol acar.
    it('SPL cagrisi duserse SOL yine doner', async () => {
        vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
            const { method } = JSON.parse(options.body)
            if (method === 'getBalance') {
                return { ok: true, status: 200, json: async () => ({ result: { value: 1_000_000_000 } }) }
            }
            return { ok: false, status: 502, json: async () => ({}) }
        }))

        const assets = await fetchSolanaAssets(OWNER)
        expect(assets).toEqual([{ mint: SOL_NATIVE_MARKER, amount: 1, decimals: 9 }])
    })
})

// E3 (Gorev 15): SPL/SOL okuma hatasi artik GORUNUR. Bos liste "bakiye yok" ile
// "okunamadi"yi ayirt edemez; Detailed iki hatayi ayri bayrakla bildirir.
describe('fetchSolanaAssetsDetailed', () => {
    beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
    afterEach(() => { vi.restoreAllMocks() })

    const okSol = (lamports) => ({ ok: true, status: 200, json: async () => ({ result: { value: lamports } }) })
    const okSpl = (...accounts) => ({ ok: true, status: 200, json: async () => ({ result: { value: accounts } }) })
    // Gercek sunucu sozlesmesi (Gorev 11): ust akis 401/403 -> 502 + JSON-RPC -32603.
    const upstreamRejected = () => ({
        ok: false, status: 502,
        json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: 'solana upstream rejected request' } })
    })
    const stubByMethod = (handlers) => vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
        const { method } = JSON.parse(options.body)
        return handlers[method]()
    }))

    it('basarida splFailed ve solFailed false', async () => {
        stubByMethod({
            getBalance: () => okSol(2_000_000_000),
            getTokenAccountsByOwner: () => okSpl(tokenAccount(MINT_A, '1000000', 6))
        })

        const r = await fetchSolanaAssetsDetailed(OWNER)

        expect(r.splFailed).toBe(false)
        expect(r.solFailed).toBe(false)
        expect(r.assets).toEqual([
            { mint: SOL_NATIVE_MARKER, amount: 2, decimals: 9 },
            { mint: MINT_A, amount: 1, decimals: 6 }
        ])
    })

    it('SPL reject -> SOL satiri kalir, splFailed true', async () => {
        stubByMethod({
            getBalance: () => okSol(1_000_000_000),
            getTokenAccountsByOwner: () => ({ ok: false, status: 502, json: async () => ({}) })
        })

        const r = await fetchSolanaAssetsDetailed(OWNER)

        expect(r).toEqual({
            assets: [{ mint: SOL_NATIVE_MARKER, amount: 1, decimals: 9 }],
            splFailed: true,
            solFailed: false
        })
    })

    // Sunucunun gercek 403 cevirisi: istemcide SOLANA_RPC_UPSTREAM_REJECTED olur.
    it('sunucunun 502 + -32603 (ust akis reddi) yaniti splFailed true yapar', async () => {
        stubByMethod({
            getBalance: () => okSol(1_000_000_000),
            getTokenAccountsByOwner: upstreamRejected
        })

        const r = await fetchSolanaAssetsDetailed(OWNER)

        expect(r.splFailed).toBe(true)
        expect(r.solFailed).toBe(false)
        expect(r.assets).toEqual([{ mint: SOL_NATIVE_MARKER, amount: 1, decimals: 9 }])
    })

    // JSON-RPC hatasi HTTP 200 ile de gelebilir.
    it('HTTP 200 govdesinde JSON-RPC hatasi da splFailed true yapar', async () => {
        stubByMethod({
            getBalance: () => okSol(1_000_000_000),
            getTokenAccountsByOwner: () => ({ ok: true, status: 200, json: async () => ({ error: { code: -32005, message: 'rate limited' } }) })
        })

        const r = await fetchSolanaAssetsDetailed(OWNER)
        expect(r.splFailed).toBe(true)
        expect(r.assets).toHaveLength(1)
    })

    it('SOL reject -> solFailed true, SPL satirlari kalir', async () => {
        stubByMethod({
            getBalance: upstreamRejected,
            getTokenAccountsByOwner: () => okSpl(tokenAccount(MINT_A, '1000000', 6))
        })

        const r = await fetchSolanaAssetsDetailed(OWNER)

        expect(r.solFailed).toBe(true)
        expect(r.splFailed).toBe(false)
        expect(r.assets).toEqual([{ mint: MINT_A, amount: 1, decimals: 6 }])
    })

    it('ikisi de duserse bos liste ve iki bayrak true', async () => {
        stubByMethod({ getBalance: upstreamRejected, getTokenAccountsByOwner: upstreamRejected })

        const r = await fetchSolanaAssetsDetailed(OWNER)

        expect(r).toEqual({ assets: [], splFailed: true, solFailed: true })
    })

    // "Hesap acik ama hic token yok" bir HATA degildir: bant cikmamali.
    it('SPL basarili ve bos ise splFailed false', async () => {
        stubByMethod({ getBalance: () => okSol(0), getTokenAccountsByOwner: () => okSpl() })

        const r = await fetchSolanaAssetsDetailed(OWNER)
        expect(r.splFailed).toBe(false)
    })

    it('adres yoksa ag cagrisi yok, bayraklar false', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        await expect(fetchSolanaAssetsDetailed(null)).resolves.toEqual({ assets: [], splFailed: false, solFailed: false })
        expect(fetchMock).not.toHaveBeenCalled()
    })
})

describe('fetchSolanaAssets — Detailed uzerinde ince sarmalayici', () => {
    beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
    afterEach(() => { vi.restoreAllMocks() })

    it('donus yalniz assets gibi davranir (toEqual/Object.keys bozulmaz)', async () => {
        vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
            const { method } = JSON.parse(options.body)
            if (method === 'getBalance') return { ok: true, status: 200, json: async () => ({ result: { value: 1_000_000_000 } }) }
            return { ok: false, status: 502, json: async () => ({}) }
        }))

        const assets = await fetchSolanaAssets(OWNER)

        expect(Array.isArray(assets)).toBe(true)
        expect(assets).toEqual([{ mint: SOL_NATIVE_MARKER, amount: 1, decimals: 9 }])
        expect(Object.keys(assets)).toEqual(['0'])
        // Hata bilgisi numaralandirilamaz ozellik olarak tasinir (useSolanaAssets okur).
        expect(assets.splFailed).toBe(true)
        expect(Object.keys(assets)).not.toContain('splFailed')
        expect(JSON.stringify(assets)).toBe('[{"mint":"native","amount":1,"decimals":9}]')
    })
})
