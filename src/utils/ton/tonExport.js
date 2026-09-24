// TON anahtarini disa aktarma.
//
// ESKI GEREKCE GECERSIZ (olculdu 2026-09-09). Bu dosya once soyle diyordu:
// "TON adresi mevcut tohumdan SLIP-0010 ile turetiliyor; ayni kelimeler
// Tonkeeper'a girildiginde BASKA bir adres cikar." Iki noktada da yanlisti:
//
//   1) Bu yoldan gecen hesaplarin semasi artik SLIP-10 DEGIL. Hepsi TON'un
//      KENDI mnemonic semasina dayanir -- Tonkeeper'in BIRINCIL semasi --,
//      dolayisiyla kelimeler oldugu gibi calisir.
//   2) BIP-39 durumunda bile "baska adres cikar" yanlisti. Tonkeeper'in
//      `resolveMnemonicType`i once TON-native'i dener, GECMEZSE BIP-39'a duser
//      ve `TON_DERIVATION_PATH = "m/44'/607'/0'"` ile AYNI SLIP-10 yolunu
//      kullanir. Ayni ifade, ayni adres.
//
// IKI KASA TIPI GELIR (2026-09-10'da degisti -- bu yorumun eski hali yalnizca
// 'tonMnemonic' geldigini soyluyordu ve artik YANLIS):
//
//   - `tonMnemonic` kasasi: kullanicinin ICE AKTARDIGI Tonkeeper ifadesi.
//   - `hd` kasasi: ana BIP-39 ifadesinden HESAP BASINA turetilmis TON ifadesi
//     (`secretKindForVault` -> 'derivedTonMnemonic').
//
// NEDEN HAM ANAHTAR HALA DONUYOR: ham ed25519 anahtari isteyen araclar var
// (tonlib tabanli CLI'lar, betikler) ve ifade her kasada gosterilmiyor (asagi bak).
//
// HICBIR YERE YAZILMAZ: cagiran taraf yalnizca ekranda gosterir.
import {
    tonIdentityForAccount,
    tonVaultForAccount,
    tonSecretForAccount,
    secretKindForVault,
} from './tonIdentity'
import { cachedTonMnemonicFromSeed } from './tonMnemonicCache'

/**
 * @returns {Promise<{secretKeyHex: string, friendly: string, mnemonic: string|null}>}
 *
 * `mnemonic` YALNIZCA hd kasasinda doludur: o hesabin TON ifadesi ana ifadeden
 * TURETILMISTIR ve kullanici onu baska HICBIR yerde goremez. tonMnemonic
 * kasasinda NULL doner -- oradaki ifade kullanicinin KENDI Tonkeeper ifadesidir
 * ve ShowPhrases ekraninda zaten gosteriliyor; ikinci bir yerde gostermek
 * "hangisi asil" sorusunu dogururdu.
 */
export async function exportTonKey(masterKey, vaults, account, opts = {}) {
    const { keyPair, friendly } = await tonIdentityForAccount(masterKey, vaults, account, opts)

    // Kasa/sema cozumlemesi `tonIdentityForAccount`in kullandigi AYNI
    // fonksiyonlarla yapilir. Ayri bir cozumleme yazilsaydi ifade bir kasadan,
    // adres baska bir kasadan gelebilir ve kullaniciya GOSTERILEN adresi ACMAYAN
    // kelimeler verilirdi -- sessiz ve geri donusu olmayan bir kaza.
    const vault = tonVaultForAccount(vaults, account)
    const secretKind = secretKindForVault(vault)

    let mnemonic = null
    if (secretKind === 'derivedTonMnemonic') {
        const secret = await tonSecretForAccount(masterKey, vaults, account)
        mnemonic = await cachedTonMnemonicFromSeed(secret, account?.index ?? 0)
    }

    return {
        secretKeyHex: Buffer.from(keyPair.secretKey).toString('hex'),
        friendly,
        mnemonic,
    }
}
