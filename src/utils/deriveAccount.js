import { HDNodeWallet, Wallet } from 'ethers'
import { unlockVault, decryptSecret } from './crypto-utils'

/**
 * Bir hesabin hangi kasada oldugunu bulur.
 *
 * Hesap ADIYLA aranmamali: hesap adlari kullanici tarafindan serbestce degistirilebilir
 * ve iki kasada ayni ad bulunabilir - o zaman yanlis kasanin sirri acilir.
 * Once `key` (kasa-icinde benzersiz kimlik), sonra adres ile eslesilir.
 */
export function findVaultForAccount(vaults, account) {
    if (!Array.isArray(vaults) || !account) return null

    const matches = (a, byKey) => {
        if (!a) return false
        if (byKey) return !!a.key && !!account.key && a.key === account.key
        return !!a.address && !!account.address &&
            a.address.toLowerCase() === account.address.toLowerCase()
    }

    // Iki gecis: key eslesmesi adres eslesmesinden once gelir, cunku ayni adres
    // birden fazla kasada bulunabilir (ice aktarma + HD).
    for (const byKey of [true, false]) {
        for (const vault of vaults) {
            if (!vault || !Array.isArray(vault.accounts)) continue
            if (vault.accounts.some(a => matches(a, byKey))) return vault
        }
    }
    return null
}

/**
 * Adrese gore hesabi bulur.
 *
 * Dapp bir islemi belirli bir `from` adresi icin istiyor; imzalayan hesap o adres
 * OLMALI. Aksi halde kullanicinin baska bir hesabinin fonlari, kendisinin baska bir
 * hesap icin onayladigini sandigi bir isleme harcanir.
 */
export function findAccountByAddress(vaults, address) {
    if (!Array.isArray(vaults) || typeof address !== 'string' || !address) return null

    const wanted = address.toLowerCase()
    for (const vault of vaults) {
        if (!vault || !Array.isArray(vault.accounts)) continue
        const found = vault.accounts.find(a => a?.address && a.address.toLowerCase() === wanted)
        if (found) return found
    }
    return null
}

/**
 * Hesabin private key'ini cikarir.
 *
 * Wallet.fromPhrase(mnemonic) HER ZAMAN m/44'/60'/0'/0/0 turetir; hesabin kendi
 * derivationPath/index'i yok sayilirsa kullaniciya BASKA bir hesabin anahtari
 * verilir. Turetilen adres hesabin adresiyle karsilastirilarak bu dogrulanir.
 */
export async function exportAccountPrivateKey(masterKey, vaults, account) {
    const vault = findVaultForAccount(vaults, account)
    if (!vault) throw new Error('ACCOUNT_VAULT_NOT_FOUND')

    const privateKey = await extractPrivateKey(masterKey, vault, account)

    if (account.address) {
        const derivedAddress = new Wallet(privateKey).address
        if (derivedAddress.toLowerCase() !== account.address.toLowerCase()) {
            throw new Error('DERIVED_ADDRESS_MISMATCH')
        }
    }

    return privateKey
}

async function extractPrivateKey(masterKey, vault, account) {
    // TON hesabinin EVM ozel anahtari YOKTUR (2026-09-05 tasarim belgesi, R3).
    //
    // Kapi olmadan akis asagi duserdi: imported/privateKey kapisi TON'u gecirmez,
    // `unlockVault` 24 kelimelik TON ifadesini doner ve `secret.includes(' ')`
    // DOGRUDUR. Siradan bir TON ifadesinde `HDNodeWallet.fromPhrase` BIP39
    // sagalamasinda patlar, ama ~1/500 CIFT GECERLI ifadede BASARILI olur ve TON
    // ifadesinden bir EVM anahtari dogar -- kurtarilabilir ama sema karismasi.
    //
    // exportAccountPrivateKey'in :64-69'daki adres kontrolu bizi yalnizca KAZA
    // kurtariyor (`account.address` bir `UQ...` dizesi oldugu icin kiyas tutmuyor);
    // bir refactor uzakligindaki bir kazaya guvenilmez. Kemer ve askı: EditAccount
    // dugmeyi zaten gizliyor, `createWalletInstance` de background.js:413'te
    // "Invalid account type" firlatiyor.
    if (account?.type === 'ton') throw new Error('TON_ACCOUNT_NO_EVM_KEY')

    // Ice aktarilmis hesap: sir ya hesabin kendi importedSecret'inda, ya da kasa
    // dogrudan bir private key kasasiysa kasanin icinde.
    if (account.type === 'imported' || account.type === 'privateKey') {
        if (account.importedSecret) {
            return await decryptSecret(account.importedSecret, masterKey, vault.id)
        }
        if (vault.type === 'privateKey') {
            return await unlockVault(masterKey, vault)
        }
        throw new Error('IMPORTED_SECRET_NOT_FOUND')
    }

    const secret = await unlockVault(masterKey, vault)

    // Kasa mnemonic degil, dogrudan private key tutuyor olabilir.
    if (!secret.includes(' ')) return secret

    const derivationPath = account.derivationPath || `m/44'/60'/0'/0/${account.index ?? 0}`
    return HDNodeWallet.fromPhrase(secret, null, 'm').derivePath(derivationPath).privateKey
}
