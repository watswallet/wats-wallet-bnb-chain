<template>
  <div class="fixed inset-0 flex items-center justify-center bg-slate-900/40 dark:bg-[#000000]/60 backdrop-blur-sm z-50 px-4" @click="popups.network_popup = false">
    
    <Transition
      enter-active-class="transition-all duration-300 cubic-bezier(0.16, 1, 0.3, 1)"
      leave-active-class="transition-all duration-200 ease-in"
      enter-from-class="opacity-0 scale-95 translate-y-4"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-from-class="opacity-100 scale-100 translate-y-0"
      leave-to-class="opacity-0 scale-95 translate-y-4"
    >
      <div 
        v-if="popups.network_popup" 
        class="w-full max-w-85 max-h-125 flex flex-col bg-white dark:bg-[#09090b] border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl dark:shadow-2xl overflow-hidden relative transition-colors duration-300" 
        @click.stop
      >
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-500/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-between px-5 pt-5 pb-2 relative z-10">
          <h4 class="font-bold text-slate-900 dark:text-white text-lg tracking-tight transition-colors duration-300">{{ $t('popups.networksPopup.title') }}</h4>
          <button 
            @click="popups.network_popup = false"
            class="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white transition-colors duration-300 cursor-pointer"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        
        <div class="px-5 py-3 relative z-10">
          <div class="group relative flex items-center w-full">
            <div class="absolute left-3 text-slate-400 dark:text-zinc-500 group-focus-within:text-indigo-500 dark:group-focus-within:text-indigo-400 transition-colors duration-300">
              <svg v-if="!isSearching" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <svg v-else class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            </div>
            
            <input 
              type="text" 
              v-model="searchQuery" 
              class="w-full bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-xl py-2.5 pl-10 pr-8 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500/50 focus:bg-white dark:focus:bg-zinc-900 transition-all duration-300 shadow-sm dark:shadow-none" 
              :placeholder="$t('popups.networksPopup.search_placeholder')" 
              @input="handleSearch"
            >

            <button 
              v-if="searchQuery" 
              @click.stop="clearSearch" 
              class="absolute right-3 text-slate-400 hover:text-slate-700 dark:text-zinc-600 dark:hover:text-white transition-colors duration-300 cursor-pointer"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-3 pb-3 space-y-1 relative z-10">
          
          <div v-if="filteredChains.length === 0 && searchQuery" class="flex flex-col items-center justify-center py-10 text-slate-400 dark:text-zinc-500 transition-colors duration-300">
            <svg class="w-10 h-10 mb-3 opacity-30 dark:opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
            <p class="text-sm">{{ $t('popups.networksPopup.empty_state') }}</p>
          </div>
          
          <button 
            v-for="chain in filteredChains" 
            :key="chain.chainId" 
            class="w-full flex items-center justify-between p-3 rounded-xl transition-all duration-200 group border cursor-pointer"
            :class="isActiveChain(chain) 
              ? 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/5 shadow-sm dark:shadow-inner' 
              : 'bg-transparent border-transparent hover:bg-slate-50 dark:hover:bg-white/5 hover:border-slate-200 dark:hover:border-white/5'"
            @click="changeNetwork(chain)"
          >
            <div class="flex items-center gap-3 overflow-hidden">
              
              <div class="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center border border-slate-200 dark:border-white/5 p-1.5 shrink-0 transition-colors duration-300">
                <img :src="chain.logoURI" :alt="chain.name" class="w-full h-full object-contain">
              </div>

              <div class="flex flex-col items-start truncate">
                <p class="text-sm font-semibold truncate w-full text-start transition-colors duration-300" 
                  :class="isActiveChain(chain) ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-zinc-300 group-hover:text-slate-900 dark:group-hover:text-white'"
                  v-html="highlightMatch(chain.name)">
                </p>

                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-[10px] font-mono text-slate-500 dark:text-zinc-500 bg-slate-100 dark:bg-zinc-900/50 px-1.5 py-0.5 rounded transition-colors duration-300">{{ chain.chain }}</span>
                  <span v-if="chain.testnet" class="text-[9px] font-bold text-amber-600 dark:text-amber-500 uppercase tracking-wider transition-colors duration-300">{{ $t('popups.networksPopup.testnet_label') }}</span>
                </div>
              </div>
            </div>

            <div class="shrink-0 pl-2">
              <div v-if="isActiveChain(chain)" class="w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center shadow-[0_0_10px_rgba(16,185,129,0.2)] dark:shadow-[0_0_10px_rgba(16,185,129,0.4)] transition-colors duration-300">
                <svg class="w-3 h-3 text-white dark:text-black font-bold" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
              </div>
              <div v-else class="w-5 h-5 rounded-full border border-slate-300 dark:border-zinc-700 group-hover:border-slate-400 dark:group-hover:border-zinc-500 transition-colors duration-300"></div>
            </div>
          </button>
        </div>
        
        <div v-if="searchQuery && filteredChains.length > 0" class="px-5 py-2 bg-slate-50 dark:bg-[#09090b] border-t border-slate-200 dark:border-white/5 text-center relative z-10 transition-colors duration-300">
          <p class="text-[10px] text-slate-500 dark:text-zinc-600 transition-colors duration-300">{{ $t('popups.networksPopup.count_result', { n: filteredChains.length }) }}</p>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { networkStore } from '../../store/network'
import { popupStore } from '../../store/popup'
import { chainsForFlow } from '../../data/chains'
import { chainVm, isSameChainId } from '../../utils/vm'
import { chainsForAccount } from '../../utils/accountKind'
import { applyNetworkChange } from '../../utils/applyNetworkChange'

// AYNI popup IKI FARKLI ISI yapiyor ve listeleri AYNI olamaz:
//
//   1. GLOBAL ag anahtari (`allVms`). Cuzdanin aktif agini secer; DESTEKLENEN HER
//      zinciri gostermek ZORUNDA -- aksi halde EVM disi bir zinciri (Solana, TON)
//      secmenin arayuzde hicbir yolu kalmaz.
//      GUNCEL DURUM (Task 16c): global anahtar Header'dan Home.vue'deki
//      NetworkScopePill'e (`switches-network`) TASINDI, cunku ana ekranda birbirine
//      benzeyen iki acilir menu vardi. Yani `allVms: true` su an URETIMDE HICBIR
//      cagiran tarafindan gecilmiyor. YINE DE SILINMEDI ve silinmemeli: silmek
//      "listenin daraltilmasi Takas'a OZEL bir karardir" bilgisini yok eder ve
//      varsayilan `false`u sessiz bir GENEL kurala cevirir -- EVM disi bir zinciri
//      bir daha gostermek gerektiginde ayni hata (erisilemeyen zincir) sifirdan
//      geri gelir.
//   2. Takas'in KENDI kaynak-zincir secicisi (Swap.vue -> ChangeNetwork, flow="swap").
//      O ekran EVM motoruyla calisir; oradan Solana'yi secmek kullaniciyi
//      calisamayacagi bir ekranda birakir (F6). Bu yuzden orada liste EVM'e daralir.
//
// UC AYRI KAPI, UC AYRI SORU (birlestirme notu -- ikisi ayri dallarda yazildi ve
// BIRI OTEKININ YERINI TUTMAZ):
//   `flow`    : "bu zincirde bu EKRAN calisir mi" (chainsForFlow; kopru TON tasimaz,
//               takas EVM router'i olmayan zinciri tasimaz).
//   `allVms`  : "bu popup GLOBAL anahtar mi, yoksa EVM'e ozel bir secici mi".
//   hesap     : "bu HESAP o zincirde kullanilabilir mi" (chainsForAccount; TON
//               ifadesiyle ice aktarilmis hesabin EVM anahtari hic uretilmemistir).
// Kapilar ust uste biner ve sirasi onemsizdir; her biri yalnizca daraltir.
//
// Karar PROP'larla ifade ediliyor, iki ayri bilesen kopyasiyla DEGIL: fark yalnizca
// LISTE FILTRESI; arama, vurgulama, secim govdesi ve gorunum birebir ayni ve iki
// kopya zamanla sessizce ayrisirdi. `allVms` varsayilani `false` (EVM-only)
// SECILDI ki prop vermeyen her cagiran hicbir sey degistirmeden bugunku davranisini
// korusun; genisletme ACIKCA istenmelidir.
//
// DIKKAT: Kopru'nun kendi secicileri (bridge/selectFromChain.vue,
// selectToChains.vue) bu bilesenden GECMEZ, kendi chainsForFlow('bridge')
// filtreleri var — onlara dokunulmadi.
const props = defineProps({
  flow: { type: String, default: null },
  allVms: { type: Boolean, default: false },
})

const { t } = useI18n()
const popups = popupStore()
const network = networkStore()

// `active_account` cozulene kadar liste hesap filtresinden GECMEZ (chainsForAccount
// null hesapta listeyi aynen dondurur): bir karelik fazla secenek, eksik secenekten
// iyidir ve NetworkScopePill.vue da ayni yonu seciyor.
//
// Okuma SARMALANMIS: bu bilesen `chrome` olmayan baglamlarda da olusturuluyor
// (SSR testleri, dapp disi surumler) ve cozulemeyen bir hesap okumasi popup'in
// TAMAMINI dusurmemeli -- fail-open zaten yukaridaki karar.
const activeAccount = ref(null)
onMounted(async () => {
  try {
    const { active_account } = await chrome.storage.local.get('active_account')
    activeAccount.value = active_account
  } catch {
    activeAccount.value = null
  }
})

const flowChains = computed(() => chainsForFlow(props.flow))
const vmChains = computed(() => (props.allVms ? flowChains.value : flowChains.value.filter((c) => chainVm(c) === 'evm')))
const chains = computed(() => chainsForAccount(activeAccount.value, vmChains.value))

const searchQuery = ref('')
const isSearching = ref(false)

let searchTimeout = null

const handleSearch = () => {
  isSearching.value = true
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    isSearching.value = false
  }, 300)
}

const clearSearch = () => {
  searchQuery.value = ''
  isSearching.value = false
}

// Aktif satirin isaretlenmesi. Duz `===` EVM kimliklerinde sessizce yanilabilir
// (ayni zincir hem 1 hem '1' olarak dolasiyor) ve METIN kimlikli Solana'da hic
// eslesmezdi; isSameChainId sayisal ve metin kimlikleri BIRLIKTE dogru kiyaslar.
const isActiveChain = (chain) => isSameChainId(chain.chainId, network.currentNetwork?.chainId)

const filteredChains = computed(() => {
  if (!searchQuery.value.trim()) return chains.value
  const query = searchQuery.value.toLowerCase().trim()
  return chains.value.filter(chain => {
    const nameMatch = chain.name.toLowerCase().includes(query)
    const symbolMatch = chain.nativeCurrency?.symbol?.toLowerCase().includes(query)
    const chainIdMatch = chain.chainId.toString().includes(query)
    return nameMatch || symbolMatch || chainIdMatch
  })
})

const highlightMatch = (text) => {
  if (!searchQuery.value.trim()) return text
  const query = searchQuery.value.trim()
  const regex = new RegExp(`(${query})`, 'gi')
  // Dashboard renklerine uygun, indigo vurgu
  return text.replace(regex, '<span class="text-indigo-400 font-bold bg-indigo-500/10 px-0.5 rounded">$1</span>')
}

// Ag degisiminin govdesi utils/applyNetworkChange.js'te: token secme ekranlari da
// ag degistiriyor ve ayni yan etkilerin (RPC hiz testi, swap/bridge sifirlama,
// dapp bildirimi) tamamini yapmak zorunda. `flow` de oraya TASINIR: gecisin kendisi
// de akis kapisindan gecmeli, yalnizca liste degil.
//
// Popup ONCE kapanir: eskiden findFastestRPC beklenirken acik kaliyor ve kullanici
// hiz testi surerken ikinci bir zincire tiklayabiliyordu.
const changeNetwork = async(data) => {
  popups.network_popup = false
  await applyNetworkChange(data, t, { flow: props.flow })
}

onUnmounted(() => {
  if (searchTimeout) clearTimeout(searchTimeout)
})
</script>
