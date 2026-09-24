import { bootstrapWalletUi } from '../shared/bootstrap'
import { SURFACE_POPUP, SURFACE_WINDOW } from '../utils/uiSurface'
import { openSidePanelHere } from '../utils/openPanel'
import { readUiMode, UI_MODE_PANEL, panelOpenSupported } from '../utils/uiMode'

// Detect standalone window mode (opened via chrome.windows.create)
//
// Arka plan onay penceresini `index.html#window` ile aciyor (dappFunctions.js
// openApprovalWindow). Hash kontrolu duserse acilir listedeki popup da pencere
// modu kurallarina girer ve 360x600 sabiti bozulur.
// Kaynak kilidi: popup/popupStandaloneWindow.test.js.
const pencereModu = window.location.hash === '#window'
if (pencereModu) {
  document.documentElement.classList.add('standalone-window')
}

// Oturum yasinin TEK sahibi arka plandir: `lock_timer` + `lastActiveTime` +
// lockWallet(). Burada eskiden ikinci bir kural vardi (15 dakikadan eski damga
// -> oturum tamamen siliniyordu). Kaynak kilidi: popup/sessionLifecycle.test.js.

/**
 * POPUP KOPRUSU.
 *
 * chrome.action.setPopup({popup:''}) KALICI DEGILDIR: tarayici yeniden
 * baslayinca manifest'teki default_popup geri gelir ve kullanicinin o ilk
 * tiklamasi -- tercihi yan panel olsa bile -- popup'i acar. onStartup bunu
 * duzeltir ama YARISTADIR; kullanici daha hizli olabilir.
 *
 * Bu yuzden popup, acilmasinin KENDISINI bir kullanici hareketi olarak kullanir:
 * paneli acar ve kendini kapatir. Boylece kullanici hicbir zaman "yanlis"
 * yuzeyde kalmaz.
 *
 * ONAY PENCERESI HARIC: dapp onayi ayri pencerede kalir (S7.1). Orayi panele
 * cevirmek, "kullanici pencereyi kapatti -> istegi reddet" sinyalini yok eder
 * ve dapp'i sonsuza kadar askida birakirdi.
 *
 * PARALEL BASLATMA (duzeltme): mod okumasi (readUiMode -> chrome.storage.local.get)
 * VE pencere aramasi (chrome.windows.getCurrent) ikisi de GERCEK birer chrome
 * IPC gidis-donusudur -- microtask degil. Sirali beklenselerdi open()'a kadar
 * IKI round-trip gecerdi ve kullanici hareketi butcesi (bkz. utils/openPanel.js)
 * bu fonksiyona hic ulasmadan tukenebilirdi. Bu yuzden ikisi BIRLIKTE baslatilir;
 * openSidePanelHere zaten baslamis pencere sonucunu devralir, KENDI aramasini
 * yapmaz.
 */
async function kopruDene() {
  if (pencereModu) return false
  // `.catch` SART: bu arama mod OKUNMADAN once baslatiliyor (paralellik
  // BILEREK, yukaridaki nota bak). Popup modunda `kopruDene` bir satir sonra
  // `false` donuyor ve promise HIC beklenmiyor -- reddederse islenmemis bir
  // promise reddi olur. `undefined`a dusen sonuc zararsizdir:
  // `openSidePanelHere` `typeof w?.id !== 'number'` kapisinda `false` doner.
  const pencereBeklemesi = panelOpenSupported()
    ? chrome.windows.getCurrent().catch(() => undefined)
    : null
  const mode = await readUiMode()
  if (mode !== UI_MODE_PANEL) return false
  return openSidePanelHere(pencereBeklemesi)
}

kopruDene().then((acildi) => {
  if (acildi) {
    window.close()
    return
  }
  bootstrapWalletUi({ surface: pencereModu ? SURFACE_WINDOW : SURFACE_POPUP })
})
