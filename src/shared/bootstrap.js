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
import App from '../popup/App.vue'
import '../popup/style.css'
import { pageStore } from '../store/pageStore'
import { userStore } from '../store/user'
import { cryptoStore } from '../store/crypto'
import { networkStore } from '../store/network'
import i18n from '../i18n'
import { connectPopupPort } from '../utils/popupPort'
import { SURFACE_PANEL, SURFACE_POPUP } from '../utils/uiSurface'
import { installUiSync } from '../utils/uiSync'

// Panel N pencerede acik olabilir; bootstrapWalletUi her pencerede bir kez
// cagrilir ama modul kapsami (Vite'ta HMR, testte tekrar cagrida) paylasilir.
// Onceki dinleyiciyi kapatmadan yenisini kurmak listener SIZDIRIRDI -- bkz.
// utils/uiSync.js'teki idempotent start() yorumu, ayni sizinti sinifi.
let uiSyncTeardown = null

/**
 * @param {{surface?: string}} opts
 */
export function bootstrapWalletUi({ surface = SURFACE_POPUP } = {}) {
  // Arayuz acik oldugu surece arka planla bir port acik kalir. Kopma NORMALDIR
  // (MV3'te SW ~30 sn atalette oluyor ve acik port onu ayakta tutmuyor);
  // connectPopupPort kendi kendine yeniden baglanir. Kilit karari tek bir
  // kopmaya degil, ACIK ARAYUZ SAYISINA bakar (utils/uiRegistry.js).
  connectPopupPort()

  const app = createApp(App)
  const pinia = createPinia()

  chrome.runtime.onMessage.addListener(async (msg) => {
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
  })

  app.use(i18n)
  app.use(pinia)

  // PANELLER ARASI SENKRON. Panel N pencerede acik olabilir ve her biri ayri
  // bir Vue ornegidir; bir pencerede yapilan degisiklik digerine ULASMALI.
  // Store'lar ve i18n burada ENJEKTE edilir (bkz. utils/uiSync.js basindaki
  // TASARIM notu) -- bootstrapWalletUi tekrar cagrilirsa (HMR, test) onceki
  // dinleyici once kapatilir, yoksa listener SIZAR.
  uiSyncTeardown?.()
  uiSyncTeardown = installUiSync({ userStore, networkStore, i18n })

  app.mount('#app')

  return { app, surface }
}
