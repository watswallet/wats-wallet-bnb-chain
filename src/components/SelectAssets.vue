<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-40 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/20 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-between px-5 pt-5 pb-3 relative z-10">
            <Back page="home" class="hover:bg-slate-200 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />

            <div class="w-8 h-8"></div>
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('selectAssets.title') }}</h1>
            <div class="w-8 h-8"></div>
        </div>

        <div class="px-5 pb-4 flex flex-col gap-3 relative z-10">
            <div class="relative group flex items-center w-full">
                <div class="absolute left-3 text-slate-400 dark:text-zinc-500 group-focus-within:text-indigo-500 dark:group-focus-within:text-indigo-400 transition-colors duration-300">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path stroke-dasharray="40" stroke-dashoffset="40" d="M10.76 13.24c-2.34 -2.34 -2.34 -6.14 0 -8.49c2.34 -2.34 6.14 -2.34 8.49 0c2.34 2.34 2.34 6.14 0 8.49c-2.34 2.34 -6.14 2.34 -8.49 0Z"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.5s" values="40;0"/></path><path stroke-dasharray="12" stroke-dashoffset="12" d="M10.5 13.5l-7.5 7.5"><animate fill="freeze" attributeName="stroke-dashoffset" begin="0.5s" dur="0.2s" values="12;0"/></path></g></svg>
                </div>
                
                <input 
                    type="text" 
                    v-model="searchTerm" 
                    class="w-full bg-white dark:bg-zinc-900/50 border border-slate-200 dark:border-zinc-800 rounded-xl py-3 pl-10 pr-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-400 dark:focus:border-indigo-500/50 shadow-sm dark:shadow-none transition-all duration-300" 
                    :placeholder="$t('selectAssets.search')"
                >
            </div>

            <div class="flex items-center">
                <NetworkScopePill :model-value="scope.filter" @update:model-value="onScopeChange" />
            </div>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-3 pb-3 space-y-1 relative">
            <p v-if="searchUnsupported" class="mx-1 mb-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                {{ $t('selectAssets.allNetworksSearchUnsupported') }}
            </p>

            <button 
                v-for="token in filteredTokens" 
                :key="balanceKey(token.chainId, token.address)" 
                class="w-full flex items-center justify-between p-3 rounded-xl transition-all duration-200 group border border-transparent hover:bg-white dark:hover:bg-white/5 hover:border-slate-200 dark:hover:border-white/5 hover:shadow-sm dark:hover:shadow-none cursor-pointer"
                @click="selectAsset(token)"
            >
                <div class="flex items-center gap-3 overflow-hidden">
                    
                    <div class="w-10 h-10 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center border border-slate-200 dark:border-white/5 p-0.5 shrink-0 relative transition-colors duration-300">
                        <img :src="tokenLogo(token)" :alt="token.name" class="w-full h-full rounded-full object-cover" @error="handleImageError">
                        
                        <div class="absolute -bottom-1 -right-1 w-4 h-4 bg-white dark:bg-zinc-900 rounded-full p-[1.5px] border border-slate-200 dark:border-zinc-700 transition-colors duration-300">
                            <img :src="chainLogo(token.chainId)" :alt="token.chainId" class="w-full h-full rounded-full object-contain">
                        </div>
                    </div>

                    <div class="flex flex-col items-start min-w-0">
                        <div class="flex items-center gap-2 w-full">
                            <span class="text-sm font-bold text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors duration-300">{{ token.symbol?.toUpperCase() }}</span>
                        </div>

                        <div class="flex items-center gap-2 text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-300">
                            <span>${{ token.market?.priceUSD?.toFixed(2) || '0.00' }}</span>
                            <span :class="token.market?.change?.h24 < 0 ? 'text-red-500 dark:text-red-400' : 'text-emerald-500 dark:text-emerald-400'">
                                {{ token.market?.change?.h24 > 0 ? '+' : '' }}{{ token.market?.change?.h24?.toFixed(2) || '0.00' }}%
                            </span>
                        </div>
                    </div>
                </div>

                <div class="flex flex-col items-end shrink-0 pl-2">
                    <span class="font-bold text-sm text-slate-800 dark:text-zinc-200 group-hover:text-slate-900 dark:group-hover:text-white transition-colors duration-300">{{ formatTokenAmount(tokenBalances[balanceKey(token.chainId, token.address)]) }}</span>
                    <span class="text-xs text-slate-500 dark:text-zinc-500 group-hover:text-slate-600 dark:group-hover:text-zinc-400 transition-colors duration-300">${{ formatUSDAmount(tokenBalances[balanceKey(token.chainId, token.address)] * token.market?.priceUSD) }}</span>
                </div>
            </button>

            <div v-if="loading" class="flex flex-col gap-2 pt-1">
                <div v-for="i in 5" :key="i" class="w-full flex items-center gap-3 px-3 py-3 rounded-xl border border-transparent animate-pulse">
                    <div class="w-10 h-10 rounded-full bg-slate-200 dark:bg-zinc-800 transition-colors duration-300"></div>
                    <div class="flex flex-col gap-2 flex-1">
                        <div class="w-24 h-4 rounded bg-slate-200 dark:bg-zinc-800 transition-colors duration-300"></div>
                        <div class="w-12 h-3 rounded bg-slate-200 dark:bg-zinc-800 transition-colors duration-300"></div>
                    </div>
                </div>
            </div>

            <div v-else-if="isSearching" class="flex justify-center py-4">
                <svg class="w-6 h-6 text-slate-400 dark:text-zinc-600 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
            </div>

            <div v-else-if="!filteredTokens?.length" class="flex flex-col items-center justify-center py-12 text-slate-400 dark:text-zinc-500 transition-colors duration-300">
                <svg class="w-12 h-12 mb-3 opacity-30 dark:opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 12H4M12 20V4" /></svg>
                <p class="text-sm font-medium">{{ searchFailed ? $t('selectAssets.searchError') : (searchTerm ? $t('selectAssets.resultNotFound') : $t('selectAssets.assetNotFound')) }}</p>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, ref, onMounted, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import NetworkScopePill from './NetworkScopePill.vue'
import { networkStore } from '../store/network'
import { cryptoStore } from '../store/crypto'
import { pageStore } from '../store/pageStore'
import Back from './Back.vue'
import { useTokenBalance } from '../composables/useTokenBalance'
import axios from 'axios'
import { configStore } from '../store/config'
import { ALL_CHAINS, LISTED_CHAINS } from '../data/chains'
import { ALL_NETWORKS } from '../utils/networkFilter'
import { tokenScopeStore } from '../store/tokenScope'
import { balanceKey, flattenImportedTokens, scopeChainIds, rpcUrlFor } from '../utils/tokenScope'
import { applyNetworkChange } from '../utils/applyNetworkChange'
import { isSameChainId } from '../utils/vm'
import { chainLogo } from '../utils/chainLogo'
import { useSolanaAssets } from '../composables/useSolanaAssets'
import { SOLANA_CHAIN_ID } from '../utils/solana/constants'
import { normalizeBucketChainId } from '../utils/homeTokenBucket'
import { tokenLogo } from '../utils/tokenLogo'

const { t } = useI18n()
const network = networkStore()
const crypto = cryptoStore()
const page = pageStore()
const config = configStore()

const searchTerm = ref('')
// Hesabin TUM zincirlerdeki iceri aktarilmis tokenleri: { [chainId]: Token[] }.
const importedByChain = ref({})
// Anahtar: balanceKey(chainId, address). Yalniz adrese gore anahtarlamak "Tum
// Aglar" modunda zincirleri birbirine karistirirdi (native adres her zincirde '0x0').
const tokenBalances = reactive({})
const tokensData = ref(null)
const currentTokens = ref([])
const searchResults = ref([])
const loading = ref(true)
const isSearching = ref(false)
// Arama istegi kapsam-disi bir nedenle (ag, sunucu) BASARISIZ oldu: bos-durum
// metni "bulunamadi" yerine hatayi soyler.
const searchFailed = ref(false)

// PAYLASILAN ag kapsami: ana ekranda ne secildiyse bu ekran onunla acilir.
// Cuzdanin aktif agini degistirmez — yalnizca listeyi filtreler.
const scope = tokenScopeStore()

// Coklu zincir aramasi tek istekle yapiliyor; yayindaki sunucu guncel degilse
// 400 doner. O durumda aktif zincirin sonuclarini "tum aglar" gibi GOSTERMEYIZ:
// pill "Tum Aglar" derken eksik liste tam gibi gorunurdu.
const searchUnsupported = ref(false)

const rpcCtx = computed(() => ({
    activeChainId: network.currentNetwork?.chainId,
    activeRpc: network.rpc,
    chains: ALL_CHAINS,
}))

const getTokensData = async(tokens_to_fetch) => {
    try {
        if (!tokens_to_fetch || tokens_to_fetch.length === 0) return null
        const response = await axios.post(config.api + '/getTokensDataById', {
            ids: tokens_to_fetch.map(t => t.coingecko_id).filter(Boolean)
        })
        if(response.status != 200) return null

        return response.data.tokens
    } catch (error) {
        console.error(error.message)
        return null
    }
}

// SOLANA SATIRLARI (kod incelemesi, Bulgu 2).
//
// Bu ekran cuzdanin BIRINCIL "Gonder" affordance'i (Home.vue'daki hizli eylem) ve
// Solana'da IKI SEKILDE bozuktu:
//   1. Oturum ICINDE EVM -> Solana gecisi: nextNetworkFilter kapsami
//      'solana-mainnet' yapiyor, `Number('solana-mainnet')` NaN oluyor,
//      `byChain[NaN]` bos donuyordu -> aciklamasiz BOS liste.
//   2. Zaten Solana'dayken acilan TAZE popup: nextNetworkFilter ilk yuklemede
//      `current`i dondugu icin kapsam 'all' kaliyor ve liste kullanicinin
//      ETHEREUM/POLYGON tokenlerini gosteriyordu; birine dokunmak cuzdani
//      SESSIZCE Solana'dan cikariyordu.
//
// Kaynak `imported_tokens` DEGIL: Solana satirlari orada HIC yok, Home gibi
// `useSolanaAssets`ten (canli zincir okumasi) gelir.
//
// Kapsam KURALI: aktif aga DEGIL, SECILI KAPSAMA bakilir ("Tum Aglar" ya da
// Solana). Bu ekranin tamami zaten capraz zincir: baska bir zincirin tokenine
// dokunmak `applyNetworkChange` ile o zincire gecirir (EVM'de bugun de boyle).
// Aktif aga baglasaydik pill'deki Solana secenegi BOS bir liste uretirdi.
const solanaRows = ref([])
const solanaInScope = computed(() =>
    scope.filter === ALL_NETWORKS || isSameChainId(scope.filter, SOLANA_CHAIN_ID))

// Adres cozumu Home.vue'daki (updateBalance icindeki Solana dali) ile AYNI
// sirayi izler: once hesaptaki hazir alan, yoksa arka uca sorulur.
const loadSolanaRows = async () => {
    try {
        const { active_account } = await chrome.storage.local.get('active_account')
        const solanaAddress = active_account?.solanaAddress
            || (await chrome.runtime.sendMessage({ type: 'SOLANA_GET_ADDRESS' }))?.result?.address

        // Adres COZULEMEDI, "bakiye yok" DEGIL (kasa kilitli olabilir). Elde
        // duran satirlar SIFIRLA EZILMEZ -- Home.vue ile ayni ilke.
        if (!solanaAddress) {
            console.error('Solana adresi cozulemedi: Solana satirlari listelenmiyor')
            return
        }

        solanaRows.value = await useSolanaAssets(solanaAddress)
    } catch (error) {
        // Solana tarafindaki bir ariza EVM listesini GOTURMEZ: ayri try/catch.
        console.error('Solana varliklari alinamadi:', error?.message || error)
    }
}

// Kapsamin tokenlerini depodan tazeler. Liste artik network.currentNetwork'e
// DEGIL scope'a bagli.
const loadScopeTokens = () => {
    const byChain = importedByChain.value

    let evmRows = []
    if (scope.filter === ALL_NETWORKS) {
        evmRows = flattenImportedTokens(byChain)
    } else {
        // normalizeBucketChainId: ham `Number(scope.filter)` metin bir kimlikte
        // NaN uretir ve `byChain[NaN]` her zaman undefined'dir. Solana kapsaminda
        // EVM kovasinin bos olmasi bir NaN KAZASI degil, ACIK bir kural olmali.
        const id = normalizeBucketChainId(scope.filter)
        evmRows = typeof id === 'number' ? flattenImportedTokens({ [id]: byChain[id] || [] }) : []
    }

    currentTokens.value = solanaInScope.value ? [...evmRows, ...solanaRows.value] : evmRows
}

// Solana bakiyeleri ZATEN elimizde (useSolanaAssets tek cagride miktari da
// getirir). readBalances'a birakilamazlar: `rpcUrlFor` Solana icin null doner ve
// her satira 0 yazilirdi.
const isSolanaRow = (token) => isSameChainId(token?.chainId, SOLANA_CHAIN_ID)

const applySolanaBalances = () => {
    for (const row of solanaRows.value) {
        tokenBalances[balanceKey(row.chainId, row.address)] = row.amount
    }
}

// Her token KENDI zincirinin RPC'sinden okunur. skipExisting: arama sonuclari
// icin — zaten okunmus bakiyeyi tekrar sorgulamamak.
const readBalances = async (tokens, { skipExisting = false } = {}) => {
    if (!tokens?.length) return
    const { active_account } = await chrome.storage.local.get('active_account')

    await Promise.all(tokens.map(async (token) => {
        const key = balanceKey(token.chainId, token.address)
        if (skipExisting && tokenBalances[key] !== undefined) return

        const rpc = rpcUrlFor(token.chainId, rpcCtx.value)
        // Zincir cozulemedi (kayit eski bir agdan kalmis olabilir): 0 yazilir,
        // aksi halde satirda "yukleniyor" gibi bos bir deger kalirdi.
        if (!rpc) { tokenBalances[key] = 0; return }

        try {
            // `rpc` zaten rpcUrlFor(token.chainId); chainId AYNI kaynaktan.
            tokenBalances[key] = await useTokenBalance(active_account.address, token.address, rpc, token.chainId)
        } catch (error) {
            console.error(`Error fetching balance for ${token.symbol}:`, error)
            tokenBalances[key] = 0
        }
    }))
}

const updateBalance = async () => {
    try {
        loading.value = true

        // Solana satirlari ONCE cekilir ve liste yeniden kurulur: fiyat verisi
        // (getTokensData) ve siralama onlari da kapsasin.
        if (solanaInScope.value) {
            await loadSolanaRows()
            loadScopeTokens()
        }

        tokensData.value = await getTokensData(currentTokens.value)
        if (tokensData.value) {
            currentTokens.value.forEach(token => {
                const token_data = tokensData.value.find(data => data.coingecko_id === token.coingecko_id)
                if (token_data) token['market'] = token_data.market_data
            })
        }

        // EVM satirlari zincir zincir RPC'den okunur; Solana satirlarinin miktari
        // zaten satirin uzerinde. Suzgec SOLANA'yi disliyor (VM'e gore genel bir
        // kural DEGIL): boylece zinciri cozulemeyen bir kayit eskisi gibi
        // readBalances'a girip 0 yazar -- mevcut EVM davranisi birebir korunur.
        await readBalances(currentTokens.value.filter(t => !isSolanaRow(t)))
        if (solanaInScope.value) applySolanaBalances()
    } catch (error) {
        console.error('Balance update error', error)
    } finally {
        loading.value = false
    }
}

// Kapsam degistiginde (ve ilk yuklemede) tek giris noktasi.
//
// Bilerek `watch(scope)` DEGIL: onMounted kapsami aktif zincire ayarlarken
// watcher da tetiklenir ve ekran her acilista iki kez yuklenirdi (cift RPC turu).
// Kapsam degisimi tek yerden, pill'in emit'inden gelir.
const applyScope = async () => {
    searchTerm.value = ''
    searchResults.value = []
    searchUnsupported.value = false
    searchFailed.value = false

    // Bakiyeler kapsam basina yeniden okunur: eski kapsamdan kalan kayitlar
    // listede olmayan tokenlerin bellegini tutar.
    Object.keys(tokenBalances).forEach(key => { delete tokenBalances[key] })

    loadScopeTokens()
    await updateBalance()
}

const onScopeChange = (value) => {
    scope.setFilter(value)
    applyScope()
}

onMounted(async () => {
    try {
        const { imported_tokens = {}, active_account } = await chrome.storage.local.get(['imported_tokens', 'active_account'])
        importedByChain.value = imported_tokens[active_account.key] || {}

        // Kapsam ana ekrandan MIRAS alinir; burada yeniden belirlenmez.
        await applyScope()
    } catch (error) {
        console.error('Token upload error', error)
        loading.value = false
    }
})

// Arama terimine göre token'ları filtrele (backend + local)
const filteredTokens = computed(() => {
    const term = (searchTerm.value || '').trim().toLowerCase()
    if (!term) return currentTokens.value

    const localMatches = (currentTokens.value || []).filter(token => {
        const symbolMatch = token.symbol && String(token.symbol).toLowerCase().includes(term)
        const nameMatch = token.name && String(token.name).toLowerCase().includes(term)
        const addressMatch = token.address && String(token.address).toLowerCase().includes(term)

        return symbolMatch || nameMatch || addressMatch
    })

    const merged = [...localMatches]
    // Tekillestirme ZINCIRI de icermeli: ayni adres iki zincirde ayri tokendir
    // (native '0x0' her zincirde tekrar eder).
    const seen = new Set(localMatches.map(t => balanceKey(t.chainId, t.address)))

    for (const st of searchResults.value) {
        const key = balanceKey(st.chainId, st.address)
        if (seen.has(key)) continue
        merged.push(st)
        seen.add(key)
    }

    // Bakiye önceliğine göre sırala
    return merged.sort((a, b) =>
        (tokenBalances[balanceKey(b.chainId, b.address)] || 0) -
        (tokenBalances[balanceKey(a.chainId, a.address)] || 0)
    )
})

let searchTimeout = null
watch(searchTerm, (newVal) => {
    const term = newVal?.trim()
    if (!term) {
        searchResults.value = []
        isSearching.value = false
        searchFailed.value = false
        return
    }

    isSearching.value = true
    searchFailed.value = false
    if (searchTimeout) clearTimeout(searchTimeout)

    searchTimeout = setTimeout(async () => {
        // İsteğin ait olduğu durum: yanıt dönene kadar KAPSAM değişmiş ya da yeni
        // bir arama başlamış olabilir; o sonuç artık GEÇERSİZ. Anahtar scope'tur,
        // aktif ağ değil: "Tüm Ağlar"a geçilince uçuşta olan tek zincirli yanıt
        // geçerli sayılıp listeye sızardı.
        const requestKey = `${scope.filter}|${term.toLowerCase()}`
        const stillValid = () =>
            requestKey === `${scope.filter}|${(searchTerm.value || '').trim().toLowerCase()}`

        const ids = scopeChainIds(scope.filter, LISTED_CHAINS)
        if (!ids.length) { isSearching.value = false; return }

        const body = { chainIds: ids, skip: 0, search: term }
        if (ids.length === 1) {
            // Eski sunumlar `chainIds`'i bilmez. Tek zincir isteklerinde geriye
            // dönük uyum için `chain`/`chainId` de gönderilir; ana akış (tek ağ)
            // sunucu güncellenmemiş olsa da çalışır.
            const chain = ALL_CHAINS.find(c => Number(c.chainId) === ids[0])
            body.chain = chain?.chainSlug
            body.chainId = ids[0]
        }

        try {
            const { data } = await axios.post(config.api + '/getChainTokens', body)
            if (!stillValid()) return

            searchUnsupported.value = false

            if (data && data.tokens) {
                // Sunucu her token'a chainId damgalar. Tek zincir isteğinde eski
                // sunumlar damgalamıyor olabilir: o durumda istenen zincir bellidir.
                const stamped = data.tokens
                    .map(st => ({ ...st, chainId: Number(st.chainId ?? (ids.length === 1 ? ids[0] : NaN)) }))
                    .filter(st => Number.isFinite(st.chainId))

                searchResults.value = stamped
                await readBalances(stamped, { skipExisting: true })

                // Bakiye okumaları sırasında kapsam değişmiş olabilir: bu tokenler
                // artık başka bir zincirin RPC'sinden okunuyor olurdu.
                if (!stillValid()) return

                // Market data fetch (optional, for displaying usd values of searched tokens)
                const s_data = await getTokensData(stamped)
                if (s_data) {
                    stamped.forEach(st => {
                        const token_m = s_data.find(d => d.coingecko_id === st.coingecko_id)
                        if (token_m) st['market'] = token_m.market_data
                    })
                }
            }
        } catch (e) {
            // 400 = sunucu `chainIds`'i bilmiyor ve tek zincir alanları da yok
            // (çoklu kapsam). Sessizce tek zincire düşmek yanıltıcı olurdu.
            if (ids.length > 1 && e?.response?.status === 400) searchUnsupported.value = true
            else searchFailed.value = true
            searchResults.value = []
            console.error('Token search API error:', e)
        } finally {
            // Eskiyen bir istegin finally'si yeni aramanin debounce'u surerken
            // spinner'i dusurmesin: temizligi gecerli istegin kendisi (ya da
            // bos-terim dali) yapar.
            if (stillValid()) isSearching.value = false
        }
    }, 400)
})

// Token miktarını formatla
const formatTokenAmount = (amount) => {
    if (!amount) return '0.0000'
    if (amount >= 1000) return (amount / 1000).toFixed(2) + 'K'
    return amount.toFixed(4)
}

// USD miktarını formatla
const formatUSDAmount = (amount) => {
    if (!amount) return '0.00'
    if (amount >= 1000) return (amount / 1000).toFixed(2) + 'K'
    return amount.toFixed(2)
}

// Asset seç ve send sayfasına git
const selectAsset = async (asset) => {
    // Baska bir zincirdeki token: Send.vue bakiyeyi ve provider'i network.rpc'den
    // okuyor, dolayisiyla gitmeden ONCE aktif ag degismek ZORUNDA. `await` sart:
    // RPC yerlesmeden gidilirse islem eski zincirin RPC'sinde hazirlanir.
    //
    // KARSILASTIRMA isSameChainId ILE: `Number()` iki Solana degerini de NaN'a
    // ceviriyordu ve `NaN !== NaN` HER ZAMAN dogru oldugu icin "zincir farkli"
    // saniliyor, ardindan `Number(c.chainId) === NaN` HICBIR kayitla eslesmedigi
    // icin fonksiyon ciplak `return` ile cikiyordu: Solana satirina basmak
    // HICBIR SEY yapmiyordu. EVM tarafinda davranis AYNI ('1' ile 1 yine ayni
    // zincir, cozulemeyen kimlik yine ciplak return).
    if (!isSameChainId(asset.chainId, network.currentNetwork?.chainId)) {
        const chain = ALL_CHAINS.find(c => isSameChainId(c.chainId, asset.chainId))
        if (!chain) return

        // applyNetworkChange swap/bridge secimlerini sifirliyor ama sendAsset'e
        // dokunmuyor: bu yuzden ag degisimi ONCE, sendAsset SONRA yazilir.
        const reachable = await applyNetworkChange(chain, t)
        if (!reachable) return
    }

    crypto.sendAsset = asset
    page.currentPage = 'send'
}

// Resim yükleme hatası durumunda placeholder göster
const handleImageError = (event) => {
    event.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzYiIGhlaWdodD0iMzYiIHZpZXdCb3g9IjAgMCAzNiAzNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTgiIGN5PSIxOCIgcj0iMTgiIGZpbGw9IiMzMzMzMzMiLz4KPC9zdmc+'
}

// Eskiden burada network.currentNetwork izleniyordu. Artik liste kapsama bagli ve
// ekran agi yalnizca capraz zincir secimde degistiriyor — o da hemen send'e
// gidiyor. Ag izleyicisi bu yuzden yalnizca ekran kapanirken gereksiz bir yeniden
// yukleme turu tetikliyordu; kaldirildi. Kapsam degisimi `onScopeChange`'den gelir.

// setCurrentNetwork rpc'yi hemen yeni zincire çekiyor, findFastestRPC ise sonra daha
// hızlısına yükseltiyor. Bu ikinci adımdan sonra bakiyeler tazelenmezse ilk (yavaş
// olabilen) RPC'nin sonuçlarında kalınır.
watch(() => network.rpc, () => {
    if (network.rpcChainId !== network.currentNetwork?.chainId) return
    // Kapsam aktif zinciri icermiyorsa bu RPC hicbir satiri etkilemez.
    if (!scopeChainIds(scope.filter, LISTED_CHAINS).includes(Number(network.currentNetwork?.chainId))) return
    updateBalance()
})
</script>