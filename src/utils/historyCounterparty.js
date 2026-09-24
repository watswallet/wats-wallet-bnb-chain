// Bir gecmis satirinin "karsi taraf"ini (kime gonderdim / kimden geldi) cikaran
// SAF katman.
//
// NEDEN GEREKLI: liste satiri bugune kadar bu soruyu HIC cevaplamiyordu; karsi
// taraf yalnizca tiklaninca acilan detay modalindeydi. Oysa gecmis ekranina
// bakmanin bir numarali sebebi tam olarak bu soru.
//
// NEDEN .vue ICINDE DEGIL: History.vue icin mount-test harness'i yok (bkz.
// historyWiring.test.js ustundeki gerekce). Asagidaki kurallarin en az ikisi
// sessizce YANLIS CEVAP uretebilecek turden (ERC20'de islem hedefi = token
// kontrati, saglayici etiketi = o kontratin adi) -- testsiz birakilamaz.
//
// UC ZINCIR, UC SEMA:
//   Solana -> satir `direction` + `counterparty` tasir (historyRow.js)
//   TON    -> tonHistoryView.js from_address/to_address'i GERCEK taraflarla
//             doldurur; erc20_transfers bacaklarinda adres alani YOKTUR
//   EVM    -> islemin to_address'i ERC20 transferlerinde TOKEN KONTRATIDIR;
//             gercek alici transfer BACAGINDADIR

import { isSolanaHistoryRow } from './historyRowDisplay'
import { resolveRecipientLabel } from './knownRecipients'

// Kategori -> yon. `includes` kullanilir cunku ayni yon UC farkli metinle
// geliyor: Moralis 'send'/'receive', yerel bekleyen iskelet 'native send'/
// 'token send' (bkz. processTransaction.js), TON 'send'/'receive'.
//
// Takas / izin / kopru BILEREK DISARIDA: oradaki karsi taraf bir yonlendirici
// sozlesmedir ve kullaniciya hicbir sey anlatmaz. Taninmayan kategori de
// disarida -- yanlis tarafi gostermektense hic gostermemek dogrudur.
function directionOf(category) {
    if (typeof category !== 'string') return null
    const c = category.toLowerCase()
    if (c.includes('swap') || c.includes('approve') || c.includes('bridge')) return null
    if (c.includes('send')) return 'send'
    if (c.includes('receive')) return 'receive'
    return null
}

// Transfer BACAGINDAKI gercek taraf. Bu, `tx.to_address`'e dusmeden ONCE
// denenir: ERC20 gonderiminde islemin hedefi TOKEN KONTRATIDIR, alici yalniz
// bacakta yazar. TON bacaklarinda adres alani hic olmadigi icin burasi null
// doner ve cagiran tx.to_address/from_address'e duser -- orada dogru taraf var.
function legAddress(tx, direction) {
    const legs = [
        ...(Array.isArray(tx?.erc20_transfers) ? tx.erc20_transfers : []),
        ...(Array.isArray(tx?.native_transfers) ? tx.native_transfers : []),
    ]
    const leg = legs.find((l) => l?.direction === direction)
    if (!leg) return null

    const adres = direction === 'send' ? leg.to_address : leg.from_address
    return typeof adres === 'string' && adres ? adres : null
}

/**
 * Satirin karsi taraf adresi; yoksa/anlamsizsa null.
 *
 * Adres HICBIR YERDE kucultulmez: base58 (Solana) ve base64url (TON) harf
 * kasasina duyarlidir, kucultulen adres BASKA bir adrestir.
 */
export function counterpartyAddress(tx) {
    if (!tx || typeof tx !== 'object') return null

    if (isSolanaHistoryRow(tx)) {
        // Kendine transferde karsi taraf kendimiziz: baslik zaten "Kendine
        // Transfer" diyor, adresi tekrar basmak bilgi degil gurultu olurdu.
        if (tx.direction === 'self') return null
        return typeof tx.counterparty === 'string' && tx.counterparty ? tx.counterparty : null
    }

    const yon = directionOf(tx.category)
    if (!yon) return null

    const bacak = legAddress(tx, yon)
    if (bacak) return bacak

    const duz = yon === 'send' ? tx.to_address : tx.from_address
    return typeof duz === 'string' && duz ? duz : null
}

/**
 * Karsi tarafin adresi + varsa insan-okur etiketi.
 *
 * Etiket onceligi: kendi hesap adim > adres defteri etiketi > saglayici etiketi.
 * Kullanicinin KENDI adlandirmasi her zaman once gelir -- "Ahmet" yazdigi bir
 * adresi saglayici "Binance 7" diye biliyorsa kullanicinin dedigi kazanir.
 *
 * SAGLAYICI ETIKETI (Moralis `to_address_label`) SADECE islemin hedefi karsi
 * tarafin KENDISIYSE kullanilir. ERC20 gonderiminde hedef token kontratidir ve
 * etiket o kontratin adidir ("USD Coin") -- onu alici ismi diye basmak duz bir
 * yalan olurdu.
 */
export function counterpartyOf(tx, { accounts = [], savedAddresses = [] } = {}) {
    const address = counterpartyAddress(tx)
    if (!address) return null

    const kayitli = resolveRecipientLabel(address, { accounts, savedAddresses })
    if (kayitli) return { address, label: kayitli }

    const saglayici = tx?.to_address_label
    if (saglayici && address === tx?.to_address) return { address, label: saglayici }

    return { address, label: null }
}
