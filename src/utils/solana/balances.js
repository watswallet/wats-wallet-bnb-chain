import './bufferGlobal.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { solanaRpc } from './client'
import { toPublicKey } from './address'
import { LAMPORTS_PER_SOL, SOL_DECIMALS, SOL_NATIVE_MARKER, TOKEN_PROGRAM_ID } from './constants'

/** lamports -> SOL. Gecersiz girdi 0 (bakiye "bilinmiyor" diye bir durum yok). */
export function parseSolBalance(lamports) {
    const n = Number(lamports)
    return Number.isFinite(n) ? n / LAMPORTS_PER_SOL : 0
}

/**
 * Ham tam sayi dizgesini (SPL "amount", u64 dizge olarak gelir) ondalik
 * sayiya cevirir — TEK bir dizge->double donusumu ile.
 *
 * `Number(raw) / Math.pow(10, decimals)` YETERSIZ: 9 ondaligin ustunde raw
 * deger Number.MAX_SAFE_INTEGER'i (9_007_199_254_740_991) kolayca asar ve
 * `Number(raw)` bu asamada ZATEN yuvarlanir; ardindan gelen bolme ikinci bir
 * yuvarlama ekler. Iki yuvarlama tek yuvarlamadan daha kotudur. Burada once
 * ondalik NOKTA dizgeye eklenir, sonra TEK bir Number() cagrisiyla parse
 * edilir — motor dizgeyi en yakin double'a dogrudan ve tek adimda yuvarlar.
 *
 * Ornek (gercek SPL olcegi): raw='9007199254740993', decimals=6 (~9 milyar
 * token, 6 ondalik — buyuk arzli bir meme coin icin siradan).
 *   Number(raw)/1e6      -> 9007199254.740992  (YANLIS, son basamak kaymis)
 *   dizge birlestirip parse -> 9007199254.740993 (DOGRU)
 */
function rawAmountToNumber(raw, decimals) {
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return NaN

    const padded = raw.padStart(decimals + 1, '0')
    const cut = padded.length - decimals
    const intPart = padded.slice(0, cut)
    const fracPart = decimals > 0 ? padded.slice(cut) : ''

    return Number(fracPart ? `${intPart}.${fracPart}` : intPart)
}

/**
 * getTokenAccountsByOwner (jsonParsed) yanitini varlik satirlarina cevirir.
 *
 * YALNIZCA SAHIBININ ATA'SI (Associated Token Account) SAYILIR.
 *
 * Eskiden ayni mint'in TUM token hesaplari TOPLANIYORDU. Gerekce makuldu
 * ("toplanmazsa kullanici parasinin bir kismini gormez") ama sonuc, cuzdanin
 * TUTAMAYACAGI bir soz veriyordu: buildTransferPlan.js:201 transferin kaynagini
 * KOSULSUZ `getAssociatedTokenAddressSync(mint, owner)` olarak kuruyor. ATA'da
 * 10, elle acilmis ikinci bir hesapta 90 varsa ekran 100 gosteriyor, "Maks" 100
 * oneriyor ve gonderilebilecek tek rakam 10. Kullaniciya SUNULAN sayi,
 * GONDEREBILECEGI sayi olmak zorundadir.
 *
 * Toplama ayrica ARITMETIK olarak da bozuktu: 0,1 + 0,2 = 0,30000000000000004
 * ve bu deger toBaseUnits'e verildiginde AMOUNT_EXCEEDS_PRECISION firlatiyordu --
 * yani cuzdan, KENDI urettigi bir sayi icin kullaniciyi "en fazla 6 ondalik"
 * diye suclu buluyordu. ATA tek bir hesaptir: TEK bir dizge->double donusumu,
 * biriken hata YOK.
 *
 * Kabul edilen takas: yalnizca ATA DISI bir hesapta tutulan bir mint listede
 * GORUNMEZ. Bu bilincli bir karar -- Faz 1'de o bakiye zaten GONDERILEMEZ, yani
 * gostermek "harcayabilirsin" demenin baska bir yolu olurdu. Cuzdanlarin
 * (Phantom, Solflare, Jupiter) hepsi ATA acar; ATA disi hesap nadirdir.
 *
 * Bakiyesi SIFIR olan hesaplar elenir: kullanici bir tokenin tamamini
 * gonderdiginde hesap acik kalir ve liste zamanla olu satirlarla dolar.
 *
 * @param {object} result getTokenAccountsByOwner (jsonParsed) yaniti
 * @param {string} owner  hesaplarin SAHIBI (base58 cuzdan adresi)
 */
export function parseTokenAccounts(result, owner) {
    const value = result?.value
    if (!Array.isArray(value)) return []

    // Sahip COZULEMIYORSA hicbir satir dondurulemez: ATA'yi ondan turetiyoruz ve
    // turetemeden "bu hesap ATA'dir" demek, tam olarak kaldirilan varsayimdir.
    if (typeof owner !== 'string' || owner.length === 0) return []
    let ownerKey
    try {
        ownerKey = toPublicKey(owner)
    } catch {
        return []
    }

    const rows = []

    for (const entry of value) {
        const info = entry?.account?.data?.parsed?.info
        const mint = info?.mint
        const raw = info?.tokenAmount?.amount
        const decimals = info?.tokenAmount?.decimals

        if (typeof mint !== 'string' || typeof raw !== 'string' || !Number.isInteger(decimals)) continue

        // Hesap adresi ATA ile KARSILASTIRILIR. `pubkey` yoksa (bicimsiz yanit)
        // eslesme olmaz ve satir DUSER -- "belki ATA'dir" diye varsaymak,
        // gonderilemeyen bir bakiyeyi yeniden ekrana koymak olurdu.
        let ata
        try {
            ata = getAssociatedTokenAddressSync(toPublicKey(mint), ownerKey).toBase58()
        } catch {
            continue
        }
        // Base58 harf kasasi KORUNARAK karsilastirilir.
        if (entry?.pubkey !== ata) continue

        const amount = rawAmountToNumber(raw, decimals)
        if (!Number.isFinite(amount) || amount === 0) continue

        rows.push({ mint, amount, decimals })
    }

    return rows
}

/**
 * Bir adresin tum varliklari: once native SOL, sonra SPL tokenlar.
 *
 * SPL cagrisi duserse SOL YINE DONER. Tek bir arizali cagri yuzunden butun
 * bakiyeyi gizlemek, kullaniciya parasi kaybolmus gibi gorunur.
 */
export async function fetchSolanaAssets(address) {
    if (typeof address !== 'string' || address.length === 0) return []

    const assets = []

    try {
        const sol = await solanaRpc('getBalance', [address])
        assets.push({
            mint: SOL_NATIVE_MARKER,
            amount: parseSolBalance(sol?.value),
            decimals: SOL_DECIMALS
        })
    } catch (e) {
        console.error('Solana SOL bakiyesi alinamadi:', e.message)
    }

    try {
        const spl = await solanaRpc('getTokenAccountsByOwner', [
            address,
            { programId: TOKEN_PROGRAM_ID },
            { encoding: 'jsonParsed' }
        ])
        assets.push(...parseTokenAccounts(spl, address))
    } catch (e) {
        console.error('Solana SPL bakiyeleri alinamadi:', e.message)
    }

    return assets
}
