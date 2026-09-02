// Hesabin TON kimligi: kasadan sirri cikar, ed25519 anahtari ve W5 adresini uret.
//
// Sir cikarma, deriveAccount.js:extractPrivateKey ile AYNI onceligi izler:
//   1) hesabin kendi importedSecret'i
//   2) kasa dogrudan bir ozel anahtar kasasiysa kasanin icerigi
//   3) HD kasa -> mnemonic
// Bu sira BOZULURSA yanlis kasanin sirri acilir ve kullaniciya BASKA bir hesabin
// TON adresi gosterilir.
//
// ANAHTAR DISKE YAZILMAZ: `ensureTonAddress` yalnizca ADRESI (public bilgi) kaydeder.

import { unlockVault, decryptSecret } from '../crypto-utils'
import { findVaultForAccount } from '../deriveAccount'
import { requireSessionMasterKey } from '../masterKey'
import { deriveTonAccount } from './tonAccount'

// Kasa tipi -> turetme semasi. TEK KAYNAK: vault.type.
//
// Hesap kaydina ikinci bir kopya yazilmiyor - iki kaynak, birbirinden sapabilecek
// iki gercek demektir ve sapma bu dosyada YANLIS ADRES olarak gorunur.
export function secretKindForVault(vault) {
    if (vault?.type === 'tonMnemonic') return 'tonMnemonic'
    // 'hd' ve 'privateKey' kasalari BUGUNKU sezgiye birakilir: diskte duran her
    // mevcut TON adresi o davranisa bagli.
    return undefined
}

/**
 * Hesabin TON kasasini bulur.
 *
 * Hibrit hesap (TON ifadesinden ice aktarilmis) EVM kasasinin `accounts`
 * dizisinde yasar - EVM yolu onu orada bulur ve hic degismez. TON tarafi ise
 * BASKA bir kasadan gelir; bag `account.tonFingerprint` ile kurulur.
 *
 * Bag kurulamiyorsa FIRLATIR, `findVaultForAccount`a DUSMEZ. Duseydi hibrit bir
 * hesabin TON adresi sessizce EVM kasasindan turetilir ve kullaniciya A adresi
 * gosterilirken B'nin anahtariyla imzalanirdi - background.js:290'da yazili kaza.
 *
 * `tonFingerprint` YOKSA bugunku davranis aynen korunur: diskte duran her
 * type:'ton' hesabin adresi ona bagli.
 */
export function tonVaultForAccount(vaults, account) {
    if (account?.tonFingerprint) {
        const vault = Array.isArray(vaults)
            ? vaults.find((v) => v?.fingerprint === account.tonFingerprint)
            : null
        if (!vault) throw new Error('TON_VAULT_NOT_FOUND')
        return vault
    }
    return findVaultForAccount(vaults, account)
}

export async function tonSecretForAccount(masterKey, vaults, account) {
    const vault = tonVaultForAccount(vaults, account)
    if (!vault) throw new Error('ACCOUNT_VAULT_NOT_FOUND')

    // TON kasasinda importedSecret kavrami yoktur ve kasa tipi 'privateKey'
    // dallarindan hicbirine uymaz: sir dogrudan kasanin kendisidir.
    if (vault.type === 'tonMnemonic') return await unlockVault(masterKey, vault)

    if (account?.importedSecret) {
        return await decryptSecret(account.importedSecret, masterKey, vault.id)
    }

    if (account?.type === 'imported' || account?.type === 'privateKey') {
        if (vault.type === 'privateKey') return await unlockVault(masterKey, vault)
        throw new Error('IMPORTED_SECRET_NOT_FOUND')
    }

    return await unlockVault(masterKey, vault)
}

export async function tonIdentityForAccount(masterKey, vaults, account, opts = {}) {
    // Kasa BURADA da bulunuyor cunku turetme semasini belirleyen sey o.
    // `tonSecretForAccount` de ayni aramayi yapiyor; iki cagri ayni sonucu
    // verir (findVaultForAccount saftir) ve kasayi buradan asagi TASIMAK,
    // sirri yukari tasimaktan daha az riskli.
    //
    // `tonVaultForAccount` hibrit hesapta TON kasasini, digerlerinde bugunku
    // kasayi doner. IKI cagiran da AYNI fonksiyonu kullanmali: ayri cozumleme
    // yazilirsa sir bir kasadan, sema baska bir kasadan gelir ve
    // TON_SECRET_KIND_MISMATCH ya da (daha kotusu) sessiz yanlis adres dogar.
    const vault = tonVaultForAccount(vaults, account)
    if (!vault) throw new Error('ACCOUNT_VAULT_NOT_FOUND')

    const secret = await tonSecretForAccount(masterKey, vaults, account)

    return await deriveTonAccount(secret, account, {
        testnet: opts.testnet ?? false,
        secretKind: secretKindForVault(vault),
        // Kasa tipi HAM haliyle de geciyor: `deriveTonAccount` icindeki §6 capraz
        // kontrolu bunu `secretKind` ile karsilastirip uyusmazsa
        // TON_SECRET_KIND_MISMATCH atiyor. Iki degeri de AYNI kasadan verdigimiz
        // icin burada uyusmazlik olamaz - kapinin isi, YARIN eklenecek bir
        // cagiranin (ya da bu satirdaki bir "sadelestirmenin") sessizce yanlis
        // semayi secmesini imkansiz kilmak.
        vaultType: vault?.type,
    })
}

/**
 * Aktif hesabin TON adresini dondurur; kayitli degilse turetip DISKE yazar.
 * Kasa kilitliyse `requireSessionMasterKey` WALLET_LOCKED atar — cagiran taraf
 * bunu "kilitli" olarak gostermeli, sessizce yutmamali.
 */
export async function ensureTonAddress(account, opts = {}) {
    // Onbellek alani AGA GORE ayrilir. Tek bir `tonAddress` alani, hangi ag once
    // turetirse onu kalici kazandiriyordu: testnet'te arayuz mainnet adresini
    // gosterirken background testnet sozlesmesiyle imzaliyordu. `tonAddress` alani
    // GERIYE DONUK UYUM icin mainnet'in takma adi olarak korunur — eski kayitlarda
    // o alan doludur ve silinirse kullanicinin adresi bir anda "hazirlaniyor"a duser.
    const cacheField = opts.testnet ? 'tonAddressTestnet' : 'tonAddress'
    if (account?.[cacheField]) return account[cacheField]

    const masterKey = await requireSessionMasterKey()

    // Turetme icin bir kopya yeterli: PBKDF2 (mnemonic->seed, 2048 tur) + SLIP-0010
    // turetmesi onlarca milisaniye surebilir. Bu sure boyunca `vaults`'u BASKA bir
    // ekran (hesap ekleme/silme, ad degistirme, sifre degisimi) yazabilir; asagida
    // AYNI diziyi geri yazarsak o degisiklik sessizce kaybolur (lost update).
    //
    // Kalici cozum `vaults` yazimlarinin tumunu (EditAccountName.vue, CreateAccount.vue,
    // ImportPhrases.vue, ImportPrivate.vue, CreatePassword.vue'de tekrarlanan ayni
    // korumasiz read-modify-write) txStorage.js'deki kuyruga tasimak olur — bu TON
    // gorevinin kapsami disinda, sistemik bir refactor gerektirir. Burada yapilan
    // yalnizca YARIS PENCERESINI daraltmak: turetme BITTIKTEN SONRA, yazmadan hemen
    // once TAZE bir `vaults` kopyasi okunur ve mutasyon o kopya uzerinde yapilir.
    const { vaults } = await chrome.storage.local.get('vaults')
    const { friendly } = await tonIdentityForAccount(masterKey, vaults, account, opts)

    const fresh = await chrome.storage.local.get(['vaults', 'active_account'])
    const freshVaults = fresh.vaults
    const freshActiveAccount = fresh.active_account

    // Kasadaki hesap kaydina yaz: ManageAccounts/Header buradan okuyor.
    const vault = findVaultForAccount(freshVaults, account)
    const stored = vault?.accounts?.find(
        (a) => (a.key && account.key && a.key === account.key) ||
            (a.address && account.address && a.address.toLowerCase() === account.address.toLowerCase())
    )

    // Taze okumada hesap/kasa bulunamadi (turetme sirasinda kasa silinmis, hesap
    // kaldirilmis olabilir): kullanici adresini yine de gorsun, ama artik var
    // olmayan bir kayda yazma denemesi yapilmasin.
    if (!stored) return friendly

    stored[cacheField] = friendly

    const updates = { vaults: freshVaults }

    // active_account kasadaki kaydin DISKTEKI BIR KOPYASI (crypto-utils.js:syncActiveAccount
    // notu). Guncellenmezse Header her acilista yeniden turetir.
    if (freshActiveAccount && (
        (freshActiveAccount.key && account.key && freshActiveAccount.key === account.key) ||
        (freshActiveAccount.address && account.address &&
            freshActiveAccount.address.toLowerCase() === account.address.toLowerCase())
    )) {
        updates.active_account = { ...freshActiveAccount, [cacheField]: friendly }
    }

    await chrome.storage.local.set(updates)
    return friendly
}
