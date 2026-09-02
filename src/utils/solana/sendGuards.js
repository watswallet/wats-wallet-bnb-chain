import { isAddress } from 'ethers'
import { isValidSolanaAddress, isWalletAddress } from './address'
import { isSolanaUnsupportedAccount } from './accountSupport'

/**
 * Alici adresi bu VM icin gecerli mi.
 *
 * Iki sebep kodu AYRI TUTULUR: "gecersiz adres" ile "bu bir cuzdan adresi degil"
 * kullaniciya farkli seyler soyler. Ikincisinde adres bicimsel olarak DOGRUDUR
 * ve kullanici muhtemelen bir token hesabi adresi yapistirmistir — oraya
 * gonderilen para geri alinamaz.
 */
export function validateRecipient(address, vm) {
    if (vm === 'solana') {
        if (!isValidSolanaAddress(address)) return { valid: false, reason: 'INVALID_SOLANA_ADDRESS' }
        if (!isWalletAddress(address)) return { valid: false, reason: 'RECIPIENT_NOT_WALLET' }
        return { valid: true, reason: null }
    }

    if (!isAddress(address)) return { valid: false, reason: 'INVALID_EVM_ADDRESS' }
    return { valid: true, reason: null }
}

/**
 * Gonderim bastan engellenmeli mi (ve neden)?
 *
 * ONCEDEN bilinmezse kullanici "Onayla"ya basar, arka plan
 * SOLANA_UNSUPPORTED_ACCOUNT dondurur ve pencere hicbir aciklama olmadan kapanir.
 */
export function sendBlockReason({ account, vm }) {
    if (vm === 'solana' && isSolanaUnsupportedAccount(account)) {
        return 'SOLANA_UNSUPPORTED_ACCOUNT'
    }
    return null
}
