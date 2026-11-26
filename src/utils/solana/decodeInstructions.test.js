// KOK NEDEN (§5.2): kor imzalama Solana'nin en yaygin drainer vektorudur.
// Approve/ApproveChecked ucuncu tarafa SURESIZ token yetkisi verir,
// SetAuthority hesabin sahipligini devreder, CloseAccount kirayi supurur --
// ucu de "normal" gorunen bir islemin icinde tek satirdir.
import './bufferGlobal.js'
import { describe, it, expect, vi } from 'vitest'
import {
    Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage,
    VersionedTransaction, ComputeBudgetProgram, TransactionInstruction,
} from '@solana/web3.js'
import {
    createApproveInstruction, createApproveCheckedInstruction, createCloseAccountInstruction,
    createSetAuthorityInstruction, createTransferCheckedInstruction,
    createInitializeAccountInstruction, createInitializeAccount2Instruction, createInitializeAccount3Instruction,
    AuthorityType, TOKEN_2022_PROGRAM_ID as SPL_TOKEN_2022_ID,
} from '@solana/spl-token'
import { parseDappTransaction } from './parseDappTransaction'
import {
    decodeInstructions, computeBudgetSummary, hasRedFlag,
    RED_FLAG_INSTRUCTIONS, COMPUTE_BUDGET_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
    riskOf, REDFLAG_UI_TYPES,
} from './decodeInstructions'

const BLOCKHASH = '11111111111111111111111111111111'
const b64 = (bytes) => Buffer.from(bytes).toString('base64')

function legacyParsed(instructions, payer = Keypair.generate().publicKey) {
    const tx = new Transaction()
    tx.recentBlockhash = BLOCKHASH
    tx.feePayer = payer
    for (const ix of instructions) tx.add(ix)
    return parseDappTransaction(b64(tx.serialize({ requireAllSignatures: false, verifySignatures: false })))
}

describe('decodeInstructions -- SystemProgram', () => {
    it('Transfer talimati adi ve lamports ile cozulur', () => {
        const a = Keypair.generate().publicKey
        const b = Keypair.generate().publicKey
        const decoded = decodeInstructions(legacyParsed(
            [SystemProgram.transfer({ fromPubkey: a, toPubkey: b, lamports: 12345 })], a))

        expect(decoded).toHaveLength(1)
        expect(decoded[0].program).toBe('system')
        expect(decoded[0].type).toBe('Transfer')
        expect(decoded[0].fields.lamports).toBe('12345')
        expect(decoded[0].redFlag).toBe(false)
        expect(decoded[0].accounts).toEqual([a.toBase58(), b.toBase58()])
    })
})

describe('decodeInstructions -- SPL Token KIRMIZI BAYRAKLAR', () => {
    const owner = Keypair.generate().publicKey
    const account = Keypair.generate().publicKey
    const delegate = Keypair.generate().publicKey

    it('Approve kirmizi bayrak alir', () => {
        const decoded = decodeInstructions(legacyParsed(
            [createApproveInstruction(account, delegate, owner, 1000n)], owner))
        expect(decoded[0].program).toBe('token')
        expect(decoded[0].type).toBe('Approve')
        expect(decoded[0].redFlag).toBe(true)
        expect(decoded[0].fields.amount).toBe('1000')
        expect(hasRedFlag(decoded)).toBe(true)
    })

    // review K3: kirmizi bayrak kullaniciya EYLEM bilgisi vermezse yarim bir
    // uyaridir -- ekran "Approve -- TEHLIKE" der ama kullanici KIME yetki
    // verdigini goremez. Gercek createApproveInstruction ciktisinda delegate
    // keys[1]'dedir (dogrulandi: task-27-report.md fix bolumu).
    it('Approve delegate hesabini fields.delegate olarak tasir', () => {
        const decoded = decodeInstructions(legacyParsed(
            [createApproveInstruction(account, delegate, owner, 1000n)], owner))
        expect(decoded[0].fields.delegate).toBe(delegate.toBase58())
    })

    it('SetAuthority kirmizi bayrak alir', () => {
        const decoded = decodeInstructions(legacyParsed(
            [createSetAuthorityInstruction(account, owner, AuthorityType.AccountOwner, delegate)], owner))
        expect(decoded[0].type).toBe('SetAuthority')
        expect(decoded[0].redFlag).toBe(true)
    })

    // review K3: SetAuthority kirmizi bayragin en tehlikelisidir -- hesap
    // SAHIPLIGI devredilir. `delegate` burada yeni sahip olarak veriliyor ve
    // AuthorityType.AccountOwner ile AccountOwner=2 KESIN olarak dogrulandi
    // (bkz. task-27-report.md). Gercek encoder ciktisinin BAYT SEVIYESINDE
    // dogrulandigi test -- "alan bos degil" degil, "alan TAM OLARAK bu adres".
    it('SetAuthority yeni yetkiliyi ve tur numarasini fields olarak tasir', () => {
        const decoded = decodeInstructions(legacyParsed(
            [createSetAuthorityInstruction(account, owner, AuthorityType.AccountOwner, delegate)], owner))
        expect(decoded[0].fields.authorityType).toBe(AuthorityType.AccountOwner)
        expect(decoded[0].fields.newAuthority).toBe(delegate.toBase58())
    })

    // Revoke (yeni yetkili YOK): option bayti 0'dir, veri govdesi 3 bayta
    // duser. UYDURMA riski en yuksek nokta -- yetkili YOKKEN bir adres
    // gostermek, kullaniciyi olmayan bir devir konusunda ikna eder.
    it('SetAuthority yeni yetkili verilmezse (revoke) newAuthority NULL kalir', () => {
        const decoded = decodeInstructions(legacyParsed(
            [createSetAuthorityInstruction(account, owner, AuthorityType.CloseAccount, null)], owner))
        expect(decoded[0].fields.authorityType).toBe(AuthorityType.CloseAccount)
        expect(decoded[0].fields.newAuthority).toBeNull()
    })

    // KASITLI DAVRANIS DEGISIKLIGI (E2): CloseAccount artik BAGLAMLIDIR. Kirayi
    // kullanicinin KENDI adresine donduren kapatma (Jupiter'in wSOL kapatmasi)
    // kirmizi DEGILDIR (her takasin kirmizi basmasi uyari korlugudur); baska bir
    // adrese donduren kirmizidir. Eski beklenti (user'siz "her CloseAccount
    // kirmizi") fail-closed yol olarak asagidaki baglamli blokta AYRICA korunur.
    it('CloseAccount kirayi BASKA adrese donduruyorsa kirmizi bayrak alir', () => {
        const baskasi = Keypair.generate().publicKey
        const decoded = decodeInstructions(legacyParsed(
            [createCloseAccountInstruction(account, baskasi, owner)], owner), { user: owner.toBase58() })
        expect(decoded[0].type).toBe('CloseAccount')
        expect(decoded[0].redFlag).toBe(true)
        expect(decoded[0].fields.rentTo).toBe(baskasi.toBase58())
    })

    it('CloseAccount kirayi kullanicinin kendisine donduruyorsa kirmizi DEGIL', () => {
        const wsol = Keypair.generate().publicKey
        const decoded = decodeInstructions(legacyParsed(
            [createCloseAccountInstruction(wsol, owner, owner)], owner), { user: owner.toBase58() })
        expect(decoded[0].type).toBe('CloseAccount')
        expect(decoded[0].redFlag).toBe(false)
        expect(decoded[0].fields.rentTo).toBe(owner.toBase58())
    })

    it('TransferChecked kirmizi bayrak ALMAZ', () => {
        const mint = Keypair.generate().publicKey
        const decoded = decodeInstructions(legacyParsed(
            [createTransferCheckedInstruction(account, mint, delegate, owner, 5n, 6)], owner))
        expect(decoded[0].type).toBe('TransferChecked')
        expect(decoded[0].fields.amount).toBe('5')
        expect(decoded[0].fields.decimals).toBe(6)
        expect(decoded[0].redFlag).toBe(false)
        expect(hasRedFlag(decoded)).toBe(false)
    })

    // ApproveChecked'in Approve'tan bir fazla hesabi vardir (mint araya girer),
    // delegate bir konum kayar: keys[2], keys[1] DEGIL. Gercek
    // createApproveCheckedInstruction ciktisiyla dogrulandi (task-27-report.md).
    it('ApproveChecked delegate hesabini fields.delegate olarak tasir', () => {
        const mint = Keypair.generate().publicKey
        const decoded = decodeInstructions(legacyParsed(
            [createApproveCheckedInstruction(account, mint, delegate, owner, 5n, 6)], owner))
        expect(decoded[0].type).toBe('ApproveChecked')
        expect(decoded[0].fields.delegate).toBe(delegate.toBase58())
    })

    it('kirmizi bayrak kumesi TAM OLARAK dort addir', () => {
        expect([...RED_FLAG_INSTRUCTIONS].sort())
            .toEqual(['Approve', 'ApproveChecked', 'CloseAccount', 'SetAuthority'])
    })

    // review K4: RED_FLAG_INSTRUCTIONS yalnizca token dalinda danisilirsa,
    // SystemProgram/ATA/ComputeBudget'a YARIN eklenecek cakisan bir ad SESSIZCE
    // bayraksiz kalir. Bugun dort ad hicbir baska programin tablosuyla
    // cakismadigi icin CIKTI davranisi ayirt edici degil -- kilit bu yuzden
    // "kac kere danisildi" uzerinden kurulur: dal-ici eski kod .has()'i SADECE
    // token talimati icin cagirirdi (1/4); ortak nokta HER talimat icin cagirir
    // (4/4). Bu, ORTAK bir hesaplama noktasinin GERCEKTEN var oldugunu kanitlar.
    it('RED_FLAG_INSTRUCTIONS her talimat icin -- yalnizca token icin degil -- danisilir', () => {
        const payer = Keypair.generate()
        const hedef = Keypair.generate().publicKey
        const spy = vi.spyOn(RED_FLAG_INSTRUCTIONS, 'has')
        try {
            const decoded = decodeInstructions(legacyParsed([
                SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: hedef, lamports: 1 }),
                createApproveInstruction(account, delegate, owner, 1n),
                new TransactionInstruction({
                    programId: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID),
                    keys: [{ pubkey: hedef, isSigner: false, isWritable: true }],
                    data: Buffer.alloc(0),
                }),
                ComputeBudgetProgram.setComputeUnitLimit({ units: 1000 }),
            ], payer.publicKey))

            expect(decoded).toHaveLength(4)
            expect(spy).toHaveBeenCalledTimes(decoded.length)
        } finally {
            spy.mockRestore()
        }
    })
})

describe('decodeInstructions -- ComputeBudget', () => {
    it('birim siniri ve oncelik ucreti OKUNUR (yazilmaz)', () => {
        const payer = Keypair.generate().publicKey
        const parsed = (() => {
            const message = new TransactionMessage({
                payerKey: payer,
                recentBlockhash: BLOCKHASH,
                instructions: [
                    ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }),
                    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1500 }),
                ],
            }).compileToV0Message()
            return parseDappTransaction(b64(new VersionedTransaction(message).serialize()))
        })()

        const decoded = decodeInstructions(parsed)
        expect(decoded[0].programId).toBe(COMPUTE_BUDGET_PROGRAM_ID)
        expect(decoded[0].type).toBe('SetComputeUnitLimit')
        expect(decoded[1].type).toBe('SetComputeUnitPrice')

        expect(computeBudgetSummary(decoded)).toEqual({ unitLimit: 300000, unitPriceMicroLamports: '1500' })
    })

    it('ComputeBudget yoksa ozet NULL alanlarla doner (oncelik ucreti YOK)', () => {
        const a = Keypair.generate().publicKey
        const decoded = decodeInstructions(legacyParsed(
            [SystemProgram.transfer({ fromPubkey: a, toPubkey: a, lamports: 1 })], a))
        expect(computeBudgetSummary(decoded)).toEqual({ unitLimit: null, unitPriceMicroLamports: null })
    })
})

describe('decodeInstructions -- DURUSTLUK KURALI', () => {
    // §5.2 (K5): cozemedigimiz talimat icin bir ozet UYDURMAK, kullaniciyi
    // gercekte onaylamadigi bir seye ikna etmek olurdu.
    it('taninmayan program icin type NULL kalir, ad UYDURULMAZ', () => {
        const yabanci = new PublicKey('Stake11111111111111111111111111111111111111')
        const a = Keypair.generate().publicKey
        const decoded = decodeInstructions(legacyParsed([new TransactionInstruction({
            programId: yabanci,
            keys: [{ pubkey: a, isSigner: true, isWritable: true }],
            data: Buffer.from([9, 9, 9]),
        })], a))

        expect(decoded[0].program).toBe('unknown')
        expect(decoded[0].type).toBeNull()
        expect(decoded[0].redFlag).toBe(false)
        expect(decoded[0].dataHex).toBe('090909')
    })

    it('bilinen programda taninmayan ayirici da type NULL birakir', () => {
        const a = Keypair.generate().publicKey
        const decoded = decodeInstructions(legacyParsed([new TransactionInstruction({
            programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
            keys: [{ pubkey: a, isSigner: true, isWritable: true }],
            data: Buffer.from([250]),
        })], a))
        expect(decoded[0].program).toBe('token')
        expect(decoded[0].type).toBeNull()
    })
})

describe('decodeInstructions -- ALT (adres arama tablosu)', () => {
    // ALT cozumlemesi AG cagrisi gerektirir ve onay penceresi ICINDE yapilir
    // (§5.2). Cozulemeyen indeks NULL kalir; UYDURULMAZ.
    it('lookups verilmezse tablo indeksleri NULL doner', () => {
        const payer = Keypair.generate()
        const hedef = Keypair.generate().publicKey
        const message = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: BLOCKHASH,
            instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: hedef, lamports: 1 })],
        }).compileToV0Message()
        const parsed = parseDappTransaction(b64(new VersionedTransaction(message).serialize()))

        // Statik anahtari ELLE tablo indeksine tasi: gercek bir ALT islemini
        // ag olmadan taklit eden en kucuk kurgu.
        parsed.tx.message.compiledInstructions[0].accountKeyIndexes = [0, 99]
        const decoded = decodeInstructions(parsed)
        expect(decoded[0].accounts[1]).toBeNull()

        const cozulmus = decodeInstructions(parsed, { lookups: { writable: [], readonly: [] } })
        expect(cozulmus[0].accounts[1]).toBeNull()
    })

    // review K2: "lookups verilmezse NULL doner" testi hicbir zaman GERCEK bir
    // indeksi DOGRU adrese cozmez -- YAZILABILIR-once-SALT-OKUNUR sirasinin
    // kodda iddia edildigi gibi korundugu ISPATLANMAMISTI. Bu test hem
    // cozumlemeyi hem SIRAYI kanitlar: sira ters olsaydi indeks 3, w0 yerine
    // r0'a cozulurdu -- tam eslesme bunu YAKALAR.
    function v0ParsedWithAlt() {
        const payer = Keypair.generate()
        const hedef = Keypair.generate().publicKey
        const message = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: BLOCKHASH,
            instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: hedef, lamports: 1 })],
        }).compileToV0Message()
        // statik anahtar sayisi 3 (payer, hedef, SystemProgram) -- lookup araligi
        // indeks 3'ten baslar.
        return parseDappTransaction(b64(new VersionedTransaction(message).serialize()))
    }

    it('lookups saglanirsa YAZILABILIR-sonra-SALT-OKUNUR sirayla GERCEK adrese cozulur', () => {
        const parsed = v0ParsedWithAlt()
        const w0 = Keypair.generate().publicKey
        const w1 = Keypair.generate().publicKey
        const r0 = Keypair.generate().publicKey

        // web3.js'in AddressTableLookup sekli: { accountKey, writableIndexes,
        // readonlyIndexes }. Ag olmadan gercek bir ALT'i taklit eden en kucuk
        // kurgu -- SAYILAR onemli (numAccountKeysFromLookups bunlardan turer),
        // degerler onemsiz.
        parsed.tx.message.addressTableLookups = [{
            accountKey: Keypair.generate().publicKey,
            writableIndexes: [10, 11],
            readonlyIndexes: [12],
        }]
        parsed.tx.message.compiledInstructions[0].accountKeyIndexes = [3, 4, 5]

        const decoded = decodeInstructions(parsed, {
            lookups: { writable: [w0.toBase58(), w1.toBase58()], readonly: [r0.toBase58()] },
        })
        expect(decoded[0].accounts).toEqual([w0.toBase58(), w1.toBase58(), r0.toBase58()])
    })

    // review K1: eksik/kismi bir lookups (bir tablo cozulemedi, siralama farkli)
    // her sonraki indeksi bir konum kaydirir. Kirilmamis kodda bu, BASKA bir
    // hesabin GERCEK adresini dondururdu -- bu test TAM OLARAK o senaryoyu
    // kurar ve NULL beklenir, yanlis-ama-gercek bir adres DEGIL.
    it('lookup sayisi mesajla UYUSMAZSA gercek-ama-YANLIS adres yerine NULL doner', () => {
        const parsed = v0ParsedWithAlt()
        // Baska bir hesabin GERCEK adresi -- kirik/hizasiz kodda index 3 buna
        // cozulurdu (all[3] providedWritable[0]).
        const w0 = Keypair.generate().publicKey

        // Mesaj 2 YAZILABILIR lookup hesabi bekliyor (writableIndexes.length === 2)
        // ama caller SADECE 1 tane veriyor -- bir tablonun COZULEMEDIGI durum,
        // review K1'in tarif ettigi TAM senaryo. web3.js'in kendi kontrolu de
        // (lib/index.cjs.js:941) TOPLAM sayiyi karsilastirir; ayni kontrol burada.
        parsed.tx.message.addressTableLookups = [{
            accountKey: Keypair.generate().publicKey,
            writableIndexes: [10, 11],
            readonlyIndexes: [],
        }]
        parsed.tx.message.compiledInstructions[0].accountKeyIndexes = [3, 4]

        const decoded = decodeInstructions(parsed, {
            lookups: { writable: [w0.toBase58()], readonly: [] },
        })
        expect(decoded[0].accounts).toEqual([null, null])
    })
})


// ---------------------------------------------------------------------------
// E2 (Gorev 4): tutar/alici alanlari ve BAGLAMLI kirmizi bayrak.
// Tum vakalar GERCEK @solana/web3.js / @solana/spl-token kodlayici ciktisiyla
// kurulur (elle bayt yazilmaz); kirpik veri vakalari gercek ciktinin KESILMESIYLE.
// ---------------------------------------------------------------------------
const MAX_U64 = 18446744073709551615n
const kes = (ix, n) => new TransactionInstruction({ programId: ix.programId, keys: ix.keys, data: ix.data.subarray(0, n) })

describe('decodeInstructions -- System tutar alanlari (E2)', () => {
    const a = Keypair.generate().publicKey
    const b = Keypair.generate().publicKey
    const baseKey = Keypair.generate().publicKey

    it('Transfer 1.5 SOL tam dize olarak gelir', () => {
        const d = decodeInstructions(legacyParsed(
            [SystemProgram.transfer({ fromPubkey: a, toPubkey: b, lamports: 1_500_000_000n })], a))
        expect(d[0].fields.lamports).toBe('1500000000')
    })

    it('Transfer 2^64-1 hassasiyet kaybetmeden tam dize gelir', () => {
        const d = decodeInstructions(legacyParsed(
            [SystemProgram.transfer({ fromPubkey: a, toPubkey: b, lamports: MAX_U64 })], a))
        expect(d[0].fields.lamports).toBe('18446744073709551615')
    })

    it('TransferWithSeed lamports ve hedefi tasir', () => {
        const d = decodeInstructions(legacyParsed([SystemProgram.transfer({
            fromPubkey: a, basePubkey: baseKey, toPubkey: b, lamports: 777, seed: 'abc', programId: SystemProgram.programId,
        })], baseKey))
        expect(d[0].type).toBe('TransferWithSeed')
        expect(d[0].fields.lamports).toBe('777')
        expect(d[0].fields.destination).toBe(b.toBase58())
    })

    it('TransferWithSeed seed kirpiksa lamports NULL (uydurma yok)', () => {
        const ix = SystemProgram.transfer({
            fromPubkey: a, basePubkey: baseKey, toPubkey: b, lamports: 777, seed: 'abcdef', programId: SystemProgram.programId,
        })
        // 4 (indeks) + 8 (lamports) + 8 (seed uzunlugu) + 2 seed bayti: seed ve sahip kirpik
        const d = decodeInstructions(legacyParsed([kes(ix, 22)], baseKey))
        expect(d[0].type).toBe('TransferWithSeed')
        expect(d[0].fields.lamports).toBeNull()
    })

    it('CreateAccount lamports/space/owner kodlayici ciktisindan gelir', () => {
        const yeni = Keypair.generate().publicKey
        const sahip = Keypair.generate().publicKey
        const d = decodeInstructions(legacyParsed([SystemProgram.createAccount({
            fromPubkey: a, newAccountPubkey: yeni, lamports: 2_039_280, space: 165, programId: sahip,
        })], a))
        expect(d[0].type).toBe('CreateAccount')
        expect(d[0].fields.lamports).toBe('2039280')
        expect(d[0].fields.space).toBe('165')
        expect(d[0].fields.owner).toBe(sahip.toBase58())
    })

    it('CreateAccount kirpik veri: okunamayan alanlar NULL', () => {
        const yeni = Keypair.generate().publicKey
        const ix = SystemProgram.createAccount({
            fromPubkey: a, newAccountPubkey: yeni, lamports: 5, space: 10, programId: SystemProgram.programId,
        })
        const d = decodeInstructions(legacyParsed([kes(ix, 14)], a))
        expect(d[0].fields.lamports).toBe('5')
        expect(d[0].fields.space).toBeNull()
        expect(d[0].fields.owner).toBeNull()
    })

    it('CreateAccountWithSeed lamports/space/owner seed sonrasindan okunur', () => {
        const yeni = Keypair.generate().publicKey
        const sahip = Keypair.generate().publicKey
        const d = decodeInstructions(legacyParsed([SystemProgram.createAccountWithSeed({
            fromPubkey: a, newAccountPubkey: yeni, basePubkey: a, seed: 'seed-1', lamports: 9_000, space: 80, programId: sahip,
        })], a))
        expect(d[0].type).toBe('CreateAccountWithSeed')
        expect(d[0].fields.lamports).toBe('9000')
        expect(d[0].fields.space).toBe('80')
        expect(d[0].fields.owner).toBe(sahip.toBase58())
    })

    it('CreateAccountWithSeed seed kirpiksa lamports/space/owner NULL', () => {
        const yeni = Keypair.generate().publicKey
        const ix = SystemProgram.createAccountWithSeed({
            fromPubkey: a, newAccountPubkey: yeni, basePubkey: a, seed: 'seed-1', lamports: 9_000, space: 80, programId: SystemProgram.programId,
        })
        // seed uzunlugu (u64 @36) var ama seed baytlari yarida kesilmis
        const d = decodeInstructions(legacyParsed([kes(ix, 46)], a))
        expect(d[0].fields.lamports).toBeNull()
        expect(d[0].fields.space).toBeNull()
        expect(d[0].fields.owner).toBeNull()
    })

    it('WithdrawNonceAccount lamports tasir', () => {
        const nonce = Keypair.generate().publicKey
        const d = decodeInstructions(legacyParsed([SystemProgram.nonceWithdraw({
            noncePubkey: nonce, authorizedPubkey: a, toPubkey: b, lamports: 4242,
        })], a))
        expect(d[0].type).toBe('WithdrawNonceAccount')
        expect(d[0].fields.lamports).toBe('4242')
    })

    it('AdvanceNonceAccount durableNonce:true isaretler', () => {
        const nonce = Keypair.generate().publicKey
        const d = decodeInstructions(legacyParsed([SystemProgram.nonceAdvance({
            noncePubkey: nonce, authorizedPubkey: a,
        })], a))
        expect(d[0].type).toBe('AdvanceNonceAccount')
        expect(d[0].fields.durableNonce).toBe(true)
        expect(d[0].redFlag).toBe(false)
    })

    it('Assign ve AssignWithSeed yeni sahibi (owner) tasir', () => {
        const sahip = Keypair.generate().publicKey
        const d = decodeInstructions(legacyParsed([
            SystemProgram.assign({ accountPubkey: a, programId: sahip }),
            SystemProgram.assign({ accountPubkey: b, basePubkey: baseKey, seed: 'x', programId: sahip }),
        ], a), { user: a.toBase58() })
        expect(d[0].type).toBe('Assign')
        expect(d[0].fields.owner).toBe(sahip.toBase58())
        expect(d[1].type).toBe('AssignWithSeed')
        expect(d[1].fields.owner).toBe(sahip.toBase58())
    })
})

describe('decodeInstructions -- Memo (E2)', () => {
    const MEMO_V1 = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'
    const MEMO_V2 = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
    const payer = Keypair.generate().publicKey
    const memoIx = (id, data) => new TransactionInstruction({
        programId: new PublicKey(id),
        keys: [{ pubkey: payer, isSigner: true, isWritable: false }],
        data: Buffer.from(data),
    })

    it('Memo v1 ve v2 metni okunur (type NULL degil)', () => {
        const d = decodeInstructions(legacyParsed([memoIx(MEMO_V1, 'merhaba'), memoIx(MEMO_V2, 'hello')], payer))
        expect(d[0].program).toBe('memo')
        expect(d[0].type).toBe('Memo')
        expect(d[0].fields.memoText).toBe('merhaba')
        expect(d[1].type).toBe('Memo')
        expect(d[1].fields.memoText).toBe('hello')
        expect(d[1].redFlag).toBe(false)
    })

    it('300 karakterlik Memo 140 karaktere kirpilir ve kirpildigi belirtilir', () => {
        const d = decodeInstructions(legacyParsed([memoIx(MEMO_V2, 'a'.repeat(300))], payer))
        expect(d[0].fields.memoText).toBe('a'.repeat(140))
        expect(d[0].fields.memoTruncated).toBe(true)
    })

    it('140 karakterlik Memo kirpilmaz', () => {
        const d = decodeInstructions(legacyParsed([memoIx(MEMO_V2, 'b'.repeat(140))], payer))
        expect(d[0].fields.memoText).toBe('b'.repeat(140))
        expect(d[0].fields.memoTruncated).toBe(false)
    })

    it('gorunmez yon karakteri [U+202E] olarak isaretlenir', () => {
        const d = decodeInstructions(legacyParsed([memoIx(MEMO_V2, 'odeme‮gpj.exe')], payer))
        expect(d[0].fields.memoText).toContain('[U+202E]')
        expect(d[0].fields.memoText).not.toContain('‮')
    })

    // final SU-2: TextDecoder bastaki BOM'u (EF BB BF) sessizce silerdi; onay ekrani
    // zincirdeki Memo'dan 3 bayt eksik metin gosterirdi. ignoreBOM:true ile BOM metinde
    // kalir ve gorunurKil onu [U+FEFF] olarak isaretler.
    it('Memo basindaki BOM (U+FEFF) SILINMEZ, [U+FEFF] olarak isaretlenir (SU-2)', () => {
        const d = decodeInstructions(legacyParsed([memoIx(MEMO_V2, '\uFEFFodeme')], payer))
        expect(d[0].fields.memoUnreadable).toBe(false)
        expect(d[0].fields.memoText).toBe('[U+FEFF]odeme')
    })

    it('gecersiz UTF-8 Memo okunamadi olarak isaretlenir, metin UYDURULMAZ', () => {
        const d = decodeInstructions(legacyParsed([memoIx(MEMO_V2, [0xff, 0xfe, 0x41])], payer))
        expect(d[0].type).toBe('Memo')
        expect(d[0].fields.memoText).toBeNull()
        expect(d[0].fields.memoUnreadable).toBe(true)
    })

    it('emoji/CJK iceren gecerli Memo okunur; kirpma kod noktasi sinirinda', () => {
        const metin = 'tesekkurler \u{1F600} 你好'
        const d = decodeInstructions(legacyParsed([memoIx(MEMO_V2, metin)], payer))
        expect(d[0].fields.memoUnreadable).toBe(false)
        expect(d[0].fields.memoText).toBe(metin)

        // 139 'a' + emoji + fazlasi: kirpma emojiyi (vekil cift) ORTADAN BOLMEZ
        const sinir = decodeInstructions(legacyParsed([memoIx(MEMO_V2, 'a'.repeat(139) + '\u{1F600}' + 'zzz')], payer))
        expect(sinir[0].fields.memoText).toBe('a'.repeat(139) + '\u{1F600}')
        expect(sinir[0].fields.memoTruncated).toBe(true)
    })
})

describe('decodeInstructions -- Token alanlari (E2)', () => {
    const owner = Keypair.generate().publicKey
    const account = Keypair.generate().publicKey
    const delegate = Keypair.generate().publicKey
    const mint = Keypair.generate().publicKey

    it('Approve 2^64-1 unlimited:true ve kirmizi', () => {
        const d = decodeInstructions(legacyParsed(
            [createApproveInstruction(account, delegate, owner, MAX_U64)], owner), { user: owner.toBase58() })
        expect(d[0].fields.amount).toBe('18446744073709551615')
        expect(d[0].fields.unlimited).toBe(true)
        expect(d[0].redFlag).toBe(true)
    })

    it('ApproveChecked 2^64-1 unlimited:true ve kirmizi', () => {
        const d = decodeInstructions(legacyParsed(
            [createApproveCheckedInstruction(account, mint, delegate, owner, MAX_U64, 6)], owner), { user: owner.toBase58() })
        expect(d[0].fields.unlimited).toBe(true)
        expect(d[0].redFlag).toBe(true)
    })

    it('sinirli Approve unlimited:false, yine kirmizi (sifirdan buyuk)', () => {
        const d = decodeInstructions(legacyParsed(
            [createApproveInstruction(account, delegate, owner, 1000n)], owner), { user: owner.toBase58() })
        expect(d[0].fields.unlimited).toBe(false)
        expect(d[0].redFlag).toBe(true)
    })

    it('Approve miktar 0 (yetki sifirlama) kirmizi DEGIL; ApproveChecked 0 da', () => {
        const d = decodeInstructions(legacyParsed([
            createApproveInstruction(account, delegate, owner, 0n),
            createApproveCheckedInstruction(account, mint, delegate, owner, 0n, 6),
        ], owner), { user: owner.toBase58() })
        expect(d[0].redFlag).toBe(false)
        expect(d[1].redFlag).toBe(false)
    })

    it('SetAuthority option 0 (yetkiyi kaldir) kirmizi DEGIL, yeni yetkili varsa kirmizi', () => {
        const d = decodeInstructions(legacyParsed([
            createSetAuthorityInstruction(account, owner, AuthorityType.CloseAccount, null),
            createSetAuthorityInstruction(account, owner, AuthorityType.AccountOwner, delegate),
        ], owner), { user: owner.toBase58() })
        expect(d[0].redFlag).toBe(false)
        expect(d[1].redFlag).toBe(true)
        expect(d[1].fields.newAuthority).toBe(delegate.toBase58())
    })

    it('SetAuthority authorityType 0..3 degerlerini tasir', () => {
        const types = [AuthorityType.MintTokens, AuthorityType.FreezeAccount, AuthorityType.AccountOwner, AuthorityType.CloseAccount]
        const d = decodeInstructions(legacyParsed(
            types.map((t) => createSetAuthorityInstruction(account, owner, t, delegate)), owner), { user: owner.toBase58() })
        expect(d.map((x) => x.fields.authorityType)).toEqual([0, 1, 2, 3])
    })

    it('SetAuthority option baytiyla yeni yetkili KIRPIK ise fail-closed: kirmizi', () => {
        const ix = createSetAuthorityInstruction(account, owner, AuthorityType.AccountOwner, delegate)
        const d = decodeInstructions(legacyParsed([kes(ix, 20)], owner), { user: owner.toBase58() })
        expect(d[0].fields.newAuthority).toBeNull()
        expect(d[0].redFlag).toBe(true)
    })

    it('Token ve Token-2022 programlari AYRI etiketlenir', () => {
        const d = decodeInstructions(legacyParsed([
            createTransferCheckedInstruction(account, mint, delegate, owner, 5n, 6),
            createTransferCheckedInstruction(account, mint, delegate, owner, 5n, 6, [], SPL_TOKEN_2022_ID),
        ], owner), { user: owner.toBase58() })
        expect(d[0].fields.tokenProgram).toBe('Token')
        expect(d[1].fields.tokenProgram).toBe('Token-2022')
        expect(d[1].type).toBe('TransferChecked')
    })

    it('tanimsiz token indeksi ve Token-2022 uzanti talimati type NULL kalir', () => {
        const tok = (programId, data) => new TransactionInstruction({
            programId: new PublicKey(programId),
            keys: [{ pubkey: account, isSigner: false, isWritable: true }],
            data: Buffer.from(data),
        })
        const d = decodeInstructions(legacyParsed([
            tok('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', [19]),
            tok(SPL_TOKEN_2022_ID.toBase58(), [26, 0]),
            tok(SPL_TOKEN_2022_ID.toBase58(), [250]),
        ], owner))
        expect(d.map((x) => x.type)).toEqual([null, null, null])
        expect(d[1].fields.tokenProgram).toBe('Token-2022')
    })

    it('eksik indeksler 16, 18, 22 adlandirilir', () => {
        const tok = (data) => new TransactionInstruction({
            programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
            keys: [{ pubkey: account, isSigner: false, isWritable: true }],
            data: Buffer.from(data),
        })
        const d = decodeInstructions(legacyParsed([tok([16]), tok([18]), tok([22])], owner))
        expect(d.map((x) => x.type)).toEqual(['InitializeAccount2', 'InitializeAccount3', 'InitializeImmutableOwner'])
        expect(d.every((x) => x.redFlag === false)).toBe(true)
    })
})

describe('decodeInstructions -- baglamli kirmizi bayrak (E2)', () => {
    const user = Keypair.generate().publicKey
    const baskasi = Keypair.generate().publicKey
    const tokenAcc = Keypair.generate().publicKey
    const wsol = Keypair.generate().publicKey
    const sahip = Keypair.generate().publicKey

    it('Assign kullanici hesabina -> kirmizi', () => {
        const d = decodeInstructions(legacyParsed(
            [SystemProgram.assign({ accountPubkey: user, programId: sahip })], user), { user: user.toBase58() })
        expect(d[0].redFlag).toBe(true)
    })

    it('Assign ayni islemde CreateAccount ile yaratilmis hesaba -> kirmizi DEGIL', () => {
        const yeni = Keypair.generate().publicKey
        const d = decodeInstructions(legacyParsed([
            SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: yeni, lamports: 1, space: 0, programId: SystemProgram.programId }),
            SystemProgram.assign({ accountPubkey: yeni, programId: sahip }),
        ], user), { user: user.toBase58() })
        expect(d[1].type).toBe('Assign')
        expect(d[1].redFlag).toBe(false)
    })

    it('createdInTx liste duzeyinde on-gecisle toplanir (Assign yaratmadan ONCE gelse de)', () => {
        const yeni = Keypair.generate().publicKey
        const d = decodeInstructions(legacyParsed([
            SystemProgram.assign({ accountPubkey: yeni, programId: sahip }),
            SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: yeni, lamports: 1, space: 0, programId: SystemProgram.programId }),
        ], user), { user: user.toBase58() })
        expect(d[0].redFlag).toBe(false)
    })

    it('CreateAccountWithSeed ile yaratilan hesaba AssignWithSeed -> kirmizi DEGIL', () => {
        const yeni = Keypair.generate().publicKey
        const d = decodeInstructions(legacyParsed([
            SystemProgram.createAccountWithSeed({ fromPubkey: user, newAccountPubkey: yeni, basePubkey: user, seed: 's', lamports: 1, space: 0, programId: SystemProgram.programId }),
            SystemProgram.assign({ accountPubkey: yeni, basePubkey: user, seed: 's', programId: sahip }),
        ], user), { user: user.toBase58() })
        expect(d[1].type).toBe('AssignWithSeed')
        expect(d[1].redFlag).toBe(false)
    })

    it('kullanicinin TABAN anahtarindan turetilmis ama bu islemde yaratilmamis hesaba AssignWithSeed -> kirmizi', () => {
        const turetilmis = Keypair.generate().publicKey
        const d = decodeInstructions(legacyParsed([
            SystemProgram.assign({ accountPubkey: turetilmis, basePubkey: user, seed: 's', programId: sahip }),
        ], user), { user: user.toBase58() })
        expect(d[0].type).toBe('AssignWithSeed')
        expect(d[0].redFlag).toBe(true)
    })

    it('baska bir hesaba Assign (kullanici degil, yaratilmamis) kirmizi DEGIL', () => {
        const d = decodeInstructions(legacyParsed(
            [SystemProgram.assign({ accountPubkey: baskasi, programId: sahip })], user), { user: user.toBase58() })
        expect(d[0].redFlag).toBe(false)
    })

    it('CloseAccount hedefi kullanici -> kirmizi DEGIL; baska -> kirmizi', () => {
        const d = decodeInstructions(legacyParsed([
            createCloseAccountInstruction(wsol, user, user),
            createCloseAccountInstruction(tokenAcc, baskasi, user),
        ], user), { user: user.toBase58() })
        expect(d[0].redFlag).toBe(false)
        expect(d[1].redFlag).toBe(true)
        expect(hasRedFlag(d)).toBe(true)
    })

    it('user VERILMEZSE her CloseAccount/Assign/SetAuthority fail-closed kirmizi', () => {
        const d = decodeInstructions(legacyParsed([
            createCloseAccountInstruction(wsol, user, user),
            SystemProgram.assign({ accountPubkey: baskasi, programId: sahip }),
            createSetAuthorityInstruction(tokenAcc, user, AuthorityType.CloseAccount, null),
        ], user))
        expect(d.map((x) => x.redFlag)).toEqual([true, true, true])
    })

    it('user bos dize / null / undefined ise de fail-closed', () => {
        for (const u of ['', null, undefined]) {
            const d = decodeInstructions(legacyParsed(
                [createCloseAccountInstruction(wsol, user, user)], user), { user: u })
            expect(d[0].redFlag).toBe(true)
        }
    })

    it('cozulemeyen (NULL) hedef hesapli CloseAccount fail-closed kirmizi', () => {
        const d = decodeInstructions(legacyParsed(
            [createCloseAccountInstruction(wsol, user, user)], user), { user: user.toBase58() })
        // hedef hesabi ALT'ta cozulememis gibi null yap
        const ix = { ...d[0], accounts: [d[0].accounts[0], null, d[0].accounts[2]] }
        expect(riskOf(ix, { user: user.toBase58() })).toBe(true)
    })

    it('Solana adresi buyuk/kucuk harf duyarli karsilastirilir', () => {
        const d = decodeInstructions(legacyParsed(
            [createCloseAccountInstruction(wsol, user, user)], user), { user: user.toBase58().toLowerCase() })
        expect(d[0].redFlag).toBe(true)
    })

    it('riskOf: createdInTx verilmezse bos kume sayilir; user verilmezse fail-closed', () => {
        const ix = { type: 'Assign', accounts: [user.toBase58()], fields: {} }
        expect(riskOf(ix, { user: user.toBase58() })).toBe(true)
        expect(riskOf(ix)).toBe(true)
    })

    // S4-S4-1: createdInTx muafiyeti `hedef === me` kontrolunden ONCE geliyordu;
    // cuzdanin ana adresi hem CreateAccount hedefi hem Assign hedefi yapilinca
    // ikisi de redFlag:false donuyordu. Kullanicinin KENDI adresi hicbir zaman
    // "bu islemde yaratilan hesap" sayilmaz.
    it('S4-S4-1: riskOf kullanicinin kendi adresi createdInTx icinde olsa da Assign kirmizi', () => {
        const ix = { type: 'Assign', accounts: [user.toBase58()], fields: {} }
        expect(riskOf(ix, { user: user.toBase58(), createdInTx: new Set([user.toBase58()]) })).toBe(true)
        const iw = { type: 'AssignWithSeed', accounts: [baskasi.toBase58(), user.toBase58()], fields: {} }
        expect(riskOf(iw, { user: user.toBase58(), createdInTx: new Set([user.toBase58()]) })).toBe(true)
    })

    it('S4-S4-1: CreateAccount(hedef=kullanici) + Assign(kullanici) -> Assign KIRMIZI (muafiyet atlatmasi)', () => {
        const d = decodeInstructions(legacyParsed([
            SystemProgram.createAccount({ fromPubkey: baskasi, newAccountPubkey: user, lamports: 1, space: 0, programId: SystemProgram.programId }),
            SystemProgram.assign({ accountPubkey: user, programId: sahip }),
        ], user), { user: user.toBase58() })
        expect(d[1].type).toBe('Assign')
        expect(d[1].redFlag).toBe(true)
    })

    it('S4-S4-1: CreateAccountWithSeed(hedef=kullanici) + AssignWithSeed(hedef=kullanici) -> AssignWithSeed KIRMIZI', () => {
        const d = decodeInstructions(legacyParsed([
            SystemProgram.createAccountWithSeed({ fromPubkey: baskasi, newAccountPubkey: user, basePubkey: baskasi, seed: 's', lamports: 1, space: 0, programId: SystemProgram.programId }),
            SystemProgram.assign({ accountPubkey: user, basePubkey: baskasi, seed: 's', programId: sahip }),
        ], user), { user: user.toBase58() })
        expect(d[1].type).toBe('AssignWithSeed')
        expect(d[1].redFlag).toBe(true)
    })

    it('S4-S4-1: tabani kullanici olan AssignWithSeed, hedef bu islemde yeni yaratilmissa kirmizi DEGIL', () => {
        const yeni = Keypair.generate().publicKey
        const mesru = decodeInstructions(legacyParsed([
            SystemProgram.createAccountWithSeed({ fromPubkey: user, newAccountPubkey: yeni, basePubkey: user, seed: 's', lamports: 1, space: 0, programId: SystemProgram.programId }),
            SystemProgram.assign({ accountPubkey: yeni, basePubkey: user, seed: 's', programId: sahip }),
        ], user), { user: user.toBase58() })
        expect(mesru[1].redFlag).toBe(false)
    })

    // V4-4: dekoder duzeyinde bosluk -- adli ama kirmizi/ekran karsiligi olmayan
    // System talimatlari. Zincir ustu sonuc (hapsetme) OLCULMEDI; fail-closed
    // karar: kullanici hesabina (ya da bu islemde yaratilmamis hesaba) Allocate /
    // AllocateWithSeed ve yaratilmamis nonce'a AuthorizeNonceAccount kirmizi.
    describe('V4-4: Allocate / AllocateWithSeed / AuthorizeNonceAccount', () => {
        it('Allocate kullanicinin KENDI hesabina -> kirmizi', () => {
            const d = decodeInstructions(legacyParsed(
                [SystemProgram.allocate({ accountPubkey: user, space: 100 })], user), { user: user.toBase58() })
            expect(d[0].type).toBe('Allocate')
            expect(d[0].redFlag).toBe(true)
        })

        it('Allocate bu islemde CreateAccount ile yaratilan yeni hesaba -> kirmizi DEGIL', () => {
            const yeni = Keypair.generate().publicKey
            const d = decodeInstructions(legacyParsed([
                SystemProgram.createAccount({ fromPubkey: user, newAccountPubkey: yeni, lamports: 1, space: 0, programId: SystemProgram.programId }),
                SystemProgram.allocate({ accountPubkey: yeni, space: 100 }),
            ], user), { user: user.toBase58() })
            expect(d[1].type).toBe('Allocate')
            expect(d[1].redFlag).toBe(false)
        })

        it('Allocate: hedef=kullanici CreateAccount ile "yaratilmis" gorunse de kirmizi', () => {
            const d = decodeInstructions(legacyParsed([
                SystemProgram.createAccount({ fromPubkey: baskasi, newAccountPubkey: user, lamports: 1, space: 0, programId: SystemProgram.programId }),
                SystemProgram.allocate({ accountPubkey: user, space: 100 }),
            ], user), { user: user.toBase58() })
            expect(d[1].redFlag).toBe(true)
        })

        it('AllocateWithSeed: tabani kullanici olan yaratilmamis hesap -> kirmizi', () => {
            const turetilmis = Keypair.generate().publicKey
            const d = decodeInstructions(legacyParsed([
                SystemProgram.allocate({ accountPubkey: turetilmis, basePubkey: user, seed: 's', space: 10, programId: sahip }),
            ], user), { user: user.toBase58() })
            expect(d[0].type).toBe('AllocateWithSeed')
            expect(d[0].redFlag).toBe(true)
        })

        it('AuthorizeNonceAccount yaratilmamis nonce hesabinda -> kirmizi; user yoksa fail-closed', () => {
            const nonce = Keypair.generate().publicKey
            const ix = SystemProgram.nonceAuthorize({ noncePubkey: nonce, authorizedPubkey: user, newAuthorizedPubkey: baskasi })
            const d = decodeInstructions(legacyParsed([ix], user), { user: user.toBase58() })
            expect(d[0].type).toBe('AuthorizeNonceAccount')
            expect(d[0].redFlag).toBe(true)
            expect(decodeInstructions(legacyParsed([ix], user))[0].redFlag).toBe(true)
        })

        it('kirmizi adlar kumesi (kilitli) degismez; UI tipleri REDFLAG_UI_TYPES ile sayilir', () => {
            expect([...RED_FLAG_INSTRUCTIONS].sort()).toEqual(['Approve', 'ApproveChecked', 'CloseAccount', 'SetAuthority'])
            expect([...REDFLAG_UI_TYPES].sort()).toEqual([
                'Allocate', 'AllocateWithSeed', 'Approve', 'ApproveChecked', 'Assign',
                'AssignWithSeed', 'AuthorizeNonceAccount', 'CloseAccount', 'SetAuthority',
            ])
        })
    })

    it('riskOf zararsiz tiplerde (Transfer, type NULL) false', () => {
        expect(riskOf({ type: 'Transfer', accounts: [], fields: {} }, { user: user.toBase58() })).toBe(false)
        expect(riskOf({ type: null, accounts: [], fields: {} })).toBe(false)
    })
})

describe('decodeInstructions -- InitializeAccount sahip ve mint (S5-F1)', () => {
    const hesap = Keypair.generate().publicKey
    const mint = Keypair.generate().publicKey
    const sahip = Keypair.generate().publicKey
    const payer = Keypair.generate().publicKey

    it('InitializeAccount sahibi hesap indeksi 2, mint indeksi 1 olarak okunur', () => {
        const d = decodeInstructions(legacyParsed([createInitializeAccountInstruction(hesap, mint, sahip)], payer))
        expect(d[0].type).toBe('InitializeAccount')
        expect(d[0].fields).toMatchObject({ owner: sahip.toBase58(), mint: mint.toBase58() })
    })

    it('InitializeAccount2 ve 3 sahibi veri govdesinden (32 bayt), mint hesap indeksi 1', () => {
        const d = decodeInstructions(legacyParsed([
            createInitializeAccount2Instruction(hesap, mint, sahip),
            createInitializeAccount3Instruction(hesap, mint, sahip),
        ], payer))
        expect(d.map((x) => x.type)).toEqual(['InitializeAccount2', 'InitializeAccount3'])
        for (const x of d) expect(x.fields).toMatchObject({ owner: sahip.toBase58(), mint: mint.toBase58() })
    })

    it('kirpik InitializeAccount3 verisinden sahip UYDURULMAZ (null)', () => {
        const ix = new TransactionInstruction({
            programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
            keys: [{ pubkey: hesap, isSigner: false, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false }],
            data: Buffer.from([18, 1, 2, 3]),
        })
        const d = decodeInstructions(legacyParsed([ix], payer))
        expect(d[0].fields.owner).toBeNull()
    })
})
