import { describe, it, expect, vi, afterEach } from 'vitest'
import { parseMintDecimalsResponse, buildSolanaImportRecord, resolveMintForImport, isValidImportInputFormat } from './importToken'

// USDC mint (gercek, gecerli base58/32 bayt) -- diger Solana testlerinde de kullanilan sabit.
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

describe('parseMintDecimalsResponse', () => {
    it('gecerli bir mint hesabindan ondaligi cikarir', () => {
        const result = { value: { data: { parsed: { type: 'mint', info: { decimals: 6 } } } } }
        expect(parseMintDecimalsResponse(result)).toBe(6)
    })

    it('hesap YOKSA (value null) null doner', () => {
        expect(parseMintDecimalsResponse({ value: null })).toBe(null)
    })

    it('mint TIPINDE degilse (orn. bir cuzdan hesabi) null doner', () => {
        const result = { value: { data: { parsed: { type: 'account', info: { decimals: 6 } } } } }
        expect(parseMintDecimalsResponse(result)).toBe(null)
    })

    it('parsed alani yoksa (base64/raw veri) null doner', () => {
        expect(parseMintDecimalsResponse({ value: { data: ['base64data', 'base64'] } })).toBe(null)
    })

    it('decimals tam sayi degilse null doner', () => {
        const result = { value: { data: { parsed: { type: 'mint', info: { decimals: '6' } } } } }
        expect(parseMintDecimalsResponse(result)).toBe(null)
    })

    it('bicimsiz/bos girdi null doner, ATMAZ', () => {
        expect(parseMintDecimalsResponse(null)).toBe(null)
        expect(parseMintDecimalsResponse(undefined)).toBe(null)
        expect(parseMintDecimalsResponse({})).toBe(null)
    })
})

describe('buildSolanaImportRecord', () => {
    it('gecersiz mint ADRESI (bicimsiz) reddedilir', () => {
        const result = buildSolanaImportRecord({ mint: 'not-base58!!' })
        expect(result.ok).toBe(false)
        expect(result.reason).toBe('INVALID_MINT')
    })

    it('EVM adresi de gecersiz mint sayilir', () => {
        const result = buildSolanaImportRecord({ mint: '0x098B716B8Aaf21512996dC57EB0615e2383E2f96' })
        expect(result.ok).toBe(false)
        expect(result.reason).toBe('INVALID_MINT')
    })

    it('metadata BULUNDUYSA dogru sekilli, DOGRU ondalikli kayit doner', () => {
        const metadata = { mint: MINT, symbol: 'usdc', name: 'USD Coin', decimals: 6, logoURI: 'https://logo', coingecko_id: 'usd-coin' }
        const result = buildSolanaImportRecord({ mint: MINT, metadata })

        expect(result.ok).toBe(true)
        expect(result.known).toBe(true)
        expect(result.token).toEqual({
            name: 'USD Coin',
            symbol: 'usdc',
            decimals: 6,
            address: MINT,
            image: { thumb: 'https://logo', small: 'https://logo', large: 'https://logo' },
            coingecko_id: 'usd-coin',
        })
    })

    it('metadata logoURI TASIMIYORSA image bos yapida kalir (fabrike edilmez)', () => {
        const metadata = { mint: MINT, symbol: 'usdc', name: 'USD Coin', decimals: 6, logoURI: null, coingecko_id: 'usd-coin' }
        const result = buildSolanaImportRecord({ mint: MINT, metadata })
        expect(result.token.image).toEqual({ thumb: '', small: '', large: '' })
    })

    // BULGU 1 (Task 16a) ile AYNI ilke: coingecko_id yoksa fiyat grafigi bu alana
    // bakip gizlenir -- burada da fabrike bir id UYDURULMAZ.
    it('metadata coingecko_id TASIMIYORSA null kalir (uydurulmaz)', () => {
        const metadata = { mint: MINT, symbol: 'usdc', name: 'USD Coin', decimals: 6, logoURI: null, coingecko_id: null }
        const result = buildSolanaImportRecord({ mint: MINT, metadata })
        expect(result.token.coingecko_id).toBe(null)
    })

    it('metadata YOK ama mint ondaligi zincirden GELDI: dogru ondalikla, HONEST kisaltilmis etiketle eklenir', () => {
        const result = buildSolanaImportRecord({ mint: MINT, metadata: null, mintDecimals: 5 })

        expect(result.ok).toBe(true)
        expect(result.known).toBe(false)
        expect(result.token.decimals).toBe(5)
        expect(result.token.symbol).toBe('EPjF...Dt1v')
        expect(result.token.name).toBe('EPjF...Dt1v')
        expect(result.token.coingecko_id).toBe(null)
        expect(result.token.address).toBe(MINT)
    })

    it('ne metadata NE DE ondalik varsa ICE AKTARMA REDDEDILIR (Send ondalik olmadan tahmin edemez)', () => {
        const result = buildSolanaImportRecord({ mint: MINT, metadata: null, mintDecimals: null })
        expect(result.ok).toBe(false)
        expect(result.reason).toBe('MINT_NOT_FOUND')
    })

    it('harf kasasi BIREBIR korunur (kucultulmez)', () => {
        const result = buildSolanaImportRecord({ mint: MINT, metadata: null, mintDecimals: 6 })
        expect(result.token.address).toBe(MINT)
        expect(result.token.address).not.toBe(MINT.toLowerCase())
    })

    // KOD INCELEMESI (Task 16b review, F2): metadata.decimals BOZUKSA (yok, null,
    // dizge...) sunucunun (ucuncu taraf token listesi) alanina KORULEMEZ
    // guvenilmez -- ondalik zincirden okunana (mintDecimals) DUSER, ama
    // sembol/isim/logo/coingecko_id metadata'dan KORUNUR.
    it('metadata decimals TASIMIYORSA (alan hic yok) zincirden okunan ondalige duser', () => {
        const metadata = { mint: MINT, symbol: 'FOO', name: 'Foo' } // decimals alani YOK
        const result = buildSolanaImportRecord({ mint: MINT, metadata, mintDecimals: 9 })

        expect(result.ok).toBe(true)
        expect(result.known).toBe(true)
        expect(result.token.decimals).toBe(9)
        expect(result.token.symbol).toBe('FOO')
    })

    it('metadata decimals NULL ise zincirden okunan ondalige duser', () => {
        const metadata = { mint: MINT, symbol: 'FOO', name: 'Foo', decimals: null }
        const result = buildSolanaImportRecord({ mint: MINT, metadata, mintDecimals: 9 })

        expect(result.token.decimals).toBe(9)
    })

    it('metadata decimals DIZGE ise ("6") zincirden okunan ondalige duser', () => {
        const metadata = { mint: MINT, symbol: 'FOO', name: 'Foo', decimals: '6' }
        const result = buildSolanaImportRecord({ mint: MINT, metadata, mintDecimals: 9 })

        expect(result.token.decimals).toBe(9)
        expect(result.token.decimals).not.toBe('6')
    })

    // Metadata'nin ondaligi BOZUK VE zincirden de okunamadiysa (mintDecimals
    // null) -- sembol/isim GUVENILIR olsa bile ondaliksiz bir kayit
    // OLUSTURULAMAZ, reddedilir.
    it('metadata decimals BOZUK ve mintDecimals de yoksa REDDEDILIR', () => {
        const metadata = { mint: MINT, symbol: 'FOO', name: 'Foo', decimals: null }
        const result = buildSolanaImportRecord({ mint: MINT, metadata, mintDecimals: null })

        expect(result.ok).toBe(false)
        expect(result.reason).toBe('MINT_NOT_FOUND')
    })
})

describe('isValidImportInputFormat (Task 16b review, F5)', () => {
    const EVM_ADDR = '0x098B716B8Aaf21512996dC57EB0615e2383E2f96'

    it('EVM: gecerli bir EVM adresi kabul edilir', () => {
        expect(isValidImportInputFormat('evm', EVM_ADDR)).toBe(true)
    })

    // Bu test, iki dalin (EVM/Solana) birbirine KARISTIRILMASINI (orn. EVM
    // dalina yanlislikla isValidSolanaAddress yazilmasini) YAKALAR: gecerli bir
    // EVM adresi ASLA gecerli bir base58 mint DEGILDIR ('0x' onekindeki '0'
    // base58 alfabesinde yoktur).
    it('EVM: bir Solana mint i EVM formati olarak KABUL EDILMEZ', () => {
        expect(isValidImportInputFormat('evm', MINT)).toBe(false)
    })

    it('Solana: gecerli bir mint kabul edilir', () => {
        expect(isValidImportInputFormat('solana', MINT)).toBe(true)
    })

    it('Solana: bir EVM adresi Solana formati olarak KABUL EDILMEZ', () => {
        expect(isValidImportInputFormat('solana', EVM_ADDR)).toBe(false)
    })

    it('bicimsiz girdi hicbir vm de kabul edilmez', () => {
        expect(isValidImportInputFormat('evm', 'not-an-address')).toBe(false)
        expect(isValidImportInputFormat('solana', 'not-an-address')).toBe(false)
    })
})

vi.mock('./tokenMetadata', () => ({ fetchTokenMetadata: vi.fn() }))
vi.mock('./client', () => ({ solanaRpc: vi.fn() }))

import { fetchTokenMetadata } from './tokenMetadata'
import { solanaRpc } from './client'

describe('resolveMintForImport (orkestrasyon)', () => {
    afterEach(() => {
        vi.resetAllMocks()
    })

    it('metadata BULUNURSA getAccountInfo HIC CAGRILMAZ', async () => {
        fetchTokenMetadata.mockResolvedValue(new Map([[MINT, { mint: MINT, symbol: 'usdc', name: 'USD Coin', decimals: 6, logoURI: null, coingecko_id: 'usd-coin' }]]))

        const result = await resolveMintForImport(MINT)

        expect(result.ok).toBe(true)
        expect(result.known).toBe(true)
        expect(result.token.decimals).toBe(6)
        expect(solanaRpc).not.toHaveBeenCalled()
    })

    // KOD INCELEMESI (Task 16b review, F2): reproduksiyon -- sunucu decimals
    // alanini HIC gondermeyebilir. Onceden bu, {ok:true, known:true} ile
    // decimals'siz bir kayit uretiyordu ("Dogrulandi" rozetiyle ama Send'de
    // zincirde genel bir hatayla dusen bir token). Artik getAccountInfo YINE
    // cagrilir, sembol/isim metadata'dan KORUNUR.
    it('metadata BULUNDU ama decimals YOKSA getAccountInfo YINE cagrilir', async () => {
        fetchTokenMetadata.mockResolvedValue(new Map([[MINT, { mint: MINT, symbol: 'FOO', name: 'Foo' }]]))
        solanaRpc.mockResolvedValue({ value: { data: { parsed: { type: 'mint', info: { decimals: 9 } } } } })

        const result = await resolveMintForImport(MINT)

        expect(result.ok).toBe(true)
        expect(result.known).toBe(true)
        expect(result.token.decimals).toBe(9)
        expect(result.token.symbol).toBe('FOO')
        expect(solanaRpc).toHaveBeenCalledWith('getAccountInfo', [MINT, { encoding: 'jsonParsed' }])
    })

    it('metadata decimals DIZGE ise ("6") getAccountInfo YINE cagrilir', async () => {
        fetchTokenMetadata.mockResolvedValue(new Map([[MINT, { mint: MINT, symbol: 'FOO', name: 'Foo', decimals: '6' }]]))
        solanaRpc.mockResolvedValue({ value: { data: { parsed: { type: 'mint', info: { decimals: 9 } } } } })

        const result = await resolveMintForImport(MINT)

        expect(result.token.decimals).toBe(9)
    })

    it('metadata BULUNAMAZSA getAccountInfo ile ondalik okunur', async () => {
        fetchTokenMetadata.mockResolvedValue(new Map())
        solanaRpc.mockResolvedValue({ value: { data: { parsed: { type: 'mint', info: { decimals: 8 } } } } })

        const result = await resolveMintForImport(MINT)

        expect(result.ok).toBe(true)
        expect(result.known).toBe(false)
        expect(result.token.decimals).toBe(8)
        expect(solanaRpc).toHaveBeenCalledWith('getAccountInfo', [MINT, { encoding: 'jsonParsed' }])
    })

    it('getAccountInfo de basarisiz olursa (ag hatasi) ICE AKTARMA REDDEDILIR, ATILMAZ', async () => {
        fetchTokenMetadata.mockResolvedValue(new Map())
        solanaRpc.mockRejectedValue(new Error('SOLANA_RPC_TIMEOUT'))

        const result = await resolveMintForImport(MINT)

        expect(result.ok).toBe(false)
        expect(result.reason).toBe('MINT_NOT_FOUND')
    })

    it('mint hesabi GERCEKTEN yoksa (value null) da REDDEDILIR', async () => {
        fetchTokenMetadata.mockResolvedValue(new Map())
        solanaRpc.mockResolvedValue({ value: null })

        const result = await resolveMintForImport(MINT)

        expect(result.ok).toBe(false)
        expect(result.reason).toBe('MINT_NOT_FOUND')
    })

    it('bicimsiz mint ile ag HIC CAGRILMAZ', async () => {
        const result = await resolveMintForImport('not-base58!!')

        expect(result.ok).toBe(false)
        expect(result.reason).toBe('INVALID_MINT')
        expect(fetchTokenMetadata).not.toHaveBeenCalled()
        expect(solanaRpc).not.toHaveBeenCalled()
    })
})
