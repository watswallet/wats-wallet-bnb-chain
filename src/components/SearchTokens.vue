<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex flex-col gap-4 px-5 pt-5 pb-2 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md z-50 transition-colors duration-300">
            
            <div class="flex items-center justify-center">
                <Back page="home" class="hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
                <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('searchTokens.title') }}</h1>
            </div>

            <div>
                <NetworkScopePill :model-value="scope.filter" @update:model-value="onScopeChange" />
            </div>

            <div class="relative group">
                <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-zinc-500 group-focus-within:text-indigo-500 dark:group-focus-within:text-indigo-400 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input 
                    v-model="searchQuery" 
                    type="text" 
                    :placeholder="$t('searchTokens.search')" 
                    class="w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500/50 focus:bg-slate-50 dark:focus:bg-[#18181b] shadow-sm dark:shadow-none transition-all duration-300"
                >
            </div>
        </div>

        <div 
            ref="scrollContainer" 
            class="flex-1 overflow-y-auto custom-scrollbar px-2 pt-2 pb-20 relative z-10"
            @scroll="handleScroll"
        >
            <p v-if="searchUnsupported" class="mx-2 mb-3 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                {{ $t('selectAssets.allNetworksSearchUnsupported') }}
            </p>

            <div v-if="hasImportedTokens && !searchQuery" class="mb-4">
                <p class="text-[10px] font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider px-4 mb-2 transition-colors duration-300">{{ $t('searchTokens.imported') }}</p>
                
                <div class="flex flex-col gap-1">
                    <div 
                        v-for="token in importedTokensList" 
                        :key="balanceKey(token.chainId, token.address || token.symbol)"
                        class="group w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 transition-all duration-200 cursor-pointer"
                    >
                        <div class="flex items-center gap-3 min-w-0 flex-1">
                            <div class="relative w-10 h-10 rounded-full bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-white/5 flex items-center justify-center shrink-0 transition-colors duration-300">
                                <img 
                                    :src="tokenLogo(token)" 
                                    :alt="token.name" 
                                    class="w-full h-full rounded-full object-cover"
                                    @error="handleImageError"
                                >
                                <div class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white dark:bg-black flex items-center justify-center transition-colors duration-300">
                                    <img :src="chainLogo(token.chainId)" :alt="token.chainId" class="w-3 h-3 rounded-full">
                                </div>
                            </div>
                            
                            <div class="flex flex-col items-start min-w-0 w-full">
                                <div class="flex items-center gap-1.5">
                                    <span class="text-sm font-bold text-slate-900 dark:text-white transition-colors duration-300">{{ token.symbol?.toUpperCase() }}</span>
                                    <!-- Native varlığın adresi '0x0' placeholder'ı; kısaltılınca "0x0...0x0" görünürdü (bkz. Token.vue). -->
                                    <span v-if="token.address && token.address !== '0x0'" class="text-[10px] text-slate-500 dark:text-zinc-600 font-mono bg-slate-100 dark:bg-zinc-900 px-1 py-0.5 rounded transition-colors duration-300">{{ token.address.slice(0, 4) }}...{{ token.address.slice(-4) }}</span>
                                </div>
                                <span class="truncate w-full text-xs text-slate-500 dark:text-zinc-500 text-start transition-colors duration-300">{{ token.name }}</span>
                            </div>
                        </div>

                        <button 
                            @click.stop="removeToken(token)"
                            class="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-rose-100 dark:hover:bg-rose-500/10 text-slate-400 dark:text-zinc-600 hover:text-rose-500 dark:hover:text-rose-500 transition-colors duration-300 cursor-pointer"
                        >
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                    </div>
                </div>
            </div>

            <div v-if="filteredGeneralTokens.length > 0">
                <p v-if="!loadedQuery" class="text-[10px] font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider px-4 mb-2 mt-4 transition-colors duration-300">{{ $t('searchTokens.popular') }}</p>
                <p v-else class="text-[10px] font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider px-4 mb-2 transition-colors duration-300">{{ $t('searchTokens.results') }}</p>

                <div class="flex flex-col gap-1">
                    <div 
                        v-for="token in filteredGeneralTokens" 
                        :key="balanceKey(token.chainId, token.address || token.symbol)"
                        class="group w-full flex items-center justify-between p-3 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 transition-all duration-200 cursor-pointer"
                    >
                        <div class="flex items-center gap-3 min-w-0 flex-1">
                            <div class="relative w-10 h-10 rounded-full bg-slate-100 dark:bg-zinc-800 border border-slate-200 dark:border-white/5 flex items-center justify-center shrink-0 transition-colors duration-300">
                                <img 
                                    :src="tokenLogo(token)" 
                                    :alt="token.name" 
                                    class="w-full h-full rounded-full object-cover"
                                    @error="handleImageError"
                                >
                                <div class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white dark:bg-black flex items-center justify-center transition-colors duration-300">
                                    <img :src="chainLogo(token.chainId)" :alt="token.chainId" class="w-3 h-3 rounded-full">
                                </div>
                            </div>
                            
                            <div class="flex flex-col items-start min-w-0 w-full">
                                <div class="flex items-center gap-1.5">
                                    <span class="text-sm font-bold text-slate-900 dark:text-white transition-colors duration-300">{{ token.symbol?.toUpperCase() }}</span>
                                </div>
                                <span class="truncate w-full text-xs text-slate-500 dark:text-zinc-500 text-start transition-colors duration-300">{{ token.name }}</span>
                            </div>
                        </div>

                        <button 
                            @click.stop="importToken(token)"
                            class="shrink-0 px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-emerald-500 dark:bg-zinc-800 dark:hover:bg-emerald-600 text-xs font-bold text-slate-600 hover:text-white dark:text-zinc-400 dark:hover:text-white transition-all duration-300 flex items-center gap-1 cursor-pointer"
                        >
                            <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
                            {{ $t('searchTokens.add') }}
                        </button>
                    </div>
                </div>
            </div>

            <div v-if="isLoading" class="flex justify-center py-4">
                <svg class="w-6 h-6 text-slate-400 dark:text-zinc-600 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            </div>

            <div v-if="!isLoading && filteredGeneralTokens.length === 0 && !hasImportedTokens" class="flex flex-col items-center justify-center py-10 gap-2">
                <!-- Liste cekilemediyse "bulunamadi" degil hata + tekrar dene (History.vue deseni). -->
                <template v-if="loadFailed">
                    <p class="text-sm text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('searchTokens.loadError') }}</p>
                    <button @click="getChainTokens()" class="text-xs font-semibold text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 underline cursor-pointer">
                        {{ $t('searchTokens.retry') }}
                    </button>
                </template>
                <template v-else>
                    <div class="w-12 h-12 rounded-full bg-slate-100 dark:bg-zinc-800/50 flex items-center justify-center text-slate-400 dark:text-zinc-600 transition-colors duration-300">
                        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    </div>
                    <p class="text-sm text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('searchTokens.notfound') }}</p>
                </template>
            </div>

            <div class="fixed bottom-0 left-0 right-0 p-4 bg-linear-to-t from-slate-50 dark:from-[#09090b] to-transparent pointer-events-none flex justify-center z-20 transition-colors duration-300">
                <button 
                    class="pointer-events-auto bg-white hover:bg-slate-50 dark:bg-[#131315] dark:hover:bg-[#18181b] border border-slate-200 dark:border-white/10 hover:border-indigo-400 dark:hover:border-indigo-500/50 px-5 py-2.5 rounded-full flex items-center gap-2 shadow-lg dark:shadow-xl transition-all duration-300 group cursor-pointer"
                    @click="page.currentPage = 'import_token'"
                >
                    <span class="text-xs font-bold text-slate-600 group-hover:text-slate-900 dark:text-zinc-400 dark:group-hover:text-white transition-colors duration-300">{{ $t('searchTokens.isNotFound') }}</span>
                    <span class="text-xs font-bold text-indigo-600 group-hover:text-indigo-700 dark:text-indigo-400 dark:group-hover:text-indigo-300 flex items-center gap-1 transition-colors duration-300">
                        {{ $t('searchTokens.manual') }} <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                    </span>
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, watch, onMounted, computed, onUnmounted } from 'vue'
import NetworkScopePill from './NetworkScopePill.vue'
import Back from './Back.vue'
import { pageStore } from '../store/pageStore'
import axios from 'axios'
import { configStore } from '../store/config'
import { tokenScopeStore } from '../store/tokenScope'
import { ALL_CHAINS, LISTED_CHAINS } from '../data/chains'
import { chainLogo } from '../utils/chainLogo'
import { ALL_NETWORKS } from '../utils/networkFilter'
import { balanceKey, flattenImportedTokens, scopeChainIds } from '../utils/tokenScope'
import { tokenLogo } from '../utils/tokenLogo'

const page = pageStore()
const config = configStore()
// PAYLASILAN ag kapsami: ana ekranda ne secildiyse bu ekran onunla acilir.
const scope = tokenScopeStore()

// Ag logosu cozumlemesi utils/chainLogo.js'te TEK yerde: burada kopyalanan
// `Number()` karsilastirmasi Solana'nin METIN kimligini NaN'a cevirip rozeti
// sessizce varsayilana dusuruyordu.

const searchQuery = ref('')
const generalTokens = ref([])
const skip = ref(0)
const limit = ref(25)
const isLoading = ref(false)
const scrollContainer = ref(null)
const hasMoreTokens = ref(true)
const account_key = ref(null)
const imported_tokens = ref({})
const filteredGeneralTokens = ref([])
// Ekrandaki listenin HANGİ terime ait olduğu. Başlık `searchQuery`ye bakınca
// kullanıcı yazar yazmaz "Sonuçlar"a geçiyor ama liste hâlâ popüler tokenlerdi.
const loadedQuery = ref('')
// Coklu zincir aramasi tek istekle yapilir; yayindaki sunucu guncel degilse 400
// doner. Aktif zincirin sonuclarini "tum aglar" gibi gostermek yaniltici olurdu.
const searchUnsupported = ref(false)
// Liste cekilemedi (ag/sunucu hatasi). "Token bulunamadi" demek yaniltici olurdu;
// hata metni + "Tekrar dene" gosterilir.
const loadFailed = ref(false)

// Computed Helpers
const importedTokensList = computed(() => {
    if (!account_key.value || !imported_tokens.value) return []
    
    const term = searchQuery.value?.trim().toLowerCase()
    let list = scopedImportedTokens()
    
    // Arama yapılıyorsa import edilmiş listeyi de filtrele
    if (term) {
        list = list.filter(token => 
            token.name?.toLowerCase().includes(term) ||
            token.symbol?.toLowerCase().includes(term) ||
            token.address?.toLowerCase().includes(term)
        )
    }
    return list
})

const hasImportedTokens = computed(() => {
    return importedTokensList.value.length > 0
})

// Kapsamdaki iceri aktarilmis tokenler, her biri KENDI chainId'siyle. Kayitlar
// zincire gore kovalanmis oldugu icin chainId kova anahtarindan gelir.
const scopedImportedTokens = () => {
    const byChain = imported_tokens.value[account_key.value] || {}

    if (scope.filter === ALL_NETWORKS) return flattenImportedTokens(byChain)

    const id = Number(scope.filter)
    return flattenImportedTokens({ [id]: byChain[id] || [] })
}

// Bir isteğin AİT OLDUĞU durum: zincir + arama terimi. Yanıt döndüğünde durum
// değişmişse sonuç ÇÖPE gider; aksi halde kullanıcı bir ağın (ya da bir önceki
// aramanın) listesini başka bir ağda/aramada görmeye devam ediyordu.
const requestKey = () =>
    `${scope.filter}|${(searchQuery.value || '').trim().toLowerCase()}`

// Uçuşta olan istek varken gelen çağrı SESSİZCE atılıyordu. İstek artık atılmıyor:
// son gelen çağrı, uçuştaki bitince çalışır; arada kalan çağrılar gereksizdir
// (her biri aynı listenin yerine geçecekti).
let inFlight = Promise.resolve()
let requestSeq = 0

const getChainTokens = async(append = false) => {
    const mine = ++requestSeq

    inFlight = inFlight
        .catch(() => {})
        .then(() => {
            if (mine !== requestSeq) return
            return fetchChainTokens(append, mine)
        })

    await inFlight
}

const fetchChainTokens = async(append, mine) => {
    // Ağ mağazası asenkron başlıyor; çözülmeden yapılan istek TypeError atıp
    // listeyi kalıcı olarak boş bırakıyordu.
    // Kapsam bir zincire cozulmediyse (ag magazasi asenkron basliyor) istek atilmaz.
    const ids = scopeChainIds(scope.filter, LISTED_CHAINS)
    if (!ids.length) {
        // Ağ çözülünce chainId izleyicisi yeniden çağırır; yükleniyor durumu
        // burada bırakılırsa sonsuz kaydırma kilitli kalır.
        if (mine === requestSeq) isLoading.value = false
        return
    }

    const key = requestKey()
    const term = (searchQuery.value || '').trim()
    // Sayfa başlangıcı istekle birlikte SABİTLENİR: başarısız istek `skip`i
    // ilerletmez, dolayısıyla listede atlanan sayfa oluşmaz.
    const requestedSkip = append ? skip.value : 0

    try {
        isLoading.value = true

        // chainId de gönderilir: sunucu zinciri slug yerine kimlikten çözebilsin
        // (slug'lar sürümler arasında değişebiliyor).
        const body = {
            chainIds: ids,
            skip: requestedSkip,
            limit: limit.value,
            ...(term ? { search: term } : {})
        }
        if (ids.length === 1) {
            // Eski sunumlar `chainIds`'i bilmez. Tek zincirde geriye donuk uyum icin
            // `chain`/`chainId` de gonderilir; ana akis guncellenmemis sunucuda da calisir.
            const single = ALL_CHAINS.find(c => Number(c.chainId) === ids[0])
            body.chain = single?.chainSlug
            body.chainId = ids[0]
        }

        const { data } = await axios.post(config.api + '/getChainTokens', body)

        // Yanıt beklerken ağ değiştiyse ya da yeni bir arama başladıysa bu sonuç
        // artık GEÇERSİZ.
        if (mine !== requestSeq || key !== requestKey()) return

        searchUnsupported.value = false
        loadFailed.value = false

        // Sunucu her token'a chainId damgalar. Tek zincir isteginde eski sunumlar
        // damgalamiyor olabilir: o durumda istenen zincir bellidir.
        const tokens = (Array.isArray(data?.tokens) ? data.tokens : [])
            .map(t => ({ ...t, chainId: Number(t.chainId ?? (ids.length === 1 ? ids[0] : NaN)) }))
            .filter(t => Number.isFinite(t.chainId))

        generalTokens.value = append ? [...generalTokens.value, ...tokens] : tokens
        skip.value = requestedSkip + tokens.length
        hasMoreTokens.value = tokens.length >= limit.value
        loadedQuery.value = term

        filterGeneralTokens()

    } catch (error) {
        console.error('Token fetch error:', error)
        if (mine !== requestSeq || key !== requestKey()) return

        // 400 = sunucu `chainIds`'i bilmiyor ve tek zincir alanlari da yok (coklu kapsam).
        if (ids.length > 1 && error?.response?.status === 400) searchUnsupported.value = true

        if (!append) {
            generalTokens.value = []
            filteredGeneralTokens.value = []
            loadedQuery.value = term
            hasMoreTokens.value = false
            // 400 (coklu kapsam) dalinda amber uyari yeterli; diger hatalarda
            // bos-durum "bulunamadi" yerine hata + tekrar dene gosterilir.
            loadFailed.value = !(ids.length > 1 && error?.response?.status === 400)
        }
        // Ekleme (sonsuz kaydırma) başarısızsa hasMoreTokens'a dokunulmaz:
        // `skip` ilerlemediği için bir sonraki kaydırma aynı sayfayı tekrar dener.
    } finally {
        if (mine === requestSeq) isLoading.value = false
    }
}

const filterGeneralTokens = () => {
    if (!account_key.value) return

    // Zaten ekli olanlari cikar. Anahtar ZINCIRI de icerir: yalniz adrese bakmak
    // "Tum Aglar" modunda bir zincirde ekli tokeni diger zincirlerde de ekli sayardi.
    const importedKeys = new Set(
        scopedImportedTokens()
            .filter(token => token.address)
            .map(token => balanceKey(token.chainId, token.address))
    )
    
    // Genel token listesini (generalTokens) filtrele (zaten ekli olanları çıkar)
    filteredGeneralTokens.value = (generalTokens.value || []).filter(token =>
        token.address && !importedKeys.has(balanceKey(token.chainId, token.address))
    )
}

const loadTokens = async () => {
    try {
        const { imported_tokens: importedTokens } = await chrome.storage.local.get('imported_tokens')
        imported_tokens.value = importedTokens || {}
    } catch (error) {
        console.error('Token load error:', error)
        imported_tokens.value = {}
    }
}

const saveTokens = async (tokens) => {
    try {
        const { imported_tokens: currentImportedTokens } = await chrome.storage.local.get('imported_tokens')

        const updatedTokens = {
            ...currentImportedTokens,
            [account_key.value]: {
                ...currentImportedTokens?.[account_key.value],
                ...tokens
            }
        }

        await chrome.storage.local.set({ imported_tokens: updatedTokens })
        imported_tokens.value = updatedTokens
        
    } catch (error) {
        console.error('Token save error:', error)
    }
}

const importToken = async (token) => {
    try {
        // Token KENDI zincirinin kovasina yazilir. Aktif agi belirleyici saymak,
        // "Tum Aglar" modunda Ethereum tokenini BSC kovasina yazardi.
        const chainId = Number(token.chainId)
        if (!Number.isFinite(chainId)) return
        
        // Import listesindeki tüm tokenleri al
        const currentChainTokens = imported_tokens.value[account_key.value]?.[chainId] || []
        
        const alreadyImported = currentChainTokens.some(t => 
            t.address?.toLowerCase() === token.address?.toLowerCase()
        )
        
        if (alreadyImported) return
        
        const tokenToImport = {
            ...token,
            importedAt: new Date().toISOString()
        }
        
        const updatedChainTokens = [...currentChainTokens, tokenToImport]
        await saveTokens({ [chainId]: updatedChainTokens })
        filterGeneralTokens()
                
    } catch (error) {
        console.error('Import error:', error)
    }
}

const removeToken = async (tokenToRemove) => {
    try {
        const chainId = Number(tokenToRemove.chainId)
        if (!Number.isFinite(chainId)) return
        const currentChainTokens = imported_tokens.value[account_key.value]?.[chainId] || []
        
        const updatedChainTokens = currentChainTokens.filter(token => 
            token.address?.toLowerCase() !== tokenToRemove.address?.toLowerCase()
        )
        
        await saveTokens({ [chainId]: updatedChainTokens })
        filterGeneralTokens()
        
    } catch (error) {
        console.error('Remove error:', error)
    }
}

const handleScroll = async (event) => {
    if (!scrollContainer.value || isLoading.value || !hasMoreTokens.value) return

    const target = event.target
    // `skip` artık burada değil, GELEN kayıt sayısına göre fetchChainTokens içinde
    // ilerler: başarısız bir sayfa isteği listede boşluk bırakmıyor.
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 200) {
        await getChainTokens(true)
    }
}

const handleImageError = (event) => {
    event.target.src = '/default-token.png'
}

const resetTokenList = () => {
    skip.value = 0
    generalTokens.value = []
    filteredGeneralTokens.value = []
    loadedQuery.value = ''
    hasMoreTokens.value = true
    loadFailed.value = false
}

// Watchers
let searchTimeout = null

// Kapsam izlenir, aktif ağ değil: store zaten ağ değişimini kapsama yansıtıyor
// (bkz. store/tokenScope.js), dolayısıyla iki ayrı izleyici çift istek atardı.
watch(() => scope.filter, async () => {
    searchUnsupported.value = false

    // Bekleyen arama iptal edilir: aksi halde ağ değişiminden hemen sonra eski
    // terimle ikinci bir istek daha gidiyordu.
    if (searchTimeout) clearTimeout(searchTimeout)
    searchQuery.value = ''
    resetTokenList()
    await getChainTokens()
})

const onScopeChange = (value) => scope.setFilter(value)

watch(searchQuery, () => {
    if (searchTimeout) clearTimeout(searchTimeout)

    // Debounce the backend call
    searchTimeout = setTimeout(async () => {
        skip.value = 0
        hasMoreTokens.value = true
        await getChainTokens()
    }, 400)
})

onUnmounted(() => {
    if (searchTimeout) clearTimeout(searchTimeout)
})

onMounted(async() => {
    const { active_account } = await chrome.storage.local.get('active_account')
    if(active_account) account_key.value = active_account.key

    await loadTokens()
    await getChainTokens()
})
</script>