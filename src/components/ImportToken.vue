<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 transition-colors duration-300">
            <Back page="search_tokens" class="absolute left-5 hover:bg-slate-200 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('importToken.custom.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-6 flex flex-col gap-6 relative pb-20">
            
            <div class="flex justify-center">
                <div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white dark:bg-zinc-800/50 border border-slate-200 dark:border-white/5 shadow-sm transition-colors duration-300">
                    <img :src="network.currentNetwork.logoURI" :alt="network.currentNetwork.name" class="w-4 h-4 rounded-full border border-slate-200 dark:border-transparent">
                    <span class="text-xs font-bold text-slate-600 dark:text-zinc-300 transition-colors duration-300">{{ $t('importToken.custom.addingTo', { network: network.currentNetwork.name }) }}</span>
                </div>
            </div>

            <div class="flex flex-col gap-2">
                <label class="text-xs font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider ml-1 transition-colors duration-300">{{ vm === 'solana' ? $t('importToken.custom.contractMint') : $t('importToken.custom.contract') }}</label>
                <div class="relative group">
                    <input
                        v-model="ca"
                        type="text"
                        :placeholder="vm === 'solana' ? 'Mint address...' : '0x...'"
                        class="w-full bg-white dark:bg-[#131315] border rounded-xl py-3.5 pl-4 pr-20 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none transition-colors duration-300 font-mono shadow-sm dark:shadow-none"
                        :class="[inputBorderClass, !isError ? 'border-slate-200 dark:border-white/10 group-focus-within:border-indigo-400 dark:group-focus-within:border-indigo-500/50' : '']"
                        @input="checkAddress"
                    >
                    
                    <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <svg v-if="checkingToken" class="w-4 h-4 text-indigo-500 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        
                        <!-- <button 
                            v-if="!ca && !checkingToken" 
                            @click="handlePaste"
                            class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-[10px] font-bold text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-white transition-colors duration-300 cursor-pointer"
                        >
                            {{ $t('importToken.custom.paste') }}
                        </button> -->

                        <button 
                            v-if="ca && !checkingToken" 
                            @click="ca = ''; resetTokenData()"
                            class="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:text-zinc-500 dark:hover:text-white dark:hover:bg-white/10 transition-colors duration-300 cursor-pointer"
                        >
                            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                </div>
                
                <div class="h-4 ml-1">
                    <p v-if="errorMessage" class="text-xs text-rose-500 dark:text-rose-400 flex items-center gap-1 animate-fade-in transition-colors duration-300">
                        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        {{ errorMessage }}
                    </p>
                </div>
            </div>

            <transition name="fade-slide">
                <div v-if="isValid && name" class="bg-white dark:bg-[#131315] border border-indigo-200 dark:border-indigo-500/30 rounded-2xl p-4 flex flex-col gap-4 shadow-lg shadow-indigo-500/10 dark:shadow-indigo-500/5 relative overflow-hidden transition-colors duration-300">
                    <div class="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 dark:bg-indigo-500/10 blur-3xl rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none transition-colors duration-300"></div>

                    <div class="flex items-center gap-4 relative z-10">
                        <div class="w-16 h-16 rounded-2xl bg-slate-50 dark:bg-zinc-800 border border-slate-200 dark:border-white/10 flex items-center justify-center p-2 shrink-0 transition-colors duration-300">
                            <img 
                                v-if="image?.large" 
                                :src="image.large" 
                                :alt="name" 
                                class="w-full h-full object-contain rounded-lg"
                            >
                            <span v-else class="text-2xl font-bold text-slate-400 dark:text-zinc-500">{{ symbol?.charAt(0) }}</span>
                        </div>

                        <div class="flex flex-col">
                            <h3 class="text-lg font-bold text-slate-900 dark:text-white transition-colors duration-300">{{ name }}</h3>
                            <div class="flex items-center gap-2 mt-0.5">
                                <span class="text-sm font-bold text-slate-600 dark:text-zinc-400 bg-slate-100 dark:bg-zinc-800/50 px-2 py-0.5 rounded transition-colors duration-300">{{ symbol }}</span>
                                <span class="text-xs text-slate-500 dark:text-zinc-600 transition-colors duration-300">{{ $t('importToken.custom.decimals') }}: {{ decimals }}</span>
                            </div>
                        </div>
                    </div>

                    <!-- Solana'da METADATA BULUNAMAYAN ama mint hesabi GERCEKTEN VAR OLAN bir
                         token da ice aktarilabilir (bkz. utils/solana/importToken.js) -- ama
                         "Dogrulandi" rozeti burada bir YALAN olurdu: hicbir listede yok, ismi/
                         sembolu kisaltilmis mint'in kendisi. `known` bu iki durumu ayirir. -->
                    <div v-if="known" class="relative z-10 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-500 font-medium bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-500/10 transition-colors duration-300">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        {{ $t('importToken.custom.verified') }}
                    </div>
                    <div v-else class="relative z-10 flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-500 font-medium bg-amber-50 dark:bg-amber-500/10 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-500/10 transition-colors duration-300">
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        {{ $t('importToken.custom.unknownToken') }}
                    </div>
                </div>
            </transition>

            <div v-if="checkingToken" class="animate-pulse bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 shadow-sm dark:shadow-none rounded-2xl p-4 flex items-center gap-4 transition-colors duration-300">
                <div class="w-16 h-16 bg-slate-200 dark:bg-zinc-800 rounded-2xl transition-colors duration-300"></div>
                <div class="flex flex-col gap-2 w-full">
                    <div class="h-4 bg-slate-200 dark:bg-zinc-800 rounded w-1/3 transition-colors duration-300"></div>
                    <div class="h-3 bg-slate-200 dark:bg-zinc-800 rounded w-1/4 transition-colors duration-300"></div>
                </div>
            </div>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-[#09090b] relative z-20 transition-colors duration-300">
            <button 
                @click="import_token"
                class="w-full py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-sm dark:shadow-lg cursor-pointer"
                :class="isValid && !loading
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 dark:hover:bg-indigo-500 hover:scale-[1.01] shadow-indigo-500/20' 
                    : 'bg-slate-200 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed border border-transparent dark:border-white/5'"
                :disabled="!isValid || loading"
            >
                <svg v-if="loading" class="w-4 h-4 animate-spin text-white/70" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span v-else>{{ $t('importToken.custom.confirm') }}</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { ref, watch, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import Back from './Back.vue'
import { Contract, JsonRpcProvider } from 'ethers'
import { networkStore } from '../store/network'
import { pageStore } from '../store/pageStore'
import axios from 'axios'
import { configStore } from '../store/config'
import { chainVm } from '../utils/vm'
import { isValidImportInputFormat, resolveMintForImport } from '../utils/solana/importToken'
import { normalizeBucketChainId } from '../utils/homeTokenBucket'
import { SOLANA_CHAIN_ID } from '../utils/solana/constants'

const props = defineProps(['chain'])

const { t } = useI18n()
const network = networkStore()
const page = pageStore()
const config = configStore()

// EVM'de girdi bir SOZLESME adresidir; Solana'da bir MINT adresidir. Asagidaki
// tum dallanma (yer tutucu, dogrulama, kayit anahtari) bu tek degere bakar.
const vm = computed(() => chainVm(network.currentNetwork))

const ca = ref('')
const isValid = ref(false)
const loading = ref(false)
const checkingToken = ref(false)
const errorMessage = ref('')

const name = ref(null)
const symbol = ref(null)
const decimals = ref(null)
const image = ref(null)
const chain = ref(null)
const id = ref(null)
// Solana'da metadata BULUNAMAYAN ama mint hesabi GERCEKTEN VAR OLAN bir token
// da eklenebilir (bkz. utils/solana/importToken.js): `known` bu iki durumu
// ayirir ki sablon sahte bir "Dogrulandi" rozeti GOSTERMESIN. EVM'de HER ZAMAN
// true kalir (zincirden okunan bir sozlesme zaten "dogrulanmis" sayilir --
// eski davranis).
const known = ref(true)
// Solana yolunda kaydedilecek KANONIK (harf kasasi korunmus, bosluk atilmis)
// mint -- import_token() bunu kullanir, `ca.value`'yu DEGIL: kullanicinin
// yapistirdigi ham metin bastaki/sondaki bosluk tasiyabilir.
const resolvedMint = ref(null)

const ERC20_ABI = [
    'function name() view returns (string)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
]

// Computed Styles
const inputBorderClass = computed(() => {
    if (errorMessage.value) return 'border-rose-500/50 focus:border-rose-500'
    if (checkingToken.value) return 'border-indigo-500/50'
    if (isValid.value) return 'border-emerald-500/50 focus:border-emerald-500'
    return 'border-zinc-800 focus:border-indigo-500'
})

const resetTokenData = () => {
    name.value = null
    symbol.value = null
    decimals.value = null
    image.value = null
    id.value = null
    known.value = true
    resolvedMint.value = null
    isValid.value = false
    errorMessage.value = ''
}

const handlePaste = async () => {
    try {
        const text = await navigator.clipboard.readText()
        if (text) {
            ca.value = text
            checkAddress() // Trigger watch logic manually or rely on v-model
        }
    } catch (err) {
        console.error('Paste failed', err)
    }
}

const findToken = async(tName, tSymbol) => {
    try {
        const { data } = await axios.post(config.api + '/getTokenByName', {
            name: tName, 
            symbol: tSymbol
        })
        if(!data) return null
        return data.token
    } catch (error) {
        console.warn('Backend token fetch failed, using default data.', error.message)
        return null
    }
}

const validateTokenContract = async (contractAddress) => {
    try {
        const provider = new JsonRpcProvider(network.rpc)
        
        const code = await provider.getCode(contractAddress)
        if (code === '0x') throw new Error(t('importToken.custom.errorNotContract'))

        const contract = new Contract(contractAddress, ERC20_ABI, provider)
        
        const tokenData = await Promise.allSettled([
            contract.name(),
            contract.symbol(),
            contract.decimals()
        ])

        if (tokenData[0].status === 'rejected' || tokenData[1].status === 'rejected') throw new Error(t('importToken.custom.errorNotErc20'))

        const tName = tokenData[0].value
        const tSymbol = tokenData[1].value
        const tDecimals = tokenData[2].status === 'fulfilled' ? Number(tokenData[2].value) : 18

        // 3. Backend'den Logo/Ek Bilgi Çek
        const backendToken = await findToken(tName, tSymbol)

        return {
            name: tName,
            symbol: tSymbol,
            decimals: tDecimals,
            image: backendToken?.image || null,
            chain: backendToken?.chain || null,
            coingecko_id: backendToken?.coingecko_id || null
        }
    } catch (error) {
        console.error('Token validation error:', error)
        throw error
    }
}

let validationTimeout = null

const checkAddress = () => {
    // Watcher yerine manuel tetikleme de kullanılabilir ama v-model watch'u daha reaktiftir.
    // Bu fonksiyon input eventinde çağrılıyor.
}

watch(ca, (new_ca) => {
    if (validationTimeout) clearTimeout(validationTimeout)
    resetTokenData()

    if (!new_ca) return

    // 1. Format kontrolu -- vm'e gore FARKLI bicim (EVM sozlesme adresi / Solana
    // base58 mint). Karar `isValidImportInputFormat`e (utils/solana/importToken.js)
    // BIRAKILIR: iki dal burada AYRI AYRI kodlanirsa (kod incelemesi, F5) biri
    // digerine karisabilir ve SSR harness'i bunu YAKALAYAMAZ (watch() SSR'da hic
    // calismaz) -- karar disariya tasinip DOGRUDAN test edilince bu risk kapanir.
    if (!isValidImportInputFormat(vm.value, new_ca)) {
        errorMessage.value = t('importToken.custom.errorInvalidAddress')
        return
    }

    // 2. Debounce ile agdan dogrulama (RPC / metadata ucu).
    validationTimeout = setTimeout(async () => {
        checkingToken.value = true
        errorMessage.value = '' // Clear error while checking

        if (vm.value === 'solana') {
            try {
                const result = await resolveMintForImport(new_ca)
                if (!result.ok) {
                    errorMessage.value = t('importToken.custom.errorMintNotFound')
                    isValid.value = false
                    return
                }

                name.value = result.token.name
                symbol.value = result.token.symbol
                decimals.value = result.token.decimals
                image.value = result.token.image
                id.value = result.token.coingecko_id
                known.value = result.known
                resolvedMint.value = result.token.address

                isValid.value = true
            } catch (error) {
                errorMessage.value = error.message || t('importToken.custom.errorFetchFailed')
                isValid.value = false
            } finally {
                checkingToken.value = false
            }
            return
        }

        try {
            const tokenInfo = await validateTokenContract(new_ca)

            name.value = tokenInfo.name
            symbol.value = tokenInfo.symbol
            decimals.value = tokenInfo.decimals
            image.value = tokenInfo.image
            chain.value = tokenInfo.chain
            id.value = tokenInfo.coingecko_id

            isValid.value = true
        } catch (error) {
            errorMessage.value = error.message || t('importToken.custom.errorFetchFailed')
            isValid.value = false
        } finally {
            checkingToken.value = false
        }
    }, 600) // 600ms debounce
})

const import_token = async () => {
    if (!isValid.value || loading.value) return

    try {
        loading.value = true

        const { imported_tokens = {}, active_account } = await chrome.storage.local.get(['imported_tokens', 'active_account'])

        if (!imported_tokens[active_account.key]) imported_tokens[active_account.key] = {}

        if (vm.value === 'solana') {
            // Kova anahtari METIN kalir: normalizeBucketChainId Solana'nin
            // 'solana-mainnet' kimligini OLDUGU GIBI dondurur (Number() NaN
            // uretirdi). Home.vue/SelectAssets.vue'nun imported_tokens okuma
            // yolu ZATEN bu anahtari genel bicimde isliyor (bkz. Home.vue
            // loadCurrentTokens) -- ayrica bir okuma teli GEREKMEZ.
            const bucketKey = normalizeBucketChainId(SOLANA_CHAIN_ID)
            if (!imported_tokens[active_account.key][bucketKey]) imported_tokens[active_account.key][bucketKey] = []

            const currentList = imported_tokens[active_account.key][bucketKey]

            // Base58 BUYUK/KUCUK HARF DUYARLIDIR: EVM dalindaki gibi kucultup
            // karsilastirmak IKI FARKLI mint'i ayni sanabilirdi.
            const existingToken = currentList.find(t => t.address === resolvedMint.value)
            if (existingToken) {
                errorMessage.value = t('importToken.custom.errorAlreadyAdded')
                loading.value = false
                return
            }

            const tokenData = {
                name: name.value,
                symbol: symbol.value,
                // Send.vue ondaligi TAHMIN EDEMEZ: resolveMintForImport zaten
                // ondaliksiz bir kaydi REDDETTIGI icin bu HER ZAMAN doludur.
                decimals: decimals.value,
                address: resolvedMint.value,
                image: image.value || { thumb: '', small: '', large: '' },
                coingecko_id: id.value,
            }

            currentList.push(tokenData)
            await chrome.storage.local.set({ imported_tokens })

            page.currentPage = 'home'
            return
        }

        if (!imported_tokens[active_account.key][network.currentNetwork.chainId]) imported_tokens[active_account.key][network.currentNetwork.chainId] = []

        const currentList = imported_tokens[active_account.key][network.currentNetwork.chainId]

        const existingToken = currentList.find(t => t.address?.toLowerCase() === ca.value.toLowerCase())
        if (existingToken) {
            errorMessage.value = t('importToken.custom.errorAlreadyAdded')
            loading.value = false
            return
        }

        const tokenData = {
            name: name.value,
            symbol: symbol.value,
            decimals: decimals.value,
            address: ca.value,
            image: image.value || { thumb: '', small: '', large: '' }, // Default structure
            chain: chain.value,
            coingecko_id: id.value
        }

        currentList.push(tokenData)
        await chrome.storage.local.set({ imported_tokens })

        page.currentPage = 'home'

    } catch (error) {
        console.error('Import error:', error)
        errorMessage.value = t('importToken.custom.errorSaveFailed')
    } finally {
        loading.value = false
    }
}

onUnmounted(() => {
    if (validationTimeout) clearTimeout(validationTimeout)
})
</script>

<style scoped>
/* Animations */
@keyframes fade-in {
    from { opacity: 0; transform: translateY(-2px); }
    to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in {
    animation: fade-in 0.2s ease-out;
}

.fade-slide-enter-active,
.fade-slide-leave-active {
    transition: all 0.3s ease;
}
.fade-slide-enter-from,
.fade-slide-leave-to {
    opacity: 0;
    transform: translateY(10px);
}
</style>