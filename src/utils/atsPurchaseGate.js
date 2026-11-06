// GIZLI MODDA ATS SATIN ALMA KAPALI MI -- TEK KOSUL (gizli-mod cok-ag spec 4.5 madde 2, K13, E18).
//
// Gizleme noktalari (useAtsPurchase.openAtsPurchase, AtsBuyButton, AtsFuelPill, Swap) K13 oncesinde duz `privacy.active`
// idi. K13 ile hepsi AYNI kosula baglanir: gizli mod VE PRIVATE_ATS_SALE kapali. Noktalar SILINMEZ: silinirlerse bayrak
// kapaliyken kullanici kapali bir yola yonlendirilirdi (kapi PRIVATE_ATS_SALE_BLOCKED der). SAF: yalniz featureFlags okur.
//
// Bu yardimci useAtsPurchase.js'ten de yeniden disa acilir; bilesenler BURADAN alir, cunku yedi bilesen testi
// '../composables/useAtsPurchase' modulunu tumuyle taklit eder ve yeni bir adli disa aktarimi orada bulamazdi.
import { PRIVATE_ATS_SALE } from './featureFlags'

/** @param {{active?: boolean}|null|undefined} privacy privacyStore() ornegi; @param {boolean} [flag] testler icin */
export const atsPurchaseBlocked = (privacy, flag = PRIVATE_ATS_SALE) => privacy?.active === true && flag !== true
