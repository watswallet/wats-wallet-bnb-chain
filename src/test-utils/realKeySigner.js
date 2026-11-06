import { Transaction } from 'ethers'

// Gizli mod yurutucusu IMZALI baytlari cozup plana ve imzalayana karsi dogrular (T24 M2-I4): sahte imza
// yetmez, GERCEK bir anahtar gerekir. Bu yardimci cuzdanin signTransaction'inin SENKRON esidir: dolu islemi
// verilen anahtarla imzalar (RFC6979: ayni islem = ayni bayt). `wallet` signingKey tasiyan her sey olabilir
// (ethers Wallet, HDNodeWallet). `from` imzadan cikar, serilestirilen islemde yoktur.
export function signWithKey(wallet, tx) {
    const { from: _from, ...rest } = tx
    const t = Transaction.from(rest)
    t.signature = wallet.signingKey.sign(t.unsignedHash)
    return t.serialized
}
