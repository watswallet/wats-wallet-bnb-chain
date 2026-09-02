<template>
    <div class="fixed inset-0 flex items-center justify-center z-50 bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm px-4" @click="popups.swap_to = false"> 
        
        <div 
            class="w-full max-w-85 h-125 flex flex-col bg-white dark:bg-[#09090b] border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl dark:shadow-2xl overflow-hidden relative transition-colors duration-300" 
            @click.stop
        >
            <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-500/10 to-transparent pointer-events-none transition-colors duration-300"></div>

            <div class="flex items-center justify-between px-5 pt-5 pb-3 relative z-10">
                <h4 class="font-bold text-slate-900 dark:text-white text-lg tracking-tight transition-colors duration-300">{{ $t('swap.to.title') }}</h4>
                <button 
                    class="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white transition-colors duration-300 cursor-pointer shadow-sm dark:shadow-none" 
                    @click="popups.swap_to = false"
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
                        @input="handleSearch" 
                        class="w-full bg-slate-50 dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-xl py-3 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500/50 focus:bg-white dark:focus:bg-zinc-900 shadow-sm dark:shadow-none transition-all duration-300" 
                        :placeholder="$t('swap.to.search')"
                    >
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

                <div v-else-if="(!importedTokens || importedTokens.length === 0) && displayedTokens.length === 0" class="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-zinc-500">
                    <svg class="w-10 h-10 mb-3 opacity-30 dark:opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <p class="text-sm font-medium">{{ $t('swap.to.notFound') }}</p>
                </div>

                <div v-if="importedTokens && importedTokens.length > 0 && !searchQuery" class="mb-2">
                    <p class="px-4 py-2 text-[10px] font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider sticky top-0 bg-white/95 dark:bg-[#09090b]/95 backdrop-blur z-20 transition-colors duration-300">
                        {{ $t('swap.to.myTokens') }}
                    </p>
                    
                    <button 
                        v-for="token in importedTokens" 
                        :key="token.address" 
                        class="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5 rounded-xl transition-all duration-200 group border border-transparent cursor-pointer" 
                        @click="selectToken(token)"
                    >
                        <div class="flex items-center gap-3">
                            <div class="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-white/5 transition-colors duration-300">
                                <img :src="token.image.large" :alt="token.name" class="w-full h-full object-cover" @error="handleImageError">
                            </div>

                            <div class="flex flex-col items-start">
                                <p class="font-bold text-slate-900 dark:text-zinc-100 text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors text-start">{{ token.name }}</p>
                                <p class="text-slate-500 dark:text-zinc-500 text-xs font-mono">{{ token.symbol.toUpperCase() }}</p>
                            </div>
                        </div>
                        
                        <div class="flex flex-col items-end">
                            <p class="font-bold text-sm text-slate-800 dark:text-zinc-200 transition-colors duration-300">{{ tokenBalances[token.address] ? tokenBalances[token.address].toFixed(4) : '0.00' }}</p>
                            <p class="text-[10px] text-slate-500 dark:text-zinc-500 transition-colors duration-300" v-if="token.market?.priceUSD">${{ ((tokenBalances[token.address] || 0) * token.market.priceUSD).toFixed(2) }}</p>
                        </div>
                    </button>
                </div>

                <div v-if="displayedTokens.length > 0">
                    <p class="px-4 py-2 text-[10px] font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider sticky top-0 bg-white/95 dark:bg-[#09090b]/95 backdrop-blur z-20 transition-colors duration-300">
                        {{ $t('swap.to.allTokens') }}
                    </p>
                    
                    <button 
                        v-for="token in displayedTokens" 
                        :key="token.address" 
                        class="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5 rounded-xl transition-all duration-200 group border border-transparent cursor-pointer" 
                        @click="selectToken(token)"
                    >
                        <div class="w-9 h-9 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden border border-slate-200 dark:border-white/5 transition-colors duration-300">
                            <img :src="token.logoURI || token.image?.large" :alt="token.name" class="w-full h-full object-cover" @error="handleImageError">
                        </div>
                        
                        <div class="flex flex-col items-start">
                            <p class="font-bold text-slate-900 dark:text-zinc-100 text-sm group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors text-start">{{ token.name }}</p>
                            <p class="text-slate-500 dark:text-zinc-500 text-xs font-mono">{{ token.symbol.toUpperCase() }}</p>
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
import { computed, onMounted, ref } from 'vue'
import axios from 'axios'
import { popupStore } from '../../store/popup'
import { cryptoStore } from '../../store/crypto'
import contract_addresses from '../../data/contract_addresses.json'
import { useTokenBalance } from '../../composables/useTokenBalance'
import { networkStore } from '../../store/network'
import { configStore } from '../../store/config'

// State ve Store
const popups = popupStore()
const crypto = cryptoStore()
const network = networkStore()
const config = configStore()

const allTokens = ref([]) // Başlangıçta boş array
const searchQuery = ref('')
const loading = ref(false)
const scrollContainer = ref(null)
const importedTokens = ref([])
const tokenBalances = ref({})
const tokensData = ref(null)

// Pagination
const itemsPerPage = 20
const currentPage = ref(1)
const isLoadingApi = ref(false) // API isteği durumu için ayrı flag
const skip = ref(0)
const limit = ref(50) // Daha fazla veri çekelim

// --- Logic ---

const getTokensData = async() => {
    try {
        if (!importedTokens.value || importedTokens.value.length === 0) return
        const response = await axios.post(config.api + '/getTokensDataById', {
            ids: importedTokens.value.map(t => t.coingecko_id)
        })
        if(response.status != 200) return
        tokensData.value = response.data.tokens
    } catch (error) {
        console.error(error.message)
    }
}

const filteredTokens = computed(() => {
    if (!allTokens.value) return []
    if (!searchQuery.value || searchQuery.value.length < 1) return allTokens.value
    
    const query = searchQuery.value.toLowerCase().trim()
    
    return allTokens.value.filter(token => {
        const nameMatch = token.name?.toLowerCase().includes(query)
        const symbolMatch = token.symbol?.toLowerCase().includes(query)
        const addressMatch = token.address?.toLowerCase().includes(query)
        return nameMatch || symbolMatch || addressMatch
    }).sort((a, b) => {
        // Basit sıralama (Tam eşleşmeler önce)
        const aSymbol = a.symbol?.toLowerCase()
        const bSymbol = b.symbol?.toLowerCase()
        if (aSymbol === query && bSymbol !== query) return -1
        if (aSymbol !== query && bSymbol === query) return 1
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

const handleSearch = () => {
    currentPage.value = 1
    // Eğer API tabanlı arama yapılacaksa burada debounce ile API çağrısı yapılabilir
}

const handleScroll = async () => {
    if (!scrollContainer.value || loading.value || !hasMoreTokens.value) return
    
    const container = scrollContainer.value
    // Scroll sonuna yaklaşıldı mı? (50px kala)
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 50) {
        loading.value = true
        // UI thread'i bloklamamak için kısa gecikme
        await new Promise(resolve => setTimeout(resolve, 100))
        currentPage.value++
        loading.value = false
    }
}

const selectToken = (token) => {
    crypto.swap.outToken = token
    popups.swap_to = false
}

const handleImageError = (event) => {
    // Fallback image (Koyu temaya uygun gri daire)
    event.target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjNTI1MjVCIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCI+PGNpcmNsZSBjeD0iMTIiIGN5PSIxMiIgcj0iMTAiLz48cGF0aCBkPSJNMTIgOGw0IDQiLz48cGF0aCBkPSJNMTIgMTZ2LTQiLz48L3N2Zz4='
}

const getImportedTokens = async() => {
    try {
        const { imported_tokens = {}, active_account } = await chrome.storage.local.get(['imported_tokens', 'active_account'])
        importedTokens.value = imported_tokens[active_account.key]?.[network.currentNetwork.chainId] || []
        
        if (importedTokens.value.length > 0) {
            await getTokensData()
            for (const token of importedTokens.value) {
                const tokenAmount = await useTokenBalance(active_account.address, token.address, network.rpc)
                tokenBalances.value[token.address] = tokenAmount
                if (tokensData.value) {
                    const token_data = tokensData.value.find(data => data.coingecko_id === token.coingecko_id)
                    if (token_data) token['market'] = token_data.market_data
                }
            }
        }
    } catch (error) {
        console.error(error.message)
    }
}

const getChainTokens = async(append = false) => {
    if (isLoadingApi.value) return
    
    try {
        isLoadingApi.value = true
        // Loading state'i ilk yüklemede göster
        if (!append) loading.value = true 
        
        const { data } = await axios.post(config.api + '/getChainTokens', {
            chain: network.currentNetwork?.chainSlug,
            // chainId de gönderilir: sunucu zinciri slug yerine kimlikten çözebilsin.
            chainId: network.currentNetwork?.chainId,
            skip: skip.value,
            limit: limit.value
        })

        if (data && data.tokens) {
            if (append) {
                // Duplicate kontrolü yaparak ekle
                const newTokens = data.tokens.filter(nt => !allTokens.value.some(at => at.address === nt.address))
                allTokens.value = [...allTokens.value, ...newTokens]
            } else {
                allTokens.value = data.tokens
            }
            
            // Eğer dönen veri limiti dolduruyorsa daha fazlası olabilir
            // Bu kısım sonsuz kaydırma (API pagination) için genişletilebilir
        }
    } catch (error) {
        console.error('Token verileri alınırken hata:', error)
        if (!append) allTokens.value = []
    } finally {
        isLoadingApi.value = false
        loading.value = false
    }
}

onMounted(async() => {
    try {
        // Paralel istekler (Performans için)
        await Promise.all([
            getImportedTokens(),
            getChainTokens()
        ])

        const imported_addresses = importedTokens.value?.map(t => t.address) || []

        // In token adresi belirlenmesi
        let in_token_address
        if(crypto.swap.inToken?.address) {
            in_token_address = crypto.swap.inToken.address
        } else if (crypto.swap.inToken?.uuid) {
            in_token_address = contract_addresses[crypto.swap.inToken.uuid]?.[network.currentNetwork.chainId]
            if(!in_token_address) in_token_address = '0x0'
        }

        // Listeyi temizle: Import edilmiş veya zaten seçili olan (inToken) tokenları ana listeden çıkar
        if (allTokens.value.length > 0) {
             allTokens.value = allTokens.value.filter(token => {
                return !imported_addresses.includes(token.address) && token.address !== in_token_address
            })
        }

        if (importedTokens.value.length > 0) {
            importedTokens.value = importedTokens.value.filter(token => 
                token.address !== in_token_address
            )
        }
        
    } catch (error) {
        console.error(error)
    }
})
</script>