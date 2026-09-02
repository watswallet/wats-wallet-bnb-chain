import { createApp } from 'vue'
import App from './App.vue'
import { createPinia } from 'pinia'
import './style.css'
import { pageStore } from '../store/pageStore'
import { userStore } from '../store/user'
import { cryptoStore } from '../store/crypto'
import { networkStore } from '../store/network'
import i18n from '../i18n'
import { connectPopupPort } from '../utils/popupPort'

// Detect standalone window mode (opened via chrome.windows.create)
if (window.location.hash === '#window') {
  document.documentElement.classList.add('standalone-window')
}

// Popup acik oldugu surece background ile bir port acik kalir; koptugunda
// background "Kilit suresi: Hemen" secilmisse cuzdani kilitler.
connectPopupPort()

const app = createApp(App)
const pinia = createPinia()

window.addEventListener('beforeunload', () => {
  const sessionData = { isLoggedIn: true, timestamp: Date.now() }  
  chrome.storage.session.set({ sessionData })
})

chrome.storage.session.get('sessionData', (result) => {
  if (result.sessionData) {
    const { timestamp } = result.sessionData
    const sessionAge = Date.now() - timestamp
    const maxAge = 15 * 60 * 1000
    
    if (sessionAge > maxAge) chrome.storage.session.clear()
  }
})

chrome.runtime.onMessage.addListener(async(msg) => {
  const page = pageStore()
  const user = userStore()
  const crypto = cryptoStore()
  const network = networkStore()

  if (msg.type === "DAPP_CONNECTION") {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_UNLOCK' })
    if(response.unlocked) {
      const { active_account } = await chrome.storage.local.get('active_account')

      user.address = active_account.address
      page.currentPage = 'connect_dapp'

    } else{
      page.currentPage = 'welcome'
      page.redirect = 'connect_dapp'
    }
  }

  if (msg.type === "DAPP_SIGN_MESSAGE") {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_UNLOCK' })
    if(response.unlocked) {
      const { active_account } = await chrome.storage.local.get('active_account')

      user.address = active_account.address
      page.currentPage = 'sign_message'

    } else{
      page.currentPage = 'welcome'
      page.redirect = 'sign_message'
    }

    crypto.user_message = msg.message
  }

  if (msg.type === "DAPP_SEND_TX") {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_UNLOCK' })
    if(response.unlocked) {
      const { active_account } = await chrome.storage.local.get('active_account')

      user.address = active_account.address
      crypto.transactionData = { from: msg.from, to: msg.to, amount: msg.amount, asset: msg.asset, network: network.currentNetwork.name }
      page.currentPage = 'dapp_router'

    } else{
      crypto.transactionData = { from: msg.from, to: msg.to, amount: msg.amount, asset: msg.asset, network: network.currentNetwork.name }
      page.currentPage = 'welcome'
      page.redirect = 'dapp_router'
    }
  }
})

app.use(i18n)
app.use(pinia)
app.mount('#app')