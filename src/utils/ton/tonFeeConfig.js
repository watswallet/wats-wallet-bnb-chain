// TON ucret yetkisinin EIP-712 kimligi.
//
// `verifyingContract` BURADA KOPYALANMAZ, atsConfig.js'ten import edilir: adres iki
// yerde yasarsa biri guncellenip digeri unutulur ve imza, ATS'yi gercekten cekecek
// kontrattan BASKA bir adrese baglanir - yani hic calismayan ya da baska bir
// tahsilat kontratinda yeniden kullanilabilen bir yetki uretiriz.
import { ATS_COLLECTOR, getAtsSourceConfig } from '../atsConfig'

export const TON_FEE_DOMAIN = Object.freeze({
    name: 'ATS TON Gas',
    version: '1',
    chainId: 56,
    verifyingContract: ATS_COLLECTOR,
})

// ALAN SIRASI IMZANIN PARCASI. Sira degisirse uretilen imza baska bir yapiya ait
// olur ve zincirde dogrulanmaz.
export const TON_FEE_AUTH_TYPES = Object.freeze({
    TonFeeAuth: [
        { name: 'tonWallet', type: 'string' },
        { name: 'tonPublicKey', type: 'bytes32' },
        { name: 'actionHash', type: 'bytes32' },
        { name: 'seqno', type: 'uint32' },
        { name: 'atsMaxFee', type: 'uint256' },
        { name: 'deadline', type: 'uint64' },
    ],
})

/**
 * Sunucunun donderdigi domain'i KENDI kurdugumuzla karsilastirir.
 * Gelen domaini korukorune imzalamak, ele gecirilmis bir backend'in imzayi baska
 * bir kontrata yonlendirmesine izin verirdi.
 * @throws {Error} TON_FEE_DOMAIN_MISMATCH
 */
export function assertTonFeeDomain(serverDomain) {
    for (const k of ['name', 'version', 'chainId', 'verifyingContract']) {
        const a = serverDomain?.[k]
        const b = TON_FEE_DOMAIN[k]
        const eq = k === 'verifyingContract'
            ? String(a).toLowerCase() === String(b).toLowerCase()
            : a === b
        if (!eq) throw new Error('TON_FEE_DOMAIN_MISMATCH')
    }
}

// TON ucret uclarinin (/paymaster/ton/quote, /paymaster/ton/relay,
// /paymaster/status) YASADIGI adres.
//
// Adres BURADA KOPYALANMAZ - yukaridaki ATS_COLLECTOR ile AYNI gerekce.
// atsConfig.js'teki calisan ATS yolu zaten oradan okuyor; ikinci bir kaynak,
// birinin guncellenip digerinin unutulmasi demektir.
//
// KOK NEDEN (olculdu 2026-08-31): burasi eskiden `configStore().bundlerBase`
// okuyordu ve o AYRI BIR SUNUCU. Olcum:
//   api.extension.watswallet.com -> /getTokenDataById 200, /bundler/auth 500,
//                                   /rpc/56 500, /paymaster/status 404, /health 404
//   bundler.watswallet.com       -> /paymaster/status 200, /health 200,
//                                   digerleri 404
// Yani `bundlerBase` Pimlico proxy'sinin adresi ve KENDI tuketicileri icin
// DOGRU; yanlis olan, TON ucret yolunun onu paymaster sanmasiydi. Her cagri
// 404 aliyordu ve ozellik production'da hic calismiyordu (para kaybi yok:
// akis fail-closed, ucret hic istenmiyordu).
export function tonFeePaymasterBase() {
    const base = getAtsSourceConfig()?.backendBase
    // Yapilandirma yoksa FIRLAT. `undefined` ile devam etmek "undefined/paymaster/status"
    // gibi bir URL uretir ve hata, ag katmaninda anlasilmaz bir sekilde patlar.
    if (!base) throw new Error('TON_FEE_BASE_MISSING')

    return base
}
