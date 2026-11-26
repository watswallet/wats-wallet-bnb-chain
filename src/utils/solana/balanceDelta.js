// balanceDelta.js -- simulateTransaction `value` nesnesinden kullanicinin SOL ve
// token bakiye farki. SAF katman: import YOK, ag YOK, chrome YOK, firlatmaz.
//
// GUVEN SINIRI (Constraint 16): girdi UCUNCU TARAF saglayicinin (simulasyon)
// yanitidir; sonuc yalniz GOSTERIM icindir, imza kararini baglamaz. Bu yuzden
// bozuk/tutarsiz veri "uydurma bir rakam" yerine `unusable` ile reddedilir.
//
// Para hesabi BigInt (Constraint 17). Adres karsilastirmasi birebirdir:
// base58 harf kutusu duyarlidir, toLowerCase YOKTUR.

const UNUSABLE = Object.freeze({ ok: false, reason: 'unusable' })
const DIGITS = /^\d+$/

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isAddress = (v) => typeof v === 'string' && v !== ''
const isDecimals = (d) => Number.isInteger(d) && d >= 0 && d <= 255

// Lamport bakiyeleri JSON'da sayi olarak gelir; 2^53'u asan deger ayristirma
// aninda hassasiyet kaybetmistir -> o rakamdan fark hesaplanmaz.
function lamports(v) {
    return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null
}

/**
 * Kullanicinin token farki: `owner === user` olan kayitlar mint'e gore toplanir
 * (post +, pre -). Yalniz post'ta olan kayit pre=0, yalniz pre'de olan post=0
 * sayilir (ayni toplama bunu dogal olarak verir). Net farki 0 olan mint satir
 * uretmez. Baskasinin kayitlari OKUNMAZ (bozuk olsalar da sonucu bozmaz).
 * Bozuk bir KULLANICI kaydi `null` dondurur (-> unusable).
 *
 * `owner` alani OLMAYAN (ya da string olmayan) kayit kime ait oldugu bilinemeyen kayittir:
 * "kullanicinin degil" diye atlanirsa kullanicinin token cikisi sessizce kaybolurdu.
 * Bu yuzden sonuc `partial: true` isaretlenir (ekran "degisim yok" demez).
 */
function userTokenDeltas(pre, post, user) {
    const byMint = new Map()
    let partial = false
    const add = (list, sign) => {
        for (const entry of list) {
            if (!isRecord(entry) || typeof entry.owner !== 'string' || entry.owner === '') { partial = true; continue }
            if (entry.owner !== user) continue
            const ui = entry.uiTokenAmount
            const amount = isRecord(ui) ? ui.amount : undefined
            if (typeof entry.mint !== 'string' || entry.mint === '') return false
            if (typeof amount !== 'string' || !DIGITS.test(amount)) return false
            if (!isDecimals(ui.decimals)) return false

            const slot = byMint.get(entry.mint)
            if (slot && slot.decimals !== ui.decimals) return false
            const delta = sign * BigInt(amount)
            if (slot) slot.delta += delta
            else byMint.set(entry.mint, { mint: entry.mint, delta, decimals: ui.decimals })
        }
        return true
    }

    if (!add(pre, -1n) || !add(post, 1n)) return null
    return { rows: [...byMint.values()].filter((row) => row.delta !== 0n), partial }
}

/**
 * @param {{value: object, accountKeys: string[], user: string}} args
 *   `accountKeys`: preBalances ile AYNI sirada tam liste (static, writable, readonly).
 * @returns {{ok:true, solDeltaLamports:bigint, tokenDeltas:{mint:string, delta:bigint, decimals:number}[],
 *   tokensUnreadable:boolean, partial:boolean} | {ok:false, reason:'unusable'}}
 *   `tokensUnreadable`: pre/postTokenBalances dizi DEGIL (yok/null): token farki BOS degil OKUNAMADI.
 *   `partial`: `owner`siz token kaydi var: bilinen satirlar eksik olabilir. Ikisi de "degisim yok"
 *   guvencesini yasaklar; SOL farki bunlardan etkilenmez.
 *   SOL farki kullanici indeksinde `post - pre` (ucret ve kira DAHIL: toplam cikis);
 *   kullanici listede yoksa 0n.
 *   `user` bos olmayan string, `accountKeys` ogelerinin HEPSI bos olmayan string
 *   olmali (PublicKey nesnesi degil: tuketici `.toBase58()` ile cevirir); aksi `unusable`.
 */
export function computeBalanceDelta(args) {
    try {
        // Destructuring try ICINDE (SU-5): null/undefined arguman firlatmaz, `unusable` olur.
        const { value, accountKeys, user } = args ?? {}
        if (!isRecord(value) || !Array.isArray(accountKeys)) return UNUSABLE
        // Tip dogrulamasi: yanlis tipte `user` (null, PublicKey nesnesi) veya anahtar
        // ogesi (PublicKey[]) "kullanici listede yok -> degisiklik yok" dalina DUSMEMELI;
        // o dal yalniz GECERLI string user + string liste icin dogrudur (spec 3.2).
        // `Array.from`: seyrek dizinin delikleri `undefined` olarak gorulur (`every` delikleri ATLARDI).
        if (!isAddress(user) || !Array.from(accountKeys).every(isAddress)) return UNUSABLE
        const { preBalances, postBalances } = value
        if (!Array.isArray(preBalances) || !Array.isArray(postBalances)) return UNUSABLE
        // Uzunluk uyusmazligi hesap -> bakiye eslemesini YANLIS yapar.
        if (preBalances.length !== accountKeys.length || postBalances.length !== accountKeys.length) return UNUSABLE

        let solDeltaLamports = 0n
        const userIndex = accountKeys.indexOf(user)
        if (userIndex >= 0) {
            const pre = lamports(preBalances[userIndex])
            const post = lamports(postBalances[userIndex])
            if (pre === null || post === null) return UNUSABLE
            solDeltaLamports = post - pre
        }

        // Token dizileri yoksa/null ise "token degisimi yok" DEGIL "okunamadi" (fail-closed).
        const tokensUnreadable = !Array.isArray(value.preTokenBalances) || !Array.isArray(value.postTokenBalances)
        const pre = Array.isArray(value.preTokenBalances) ? value.preTokenBalances : []
        const post = Array.isArray(value.postTokenBalances) ? value.postTokenBalances : []
        const tokens = userTokenDeltas(pre, post, user)
        if (tokens === null) return UNUSABLE

        return { ok: true, solDeltaLamports, tokenDeltas: tokens.rows, tokensUnreadable, partial: tokens.partial }
    } catch {
        return UNUSABLE
    }
}
