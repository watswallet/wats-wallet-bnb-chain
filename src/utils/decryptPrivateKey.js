function isValidBase64(str) {
  try {
    return btoa(atob(str)) === str
  } catch (err) {
    return false
  }
}

function safeBase64Decode(str) {
  try {
    if (!str || typeof str !== 'string') throw new Error('Geçersiz base64 string')
    
    const cleanStr = str.replace(/\s/g, '')
    
    if (!isValidBase64(cleanStr)) throw new Error('Base64 formatı geçersiz')
    
    return Uint8Array.from(atob(cleanStr), c => c.charCodeAt(0))
  } catch (err) {
    console.error('Base64 decode hatası:', err)
    throw new Error('Veri decode edilemedi')
  }
}

async function deriveKey(password, salt) {
  const encoder = new TextEncoder()
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  )

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  )
}

export async function decryptPrivateKey(encryptedData, password) {
  const decoder = new TextDecoder()

  try {
    if (!encryptedData || typeof encryptedData !== 'object') throw new Error('Invalid encoded data')

    const { ciphertext, iv, salt } = encryptedData
    if (!ciphertext || !iv || !salt) throw new Error('Şifrelenmiş veri eksik alanlar içeriyor')

    const ciphertextBytes = safeBase64Decode(ciphertext)
    const ivBytes = safeBase64Decode(iv)
    const saltBytes = safeBase64Decode(salt)

    const key = await deriveKey(password, saltBytes)

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      key,
      ciphertextBytes
    )

    return decoder.decode(decrypted)
  } catch (err) {
    console.error('Decrypt hatası:', err)
    throw new Error('Şifre çözme başarısız: ' + err.message)
  }
}