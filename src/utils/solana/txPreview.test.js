// txPreview: SAF katman. Onay ekraninin satirlari, adres kapisina girecek
// adresler ve kilit bayraklari (hasUnknown / hasRedFlag / hasDurableNonce).
import './bufferGlobal.js'
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
    Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, TransactionInstruction,
    VersionedTransaction, ComputeBudgetProgram,
} from '@solana/web3.js'
import {
    createTransferInstruction, createTransferCheckedInstruction, createApproveInstruction,
    createRevokeInstruction, createSetAuthorityInstruction, createCloseAccountInstruction,
    createAssociatedTokenAccountInstruction, createAssociatedTokenAccountIdempotentInstruction, AuthorityType, TOKEN_2022_PROGRAM_ID as SPL_TOKEN_2022_ID,
    createInitializeAccountInstruction, createInitializeAccount2Instruction, createInitializeAccount3Instruction,
    createSyncNativeInstruction, NATIVE_MINT,
} from '@solana/spl-token'
import { parseDappTransaction } from './parseDappTransaction'
import { decodeInstructions } from './decodeInstructions'
import { buildTxPreview, mintLabel } from './txPreview'
import { loadTokenAccountContext } from './tokenAccountContext'

const BLOCKHASH = '11111111111111111111111111111111'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const MEMO_V2 = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const b64 = (bytes) => Buffer.from(bytes).toString('base64')
const key = () => Keypair.generate().publicKey

function legacyParsed(instructions, payer) {
    const tx = new Transaction()
    tx.recentBlockhash = BLOCKHASH
    tx.feePayer = payer
    for (const ix of instructions) tx.add(ix)
    return parseDappTransaction(b64(tx.serialize({ requireAllSignatures: false, verifySignatures: false })))
}

// decodeInstructions ve buildTxPreview'a AYNI user verilir (ekran sozlesmesi).
function preview(instructions, { user, payer = user, tokenCtx, ...rest } = {}) {
    const parsed = legacyParsed(instructions, payer)
    const decoded = decodeInstructions(parsed, { user: user.toBase58() })
    return { decoded, parsed, out: buildTxPreview({ decoded, parsed, user: user.toBase58(), tokenCtx, ...rest }) }
}

const ctxOf = (entries) => new Map(entries.map(([k, v]) => [k.toBase58(), v]))
const info = (mint, owner, decimals = 6) => ({
    mint: mint.toBase58 ? mint.toBase58() : mint,
    owner: owner ? owner.toBase58() : null,
    decimals,
})

afterEach(() => vi.restoreAllMocks())

describe('buildTxPreview -- gateAddresses (D2 5.1 madde 17)', () => {
    const user = key()

    it('System Transfer hedefi (cuzdan) kapiya girer', () => {
        const w = key()
        const { out } = preview([SystemProgram.transfer({ fromPubkey: user, toPubkey: w, lamports: 5 })], { user })
        expect(out.gateAddresses).toEqual([w.toBase58()])
    })

    it('TransferWithSeed ve WithdrawNonceAccount hedefi kapiya girer', () => {
        const w1 = key()
        const w2 = key()
        const { out } = preview([
            SystemProgram.transfer({ fromPubkey: user, basePubkey: user, toPubkey: w1, lamports: 5, seed: 's', programId: SystemProgram.programId }),
            SystemProgram.nonceWithdraw({ noncePubkey: key(), authorizedPubkey: user, toPubkey: w2, lamports: 3 }),
        ], { user })
        expect(out.gateAddresses).toEqual([w1.toBase58(), w2.toBase58()])
    })

    it('SPL transfer hedef token hesabinin SAHIBI girer (token hesabi degil)', () => {
        const src = key()
        const dst = key()
        const mint = key()
        const owner = key()
        const tokenCtx = ctxOf([[src, info(mint, user)], [dst, info(mint, owner)]])
        const { out } = preview([createTransferInstruction(src, dst, user, 9n)], { user, tokenCtx })
        expect(out.gateAddresses).toEqual([owner.toBase58()])
        expect(out.gateAddresses).not.toContain(dst.toBase58())
    })

    it('Approve delegate, SetAuthority yenisi, CloseAccount hedefi girer; egri-disi delegate DE girer', () => {
        const delegate = key()
        const newAuth = key()
        const closeTo = key()
        const pdaDelegate = PublicKey.findProgramAddressSync([Buffer.from('spender')], key())[0]
        expect(PublicKey.isOnCurve(pdaDelegate.toBytes())).toBe(false)
        const { out } = preview([
            createApproveInstruction(key(), delegate, user, 5n),
            createSetAuthorityInstruction(key(), user, AuthorityType.AccountOwner, newAuth),
            createCloseAccountInstruction(key(), closeTo, user),
            createApproveInstruction(key(), pdaDelegate, user, 5n),
        ], { user })
        expect(out.gateAddresses).toEqual([delegate.toBase58(), newAuth.toBase58(), closeTo.toBase58(), pdaDelegate.toBase58()])
        expect(out.extraAddressCount).toBe(0)
    })

    it('kullanici, program kimligi, egri-disi hedef, Approve 0, Revoke, yetki kaldirma GIRMEZ', () => {
        const src = key()
        const dst = key()
        const mint = key()
        const pda = PublicKey.findProgramAddressSync([Buffer.from('vault')], key())[0]
        const pdaTokenOwner = PublicKey.findProgramAddressSync([Buffer.from('vault2')], key())[0]
        const tokenCtx = ctxOf([[src, info(mint, user)], [dst, { mint: mint.toBase58(), owner: pdaTokenOwner.toBase58(), decimals: 6 }]])
        const { out } = preview([
            SystemProgram.transfer({ fromPubkey: user, toPubkey: user, lamports: 1 }), // kullanicinin kendisi
            SystemProgram.transfer({ fromPubkey: user, toPubkey: new PublicKey(TOKEN_PROGRAM), lamports: 1 }), // program kimligi
            SystemProgram.transfer({ fromPubkey: user, toPubkey: pda, lamports: 1 }), // egri disi PDA
            createTransferInstruction(src, dst, user, 9n), // hedef sahibi egri disi
            createApproveInstruction(key(), key(), user, 0n), // izin sifirlama
            createRevokeInstruction(key(), user),
            createSetAuthorityInstruction(key(), user, AuthorityType.CloseAccount, null), // yetkiyi kaldirma
            createCloseAccountInstruction(key(), user, user), // kira kullaniciya
        ], { user, tokenCtx })
        expect(out.gateAddresses).toEqual([])
        expect(out.extraAddressCount).toBe(0)
    })

    it('tekrar eden adres TEK slot tutar', () => {
        const w = key()
        const { out } = preview([
            SystemProgram.transfer({ fromPubkey: user, toPubkey: w, lamports: 1 }),
            SystemProgram.transfer({ fromPubkey: user, toPubkey: w, lamports: 2 }),
            createApproveInstruction(key(), w, user, 5n),
        ], { user })
        expect(out.gateAddresses).toEqual([w.toBase58()])
    })

    it('5. benzersiz adres kapiya GIRMEZ ve extraAddressCount:1 uretir', () => {
        const ws = [key(), key(), key(), key(), key()]
        const { out } = preview(ws.map((w) => SystemProgram.transfer({ fromPubkey: user, toPubkey: w, lamports: 1 })), { user })
        expect(out.gateAddresses).toEqual(ws.slice(0, 4).map((w) => w.toBase58()))
        expect(out.extraAddressCount).toBe(1)
    })
})

describe('buildTxPreview -- hasUnknown / hasRedFlag', () => {
    const user = key()

    it('Jupiter benzeri (bilinmeyen program + wSOL CloseAccount kullaniciya) -> hasRedFlag:false, hasUnknown:true', () => {
        const { out } = preview([
            new TransactionInstruction({ programId: key(), keys: [{ pubkey: user, isSigner: true, isWritable: true }], data: Buffer.from([1, 2, 3]) }),
            createCloseAccountInstruction(key(), user, user),
        ], { user })
        expect(out.hasRedFlag).toBe(false)
        expect(out.hasUnknown).toBe(true)
        expect(out.rows.find((r) => r.kind === 'unknownProgram')).toBeTruthy()
    })

    it('Q12: Jupiter v6 program kimligi BILINEN sayilmaz (bilinmeyen kalir)', () => {
        const jup = new PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4')
        const { out } = preview([
            new TransactionInstruction({ programId: jup, keys: [], data: Buffer.from([1]) }),
        ], { user })
        expect(out.hasUnknown).toBe(true)
    })

    it('tam cozulen duz SOL transferi -> hasUnknown:false (ComputeBudget satir uretmez)', () => {
        const { out } = preview([
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5 }),
            SystemProgram.transfer({ fromPubkey: user, toPubkey: key(), lamports: 5 }),
        ], { user })
        expect(out.hasUnknown).toBe(false)
        expect(out.hasRedFlag).toBe(false)
        expect(out.rows).toHaveLength(1)
        expect(out.rows[0].kind).toBe('systemTransfer')
    })

    it('tam cozulen SPL TransferChecked (baglam dolu) -> hasUnknown:false', () => {
        const src = key()
        const dst = key()
        const mint = key()
        const tokenCtx = ctxOf([[dst, info(mint, key())]])
        const { out } = preview([createTransferCheckedInstruction(src, mint, dst, user, 5n, 6)], { user, tokenCtx })
        expect(out.hasUnknown).toBe(false)
    })

    it('tokenCtx bos/eksik -> alici cozulemedi -> hasUnknown:true; tokenCtx hic verilmezse de', () => {
        const src = key()
        const dst = key()
        const mint = key()
        const ix = () => [createTransferCheckedInstruction(src, mint, dst, user, 5n, 6)]
        expect(preview(ix(), { user, tokenCtx: new Map() }).out.hasUnknown).toBe(true)
        expect(preview(ix(), { user }).out.hasUnknown).toBe(true)
        // duz Transfer: mint de cozulemez
        expect(preview([createTransferInstruction(src, dst, user, 5n)], { user, tokenCtx: new Map() }).out.hasUnknown).toBe(true)
    })

    it('altUnresolved:true -> hasUnknown:true', () => {
        const { out } = preview([SystemProgram.transfer({ fromPubkey: user, toPubkey: key(), lamports: 5 })], { user, altUnresolved: true })
        expect(out.hasUnknown).toBe(true)
    })

    it('v0 islemde alici ALT indeksinden gelir ve cozulemedi (null) -> hasUnknown:true', () => {
        const payer = Keypair.generate()
        const message = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: BLOCKHASH,
            instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: key(), lamports: 1 })],
        }).compileToV0Message()
        const parsed = parseDappTransaction(b64(new VersionedTransaction(message).serialize()))
        // alici indeksini tablo araligina tasi (ag olmadan ALT'i taklit eden en kucuk kurgu)
        parsed.tx.message.compiledInstructions[0].accountKeyIndexes = [0, 99]
        const decoded = decodeInstructions(parsed, { user: payer.publicKey.toBase58() })
        expect(decoded[0].accounts[1]).toBeNull()

        const out = buildTxPreview({ decoded, parsed, user: payer.publicKey.toBase58(), tokenCtx: new Map() })
        expect(out.hasUnknown).toBe(true)
        expect(out.gateAddresses).toEqual([])
        expect(out.rows[0].fields.find((f) => f.labelKey.endsWith('f.to'))).toMatchObject({ value: null, unresolved: true })
    })

    it('tanimsiz token talimat indeksi -> hasUnknown:true ve satir cozulmus gibi UYDURULMAZ', () => {
        const { out } = preview([
            new TransactionInstruction({
                programId: new PublicKey(TOKEN_PROGRAM),
                keys: [{ pubkey: key(), isSigner: false, isWritable: true }],
                data: Buffer.from([19]),
            }),
        ], { user })
        expect(out.hasUnknown).toBe(true)
        expect(out.rows[0].kind).toBe('undecodable')
    })

    it('hasRedFlag decodeInstructions baglamli bayragindan gelir (sinirsiz Approve, baskasina CloseAccount)', () => {
        const unlimited = 18446744073709551615n
        expect(preview([createApproveInstruction(key(), key(), user, unlimited)], { user }).out.hasRedFlag).toBe(true)
        expect(preview([createCloseAccountInstruction(key(), key(), user)], { user }).out.hasRedFlag).toBe(true)
        expect(preview([createCloseAccountInstruction(key(), user, user)], { user }).out.hasRedFlag).toBe(false)
    })

    it('Approve satiri risk tasir ve sinirsizsa approveUnlimited basligini kullanir', () => {
        const { out } = preview([createApproveInstruction(key(), key(), user, 18446744073709551615n)], { user })
        const row = out.rows[0]
        expect(row.kind).toBe('approve')
        expect(row.risk).toBe(true)
        expect(row.unlimited).toBe(true)
        expect(row.titleKey).toBe('dapps.solana.ix.approveUnlimited')
    })
})

describe('buildTxPreview -- ucret, nonce, kira, Token-2022', () => {
    const user = key()

    it('ucret odeyen != kullanici -> feePayerIsUser:false; esitse true', () => {
        const attacker = Keypair.generate().publicKey
        const ix = () => [SystemProgram.transfer({ fromPubkey: user, toPubkey: key(), lamports: 1 })]
        const other = preview(ix(), { user, payer: attacker }).out
        expect(other.feePayer).toBe(attacker.toBase58())
        expect(other.feePayerIsUser).toBe(false)
        const own = preview(ix(), { user }).out
        expect(own.feePayer).toBe(user.toBase58())
        expect(own.feePayerIsUser).toBe(true)
    })

    it('AdvanceNonceAccount ilk talimat -> hasDurableNonce:true; ilk degilse false', () => {
        const advance = SystemProgram.nonceAdvance({ noncePubkey: key(), authorizedPubkey: user })
        const transfer = SystemProgram.transfer({ fromPubkey: user, toPubkey: key(), lamports: 1 })
        expect(preview([advance, transfer], { user }).out.hasDurableNonce).toBe(true)
        expect(preview([transfer, advance], { user }).out.hasDurableNonce).toBe(false)
        expect(preview([transfer], { user }).out.hasDurableNonce).toBe(false)
    })

    it('Token-2022 transferi token2022Nominal:true tasir; klasik Token tasimaz', () => {
        const src = key()
        const dst = key()
        const mint = key()
        const tokenCtx = ctxOf([[dst, info(mint, key())]])
        const t22 = preview([createTransferCheckedInstruction(src, mint, dst, user, 5n, 6, [], SPL_TOKEN_2022_ID)], { user, tokenCtx }).out
        expect(t22.rows[0].token2022Nominal).toBe(true)
        const classic = preview([createTransferCheckedInstruction(src, mint, dst, user, 5n, 6)], { user, tokenCtx }).out
        expect(classic.rows[0].token2022Nominal).toBeUndefined()
    })

    it('rentLamports: kullanicinin odedigi CreateAccount toplanir (BigInt), baskasinin odedigi sayilmaz', () => {
        const payerOther = key()
        const { out } = preview([
            SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: key(), lamports: 2039280, space: 165, programId: new PublicKey(TOKEN_PROGRAM) }),
            SystemProgram.createAccount({ fromPubkey: payerOther, newAccountPubkey: key(), lamports: 777, space: 0, programId: SystemProgram.programId }),
        ], { user })
        expect(out.rentLamports).toBe(2039280n)
        expect(typeof out.rentLamports).toBe('bigint')
    })

    it('Memo satiri dapp metnini tasir ama hasUnknown/hasRedFlag etkilemez', () => {
        const { out } = preview([
            new TransactionInstruction({ programId: new PublicKey(MEMO_V2), keys: [], data: Buffer.from('merhaba') }),
            SystemProgram.transfer({ fromPubkey: user, toPubkey: key(), lamports: 1 }),
        ], { user })
        const memo = out.rows.find((r) => r.kind === 'memo')
        expect(memo.fields[0]).toMatchObject({ kind: 'text', value: 'merhaba' })
        expect(memo.risk).toBe(false)
        expect(out.hasUnknown).toBe(false)
        expect(out.hasRedFlag).toBe(false)
    })

    it('ATA olusturma baska biri icinse ataForOther, kendiniz icinse ataCreate', () => {
        const mint = key()
        const other = key()
        const forOther = preview([createAssociatedTokenAccountInstruction(user, key(), other, mint)], { user }).out
        expect(forOther.rows[0].kind).toBe('ataForOther')
        const own = preview([createAssociatedTokenAccountInstruction(user, key(), user, mint)], { user }).out
        expect(own.rows[0].kind).toBe('ataCreate')
    })
})

describe('buildTxPreview -- tutar ve mint etiketi (P-K-2: yalniz kurasyonlu tablo)', () => {
    const user = key()

    it('kurasyonlu mint -> sembol ve verified:true; tutar ham birim dizesi + decimals', () => {
        const src = key()
        const dst = key()
        const tokenCtx = ctxOf([[dst, info(USDC, key())]])
        const { out } = preview([createTransferCheckedInstruction(src, new PublicKey(USDC), dst, user, 1500000n, 6)], { user, tokenCtx })
        const amount = out.rows[0].fields.find((f) => f.kind === 'amount')
        expect(amount).toMatchObject({ value: '1500000', decimals: 6, symbol: 'USDC', verified: true })
    })

    it('kurasyonlu OLMAYAN mint -> verified:false, symbol:null (rastgele mint)', () => {
        const src = key()
        const dst = key()
        const mint = key()
        const tokenCtx = ctxOf([[dst, info(mint, key())]])
        const { out } = preview([createTransferCheckedInstruction(src, mint, dst, user, 5n, 6)], { user, tokenCtx })
        const amount = out.rows[0].fields.find((f) => f.kind === 'amount')
        expect(amount).toMatchObject({ symbol: null, verified: false })
        // mint adresi TAM olarak satirda (kisaltma gosterim katmaninda)
        expect(out.rows[0].fields.find((f) => f.labelKey.endsWith('f.mint')).value).toBe(mint.toBase58())
    })

    it('mintLabel: kurasyonlu degilse { symbol:null, verified:false }; prototip adlari da', () => {
        expect(mintLabel(USDC)).toEqual({ symbol: 'USDC', verified: true })
        expect(mintLabel(Keypair.generate().publicKey.toBase58())).toEqual({ symbol: null, verified: false })
        expect(mintLabel('constructor')).toEqual({ symbol: null, verified: false })
        expect(mintLabel('__proto__')).toEqual({ symbol: null, verified: false })
        expect(mintLabel(undefined)).toEqual({ symbol: null, verified: false })
    })

    it('mintLabel hicbir ag/sunucu cagrisi YAPMAZ', () => {
        const fetchSpy = vi.fn()
        vi.stubGlobal('fetch', fetchSpy)
        mintLabel(Keypair.generate().publicKey.toBase58())
        mintLabel(USDC)
        const src = key()
        const dst = key()
        const mint = key()
        preview([createTransferCheckedInstruction(src, mint, dst, user, 5n, 6)], { user, tokenCtx: ctxOf([[dst, info(mint, key())]]) })
        expect(fetchSpy).not.toHaveBeenCalled()
        vi.unstubAllGlobals()
    })

    it("sembolu 'USDC' tasiyan ama kurasyonlu olmayan mint: enjekte etiketleyici dogrulanmamis sembolu BASAMAZ", () => {
        const src = key()
        const dst = key()
        const sahte = key()
        const tokenCtx = ctxOf([[dst, info(sahte, key())]])
        // Jupiter-dogrulanmis ucuncu taraf sembolu gibi davranan bir etiketleyici:
        const sizdiran = () => ({ symbol: 'USDC', verified: false })
        const { out } = preview([createTransferCheckedInstruction(src, sahte, dst, user, 5n, 6)], { user, tokenCtx, mintLabel: sizdiran })
        const amount = out.rows[0].fields.find((f) => f.kind === 'amount')
        expect(amount.symbol).toBeNull()
        expect(amount.verified).toBe(false)
        // varsayilan etiketleyici de ayni sonucu verir
        const dflt = preview([createTransferCheckedInstruction(src, sahte, dst, user, 5n, 6)], { user, tokenCtx }).out
        expect(dflt.rows[0].fields.find((f) => f.kind === 'amount')).toMatchObject({ symbol: null, verified: false })
    })

    it('duz Transfer: mint ve decimals kaynak token hesabindan gelir', () => {
        const src = key()
        const dst = key()
        const tokenCtx = ctxOf([[src, info(USDC, user, 6)], [dst, info(USDC, key(), 6)]])
        const { out } = preview([createTransferInstruction(src, dst, user, 2500000n)], { user, tokenCtx })
        expect(out.hasUnknown).toBe(false)
        expect(out.rows[0].fields.find((f) => f.kind === 'amount')).toMatchObject({ value: '2500000', decimals: 6, symbol: 'USDC', verified: true })
        // alici SAHIBI gosterilir, token hesabi ayri alanda tutulur
        const to = out.rows[0].fields.find((f) => f.labelKey.endsWith('f.to'))
        expect(to.value).toBe(tokenCtx.get(dst.toBase58()).owner)
        expect(to.tokenAccount).toBe(dst.toBase58())
    })

    it('SOL transferi tutari lamports dizesi + 9 decimals + SOL', () => {
        const { out } = preview([SystemProgram.transfer({ fromPubkey: user, toPubkey: key(), lamports: 123456789 })], { user })
        expect(out.rows[0].fields.find((f) => f.kind === 'amount')).toMatchObject({ value: '123456789', decimals: 9, symbol: 'SOL' })
    })

    it('kullanici baska hesabin transferini gostermek affectsUser:false ile', () => {
        const baska = key()
        const { out } = preview([SystemProgram.transfer({ fromPubkey: baska, toPubkey: key(), lamports: 1 })], { user })
        expect(out.rows[0].affectsUser).toBe(false)
        const own = preview([SystemProgram.transfer({ fromPubkey: user, toPubkey: key(), lamports: 1 })], { user }).out
        expect(own.rows[0].affectsUser).toBe(true)
    })
})

describe('buildTxPreview -- savunma', () => {
    it('decoded/parsed/tokenCtx eksikse FIRLATMAZ ve guvenli varsayilanlar doner', () => {
        const out = buildTxPreview({})
        expect(out).toMatchObject({
            rows: [], gateAddresses: [], extraAddressCount: 0, feePayer: null, feePayerIsUser: false,
            hasUnknown: false, hasRedFlag: false, hasDurableNonce: false, rentLamports: 0n,
        })
        expect(() => buildTxPreview()).not.toThrow()
    })

    it('user bilinmiyorsa feePayerIsUser false (fail-closed)', () => {
        const u = key()
        const parsed = legacyParsed([SystemProgram.transfer({ fromPubkey: u, toPubkey: key(), lamports: 1 })], u)
        const decoded = decodeInstructions(parsed, { user: u.toBase58() })
        expect(buildTxPreview({ decoded, parsed, user: null }).feePayerIsUser).toBe(false)
    })
})

// Tek adlandirilmis sabit: (space + 128) * 3480 * 2 lamport (Agave rent, 2 yil muafiyet).
const rentFloor = (space) => (BigInt(space) + 128n) * 6960n
const TOKEN_PID = new PublicKey(TOKEN_PROGRAM)
const labelOf = (row, name) => row.fields.find((f) => f.labelKey === `dapps.solana.f.${name}`)

describe('buildTxPreview -- InitializeAccount sahibi (S5-F1)', () => {
    const user = key()

    it('(a) CreateAccount(50 SOL) + InitializeAccount3(native mint, SALDIRGAN sahip): walletPrep OLMAZ, sahip tam adresle gorunur, kapiya girer, hasUnknown', () => {
        const saldirgan = key()
        const yeni = key()
        const { out } = preview([
            SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: yeni, lamports: 50_000_000_000, space: 165, programId: TOKEN_PID }),
            createInitializeAccount3Instruction(yeni, NATIVE_MINT, saldirgan),
        ], { user })
        expect(out.rows.map((r) => r.kind)).not.toContain('walletPrep')
        const init = out.rows.find((r) => r.kind === 'initializeAccount')
        expect(init).toBeTruthy()
        expect(labelOf(init, 'owner').value).toBe(saldirgan.toBase58())
        expect(labelOf(init, 'mint').value).toBe(NATIVE_MINT.toBase58())
        expect(out.gateAddresses).toContain(saldirgan.toBase58())
        expect(out.hasUnknown).toBe(true)
        expect(out.hasRedFlag).toBe(false)
    })

    it('(b) islem ici yaratilan hesabin sahibi baglamdan cozulur: transfer satirinda alici sahibi gorunur ve kapiya girer', async () => {
        const saldirgan = key()
        const yeni = key()
        const kaynak = key()
        const parsed = legacyParsed([
            SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: yeni, lamports: Number(rentFloor(165)), space: 165, programId: TOKEN_PID }),
            createInitializeAccount3Instruction(yeni, new PublicKey(USDC), saldirgan),
            createTransferInstruction(kaynak, yeni, user, 7n),
        ], user)
        const decoded = decodeInstructions(parsed, { user: user.toBase58() })
        const rpc = vi.fn(async (_m, [adresler]) => ({
            value: adresler.map((a) => (a === kaynak.toBase58()
                ? { owner: TOKEN_PROGRAM, data: { program: 'spl-token', space: 165, parsed: { type: 'account', info: { mint: USDC, owner: user.toBase58(), tokenAmount: { decimals: 6 } } } } }
                : null)),
        }))
        const tokenCtx = await loadTokenAccountContext({ decoded, rpc })
        expect(tokenCtx.get(yeni.toBase58())).toMatchObject({ mint: USDC, owner: saldirgan.toBase58() })
        // islem ici hesap zincirden SORULMAZ
        expect(rpc.mock.calls[0][1][0]).not.toContain(yeni.toBase58())
        const out = buildTxPreview({ decoded, parsed, user: user.toBase58(), tokenCtx })
        const tr = out.rows.find((r) => r.kind === 'tokenTransfer')
        expect(labelOf(tr, 'to').value).toBe(saldirgan.toBase58())
        expect(out.gateAddresses).toContain(saldirgan.toBase58())
        expect(out.hasUnknown).toBe(true)
    })

    it('mesru Jupiter wSOL akisi: CreateAccount(taban) + InitializeAccount3(native, KULLANICI) + SyncNative -> tek walletPrep, kilit/kapi yok', () => {
        const { out } = preview([
            SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: key(), lamports: Number(rentFloor(165)), space: 165, programId: TOKEN_PID }),
            createInitializeAccount3Instruction(key(), NATIVE_MINT, user),
            createSyncNativeInstruction(key()),
        ], { user })
        expect(out.rows.map((r) => r.kind)).toEqual(['createAccount', 'walletPrep'])
        expect(out.hasUnknown).toBe(false)
        expect(out.gateAddresses).toEqual([])
    })

    it('InitializeAccount, 2 ve 3 (native, kullanici) ayni sekilde tek walletPrep satirina katlanir', () => {
        const { out } = preview([
            createInitializeAccountInstruction(key(), NATIVE_MINT, user),
            createInitializeAccount2Instruction(key(), NATIVE_MINT, user),
            createInitializeAccount3Instruction(key(), NATIVE_MINT, user),
        ], { user })
        expect(out.rows.map((r) => r.kind)).toEqual(['walletPrep'])
        expect(out.hasUnknown).toBe(false)
    })

    it('native mint ama sahip BASKASI ise katlanmaz; her InitializeAccount* ayri satir ve kapiya girer', () => {
        const baska = key()
        const { out } = preview([
            createInitializeAccount3Instruction(key(), NATIVE_MINT, user),
            createInitializeAccount3Instruction(key(), NATIVE_MINT, baska),
            createInitializeAccount2Instruction(key(), NATIVE_MINT, baska),
        ], { user })
        expect(out.rows.map((r) => r.kind)).toEqual(['walletPrep', 'initializeAccount', 'initializeAccount'])
        expect(out.gateAddresses).toEqual([baska.toBase58()])
        expect(out.hasUnknown).toBe(true)
    })

    it('sahip kullanici ama mint native DEGIL: ayri satir (katlanmaz), sahip kullanici oldugu icin hasUnknown yok', () => {
        const { out } = preview([createInitializeAccount3Instruction(key(), new PublicKey(USDC), user)], { user })
        expect(out.rows.map((r) => r.kind)).toEqual(['initializeAccount'])
        expect(labelOf(out.rows[0], 'owner').value).toBe(user.toBase58())
        expect(out.hasUnknown).toBe(false)
        expect(out.gateAddresses).toEqual([])
    })

    it('user bilinmiyorsa (fail-closed) katlanmaz ve hasUnknown olur', () => {
        const parsed = legacyParsed([createInitializeAccount3Instruction(key(), NATIVE_MINT, user)], user)
        const decoded = decodeInstructions(parsed, { user: user.toBase58() })
        const out = buildTxPreview({ decoded, parsed, user: null })
        expect(out.rows.map((r) => r.kind)).toEqual(['initializeAccount'])
        expect(out.hasUnknown).toBe(true)
    })
})

describe('buildTxPreview -- CreateAccount kira tabani (S5-F2)', () => {
    const user = key()

    it('CreateAccount(user -> taze anahtar, 50 SOL, space 0, System): fon aktarimi = 50 SOL - taban, rentLamports = taban, alici kapida', () => {
        const taze = key()
        const { out } = preview([
            SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: taze, lamports: 50_000_000_000, space: 0, programId: SystemProgram.programId }),
        ], { user })
        const taban = rentFloor(0)
        const row = out.rows[0]
        expect(labelOf(row, 'rent')).toMatchObject({ value: taban.toString(), kind: 'amount' })
        expect(labelOf(row, 'fundTransfer')).toMatchObject({ value: (50_000_000_000n - taban).toString(), kind: 'amount' })
        expect(labelOf(row, 'to').value).toBe(taze.toBase58())
        expect(out.rentLamports).toBe(taban)
        expect(out.gateAddresses).toEqual([taze.toBase58()])
    })

    it('mesru CreateAccountWithSeed (space 165, lamports = taban): fon aktarimi YOK, kapi bos, hasUnknown yok', () => {
        const { out } = preview([
            SystemProgram.createAccountWithSeed({
                fromPubkey: user, newAccountPubkey: key(), basePubkey: user, seed: 'wsol',
                lamports: Number(rentFloor(165)), space: 165, programId: TOKEN_PID,
            }),
        ], { user })
        expect(labelOf(out.rows[0], 'fundTransfer')).toBeUndefined()
        expect(labelOf(out.rows[0], 'rent').value).toBe(rentFloor(165).toString())
        expect(out.rentLamports).toBe(rentFloor(165))
        expect(out.gateAddresses).toEqual([])
        expect(out.hasUnknown).toBe(false)
    })

    it('lamports tabandan KUCUKSE rentLamports = lamports (tabana yukseltilmez)', () => {
        const { out } = preview([
            SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: key(), lamports: 1000, space: 165, programId: TOKEN_PID }),
        ], { user })
        expect(out.rentLamports).toBe(1000n)
        expect(labelOf(out.rows[0], 'fundTransfer')).toBeUndefined()
    })

    it('yeni hesabin sahibi System/Token/Token-2022/ATA disindaysa hasUnknown; bunlar degilse hasUnknown yok', () => {
        const mk = (programId) => preview([
            SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: key(), lamports: Number(rentFloor(10)), space: 10, programId }),
        ], { user }).out
        expect(mk(key()).hasUnknown).toBe(true)
        expect(mk(SystemProgram.programId).hasUnknown).toBe(false)
        expect(mk(TOKEN_PID).hasUnknown).toBe(false)
        expect(mk(SPL_TOKEN_2022_ID).hasUnknown).toBe(false)
        expect(mk(new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')).hasUnknown).toBe(false)
    })

    it('fonlayan kullanici DEGILSE fon aktarimi/kapi/rent uretilmez', () => {
        const baska = key()
        const { out } = preview([
            SystemProgram.createAccount({ fromPubkey: baska, newAccountPubkey: key(), lamports: 50_000_000_000, space: 0, programId: SystemProgram.programId }),
        ], { user, payer: baska })
        expect(out.rentLamports).toBe(0n)
        expect(out.gateAddresses).toEqual([])
    })

    it('F5-1-1: space=700000/owner System, lamports = o space tabani -> tavan asildi: fon aktarimi > 0, kapi, hasUnknown, rent tavan tabaninda', () => {
        const taze = key()
        const buyuk = Number(rentFloor(700000))
        const { out } = preview([
            SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: taze, lamports: buyuk, space: 700000, programId: SystemProgram.programId }),
        ], { user })
        const row = out.rows[0]
        const tavanTaban = rentFloor(80)
        expect(labelOf(row, 'rent').value).toBe(tavanTaban.toString())
        expect(labelOf(row, 'fundTransfer').value).toBe((BigInt(buyuk) - tavanTaban).toString())
        expect(out.rentLamports).toBe(tavanTaban)
        expect(out.gateAddresses).toEqual([taze.toBase58()])
        expect(out.hasUnknown).toBe(true)
    })

    it('F5-1-1: space=700000 + Assign(saldirgan programi) zinciri artik temiz degil (kapi + hasUnknown)', () => {
        const taze = key()
        const buyuk = Number(rentFloor(700000))
        const { out } = preview([
            SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: taze, lamports: buyuk, space: 700000, programId: SystemProgram.programId }),
            SystemProgram.assign({ accountPubkey: taze, programId: key() }),
        ], { user })
        expect(out.gateAddresses).toContain(taze.toBase58())
        expect(out.hasUnknown || out.hasRedFlag).toBe(true)
    })

    it('F5-1-1: tavan sinirlari: System 80 (nonce) mesru, 81 asar; Token 2048 mesru, 2049 asar', () => {
        const mk = (space, programId) => preview([
            SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: key(), lamports: Number(rentFloor(space)), space, programId }),
        ], { user }).out
        const nonce = mk(80, SystemProgram.programId)
        expect(labelOf(nonce.rows[0], 'fundTransfer')).toBeUndefined()
        expect(nonce.hasUnknown).toBe(false)
        expect(mk(81, SystemProgram.programId).hasUnknown).toBe(true)
        const tok = mk(2048, TOKEN_PID)
        expect(labelOf(tok.rows[0], 'fundTransfer')).toBeUndefined()
        expect(tok.hasUnknown).toBe(false)
        const asan = mk(2049, TOKEN_PID)
        expect(asan.hasUnknown).toBe(true)
        expect(labelOf(asan.rows[0], 'fundTransfer').value).toBe((rentFloor(2049) - rentFloor(2048)).toString())
        expect(asan.gateAddresses.length).toBe(1)
    })

    it('fon aktarimi tutari BigInt ile hesaplanir (2^53 ustu lamports kesin; web3 kodlayicisi bigint almadigi icin veri elle)', () => {
        const lamports = 18_000_000_000_000_000_001n
        const data = Buffer.alloc(4 + 8 + 8 + 32)
        data.writeUInt32LE(0, 0)
        data.writeBigUInt64LE(lamports, 4)
        data.writeBigUInt64LE(0n, 12)
        SystemProgram.programId.toBuffer().copy(data, 20)
        const ix = new TransactionInstruction({
            programId: SystemProgram.programId,
            keys: [{ pubkey: user, isSigner: true, isWritable: true }, { pubkey: key(), isSigner: true, isWritable: true }],
            data,
        })
        const { out } = preview([ix], { user })
        expect(labelOf(out.rows[0], 'fundTransfer').value).toBe((lamports - rentFloor(0)).toString())
        expect(out.rentLamports).toBe(rentFloor(0))
    })
})

// S9-G9-S2: CloseAccount hedefe SOL'un TAMAMINI (kira + wSOL'de sarili bakiye) yollar.
// Hedef kullanici degilse satir tutari gosterir; tutar okunamazsa "tum SOL gidebilir".
describe('buildTxPreview -- CloseAccount tutari (S9-G9-S2)', () => {
    const user = key()
    const kapatilan = key()
    const saldirgan = key()
    const kapat = (hedef) => [createCloseAccountInstruction(kapatilan, hedef, user)]
    const tutarAlani = (out) => out.rows[0].fields.find((f) => f.kind === 'amount')
    const ctxLam = (lamports, extra = {}) => ctxOf([[kapatilan, { mint: NATIVE_MINT.toBase58(), owner: user.toBase58(), decimals: 9, lamports, ...extra }]])

    it('native (wSOL) hesap baskasina kapatilir: TUM SOL satiri, TAM hedef adresi, hasUnknown false', () => {
        const { out } = preview(kapat(saldirgan), { user, tokenCtx: ctxLam('50002039280', { isNative: true }) })
        const row = out.rows[0]
        expect(row.kind).toBe('closeAccount')
        expect(row.risk).toBe(true)
        const f = tutarAlani(out)
        expect(f.labelKey).toBe('dapps.solana.f.closeSolAll')
        expect(f.value).toBe('50002039280')
        expect(f.decimals).toBe(9)
        expect(f.symbol).toBe('SOL')
        expect(f.verified).toBe(true)
        expect(f.unresolved).toBeUndefined()
        expect(row.fields.find((x) => x.labelKey === 'dapps.solana.f.rentTo').value).toBe(saldirgan.toBase58())
        expect(out.hasUnknown).toBe(false)
        expect(out.hasRedFlag).toBe(true)
        expect(out.gateAddresses).toEqual([saldirgan.toBase58()])
    })

    it('native olmayan hesap: yalniz kira etiketi (closeSolRent) ve zincirden okunan tutar', () => {
        const { out } = preview(kapat(saldirgan), { user, tokenCtx: ctxLam('2039280') })
        const f = tutarAlani(out)
        expect(f.labelKey).toBe('dapps.solana.f.closeSolRent')
        expect(f.value).toBe('2039280')
        expect(out.hasUnknown).toBe(false)
    })

    it('tutar okunamadi (baglamda yok): closeSolUnknown, value null, unresolved, hasUnknown true, kirmizi KALIR', () => {
        for (const tokenCtx of [undefined, new Map(), ctxOf([[kapatilan, { mint: null, owner: null, decimals: null }]])]) {
            const { out } = preview(kapat(saldirgan), { user, tokenCtx })
            const f = tutarAlani(out)
            expect(f.labelKey).toBe('dapps.solana.f.closeSolUnknown')
            expect(f.value).toBeNull()
            expect(f.unresolved).toBe(true)
            expect(out.hasUnknown).toBe(true)
            expect(out.hasRedFlag).toBe(true)
            expect(out.rows[0].risk).toBe(true)
        }
    })

    it('hedef = kullanici (Jupiter wSOL kapatmasi): tutar alani YOK, kirmizi YOK, hasUnknown false', () => {
        const { out } = preview(kapat(user), { user, tokenCtx: ctxLam('50002039280', { isNative: true }) })
        expect(out.rows[0].fields.some((f) => f.kind === 'amount')).toBe(false)
        expect(out.rows[0].risk).toBe(false)
        expect(out.hasRedFlag).toBe(false)
        expect(out.hasUnknown).toBe(false)
    })

    it('kullanici bilinmiyorsa (user yok) fail-closed: tutar alani aranir, kirmizi', () => {
        const parsed = legacyParsed(kapat(saldirgan), user)
        const decoded = decodeInstructions(parsed, {})
        const out = buildTxPreview({ decoded, parsed, tokenCtx: ctxLam('7', { isNative: true }) })
        expect(out.hasRedFlag).toBe(true)
        expect(tutarAlani(out).labelKey).toBe('dapps.solana.f.closeSolAll')
    })
})

// dapp-imza-guvenlik-1 (ACILISI ENGELLER): ayni hesabi kapatip baska sahiple yeniden yaratan islem
// Transfer satirinda "To: You" gosterir, gercek alici saldirgandi. Zincir ustu gecerlilik OLCULMEDI;
// ekran fail-closed davranir: alici cozulemedi + hasUnknown.
describe('buildTxPreview -- ayni hesap kapat-yeniden-yarat (dapp-imza-guvenlik-1)', () => {
    const user = key()
    const saldirgan = key()
    const usdc = new PublicKey(USDC)
    const hedefSatiri = (out) => out.rows.find((r) => r.kind === 'tokenTransfer')

    async function onizle(instructions) {
        const parsed = legacyParsed(instructions, user)
        const decoded = decodeInstructions(parsed, { user: user.toBase58() })
        const tokenCtx = await loadTokenAccountContext({ decoded, rpc: vi.fn().mockResolvedValue({ value: [] }) })
        return buildTxPreview({ decoded, parsed, user: user.toBase58(), tokenCtx })
    }

    it('SALDIRI: Init3(A,kullanici) -> Close(A) -> Init3(A,saldirgan) -> TransferChecked(A): alici COZULEMEDI ("To: You" YOK), hasUnknown', async () => {
        const a = key()
        const out = await onizle([
            createInitializeAccount3Instruction(a, usdc, user),
            createCloseAccountInstruction(a, user, user),
            createInitializeAccount3Instruction(a, usdc, saldirgan),
            createTransferCheckedInstruction(key(), usdc, a, user, 100_000_000n, 6),
        ])
        const alan = labelOf(hedefSatiri(out), 'to')
        expect(alan.value).toBeNull()
        expect(alan.unresolved).toBe(true)
        expect(alan.tokenAccount).toBe(a.toBase58())
        expect(out.rows.flatMap((r) => r.fields).some((f) => f.value === user.toBase58() && f.labelKey === 'dapps.solana.f.to')).toBe(false)
        expect(out.hasUnknown).toBe(true)
    })

    it('ayni hesap FARKLI sahiple iki kez yaratilirsa (Close olmadan) alici cozulemedi ve hasUnknown', async () => {
        const a = key()
        const out = await onizle([
            createAssociatedTokenAccountIdempotentInstruction(user, a, user, usdc),
            createAssociatedTokenAccountIdempotentInstruction(user, a, saldirgan, usdc),
            createTransferCheckedInstruction(key(), usdc, a, user, 5n, 6),
        ])
        expect(labelOf(hedefSatiri(out), 'to').value).toBeNull()
        expect(out.hasUnknown).toBe(true)
    })

    it('Close SONRASI ayni sahiple yeniden yaratma satirlari tek basina hasUnknown yapar (InitializeAccount3)', async () => {
        const a = key()
        const out = await onizle([
            createInitializeAccount3Instruction(a, usdc, user),
            createCloseAccountInstruction(a, user, user),
            createInitializeAccount3Instruction(a, usdc, user),
        ])
        expect(out.hasUnknown).toBe(true)
    })

    it('Close SONRASI ATA CreateIdempotent de tek basina hasUnknown yapar', async () => {
        const a = key()
        const out = await onizle([
            createCloseAccountInstruction(a, user, user),
            createAssociatedTokenAccountIdempotentInstruction(user, a, user, usdc),
        ])
        expect(out.hasUnknown).toBe(true)
    })

    it('REGRESYON: ayni {mint, owner} tekrari (idempotent) davranisi degistirmez: alici sahibi cozulur, hasUnknown yok', async () => {
        const a = key()
        const out = await onizle([
            createInitializeAccount3Instruction(a, usdc, user),
            createInitializeAccount3Instruction(a, usdc, user),
            createTransferCheckedInstruction(key(), usdc, a, user, 5n, 6),
        ])
        expect(labelOf(hedefSatiri(out), 'to').value).toBe(user.toBase58())
        expect(out.hasUnknown).toBe(false)
    })
})

// SU-1: hasUnknown'u sessizce birakan dort dal.
describe('buildTxPreview -- hasUnknown susturan dallar (SU-1)', () => {
    const user = key()
    const usdc = new PublicKey(USDC)

    it('InitializeAccount3: mint cozulemedi + sahip kullanici -> hasUnknown', () => {
        // Mint hesabi talimatin hesap listesinde YOK (yalniz [hesap]); sahip veri govdesinden gelir.
        const mintsiz = new TransactionInstruction({
            programId: TOKEN_PID,
            keys: [{ pubkey: key(), isSigner: false, isWritable: true }],
            data: Buffer.concat([Buffer.from([18]), user.toBuffer()]),
        })
        const { out } = preview([mintsiz], { user })
        expect(out.rows.map((r) => r.kind)).toEqual(['initializeAccount'])
        expect(out.hasUnknown).toBe(true)
    })

    it('REGRESYON: mint VAR + sahip kullanici -> hasUnknown YOK (SU-1 yalniz mint cozulemedigini kapsar)', () => {
        const { out } = preview([createInitializeAccount3Instruction(key(), usdc, user)], { user })
        expect(out.hasUnknown).toBe(false)
    })

    it('Assign: yeni sahip bilinen program DEGILSE hasUnknown (kullanicinin hesabi olmayan hesap icin de)', () => {
        const { out } = preview([SystemProgram.assign({ accountPubkey: key(), programId: key() })], { user })
        expect(out.hasUnknown).toBe(true)
        expect(out.rows.map((r) => r.kind)).toEqual(['assign'])
    })

    it('Assign: yeni sahip System/Token ise hasUnknown YOK (bilinen program)', () => {
        const { out } = preview([
            SystemProgram.assign({ accountPubkey: key(), programId: SystemProgram.programId }),
            SystemProgram.assign({ accountPubkey: key(), programId: TOKEN_PID }),
        ], { user })
        expect(out.hasUnknown).toBe(false)
    })

    it('AssignWithSeed: yeni sahip bilinmeyen programsa hasUnknown', () => {
        const { out } = preview([SystemProgram.assign({
            accountPubkey: key(), basePubkey: user, seed: 's', programId: key(),
        })], { user })
        expect(out.hasUnknown).toBe(true)
    })

    it('ComputeBudget: TANIMSIZ opcode hasUnknown olur ve "okunamayan talimat" satiri uretir', () => {
        const tanimsiz = new TransactionInstruction({
            programId: new PublicKey('ComputeBudget111111111111111111111111111111'),
            keys: [],
            data: Buffer.from([9, 1, 2, 3]),
        })
        const { out } = preview([tanimsiz], { user })
        expect(out.hasUnknown).toBe(true)
        expect(out.rows.map((r) => r.kind)).toEqual(['undecodable'])
    })

    it('REGRESYON: bilinen ComputeBudget opcode lari (1..4) satir uretmez ve hasUnknown yapmaz', () => {
        const { out } = preview([
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 5000 }),
            ComputeBudgetProgram.requestHeapFrame({ bytes: 32768 }),
        ], { user })
        expect(out.rows).toEqual([])
        expect(out.hasUnknown).toBe(false)
    })

    it('AdvanceNonceAccount ILK sirada degilse satir uretir (hasDurableNonce false kalir); ilk sirada satir YOK', () => {
        const advance = SystemProgram.nonceAdvance({ noncePubkey: key(), authorizedPubkey: user })
        const transfer = SystemProgram.transfer({ fromPubkey: user, toPubkey: key(), lamports: 1 })
        const ikinci = preview([transfer, advance], { user }).out
        const digerler = ikinci.rows.filter((r) => r.kind === 'other')
        expect(digerler).toHaveLength(1)
        expect(digerler[0].type).toBe('AdvanceNonceAccount')
        expect(digerler[0].affectsUser).toBe(true)
        expect(ikinci.hasDurableNonce).toBe(false)

        const ilk = preview([advance, transfer], { user }).out
        expect(ilk.rows.some((r) => r.type === 'AdvanceNonceAccount')).toBe(false)
        expect(ilk.hasDurableNonce).toBe(true)
    })

    it('AdvanceNonceAccount: ilk sira nonce iken IKINCI bir AdvanceNonceAccount satir uretir', () => {
        const advance = () => SystemProgram.nonceAdvance({ noncePubkey: key(), authorizedPubkey: user })
        const { out } = preview([advance(), advance()], { user })
        expect(out.rows.filter((r) => r.type === 'AdvanceNonceAccount')).toHaveLength(1)
        expect(out.rows[0].index).toBe(1)
    })
})
