// Gecmis ekraninin (History.vue) EVM ve Solana satirlarini AYRISTIRAN ve durum
// etiketleyen SAF katman.
//
// KOK NEDEN: .vue icinde kalirsa mount-test harness'i olmadigi icin testsiz
// kalirdi (bkz. sendConfirmWiring.test.js ustundeki not) ve bu depoda daha once
// yasanmis bir bicimde kirilirdi (token.image.large ornegi): EVM satirlari
// `receipt_status` tasir, Solana satirlari (toHistoryRow) `status` tasir ve
// HICBIRI digerinin alanini TASIMAZ — aradaki fark ELLE ayristirilmazsa
// sablonun `receipt_status === '1'` kontrolu Solana satirinda hep false doner
// ve varsayilan dal HER basarili Solana islemini "Basarisiz" gosterir. Bu,
// parasi giden ama basariyla giden bir kullaniciya "islemin basarisiz" demek
// kadar ciddi bir hata.

/**
 * Bir gecmis satirinin toHistoryRow ciktisi (Solana) olup olmadigini ayirt eder.
 * Solana satirlari `direction` alani tasir ('in' | 'out' | 'self'); EVM
 * satirlarinda bu alan hic yoktur.
 */
export function isSolanaHistoryRow(tx) {
    return !!tx && (tx.direction === 'in' || tx.direction === 'out' || tx.direction === 'self')
}

/**
 * Durum etiketi: 'pending' | 'confirmed' | 'failed'.
 *
 * Helius-kaynakli Solana satirlarinda (toHistoryRow) `pending` HIC uretilmez
 * (Helius yalnizca zincire islenmis islemleri dondurur; bkz.
 * solanaController.getSolanaHistory). ANCAK yerel bekleyen kayitlar
 * (pendingSolanaTxToRow, bkz. loadHistory.js — Task 14 review round 1, Bulgu 2:
 * kullanicinin az once gonderdigi ama Helius'un henuz indekslemedigi islem)
 * `status: 'pending'` TASIR ve BURADAN gecer; aksi halde bu satirlar da
 * "Basarisiz" gibi yanlis gosterilirdi. EVM tarafinin varsayilan dali
 * (receipt_status 'pending' ya da '1' DEGILSE 'failed') DEGISTIRILMEDI: mevcut
 * sablon de zaten boyle davraniyordu, burada yalniz TEK yere tasindi.
 */
export function historyStatusKind(tx) {
    if (!tx) return 'failed'
    if (isSolanaHistoryRow(tx)) {
        if (tx.status === 'pending') return 'pending'
        return tx.status === 'failed' ? 'failed' : 'confirmed'
    }
    if (tx.receipt_status === 'pending') return 'pending'
    if (tx.receipt_status === '1') return 'confirmed'
    return 'failed'
}

/**
 * Liste/detayda gosterilecek sembol etiketi.
 *
 * SPL token'larda `symbol` toHistoryRow tarafindan cozulmez (NULL doner, bkz.
 * historyRow.js) — mint->sembol cozumu ayri bir katmandadir: loadHistory.js'in
 * `enrichWithTokenSymbols`'u, useSolanaAssets.js ile PAYLASILAN
 * `utils/solana/tokenMetadata.js` uzerinden /solana/tokens'a gidip `symbol`'u
 * DOLDURMAYA CALISIR (review round 1, Bulgu 5 -- BURADA daha once "Task 14'un
 * kapsami disinda" denirdi, DOGRU DEGIL: F5 bunu kapsama aldi ve uygulandi).
 * O katman basarisiz olursa (metadata bulunamadi, ya da ucu cevap vermedi)
 * `symbol` null KALIR ve BURASI (solanaSymbolLabel) devreye girer: bos
 * birakmak yerine mint adresinin kisaltilmisi gosterilir; adres KUCULTULMEZ
 * (formatAddress case degistirmez, yalnizca ortasini keser).
 */
export function solanaSymbolLabel(tx, formatAddress) {
    if (tx?.symbol) return tx.symbol
    return tx?.mint ? formatAddress(tx.mint) : ''
}
