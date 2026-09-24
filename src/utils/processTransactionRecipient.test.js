// Bekleyen islem iskeletinin ALICI alani -- cozulemeyen cagri verisi.
//
// KOK NEDEN: `buildPendingSkeleton` ERC-20 bacagini kurarken cagri verisinden
// adresi KORUMASIZ okuyordu: `'0x' + data.substring(34, 74)`. Cagri verisi
// DAPP'TEN geliyor ve dogrulanmis degil (Dapp.vue cozumleyemedigi veriyi HAM
// haliyle geciriyor), yani kisa ya da hex OLMAYAN bir govde ekrana duz "0x" gibi
// anlamsiz bir "adres" basiyordu. Bu alan historyCounterparty uzerinden Gecmis
// satirindaki "kiminle" bilgisine gidiyor.
//
// Arka plan tarafinda ayni kapi zaten kapatildi (background.js evmRecipient /
// addressParam); iki yer AYNI girdiye ayni cevabi vermeli.
import { describe, it, expect } from 'vitest'
import { buildPendingSkeleton } from './processTransaction'

const ALICI = '0x1111111111111111111111111111111111111111'
const TOKEN = '0x2222222222222222222222222222222222222222'
const GONDEREN = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa'

const tx = (data) => ({
    hash: '0xdead',
    nonce: 7,
    from: GONDEREN,
    to: TOKEN,
    value: 0n,
    data,
    gasLimit: 21000n,
    gasPrice: 1000000000n,
})

const TAM = '0xa9059cbb' + '0'.repeat(24) + ALICI.slice(2) + '0'.repeat(64)

describe('buildPendingSkeleton -- ERC-20 alicisi', () => {
    it('gecerli cagri verisinde aliciyi cozer', () => {
        const s = buildPendingSkeleton(tx(TAM), { amount: '100', assetData: { symbol: 'usdt' } }, GONDEREN)

        expect(s.erc20_transfers).toHaveLength(1)
        expect(s.erc20_transfers[0].to_address).toBe(ALICI)
    })

    // Kirik govdede bacak HIC yazilmaz: bos bir liste "bilmiyoruz" der, "0x" ise
    // bir adres OLDUGUNU iddia eder. Yanlis iddia, iddiasizliktan kotudur.
    it.each([
        ['yalniz selector', '0xa9059cbb'],
        ['yarim adres penceresi', '0xa9059cbb' + '0'.repeat(24) + '1'.repeat(20)],
        ['hex OLMAYAN dolgu', '0xa9059cbb' + '0'.repeat(24) + 'z'.repeat(40) + '0'.repeat(64)],
    ])('%s: bacak yazilmaz, "0x" gibi bir adres UYDURULMAZ', (_ad, data) => {
        const s = buildPendingSkeleton(tx(data), { amount: '100', assetData: { symbol: 'usdt' } }, GONDEREN)

        expect(s.erc20_transfers).toHaveLength(0)
        // NATIVE dalina da DUSMEZ: `txResponse.to` TOKEN KONTRATIDIR ve onu alici
        // diye yazmak "0x"ten daha kotudur -- gecerli bir adres gibi gorunur.
        expect(s.native_transfers).toHaveLength(0)
        const hepsi = JSON.stringify(s)
        expect(hepsi).not.toContain('"to_address":"0x"')
        expect(hepsi).not.toContain(TOKEN.toLowerCase() + '","value_formatted')
    })
})
