<template>
    <div class="fixed inset-0 flex items-center justify-center z-50 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm px-4" @click="popups.swap_from = false">
        
        <div 
            class="w-full max-w-85 h-125 flex flex-col bg-white dark:bg-[#09090b] border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl dark:shadow-2xl overflow-hidden relative transition-colors duration-300" 
            @click.stop
        >
            <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-500/10 to-transparent pointer-events-none transition-colors duration-300"></div>

            <div class="flex items-center justify-between px-5 pt-5 pb-3 relative z-10">
                <h4 class="font-bold text-slate-900 dark:text-white text-lg tracking-tight transition-colors duration-300">{{ $t('swap.from.title') }}</h4>
                <button 
                    class="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white transition-colors duration-300 cursor-pointer shadow-sm dark:shadow-none" 
                    @click="popups.swap_from = false"
                >
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            <!-- z-20 (liste z-10): ESIT z-index'te DOM sirasi kazanir ve liste BU BLOKTAN SONRA
                 geldigi icin acilan ag menusunun uzerine biniyordu — menu satirlari ile token
                 satirlari ic ice giriyordu. NetworkScopePill'in kendi z-30/z-50'si bunu
                 KURTARAMAZ: ust kaptaki z-10 bir yiginlama baglami acar ve icerideki daha
                 buyuk z'ler o baglamin DISINA cikamaz. Cozum bu kabin listeden yuksek olmasi. -->
            <div class="px-5 pb-2 relative z-20">
                <div class="relative group flex items-center w-full">
                    <div class="absolute left-3 text-slate-400 dark:text-zinc-500 group-focus-within:text-indigo-500 dark:group-focus-within:text-indigo-400 transition-colors duration-300">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path stroke-dasharray="40" stroke-dashoffset="40" d="M10.76 13.24c-2.34 -2.34 -2.34 -6.14 0 -8.49c2.34 -2.34 6.14 -2.34 8.49 0c2.34 2.34 2.34 6.14 0 8.49c-2.34 2.34 -6.14 2.34 -8.49 0Z"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.5s" values="40;0"/></path><path stroke-dasharray="12" stroke-dashoffset="12" d="M10.5 13.5l-7.5 7.5"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.5s" dur="0.2s" values="12;0"/></path></g></svg>
                    </div>
                    
                    <input 
                        type="text" 
                        v-model="searchQuery" 
                        @input="handleSearch" 
                        @keydown.escape="clearSearch"
                        ref="searchInput"
                        class="w-full bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-xl py-3 pl-10 pr-8 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500/50 focus:bg-white dark:focus:bg-zinc-900 shadow-sm dark:shadow-none transition-all duration-300" 
                        :placeholder="$t('swap.from.search')"
                    >

                    <button 
                        v-if="searchQuery" 
                        @click="clearSearch" 
                        class="absolute right-3 text-slate-400 hover:text-slate-700 dark:text-zinc-600 dark:hover:text-white transition-colors duration-300 cursor-pointer"
                    >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <div class="mt-2 flex items-center">
                    <NetworkScopePill :model-value="activeScope" @update:model-value="onScopeChange" />
                </div>

                <!-- selectToken bunu bugun SESSIZCE yapiyor (ag degistiriyor ve outToken'i
                     siliyor). Kapsam artik aktif zincirle acildigi icin baska bir zincire
                     cikmak BILINCLI bir adim; sonucu onceden soylenir. -->
                <p class="mt-1.5 px-1 text-[10px] leading-tight text-slate-400 dark:text-zinc-500">{{ $t('swap.scopeHint') }}</p>

                <p v-if="searchUnsupported" class="mt-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    {{ $t('selectAssets.allNetworksSearchUnsupported') }}
                </p>

                <div v-if="searchQuery && !loading" class="mt-2 px-1">
                    <p class="text-[10px] text-slate-400 dark:text-zinc-500 font-medium transition-colors duration-300">{{ filteredTokens.length }} {{ $t('swap.from.results') }}</p>
                </div>
            </div>
            
            <div 
                class="flex-1 overflow-y-auto custom-scrollbar px-2 pb-2 relative scroll-smooth z-10" 
                @scroll="handleScroll" 
                ref="scrollContainer"
            >
                <div v-if="loading && (!displayedTokens || displayedTokens.length === 0)" class="flex flex-col gap-2 pt-2">
                    <div v-for="i in 6" :key="i" class="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-transparent animate-pulse">
                        <div class="w-9 h-9 rounded-full bg-slate-200 dark:bg-zinc-800"></div>
                        <div class="flex flex-col gap-2 flex-1">
                            <div class="w-24 h-4 rounded bg-slate-200 dark:bg-zinc-800"></div>
                            <div class="w-12 h-3 rounded bg-slate-200 dark:bg-zinc-800"></div>
                        </div>
                    </div>
                </div>

                <div v-else-if="displayedTokens.length === 0" class="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-zinc-500 transition-colors duration-300">
                    <svg class="w-10 h-10 mb-3 opacity-30 dark:opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <p class="text-sm font-medium">{{ $t('swap.from.notFound') }}</p>
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
                                <img :src="token.image.large" :alt="token.name" class="w-full h-full rounded-full object-cover" @error="handleImageError">
                                <div class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white dark:bg-zinc-900 p-[1.5px] border border-slate-200 dark:border-zinc-700 transition-colors duration-300">
                                    <img :src="chainLogo(token.chainId)" :alt="token.chainId" class="w-full h-full rounded-full object-contain">
                                </div>
                            </div>
                            
                            <div class="flex flex-col items-start min-w-0">
                                <p class="font-bold text-slate-900 dark:text-zinc-100 text-sm truncate w-full text-start group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors duration-300" v-html="highlightMatch(token.name)"></p>
                                <div class="flex items-center gap-1.5 mt-0.5">
                                    <p class="text-slate-500 dark:text-zinc-500 text-xs font-mono transition-colors duration-300" v-html="highlightMatch(token.symbol.toUpperCase())"></p>
                                    <span v-if="isAddressSearch && token.address.toLowerCase().includes(searchQuery.toLowerCase())" class="text-[10px] text-slate-400 dark:text-zinc-600 bg-slate-100 dark:bg-zinc-900 px-1 py-0.5 rounded truncate max-w-20 transition-colors duration-300">{{ token.address.slice(0,6) }}...{{ token.address.slice(-4) }}</span>
                                </div>
                            </div>
                        </div>
                        
                        <div class="flex flex-col items-end shrink-0 pl-2">
                            <p class="font-bold text-sm transition-colors duration-300" 
                               :class="tokenBalances[balanceKey(token.chainId, token.address)] > 0 ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-zinc-600'">
                               {{ tokenBalances[balanceKey(token.chainId, token.address)] ? tokenBalances[balanceKey(token.chainId, token.address)].toFixed(6) : '0.00' }}
                            </p>

                            <p class="text-[10px] transition-colors duration-300" 
                               :class="tokenBalances[balanceKey(token.chainId, token.address)] > 0 ? 'text-emerald-600 dark:text-emerald-500 font-medium' : 'text-slate-400 dark:text-zinc-600'" 
                               v-if="tokenBalances[balanceKey(token.chainId, token.address)] && token.market?.priceUSD">
                               ${{ (tokenBalances[balanceKey(token.chainId, token.address)] * token.market.priceUSD).toFixed(2) }}
                            </p>
                        </div>
                    </button>
                </div>

                <div v-if="loading && displayedTokens.length > 0" class="flex items-center justify-center py-4">
                    <div class="w-5 h-5 border-2 border-slate-300 dark:border-zinc-600 border-t-indigo-500 dark:border-t-zinc-200 rounded-full animate-spin"></div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref, nextTick, watch } from 'vue'
import axios from 'axios'
import { useI18n } from 'vue-i18n'
import NetworkScopePill from '../NetworkScopePill.vue'
import { popupStore } from '../../store/popup'
import { cryptoStore } from '../../store/crypto'
import { networkStore } from '../../store/network'
import { tokenScopeStore } from '../../store/tokenScope'
import contract_addresses from '../../data/contract_addresses.json'
import { useTokenBalance } from '../../composables/useTokenBalance'
import { configStore } from '../../store/config'
import { ALL_CHAINS, LISTED_CHAINS, chainsForFlow } from '../../data/chains'
import { ALL_NETWORKS, effectiveScope } from '../../utils/networkFilter'
import { balanceKey, flattenImportedTokens, scopeChainIds, rpcUrlFor } from '../../utils/tokenScope'
import { applyNetworkChange } from '../../utils/applyNetworkChange'

const { t } = useI18n()
const popups = popupStore()
const crypto = cryptoStore()
const network = networkStore()
const config = configStore()
// PAYLASILAN ag kapsami: ana ekranda ne secildiyse bu liste onunla acilir.
//
// Kapsam YALNIZ bu ("from") tarafta anlamli. Swap tek zincirlidir; hangi zincirde
// islem yapilacagini from token belirler. "To" listesi bu yuzden secilen zincire
// kilitli kalir ve kendi kapsam secicisi yoktur.
const scope = tokenScopeStore()

// TURETILMIS kapsam. Bildirilen hata: Polygon aktifken bu secici POLYGON degil
// "TUM AGLAR" kapsaminda aciliyordu. Acilistaki 'all' bir CEVAP DEGIL, sorulmamis
// bir sorudur (store ilk yuklemede filtreye bilerek dokunmuyor); swap TEK ZINCIRLI
// oldugu icin sorulmamis halde aktif zinciri varsayar. Kullanici pill'e DOKUNDUYSA
// (`scope.chosen`) o acik cevap her ekranda oldugu gibi burada da gecerlidir.
// Store'a YAZILMAZ: yazsaydi Home'a sizar ve portfoy toplami sessizce duserdi.
const activeScope = computed(() => effectiveScope(scope.filter, scope.chosen, network.currentNetwork?.chainId))

const allTokens = ref([])
const searchQuery = ref('')
const loading = ref(false)
const scrollContainer = ref(null)
const searchInput = ref(null)
const importedTokens = ref([])
// Anahtar: balanceKey(chainId, address). Yalniz adrese gore anahtarlamak "Tum
// Aglar" modunda zincirleri birbirine karistirirdi (native adres her zincirde '0x0').
const tokenBalances = ref({})
const tokensData = ref(null)

// Coklu zincir aramasi tek istekle yapilir; yayindaki sunucu guncel degilse 400
// doner. Aktif zincirin sonuclarini "tum aglar" gibi gostermek yaniltici olurdu.
const searchUnsupported = ref(false)

const itemsPerPage = 20
const currentPage = ref(1)
const limit = ref(25)
const isLoading = ref(false)

let searchTimeout = null

const rpcCtx = computed(() => ({
    activeChainId: network.currentNetwork?.chainId,
    activeRpc: network.rpc,
    chains: ALL_CHAINS,
}))

const chainLogo = (chainId) =>
    ALL_CHAINS.find(c => Number(c.chainId) === Number(chainId))?.logoURI || '/default-chain.png'

// --- API Calls ---

const getTokensData = async() => {
    try {
        if (!importedTokens.value.length) return
        const response = await axios.post(config.api + '/getTokensDataById', {
            ids: importedTokens.value.map(t => t.coingecko_id)
        })
        if(response.status != 200) return
        tokensData.value = response.data.tokens
    } catch (error) {
        console.error('getTokensData error', error.message)
    }
}

const getChainTokens = async() => {
    if (isLoading.value) return
    try {
        isLoading.value = true

        // Kapsam "Tum Aglar" iken bu, LISTELENEN HER zincirin kimligini sunucuya
        // soruyordu - TON dahil. TON native tokeni sunucuda kayitli oldugu icin takas
        // token listesinde TON cikabiliyor, secilince de applyNetworkChange ile aktif ag
        // TON'a geciyordu: takas ekraninin ICINDEN TON'a acilan bir kapi.
        const ids = scopeChainIds(activeScope.value, chainsForFlow('swap'))
        if (!ids.length) { allTokens.value = []; return }

        const body = { chainIds: ids, skip: 0, limit: limit.value }
        if (ids.length === 1) {
            // Eski sunumlar `chainIds`'i bilmez. Tek zincirde geriye donuk uyum icin
            // `chain`/`chainId` de gonderilir; ana akis guncellenmemis sunucuda da calisir.
            const single = ALL_CHAINS.find(c => Number(c.chainId) === ids[0])
            body.chain = single?.chainSlug
            body.chainId = ids[0]
        }

        const { data } = await axios.post(config.api + '/getChainTokens', body)

        searchUnsupported.value = false

        // Sunucu her token'a chainId damgalar. Tek zincir isteginde eski sunumlar
        // damgalamiyor olabilir: o durumda istenen zincir bellidir.
        allTokens.value = (Array.isArray(data?.tokens) ? data.tokens : [])
            .map(tk => ({ ...tk, chainId: Number(tk.chainId ?? (ids.length === 1 ? ids[0] : NaN)) }))
            .filter(tk => Number.isFinite(tk.chainId))

    } catch (error) {
        console.error('Token verileri alınırken hata:', error)

        // 400 = sunucu `chainIds`'i bilmiyor ve tek zincir alanlari da yok (coklu kapsam).
        // Kapsam "Tum Aglar" iken bu, LISTELENEN HER zincirin kimligini sunucuya
        // soruyordu - TON dahil. TON native tokeni sunucuda kayitli oldugu icin takas
        // token listesinde TON cikabiliyor, secilince de applyNetworkChange ile aktif ag
        // TON'a geciyordu: takas ekraninin ICINDEN TON'a acilan bir kapi.
        const ids = scopeChainIds(activeScope.value, chainsForFlow('swap'))
        if (ids.length > 1 && error?.response?.status === 400) searchUnsupported.value = true

        allTokens.value = []
    } finally {
        isLoading.value = false
    }
}

// Her token KENDI zincirinin RPC'sinden okunur.
const readBalances = async (tokens) => {
    if (!tokens?.length) return
    const { active_account } = await chrome.storage.local.get('active_account')

    await Promise.all(tokens.map(async (token) => {
        const key = balanceKey(token.chainId, token.address)
        if (tokenBalances.value[key] !== undefined) return

        const rpc = rpcUrlFor(token.chainId, rpcCtx.value)
        if (!rpc) { tokenBalances.value[key] = 0; return }

        try {
            tokenBalances.value[key] = await useTokenBalance(active_account.address, token.address, rpc)
        } catch (error) {
            console.error(`Error fetching balance for ${token.symbol}:`, error)
            tokenBalances.value[key] = 0
        }
    }))
}

const getImportedTokens = async() => {
    try {
        const { imported_tokens = {}, active_account } = await chrome.storage.local.get(['imported_tokens', 'active_account'])
        const byChain = imported_tokens[active_account.key] || {}

        // Kapsamdaki tokenler, her biri KENDI chainId'siyle (kova anahtarindan).
        if (activeScope.value === ALL_NETWORKS) {
            importedTokens.value = flattenImportedTokens(byChain)
        } else {
            const id = Number(activeScope.value)
            importedTokens.value = flattenImportedTokens({ [id]: byChain[id] || [] })
        }

        if(importedTokens.value.length > 0) {
            await getTokensData()
            await readBalances(importedTokens.value)

            if (tokensData.value) {
                importedTokens.value.forEach(token => {
                    const token_data = tokensData.value.find(data => data.coingecko_id === token.coingecko_id)
                    if (token_data) token['market'] = token_data.market_data
                })
            }
        }
    } catch (error) {
        console.error(error.message)
    }
}

// --- Lifecycle ---

// Eskiden bu is dogrudan onMounted icindeydi ve bir kez calisiyordu. Kapsam
// degistiginde listenin bastan kurulmasi gerektigi icin ayri bir fonksiyon.
const loadTokens = async () => {
    loading.value = true
    try {
        // Kapsam degisince onceki kapsamin bakiyeleri listede olmayan tokenlerin
        // bellegini tutar.
        tokenBalances.value = {}
        currentPage.value = 1
        searchUnsupported.value = false

        await getImportedTokens()
        await getChainTokens()

        // Out token (Swap To'da seçilen) bu listede olmamalı
        let out_token_address
        if(crypto.swap.outToken) {
            if(crypto.swap.outToken.address) out_token_address = crypto.swap.outToken.address
            else {
                out_token_address = contract_addresses[crypto.swap.outToken.uuid]?.[network.currentNetwork?.chainId]
                if(!out_token_address && contract_addresses[crypto.swap.outToken.uuid]) out_token_address = '0x0'
            }
        }

        // outToken AKTIF zincirde yaşıyor: dışlama yalnız o zincirdeki aynı adresi
        // kapsar. Adrese bakıp zinciri yok saymak, "Tüm Ağlar" modunda başka bir
        // zincirdeki farklı bir tokeni de listeden silerdi.
        const activeChainId = Number(network.currentNetwork?.chainId)
        const isOutToken = (token) =>
            Boolean(out_token_address) &&
            Number(token.chainId) === activeChainId &&
            String(token.address).toLowerCase() === String(out_token_address).toLowerCase()

        const importedKeys = new Set(importedTokens.value.map(tk => balanceKey(tk.chainId, tk.address)))

        allTokens.value = allTokens.value.filter(token =>
            !importedKeys.has(balanceKey(token.chainId, token.address)) && !isOutToken(token)
        )

        importedTokens.value = importedTokens.value.filter(token => !isOutToken(token))

    } catch (error) {
        console.error(error.message)
    } finally {
        loading.value = false
    }
}

onMounted(async() => {
    await loadTokens()

    await nextTick()
    if (searchInput.value) searchInput.value.focus()
})

// Kapsam degisince liste bastan kurulur.
watch(activeScope, async () => {
    searchQuery.value = ''
    await loadTokens()
})

const onScopeChange = (value) => scope.setFilter(value)

// --- Computed Properties ---

const isAddressSearch = computed(() => {
    return searchQuery.value && searchQuery.value.startsWith('0x') && searchQuery.value.length > 10
})

const filteredTokens = computed(() => {
    // Veri yoksa boş dön
    if (!allTokens.value) return []

    // importedTokens ve allTokens birleştiriliyor
    const totalTokens = [...importedTokens.value, ...allTokens.value]

    // Arama yoksa hepsini dön
    if (!searchQuery.value || searchQuery.value.length < 1) return totalTokens

    const query = searchQuery.value.toLowerCase().trim()

    return totalTokens.filter(token => {
        const nameMatch = token.name.toLowerCase().includes(query)
        const symbolMatch = token.symbol.toLowerCase().includes(query)
        const addressMatch = token.address.toLowerCase().includes(query)

        return nameMatch || symbolMatch || addressMatch
    }).sort((a, b) => {
        // Tam eşleşmeleri öne al
        const aExact = a.symbol.toLowerCase() === query || a.name.toLowerCase() === query
        const bExact = b.symbol.toLowerCase() === query || b.name.toLowerCase() === query
        if (aExact && !bExact) return -1
        if (!aExact && bExact) return 1
        return 0
    })
})

const displayedTokens = computed(() => {
    const endIndex = currentPage.value * itemsPerPage
    return filteredTokens.value.slice(0, endIndex)
})

const hasMoreTokens = computed(() => {
    return displayedTokens.value.length < filteredTokens.value.length
})

// --- Event Handlers ---

const handleSearch = () => {
    clearTimeout(searchTimeout)
    searchTimeout = setTimeout(() => {
        currentPage.value = 1
        if (scrollContainer.value) scrollContainer.value.scrollTop = 0
    }, 150)
}

const clearSearch = () => {
    searchQuery.value = ''
    currentPage.value = 1
    if (searchInput.value) searchInput.value.focus()
}

const handleScroll = async () => {
    if (!scrollContainer.value || loading.value || !hasMoreTokens.value) return

    const container = scrollContainer.value
    // Scroll sonuna yaklaşıldı mı? (100px kala)
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 100) {
        loading.value = true
        await new Promise(resolve => setTimeout(resolve, 100))
        currentPage.value++
        loading.value = false
    }
}

const selectToken = async (token) => {
    // Baska bir zincirdeki token: swap tek zincirli oldugu icin islem O zincire
    // tasinir. applyNetworkChange swap secimlerini sifirliyor (outToken eski
    // zincirde kaliyordu), bu yuzden ag degisimi ONCE, inToken SONRA yazilir.
    if (Number(token.chainId) !== Number(network.currentNetwork?.chainId)) {
        const chain = ALL_CHAINS.find(c => Number(c.chainId) === Number(token.chainId))
        if (!chain) return

        const reachable = await applyNetworkChange(chain, t)
        if (!reachable) return
    }

    crypto.swap.inToken = token
    popups.swap_from = false
}

const handleImageError = (event) => {
    event.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzYiIGhlaWdodD0iMzYiIHZpZXdCb3g9IjAgMCAzNiAzNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTgiIGN5PSIxOCIgcj0iMTgiIGZpbGw9IiMzMzMzMzMiLz4KPC9zdmc+'
}

const highlightMatch = (text) => {
    if (!searchQuery.value || searchQuery.value.length < 2) return text
    const query = searchQuery.value.trim()
    const regex = new RegExp(`(${query})`, 'gi')
    // Temaya uygun Indigo highlight
    return text.replace(regex, '<span class="text-indigo-400 font-bold bg-indigo-500/10 px-0.5 rounded">$1</span>')
}
</script>