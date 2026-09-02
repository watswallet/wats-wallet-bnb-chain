<template>
  <TransactionStatus v-if="!['', 'welcome', 'forgot_password'].includes(page.currentPage)"></TransactionStatus>
  <Transition name="fade-slide" mode="out-in">
    <div :key="page.currentPage" class="page-wrapper">
      <Login v-if="page.currentPage === 'welcome'"></Login>
      <Home v-if="page.currentPage === 'home'"></Home>
      <Token v-if="page.currentPage === 'token'" :id="crypto.selected_token_id"></Token>
      <Send v-if="page.currentPage === 'send'"></Send>
      <SelectAssets v-if="page.currentPage === 'select_asset'"></SelectAssets>
      <ConfirmTransaction v-if="page.currentPage === 'confirm_transaction'"></ConfirmTransaction>
      <Dapp v-if="page.currentPage === 'dapp_router'"></Dapp>
      <Swap v-if="page.currentPage === 'swap'"></Swap>
      <SearchTokens v-if="page.currentPage === 'search_tokens'"></SearchTokens>
      <Bridge v-if="page.currentPage === 'bridge'"></Bridge>
      <SelectNetwork v-if="page.currentPage === 'select_network'"></SelectNetwork>
      <ImportToken v-if="page.currentPage === 'import_token'"></ImportToken>
      <BuyToken v-if="page.currentPage === 'buy_token'"></BuyToken>
      <Settings v-if="page.currentPage === 'settings'"></Settings>
      <Dapps v-if="page.currentPage === 'settings_dapps'"></Dapps>
      <DappPermissions v-if="page.currentPage === 'settings_dapp_permissions'" :dapp="page.data"></DappPermissions>
      <AddWallets v-if="page.currentPage === 'settings_add_wallet'"></AddWallets>
      <CreateAccount v-if="page.currentPage === 'settings_create_account'"></CreateAccount>
      <!-- <SelectPhrase v-if="page.currentPage === 'settings_select_phrase'"></SelectPhrase> -->
      <EditProfile v-if="page.currentPage === 'settings_edit_profile'"></EditProfile>
      <EditUsername v-if="page.currentPage === 'settings_edit_username'"></EditUsername>
      <ManageAccounts v-if="page.currentPage === 'settings_manage_accounts'" @selected="selectAccount"></ManageAccounts>
      <EditAccount v-if="page.currentPage === 'settings_edit_account' && selected_account" :account="selected_account"></EditAccount>
      <EditAccountName v-if="page.currentPage === 'settings_edit_account_name' && selected_account" :account="selected_account"></EditAccountName>
      <Preferences v-if="page.currentPage === 'settings_preferences'"></Preferences>
      <About v-if="page.currentPage === 'settings_about'"></About>

      <ShowPhrases v-if="page.currentPage === 'settings_show_phrases'" :account="selected_account" @mnemonic="setMnemonic"></ShowPhrases>
      <PhraseDisclaimer v-if="page.currentPage === 'settings_phrase_disclaimer'"></PhraseDisclaimer>
      <Phrases v-if="page.currentPage === 'settings_phrases'" :mnemonic="decodedMnemonic"></Phrases>

      <ShowPrivateKey v-if="page.currentPage === 'settings_show_private_key'" :account="selected_account" @private="setPrivateKey"></ShowPrivateKey>
      <PrivateKeyDisclaimer v-if="page.currentPage === 'settings_private_key_disclaimer'"></PrivateKeyDisclaimer>
      <PrivateKey v-if="page.currentPage === 'settings_private_key'" :private-key="privateKey"></PrivateKey>

      <!-- TON anahtari akisi: EVM'inkiyle AYNI uc adim (parola -> uyari -> anahtar).
           Uyari adimi PrivateKeyDisclaimer.vue'nin PAYLASILAN halidir -- metni zaten
           ag'a ozel bir sey soylemiyordu, bu yuzden ikinci bir disclaimer dosyasi
           acmak yerine hedef sayfalari (backPage/nextPage) ve TON'a ozgu ek notu
           (noteKey) prop olarak veriyoruz. -->
      <ShowTonKey v-if="page.currentPage === 'settings_show_ton_key' && selected_account" :account="selected_account" @ton-key="setTonKey"></ShowTonKey>
      <PrivateKeyDisclaimer
        v-if="page.currentPage === 'settings_ton_key_disclaimer'"
        back-page="settings_show_ton_key"
        next-page="settings_ton_key"
        note-key="settings.tonKey.note"
      ></PrivateKeyDisclaimer>
      <TonKey v-if="page.currentPage === 'settings_ton_key'" :ton-key="tonKeyData" @clear="clearTonKey"></TonKey>

      <SavedAddresses v-if="page.currentPage === 'settings_saved_addresses'" @edit-address="selectAddress"></SavedAddresses>
      <AddAddress v-if="page.currentPage === 'settings_add_address'"></AddAddress>
      <EditAddress v-if="page.currentPage === 'settings_edit_address'" :saved-address="selected_address" :saved-address-index="selected_address_index"></EditAddress>

      <Security v-if="page.currentPage === 'settings_security'"></Security>
      <ChangePassword v-if="page.currentPage === 'settings_security_change_password'"></ChangePassword>
      <LockTimer v-if="page.currentPage === 'settings_security_lock_timer'"></LockTimer>
      <ResetApp v-if="page.currentPage === 'settings_security_reset_app'"></ResetApp>
      <SelectPhrases v-if="page.currentPage === 'settings_security_select_phrases'" @vault="selectVault"></SelectPhrases>
      <UnlockVault v-if="page.currentPage === 'settings_security_unlock_vault'" :vault="selected_vault" @mnemonic="setMnemonic"></UnlockVault>
      <!-- Kasa da geciriliyor: bu ekran turetilmis EVM kasasinda "ana ifaden
           Tonkeeper ifadendir" notunu gostermeli ve bunu YALNIZCA kasadan
           anlayabilir - hesap yolundaki `account.tonFingerprint` burada yok. -->
      <ShowPhrase v-if="page.currentPage === 'settings_security_show_phrase'" :mnemonic="decodedMnemonic" :vault="selected_vault"></ShowPhrase>
      <PhrasesDisclaimer v-if="page.currentPage === 'settings_security_phrases_disclaimer'"></PhrasesDisclaimer>
      <ForgotPassword v-if="page.currentPage === 'forgot_password'"></ForgotPassword>

      <ConnectDapp v-if="page.currentPage === 'dapp_connect'"></ConnectDapp>
      <Sign v-if="page.currentPage === 'sign_message'"></Sign>
      <TonConnectApprove v-if="page.currentPage === 'ton_connect'"></TonConnectApprove>
      <TonSendTx v-if="page.currentPage === 'ton_send_tx'"></TonSendTx>
      <TonSignData v-if="page.currentPage === 'ton_sign_data'"></TonSignData>
    </div>
  </Transition>
</template>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Roboto:ital,wght@0,100..900;1,100..900&display=swap');

* {
  font-family: "Inter", sans-serif;
  scrollbar-gutter: stable overlay;
}

/* Scrollable custom bar */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.25);
  border-radius: 10px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255,255,255,0.4);
}

/* Border-radius fix */
.rounded-scroll {
  mask-image: radial-gradient(white, black);
  -webkit-mask-image: -webkit-radial-gradient(white, black);
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all .25s ease;
}
.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

/* Scrollbar Genişliği */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}

/* Scrollbar Yolu (Track) */
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

/* Scrollbar Tutamacı (Thumb) - Varsayılan (Koyu Tema) */
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: #27272a; /* zinc-800 */
  border-radius: 20px;
  transition: background-color 0.3s ease;
}

/* Scrollbar Tutamacı - Hover Durumu */
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: #3f3f46; /* zinc-700 */
}

/* --- AÇIK TEMA UYARLAMASI --- */
/* Eğer projenizde 'dark' class'ı kullanılıyorsa: */
:root:not(.dark) .custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: #d1d5db; /* slate-300 */
}

:root:not(.dark) .custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: #9ca3af; /* slate-400 */
}

/* Alternatif olarak, sistem temasına göre otomatik geçiş isterseniz: */
@media (prefers-color-scheme: light) {
  /* Eğer HTML üzerinde 'dark' class'ı yoksa bu stil aktif olur */
  :root:not(.dark) .custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: #d1d5db;
  }
}
</style>

<script setup>
import { pageStore } from '../store/pageStore'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { findFastestRPC } from '../utils/testRPC'
import { isEvm } from '../utils/chainKind'
import { networkStore } from '../store/network'
import { userStore } from '../store/user'
import { cryptoStore } from '../store/crypto'

import Home from '../components/Home.vue'
import { ALL_CHAINS as chains } from '../data/chains'
import { isDappRequestStale } from '../utils/dappRequestGuard'
import Send from '../components/Send.vue'
import SelectAssets from '../components/SelectAssets.vue'
import ConfirmTransaction from '../components/ConfirmTransaction.vue'
import Swap from '../components/Swap.vue'
import Bridge from '../components/Bridge.vue'
import SearchTokens from '../components/SearchTokens.vue'
import SelectNetwork from '../components/SelectNetwork.vue'
import ImportToken from '../components/ImportToken.vue'
import axios from 'axios'
import BuyToken from '../components/BuyToken.vue'
import ConnectDapp from '../components/dapp/ConnectDapp.vue'
import Sign from '../components/dapp/Sign.vue'
import TonConnectApprove from '../components/dapp/TonConnectApprove.vue'
import TonSendTx from '../components/dapp/TonSendTx.vue'
import TonSignData from '../components/dapp/TonSignData.vue'
import Settings from '../components/Settings.vue'
import Dapps from '../components/settings/Dapps.vue'
import DappPermissions from '../components/settings/DappPermissions.vue'
import AddWallets from '../components/settings/AddWallets.vue'
import CreateAccount from '../components/settings/CreateAccount.vue'
import Login from '../components/Login.vue'
import SelectPhrase from '../components/settings/SelectPhrase.vue'
import EditProfile from '../components/settings/profile/EditProfile.vue'
import EditUsername from '../components/settings/profile/EditUsername.vue'
import ManageAccounts from '../components/settings/accounts/ManageAccounts.vue'
import EditAccount from '../components/settings/accounts/EditAccount.vue'
import EditAccountName from '../components/settings/accounts/EditAccountName.vue'
import PhraseDisclaimer from '../components/settings/accounts/PhraseDisclaimer.vue'
import ShowPhrases from '../components/settings/accounts/ShowPhrases.vue'
import Phrases from '../components/settings/accounts/Phrases.vue'
import ShowPrivateKey from '../components/settings/accounts/ShowPrivateKey.vue'
import PrivateKeyDisclaimer from '../components/settings/accounts/PrivateKeyDisclaimer.vue'
import PrivateKey from '../components/settings/accounts/PrivateKey.vue'
import ShowTonKey from '../components/settings/accounts/ShowTonKey.vue'
import TonKey from '../components/settings/accounts/TonKey.vue'
import SavedAddresses from '../components/settings/addresses/SavedAddresses.vue'
import AddAddress from '../components/settings/addresses/AddAddress.vue'
import EditAddress from '../components/settings/addresses/EditAddress.vue'
import Security from '../components/settings/Security.vue'
import ChangePassword from '../components/settings/security/ChangePassword.vue'
import LockTimer from '../components/settings/security/LockTimer.vue'
import ResetApp from '../components/settings/security/ResetApp.vue'
import SelectPhrases from '../components/settings/security/SelectPhrases.vue'
import UnlockVault from '../components/settings/security/UnlockVault.vue'
import ShowPhrase from '../components/settings/security/ShowPhrase.vue'
import PhrasesDisclaimer from '../components/settings/security/PhrasesDisclaimer.vue'
import Token from '../components/Token.vue'
import { useTransactionStore } from '../store/transaction'
import TransactionStatus from '../components/TransactionStatus.vue'
import ForgotPassword from '../components/ForgotPassword.vue'
import Preferences from '../components/settings/Preferences.vue'
import About from '../components/settings/About.vue'
import { configStore } from '../store/config'
import { useDark, useToggle } from '@vueuse/core'
import Dapp from '../components/Dapp.vue'

const page = pageStore()
const network = networkStore()
const user = userStore()
const crypto = cryptoStore()
const config = configStore()

const selected_address = ref(null)
// SavedAddresses.vue kaydin listedeki INDISINI de yayinlar; EditAddress.vue
// depodaki kaydi BUNUNLA bulur (bkz. SavedAddresses.vue'deki gerekce -- ne
// `label` ne `address` benzersiz).
const selected_address_index = ref(null)
const selected_account = ref(null)
const decodedMnemonic = ref(null)
const selected_vault = ref(null)
const privateKey = ref(null)
const tonKeyData = ref(null)
const transitionName = ref('fade')
const previousPage = ref('')

const txStore = useTransactionStore()

const isDark = useDark({
  selector: 'html',
  attribute: 'class',
  valueDark: 'dark',
  valueLight: 'light',
})
useToggle(isDark)

// Sayfa değişikliklerini izle ve animasyon tipini belirle
watch(() => page.currentPage, (newPage, oldPage) => {
  previousPage.value = oldPage
  
  if (newPage.startsWith('settings_') && oldPage.startsWith('settings_')) {
    const newDepth = newPage.split('_').length
    const oldDepth = oldPage.split('_').length
    transitionName.value = newDepth > oldDepth ? 'slide' : 'slide-back'
  }

  else if (['home', 'send', 'swap', 'bridge'].includes(newPage)) transitionName.value = 'zoom'
  else if (['connect_dapp', 'sign_message', 'select_asset', 'select_network'].includes(newPage)) transitionName.value = 'scale'
  else transitionName.value = 'fade'
})

const getImportedTokens = async() => {
  try {
    const { data } = await axios.get(config.api + '/getImportedTokens')
    if(!data) return

    return data.importedTokens
    
  } catch (error) {
    console.error(error.message)
  }
}

const selectAddress = (data, index) => {
  selected_address.value = data
  selected_address_index.value = index
}

const selectVault = data => {
  selected_vault.value = data
}

const selectAccount = data => {
  selected_account.value = data
  page.currentPage = 'settings_edit_account'
}

const setMnemonic = data => {
  decodedMnemonic.value = data
}

const setPrivateKey = data => {
  privateKey.value = data
}

const setTonKey = data => {
  tonKeyData.value = data
}

// TonKey.vue kapanirken (Bitti/Geri -> unmount) 'clear' emit eder; ham anahtar
// bu ust seviye ref'te asili kalmasin diye burada da null'a cekiyoruz.
const clearTonKey = () => {
  tonKeyData.value = null
}

onMounted(async() => {
  window.addEventListener('mousemove', sendHeartbeat)
  window.addEventListener('click', sendHeartbeat)
  window.addEventListener('keydown', sendHeartbeat)

  txStore.initListener() 
 
  const { vaults } = await chrome.storage.local.get('vaults') 
  if(!vaults || !vaults.length) { 
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") }) 
    window.close() 
    return 
  } 
 
  let { currentNetwork } = await chrome.storage.local.get('currentNetwork') 
  if (!currentNetwork) { 
    const eth = chains.find(chain => chain.chainId === 1) 
    await chrome.storage.local.set({ currentNetwork: eth }) 
    currentNetwork = eth 
  } 
 
  const { active_account, imported_tokens } = await chrome.storage.local.get(['active_account', 'imported_tokens'])

  const response = await chrome.runtime.sendMessage({ type: 'CHECK_UNLOCK' })
  if(response.unlocked) {
    user.address = active_account.address

    const { current_request } = await chrome.storage.local.get('current_request')

    // F5 (kod incelemesi): `current_request` STALE olabilir. resolvePendingRequest
    // (dappFunctions.js) onu yalniz `pendingRequests` Map'inde bir kayit VARSA
    // temizler; bu Map modul-kapsaminda ve bir MV3 service-worker yeniden
    // baslatilmasinda (uzanti guncellemesi, tarayici uyku modu...) BOSALIR --
    // yani eski bir istek DISKTE kalabilir, popup'i bir dapp ekranina yonlendirir.
    // Dapp.vue/ConnectDapp.vue/Sign.vue TAMAMEN EVM'e ozel (Dapp.vue guard'siz
    // currentNetwork.rpc[0].url okur); aktif ag Solana'ysa (bkz. eth_requestAccounts/
    // eth_sendTransaction'in artik reddettigi durum) bu istek ARTIK GECERSIZDIR --
    // zaten hicbir zaman yeni bir istek bu sekilde yazilamazdi, yalniz eskisi.
    if (isDappRequestStale(current_request, currentNetwork)) {
      await chrome.storage.local.remove('current_request')
      page.currentPage = 'home'
    } else if (current_request) {
      switch (current_request.type) {
        case 'CONNECT':
          page.currentPage = 'dapp_connect'
          break
        case 'SEND_TX':
          page.currentPage = 'dapp_router'
          break
        case 'SIGN_MESSAGE':
          page.currentPage = 'sign_message'
          break
        case 'TON_CONNECT':
          page.currentPage = 'ton_connect'
          break
        case 'TON_SEND_TX':
          page.currentPage = 'ton_send_tx'
          break
        case 'TON_SIGN_DATA':
          page.currentPage = 'ton_sign_data'
          break
        default:
          page.currentPage = 'home'
        }
    } else {
      page.currentPage = 'home'
    }

  } else {
    // Wallet is locked — check if there's a pending dapp request
    const { current_request } = await chrome.storage.local.get('current_request')
    // F5: kilit ekraninda da AYNI kontrol -- kasa acildiginda page.redirect
    // uzerinden AYNI EVM'e ozel ekranlara gidilir.
    if (isDappRequestStale(current_request, currentNetwork)) {
      await chrome.storage.local.remove('current_request')
    } else if (current_request) {
      switch (current_request.type) {
        case 'CONNECT':
          page.redirect = 'dapp_connect'
          break
        case 'SEND_TX':
          page.redirect = 'dapp_router'
          break
        case 'SIGN_MESSAGE':
          page.redirect = 'sign_message'
          break
        case 'TON_CONNECT':
          page.redirect = 'ton_connect'
          break
        case 'TON_SEND_TX':
          page.redirect = 'ton_send_tx'
          break
        case 'TON_SIGN_DATA':
          page.redirect = 'ton_sign_data'
          break
      }
    }
    page.currentPage = 'welcome'
  } 
 
  if(!imported_tokens || !imported_tokens[active_account.key]) { 
    const importedTokens = await getImportedTokens() 
    const new_imported_tokens = { 
      ...imported_tokens, 
      [active_account.key]: importedTokens 
    } 
    await chrome.storage.local.set({ imported_tokens: new_imported_tokens }) 
  } 
 
  let isReconnecting = false 

  const reconnect = async () => {
    if (isReconnecting) return
    isReconnecting = true

    try {
      // Mount anındaki `currentNetwork` local'i DEĞİL, canlı store okunur. Aksi halde
      // kullanıcı ağ değiştirdikten sonra bu izleyici 5 saniyede bir network.rpc'yi
      // ÖNCEKİ zincire geri çekiyordu: bakiye ve gas kontrolleri yanlış zincirden.
      const active = network.currentNetwork

      // TON'da RPC yarisi anlamsiz: liste bos, uc backend proxy'si. Kapi olmadan
      // findFastestRPC bos listeyle calisip network.rpc'yi beklenmedik bir degere ceker.
      if (!isEvm(active)) return

      if (!active?.rpc) return

      const rpcList = !active.rpc?.length
        ? Object.values(active.rpc).map(r => r.url)
        : active.rpc.map(r => r.url)

      const bestRpc = await findFastestRPC(rpcList)
      if (bestRpc?.url) network.setRpc(bestRpc.url, active.chainId)
    } catch (error) {
      console.error("RPC Bulunamadı:", error)
    } finally {
      isReconnecting = false
    }
  }

  const checkConnection = async () => {
    if (!network.rpc) return false
    try {
      const res = await fetch(network.rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1
        })
      })
      return res.ok // 200 OK dönerse bağlantı var demektir
    } catch (e) {
      return false
    }
  }

  const startConnectionWatcher = () => {
    reconnect().then(() => {
      setInterval(async () => {
        const isOnline = await checkConnection()
        
        if (!isOnline && !isReconnecting) {
          console.warn("Connect disconnected! Reconnecting...")
          await reconnect()
        }
      }, 5000) 
    })
  }

  startConnectionWatcher()

  chrome.storage.onChanged.addListener(async (changes, namespace) => {
    if (namespace === 'local' && changes.current_request !== undefined) {
      const newVal = changes.current_request.newValue
      // F5: AYNI kontrol canli yazimlar icin de gecerli -- background bugun
      // Solana aktifken yeni bir istek YAZAMAZ (eth_requestAccounts/eth_sendTransaction
      // giriste reddeder), ama bu dinleyici HERHANGI bir current_request yazimini
      // dinliyor; ikinci bir savunma katmani olarak burada da dogrulanir.
      //
      // KOD INCELEMESI (turu 2, D): kaynak DEPODUR, `network.currentNetwork` DEGIL.
      // O ref'i dolduran initializeCurrentNetwork() bekletilmeden baslatiliyor;
      // hala `null`ken evmOnlyFeatures(null).dapp `false` doner, yani bu dinleyici
      // GECERLI bir istegi "bayat" sayip SESSIZCE SILERDI. Yukaridaki iki cagri
      // noktasi (kilitli/kilitsiz dallar) zaten depodan okunan degeri geciriyor;
      // ucu de AYNI kaynagi okumak ZORUNDA. Depo ayrica HER ZAMAN guncel: ag
      // degisimi setCurrentNetwork ile diske de yaziliyor.
      const { currentNetwork: storedNetwork } = await chrome.storage.local.get('currentNetwork')
      if (isDappRequestStale(newVal, storedNetwork)) {
        chrome.storage.local.remove('current_request')
        return
      }
      if (newVal) {
        switch (newVal.type) {
          case 'CONNECT': page.currentPage = 'dapp_connect'; break;
          case 'SEND_TX': page.currentPage = 'dapp_router'; break;
          case 'SIGN_MESSAGE': page.currentPage = 'sign_message'; break;
          case 'TON_CONNECT': page.currentPage = 'ton_connect'; break;
          case 'TON_SEND_TX': page.currentPage = 'ton_send_tx'; break;
          case 'TON_SIGN_DATA': page.currentPage = 'ton_sign_data'; break;
        }
      } else {
        if (['dapp_connect', 'dapp_router', 'sign_message', 'ton_connect', 'ton_send_tx', 'ton_sign_data'].includes(page.currentPage)) {
          page.currentPage = 'home'
        }
      }
    }
  })
 
  chrome.runtime.onMessage.addListener((message) => { 
    if (message.type === 'SESSION_EXPIRED') page.currentPage = 'welcome'
  }) 
})

let heartbeatTimer = null

const sendHeartbeat = () => {
  // Eğer zaten bir sinyal gönderimi planlandıysa iptal etme, bekle.
  // Bu basit bir throttling mantığıdır: Çok sık mesaj gitmesini engeller.
  if (heartbeatTimer) return

  heartbeatTimer = setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'HEARTBEAT' })
    heartbeatTimer = null
  }, 5000) // Her 5 saniyede bir maksimum 1 kere tetiklenir (kullanıcı sürekli hareket etse bile)
}

onUnmounted(() => {
  window.removeEventListener('mousemove', sendHeartbeat)
  window.removeEventListener('click', sendHeartbeat)
  window.removeEventListener('keydown', sendHeartbeat)
  if (heartbeatTimer) clearTimeout(heartbeatTimer)
})
</script>