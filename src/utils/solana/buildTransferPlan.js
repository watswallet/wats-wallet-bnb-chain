import './bufferGlobal.js'
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import {
    createAssociatedTokenAccountInstruction,
    createTransferCheckedInstruction,
    getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { toPublicKey, isWalletAddress, normalizeSolanaAddress } from './address'
import { LAMPORTS_PER_SOL, SOL_NATIVE_MARKER, SOL_DECIMALS } from './constants'

// u64 ile kodlanabilecek en buyuk deger (2^64 - 1). Bunun ustu SPL
// transferChecked'de SESSIZCE mod 2^64 SARAR (olculdu: 20000000000000 @6
// ondalik -> zincire 1553255926290448384 gibi rastgele KUCUK bir sayi yazilir,
// hic hata olmadan). SOL yolu ayni sinirin disina cikinca web3.js'in kendi
// kodec kontrolunden hata alirdi; bu satir ayni siniri HER IKI yol icin de
// ACIKCA ve TEK yerden, web3.js'e guvenmeden uygular.
const U64_MAX = (1n << 64n) - 1n

/**
 * Transfer plani — SAF katman.
 *
 * Ag cagrisi YAPMAZ: blockhash, ucret, ATA'nin var olup olmadigi ve kira tutari
 * GIRDI olarak alinir. Boylece butun kenar durumlar (ATA yok, kira siniri,
 * suresi dolmus blockhash) ag olmadan test edilebilir.
 */

// lamports/fee/rent icin gecerli tek bicim: sonlu, negatif OLMAYAN bir number.
// Number(null) === 0 ve Number('') === 0 oldugu icin bu alanlar dogrudan
// Number() ile ZORLANIRSA null/''/false gibi degerler "kira/ucret sifirmis
// gibi" sessizce kabul edilir — olculdu: rent=null iken eski kod max'i
// 0.999995 SOL donduruyordu (kira terimi sessizce yok oluyordu). Kesin tip
// kontrolu bu deligi kapatir; gecersiz girdide GUVENLI TARAF olan 0 donulur
// (bu fonksiyonun tek isi hesabi kira-silinmesinden korumak, hicbir zaman
// gercekte gonderilebilecekten FAZLASINI soylememeli).
function isValidLamportNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/**
 * Gonderilebilecek en yuksek SOL.
 *
 * Tum bakiye gonderilirse hesap KIRA MUAFIYETI esiginin altina duser ve
 * calistiricilar tarafindan silinebilir — kullanici hesabini ve icindeki token
 * hesaplarinin sahipligini kaybeder. Bu yuzden ucretin YANI SIRA kira minimumu
 * da dusulur.
 */
export function maxSendableSol({ lamports, feeLamports, rentExemptLamports }) {
    if (!isValidLamportNumber(lamports) || !isValidLamportNumber(feeLamports) ||
        !isValidLamportNumber(rentExemptLamports)) {
        return 0
    }
    const available = lamports - feeLamports - rentExemptLamports
    if (available <= 0) return 0
    return available / LAMPORTS_PER_SOL
}

/**
 * Bilimsel gosterimi (1e-9, 1.1234567e-1, ...) Number'a UGRAMADAN duz ondalik
 * dizgeye cevirir — salt dizge/hane kaydirma ile.
 *
 * Number(str) burada KULLANILAMAZ: double yaklasik 15-17 anlamli haneden fazlasini
 * TUTAMAZ ve ardindan gelen toFixed(decimals) ikinci bir yuvarlama ekler. Bu,
 * hem yanlis basamaklar (buyuk anlamli haneli girdilerde) hem de ondalik
 * sinirini SESSIZCE asan tutarlarin fark edilmeden yuvarlanmasi anlamina gelir
 * — tam da 3. gereksinimin yasakladigi sessiz hassasiyet kaybi. Olculdu:
 *   Number('1.1234567e-1').toFixed(6)              -> '0.112346'  (YANLIS: 8
 *     ondalikli gercek deger 0.11234567, decimals=6 icin REDDEDILMELIYDI)
 *   Number('123456789012345678e-9').toFixed(9)     -> '123456789.012345672'
 *     (YANLIS basamaklar; dogrusu 123456789.012345678'dir)
 * Asagidaki yol tamamen tam sayi/dizge islemleri kullanir, boylece asil
 * ondalik-basamak-sayisi kontrolu (toBaseUnits icindeki fraction.length kontrolu)
 * bilimsel gosterim icin de TAM olarak dogru calisir.
 */
function expandScientificNotation(str) {
    const match = /^([+-]?)(\d*)(?:\.(\d*))?e([+-]?\d+)$/.exec(str)
    if (!match) throw new Error('AMOUNT_NOT_POSITIVE')

    const [, sign, intPart, fracPartRaw, expStr] = match
    const fracPart = fracPartRaw || ''
    const digits = intPart + fracPart
    if (digits.length === 0) throw new Error('AMOUNT_NOT_POSITIVE')

    const exponent = Number(expStr)
    // Us buyuklugu SADECE patolojik bir bellek/performans istismarina karsi
    // sinirlanir (10000 haneli bir dizge bile mikrosaniyeler icinde islenir).
    // Sinir dar TUTULMAZ: '1e101' gibi asiri buyuk ama BICIMSEL OLARAK gecerli
    // bir tutarin hangi hataya dusecegine (AMOUNT_TOO_LARGE) veya '1e-101'
    // gibi asiri ondalikli bir tutarin hangi hataya dusecegine (
    // AMOUNT_EXCEEDS_PRECISION) burada degil, asagidaki gercek deger
    // kontrollerinde karar verilir — aksi halde format kontrolu bu iki farkli
    // hatayi tek bir yanlis etikete (AMOUNT_NOT_POSITIVE) gizlerdi.
    if (!Number.isInteger(exponent) || Math.abs(exponent) > 10000) {
        throw new Error('AMOUNT_NOT_POSITIVE')
    }

    const pointPos = intPart.length + exponent
    let digitsStr
    if (pointPos <= 0) {
        digitsStr = '0.' + '0'.repeat(-pointPos) + digits
    } else if (pointPos >= digits.length) {
        digitsStr = digits + '0'.repeat(pointPos - digits.length)
    } else {
        digitsStr = digits.slice(0, pointPos) + '.' + digits.slice(pointPos)
    }

    return sign + digitsStr
}

/**
 * Kullanici tutarini tam sayi temel birime cevirir.
 *
 * Tokenin destekledigi ondaliktan FAZLA basamak SESSIZCE KESILMEZ: kesilirse
 * kullanici girdiginden az gonderir ve farki hic fark etmez. Acikca reddedilir.
 */
function toBaseUnits(amount, decimals) {
    let str = String(amount ?? '').trim().toLowerCase()
    if (str === '') throw new Error('AMOUNT_NOT_POSITIVE')

    // Bilimsel gosterim (1e-9) yapistirmadan da gelebilir. bkz. yukaridaki not:
    // Number() UZERINDEN GECILMEZ.
    if (str.includes('e')) {
        str = expandScientificNotation(str)
    }

    if (!/^\d*\.?\d*$/.test(str)) throw new Error('AMOUNT_NOT_POSITIVE')

    const [whole = '0', fraction = ''] = str.split('.')
    // ANLAMLI basamak sayisi kontrol edilir, HANE SAYISI degil: sondaki
    // sifirlar deger tasimaz. '1.5000000' @6 ondalik tam olarak temsil
    // edilebilir (deger 1.5'tir) ve reddedilmemelidir — sadece hane sayisina
    // bakan bir kontrol bunu (ve '10.000000000' @6, '1.0' @0, '100e-2' @1
    // gibi tamamen zararsiz girdileri) YANLIS YERE AMOUNT_EXCEEDS_PRECISION
    // ile reddederdi: bu, gecerli bir transferi gecersiz gostererek modulun
    // var olma amacinin tam tersini yapar.
    const trimmedFraction = fraction.replace(/0+$/, '')
    if (trimmedFraction.length > decimals) throw new Error('AMOUNT_EXCEEDS_PRECISION')

    const padded = trimmedFraction.padEnd(decimals, '0')
    // BigInt: 9+ ondalikli tutarlarda Number hassasiyeti kaybeder ve kullanici
    // girdiginden farkli bir miktar gonderilir.
    const units = BigInt(whole || '0') * BigInt(10) ** BigInt(decimals) + BigInt(padded || '0')
    if (units <= 0n) throw new Error('AMOUNT_NOT_POSITIVE')
    // u64 sinirinin ustu SPL tarafinda SESSIZCE sarar (bkz. U64_MAX yorumu).
    // Gercek zarar sinirlidir (tasan bir tutar zaten hicbir gercek bakiyeyle
    // karsilanamaz) ama kullanicinin hic yazmadigi bir sayi zincire yazilir ve
    // hicbir hata firlatilmazdi; burada acikca reddedilir.
    if (units > U64_MAX) throw new Error('AMOUNT_TOO_LARGE')

    return units
}

export function buildTransferPlan({
    from, to, mint, amount, decimals,
    blockhash, feeLamports = 5000,
    recipientAtaExists = true, ataRentLamports = 0,
}) {
    // Blockhash ~60-90 saniyede gecersizlesir. Eksik birakilirsa islem zincirde
    // reddedilir ama kullanici imzayi ZATEN atmis olur.
    if (typeof blockhash !== 'string' || blockhash.length === 0) {
        throw new Error('BLOCKHASH_REQUIRED')
    }

    const fromKey = toPublicKey(from)
    const toKey = toPublicKey(to)

    // Egri disi bir adrese (program hesabi, PDA, token hesabi) gonderilen fonlar
    // GERI ALINAMAZ: o adresin ozel anahtari yoktur, kimse harcayamaz.
    if (!isWalletAddress(to)) throw new Error('RECIPIENT_NOT_WALLET')

    if (normalizeSolanaAddress(from) === normalizeSolanaAddress(to)) {
        throw new Error('SELF_TRANSFER')
    }

    const transaction = new Transaction()
    transaction.recentBlockhash = blockhash
    transaction.feePayer = fromKey

    const warnings = []
    let extraCostLamports = 0

    if (mint === SOL_NATIVE_MARKER) {
        // SOL'un ondaligi SABITTIR (9). Cagiran yanlis bir decimals verirse
        // (ornegin bir SPL token'inkini) miktar SESSIZCE yanlis olcekte
        // hesaplanir — '1' SOL, decimals=6 ile 1 SOL yerine 0.001 SOL'e denk
        // dusen lamports uretir. Bu, modulun kapatmaya calistigi tam olarak
        // ayni sinif hatadir (yanlis ondalik -> yanlis miktar); acikca
        // reddedilir.
        if (decimals !== SOL_DECIMALS) throw new Error('INVALID_SOL_DECIMALS')
        const lamports = toBaseUnits(amount, decimals)
        transaction.add(SystemProgram.transfer({
            fromPubkey: fromKey,
            toPubkey: toKey,
            lamports,
        }))
        return { transaction, extraCostLamports, warnings }
    }

    const mintKey = toPublicKey(mint)
    const units = toBaseUnits(amount, decimals)

    const fromAta = getAssociatedTokenAddressSync(mintKey, fromKey)
    const toAta = getAssociatedTokenAddressSync(mintKey, toKey)

    // Alicinin ATA'si yoksa ONCE acilir; kirasini GONDEREN oder. Bu maliyet
    // cagirana ayrica bildirilir ki onay ekraninda AYRI SATIR olarak gorunsun —
    // aksi halde kullanici beklemedigi bir kesintiyle karsilasir.
    if (!recipientAtaExists) {
        // Kira tutari GECERLI (sonlu, pozitif) bir sayi olmali. `Number(x) || 0`
        // ile zorlamak undefined/null/NaN/'abc' gibi degerleri sessizce 0'a
        // cevirirdi — ATA hesabi YINE DE olusturulur ama onay ekraninda ek
        // maliyet GORUNMEZ. Bu, modulun tam olarak onlemek icin var oldugu
        // "beklenmedik kesinti" durumudur; bu tek alanda sessizce gecmek
        // yerine acikca reddedilir.
        const rent = Number(ataRentLamports)
        if (!Number.isFinite(rent) || rent <= 0) {
            throw new Error('ATA_RENT_REQUIRED')
        }
        transaction.add(createAssociatedTokenAccountInstruction(
            fromKey,  // odeyen
            toAta,
            toKey,    // sahip
            mintKey,
        ))
        extraCostLamports = rent
        warnings.push('RECIPIENT_ATA_CREATED')
    }

    // transferChecked (transfer degil): mint ve ondalik zincirde DOGRULANIR.
    // Duz transfer, yanlis ondalikla cagrildiginda 1000 kat fazla/az gonderir.
    transaction.add(createTransferCheckedInstruction(
        fromAta, mintKey, toAta, fromKey, units, decimals
    ))

    return { transaction, extraCostLamports, warnings }
}
