// AKTIVITE SUNUCUSUNUN GECMIS VERDIGI AGLAR (gizli-mod cok-ag spec 4.1 "Aktivite sunucusu", 4.7 satir 8).
//
// `POST /wallet/history` (server/controllers/walletController.js) yalniz `CHAINS` tablosundaki aglar icin Moralis'e
// gider; digerlerine `400 Unsupported chain` doner. Gizli modda bu istek Gizli adresi ve IP'yi sunucumuza (ve
// sunucumuz Moralis'e) gonderir: sunucunun zaten reddedecegi aglarda HIC gonderilmemelidir (History.vue ozel modda
// bu kapiyi kullanir; normal mod eskisi gibi her agda sorar).
//
// IKINCI BIR LISTE TUTULMAZ (PF-DD1): kaynak deliveryChains.js tablosunun `activityServer` alanidir ve
// deliveryChains.test.js o alani sunucu dosyasina kilitler. Tabloda olmayan ag (ornegin 43114, sunucu verir ama
// teslim agi degildir) KAPALI-BASARISIZ sayilir: ozel modda gecmis istenmez (gizlilik yonunde hata).
// Yalniz saf deliveryChains.js import edilir (popup paketine girer).
import { deliveryChainOf } from './privacy/deliveryChains'

/** Aktivite sunucusu bu zincir icin gecmis verir mi? Kimlik sayi ya da rakam dizgesi olabilir; EVM disi / bilinmeyen false. */
export function historyServerSupports(chainId) {
    return deliveryChainOf(chainId)?.activityServer === true
}
