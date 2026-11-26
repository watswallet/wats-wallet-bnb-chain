// txThresholds.js -- Solana islem onay ekrani esikleri (SAF sabit dosyasi: import YOK,
// ag YOK, chrome YOK). Esikler BURADA tek yerde durur; ekran sayi gommez.
//
// BASLANGIC DEGERLERI (patron karari Q7): Gorev 34 olcumu ve kullanici karariyla
// ayarlanir; uygulayici ajan kendi basina degistirmez.
//
// Oncelik ucreti (prioritization fee) = ceil(birimFiyat[uL/CU] * birimLimit[CU] / 1_000_000)
// lamport. Para hesabi BigInt'tir (Constraint 17).

// Bir islemin calistirabilecegi en yuksek hesaplama birimi: runtime, SetComputeUnitLimit
// degerini bu tavana kirpar. Limit talimati olmayan islem de en fazla bu kadar CU kullanir.
export const MAX_COMPUTE_UNIT_LIMIT = 1_400_000

// 0.01 SOL: ust sinir bunu asarsa amber uyari.
export const PRIORITY_FEE_WARN_LAMPORTS = 10_000_000n
// 0.1 SOL: ust sinir bunu asarsa kor-imza kutusu zorunlu (onayKilitli'ya girer).
export const PRIORITY_FEE_BLOCK_LAMPORTS = 100_000_000n

const MICRO = 1_000_000n

/**
 * Oncelik ucretinin GERCEK ust siniri (lamport, BigInt).
 *
 * Fiyat statik okunduysa ust sinir HER ZAMAN hesaplanir: limit talimati varsa
 * min(limit, MAX_COMPUTE_UNIT_LIMIT), YOKSA (ya da okunamadiysa) MAX_COMPUTE_UNIT_LIMIT.
 * Limit talimatini atlayip varsayilan CU ile ayni ucreti cektirmek bu yolla mumkun degildir.
 *
 * @param {{unitLimit?: number|null, unitPriceMicroLamports?: string|bigint|null}} butce
 *   computeBudgetSummary() ciktisi (fiyat ondalik dize, limit sayi).
 * @returns {bigint|null} fiyat yok/okunamadiysa null; fiyat 0 ise 0n
 */
export function priorityFeeCeilingLamports({ unitLimit, unitPriceMicroLamports } = {}) {
    let fiyat
    if (typeof unitPriceMicroLamports === 'bigint') {
        fiyat = unitPriceMicroLamports
    } else if (typeof unitPriceMicroLamports === 'string' && /^[0-9]+$/.test(unitPriceMicroLamports)) {
        fiyat = BigInt(unitPriceMicroLamports)
    } else {
        return null
    }
    if (fiyat < 0n) return null

    const limit = Number.isInteger(unitLimit) && unitLimit >= 0
        ? Math.min(unitLimit, MAX_COMPUTE_UNIT_LIMIT)
        : MAX_COMPUTE_UNIT_LIMIT
    return (fiyat * BigInt(limit) + (MICRO - 1n)) / MICRO
}
