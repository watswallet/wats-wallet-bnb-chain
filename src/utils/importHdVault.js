/**
 * Mevcut cuzdana yeni bir HD kasasi ekler (seed import'u, "Cuzdan ekle" yolu).
 *
 * `vaults` iki kez okunur ve bu bilincli:
 *
 *  1) Ilk okuma yalnizca mukerrer seed'i ERKEN yakalamak ve hesap adlarini
 *     (mevcut hesap sayisindan devam eder) vermek icindir. Mukerrerse kasa kurmanin
 *     (anahtar turetme + sifreleme) hicbir anlami yok; hicbir sey yazilmaz.
 *  2) Ikinci okuma YAZIMDAN hemen once yapilir. Kasa kurulurken (`assembleHdVault`)
 *     ve cagirandaki yavas hesap turetme/tarama boyunca baska bir pencere ya da
 *     panel `vaults`'a kasa ekleyebilir. Ilk okumanin kopyasini yazsaydik o kasayi
 *     SESSIZCE EZERDIK (kullanici cuzdanini kaybetmis gibi gorur). Ikinci okumayla
 *     `set` arasinda hic `await` yoktur: aradaki pencere yalnizca depo gidis-donus
 *     suresi kadar daralir (chrome.storage atomik oku-degistir-yaz sunmaz, bu
 *     pencere tamamen SIFIRLANAMAZ; ama saniyelerce suren tarama/turetme suresi
 *     boyunca acik kalmasindan cok daha iyidir). Ikinci okumada mukerrer kontrolu
 *     tekrarlanir: araya giren yazim ayni seed'i eklemis olabilir.
 *
 * Yazim TEK `chrome.storage.local.set` ile yapilir: `vaults` ve `active_account`
 * birlikte yazilir, yarim yazim (kasa var ama aktif hesap eski) olusamaz. Yavas
 * is (`buildHdAccounts` ile hesap turetme) cagirandadir; burada yalnizca hizli
 * isler kalir ki iki okuma arasi pencere dar olsun.
 */
import { assembleHdVault } from './hdAccounts'

/**
 * @param {object} p
 * @param {CryptoKey} p.masterKey acik oturumun ana anahtari
 * @param {string} p.mnemonic BIP39 ifadesi (cagiran kirpilmis verir)
 * @param {string} p.fingerprint seed parmak izi (mukerrer kontrolu icin)
 * @param {object[]} p.accounts `buildHdAccounts` ile onceden kurulmus hesaplar (yerinde degistirilir)
 * @param {Function} p.t vue-i18n cevirisi (hesap adi onegi icin)
 * @returns {Promise<{status: 'added', vault: object, accounts: object[]} | {status: 'duplicate'}>}
 */
export async function addHdVaultToWallet({ masterKey, mnemonic, fingerprint, accounts, t }) {
    const { vaults = [] } = await chrome.storage.local.get('vaults')
    if (vaults.some((v) => v.fingerprint === fingerprint)) {
        return { status: 'duplicate' }
    }

    const vault = await assembleHdVault({ masterKey, mnemonic, accounts, existingVaults: vaults, t })

    // Taze okuma: yukaridaki `await`ler sirasinda baska pencere yazmis olabilir.
    // Bu satirla `set` arasina `await` KONMAZ.
    const { vaults: fresh = [] } = await chrome.storage.local.get('vaults')
    if (fresh.some((v) => v.fingerprint === fingerprint)) {
        return { status: 'duplicate' }
    }

    await chrome.storage.local.set({
        vaults: [...fresh, vault],
        active_account: vault.accounts[0],
    })

    return { status: 'added', vault, accounts: vault.accounts }
}
