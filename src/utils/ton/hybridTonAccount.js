/**
 * TON ice aktarmanin kurulumu: IKI kasa, TEK hesap.
 *
 * Kullanici bir Tonkeeper ifadesi ice aktardiginda uretilen sey TON'a kilitli bir
 * hesap DEGIL, siradan bir HD hesabidir: EVM adresi vardir, kopru ve dapp aciktir.
 * Tek fark, TON tarafinin BASKA bir kasadan gelmesi - bag `account.tonFingerprint`.
 *
 * EVM kasasi RASTGELE bir ifadeden degil, TON ifadesinden TURETILEN bir BIP39
 * ifadesinden dogar (evmFromTon.js). Rastgele olsaydi kullanicinin yedeklemesi
 * gereken IKI BAGIMSIZ ifade olurdu ve yalnizca Tonkeeper ifadesini saklayan
 * kullanici EVM parasini kaybederdi. Turetilmis ifadede Tonkeeper ifadesi TEK
 * BASINA ikisini de geri getirir.
 *
 * BU DOSYA DEPOYA YAZMAZ. Nesneleri uretir; cagiran onlari kendi `vaults` dizisine
 * ekler. KURAL: IKI KASA AYNI YAZIMDA gitmeli. Kasalar ayri `set` cagrilarina
 * bolunseydi, ikincisi patladiginda kullanici TON kasasi olan ama EVM kasasi
 * olmayan bir ara durumda kalirdi - ve o durumu duzeltecek hicbir akis yok.
 *
 * Kural kasalar icindir, cagirinin TUM yazimlari icin degil. ImportPhrases.vue tek
 * `set` yapiyor; CreatePassword2.vue ikinci bir `set` ile `active_account` yaziyor.
 * Bu ikincisi anlatilan tehlike DEGIL: iki kasa da ilk yazimda diske inmis oluyor,
 * kaybolabilecek tek sey aktif hesap secimi ve o zaten kurtarilabilir (hesaplar
 * kasalarda duruyor). Ayni desen butun onboarding dallarinda var.
 *
 * TEK ISTISNA: 'linked' dalinda `existingVaults` icindeki kasa YERINDE degistirilir
 * (damgalama). Cagiran ZATEN o diziyi yaziyor; kopya uretmek, cagiranin hangi
 * kopyayi yazacagi sorusunu doguruodu.
 */
import { HDNodeWallet } from 'ethers'
import { createVault, createTonVault } from '../crypto-utils'
import { uniqueKey } from '../uniqueKey'
import { deriveSolanaAddress } from '../solana/derive'
import { evmMnemonicFromTonMnemonic } from './evmFromTon'
import { tonKeyPairFromTonMnemonic } from './tonMnemonic'
import { tonWalletAddress } from './tonAccount'
import { toFriendlyTon } from './tonAddress'
import { TON_SCHEME } from './tonIdentity'

// Deponun her yerinde kullanilan varsayilan EVM yolu (CreatePassword2.vue,
// CreateAccount.vue). Farkli bir yol yazmak ayni ifadeden BASKA bir adres uretirdi.
const EVM_PATH = "m/44'/60'/0'/0/0"

/**
 * @param {CryptoKey} masterKey oturum ana anahtari
 * @param {string} tonMnemonic ice aktarilan TON ifadesi
 * @param {{ name: string, existingVaults?: object[] }} opts
 * @returns {Promise<{status:'created',tonVault,evmVault,account}|{status:'linked',tonVault,account}>}
 * @throws {Error} TON_MNEMONIC_INVALID — TON ifadesi gecersiz
 * @throws {Error} TON_VAULT_ALREADY_IMPORTED — bu TON kasasi zaten var
 */
export async function buildHybridTonAccount(masterKey, tonMnemonic, { name, existingVaults = [] }) {
    // Gecersiz ifade BURADA firlar, hicbir kasa kurulmadan once.
    const keyPair = await tonKeyPairFromTonMnemonic(tonMnemonic)
    const tonAddress = toFriendlyTon(tonWalletAddress(keyPair.publicKey))

    // §6.1: TON kasasi hesap TASIMAZ. `createTonVault` gecirilen nesneyi
    // `accounts` dizisine koyup uzerine fingerprint yaziyor; atilacak bir nesne
    // veriyoruz ve diziyi bosaltiyoruz. Hesap iki kasada birden bulunsaydi
    // findVaultForAccount EVM yolunda TON kasasini acabilirdi.
    const tonVault = await createTonVault(masterKey, tonMnemonic, {})
    tonVault.accounts = []

    const vaults = Array.isArray(existingVaults) ? existingVaults : []

    if (vaults.some((v) => v?.fingerprint === tonVault.fingerprint)) {
        throw new Error('TON_VAULT_ALREADY_IMPORTED')
    }

    const phrase = await evmMnemonicFromTonMnemonic(tonMnemonic)
    const wallet = HDNodeWallet.fromPhrase(phrase)

    // Solana TURETILMIS BIP39 ifadesinden cikar, TON ifadesinden DEGIL.
    // bip39.mnemonicToSeed bir TON ifadesini de KABUL EDER (saf PBKDF2, saglama
    // yok) ve Phantom/Solflare'in hic uretmeyecegi bir adres uretirdi.
    //
    // deriveSolanaAddress duz string DEGIL { address, publicKey } doner.
    // Hesap kaydina base58 ADRES yazilir; publicKey hex'ine burada ihtiyac yok.
    const { address: solanaAddress } = await deriveSolanaAddress(phrase, 0)

    const account = {
        name,
        type: 'hd',
        derivationPath: EVM_PATH,
        index: 0,
        address: wallet.address,
        solanaAddress,
        tonAddress,
        tonFingerprint: tonVault.fingerprint,
        createdAt: new Date().toISOString(),
        key: uniqueKey(),
    }

    // Parmak izi ancak kasa kurulunca biliniyor. `createVault` saf bir uretici -
    // depoya dokunmuyor, o yuzden kurup atmak guvenli.
    const evmVault = await createVault(masterKey, phrase, account)

    const existing = vaults.find((v) => v?.fingerprint === evmVault.fingerprint)
    if (!existing) {
        return { status: 'created', tonVault, evmVault, account }
    }

    // Kullanici turetilmis BIP39 ifadesini AYRICA elle ice aktarmis. Iki ifade
    // AYNI cuzdandir: yeni bir hesap uretmek ayni adresi ikinci kez, ikinci hesap
    // olarak gosterirdi ve kullanici birinden harcayinca digeri de bosalirdi.
    // Var olan hesabin uzerine TON tarafini DAMGALIYORUZ.
    const stored = Array.isArray(existing.accounts)
        ? existing.accounts.find((a) => a?.index === 0)
        : null

    if (stored) {
        stored.tonAddress = tonAddress
        stored.tonFingerprint = tonVault.fingerprint
        stored.tonScheme = TON_SCHEME

        // TESTNET ONBELLEGI DUSER. Hesabin TON SEMASI degisti (turetilmis ifade
        // -> ice aktarilan Tonkeeper ifadesi), yani eski `tonAddressTestnet`
        // artik BASKA bir anahtarin adresi. Birakilsaydi kullanici TON
        // Testnet'e gecince ekranda yanlis adres gorur ve her imza
        // TON_ADDRESS_MISMATCH ile KALICI olarak reddedilirdi -- mainnet
        // duzelirken testnet sessizce kirik kalirdi.
        //
        // Silmek guvenli: `ensureTonAddress` alani bir sonraki testnet
        // ziyaretinde yeni semadan yeniden doldurur.
        delete stored.tonAddressTestnet
        // Var olan hesap turetilmis ifadeyle ZATEN kurulmus olabilir; alan bossa
        // doldur, doluysa DOKUNMA (ayni ifadeden ayni adres cikar, ama var olan
        // degeri ezmek gereksiz bir yazim yarisi acar).
        if (!stored.solanaAddress) stored.solanaAddress = solanaAddress
        return { status: 'linked', tonVault, account: stored }
    }

    // Kasa var ama index:0 hesabi yok. Hesap normal yoldan uretilip O kasanin
    // dizisine eklenir - §6.1 yine tek kasa.
    if (!Array.isArray(existing.accounts)) existing.accounts = []
    existing.accounts.push(account)
    return { status: 'linked', tonVault, account }
}
