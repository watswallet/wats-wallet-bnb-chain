<template>
    <div
        ref="root"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-token-title"
        tabindex="-1"
        @keydown.esc="close"
        class="fixed inset-0 z-120 flex items-end justify-center outline-none font-sans"
    >
        <div class="pi-backdrop absolute inset-0 bg-slate-900/50 dark:bg-black/70 backdrop-blur-sm" @click="close"></div>
        <div class="pi-panel relative flex flex-col w-full max-w-105 h-[80%] rounded-t-3xl border-t border-x border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d0b14] text-slate-900 dark:text-white">
            <div class="flex items-center justify-between px-5 pt-4 pb-2">
                <h2 id="delivery-token-title" class="text-base font-bold">{{ $t('privacy.transfer.pickTokenTitle') }}</h2>
                <button type="button" @click="close" :aria-label="$t('privacy.transfer.pickTokenClose')" class="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            <!-- Ag kapsam cipleri: yalniz birden cok acik ag varsa. Cip yalniz listeyi o aga cevirir; secim token secilince olur. -->
            <div v-if="chains.length > 1" data-testid="scope-chips" class="flex flex-wrap gap-2 px-5 pb-3">
                <button v-for="c in chains" :key="c.chainId" type="button" :aria-pressed="scopeChainId === c.chainId ? 'true' : 'false'" @click="selectScope(c.chainId)" :class="['flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-full border text-xs font-semibold cursor-pointer transition-colors', scopeChainId === c.chainId ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-black dark:border-white' : 'bg-slate-100 text-slate-700 border-transparent hover:bg-slate-200 dark:bg-[#202022] dark:text-zinc-200 dark:hover:bg-[#2a2a2c]']">
                    <img :src="c.logo" alt="" decoding="async" referrerpolicy="no-referrer" @error="onLogoError" class="w-4 h-4 rounded-full shrink-0" />
                    <span class="whitespace-nowrap">{{ c.name }}</span>
                </button>
            </div>
            <div class="px-5 pb-3">
                <input v-model="search" type="text" spellcheck="false" :aria-label="$t('privacy.transfer.pickTokenSearch')" :placeholder="$t('privacy.transfer.pickTokenSearch')" class="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-sm" />
            </div>
            <ul class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pb-4">
                <li v-for="t in tokens" :key="deliveryTokenKey(t)">
                    <button type="button" @click="choose(t)" :aria-current="isSelected(t) ? 'true' : undefined" class="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer text-left">
                        <span class="relative shrink-0">
                            <img :src="logoOf(t)" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="onLogoError" class="w-8 h-8 rounded-full" />
                            <img v-if="scopeBadge" :src="scopeBadge" alt="" decoding="async" referrerpolicy="no-referrer" class="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-white dark:bg-zinc-900 p-px border border-slate-200 dark:border-white/10" />
                        </span>
                        <span class="flex-1 min-w-0">
                            <span class="block text-sm font-bold truncate">{{ t.symbol }}</span>
                            <span class="block text-[11px] text-slate-600 dark:text-zinc-300 truncate">{{ t.name }}</span>
                            <span v-if="showAddress(t)" class="block text-[11px] font-mono text-slate-500 dark:text-zinc-400 truncate">{{ shortenAddress(t.address) }}</span>
                        </span>
                        <svg v-if="isSelected(t)" data-selected="true" class="w-4 h-4 shrink-0 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                    </button>
                </li>
                <li v-if="loading" class="px-2 py-3 text-xs text-slate-500 dark:text-zinc-500">{{ $t('privacy.transfer.pickTokenLoading') }}</li>
                <template v-else>
                    <!-- Liste cekilemediyse "bulunamadi" degil hata + tekrar dene (SearchTokens deseni); eldeki liste secilebilir kalir. -->
                    <li v-if="loadFailed" class="flex items-center justify-between gap-3 px-2 py-3 text-xs text-slate-500 dark:text-zinc-500">
                        <span>{{ $t('searchTokens.loadError') }}</span>
                        <button type="button" @click="retry" class="shrink-0 font-semibold text-violet-600 hover:text-violet-500 dark:text-violet-400 underline cursor-pointer">{{ $t('searchTokens.retry') }}</button>
                    </li>
                    <li v-else-if="!tokens.length" class="px-2 py-3 text-xs text-slate-500 dark:text-zinc-500">{{ $t('privacy.transfer.pickTokenEmpty') }}</li>
                </template>
            </ul>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import axios from 'axios'
import { configStore } from '../../store/config'
import { shortenAddress } from '../../utils/shortenAddress'
import { buildDeliveryTokenList, deliveryTokenKey, isNativeDeliveryToken, isUsdcDeliveryToken } from '../../utils/privacy/deliveryTokens'
import { deliveryChainOf } from '../../utils/privacy/deliveryChains'
import { privateFundDeliverable } from '../../utils/privacy/silentswapConfig'
import { ALL_CHAINS } from '../../data/chains'
import { privateTokenLogo, privateChainBadge, hasPrivateLogo } from '../../utils/privacy/privateTokenLogo'

// Gizli aktarimda alicinin alacagi tokenin secicisi (spec 2026-10-10 teslim tokenleri, K1/K2; gizli-mod cok-ag spec 4.8). Liste
// SECILEN teslim agina aittir (`chainId`): o agin yerel coini (yerel teslim acikken), USDC'si, aktif hesabin o agda ice
// aktardigi tokenler (`imported_tokens[hesap][chainId]`) ve sunucunun o ag listesi. Liste istegi hesap adresi TASIMAZ
// (gizlilik notu). Secim { chainId, address, symbol, decimals } olarak yayilir. Panel her acilista yeni ornektir (ust bilesen
// v-if ile acar), bu yuzden `chainId` acik kaldigi surece degismez.
// AG KAPSAMI (sade ekran plani T10): `chains` (>1) verilirse listenin ustunde ag cipleri cikar; `chainId` BASLANGIC kapsamidir
// ve cip yalniz listeyi o aga cevirir (`scopeChainId`). Liste, istek ve secim olayi kapsam agin kimligini tasir; 10 agin listesi
// tek istekte birlestirilmez, varsayilan sayfa ag basina onbelleklenir.
const props = defineProps({
    // ZORUNLU: sessiz bir BSC varsayilani yoktur (K4); ust bilesen secili tokenin agini verir.
    chainId: { type: Number, required: true },
    // [{ chainId, name, logo }]: ust bilesenin acik teslim aglari (deliveryChains); bos ya da tek ag = cip satiri yok.
    chains: { type: Array, default: () => [] },
    nativeEnabled: { type: Boolean, default: false },
    selected: { type: Object, default: null },
    // 'fund' (Para yukle), 'swap' (Takas) ve 'bridge' (Kopru): teslim Gizli Hesap'a yapilir; Gizli Hesap'a teslim edilen varlik yalniz Gonder ile cikabilir (1.10 teslim degismezi;
    // ag ucreti ATS ile odendiginden yerel coin gaz istisnasi YOK), bu yuzden liste o agdaki Gonder kaynagi varliklariyla sinirlanir. 'send' (varsayilan; alici dis adres): suzme yok.
    mode: { type: String, default: 'send' },
})
const emit = defineEmits(['select', 'close'])
const config = configStore()
// Sunucu istegi zinciri slug ile de chainId ile de cozer; slug supported_chains.json'dan gelir (tabloda olmayan ag icin yok).
const chainSlug = (id) => ALL_CHAINS.find((c) => Number(c.chainId) === id)?.chainSlug
const SEARCH_DEBOUNCE_MS = 300
// Sunucu aramasi en az bu kadar (kirpilmis) karakterle gider: tek harf hem anlamsiz hem de her tusta istek demek.
// Yerel suzme her uzunlukta calisir. Aranan metin hesap verisi degildir ama IP + zaman ile sunucuya gider.
const MIN_SERVER_SEARCH = 2

const root = ref(null)
const search = ref('')
// Listenin gosterildigi ag; baslangicta prop'tur, yalniz selectScope degistirir.
const scopeChainId = ref(props.chainId)
const imported = ref([])
const remote = ref([])
const loading = ref(true)
// Son istek basarisiz oldu: eldeki liste korunur, kullaniciya kisa mesaj + tekrar dene gosterilir.
const loadFailed = ref(false)
// Bos sorgunun (varsayilan sayfa) son basarili sonucu, AG BASINA: arama temizlenince ve ag cipine donuldugunde aninda geri gelir.
const defaultPages = new Map()
// selectScope aramayi kendisi temizler; arama izleyicisi bu temizlemeyi bir kez yok sayar (cift istek olmasin).
let skipSearchWatch = false
let searchTimer = null
// Son istek kazanir: yavas bir eski arama yeni sonucun ustune yazilmaz.
let requestSeq = 0

// Tabloda olmayan ag icin liste bos (buildDeliveryTokenList firlatir): panel yine kapatilabilir.
const tokens = computed(() => {
    if (!deliveryChainOf(scopeChainId.value)) return []
    const list = buildDeliveryTokenList({ chainId: scopeChainId.value, nativeEnabled: props.nativeEnabled, imported: imported.value, remote: remote.value, search: search.value })
    // Gizli modda LOGOSUZ SATIR GOSTERILMEZ (sahip karari 2026-11-03): ice aktarilan ve sunucu satirlari dahil her kipte ayni test (hasPrivateLogo).
    const withLogo = list.filter((t) => hasPrivateLogo({ chainId: scopeChainId.value, address: t.address, symbol: t.symbol }))
    return props.mode !== 'send' ? withLogo.filter((t) => privateFundDeliverable(t)) : withLogo
})
// Taklit tokenleri ayirt etmek icin yerel coin ve agin USDC'si disindaki satirlarda kisa sozlesme adresi gosterilir.
// Her satirda kapsam aginin yerel rozeti; logosu yoksa cizilmez. Token logosu TEK cozucudan (privateTokenLogo): paketli dosya, uzak adres yok;
// sunucu satirinin `image`i kullanilmaz (gizli modda zaten elenirdi), adresi kayit defterinde dogrulanan token ayni tokenin paketli logosunu alir.
const scopeBadge = computed(() => privateChainBadge(scopeChainId.value))
const logoOf = (t) => privateTokenLogo({ chainId: scopeChainId.value, address: t.address, symbol: t.symbol })
const showAddress = (t) => !isNativeDeliveryToken(t) && !isUsdcDeliveryToken(t)
// Kimlik (chainId, adres): ayni adres baska agda baska bir tokendir.
const isSelected = (t) => Number(props.selected?.chainId) === t.chainId
    && typeof props.selected?.address === 'string' && props.selected.address.toLowerCase() === t.address.toLowerCase()

async function loadImported() {
    const cid = scopeChainId.value
    try {
        const { imported_tokens = {}, active_account } = await chrome.storage.local.get(['imported_tokens', 'active_account'])
        // Yavas okuma kapsam degistikten sonra bitebilir: eski agin kovasi yeni listeye yazilmaz.
        if (cid !== scopeChainId.value) return
        const list = imported_tokens?.[active_account?.key]?.[String(cid)]
        imported.value = Array.isArray(list) ? list : []
    } catch {
        if (cid === scopeChainId.value) imported.value = []
    }
}

async function loadRemote(query = '') {
    const q = String(query ?? '').trim()
    const seq = ++requestSeq
    const cid = scopeChainId.value
    const defaultPage = defaultPages.get(cid) ?? null
    // Tabloda olmayan ag icin sunucuya sorulmaz (liste zaten bos); panel yine kapatilabilir.
    if (!deliveryChainOf(cid)) {
        loading.value = false
        return
    }
    // Kisa sorguda sunucuya sorulmaz: varsayilan sayfa onbellekteyse aninda geri gelir, bekleyen eski arama
    // (seq artti) sonucu ustune yazamaz. Bos sorgu onbellekten gelirken sessizce tazelenir ("Yukleniyor" yanip sonmez).
    if (q.length < MIN_SERVER_SEARCH && defaultPage) remote.value = defaultPage
    if (q.length > 0 && q.length < MIN_SERVER_SEARCH) {
        loading.value = false
        return
    }
    loading.value = !(q === '' && defaultPage)
    try {
        const { data } = await axios.post(config.api + '/getChainTokens', {
            chain: chainSlug(cid), chainId: cid, skip: 0, limit: 100, ...(q ? { search: q } : {}),
        })
        if (seq !== requestSeq) return
        const list = Array.isArray(data?.tokens) ? data.tokens : []
        remote.value = list
        if (!q) defaultPages.set(cid, list)
        loadFailed.value = false
    } catch {
        // Liste yuklenemezse son iyi liste korunur; BNB/USDC ve ice aktarilanlar yine secilebilir.
        if (seq === requestSeq) loadFailed.value = true
    } finally {
        if (seq === requestSeq) loading.value = false
    }
}

// Tekrar dene: gecerli aramayla; tek karakterde sunucu aramasi olmadigindan varsayilan sayfayi ister.
function retry() {
    const q = search.value.trim()
    return loadRemote(q.length < MIN_SERVER_SEARCH ? '' : q)
}

// Yazilirken: 2+ karakterde sonuc gelene kadar "yukleniyor" (bos "Token bulunamadi" yanip sonmesin); kisa sorguda
// bekleyen arama iptal edilir ve onbellekteki varsayilan sayfa hemen gosterilir.
function onSearchChanged(q) {
    if (skipSearchWatch) {
        skipSearchWatch = false
        return
    }
    clearTimeout(searchTimer)
    const trimmed = String(q ?? '').trim()
    if (trimmed.length >= MIN_SERVER_SEARCH) {
        loading.value = true
    } else {
        requestSeq++
        const defaultPage = defaultPages.get(scopeChainId.value)
        if (defaultPage) remote.value = defaultPage
        loading.value = false
    }
    searchTimer = setTimeout(() => loadRemote(q), SEARCH_DEBOUNCE_MS)
}
watch(search, onSearchChanged)

// Ag cipi: listeyi o aga cevirir. Arama temizlenir, bekleyen istek/arama gecersiz sayilir (requestSeq), liste o agin
// onbellekteki varsayilan sayfasindan gelir (yoksa istek atilir) ve ice aktarilanlar o agin kovasindan okunur.
async function selectScope(id) {
    const next = Number(id)
    if (next === scopeChainId.value) return
    clearTimeout(searchTimer)
    if (search.value !== '') {
        skipSearchWatch = true
        search.value = ''
    }
    requestSeq++
    scopeChainId.value = next
    imported.value = []
    loadFailed.value = false
    const cached = defaultPages.get(next)
    remote.value = cached ?? []
    if (cached) {
        loading.value = false
        await loadImported()
        return
    }
    loading.value = true
    await Promise.all([loadImported(), loadRemote()])
}

// Logo yuklenemezse varsayilan simge (AtsFeeCard ile ayni desen: onerror once temizlenir, dongu olmasin).
function onLogoError(e) {
    e.target.onerror = null
    e.target.src = '/default-token.png'
}

onMounted(async () => {
    root.value?.focus?.()
    await Promise.all([loadImported(), loadRemote()])
})

onUnmounted(() => clearTimeout(searchTimer))

function choose(t) {
    // chainId seciciNIN kapsam durumundan gelir, satirin kendi damgasindan degil (PF-C3, spec 4.1 damgalama 3): secim her zaman
    // listelenen agin kimligini tasir.
    emit('select', { chainId: scopeChainId.value, address: t.address, symbol: t.symbol, decimals: t.decimals })
}

function close() {
    emit('close')
}
</script>
