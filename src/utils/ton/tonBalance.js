// TON native bakiyesi.
//
// HATA YUTULMAZ. useTokenBalance EVM tarafinda hatayi cagirana birakiyor; burada da
// oyle. Hatayi 0'a cevirmek, proxy dustugunde kullaniciya "bakiyen sifir" demek olur —
// walletController'daki bos gecmis hatasinin aynisi.
import { fromNano } from '@ton/core'
import { parseTonAddress } from './tonAddress'

export async function getTonBalance(client, addressLike, { testnet = false } = {}) {
    const address = parseTonAddress(addressLike, { testnet })
    const nano = await client.getBalance(address)
    return Number(fromNano(nano))
}
