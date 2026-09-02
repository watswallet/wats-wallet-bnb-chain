// TON anahtarini disa aktarma.
//
// Neden var: TON adresi mevcut tohumdan SLIP-0010 ile turetiliyor; ayni kelimeler
// Tonkeeper'a girildiginde BASKA bir adres cikar (onlar TON'un kendi mnemonic
// semasini kullaniyor). Kullanicinin fonlarina bu uygulama olmadan da ulasabilmesi
// icin ham ed25519 anahtari gosterilebilmeli.
//
// Anahtar HICBIR YERE YAZILMAZ: cagiran taraf yalnizca ekranda gosterir.
import { tonIdentityForAccount } from './tonIdentity'

export async function exportTonKey(masterKey, vaults, account, opts = {}) {
    const { keyPair, friendly } = await tonIdentityForAccount(masterKey, vaults, account, opts)
    return {
        secretKeyHex: Buffer.from(keyPair.secretKey).toString('hex'),
        friendly,
    }
}
