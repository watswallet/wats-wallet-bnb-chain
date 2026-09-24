<template>
    <div class="fixed inset-0 flex items-center justify-center z-50 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm px-4" @click="popups.bridge_from = false">
        
        <div 
            class="w-full max-w-85 h-137.5 flex flex-col bg-white dark:bg-[#09090b] border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl dark:shadow-2xl overflow-hidden relative transition-colors duration-300" 
            @click.stop
        >
            <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-500/10 to-transparent pointer-events-none transition-colors duration-300"></div>

            <div class="flex items-center justify-between px-5 pt-5 pb-2 relative z-10">
                <h4 class="font-bold text-slate-900 dark:text-white text-lg tracking-tight transition-colors duration-300">{{ $t('bridge.from.title') }}</h4>
                <button 
                    class="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white transition-colors duration-300 cursor-pointer shadow-sm dark:shadow-none" 
                    @click="popups.bridge_from = false"
                >
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            <!-- z-20 (liste z-10): ESIT z-index'te DOM sirasi kazanir ve liste BU BLOKTAN SONRA
                 geldigi icin acilan ag menusunun uzerine biniyordu — menu satirlari ile token
                 satirlari ic ice giriyordu. NetworkScopePill'in kendi z-30/z-50'si bunu
                 KURTARAMAZ: ust kaptaki z-10 bir yiginlama baglami acar ve icerideki daha
                 buyuk z'ler o baglamin DISINA cikamaz. Cozum bu kabin listeden yuksek olmasi. -->
            <div class="px-5 pb-3 flex flex-col gap-3 relative z-20">
                <div class="flex items-center justify-between">
                    <span class="text-xs text-slate-500 dark:text-zinc-500 font-medium ml-1 transition-colors duration-300">{{ $t('bridge.from.source_network') }}</span>
                    <button 
                        @click="openNetworks"
                        class="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-slate-100 dark:bg-[#18181b] border border-slate-200 dark:border-white/10 hover:border-indigo-400 dark:hover:border-indigo-500/50 hover:bg-white dark:hover:bg-[#202022] transition-all duration-300 group cursor-pointer shadow-sm dark:shadow-none"
                    >
                        <div class="w-5 h-5 rounded-full bg-slate-200 dark:bg-zinc-800 flex items-center justify-center transition-colors duration-300">
                            <img v-if="network.currentNetwork?.logoURI" :src="network.currentNetwork.logoURI" class="w-full h-full rounded-full object-cover">
                        </div>
                        <span class="text-xs font-bold text-slate-700 dark:text-zinc-200 group-hover:text-indigo-600 dark:group-hover:text-white transition-colors duration-300">
                            {{ network.currentNetwork?.name || $t('bridge.from.select_network_placeholder') }}
                        </span>
                        <svg class="w-3 h-3 text-slate-400 dark:text-zinc-500 group-hover:text-indigo-500 dark:group-hover:text-zinc-300 transition-colors duration-300" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="currentColor" d="M12 16L6 10H18L12 16Z"/></svg>
                    </button>
                </div>

                <div class="flex items-center">
                    <NetworkScopePill :model-value="scope.filter" @update:model-value="onScopeChange" />
                </div>

                <div class="relative group flex items-center w-full">
                    <div class="absolute left-3 text-slate-400 dark:text-zinc-500 group-focus-within:text-indigo-500 dark:group-focus-within:text-indigo-400 transition-colors duration-300">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path stroke-dasharray="40" stroke-dashoffset="40" d="M10.76 13.24c-2.34 -2.34 -2.34 -6.14 0 -8.49c2.34 -2.34 6.14 -2.34 8.49 0c2.34 2.34 2.34 6.14 0 8.49c-2.34 2.34 -6.14 2.34 -8.49 0Z"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.5s" values="40;0"/></path><path stroke-dasharray="12" stroke-dashoffset="12" d="M10.5 13.5l-7.5 7.5"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.5s" dur="0.2s" values="12;0"/></path></g></svg>
                    </div>
                    
                    <input 
                        type="text" 
                        v-model="searchQuery" 
                        class="w-full bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-xl py-3 pl-10 pr-8 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500/50 focus:bg-white dark:focus:bg-zinc-900 shadow-sm dark:shadow-none transition-all duration-300" 
                        :placeholder="$t('bridge.from.search_placeholder')"
                    >
                    
                    <button v-if="searchQuery" @click="searchQuery = ''" class="absolute right-3 text-slate-400 hover:text-slate-700 dark:text-zinc-600 dark:hover:text-white transition-colors duration-300 cursor-pointer">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            </div>
            
            <div 
                class="flex-1 overflow-y-auto custom-scrollbar px-2 pb-2 relative scroll-smooth z-10" 
                @scroll="handleScroll" 
                ref="scrollContainer"
            >
                <div v-if="loading && (!displayedTokens || displayedTokens.length === 0)" class="flex flex-col gap-2 pt-1">
                    <div v-for="i in 6" :key="i" class="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-transparent animate-pulse">
                        <div class="w-9 h-9 rounded-full bg-slate-200 dark:bg-zinc-800 transition-colors duration-300"></div>
                        <div class="flex flex-col gap-2 flex-1">
                            <div class="w-24 h-4 rounded bg-slate-200 dark:bg-zinc-800 transition-colors duration-300"></div>
                            <div class="w-12 h-3 rounded bg-slate-200 dark:bg-zinc-800 transition-colors duration-300"></div>
                        </div>
                    </div>
                </div>

                <div v-else-if="displayedTokens.length === 0" class="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-zinc-500 transition-colors duration-300">
                    <svg class="w-10 h-10 mb-3 opacity-30 dark:opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <p class="text-sm font-medium">{{ $t('bridge.from.not_found') }}</p>
                </div>

                <div v-else>
                    <button 
                        v-for="token in displayedTokens" 
                        :key="balanceKey(token.chainId, token.address)" 
                        class="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5 rounded-xl transition-all duration-200 group border border-transparent cursor-pointer" 
                        @click="selectToken(token)"
                    >
                        <div class="flex items-center gap-3 overflow-hidden">
                            <div class="relative w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center border border-slate-200 dark:border-white/5 transition-colors duration-300 shrink-0">
                                <img :src="tokenLogo(token)" :alt="token.name" class="w-full h-full rounded-full object-cover" @error="handleImageError">
                                <div class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white dark:bg-zinc-900 p-[1.5px] border border-slate-200 dark:border-zinc-700 transition-colors duration-300">
                                    <img :src="chainLogo(token.chainId)" :alt="token.chainId" class="w-full h-full rounded-full object-contain">
                                </div>
                            </div>
                            
                            <div class="flex flex-col items-start min-w-0">
                                <p class="font-bold text-slate-900 dark:text-zinc-100 text-sm text-start truncate w-full group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors duration-300" v-html="highlightMatch(token.name)"></p>
                                <p class="text-slate-500 dark:text-zinc-500 text-xs font-mono transition-colors duration-300" v-html="highlightMatch(token.symbol?.toUpperCase() || '')"></p>
                            </div>
                        </div>
                        
                        <div class="flex flex-col items-end shrink-0 pl-2">
                            <p class="font-bold text-sm transition-colors duration-300" 
                               :class="tokenBalances[balanceKey(token.chainId, token.address)] > 0 ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-zinc-600'">
                               {{ formatBalance(tokenBalances[balanceKey(token.chainId, token.address)]) }}
                            </p>
                            <p class="text-[10px] transition-colors duration-300" 
                               :class="tokenBalances[balanceKey(token.chainId, token.address)] > 0 ? 'text-emerald-600 dark:text-emerald-500 font-medium' : 'text-slate-400 dark:text-zinc-600'" 
                               v-if="token.market?.priceUSD">
                               ${{ formatPrice((tokenBalances[balanceKey(token.chainId, token.address)] || 0) * token.market.priceUSD) }}
                            </p>
                        </div>
                    </button>
                </div>
            </div>

            <div v-if="loading && displayedTokens.length > 0" class="flex items-center justify-center py-4 relative z-10 transition-colors duration-300">
                <div class="w-5 h-5 border-2 border-slate-300 dark:border-zinc-600 border-t-indigo-500 dark:border-t-zinc-200 rounded-full animate-spin"></div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref, computed, watch } from 'vue'
import axios from 'axios'
import { popupStore } from '../../store/popup'
import { networkStore } from '../../store/network'
import { cryptoStore } from '../../store/crypto'
import { useTokenBalance } from '../../composables/useTokenBalance'
import { userStore } from '../../store/user'
import { configStore } from '../../store/config'
import { tokenScopeStore } from '../../store/tokenScope'
import NetworkScopePill from '../NetworkScopePill.vue'
import { useI18n } from 'vue-i18n'
import { ALL_CHAINS, LISTED_CHAINS, chainsForFlow } from '../../data/chains'
import { chainLogo } from '../../utils/chainLogo'
import { ALL_NETWORKS } from '../../utils/networkFilter'
import { balanceKey, flattenImportedTokens, scopeChainIds, rpcUrlFor } from '../../utils/tokenScope'
import { isBStock } from '../../utils/bstocks'
import { applyNetworkChange } from '../../utils/applyNetworkChange'
import { tokenLogo } from '../../utils/tokenLogo'

const popups = popupStore()
const network = networkStore()
const crypto = cryptoStore()
const user = userStore()
const config = configStore()
const { t } = useI18n()
// PAYLASILAN ag kapsami: ana ekranda ne secildiyse bu (KAYNAK) liste onunla
// acilir. Hedef zincir (bridge_to) ayri ve bilincli bir secim; kapsam ORAYA
// tasinmaz — paranin nereye gittigini sessizce degistirmemeli.
const scope = tokenScopeStore()

const allTokens = ref([])
const searchQuery = ref('')
const loading = ref(true)
const scrollContainer = ref(null)
const importedTokens = ref([])
const tokenBalances = ref({})
const tokensData = ref([])

const rpcCtx = computed(() => ({
    activeChainId: network.currentNetwork?.chainId,
    activeRpc: network.rpc,
    chains: ALL_CHAINS,
}))

// Ag logosu cozumlemesi utils/chainLogo.js'te TEK yerde: burada kopyalanan
// `Number()` karsilastirmasi Solana'nin METIN kimligini NaN'a cevirip rozeti
// sessizce varsayilana dusuruyordu.

const itemsPerPage = 20
const currentPage = ref(1)

// --- COMPUTED ---

// Imported ve API'den gelenleri birleştir, Imported önce gelir
const mergedTokens = computed(() => {
    // Unique key (address) ile duplicate önleme
    const map = new Map();
    [...importedTokens.value, ...allTokens.value].forEach(token => {
        // bSTOCK SATIRLARI BU LISTEYE GIRMEZ. Spec'in tespiti: bStocks kovada
        // oldugu icin secicide gorunur ama LI.FI rota BULAMAZ, akis hatayla biter.
        // Ustelik bu ekranin gosterdigi bakiye artik UI biriminde (balanceOfUI)
        // iken kopru harcama yolu HAM birimde: token secilebilir kalsaydi MAX ile
        // kopru ham bakiyeyi asar, MAX altinda ise FAZLA token koprulenirdi.
        // Gercek kapi bridge.js `bridgeQuote`ta (token buraya baska yollardan da
        // girebiliyor); burasi kullaniciyi olu bir yola hic sokmamak icin.
        if (isBStock(token.chainId, token.address)) return;
        // Anahtar zinciri de icerir: yalniz adrese bakmak "Tum Aglar" modunda iki
        // zincirdeki ayri tokenleri tek kayda indirirdi (native adres her yerde '0x0').
        map.set(balanceKey(token.chainId, token.address), token);
    });
    return Array.from(map.values());
})

const filteredTokens = computed(() => {
    if (!searchQuery.value) return mergedTokens.value
    
    const query = searchQuery.value.toLowerCase()
    
    return mergedTokens.value.filter(token => {
        const name = token.name?.toLowerCase() || ''
        const symbol = token.symbol?.toLowerCase() || ''
        const address = token.address?.toLowerCase() || ''
        return name.includes(query) || symbol.includes(query) || address.includes(query)
    })
})

const displayedTokens = computed(() => {
    const endIndex = currentPage.value * itemsPerPage
    return filteredTokens.value.slice(0, endIndex)
})

const hasMoreTokens = computed(() => displayedTokens.value.length < filteredTokens.value.length)

// --- HELPERS ---

const formatBalance = (balance) => {
    if (!balance) return '0.00'
    return balance < 0.000001 ? '< 0.000001' : balance.toFixed(6)
}

const formatPrice = (price) => {
    if (!price) return '0.00'
    return price < 0.01 ? '< 0.01' : price.toFixed(2)
}

const highlightMatch = (text) => {
    if (!searchQuery.value || searchQuery.value.length < 2) return text
    const query = searchQuery.value.trim()
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
    return text.replace(regex, '<span class="text-indigo-400 font-bold bg-indigo-500/10 px-0.5 rounded">$1</span>')
}

// --- ACTIONS ---

const handleImageError = (event) => {
    // Fallback Icon
    event.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzYiIGhlaWdodD0iMzYiIHZpZXdCb3g9IjAgMCAzNiAzNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTgiIGN5PSIxOCIgcj0iMTgiIGZpbGw9IiMzMzMzMzMiLz4KPC9zdmc+'
}

const selectToken = async (token) => {
    // Kaynak zincir AKTIF agdir: baska zincirdeki bir token secilince aktif ag
    // oraya tasinmali, aksi halde bridge yanlis zincirden cikis kurar.
    // applyNetworkChange bridge secimlerini sifirliyor, bu yuzden ag degisimi
    // ONCE, inToken SONRA yazilir.
    if (Number(token.chainId) !== Number(network.currentNetwork?.chainId)) {
        const chain = ALL_CHAINS.find(c => Number(c.chainId) === Number(token.chainId))
        if (!chain) return

        const reachable = await applyNetworkChange(chain, t)
        if (!reachable) return
    }

    crypto.bridge.inToken = token
    popups.bridge_from = false
}

const openNetworks = () => {
    popups.bridge_from = false
    popups.bridge_from_network = true
}

// --- DATA FETCHING ---

const fetchTokenBalances = async (tokens) => {
    const { active_account } = await chrome.storage.local.get('active_account')

    // DIKKAT: asagidaki yorum VAKTIYLE DOGRU DEGILDI, silindi. Kod her tokeni
    // KENDI zincirinden okumuyor; KOSULSUZ `network.rpc` geciyor, yani "Tum Aglar"
    // modunda butun satirlar AKTIF agdan okunuyor.
    //
    // Bu yuzden chainId de RPC UCUNUN AGINDAN aliniyor - token.chainId'den DEGIL:
    // token.chainId gecirmek bStock'u YANLIS ucta aratir ve satiri bos/0 birakirdi.
    // RPC ile chainId'yi ayni kaynaga baglamak AYRI bir is, bu commit'in kapsami
    // disinda; burada yalnizca ISARETLENIYOR.
    const balancePromises = tokens.map(async token => {
        try {
            const balance = await useTokenBalance(active_account.address, token.address, network.rpc, network.currentNetwork?.chainId)
            return { address: token.address, balance }
        } catch (error) {
            return { address: token.address, balance: 0 }
        }
    })
    
    const results = await Promise.all(balancePromises)
    results.forEach(({ address, balance }) => {
        tokenBalances.value[address] = balance
    })
}

const getTokensData = async () => {
    if (!importedTokens.value.length) return
    try {
        const ids = importedTokens.value.map(t => t.coingecko_id).filter(Boolean)
        if (!ids.length) return
        
        const response = await axios.post(config.api + '/getTokensDataById', { ids })
        if (response.status === 200) {
            tokensData.value = response.data.tokens
            // Market verilerini eşleştir
            importedTokens.value.forEach(token => {
                const tokenData = tokensData.value.find(data => data.coingecko_id === token.coingecko_id)
                if (tokenData) token.market = tokenData.market_data
            })
        }
    } catch (e) { console.error(e) }
}

const getImportedTokens = async () => {
    try {
        const { imported_tokens = {}, active_account } = await chrome.storage.local.get(['imported_tokens', 'active_account'])
        const byChain = imported_tokens[active_account?.key] || {}

        // Kapsamdaki tokenler, her biri KENDI chainId'siyle (kova anahtarindan).
        if (scope.filter === ALL_NETWORKS) {
            importedTokens.value = flattenImportedTokens(byChain)
        } else {
            const id = Number(scope.filter)
            importedTokens.value = flattenImportedTokens({ [id]: byChain[id] || [] })
        }
        
        if (importedTokens.value.length) {
            await Promise.all([
                getTokensData(),
                fetchTokenBalances(importedTokens.value)
            ])
        }
    } catch (e) { console.error(e) }
}

// --- LIFECYCLE ---

const loadTokens = async () => {
    loading.value = true
    try {
        await getImportedTokens()

        // Li.Fi API ile token listesi (Kullanıcının orijinal kodu)
        const response = await axios.get('https://li.quest/v1/tokens?chainTypes=EVM')
        
        if (response.status === 200) {
            // Li.Fi yaniti zincire gore anahtarli: capraz zincir liste ek istek
            // gerektirmez, istenen zincirlerin kovalari birlestirilir.
            // Kapsam "Tum Aglar" iken TON da sorguya giriyordu; secilen bir TON varligi
            // kullaniciyi kopru ekraninin icinde TON'a gecirebiliyordu.
            const scoped = scopeChainIds(scope.filter, chainsForFlow('bridge'))
            const chainTokens = scoped.flatMap(id =>
                (response.data.tokens[id] || []).map(tk => ({ ...tk, chainId: id }))
            )

            // Imported olanlari allTokens'dan cikar (Duplicate olmasin). Anahtar
            // zinciri de icerir: yalniz adres, iki zincirdeki ayri tokenleri birlestirirdi.
            const importedKeys = new Set(importedTokens.value.map(tk => balanceKey(tk.chainId, tk.address)))
            allTokens.value = chainTokens.filter(token => !importedKeys.has(balanceKey(token.chainId, token.address)))
        }
    } catch (error) {
        console.error('Token list error', error.message)
    } finally {
        loading.value = false
    }
}

onMounted(loadTokens)

// Scroll Handler (Infinite Scroll Simulation)
let scrollTimeout
const handleScroll = () => {
    if (scrollTimeout) clearTimeout(scrollTimeout)
    scrollTimeout = setTimeout(() => {
        if (!scrollContainer.value || loading.value || !hasMoreTokens.value) return
        const container = scrollContainer.value
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 100) {
            currentPage.value++
        }
    }, 100)
}

// Kapsam degisince liste bastan kurulur. Aktif ag DEGIL kapsam izlenir: store
// zaten ag degisimini kapsama yansitiyor (bkz. store/tokenScope.js).
watch(() => scope.filter, async () => {
    searchQuery.value = ''
    currentPage.value = 1
    tokenBalances.value = {}
    await loadTokens()
})

const onScopeChange = (value) => scope.setFilter(value)

watch(searchQuery, () => {
    currentPage.value = 1
    if (scrollContainer.value) scrollContainer.value.scrollTop = 0
})
</script>