// errors.js -- eth_signTypedData_v4 hata sabitleri.
//
// Kullanici-reddi metni TEK yerde durur: onay ekrani, arka plan isleyicisi ve
// (sonradan eklenecek) gizli-mod girisi AYNI metni kullanir. Metin dapp'e
// gorunur (Ingilizce, EIP-1193 4001 ile birlikte gider) ve "user rejected"
// ifadesi YALNIZ gercek kullanici reddinde uretilir; baska hicbir hata yolu bu
// sabiti kullanmaz.
export const TYPED_DATA_USER_REJECT_MESSAGE = 'User rejected the request.'
