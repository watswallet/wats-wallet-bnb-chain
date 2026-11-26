// Token hesabi baglami: talimatta yalniz token HESABI adresi vardir; mint,
// sahip ve decimals zincirden okunur. Fail-open: hicbir yol firlatmaz.
import './bufferGlobal.js'
import { describe, it, expect, vi } from 'vitest'
import { Keypair, Transaction, SystemProgram } from '@solana/web3.js'
import {
    createTransferInstruction, createTransferCheckedInstruction, createApproveInstruction,
    createAssociatedTokenAccountInstruction, createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction,
    createInitializeAccountInstruction, createInitializeAccount2Instruction, createInitializeAccount3Instruction,
    createCloseAccountInstruction, NATIVE_MINT,
} from '@solana/spl-token'
import { parseDappTransaction } from './parseDappTransaction'
import { decodeInstructions } from './decodeInstructions'
import { loadTokenAccountContext } from './tokenAccountContext'

const BLOCKHASH = '11111111111111111111111111111111'
const b64 = (bytes) => Buffer.from(bytes).toString('base64')
const key = () => Keypair.generate().publicKey

function decodedOf(instructions, payer) {
    const tx = new Transaction()
    tx.recentBlockhash = BLOCKHASH
    tx.feePayer = payer
    for (const ix of instructions) tx.add(ix)
    const parsed = parseDappTransaction(b64(tx.serialize({ requireAllSignatures: false, verifySignatures: false })))
    return decodeInstructions(parsed, { user: payer.toBase58() })
}

const tokenAcc = (mint, owner, decimals) => ({
    owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    data: {
        program: 'spl-token',
        space: 165,
        parsed: { type: 'account', info: { mint: mint.toBase58(), owner: owner.toBase58(), tokenAmount: { amount: '5', decimals, uiAmountString: '5' } } },
    },
})
const mintAcc = (decimals) => ({
    owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    data: { program: 'spl-token', space: 82, parsed: { type: 'mint', info: { decimals, supply: '1' } } },
})

describe('loadTokenAccountContext', () => {
    const user = key()
    const src = key()
    const dst = key()
    const mint = key()
    const dstOwner = key()

    it('duz Transfer icin kaynak mint/decimals ve hedef sahibi cozulur', async () => {
        const decoded = decodedOf([createTransferInstruction(src, dst, user, 7n)], user)
        const rpc = vi.fn().mockResolvedValue({
            value: [tokenAcc(mint, user, 6), tokenAcc(mint, dstOwner, 6)],
        })
        const signal = new AbortController().signal

        const ctx = await loadTokenAccountContext({ decoded, rpc, signal })

        expect(rpc).toHaveBeenCalledTimes(1)
        const [method, params, opts] = rpc.mock.calls[0]
        expect(method).toBe('getMultipleAccounts')
        expect(params[0]).toEqual([src.toBase58(), dst.toBase58()])
        expect(params[1]).toEqual({ encoding: 'jsonParsed' })
        expect(opts.signal).toBe(signal) // Gorev 37 iptal sinyali baglanir
        expect(ctx.get(src.toBase58())).toEqual({ mint: mint.toBase58(), owner: user.toBase58(), decimals: 6 })
        expect(ctx.get(dst.toBase58())).toEqual({ mint: mint.toBase58(), owner: dstOwner.toBase58(), decimals: 6 })
    })

    it('TransferChecked yalniz HEDEF hesabi sorar (mint ve decimals talimattadir)', async () => {
        const decoded = decodedOf([createTransferCheckedInstruction(src, mint, dst, user, 7n, 6)], user)
        const rpc = vi.fn().mockResolvedValue({ value: [tokenAcc(mint, dstOwner, 6)] })
        const ctx = await loadTokenAccountContext({ decoded, rpc })
        expect(rpc.mock.calls[0][1][0]).toEqual([dst.toBase58()])
        expect(ctx.get(dst.toBase58()).owner).toBe(dstOwner.toBase58())
    })

    it('mint hesabi icin decimals okunur (MintTo)', async () => {
        const decoded = decodedOf([createMintToInstruction(mint, dst, user, 3n)], user)
        const rpc = vi.fn().mockResolvedValue({ value: [mintAcc(9)] })
        const ctx = await loadTokenAccountContext({ decoded, rpc })
        expect(ctx.get(mint.toBase58())).toEqual({ mint: mint.toBase58(), owner: null, decimals: 9 })
    })

    it('harita eksikse (hesap yok / null) ilgili alanlar mint:null olarak kalir', async () => {
        const decoded = decodedOf([createTransferInstruction(src, dst, user, 7n)], user)
        const rpc = vi.fn().mockResolvedValue({ value: [null, tokenAcc(mint, dstOwner, 6)] })
        const ctx = await loadTokenAccountContext({ decoded, rpc })
        expect(ctx.has(src.toBase58())).toBe(false)
        expect(ctx.get(src.toBase58())?.mint ?? null).toBeNull()
        expect(ctx.get(dst.toBase58()).owner).toBe(dstOwner.toBase58())
    })

    it('rpc reject (403/zaman asimi/iptal) FIRLATMAZ ve bos harita doner', async () => {
        const decoded = decodedOf([createTransferInstruction(src, dst, user, 7n)], user)
        for (const err of [new Error('SOLANA_RPC_HTTP_403'), new Error('SOLANA_RPC_TIMEOUT'), new Error('SOLANA_RPC_ABORTED')]) {
            const rpc = vi.fn().mockRejectedValue(err)
            const ctx = await loadTokenAccountContext({ decoded, rpc })
            expect(ctx).toBeInstanceOf(Map)
            expect(ctx.size).toBe(0)
        }
    })

    it('bicimsiz yanit (dizi degil / uzunluk uyusmuyor / yanlis program) harita UYDURMAZ', async () => {
        const decoded = decodedOf([createTransferInstruction(src, dst, user, 7n)], user)
        const bozuklar = [
            undefined,
            { value: 'x' },
            { value: [tokenAcc(mint, user, 6)] }, // 2 istendi, 1 geldi: hiza bozulur
            { value: [{ data: { program: 'baska', parsed: { type: 'account', info: {} } } }, null] },
            { value: [{ data: { program: 'spl-token', parsed: { type: 'account', info: { mint: 'bu-adres-degil', owner: 5, tokenAmount: { decimals: 999 } } } } }, null] },
        ]
        for (const yanit of bozuklar) {
            const ctx = await loadTokenAccountContext({ decoded, rpc: vi.fn().mockResolvedValue(yanit) })
            expect(ctx.get(src.toBase58())?.mint ?? null).toBeNull()
            expect(ctx.get(src.toBase58())?.owner ?? null).toBeNull()
            expect(ctx.get(src.toBase58())?.decimals ?? null).toBeNull()
        }
    })

    it('islem ici ATA-create talimati yerel haritaya girer ve zincirden SORULMAZ', async () => {
        const owner = key()
        const ata = key()
        const decoded = decodedOf([
            createAssociatedTokenAccountInstruction(user, ata, owner, mint),
            createTransferInstruction(src, ata, user, 7n),
        ], user)
        const rpc = vi.fn().mockResolvedValue({ value: [tokenAcc(mint, user, 6)] })
        const ctx = await loadTokenAccountContext({ decoded, rpc })
        expect(rpc.mock.calls[0][1][0]).toEqual([src.toBase58()]) // ATA yok
        expect(ctx.get(ata.toBase58())).toEqual({ mint: mint.toBase58(), owner: owner.toBase58(), decimals: null })
    })

    it('RPC cokse bile yerel ATA haritasi korunur', async () => {
        const owner = key()
        const ata = key()
        const decoded = decodedOf([
            createAssociatedTokenAccountInstruction(user, ata, owner, mint),
            createTransferInstruction(src, ata, user, 7n),
        ], user)
        const ctx = await loadTokenAccountContext({ decoded, rpc: vi.fn().mockRejectedValue(new Error('x')) })
        expect(ctx.get(ata.toBase58()).owner).toBe(owner.toBase58())
        expect(ctx.has(src.toBase58())).toBe(false)
    })

    it('sorgulanacak hesap yoksa (SOL transferi) RPC HIC cagrilmaz', async () => {
        const decoded = decodedOf([SystemProgram.transfer({ fromPubkey: user, toPubkey: dst, lamports: 1 })], user)
        const rpc = vi.fn()
        const ctx = await loadTokenAccountContext({ decoded, rpc })
        expect(rpc).not.toHaveBeenCalled()
        expect(ctx.size).toBe(0)
    })

    it('en cok 100 adres sorulur (sunucu siniri) ve tekrarlar tekillestirilir', async () => {
        // Gercek bir islem 100+ hesap tasiyamaz; sinir saf decoded girdisiyle sinanir.
        const decoded = []
        for (let i = 0; i < 150; i += 1) {
            decoded.push({ program: 'token', type: 'Approve', accounts: [key().toBase58(), key().toBase58(), user.toBase58()], fields: {} })
        }
        decoded.push({ program: 'token', type: 'Approve', accounts: [decoded[0].accounts[0], null, user.toBase58()], fields: {} }) // tekrar
        const rpc = vi.fn().mockResolvedValue({ value: [] })
        await loadTokenAccountContext({ decoded, rpc })
        const sorulan = rpc.mock.calls[0][1][0]
        expect(sorulan).toHaveLength(100)
        expect(new Set(sorulan).size).toBe(100)
    })

    it('decoded dizi degilse bos harita (firlatmaz)', async () => {
        const ctx = await loadTokenAccountContext({ decoded: undefined, rpc: vi.fn() })
        expect(ctx.size).toBe(0)
    })

    it('islem ici InitializeAccount/2/3 (hesap -> {mint, owner}) yerel haritaya girer; zincirden SORULMAZ ve RPC cokse de korunur', async () => {
        const h1 = key()
        const h2 = key()
        const h3 = key()
        const sahip = key()
        const decoded = decodedOf([
            createInitializeAccountInstruction(h1, mint, sahip),
            createInitializeAccount2Instruction(h2, mint, sahip),
            createInitializeAccount3Instruction(h3, mint, sahip),
            createTransferInstruction(src, h1, user, 1n),
        ], user)
        const rpc = vi.fn().mockRejectedValue(new Error('403'))
        const ctx = await loadTokenAccountContext({ decoded, rpc })
        for (const h of [h1, h2, h3]) {
            expect(ctx.get(h.toBase58())).toEqual({ mint: mint.toBase58(), owner: sahip.toBase58(), decimals: null })
        }
        expect(rpc.mock.calls[0][1][0]).toEqual([src.toBase58()])
    })

    // dapp-imza-guvenlik-1 (ACILISI ENGELLER): ayni hesap adresi birden cok kez yaratilirsa ILK kayit
    // korunuyordu; saldirgan hesabi kapatip baska sahiple yeniden yaratinca ekran "To: You" derdi.
    describe('ayni hesap birden cok kez yaratilirsa (dapp-imza-guvenlik-1)', () => {
        const saldirgan = key()
        const BELIRSIZ = { mint: null, owner: null, decimals: null }

        it('InitializeAccount3: ayni hesap FARKLI sahiple ikinci kez gelirse kayit belirsiz olur (ilk kayit korunmaz)', async () => {
            const hesap = key()
            const decoded = decodedOf([
                createInitializeAccount3Instruction(hesap, mint, user),
                createInitializeAccount3Instruction(hesap, mint, saldirgan),
            ], user)
            const ctx = await loadTokenAccountContext({ decoded, rpc: vi.fn() })
            expect(ctx.get(hesap.toBase58())).toEqual(BELIRSIZ)
        })

        it('ATA CreateIdempotent: ayni ATA FARKLI sahiple ikinci kez gelirse kayit belirsiz olur', async () => {
            const ata = key()
            const decoded = decodedOf([
                createAssociatedTokenAccountIdempotentInstruction(user, ata, user, mint),
                createAssociatedTokenAccountIdempotentInstruction(user, ata, saldirgan, mint),
            ], user)
            const ctx = await loadTokenAccountContext({ decoded, rpc: vi.fn() })
            expect(ctx.get(ata.toBase58())).toEqual(BELIRSIZ)
        })

        it('ayni sahip ama FARKLI mint ile ikinci kez gelirse de belirsiz', async () => {
            const hesap = key()
            const decoded = decodedOf([
                createInitializeAccount3Instruction(hesap, mint, user),
                createInitializeAccount3Instruction(hesap, key(), user),
            ], user)
            const ctx = await loadTokenAccountContext({ decoded, rpc: vi.fn() })
            expect(ctx.get(hesap.toBase58())).toEqual(BELIRSIZ)
        })

        it('belirsiz kayit KALICIDIR: sonraki talimat ilk degerlere geri dondurmez', async () => {
            const hesap = key()
            const decoded = decodedOf([
                createInitializeAccount3Instruction(hesap, mint, user),
                createInitializeAccount3Instruction(hesap, mint, saldirgan),
                createInitializeAccount3Instruction(hesap, mint, user),
            ], user)
            const ctx = await loadTokenAccountContext({ decoded, rpc: vi.fn() })
            expect(ctx.get(hesap.toBase58())).toEqual(BELIRSIZ)
        })

        it('IDEMPOTENT (ayni mint + ayni sahip tekrar) davranisi DEGISMEZ: kayit cozulmus kalir', async () => {
            const hesap = key()
            const ata = key()
            const decoded = decodedOf([
                createInitializeAccount3Instruction(hesap, mint, user),
                createInitializeAccount3Instruction(hesap, mint, user),
                createAssociatedTokenAccountIdempotentInstruction(user, ata, user, mint),
                createAssociatedTokenAccountInstruction(user, ata, user, mint),
            ], user)
            const ctx = await loadTokenAccountContext({ decoded, rpc: vi.fn() })
            expect(ctx.get(hesap.toBase58())).toEqual({ mint: mint.toBase58(), owner: user.toBase58(), decimals: null })
            expect(ctx.get(ata.toBase58())).toEqual({ mint: mint.toBase58(), owner: user.toBase58(), decimals: null })
        })

        it('CloseAccount(hesap) SONRASI ayni hesap yaratilirsa (sahip/mint ayni olsa da) kayit belirsiz', async () => {
            const hesap = key()
            const decoded = decodedOf([
                createCloseAccountInstruction(hesap, user, user),
                createInitializeAccount3Instruction(hesap, mint, user),
            ], user)
            const ctx = await loadTokenAccountContext({ decoded, rpc: vi.fn().mockResolvedValue({ value: [] }) })
            expect(ctx.get(hesap.toBase58())).toEqual(BELIRSIZ)
        })

        it('ATA CreateIdempotent da CloseAccount SONRASI belirsiz sayilir', async () => {
            const ata = key()
            const decoded = decodedOf([
                createCloseAccountInstruction(ata, user, user),
                createAssociatedTokenAccountIdempotentInstruction(user, ata, user, mint),
            ], user)
            const ctx = await loadTokenAccountContext({ decoded, rpc: vi.fn().mockResolvedValue({ value: [] }) })
            expect(ctx.get(ata.toBase58())).toEqual(BELIRSIZ)
        })

        it('Create SONRA Close (yaratip kapatma): kayit belirsiz OLMAZ (yalniz Close SONRASI yaratma belirsiz)', async () => {
            const hesap = key()
            const decoded = decodedOf([
                createInitializeAccount3Instruction(hesap, mint, user),
                createCloseAccountInstruction(hesap, user, user),
            ], user)
            const ctx = await loadTokenAccountContext({ decoded, rpc: vi.fn().mockResolvedValue({ value: [] }) })
            expect(ctx.get(hesap.toBase58())).toEqual({ mint: mint.toBase58(), owner: user.toBase58(), decimals: null })
        })

        it('baska hesabin Close u bu hesabi etkilemez', async () => {
            const hesap = key()
            const decoded = decodedOf([
                createCloseAccountInstruction(key(), user, user),
                createInitializeAccount3Instruction(hesap, mint, user),
            ], user)
            const ctx = await loadTokenAccountContext({ decoded, rpc: vi.fn().mockResolvedValue({ value: [] }) })
            expect(ctx.get(hesap.toBase58())).toEqual({ mint: mint.toBase58(), owner: user.toBase58(), decimals: null })
        })
    })
})

// S9-G9-S2: CloseAccount'ta kapatilan hesabin lamports'u hedefe giden SOL tutaridir.
describe('loadTokenAccountContext -- CloseAccount (S9-G9-S2)', () => {
    const user = key()
    const kapatilan = key()
    const hedef = key()
    const wsolHesap = (lamports, { isNative = true } = {}) => ({
        lamports,
        owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        data: {
            program: 'spl-token',
            space: 165,
            parsed: {
                type: 'account',
                info: {
                    isNative,
                    mint: isNative ? NATIVE_MINT.toBase58() : key().toBase58(),
                    owner: user.toBase58(),
                    state: 'initialized',
                    tokenAmount: { amount: '0', decimals: 9, uiAmountString: '0' },
                },
            },
        },
    })

    it('kapatilan hesap (accounts[0]) getMultipleAccounts(jsonParsed) ile sorulur; lamports + isNative okunur', async () => {
        const decoded = decodedOf([createCloseAccountInstruction(kapatilan, hedef, user)], user)
        const rpc = vi.fn().mockResolvedValue({ value: [wsolHesap(50_002_039_280)] })
        const ctx = await loadTokenAccountContext({ decoded, rpc })
        expect(rpc).toHaveBeenCalledTimes(1)
        expect(rpc.mock.calls[0][0]).toBe('getMultipleAccounts')
        expect(rpc.mock.calls[0][1][0]).toEqual([kapatilan.toBase58()])
        expect(rpc.mock.calls[0][1][1]).toEqual({ encoding: 'jsonParsed' })
        expect(ctx.get(kapatilan.toBase58()).lamports).toBe('50002039280')
        expect(ctx.get(kapatilan.toBase58()).isNative).toBe(true)
    })

    it('native olmayan hesapta isNative YOK, lamports var', async () => {
        const decoded = decodedOf([createCloseAccountInstruction(kapatilan, hedef, user)], user)
        const rpc = vi.fn().mockResolvedValue({ value: [wsolHesap(2_039_280, { isNative: false })] })
        const ctx = await loadTokenAccountContext({ decoded, rpc })
        expect(ctx.get(kapatilan.toBase58()).lamports).toBe('2039280')
        expect(ctx.get(kapatilan.toBase58()).isNative).toBeUndefined()
    })

    it('lamports okunamazsa (2^53 ustu sayi, dizge olmayan, eksik) alan YOK: uydurma tutar uretilmez', async () => {
        for (const bozuk of [2 ** 60, -5, 1.5, null, undefined, {}]) {
            const decoded = decodedOf([createCloseAccountInstruction(kapatilan, hedef, user)], user)
            const rpc = vi.fn().mockResolvedValue({ value: [wsolHesap(bozuk)] })
            const ctx = await loadTokenAccountContext({ decoded, rpc })
            expect(ctx.get(kapatilan.toBase58())?.lamports, String(bozuk)).toBeUndefined()
        }
    })

    it('RPC reddederse firlatmaz, kapatilan hesap haritada YOK', async () => {
        const decoded = decodedOf([createCloseAccountInstruction(kapatilan, hedef, user)], user)
        const rpc = vi.fn().mockRejectedValue(new Error('403'))
        const ctx = await loadTokenAccountContext({ decoded, rpc })
        expect(ctx.has(kapatilan.toBase58())).toBe(false)
    })
})
