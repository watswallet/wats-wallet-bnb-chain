import { deriveMasterKey, unlockVault } from './crypto-utils'

// Master key artık DİSKTE TUTULMUYOR.
//
// Eskiden chrome.storage.local.jwk içinde düz metin olarak duruyordu — yani kasaları
// açan anahtar, şifrelediği verinin tam yanında. Dosyalara erişen biri şifreyi hiç
// denemeden her şeyi açabiliyordu.
//
// Artık iki kaynağı var:
//   1) Açık oturum: background'ın chrome.storage.session'a koyduğu anahtar. Bellekte
//      durur, tarayıcı kapanınca ve kilitlenince silinir.
//   2) Kullanıcının şifresi: walletSalt + şifre → anahtar. Doğruluğu, diskteki bir
//      kopyayla karşılaştırarak değil, gerçekten bir kasayı çözerek kanıtlanır.

const SESSION_MASTER_KEY = 'sessionMasterKeyJwk'

// extractable:true zorunlu — deriveVaultKey exportKey('raw', masterKey) çağırıyor
// (crypto-utils.js:50). Çıkarılamaz bir anahtar InvalidAccessError verir.
export async function importMasterKey(jwk) {
    return crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
}

export async function exportMasterKey(masterKey) {
    return crypto.subtle.exportKey('jwk', masterKey)
}

// Açık oturumdaki master key; cüzdan kilitliyse null.
export async function getSessionMasterKey() {
    try {
        const stored = await chrome.storage.session.get(SESSION_MASTER_KEY)
        const jwk = stored?.[SESSION_MASTER_KEY]
        if (!jwk) return null

        return await importMasterKey(jwk)
    } catch {
        return null
    }
}

export function saltFromHex(walletSalt) {
    const hex = walletSalt.startsWith('0x') ? walletSalt.slice(2) : walletSalt
    return new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)))
}

// Şifreyi bir kasayı gerçekten çözerek doğrular ve master key'i döner.
// Yanlış şifrede (veya doğrulanacak kasa yoksa) null döner — asla hata atmaz,
// çağıran taraf "yanlış şifre" mesajını kendi gösterir.
//
// requireAll: true → TÜM kasalar çözülmeli. Şifre değiştirmede kullanılır, çünkü
// orada hepsi yeniden şifrelenecek; biri açılamıyorsa işleme hiç başlanmamalı.
// false (varsayılan) → herhangi biri çözülürse şifre doğrudur. Bozuk tek bir kasa
// kullanıcıyı cüzdanından kilitlemesin diye.
export async function verifyPassword(password, { walletSalt, vaults, requireAll = false } = {}) {
    if (!password || !walletSalt || !Array.isArray(vaults) || !vaults.length) return null

    let masterKey
    try {
        masterKey = await deriveMasterKey(password, saltFromHex(walletSalt))
    } catch {
        return null
    }

    let anyUnlocked = false

    for (const vault of vaults) {
        try {
            await unlockVault(masterKey, vault)
            anyUnlocked = true

            if (!requireAll) return masterKey
        } catch {
            if (requireAll) return null
        }
    }

    return anyUnlocked ? masterKey : null
}

// Kilitli olmayan ekranlar için master key. Anahtarın GÜNCEL depoyla uyuştuğu,
// mevcut bir kasa çözülerek KANITLANIR.
//
// Doğrulama neden şart: session'da BAYAT bir anahtar kalabilir — şifre değişiminden
// sonra LOCK mesajı ulaşmazsa, ya da cüzdan sıfırlandıktan sonra oturum temizlenmezse.
// Bayat anahtarla yeni bir kasa şifrelenirse o kasa hiçbir şifreyle açılamaz; sessiz
// fon kaybı. Bu yüzden şifreleme yapan her ekran bu fonksiyonu kullanmalı.
//
// Hatalar ayrıştırılabilir: WALLET_LOCKED (kilitli, giriş gerekir),
// NO_VAULTS (doğrulanacak kasa yok), STALE_SESSION_KEY (anahtar depoyla uyuşmuyor).
// requireSessionMasterKey'in "cüzdan açık değil" hataları. Çağıranlar bunları
// kullanıcıya "kilitli, giriş yapın" olarak göstermeli; diğer hatalar genel hata.
const LOCK_ERRORS = ['WALLET_LOCKED', 'NO_VAULTS', 'STALE_SESSION_KEY']

export function isLockError(error) {
    return !!error && LOCK_ERRORS.includes(error.message)
}

export async function requireSessionMasterKey() {
    const masterKey = await getSessionMasterKey()
    if (!masterKey) throw new Error('WALLET_LOCKED')

    const { vaults } = await chrome.storage.local.get('vaults')
    if (!Array.isArray(vaults) || !vaults.length) throw new Error('NO_VAULTS')

    for (const vault of vaults) {
        try {
            await unlockVault(masterKey, vault)
            return masterKey
        } catch {
            // Bu kasa bozuk olabilir; diğerlerini dene.
        }
    }

    throw new Error('STALE_SESSION_KEY')
}
