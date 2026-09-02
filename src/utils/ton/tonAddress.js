// TON adresi ayristirma ve bicimlendirme — saf katman.
//
// Uc ayri tuzagi TEK yerde kapatir:
//  1) EVM adresi: TON agindayken 0x yapistiran kullanici parasini kalici kaybeder.
//     Genel "gecersiz" mesaji sebebi gizler, ozel hata gosterir.
//  2) Yanlis ag: friendly adres testOnly bayragi tasir; testnet adresi mainnet'te
//     (ve tersi) reddedilir.
//  3) Bounceable: EQ... adrese giden para, hedef cuzdan HENUZ ZINCIRDE YOKSA geri
//     seker. Gonderim daima non-bounceable UQ... uzerinden kurulur.
//
// AG YOK, DEPO YOK: yalnizca @ton/core.

import { Address } from '@ton/core'

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

/**
 * @returns {Address}
 * @throws TON_ADDRESS_IS_EVM | TON_ADDRESS_WRONG_NETWORK | TON_ADDRESS_INVALID
 */
export function parseTonAddress(input, { testnet = false } = {}) {
    const raw = typeof input === 'string' ? input.trim() : ''
    if (!raw) throw new Error('TON_ADDRESS_INVALID')
    if (EVM_ADDRESS.test(raw)) throw new Error('TON_ADDRESS_IS_EVM')

    // Friendly bicim ag bayragi tasir; raw bicim tasimaz. Once friendly denenir ki
    // yanlis agdaki adres "gecersiz" degil, DOGRU sebeple reddedilsin.
    if (Address.isFriendly(raw)) {
        let parsed
        try {
            parsed = Address.parseFriendly(raw)
        } catch {
            throw new Error('TON_ADDRESS_INVALID')
        }
        if (parsed.isTestOnly !== testnet) throw new Error('TON_ADDRESS_WRONG_NETWORK')
        return parsed.address
    }

    try {
        return Address.parseRaw(raw)
    } catch {
        throw new Error('TON_ADDRESS_INVALID')
    }
}

export function isValidTonAddress(input, opts = {}) {
    try {
        parseTonAddress(input, opts)
        return true
    } catch {
        return false
    }
}

/** Daima non-bounceable: mainnet'te `UQ...`, testnet'te `0Q...`. */
export function toFriendlyTon(address, { testnet = false } = {}) {
    return address.toString({ bounceable: false, testOnly: testnet })
}

/** Alici girdisini gonderime hazir, non-bounceable metne cevirir. */
export function normalizeTonRecipient(input, opts = {}) {
    return toFriendlyTon(parseTonAddress(input, opts), opts)
}
