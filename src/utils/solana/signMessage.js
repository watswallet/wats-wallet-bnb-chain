import nacl from 'tweetnacl'

// Ham ed25519 imzalama -- saf katman. AG YOK, chrome YOK, @solana/* YOK
// (bu yuzden bufferGlobal shim'i de gerekmez).
//
// NEDEN AYRI DOSYA: `sendSolanaTransfer` imzalamayi @solana/web3.js'in
// `transaction.sign()`ine birakiyor, ama signMessage/signIn'in imzalayacagi
// sey bir ISLEM DEGIL, ham bayt dizisidir; web3.js bunun icin bir giris
// noktasi vermiyor ve nacl'i da yeniden disa aktarmiyor.
//
// BOYUT KONTROLU BURADA DEGIL: mesaj uzunlugu sinirini (MAX_MESSAGE_BYTES /
// SOLANA_MESSAGE_TOO_LARGE) arka plandaki 5. kapi uygular; bu katman
// kendisine verilen baytlari imzalar ve ne oldugunu yorumlamaz.

const SECRET_KEY_LENGTH = 64

/**
 * @param {Uint8Array} messageBytes ham mesaj (bos olabilir -- RFC 8032 TEST 1)
 * @param {Uint8Array} secretKey @solana/web3.js Keypair.secretKey, 64 bayt
 *   (seed || publicKey)
 * @returns {Uint8Array} 64 baytlik ayrik (detached) ed25519 imzasi
 */
export function signMessageBytes(messageBytes, secretKey) {
    if (!(messageBytes instanceof Uint8Array)) {
        throw new Error('SOLANA_SIGN_BAD_MESSAGE')
    }
    // Yanlis uzunluktaki bir anahtar SESSIZCE gecerse dapp'e dogrulanamayan
    // bir imza doner ve kullanici "imzaladim ama giris yapamiyorum" der --
    // hicbir tarafta hata gorunmez. Bu yuzden acikca reddedilir.
    if (!(secretKey instanceof Uint8Array) || secretKey.length !== SECRET_KEY_LENGTH) {
        throw new Error('SOLANA_SIGN_BAD_SECRET_KEY')
    }

    return nacl.sign.detached(messageBytes, secretKey)
}
