/**
 * Yeni bir HD hesap olusturulurken TON adresini hesaplar.
 *
 * TEK YER: `CreateAccount.vue` ve `CreatePassword2.vue` ikisi de burayi cagirir.
 * Turetme .vue dosyalarinda tekrarlansaydi ikisi zamanla sapardi ve sapma YANLIS
 * ADRES olarak gorunurdu.
 *
 * NEDEN OLUSTURMA ANINDA: ana anahtar zaten acik ve `vaults` zaten yaziliyor.
 * Turetme sonraya birakilsaydi `ensureTonAddress`in bas yorumunda anlatilan
 * KAYIP-GUNCELLEME yarisina girilirdi.
 *
 * MAINNET adresi uretir. Testnet alani (`tonAddressTestnet`) ag degisince
 * `ensureTonAddress` tarafindan doldurulur -- olusturma aninda kullanicinin hangi
 * agda calisacagi bilinmiyor.
 */
import { deriveTonAccount } from './tonAccount'
import { TON_SCHEME } from './tonIdentity'

/**
 * @param {string} masterMnemonic kasanin BIP39 ifadesi
 * @param {number} index hesap indeksi
 * @returns {Promise<string>} friendly (UQ...) mainnet W5 adresi
 * @throws {Error} TON_INDEX_INVALID — gecersiz index
 */
export async function tonAddressForNewAccount(masterMnemonic, index) {
    const { friendly } = await deriveTonAccount(masterMnemonic, { index }, {
        testnet: false,
        secretKind: 'derivedTonMnemonic',
        vaultType: 'hd',
    })
    return friendly
}

/**
 * Yeni hesap kaydina yazilacak TON alanlari -- TEK YER.
 *
 * Damga (`tonScheme`) ADRESLE BIRLIKTE yazilmali: `ensureTonAddress` damgasiz
 * bir `tonAddress`i eski SLIP-10 semasi sayip yeniden turetir (bkz.
 * tonIdentity.js:TON_SCHEME). Damgasiz dogan bir hesap her acilista bosuna
 * yeniden turetilir ve `tonAddressLegacy`sine kendi dogru adresini yazardi.
 *
 * @param {string} masterMnemonic
 * @param {number} index
 * @returns {Promise<{tonAddress: string, tonScheme: string}>}
 */
export async function tonFieldsForNewAccount(masterMnemonic, index) {
    return {
        tonAddress: await tonAddressForNewAccount(masterMnemonic, index),
        tonScheme: TON_SCHEME,
    }
}
