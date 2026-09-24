// /ton/history satirlarini History.vue'nun bekledigi bicime cevirir — saf katman.
//
// History.vue Moralis semasini okuyor (block_timestamp / receipt_status /
// erc20_transfers). TON satiri o semaya UYDURULUR ki bilesen hic degismesin.
//
// Miktar neden erc20_transfers icinde: getListAmount'un native dali degeri 1e18'e
// bolup "ETH" yaziyor. TON 9 ondalikli ve sembolu TON — native dala girmek miktari
// da sembolu de yanlis gosterirdi.
import { Address } from '@ton/core'
import { TON_MAINNET_ID } from '../chainKind'
import { toFriendlyTon } from './tonAddress'

// Karsi tarafi DEPO KONVANSIYONUNA cevirir (non-bounceable UQ.../0Q..., bkz.
// tonAddress.js).
//
// KOK NEDEN: jetton satirlarinda sunucu karsi tarafi HAM TL-B bicimiyle
// uretiyor (`0:<64 hex>`, bkz. server/utils/tonJettonHistory.js readMsgAddress);
// native satirlarda toncenter zaten friendly doner. Aktivite listesi karsi
// tarafi artik SATIRDA gosterdigi icin, kullanici yalnizca jetton satirlarinda
// uygulamanin baska hicbir ekraninda gormedigi bir adres bicimi goruyordu.
// Ayrica ham bicim adres defterindeki friendly kayitlarla HICBIR ZAMAN
// eslesemez, yani isim de cozulemezdi.
//
// FAIL-SAFE: cozulemeyen adres yuzunden satir DUSMEZ, gelen deger oldugu gibi
// gecer. Satiri kaybetmek, bicimi bozuk bir adres gostermekten daha kotudur.
function toWalletConvention(address, testnet) {
    if (typeof address !== 'string' || !address) return address
    try {
        return toFriendlyTon(Address.parse(address), { testnet })
    } catch (e) {
        return address
    }
}

export function toHistoryRows(history, myAddress, { testnet = false } = {}) {
    if (!Array.isArray(history)) return []

    return history
        .filter((h) => h && h.direction && h.hash)
        .map((h) => {
            const outgoing = h.direction === 'send'
            const amount = Number(h.amount) || 0

            // Sunucu jetton satirlarinda `symbol` alanini doldurur (bkz.
            // server/utils/tonJettonHistory.js:mapOne), native TON satirlarinda bu alan
            // HIC YOKTUR - ayrim buradan yapilir. Sabit 'TON' yazmak jetton satirlarini
            // da TON etiketiyle gosterirdi (bu gorevin duzelttigi hata).
            const jettonSymbol = (typeof h.symbol === 'string' && h.symbol) ? h.symbol : null
            const counterparty = toWalletConvention(h.counterparty, testnet)

            return {
                hash: h.hash,
                chainId: TON_MAINNET_ID,
                // ISO metin: siralama `new Date(b.block_timestamp) - new Date(a...)`.
                block_timestamp: new Date((Number(h.time) || 0) * 1000).toISOString(),
                from_address: outgoing ? myAddress : counterparty,
                to_address: outgoing ? counterparty : myAddress,
                to_address_label: null,
                // /ton/history yalnizca zincire islenmis islemleri doner.
                receipt_status: '1',
                category: h.direction,
                summary: h.comment || '',
                // History.vue jetton miktarini AYRICA ondalige bolmez - sunucu zaten
                // dogru ondalikla cevirip gonderiyor (bkz. tonJettonHistory.js:
                // rawUnitsToDecimalNumber). Bu alan yalnizca hangi satirin jetton
                // oldugunu ekrana bildirir.
                jettonSymbol,
                erc20_transfers: [{
                    value_formatted: String(amount),
                    token_symbol: jettonSymbol || 'GRAM',
                    direction: h.direction,
                }],
                // History.vue detay modali `parseFloat(selectedTx.transaction_fee).toFixed(6)`
                // okur (sayi/sayisal-metin fark etmez). /ton/history yalnizca zincire
                // islenmis kayitlari dondurdugu icin ucret HER ZAMAN bilinir — taşınmazsa
                // kutu kalici olarak "hesaplaniyor..." gosterirdi (islem onaylanmis olsa
                // bile). Birim etiketi (TON/ETH) sablonda ayrica zincire gore secilir.
                transaction_fee: String(Number(h.fee) || 0),
            }
        })
}
