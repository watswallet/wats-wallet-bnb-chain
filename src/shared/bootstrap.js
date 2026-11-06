/**
 * Popup ve yan panelin ORTAK onyuklemesi.
 *
 * Iki giris noktasi (src/popup/main.js ve src/sidepanel/main.js) AYNI Vue
 * uygulamasini mount eder; aralarindaki tek fark hangi yuzey isaretini
 * koyduklaridir. Govdeyi kopyalamak yerine buraya cikarildi -- kopya olsaydi
 * iki yuzey zamanla ayrisirdi ve fark yalnizca birinde gorunen bir hatayla
 * ortaya cikardi.
 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import axios from 'axios'
import App from '../popup/App.vue'
import '../popup/style.css'
import { pageStore } from '../store/pageStore'
import { userStore } from '../store/user'
import { cryptoStore } from '../store/crypto'
import { networkStore } from '../store/network'
import { currencyStore } from '../store/currency'
import i18n from '../i18n'
import { connectPopupPort } from '../utils/popupPort'
import { SURFACE_ALERT, SURFACE_PANEL, SURFACE_POPUP } from '../utils/uiSurface'
import { installUiSync } from '../utils/uiSync'
import { privacyStore } from '../store/privacy'
import { installPrivacySync } from '../utils/privacy/privacyUiSync'
import { installPriceGate } from '../utils/privacy/priceGate'
import { PRIVACY_ENABLED } from '../utils/featureFlags'

// Panel N pencerede acik olabilir; bootstrapWalletUi her pencerede bir kez
// cagrilir ama modul kapsami (Vite'ta HMR, testte tekrar cagrida) paylasilir.
// Onceki dinleyiciyi kapatmadan yenisini kurmak listener SIZDIRIRDI -- bkz.
// utils/uiSync.js'teki idempotent start() yorumu, ayni sizinti sinifi.
let uiSyncTeardown = null
let privacySyncTeardown = null
let priceGateTeardown = null

// Acilista secili para biriminin ilk karede dogru cizilmesi icin mount, YALNIZ
// para birimi deposunun DISK okumasini bu kadar bekler (ust sinir). Asilirsa mount
// devam eder, init arkada biter. Ag yenilemesi (refreshRates) hicbir kosulda beklenmez.
export const CURRENCY_INIT_WAIT_MS = 500

/**
 * `promise`i en fazla `ms` bekler; ikisinden hangisi once biterse cozulur. HICBIR
 * durumda reddetmez (init hatasi mount'u engellememeli). Zamanlayici sizdirilmaz.
 * @param {Promise<unknown>} promise
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function waitAtMost(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    Promise.resolve(promise).then(
      () => { clearTimeout(timer); resolve() },
      () => { clearTimeout(timer); resolve() },
    )
  })
}

/**
 * @param {{surface?: string}} opts
 */
export function bootstrapWalletUi({ surface = SURFACE_POPUP } = {}) {
  // B2: TonConnect uyari penceresi (utils/tonAlert.js) cuzdan arayuzu DEGIL.
  // Port acsaydi acik arayuz sayilir, kilit karari onu beklerdi. Async dapp
  // dinleyicisi her runtime mesajina bir Promise doner; uyari penceresi baska
  // sayfalarin mesajlarina karismasin diye hic kurulmaz.
  const uyariYuzeyi = surface === SURFACE_ALERT

  // Arayuz acik oldugu surece arka planla bir port acik kalir. Kopma NORMALDIR
  // (MV3'te SW ~30 sn atalette oluyor ve acik port onu ayakta tutmuyor);
  // connectPopupPort kendi kendine yeniden baglanir. Kilit karari tek bir
  // kopmaya degil, ACIK ARAYUZ SAYISINA bakar (utils/uiRegistry.js).
  if (!uyariYuzeyi) connectPopupPort()

  const app = createApp(App)
  const pinia = createPinia()

  const dappMesajDinleyicisi = async (msg) => {
    // S7.1 -- DAPP ONAYI PANELE GIRMEZ. App.vue'daki `current_request`
    // kapisiyla AYNI kural, ikinci yol.
    //
    // Asagidaki uc dalin (DAPP_CONNECTION / DAPP_SIGN_MESSAGE / DAPP_SEND_TX)
    // depoda GONDERENI YOK -- gercek yonlendirme `current_request` uzerinden
    // yurur -- ve content.js'in `isPagePayloadAllowed` kapisi `type` tasiyan
    // sayfa yuklerini zaten reddediyor, yani bugun somurulebilir DEGIL. Blok
    // yine de SILINMIYOR: ConfirmTransaction.solana.ssr.test.js dapp
    // trafiginin `dapp_router`a gittigini, cuzdan ici gonderim onayina ise
    // GITMEDIGINI tam bu dizgeler uzerinden kilitliyor (o kilit bu dosyada o
    // sayfa adinin GECMEDIGINI de sart kosar -- burada acikca yazilamaz).
    //
    // Ama blok artik PANELE de kuruluyor ve GONDEREN KONTROLU YOK: bir gun
    // bir gonderen ortaya cikarsa kapanmayan yuzey dogrudan bir onay ekranina
    // atlardi. Kapi bu yuzden simdiden konuyor.
    if (surface === SURFACE_PANEL) return

    const page = pageStore()
    const user = userStore()
    const crypto = cryptoStore()
    const network = networkStore()

    if (msg.type === "DAPP_CONNECTION") {
      const response = await chrome.runtime.sendMessage({ type: 'CHECK_UNLOCK' })
      if (response.unlocked) {
        const { active_account } = await chrome.storage.local.get('active_account')

        user.address = active_account.address
        page.currentPage = 'connect_dapp'

      } else {
        page.currentPage = 'welcome'
        page.redirect = 'connect_dapp'
      }
    }

    if (msg.type === "DAPP_SIGN_MESSAGE") {
      const response = await chrome.runtime.sendMessage({ type: 'CHECK_UNLOCK' })
      if (response.unlocked) {
        const { active_account } = await chrome.storage.local.get('active_account')

        user.address = active_account.address
        page.currentPage = 'sign_message'

      } else {
        page.currentPage = 'welcome'
        page.redirect = 'sign_message'
      }

      crypto.user_message = msg.message
    }

    if (msg.type === "DAPP_SEND_TX") {
      const response = await chrome.runtime.sendMessage({ type: 'CHECK_UNLOCK' })
      if (response.unlocked) {
        const { active_account } = await chrome.storage.local.get('active_account')

        user.address = active_account.address
        crypto.transactionData = { from: msg.from, to: msg.to, amount: msg.amount, asset: msg.asset, network: network.currentNetwork.name }
        page.currentPage = 'dapp_router'

      } else {
        crypto.transactionData = { from: msg.from, to: msg.to, amount: msg.amount, asset: msg.asset, network: network.currentNetwork.name }
        page.currentPage = 'welcome'
        page.redirect = 'dapp_router'
      }
    }
  }
  // K1: kayitli dinleyici ASYNC OLAMAZ. Async bir fonksiyonu dogrudan kaydetmek
  // her runtime mesajina bir Promise dondurur; Chromium bunu "bu sayfa yanitladi:
  // undefined" sayar ve ayni mesaji bekleyen ARKA PLANIN gercek yanitini ezer
  // -- popup ya da onay penceresi aciksa dapp "bos yanit" (-32603) alirdi. Is
  // bu yuzden yukaridaki async fonksiyonda kosar; dinleyici onu BASLATIR,
  // sonucunu BEKLEMEZ ve `false` dondurur (yanit gonderilmez, kanal acik
  // kalmaz). Govdenin hatalari eskisi gibi yakalanmamis reddedilme olarak
  // konsola duser (bilerek yutulmuyor).
  if (!uyariYuzeyi) {
    chrome.runtime.onMessage.addListener((msg) => {
      void dappMesajDinleyicisi(msg)
      return false
    })
  }

  app.use(i18n)
  app.use(pinia)

  // PANELLER ARASI SENKRON. Panel N pencerede acik olabilir ve her biri ayri
  // bir Vue ornegidir; bir pencerede yapilan degisiklik digerine ULASMALI.
  // Store'lar ve i18n burada ENJEKTE edilir (bkz. utils/uiSync.js basindaki
  // TASARIM notu) -- bootstrapWalletUi tekrar cagrilirsa (HMR, test) onceki
  // dinleyici once kapatilir, yoksa listener SIZAR.
  uiSyncTeardown?.()
  uiSyncTeardown = installUiSync({ userStore, networkStore, i18n, currencyStore })

  // PARA BIRIMI: kayitli secim + kur gorunumu acilista bir kez yuklenir, saat ve
  // yenileme kurulur. Pinia app.use(pinia) ile AKTIF olduktan sonra; TonConnect
  // uyari penceresi cuzdan arayuzu degil, fiyat gostermez ve kur istegi atmamali.
  // init ATMAZ (hatalar depo icinde yutulur) ve ag sonucunu beklemez.
  //
  // MOUNT, secili birim diskten gelene kadar BEKLER (ust sinir CURRENCY_INIT_WAIT_MS):
  // beklenmezse ilk kare '$' ile cizilir, sonra 'USD 12.34', en sonda '₺' (BD2).
  // init yalniz DISK okumasini bekler (ag yenilemesi icinde `void`), yani bekleme
  // milisaniyeler surer; 500 ms asilirsa mount yine de olur. Uyari yuzeyi init
  // cagirmaz, beklemeden hemen mount eder.
  const mountApp = () => {
    if (uyariYuzeyi) {
      app.mount('#app')
    } else {
      void waitAtMost(currencyStore().init(), CURRENCY_INIT_WAIT_MS).then(() => app.mount('#app'))
    }
  }

  // GIZLI MOD FIYAT KESICISI (gizli-mod cok-ag spec 4.7, E6): ozel mod aktifken fiyat uclari ve CoinGecko
  // istekleri aga CIKMADAN reddedilir. Guvenlik agidir; asil davranis cagiran yerlerin atlamasidir.
  // Mod HER istekte store'dan okunur (mod bilesen yasarken degisir). Ayni teardown kurali.
  priceGateTeardown?.()
  priceGateTeardown = null
  if (PRIVACY_ENABLED) priceGateTeardown = installPriceGate(axios, () => privacyStore().active)

  // GIZLI MOD durumu (spec 5.4) -- ayni teardown kurali: tekrar cagrida once kapat.
  privacySyncTeardown?.()
  privacySyncTeardown = null
  if (PRIVACY_ENABLED) {
    // ACILISTA GIZLILIK DURUMU (gizli-mod cok-ag spec 4.7, E14): store `false` ile baslar ve butun gizli mod
    // kapilari (fiyat atlamalari, logo, Home sorgu kumesi) `privacyStore.active`e bakar. Durum yuklenmeden mount
    // edilirse ILK cizim ve ilk istekler, Gizli Hesap aktifken bile normal mod gibi calisir ve sizar. Bu yuzden
    // uygulama gizlilik senkronu BITINCE mount edilir. Senkron hata verirse (depo okunamadi) yine mount edilir ve
    // hata konsola yazilir: bos bir pencere birakmak kullaniciyi cuzdanindan kilitler; store `false` kalir ve
    // uiSync dinleyicisi kurulmadigi icin mod degisimi bu pencerede yansimaz (acik kabul).
    //
    // GECICI HATA: tek bir `storage.get` hatasi store'u pencere omru boyunca `false` birakirdi (yan paneller gunlerce
    // acik kalir). Bu yuzden senkron 2 sn sonra BIR kez daha denenir: basarili olursa store dolar ve kapilarin hepsi
    // canli kapanir. Ikinci deneme de reddedilirse durum `false` kalir (acik kabul) ve hata konsola yazilir.
    installPrivacySync({ privacyStore })
      .then((teardown) => { privacySyncTeardown = teardown })
      .catch((e) => {
        console.error('privacy sync:', e)
        setTimeout(() => {
          installPrivacySync({ privacyStore })
            .then((teardown) => { privacySyncTeardown = teardown })
            .catch((e2) => console.error('privacy sync (yeniden):', e2))
        }, 2000)
      })
      .then(mountApp)
  } else {
    mountApp()
  }

  return { app, surface }
}
