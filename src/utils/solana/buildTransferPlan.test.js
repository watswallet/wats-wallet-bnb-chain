import { describe, it, expect } from 'vitest'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import {
    createAssociatedTokenAccountInstruction,
    createTransferCheckedInstruction,
    getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { buildTransferPlan, maxSendableSol } from './buildTransferPlan'
import { SOL_NATIVE_MARKER, LAMPORTS_PER_SOL } from './constants'

const FROM = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const TO = 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy'
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
// GERCEKTEN egri disi bir adres: yukaridaki MINT'in FROM sahibi icin turetilmis
// ATA'si. DIKKAT — SPL Token program kimligi (TokenkegQ...) bu is icin
// KULLANILAMAZ: olculdu, o adres egri USTUNDEDIR. Program kimliklerinin egri
// disi oldugunu varsaymak yaygin bir yanilgidir; yalnizca PDA'lar (ATA dahil)
// kesin olarak egri disidir.
const OFF_CURVE = 'FGETo8T8wMcN2wCjav8VK6eh3dLk63evNDPxzLSJra8B'
const BLOCKHASH = '11111111111111111111111111111111'

const FROM_KEY = new PublicKey(FROM)
const TO_KEY = new PublicKey(TO)
const MINT_KEY = new PublicKey(MINT)
const FROM_ATA = getAssociatedTokenAddressSync(MINT_KEY, FROM_KEY)
const TO_ATA = getAssociatedTokenAddressSync(MINT_KEY, TO_KEY)

// Talimatlarin GERCEK icerigini (program, veri baytlari, her anahtarin
// isSigner/isWritable rolu) karsilastirir. Sadece transaction.instructions'in
// UZUNLUGUNA veya varligina bakan bir test hicbir sey kanitlamaz: mutasyon
// testinde, transferChecked'i createTransferInstruction ile degistirmek,
// kaynak/hedef anahtarlarini takas etmek, ATA'yi YANLIS hesaba acmak veya
// olusturma talimatini transferden SONRAYA tasimak gibi para kaybettiren
// dokuz mutasyonun HICBIRI onceki suit tarafindan yakalanmiyordu (bkz. fix
// raporu). Beklenen talimat, GERCEK @solana/spl-token ve @solana/web3.js
// fonksiyonlariyla BAGIMSIZ olarak uretilir; boylece karsilastirma,
// uygulamanin kendi mantigina degil kutuphanenin dogru kullanimina bakar.
function expectSameInstruction(actual, expected, label) {
    expect(actual.programId.toBase58(), `${label}: programId`).toBe(expected.programId.toBase58())
    expect(actual.data.toString('hex'), `${label}: data`).toBe(expected.data.toString('hex'))
    const keysOf = (ix) => ix.keys.map((k) => ({
        pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable,
    }))
    expect(keysOf(actual), `${label}: keys`).toEqual(keysOf(expected))
}

const base = {
    from: FROM, to: TO, blockhash: BLOCKHASH,
    feeLamports: 5000, recipientAtaExists: true, ataRentLamports: 2039280,
}

const sol = (over = {}) => buildTransferPlan({
    ...base, mint: SOL_NATIVE_MARKER, amount: '1', decimals: 9, ...over
})
const spl = (over = {}) => buildTransferPlan({
    ...base, mint: MINT, amount: '10', decimals: 6, ...over
})

describe('maxSendableSol', () => {
    // Tum SOL gonderilirse hesap kira muafiyeti esiginin ALTINA duser ve
    // silinebilir. "Maks" hem ucreti HEM kira minimumunu dusmeli.
    it('ucret VE kira minimumu dusulur', () => {
        const max = maxSendableSol({
            lamports: 1 * LAMPORTS_PER_SOL, feeLamports: 5000, rentExemptLamports: 890880
        })
        expect(max).toBeCloseTo((1 * LAMPORTS_PER_SOL - 5000 - 890880) / LAMPORTS_PER_SOL, 9)
    })

    it('bakiye ucret + kirayi karsilamiyorsa 0', () => {
        expect(maxSendableSol({ lamports: 1000, feeLamports: 5000, rentExemptLamports: 890880 })).toBe(0)
        expect(maxSendableSol({ lamports: 0, feeLamports: 5000, rentExemptLamports: 890880 })).toBe(0)
    })

    it('negatif sonuc dondurmez', () => {
        expect(maxSendableSol({ lamports: 890880, feeLamports: 5000, rentExemptLamports: 890880 })).toBe(0)
    })

    // Number(null) === 0 ve Number('') === 0: bu alanlar Number() ile
    // ZORLANIRSA null/''/false gibi degerler "kira/ucret sifirmis gibi"
    // sessizce kabul edilir ve kira terimi HESAPTAN DUSER — tam da bu
    // fonksiyonun onlemesi gereken kira-silinmesi riskini geri acar.
    // Gecersiz girdide GUVENLI TARAF olan 0 donmeli (asla "gonderebilirsin"
    // dememeli).
    it('nullish-ama-zorlanabilir girdide GUVENLI TARAFA (0) duser, kira/ucreti yok saymaz', () => {
        expect(maxSendableSol({ lamports: 1 * LAMPORTS_PER_SOL, feeLamports: 5000, rentExemptLamports: null })).toBe(0)
        expect(maxSendableSol({ lamports: 1 * LAMPORTS_PER_SOL, feeLamports: 5000, rentExemptLamports: '' })).toBe(0)
        expect(maxSendableSol({ lamports: 1 * LAMPORTS_PER_SOL, feeLamports: 5000, rentExemptLamports: false })).toBe(0)
        expect(maxSendableSol({ lamports: 1 * LAMPORTS_PER_SOL, feeLamports: null, rentExemptLamports: 890880 })).toBe(0)
    })
})

describe('buildTransferPlan — alici dogrulamasi', () => {
    it('gecerli SOL transferi plan uretir', () => {
        const plan = sol()
        expect(plan.transaction).toBeTruthy()
        expect(plan.extraCostLamports).toBe(0)
        expect(plan.warnings).toEqual([])
    })

    it('bicimsiz alici reddedilir', () => {
        expect(() => sol({ to: '0xabc' })).toThrow('INVALID_SOLANA_ADDRESS')
        expect(() => sol({ to: '' })).toThrow('INVALID_SOLANA_ADDRESS')
        expect(() => sol({ to: null })).toThrow('INVALID_SOLANA_ADDRESS')
    })

    // Egri disi bir adrese (program, PDA, token hesabi) gonderilen fonlar GERI
    // ALINAMAZ: o adresin ozel anahtari yoktur.
    it('egri disi alici RECIPIENT_NOT_WALLET ile reddedilir', () => {
        expect(() => sol({ to: OFF_CURVE })).toThrow('RECIPIENT_NOT_WALLET')
        expect(() => spl({ to: OFF_CURVE })).toThrow('RECIPIENT_NOT_WALLET')
    })

    it('kendine gonderim reddedilir', () => {
        expect(() => sol({ to: FROM })).toThrow('SELF_TRANSFER')
    })

    it('gonderen bicimsizse reddedilir', () => {
        expect(() => sol({ from: '0xabc' })).toThrow('INVALID_SOLANA_ADDRESS')
    })
})

describe('buildTransferPlan — tutar', () => {
    // SOL'un ondaligi SABITTIR (9). Yanlis bir decimals ile miktar SESSIZCE
    // yanlis olcekte hesaplanirdi (ornegin decimals=6 ile '1' SOL, gercekte
    // 0.001 SOL'e denk dusen lamports uretirdi) — acikca reddedilir.
    it('SOL icin yanlis decimals acikca reddedilir', () => {
        expect(() => sol({ decimals: 6 })).toThrow('INVALID_SOL_DECIMALS')
        expect(() => sol({ decimals: 0 })).toThrow('INVALID_SOL_DECIMALS')
    })

    it('sifir ve negatif tutar reddedilir', () => {
        expect(() => sol({ amount: '0' })).toThrow('AMOUNT_NOT_POSITIVE')
        expect(() => sol({ amount: '-1' })).toThrow('AMOUNT_NOT_POSITIVE')
        expect(() => sol({ amount: '' })).toThrow('AMOUNT_NOT_POSITIVE')
        expect(() => sol({ amount: 'abc' })).toThrow('AMOUNT_NOT_POSITIVE')
    })

    // Tokenin destekledigi ondaliktan FAZLA basamak sessizce kesilirse kullanici
    // girdiginden az gonderir ve farki hic fark etmez.
    it('ondalik siniri asan tutar acikca reddedilir', () => {
        expect(() => spl({ amount: '1.1234567', decimals: 6 })).toThrow('AMOUNT_EXCEEDS_PRECISION')
    })

    it('tam ondalik sinirindaki tutar kabul edilir', () => {
        expect(() => spl({ amount: '1.123456', decimals: 6 })).not.toThrow()
    })

    // Bilimsel gosterim kullanici girdisinden de gelebilir (yapistirma).
    it('bilimsel gosterim dogru cevrilir', () => {
        expect(() => sol({ amount: '1e-9', decimals: 9 })).not.toThrow()
    })

    // OLCULDU: `Number(str).toFixed(decimals)` bu girdide 0.11234567'yi (8
    // ondalik) SESSIZCE 0.112346'ya (6 ondalik) yuvarlar — hic hata atmadan.
    // Bilimsel gosterim de aynen normal gosterim gibi ondalik sinirini
    // ACIKCA asmalidir, yuvarlanmamalidir.
    it('bilimsel gosterimde ondalik siniri asilirsa acikca reddedilir', () => {
        expect(() => spl({ amount: '1.1234567e-1', decimals: 6 })).toThrow('AMOUNT_EXCEEDS_PRECISION')
    })

    // OLCULDU: bu deger double'in ~15-17 anlamli hane sinirini asar.
    // Number('123456789012345678e-9').toFixed(9) -> '123456789.012345672'
    // (YANLIS basamaklar) oysa dogru deger '123456789.012345678'dir (9 ondalik,
    // sinirinda, KABUL edilmeli). Tam sayi/dizge yolu bunu dogru cevirir.
    it('buyuk anlamli haneli bilimsel gosterim hassasiyet kaybetmeden cevrilir', () => {
        expect(() => sol({ amount: '123456789012345678e-9', decimals: 9 })).not.toThrow()
    })

    // HANE SAYISI degil ANLAMLI basamak sayisi sinirlanmali: sondaki sifirlar
    // deger tasimaz. Onceki kontrol yalnizca dizge uzunluguna baktigi icin bu
    // TAMAMEN GECERLI tutarlarin hepsini yanlislikla reddediyordu.
    it('sondaki sifirlar ondalik sinirini asmis SAYILMAZ', () => {
        expect(() => spl({ amount: '1.5000000', decimals: 6 })).not.toThrow()
        expect(() => spl({ amount: '10.000000000', decimals: 6 })).not.toThrow()
        expect(() => spl({ amount: '1.0', decimals: 0 })).not.toThrow()
        expect(() => spl({ amount: '100e-2', decimals: 1 })).not.toThrow()
    })

    // u64 sinirinin (2^64 - 1 = 18446744073709551615) tam ustu SPL tarafinda
    // SESSIZCE mod 2^64 sarardi (olculdu, bkz. fix raporu); acikca reddedilir.
    // Sinirin TAM UZERINDE kabul edilir (asagidaki eslik eden test).
    it('u64 sinirini asan tutar acikca reddedilir', () => {
        expect(() => spl({ amount: '18446744073709.551616', decimals: 6 })).toThrow('AMOUNT_TOO_LARGE')
        expect(() => spl({ amount: '20000000000000', decimals: 6 })).toThrow('AMOUNT_TOO_LARGE')
        expect(() => spl({ amount: '1e20', decimals: 6 })).toThrow('AMOUNT_TOO_LARGE')
    })

    it('u64 sinirinin TAM UZERINDEKI (esit) tutar kabul edilir', () => {
        expect(() => spl({ amount: '18446744073709.551615', decimals: 6 })).not.toThrow()
    })

    // Asiri buyuk/kucuk bir us, "bicimsiz tutar" diye tek bir kovaya
    // atilmamali: buyuk us GERCEKTEN cok buyuk bir miktar demektir
    // (AMOUNT_TOO_LARGE), kucuk (negatif) us GERCEKTEN cok fazla ondalik
    // basamak demektir (AMOUNT_EXCEEDS_PRECISION). Ikisi de kesinlikle
    // pozitif bir sayidir, AMOUNT_NOT_POSITIVE ile karistirilmamali.
    it('asiri buyuk/kucuk us dogru hatayla ayirt edilir', () => {
        expect(() => sol({ amount: '1e101', decimals: 9 })).toThrow('AMOUNT_TOO_LARGE')
        expect(() => sol({ amount: '1e-101', decimals: 9 })).toThrow('AMOUNT_EXCEEDS_PRECISION')
    })
})

describe('buildTransferPlan — SPL ve ATA', () => {
    it('alicinin ATA si varsa ek maliyet yok', () => {
        const plan = spl({ recipientAtaExists: true })
        expect(plan.extraCostLamports).toBe(0)
        expect(plan.warnings).toEqual([])
    })

    // ATA yoksa kirasini GONDEREN oder. Onay ekraninda ayri satir olarak
    // gorunmezse kullanici beklemedigi bir kesintiyle karsilasir.
    it('alicinin ATA si yoksa kira ek maliyet olarak bildirilir', () => {
        const plan = spl({ recipientAtaExists: false, ataRentLamports: 2039280 })
        expect(plan.extraCostLamports).toBe(2039280)
        expect(plan.warnings).toContain('RECIPIENT_ATA_CREATED')
    })

    it('SOL transferinde ATA hic sorulmaz', () => {
        const plan = sol({ recipientAtaExists: false })
        expect(plan.extraCostLamports).toBe(0)
        expect(plan.warnings).toEqual([])
    })

    // Alicinin ATA'si yoksa kirasini gonderen oder (yukarida) ama kira tutari
    // GECERSIZSE (bicimsiz/eksik) ATA hesabi YINE DE acilir ve kullanici
    // beklemedigi bir kesintiyle karsilasirdi — ek maliyet sessizce 0
    // gorunurdu. Bu, modulun tam olarak onlemeye calistigi durumdur.
    it('ATA olusturulurken kira tutari gecersizse acikca reddedilir', () => {
        expect(() => spl({ recipientAtaExists: false, ataRentLamports: undefined })).toThrow('ATA_RENT_REQUIRED')
        expect(() => spl({ recipientAtaExists: false, ataRentLamports: null })).toThrow('ATA_RENT_REQUIRED')
        expect(() => spl({ recipientAtaExists: false, ataRentLamports: NaN })).toThrow('ATA_RENT_REQUIRED')
        expect(() => spl({ recipientAtaExists: false, ataRentLamports: 'abc' })).toThrow('ATA_RENT_REQUIRED')
        expect(() => spl({ recipientAtaExists: false, ataRentLamports: -1 })).toThrow('ATA_RENT_REQUIRED')
        expect(() => spl({ recipientAtaExists: false, ataRentLamports: 0 })).toThrow('ATA_RENT_REQUIRED')
    })

    it('ATA olusturulurken gecerli kira tutari (dizge dahil) kabul edilir', () => {
        const plan = spl({ recipientAtaExists: false, ataRentLamports: '2039280' })
        expect(plan.extraCostLamports).toBe(2039280)
    })
})

describe('buildTransferPlan — uretilen talimatlar (mutasyon testleri)', () => {
    it('SOL transferi TEK talimat uretir: dogru program, dogru lamports verisi, dogru imzalayan/yazilabilir roller', () => {
        const plan = sol({ amount: '1', decimals: 9 })
        expect(plan.transaction.instructions).toHaveLength(1)

        const expected = SystemProgram.transfer({
            fromPubkey: FROM_KEY, toPubkey: TO_KEY, lamports: 1_000_000_000,
        })
        expectSameInstruction(plan.transaction.instructions[0], expected, 'SOL transfer')
    })

    it('ATA zaten varsa TEK transferChecked talimati uretir: mint ve ondalik veriye gomulu', () => {
        const plan = spl({ recipientAtaExists: true, amount: '10', decimals: 6 })
        expect(plan.transaction.instructions).toHaveLength(1)

        const expected = createTransferCheckedInstruction(
            FROM_ATA, MINT_KEY, TO_ATA, FROM_KEY, 10_000_000n, 6
        )
        expectSameInstruction(plan.transaction.instructions[0], expected, 'transferChecked')
    })

    // Sira ONEMLI: ATA once acilmali, transfer SONRA gelmeli. Tersi olursa
    // islem zincirde "hesap yok" hatasiyla reddedilir (ya da daha kotusu,
    // baska bir hesaba yazar) — bu yuzden sira burada AYRICA dogrulanir.
    it('ATA yoksa ONCE olusturma talimati SONRA transferChecked gelir, ikisi de dogru anahtarlarla', () => {
        const plan = spl({ recipientAtaExists: false, ataRentLamports: 2039280, amount: '10', decimals: 6 })
        expect(plan.transaction.instructions).toHaveLength(2)

        const expectedCreate = createAssociatedTokenAccountInstruction(FROM_KEY, TO_ATA, TO_KEY, MINT_KEY)
        const expectedTransfer = createTransferCheckedInstruction(
            FROM_ATA, MINT_KEY, TO_ATA, FROM_KEY, 10_000_000n, 6
        )

        expectSameInstruction(plan.transaction.instructions[0], expectedCreate, 'createATA (1. sirada)')
        expectSameInstruction(plan.transaction.instructions[1], expectedTransfer, 'transferChecked (2. sirada)')
    })
})

describe('buildTransferPlan — blockhash', () => {
    // Blockhash ~60-90 sn de gecersizlesir. Eksikse islem zincirde reddedilir
    // ama kullanici imzayi ZATEN atmis olur.
    it('blockhash yoksa plan uretilmez', () => {
        expect(() => sol({ blockhash: null })).toThrow('BLOCKHASH_REQUIRED')
        expect(() => sol({ blockhash: '' })).toThrow('BLOCKHASH_REQUIRED')
    })

    it('blockhash isleme yazilir', () => {
        const plan = sol()
        expect(plan.transaction.recentBlockhash).toBe(BLOCKHASH)
    })

    it('ucreti odeyen GONDERENDIR', () => {
        const plan = sol()
        expect(plan.transaction.feePayer.toBase58()).toBe(FROM)
    })
})
