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

import { accountHasTon } from '../accountKind'
import { unlockVault, decryptSecret } from '../crypto-utils'
import { requireSessionMasterKey } from '../masterKey'
import { deriveTonAccount } from './tonAccount'
import { findVaultForAccount } from '../deriveAccount'
import {
    TON_SCHEME,
    tonAddressIsCurrentScheme,
    secretKindForVault,
    tonVaultForAccount,
    tonSignerReady,
} from './tonVaultResolve'

// Kasa/sema cozumlemesi tonVaultResolve.js'e TASINDI -- agir import zincirini
// popup'a cekmemek icin (gerekce orada yazili). Buradan YENIDEN DISA AKTARILIYOR:
// mevcut cagiranlarin tek satiri degismedi.
export { TON_SCHEME, tonAddressIsCurrentScheme, secretKindForVault, tonVaultForAccount, tonSignerReady }

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
    // HESAP KAPISI — TURETMENIN TEK BOGAZI.
    //
    // Bir hesabin TON cuzdani ya VARDIR (type:'ton') ya YOKTUR. "Henuz
    // turetilmedi" diye ucuncu bir durum yok: TON hesabinin iki adresi de
    // olusturma aninda yazilir. Kapi FAIL-CLOSED — tipi bilinmeyen hesap da
    // reddedilir; bilinmeyen bir kayittan anahtar uretmek, kapatilmak istenen
    // sessiz turetmenin ta kendisi.
    //
    // Kapi KASADAN ONCE: reddedilen hesap icin kasa hic acilmaz, sir hic cozulmez.
    if (!accountHasTon(account)) throw new Error('TON_ACCOUNT_REQUIRED')

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

    // INV-1 DEFANS-DERINLIGI — SIR COZULMEDEN reddedilir.
    //
    // type:'ton' hesap TANIM GEREGI kendi tonMnemonic kasasinin icinde yasar
    // (bkz. accountKind.js). 2026-09-10 ONCESINDE bu kontrolu dolayli olarak
    // `secretKindForVault` yapiyordu -- yalnizca 'tonMnemonic' kasasini
    // geciriyordu, yani 'hd' bir kasaya yanlislikla dusen bir type:'ton' hesap
    // orada FIRLATIYORDU. Artik 'hd' kasasi da GECERLI bir TON kaynagi (HD
    // hesaplarin kendi turetilmis semasi icin), yani o dolayli koruma kalkti.
    //
    // Kontrol BURADA, acikca ve ERKEN: `tonSecretForAccount`tan (kasayi ACAN,
    // `unlockVault` cagiran fonksiyon) ONCE. Dusseydi bozuk bir kayit (type:'ton'
    // hesap + 'hd' kasa) hd kasasinin mnemonic'ini TON turetmesine sokar ve
    // SESSIZCE yanlis (ama gecerli gorunumlu) bir adres uretirdi -- INV-1'in tam
    // olarak onlemek istedigi kaza.
    if (account?.type === 'ton' && vault?.type !== 'tonMnemonic') {
        throw new Error('TON_VAULT_TYPE_INVALID')
    }

    // `secretKindForVault` de KASA ACILMADAN ONCE degerlendirilir (FIX 7).
    // Eskiden asagidaki `deriveTonAccount` cagrisinin bir ARGUMANIYDI, yani
    // JS'in soldan-saga argüman degerlendirme sirasi geregi `tonSecretForAccount`
    // TAMAMLANDIKTAN SONRA calisiyordu. Bu dosyanin kendi iddiasi "reddedilen
    // hesap icin kasa hic acilmaz, sir hic cozulmez" sadece yukaridaki INV-1
    // kontrolu icin degil BURASI icin de dogru olmali - defans derinligi.
    const secretKind = secretKindForVault(vault)

    const secret = await tonSecretForAccount(masterKey, vaults, account)

    const identity = await deriveTonAccount(secret, account, {
        testnet: opts.testnet ?? false,
        secretKind,
        // Kasa tipi HAM haliyle de geciyor: `deriveTonAccount` icindeki §6 capraz
        // kontrolu bunu `secretKind` ile karsilastirip uyusmazsa
        // TON_SECRET_KIND_MISMATCH atiyor. Iki degeri de AYNI kasadan verdigimiz
        // icin burada uyusmazlik olamaz - kapinin isi, YARIN eklenecek bir
        // cagiranin (ya da bu satirdaki bir "sadelestirmenin") sessizce yanlis
        // semayi secmesini imkansiz kilmak.
        vaultType: vault?.type,
    })

    // ADRES CAPRAZ KONTROLU — risk defteri R2.
    //
    // Saklanan `tonAddress` artik diskten OKUNUYOR ama imzalama hala TURETIYOR.
    // Elle duzenlenmis bir kayit ya da ileride yazilan bir goc ozdesligi bozarsa
    // kullaniciya A adresi gosterilir, B'nin anahtariyla imzalanir.
    //
    // Alan BOSSA kontrol ATLANIR, firlatilmaz: eski type:'ton' kayitlarda
    // `tonAddressTestnet` hic yazilmadi ve bos bir alani "uyusmazlik" saymak,
    // R2'yi kapatmak icin R5'i acmak olurdu. Kontrol YALNIZCA YANLISI yakalar,
    // EKSIGI degil; eksigi kapatan sey olusturma-anindaki altin vektorlerdir.
    const cacheField = (opts.testnet ?? false) ? 'tonAddressTestnet' : 'tonAddress'
    const stored = account?.[cacheField]

    // DAMGASIZ kayitta fark BEKLENIR, hata DEGIL: o adres eski SLIP-10
    // semasindan gelmis (bkz. TON_SCHEME). Firlatmak, main'den gelen her
    // kullanicinin TON'unu tumden olduren sey olurdu. `ensureTonAddress`
    // o kaydi yeniden turetip damgalar ve eskisini tonAddressLegacy'ye tasir.
    if (stored && stored !== identity.friendly && tonAddressIsCurrentScheme(account)) {
        throw new Error('TON_ADDRESS_MISMATCH')
    }

    return identity
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

    // ONBELLEK YALNIZCA DAMGALIYSA GECERLI. Damgasiz bir `tonAddress` eski
    // SLIP-10 semasindan gelmistir (bkz. TON_SCHEME): dondurulseydi arayuz
    // artik imzalanamayan bir adres gosterirdi. Yeniden turetilir, damgalanir
    // ve eskisi `tonAddressLegacy` altinda SAKLANIR -- silinmez, cunku
    // kullanicinin orada fonu olabilir ve index > 0'daki eski adres hicbir
    // cuzdanda ifadeyle acilamaz (Tonkeeper'in BIP-39 yolu index 0'a sabittir).
    if (account?.[cacheField] && tonAddressIsCurrentScheme(account)) {
        return account[cacheField]
    }

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

    // Eski semadan gelen adresi KAYBETME: uzerine yazmadan once tasi.
    // `tonAddressLegacy` bir kez yazilir ve bir daha DOKUNULMAZ -- ikinci bir
    // gecis onu kendi urettigimiz adresle ezerdi.
    if (stored[cacheField] && stored[cacheField] !== friendly &&
        !tonAddressIsCurrentScheme(stored) && !stored.tonAddressLegacy) {
        stored.tonAddressLegacy = stored[cacheField]
    }

    stored[cacheField] = friendly
    stored.tonScheme = TON_SCHEME

    const updates = { vaults: freshVaults }

    // active_account kasadaki kaydin DISKTEKI BIR KOPYASI (crypto-utils.js:syncActiveAccount
    // notu). Guncellenmezse Header her acilista yeniden turetir.
    if (freshActiveAccount && (
        (freshActiveAccount.key && account.key && freshActiveAccount.key === account.key) ||
        (freshActiveAccount.address && account.address &&
            freshActiveAccount.address.toLowerCase() === account.address.toLowerCase())
    )) {
        updates.active_account = {
            ...freshActiveAccount,
            [cacheField]: friendly,
            tonScheme: TON_SCHEME,
            ...(stored.tonAddressLegacy ? { tonAddressLegacy: stored.tonAddressLegacy } : {}),
        }
    }

    await chrome.storage.local.set(updates)
    return friendly
}
