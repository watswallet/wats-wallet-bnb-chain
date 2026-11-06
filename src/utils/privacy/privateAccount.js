import { HDNodeWallet } from 'ethers'
import { unlockVault } from '../crypto-utils'
import { findVaultForAccount } from '../deriveAccount'

// Gizli Hesap'in turetme yolu (spec 5.3). BIP44 change dali: projedeki tum EVM
// hesaplari m/44'/60'/0'/0/i kullanir, yani "hesap ekle" bu dala ASLA denk gelmez.
// Turetme deterministik: seed ile geri yuklenen cuzdan ayni hesabi geri bulur.
export const PRIVATE_ACCOUNT_PATH = "m/44'/60'/0'/1/0"

export function isPrivateAccount(account) {
    return account?.private === true
}

// POPUP'IN TEK "simdi Gizli mi" KARARI (gizli-mod cok-ag Dilim D, PF-DD2 ve PF-DD11). Karar HESAP tabanlidir: depodaki
// aktif hesap Gizliyse Gizli. Okunabilir hesap yoksa popup'in gizlilik store'una (`storeActive`) dusulur. Store,
// `user.address` izleyicisinin gerisinde kalabilir (gizlilik senkronu ayri bir storage.onChanged dinleyicisidir); bu yuzden
// ag/fiyat/Solana/Hisseler kapilari store'a degil bu karara bakar.
export function privateNowOf(account, storeActive) {
    return account ? isPrivateAccount(account) : storeActive === true
}

// Ayni karar, depodan TAZE okunan aktif hesapla. Okuma basarisizsa Gizli sayilir (KAPALI-BASARISIZ: istek atilmaz).
export async function readPrivateNow(storeActive) {
    try {
        const { active_account } = await chrome.storage.local.get('active_account')
        return privateNowOf(active_account, storeActive)
    } catch (error) {
        return true
    }
}

// Gizli Hesap kasanin `accounts` dizisinde DEGIL, `privateAccount` alaninda durur
// (spec 5.3): hesap listelerinin hicbiri onu varsayilan olarak gostermez. Cuzdan
// basina TEK Gizli Hesap vardir; ilk bulunan doner.
export function findPrivateAccount(vaults) {
    if (!Array.isArray(vaults)) return null
    for (const vault of vaults) {
        if (vault?.privateAccount?.address) return { vault, account: vault.privateAccount }
    }
    return null
}

// CreateAccount.vue ile AYNI suzgec: privateKey ve tonMnemonic kasalari HD turetemez.
const isHdVault = (vault) => !!vault && vault.type !== 'privateKey' && vault.type !== 'tonMnemonic'

export function pickVaultForPrivateAccount(vaults, preferredAccount) {
    if (!Array.isArray(vaults)) return null
    const own = preferredAccount ? findVaultForAccount(vaults, preferredAccount) : null
    if (isHdVault(own)) return own
    return vaults.find(isHdVault) || null
}

// `name` ZORUNLU: eksik ad sessizce Ingilizce'ye dusmesin (adi cagiran etkin arayuz dilinden secer).
export function derivePrivateAccount(mnemonic, vault, { name } = {}) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('PRIVATE_NAME_REQUIRED')
    const phrase = String(mnemonic || '').trim()
    if (!phrase.includes(' ')) throw new Error('PRIVATE_NEEDS_HD_VAULT')
    const node = HDNodeWallet.fromPhrase(phrase, null, 'm').derivePath(PRIVATE_ACCOUNT_PATH)
    // index, tonAddress, solanaAddress BILEREK YOK: Gizli Hesap yalniz EVM'dir.
    // Anahtar BELIRLEYICIDIR: kasanin seed'i ve sabit yol adresi tek basina belirler, yani ayni
    // kasa her turetmede ayni anahtari verir. Rastgele anahtar, kayip guncellemeden sonra
    // yeniden turetilince anahtara bagli kayitlari (imported_tokens[key], hesaba gore suzulen
    // gecmis) yetim birakirdi. Adresten oteye hicbir sey ifsa etmez.
    return {
        key: `private-${node.address.toLowerCase()}`,
        address: node.address,
        fingerprint: vault?.fingerprint,
        createdAt: new Date().toISOString(),
        name,
        type: 'hd',
        private: true,
        derivationPath: PRIVATE_ACCOUNT_PATH,
    }
}

// Ayni modul icinde cagrilari sirayla calistirir: ust uste binen iki cagri (cift tik)
// ayni anda iki hesap turetip birbirinin yazisini ezmesin, ikinci cagri birincinin
// sakladigi hesabi gorsun.
let ensureSirasi = Promise.resolve()

function siraliCalistir(is) {
    const sonuc = ensureSirasi.then(is)
    ensureSirasi = sonuc.catch(() => {})
    return sonuc
}

// Varsa mevcut Gizli Hesap'i, yoksa turetip kasaya yazdigini doner. Hata halinde
// depoya HICBIR SEY yazilmaz.
export function ensurePrivateAccount(args) {
    return siraliCalistir(() => ensureOnce(args))
}

async function ensureOnce({ storage, masterKey, preferredAccount, name }) {
    const { vaults } = await storage.get('vaults')
    const existing = findPrivateAccount(vaults)
    if (existing) return existing.account

    const vault = pickVaultForPrivateAccount(vaults, preferredAccount)
    if (!vault) throw new Error('PRIVATE_NEEDS_HD_VAULT')

    const mnemonic = await unlockVault(masterKey, vault)
    const account = derivePrivateAccount(mnemonic, vault, { name })

    // Yavas turetmeden sonra kasalar TAZE okunur: bu surede baska bir yazar dizide
    // degisiklik yapmis olabilir (kayip guncelleme). Kasa nesne kimligiyle degil,
    // kalici kimligiyle (id) eslenir; arada baska bir Gizli Hesap yazildiysa o doner.
    const { vaults: fresh } = await storage.get('vaults')
    const sonradanYazilan = findPrivateAccount(fresh)
    if (sonradanYazilan) return sonradanYazilan.account
    if (!Array.isArray(fresh) || !fresh.some((v) => v?.id === vault.id)) {
        throw new Error('PRIVATE_NEEDS_HD_VAULT')
    }
    const nextVaults = fresh.map((v) => (v?.id === vault.id ? { ...v, privateAccount: account } : v))
    await storage.set({ vaults: nextVaults })
    return account
}

// Anahtarla hesap: normal hesaplar ve Gizli Hesap. Gizli siparisin kaynagi arayuzun
// gonderdigi bir HESAP NESNESINDEN degil, kasadan bu yolla cozulur. (Solana dApp
// baglayicisinin accountByKey'i ayri ve bilerek yalniz normal hesaplara bakar.)
export function accountByKey(vaults, key) {
    if (!key || !Array.isArray(vaults)) return null
    for (const vault of vaults) {
        const hit = (Array.isArray(vault?.accounts) ? vault.accounts : []).find((a) => a?.key === key)
        if (hit) return hit
        if (vault?.privateAccount?.key === key) return vault.privateAccount
    }
    return null
}
