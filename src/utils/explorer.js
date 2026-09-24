import supported_chains from '../data/supportedChains'
import { isSameChainId, chainVm } from './vm'
import { isTon, TON_MAINNET_ID, TON_TESTNET_ID } from './chainKind'
import { SOLANA_EXPLORER } from './solana/constants'

/**
 * Blok gezgini islem baglantisi.
 *
 * Slug haritasi iki ayri bilesende elle tutuluyordu ve destekli zincirlerin bir
 * kismini icermiyordu; eslesmeyen zincirde ya `/tx/undefined/<hash>` uretiliyor
 * ya da sessizce 'eth'e dusup YANLIS zincirin gezginini aciyordu.
 * Slug artik zincir verisinin kendisinden okunuyor.
 *
 * UC AYRI GEZGIN YOLU var ve ucu de korunmali: EVM zincirleri alltoscan'in slug
 * yolunu, Solana solscan'i, TON ise tonviewer'i kullanir. alltoscan ne Solana'yi
 * ne TON'u indeksliyor; birini otekinin yoluna sokmak calisan bir baglanti
 * uretmez, KIRIK bir baglanti uretir.
 */
const EXPLORER_BASE = 'https://scan.alltoscan.com'

// TON kendi gezginini kullanir: scan.alltoscan.com TON'u indekslemiyor. Ayrica
// baglanti HASH ile degil ADRES sayfasiyla verilir — toncenter hash'i gonderim
// aninda dondurmuyor ve elimizdeki hash bicimi tonviewer'in bekledigiyle her
// zaman ortusmuyor; adres ise (hash'in aksine) her zaman guvenilir.
const TON_EXPLORER_BASE = {
    [TON_MAINNET_ID]: 'https://tonviewer.com',
    [TON_TESTNET_ID]: 'https://testnet.tonviewer.com',
}

/**
 * chainId -> zincir kaydi.
 *
 * Karsilastirma isSameChainId ile yapilir, `Number(chainId)` ile DEGIL: Solana'nin
 * kimligi METIN ('solana-mainnet') ve Number() onu NaN'a cevirip kaydi hic
 * bulamazdi; TON'unki ise NEGATIF sayidir.
 */
function chainRecord(chainId) {
    if (chainId === null || chainId === undefined) return null
    return supported_chains.find(c => isSameChainId(c.chainId, chainId)) || null
}

export function explorerSlug(chainId) {
    return chainRecord(chainId)?.chainSlug || null
}

// `tonAddress` yalnizca TON zincirlerinde kullanilir (bkz. yukaridaki not); diger
// zincirlerde yoksayilir, mevcut cagiranlar (TransactionStatus.vue) bozulmaz.
export function explorerTxUrl(chainId, hash, tonAddress) {
    // TON, asagidaki `!hash` korumasindan ONCE gelmek ZORUNDA: TON baglantisi
    // adres sayfasidir, yani hash olmadan da gecerli bir url uretir. Tip sorusu
    // chainKind'e sorulur (tek dogru); harita yalnizca url tabanini verir ve
    // zincir kaydi listeden dusse bile TON kimlikleri TON kalir.
    if (isTon(chainId)) {
        const tonBase = TON_EXPLORER_BASE[Number(chainId)]
        // Adres henuz bilinmiyorsa (ör. TON hesabi kilitliyken cagrilirsa) bos bir
        // hash sayfasi yerine gezginin ana sayfasina dusulur.
        if (tonBase) return tonAddress ? `${tonBase}/${tonAddress}` : tonBase
    }

    const chain = chainRecord(chainId)

    // Zincir bilinmiyorsa yanlis zincirin gezginine yonlendirmek yerine
    // hash'e gore arama sayfasi acilir.
    if (!chain || !hash) return `${EXPLORER_BASE}/search?q=${hash || ''}`

    // Solana'nin islem kimligi bir imzadir ve alltoscan onu cozemez; kendi
    // gezginine gider.
    if (chainVm(chain) === 'solana') return `${SOLANA_EXPLORER}/tx/${hash}`

    return `${EXPLORER_BASE}/tx/${chain.chainSlug}/${hash}`
}
