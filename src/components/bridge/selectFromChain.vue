<template>
    <div class="fixed inset-0 flex items-center justify-center z-50 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm px-4" @click="popups.bridge_from_network = false">
        
        <div 
            class="w-full max-w-85 h-125 flex flex-col bg-white dark:bg-[#09090b] border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl dark:shadow-2xl overflow-hidden relative transition-colors duration-300" 
            @click.stop
        >
            <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-500/10 to-transparent pointer-events-none transition-colors duration-300"></div>

            <div class="flex items-center justify-between px-5 pt-5 pb-3 relative z-10">
                <h4 class="font-bold text-slate-900 dark:text-white text-lg tracking-tight transition-colors duration-300">{{ $t('bridge.fromChain.title') }}</h4>
                <button 
                    class="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white transition-colors duration-300 cursor-pointer shadow-sm dark:shadow-none" 
                    @click="popups.bridge_from_network = false"
                >
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            <div class="px-5 pb-2 relative z-10">
                <div class="relative group flex items-center w-full">
                    <div class="absolute left-3 text-slate-400 dark:text-zinc-500 group-focus-within:text-indigo-500 dark:group-focus-within:text-indigo-400 transition-colors duration-300">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path stroke-dasharray="40" stroke-dashoffset="40" d="M10.76 13.24c-2.34 -2.34 -2.34 -6.14 0 -8.49c2.34 -2.34 6.14 -2.34 8.49 0c2.34 2.34 2.34 6.14 0 8.49c-2.34 2.34 -6.14 2.34 -8.49 0Z"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.5s" values="40;0"/></path><path stroke-dasharray="12" stroke-dashoffset="12" d="M10.5 13.5l-7.5 7.5"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.5s" dur="0.2s" values="12;0"/></path></g></svg>
                    </div>
                    
                    <input 
                        type="text" 
                        v-model="searchQuery" 
                        class="w-full bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-xl py-3 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500/50 focus:bg-white dark:focus:bg-zinc-900 shadow-sm dark:shadow-none transition-all duration-300" 
                        :placeholder="$t('bridge.fromChain.search_placeholder')"
                    >
                </div>
            </div>
            
            <div class="flex-1 overflow-y-auto custom-scrollbar px-3 pb-3 space-y-1 relative z-10">
                <div v-if="filteredChains.length === 0" class="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-zinc-500 transition-colors duration-300">
                    <svg class="w-10 h-10 mb-3 opacity-30 dark:opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <p class="text-sm font-medium">{{ $t('bridge.fromChain.not_found') }}</p>
                </div>

                <button 
                    v-for="chain in filteredChains" 
                    :key="chain.chainId"
                    @click="selectChain(chain)"
                    class="w-full flex items-center justify-between p-3 rounded-xl transition-all duration-200 group border cursor-pointer"
                    :class="chain.chainId === network.currentNetwork.chainId 
                        ? 'bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/5 shadow-sm dark:shadow-inner' 
                        : 'bg-transparent border-transparent hover:bg-slate-50 dark:hover:bg-white/5 hover:border-slate-200 dark:hover:border-white/5'"
                >
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center border border-slate-200 dark:border-white/5 p-1.5 transition-colors duration-300">
                            <img :src="chain.logoURI" :alt="chain.name" class="w-full h-full object-contain" @error="handleImageError">
                        </div>

                        <div class="flex flex-col items-start">
                            <p class="text-sm font-semibold transition-colors duration-300" :class="chain.chainId === network.currentNetwork.chainId ? 'text-slate-900 dark:text-white' : 'text-slate-600 dark:text-zinc-300 group-hover:text-slate-900 dark:group-hover:text-white'">{{ chain.name }}</p>
                            <div class="flex items-center gap-2 mt-0.5">
                                <span class="text-[10px] text-slate-500 dark:text-zinc-500 font-mono transition-colors duration-300">{{ chain.nativeCurrency?.symbol }}</span>
                                <span v-if="chain.testnet" class="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-500 text-[9px] font-bold uppercase transition-colors duration-300">
                                    {{ $t('bridge.fromChain.testnet_label') }}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div v-if="chain.chainId === network.currentNetwork.chainId" class="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)] dark:shadow-[0_0_8px_rgba(16,185,129,0.5)] mr-2 transition-all"></div>
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { popupStore } from '../../store/popup'
import { cryptoStore } from '../../store/crypto'
import { networkStore } from '../../store/network'
import { chainsForFlow } from '../../data/chains'
import { applyNetworkChange } from '../../utils/applyNetworkChange'
import { useI18n } from 'vue-i18n'
import { computed, ref } from 'vue'

const popups = popupStore()
const crypto = cryptoStore()
const network = networkStore()

const { t } = useI18n()

const searchQuery = ref('')

const filteredChains = computed(() => {
    // 1. Destination chain'i hariç tut
    //
    // Liste AKISA gore daralir: kopru LI.FI uzerinden calisiyor ve LI.FI EVM disi
    // zincir TASIMIYOR -- ne TON ne Solana burada gecerli bir secimdir. Bu secici
    // KOPRUNUN KAYNAK agini secer, yani secim dogrudan aktif agi degistirir:
    // filtresiz tam zincir listesi verildiginde TON goruntulenip secilebiliyordu ve
    // Solana secildiginde aktif ag Solana'ya donup Bridge.vue'nun yonlendirme
    // izleyicisi kullaniciyi Home'a geri atiyordu -- cokme yoktu ama satir hic
    // gizlenmemisti ("v-if, disabled degil" ilkesinin bir LISTEYE uygulanmamis hali).
    //
    // Kapi TEK yerde: chainsForFlow('bridge') -> chainSupportsFlow -> isEvm, ve
    // isEvm hem TON'u hem Solana'yi disliyor (chainKind.js/NON_EVM_KINDS). Burada
    // ayrica chainVm ile suzmek ikinci bir gercek kaynak uretirdi.
    //
    // Filtresiz sabitin ADI bilerek yazilmiyor: tonFlowWiring baglanti testi
    // 'burada filtresiz listeleme yok' iddiasini kaynak metninde o adi ARAYARAK
    // dogruluyor, yani yorumda gecmesi de testi kirar.
    let list = chainsForFlow('bridge').filter(chain => chain.chainId !== crypto.bridge.toChain?.chainId)
    
    // 2. Arama filtresi uygula
    if (searchQuery.value) {
        const query = searchQuery.value.toLowerCase()
        list = list.filter(chain => 
            chain.name.toLowerCase().includes(query) || 
            chain.shortName?.toLowerCase().includes(query) ||
            chain.nativeCurrency?.symbol.toLowerCase().includes(query)
        )
    }
    
    return list
})

const selectChain = async(chain) => {
    try {
        // Eğer zaten seçili ağ ise sadece popup'ı kapat
        if (chain.chainId === network.currentNetwork.chainId) {
            popups.bridge_from_network = false
            return
        }

        // Ag degisimi artik TEK GOVDEDEN gecer. Burasi eskiden setCurrentNetwork'u
        // DOGRUDAN cagiriyordu; akis kapisi, swap/bridge secim temizligi ve dapp
        // bildirimi atlaniyordu. Kapi reddederse popup ACIK kalir ki kullanici
        // secimini duzeltebilsin.
        const reachable = await applyNetworkChange(chain, t, { flow: 'bridge' })
        if (!reachable) return
        
        popups.bridge_from_network = false
        popups.bridge_from = true // Geri dönerken 'bridge_from' popup'ını açar

    } catch (err) {
        console.error('Network değiştirme hatası:', err)
    }
}

const handleImageError = (event) => {
    event.target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNTI1MjVCIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNMiAxMmgyMCIvPjwvc3ZnPg=='
}
</script>