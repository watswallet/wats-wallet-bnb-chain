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

export async function encryptPrivateKey(privateKey, password) {
    const encoder = new TextEncoder()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const salt = crypto.getRandomValues(new Uint8Array(16))

    const key = await deriveKey(password, salt)

    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        encoder.encode(privateKey)
    )

    return {
        ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
        iv: btoa(String.fromCharCode(...iv)),
        salt: btoa(String.fromCharCode(...salt)),
    }
}