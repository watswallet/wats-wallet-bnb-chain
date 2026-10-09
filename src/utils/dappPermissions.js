/**
 * EIP-2255 izin sekilleri ve `wallet_revokePermissions` parametre ayristirma.
 * SAF: `chrome` yok, depo yok, ag yok.
 *
 * Cuzdan yalnizca TEK izin sunar: `eth_accounts` + `restrictReturnedAccounts`
 * kisiti (dapp'e acik hesaplar). `allowedChains`/`gasless` gibi ic kayit alanlari
 * izin olarak ACILMAZ. wagmi `permissions[0].caveats[0].value` bekler.
 */

export const ETH_ACCOUNTS_CAPABILITY = 'eth_accounts'
export const RESTRICT_RETURNED_ACCOUNTS = 'restrictReturnedAccounts'

/**
 * `wallet_getPermissions` sonucu. `orderedAccounts` ARAYAN TARAFIN verdigi sirali,
 * suzulmus (yalniz EVM) listedir; bos ise izin YOKTUR (`[]`).
 * `invoker` kayit anahtari DEGIL gonderen cercevenin origin'idir.
 */
export function buildPermissions({ origin, record, orderedAccounts }) {
    if (typeof origin !== 'string' || !origin) return []
    if (!Array.isArray(orderedAccounts) || orderedAccounts.length === 0) return []

    const permission = {
        invoker: origin,
        parentCapability: ETH_ACCOUNTS_CAPABILITY,
        caveats: [{ type: RESTRICT_RETURNED_ACCOUNTS, value: [...orderedAccounts] }],
    }
    // Eski kayitta `connectedAt` olmayabilir: o zaman `date` alani HIC yazilmaz.
    if (Number.isFinite(record?.connectedAt)) permission.date = record.connectedAt
    return [permission]
}

/**
 * `wallet_revokePermissions` parametresi: `[{ eth_accounts: {} }]`.
 * `params[0]` duz nesne ve EN AZ BIR anahtarli olmalidir (aksi -32602).
 * Diger izin adlari (ornegin `eth_chainId`) yok sayilir; yalniz `eth_accounts`
 * anahtarinin varligi sorulur.
 */
export function parseRevokeParams(params) {
    const first = Array.isArray(params) ? params[0] : undefined
    if (first === null || typeof first !== 'object' || Array.isArray(first) || Object.keys(first).length === 0) {
        return { ok: false, error: { code: -32602, message: 'Expected params[0] to be an object with at least one permission name.' } }
    }
    return { ok: true, value: { revokesEthAccounts: Object.prototype.hasOwnProperty.call(first, ETH_ACCOUNTS_CAPABILITY) } }
}
