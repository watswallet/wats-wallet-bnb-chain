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
    AuthorityType,
} from '@solana/spl-token'
import { parseDappTransaction } from './parseDappTransaction'
import {
    decodeInstructions, computeBudgetSummary, hasRedFlag,
    RED_FLAG_INSTRUCTIONS, COMPUTE_BUDGET_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
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

    it('CloseAccount kirmizi bayrak alir', () => {
        const decoded = decodeInstructions(legacyParsed(
            [createCloseAccountInstruction(account, owner, owner)], owner))
        expect(decoded[0].type).toBe('CloseAccount')
        expect(decoded[0].redFlag).toBe(true)
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
