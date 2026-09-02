import { GasParams } from './gasless'

/**
 * GAZ TAHMİNİ NEDEN ÖNEMLİ — ölçülmüş bir maliyet farkı.
 *
 * Aynı-zincir yolunda fazla gaz zararsızdır: `ATSPaymaster` peşin alır, postOp'ta kullanılmayanı
 * İADE EDER. Çapraz-zincirde İADE YOKTUR — `ATSRemotePaymaster`'ın postOp'u yoktur, tahsilat
 * başka zincirde bitmiştir. Kullanıcı gaz TAVANINI öder.
 *
 * 2026-08-08 mainnet koşusunda ölçüldü (BSC 56 -> arbitrum 42161):
 *
 *   verilen tavan : 1.000.000 gas x 0.05 gwei = 0.00005   ETH  -> 0.192 dolar alindi
 *   gercek        :   380.000 gas x 0.02 gwei = 0.0000038 ETH  -> 0.005 dolar harcandi
 *
 * Kullanıcı 13 katı ödedi. Bu yüzden istemci SABİT limitler kullanmaz.
 *
 * AYNI GÜN, base (8453) koşusu — EntryPoint'in kendi `UserOperationEvent`'inden okundu:
 *
 *   verilen tavan : 1.000.000 gas   (5 limitin toplamı)
 *   actualGasUsed :   181.783 gas   -> tavanın %18'i
 *
 * Farkın BEŞTE BİRİ tek bir kalemden geliyordu: `paymasterPostOpGasLimit` = 200.000.
 * `ATSRemotePaymaster`'ın postOp'u YOKTUR — `context` her zaman boş döner ve EntryPoint postOp'u
 * hiç çağırmaz (contracts/ATSRemotePaymaster.sol:26). Yani o 200.000 gaz, çalışması İMKÂNSIZ bir
 * kod için ayrılıp iadesiz tahsil ediliyordu. `crosschain: true` ile sıfırlanır.
 */

/** Yukarı yuvarlar: aşağı yuvarlamak tahmini yetersiz bırakır ve op zincirde başarısız olur. */
export function withMargin(value: bigint, marginPct: number): bigint {
    if (!Number.isInteger(marginPct) || marginPct < 0) {
        throw new Error(`marj negatif olamaz ve tam sayı olmalı: ${marginPct}`)
    }
    const scaled = value * BigInt(100 + marginPct)
    return (scaled + 99n) / 100n
}

export interface EstimateInput {
    /** `eth_estimateGas` ile ölçülen asıl çağrı maliyeti. */
    callGas: bigint
    /**
     * Bu op çapraz-zincir yolundan mı geçecek (`/paymaster/status` `mode === 'crosschain'`).
     * `true` ise `paymasterPostOpGas` varsayılanı SIFIR olur — remote paymaster'ın postOp'u yok.
     *
     * YANLIŞ VERİLMESİ: `true` deyip sunucu `normal`/`bootstrap` seçerse `/sponsor`
     * `postop-gas-required` koduyla reddeder — zincire hiçbir şey gitmez, para harcanmaz.
     * `false` deyip mod `crosschain` çıkarsa yalnız fazla ödersin (eski davranış).
     */
    crosschain?: boolean
    verificationGas?: bigint
    preVerificationGas?: bigint
    paymasterVerificationGas?: bigint
    paymasterPostOpGas?: bigint
    baseFeePerGas: bigint
    priorityFeePerGas: bigint
}

/**
 * Doğrulama tarafı `eth_estimateGas` ile ölçülemez (op henüz yok). Bu değerler
 * test/hardhat/ats.gasless.first-user.test.ts'te gerçek bir type-4 işlemiyle KANITLANMIŞ
 * limitlerdir ve doğrulama maliyeti çağrıdan bağımsız olduğu için sabit kalabilir.
 */
const DEFAULTS = {
    verificationGas: 300000n,
    preVerificationGas: 100000n,
    paymasterVerificationGas: 200000n,
    paymasterPostOpGas: 200000n,
}

export function buildGasParams(i: EstimateInput, marginPct = 25): GasParams {
    // Çapraz-zincirde postOp ÇALIŞMAZ (boş context) — ona gaz ayırmak iadesiz fazla ödemedir.
    const postOpDefault = i.crosschain ? 0n : DEFAULTS.paymasterPostOpGas
    return {
        callGasLimit: withMargin(i.callGas, marginPct),
        verificationGasLimit: withMargin(i.verificationGas ?? DEFAULTS.verificationGas, marginPct),
        preVerificationGas: withMargin(i.preVerificationGas ?? DEFAULTS.preVerificationGas, marginPct),
        paymasterVerificationGasLimit: withMargin(
            i.paymasterVerificationGas ?? DEFAULTS.paymasterVerificationGas,
            marginPct
        ),
        paymasterPostOpGasLimit: withMargin(i.paymasterPostOpGas ?? postOpDefault, marginPct),
        // baseFee bir sonraki blokta en fazla %12.5 artabilir; 2x çarpan birkaç blokluk
        // dalgalanmaya dayanır. Daha büyük bir çarpan çapraz-zincirde DOĞRUDAN kullanıcının
        // cebinden çıkar.
        maxFeePerGas: i.baseFeePerGas * 2n + i.priorityFeePerGas,
    }
}
