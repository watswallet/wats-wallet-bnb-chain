// TON'da tekrar koruma seqno ile calisir: ayni seqno ile gonderilen ikinci islem
// sessizce DUSER. Kullanici "gitmedi" sanip tekrar gonderirse ilk islem sonradan
// onaylanabilir ve deger IKI KEZ gitmis olur.
//
// Bu yuzden bekleyen bir TON islemi varken ikincisine izin verilmez. Kapi ZINCIR
// BAZLI: EVM'de bekleyen bir islem TON gonderimini kilitlememeli.
//
// KAYIT SEKLI — background.js:updateTxStatus BUNU YAZIYOR, KAYNAK ORASI:
//   olusturma:  { id, status, meta: data, timestamp: Date.now() }
//   guncelleme: { ...eski, status, meta: { ...eski.meta, ...data } }
// yani `chainId` UST SEVIYEDE DEGIL, `meta.chainId` icinde yasiyor (data = { chainId,
// amount, type, ... }, meta'ya gomuluyor). `timestamp` ise UST SEVIYEDE ve yalnizca
// olusturmada yaziliyor, guncellemede `...eski` spread'i ile korunuyor. Bu ayrim
// TransactionStatus.vue'da da ayni sekilde okunuyor (`tx.meta.chainId`,
// `explorerTxUrl(tx?.meta?.chainId, ...)`) — iki taraf da AYNI seklini varsayiyor.
// Biri degisirse (ör. meta duzlestirilirse) burasi da GUNCELLENMELI, aksi halde kapi
// sessizce hicbir seyi engellemez hale gelir (bu dosyanin daha once yasadigi hata).
import { isTon } from '../chainKind'

const PENDING = new Set(['queued', 'processing'])

export const TON_PENDING_MAX_AGE_MS = 5 * 60 * 1000 // 5 dakika

// KAPININ BIR CIKISI OLMAK ZORUNDA: `waitForSeqno` sonucu gelmeden service worker
// olurse (bilgisayar uykuya girer, Chrome yeniden baslar, SW crash olur) TON kaydi
// storage'da sonsuza dek 'processing' kalabilir — cunku TON'da islem hash'i gonderim
// aninda ELDE DEGIL, `checkAndRecoverPendingTxs` (background.js) yalnizca txHash'i
// olan kayitlari kurtarabiliyor ve TON kayitlari asla txHash almiyor. Yas siniri
// olmadan bu durum kullaniciyi KALICI OLARAK TON gonderemez hale getirir — kapinin
// onlemeye calistigi riskin (deger iki kez gitmesi) tam tersi bir hasar.
//
// 5 DAKIKA GUVENLI: kapinin asil amaci, ilk islem henuz bloga girmemisken ikinci
// islemin AYNI seqno ile gonderilip sessizce dusmesini engellemek. `sendTon` her
// cagrida `getSeqno()`'yu TAZE okur: ilk islem bloga girdiyse seqno artmistir ve
// ikinci gonderim yeni seqno alir (cakisma yok); girmediyse zaten ayni seqno riski
// vardir — ama TON bloklari ~5 saniyede bir uretilir, yani birkac dakika icinde
// islem KESIN olarak (basarili ya da basarisiz) cozulmus olur. 5 dakika bu payin
// kat kat uzerinde, hem kilitlenmeyi acar hem cift harcama korumasini korur.
//
// `timestamp` alani olmayan (eski/bozuk) kayitlar GUVENLI YONE dusurulur: bunlar
// ENGELLEMEZ (kilitlenmeyi degil, cok nadir bir cakisma ihtimalini tercih ederiz —
// timestamp'siz bir kaydin ne zaman kuyruklandigini bilemedigimiz icin onu "hala
// taze" saymak, kullaniciyi kalici kilitlemekten cok daha az zararlidir).
export function hasPendingTonTx(transactions, now = Date.now()) {
    if (!Array.isArray(transactions)) return false
    return transactions.some((t) => {
        if (!t) return false
        // Asil kaynak meta.chainId (bkz. dosya basi notu); ust seviye yalnizca YEDEK
        // — updateTxStatus HICBIR ZAMAN chainId'yi ust seviyeye yazmiyor, ama baska
        // bir cagiran/eski bir kayit boyle birakmis olabilirse diye korunuyor.
        const chainId = t.meta?.chainId ?? t.chainId
        if (!isTon(chainId) || !PENDING.has(t.status)) return false
        // timestamp yoksa engellemeyiz (guvenli yon: kilitlenme degil).
        if (typeof t.timestamp !== 'number') return false
        return now - t.timestamp < TON_PENDING_MAX_AGE_MS
    })
}
