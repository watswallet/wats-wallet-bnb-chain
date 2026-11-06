/**
 * HD (BIP39) hesap kaydi kurma -- TEK TUREME YERI.
 *
 * Uc yol ayni fonksiyonu kullanir: "hesap ekle" (CreateAccount.vue), ilk kurulum
 * (CreatePassword2.vue) ve seed import'u (ImportPhrases.vue). Turetme her .vue
 * dosyasinda ayri yazilsaydi zamanla sapardi ve sapma YANLIS ADRES / ayri bicimli
 * hesap kaydi olarak gorunurdu (ayni seed'den iki yolda iki farkli hesap nesnesi).
 *
 * TON alanlari (`tonAddress`, `tonScheme`) hesap OLUSTURULURKEN, adresle birlikte
 * yazilir: ana anahtar zaten acik ve `vaults` zaten yaziliyor. Sonraya birakilsaydi
 * `ensureTonAddress`in kayip-guncelleme yarisina girilirdi; ayrintisi icin
 * `ton/newAccountTonAddress.js` basligina bak. Turetme yavas olabilir (bos makinede
 * ~0.3 s, yuklu makinede saniyeler), bu yuzden baska bir senkron akisin icine
 * KONMAZ.
 */
import { HDNodeWallet } from 'ethers'
import { createVault } from './crypto-utils'
import { uniqueKey } from './uniqueKey'
import { tonFieldsForNewAccount } from './ton/newAccountTonAddress'

// MetaMask / Trust Wallet yolu: sabit onek, son bilesen hesap indeksi.
export const HD_BASE_PATH = "m/44'/60'/0'/0"

export function hdPath(index) {
    return `${HD_BASE_PATH}/${index}`
}

/** Tum kasalardaki toplam hesap sayisi. `accounts`i olmayan kasa 0 sayilir. */
export function countAccounts(vaults) {
    let total = 0
    if (vaults) {
        for (const vault of vaults) {
            total += vault.accounts ? vault.accounts.length : 0
        }
    }
    return total
}

/**
 * Varsayilan hesap adi: "<Wats> <tum kasalardaki hesap sayisi + 1 + offset>".
 * `offset`, ayni anda birden cok hesap eklenirken siradaki adlari uretmek icin.
 */
export function defaultAccountName(t, vaults, offset = 0) {
    return `${t('settings.createAccount.account_default')} ${countAccounts(vaults) + 1 + offset}`
}

/**
 * Tek bir HD hesap kaydi kurar. Alan sirasi ve kume "hesap ekle"nin eski
 * literaliyle BIREBIR aynidir; `fingerprint` degeri `undefined` olsa da anahtar
 * nesnede bulunur.
 *
 * @param {string} mnemonic BIP39 ifadesi (kirpilarak kullanilir)
 * @param {number} index hesap indeksi
 * @param {{name?: string, fingerprint?: string}} [opts]
 */
export async function buildHdAccount(mnemonic, index, opts = {}) {
    const { name = '', fingerprint } = opts
    const phrase = mnemonic.trim()
    const path = hdPath(index)

    // Ethers v6 icin en guvenli turetme yontemi (yol dogrudan verilir).
    const wallet = HDNodeWallet.fromPhrase(phrase, '', path)

    const tonFields = await tonFieldsForNewAccount(phrase, index)

    return {
        address: wallet.address,
        createdAt: new Date().toISOString(),
        derivationPath: path,
        index,
        fingerprint,
        name,
        type: 'hd',
        ...tonFields,
        key: uniqueKey(),
    }
}

/**
 * Indeks 0..count-1 icin hesap kayitlari, SIRAYLA (TON turetmesi agir; paralel
 * calistirmak yuklu makinede her seyi ayni anda bogar). Adlar bos birakilir,
 * `assembleHdVault` verir.
 */
export async function buildHdAccounts(mnemonic, count) {
    const accounts = []
    for (let i = 0; i < count; i++) {
        accounts.push(await buildHdAccount(mnemonic, i, { name: '' }))
    }
    return accounts
}

/**
 * Hesaplardan tek bir HD kasasi kurar (yazmaz, yalnizca nesneyi dondurur).
 *
 * - Adlar `defaultAccountName(t, existingVaults, i)` ile verilir: mevcut kasalardaki
 *   hesaplardan sonra devam eder.
 * - `createVault` ilk hesabin parmak izini yerinde yazar; kalan hesaplar da kasanin
 *   parmak izini alir (hepsi ayni seed'den).
 *
 * @throws {Error} `accounts` bossa
 */
export async function assembleHdVault({ masterKey, mnemonic, accounts, existingVaults, t }) {
    if (!accounts || accounts.length === 0) {
        throw new Error('HD_VAULT_NO_ACCOUNTS')
    }

    accounts.forEach((account, i) => {
        account.name = defaultAccountName(t, existingVaults, i)
    })

    const vault = await createVault(masterKey, mnemonic, accounts[0])
    for (const account of accounts.slice(1)) {
        account.fingerprint = vault.fingerprint
    }
    vault.accounts = accounts

    return vault
}
