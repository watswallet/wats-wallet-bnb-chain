import { HDNodeWallet, Wallet } from "ethers"
import { tonKeyPairFromTonMnemonic } from './ton/tonMnemonic'

const textEnc = new TextEncoder()
const textDec = new TextDecoder()

// Rastgele byte üret
export const randBytes = (len) => crypto.getRandomValues(new Uint8Array(len))

export function toHex(uint8Array) {
  return Array.from(uint8Array)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
}

// SHA-256 hash
export async function sha256(data) {
  const hash = await crypto.subtle.digest('SHA-256', data)
  return new Uint8Array(hash)
}

// PBKDF2 ile master key türetme
export async function deriveMasterKey(password, globalSalt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    textEnc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  )

  const masterKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: globalSalt,
      iterations: 310000
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true, 
    ['encrypt', 'decrypt']
  )

  return masterKey
}

// HKDF ile vault key türetme
export async function deriveVaultKey(masterKey, vaultId) {
  // Master key'den raw bytes al
  const masterKeyBytes = await crypto.subtle.exportKey('raw', masterKey)
  
  // Vault ID'yi salt olarak kullan (Mevcut yapıyı bozmamak için)
  const vaultSalt = await sha256(textEnc.encode(vaultId))
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(masterKeyBytes),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  const vaultKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: vaultSalt,
      iterations: 100000
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )

  return vaultKey
}

// Mnemonic şifreleme (Bu fonksiyon VaultKey bekler!)
export async function encryptMnemonic(mnemonic, vaultKey) {
  const iv = randBytes(12) // AES-GCM için 12 byte IV standart
  
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    vaultKey,
    textEnc.encode(mnemonic)
  )
  
  return {
    ciphertext: arrayBufferToBase64(cipherBuffer),
    iv: arrayBufferToBase64(iv)
  }
}

// Bu fonksiyon MasterKey alır, VaultKey'i türetir ve şifreler.
// Vue componentinde bunu kullanacaksınız.
export async function encryptMnemonicWithMaster(mnemonic, masterKey, vaultId) {
    // 1. Önce MasterKey'den VaultKey türet (Unlock ile aynı mantık)
    const vaultKey = await deriveVaultKey(masterKey, vaultId)
    
    // 2. Türetilen anahtarla şifrele
    return await encryptMnemonic(mnemonic, vaultKey)
}

// Mnemonic şifre çözme
export async function decryptMnemonic(ciphertextB64, ivB64, vaultKey) {
  try {
    const ciphertext = base64ToArrayBuffer(ciphertextB64)
    const iv = base64ToArrayBuffer(ivB64)
  
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      vaultKey,
      ciphertext
    )
    return textDec.decode(plaintext)
  } catch (error) {
    console.error("Decryption Error Details:", error)
    throw new Error('Decryption failed: Invalid password or corrupted data')
  }
}

// ==========================================
// İÇE AKTARILMIŞ HESAP ŞİFRESİNİ ÇÖZME
// ==========================================
export async function decryptSecret(importedSecret, masterKey, vaultId) {
    if (!importedSecret || !masterKey || !vaultId) {
        throw new Error("Eksik parametre: secret, masterKey veya vaultId yok.");
    }

    try {
        // 1. Adım: Anahtarı türet
        const vaultKey = await deriveVaultKey(masterKey, vaultId);
        
        // 2. Adım: Verileri Buffer'a çevir
        const ciphertextBuffer = base64ToArrayBuffer(importedSecret.ciphertext);
        const ivBuffer = base64ToArrayBuffer(importedSecret.iv);

        // 3. Adım: Çözmeyi dene
        const plaintextBuffer = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: ivBuffer },
            vaultKey,
            ciphertextBuffer
        );
        
        return textDec.decode(plaintextBuffer);
    } catch (error) {
        // Hata buraya düşüyorsa vaultId veya masterKey şifreleme anındakinden farklıdır
        console.error("🚨 KRİPTO HATASI:", {
            errorName: error.name,
            vaultId, // Buradaki ID'nin şifreleme anındakiyle aynı olduğundan emin ol
            hasMasterKey: !!masterKey
        });
        throw new Error('Şifre çözme başarısız: Anahtar uyuşmazlığı (OperationError)');
    }
}

// Base64 encoding/decoding helpers
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes.buffer
}

export async function createVaultWithPrivateKey(masterKey, privateKey, account) {
  const vaultId = crypto.randomUUID()
  const vaultSalt = randBytes(32)

  const vaultKey = await deriveVaultKey(masterKey, vaultId)

  const wallet = new Wallet(privateKey)
  const seed = wallet.privateKey

  const hash = await sha256(new TextEncoder().encode(seed))
  const fingerprint = toHex(hash) 
  account.fingerprint = fingerprint

  const { ciphertext, iv } = await encryptMnemonic(privateKey, vaultKey)

  return {
    id: vaultId,
    mnemonic: ciphertext,
    iv,
    vaultSalt: arrayBufferToBase64(vaultSalt),
    fingerprint,
    accounts: [account],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    type: 'privateKey'
  }
}

export async function createVault(masterKey, mnemonic, account) {
  const vaultId = crypto.randomUUID()
  const vaultSalt = randBytes(32)
  
  const vaultKey = await deriveVaultKey(masterKey, vaultId)

  const hdNode = HDNodeWallet.fromPhrase(mnemonic)
  const seed = hdNode.privateKey

  const hash = await sha256(new TextEncoder().encode(seed))
  const fingerprint = toHex(hash)
  account.fingerprint = fingerprint
    
  const { ciphertext, iv } = await encryptMnemonic(mnemonic, vaultKey)
  
  return {
    id: vaultId,
    mnemonic: ciphertext,
    iv,
    vaultSalt: arrayBufferToBase64(vaultSalt),
    accounts: [account],
    fingerprint,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    type: 'hd'
  }
}

/**
 * TON mnemonic kasasi.
 *
 * `createVault`ten iki farki var ve ikisi de zorunlu:
 *  1) fingerprint EVM ozel anahtarindan degil, ED25519 TOHUMUNDAN hesaplanir —
 *     bu kasada EVM anahtari YOKTUR (spec §5).
 *  2) type 'tonMnemonic' — turetmenin hangi semayi kullanacagini belirleyen TEK
 *     kaynak budur (spec §6). Hesap kaydina ikinci bir kopya YAZILMAZ.
 */
export async function createTonVault(masterKey, mnemonic, account) {
  const vaultId = crypto.randomUUID()
  const vaultSalt = randBytes(32)
  const vaultKey = await deriveVaultKey(masterKey, vaultId)

  const keyPair = await tonKeyPairFromTonMnemonic(mnemonic)
  // secretKey'in ilk 32 bayti ed25519 TOHUMUDUR (kalan 32 bayt public key'dir).
  //
  // Cakisma neden IMKANSIZ: `createVault`/`createVaultWithPrivateKey` on-goruntu
  // olarak ethers'in `0x` ONEKLI hex dizesini kullaniyor (hdNode.privateKey,
  // wallet.privateKey), buradaki on-goruntu ise CIPLAK 64-hex. Iki dize hicbir
  // girdide esitlenemez, dolayisiyla ayni ifadeden dogan TON kasasi ile HD kasa
  // FARKLI fingerprint uretir. Esitlenebilseydi kullanicinin TON cuzdani "zaten
  // aktarilmis" sanilir ve hic aktarilamazdi (tonIdentity.test.js bu ayrimi
  // acikca kilitliyor).
  const seedHex = Buffer.from(keyPair.secretKey.slice(0, 32)).toString('hex')

  const hash = await sha256(new TextEncoder().encode(seedHex))
  const fingerprint = toHex(hash)
  account.fingerprint = fingerprint

  const { ciphertext, iv } = await encryptMnemonic(mnemonic, vaultKey)

  return {
    id: vaultId,
    mnemonic: ciphertext,
    iv,
    vaultSalt: arrayBufferToBase64(vaultSalt),
    fingerprint,
    accounts: [account],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    type: 'tonMnemonic'
  }
}

export async function unlockVault(masterKey, vaultData) {
  // Unlock işlemi VaultKey türetir, bu yüzden şifrelerken de aynı işlem yapılmalıydı.
  const vaultKey = await deriveVaultKey(masterKey, vaultData.id)

  return await decryptMnemonic(
    vaultData.mnemonic,
    vaultData.iv,
    vaultKey
  )
}

// ==========================================
// ŞİFRE DEĞİŞİMİNDE KASALARI YENİDEN ŞİFRELEME
// ==========================================
// vault.id KORUNUR: vaultKey (masterKey + vault.id)'den türetildiği için id
// sabit kaldığında yalnızca ciphertext/iv yenilenir, diğer tüm alanlar
// (fingerprint, accounts, type, createdAt) olduğu gibi taşınır.
//
// Her kasa, listeye eklenmeden ÖNCE yeni anahtarla geri açılıp doğrulanır.
// Tek bir kasa bile doğrulanamazsa hata atılır ve hiçbir sonuç döndürülmez;
// çağıran taraf bu durumda depoya HİÇBİR ŞEY yazmamalıdır. Salt/jwk'yı
// kasalardan ayrı yazmak, araya düşen bir hatada kasaları kalıcı olarak
// açılamaz hale getirir.
export async function reencryptVaults(vaults, oldMasterKey, newMasterKey) {
  if (!Array.isArray(vaults)) {
    throw new Error('reencryptVaults: kasa listesi bir dizi olmalı')
  }

  const newVaults = []

  for (const vault of vaults) {
    if (!vault || !vault.id) {
      throw new Error('reencryptVaults: kasa id eksik')
    }

    // 1) Kasanın kendi sırrı: hd kasada mnemonic, privateKey kasada özel anahtar.
    // İçerik incelenmez (ImportPrivate 0x'siz anahtar da kaydedebiliyor), olduğu
    // gibi yeniden şifrelenir.
    const secret = await unlockVault(oldMasterKey, vault)
    const { ciphertext, iv } = await encryptMnemonicWithMaster(secret, newMasterKey, vault.id)

    // accounts derin kopyalanır: düz `{ ...vault }` diziyi ve hesap objelerini
    // referansla paylaşır, importedSecret güncellemesi çağıranın verisini bozardı.
    const newVault = {
      ...vault,
      mnemonic: ciphertext,
      iv,
      updatedAt: Date.now(),
      accounts: Array.isArray(vault.accounts)
        ? vault.accounts.map(account => ({ ...account }))
        : vault.accounts
    }

    // vault.data, mnemonic ciphertext'inin okunmayan bir kopyası (CreateAccount.vue:289).
    // Birlikte güncellenmezse eski şifreyle açılabilen bir tohum kopyası diskte kalır.
    if (Object.prototype.hasOwnProperty.call(vault, 'data')) {
      newVault.data = ciphertext
    }

    const verified = await unlockVault(newMasterKey, newVault)
    if (verified !== secret) {
      throw new Error('reencryptVaults: yeniden şifreleme doğrulanamadı')
    }

    // 2) HD kasaya yükseltilmiş hesapların içinde barınan importedSecret blob'ları
    // da (masterKey + vault.id) anahtarıyla şifreli. Atlanırsa içe aktarılmış
    // hesaplar bir daha imzalayamaz: background.js:151 tek imzalama yolu.
    if (Array.isArray(newVault.accounts)) {
      for (const account of newVault.accounts) {
        if (!account || !account.importedSecret) continue

        const importedSecret = await decryptSecret(account.importedSecret, oldMasterKey, vault.id)
        const rotated = await encryptMnemonicWithMaster(importedSecret, newMasterKey, vault.id)
        const newImportedSecret = {
          ...account.importedSecret,
          ciphertext: rotated.ciphertext,
          iv: rotated.iv
        }

        const verifiedSecret = await decryptSecret(newImportedSecret, newMasterKey, vault.id)
        if (verifiedSecret !== importedSecret) {
          throw new Error('reencryptVaults: içe aktarılmış hesap anahtarı doğrulanamadı')
        }

        account.importedSecret = newImportedSecret
      }
    }

    newVaults.push(newVault)
  }

  if (newVaults.length !== vaults.length) {
    throw new Error('reencryptVaults: kasa sayısı uyuşmuyor')
  }

  return newVaults
}

// active_account, kasadaki hesap objesinin diskteki bir kopyasıdır ve importedSecret
// blob'unu da taşır (ManageAccounts.vue:81 spread, Header.vue:672 yazım).
// background.js:149 blob'u kasa yerine bu kopyadan okuduğu için şifre değişiminde
// onun da yenilenmiş blob'la güncellenmesi gerekir.
//
// Değişiklik gerekmiyorsa girdi referansı aynen döner; böylece çağıran taraf
// gereksiz yazımdan kaçınabilir.
export function syncActiveAccount(activeAccount, newVaults) {
  if (!activeAccount || !activeAccount.importedSecret) return activeAccount
  if (!Array.isArray(newVaults)) {
    throw new Error('syncActiveAccount: kasa listesi bir dizi olmalı')
  }

  for (const vault of newVaults) {
    if (!vault || !Array.isArray(vault.accounts)) continue

    for (const account of vault.accounts) {
      if (!account) continue

      // background.js:139 ile aynı eşleştirme: önce key, sonra küçük harfli adres.
      const sameKey = !!account.key && !!activeAccount.key && account.key === activeAccount.key
      const sameAddress = !!account.address && !!activeAccount.address &&
        account.address.toLowerCase() === activeAccount.address.toLowerCase()

      if (sameKey || sameAddress) {
        return { ...activeAccount, importedSecret: account.importedSecret }
      }
    }
  }

  throw new Error('syncActiveAccount: aktif hesap kasalarda bulunamadı')
}