<template>
    <div v-if="entry" data-stock-detail class="w-full h-full max-w-[420px] mx-auto bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white flex flex-col relative overflow-hidden transition-colors duration-300">
        <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar px-4 pt-4 pb-3">

            <!-- 1. Baslik: sirket adi buyuk, ticker kucuk. Ihracci rozeti YOK (K1). -->
            <div class="flex items-start justify-between gap-3 mb-4">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-10 h-10 shrink-0 rounded-full bg-white dark:bg-zinc-800 border border-slate-200 dark:border-white/10 overflow-hidden flex items-center justify-center shadow-sm dark:shadow-none">
                        <img v-if="logoUrl" data-stock-logo :src="logoUrl" :alt="header.name" class="w-full h-full object-cover" @error="logoFailed = true">
                        <span v-else class="text-sm font-extrabold text-slate-500 dark:text-zinc-400">{{ header.ticker.slice(0, 1) }}</span>
                    </div>
                    <div class="min-w-0">
                        <h2 class="text-[19px] font-extrabold leading-tight truncate">{{ header.name }}</h2>
                        <span class="text-[11px] font-extrabold text-slate-500 dark:text-zinc-400 uppercase tracking-[0.08em]">{{ header.ticker }}</span>
                    </div>
                </div>
                <button
                    type="button"
                    @click="page.currentPage = 'home'"
                    class="w-8 h-8 shrink-0 flex items-center justify-center rounded-full bg-slate-200 dark:bg-white/5 hover:bg-slate-300 dark:hover:bg-white/10 text-slate-500 dark:text-zinc-400 transition-colors cursor-pointer"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>

            <!-- 2. Fiyat + 24s degisim. Fiyat bilinmiyorsa tire; $0.00 asla. -->
            <div class="flex items-end gap-2.5">
                <h1 data-stock-price class="text-[32px] leading-none font-extrabold font-mono tracking-tight">{{ priceText }}</h1>
                <div
                    v-if="price.change24h !== null"
                    data-stock-change
                    class="flex items-center gap-1 px-2 py-1 rounded-[10px] text-[11px] font-extrabold"
                    :class="price.change24h >= 0 ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400'"
                >
                    <svg v-if="price.change24h >= 0" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path d="M5 15l7-7 7 7"/></svg>
                    <svg v-else class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path d="M19 9l-7 7-7-7"/></svg>
                    <span>{{ Math.abs(price.change24h).toFixed(2) }}%</span>
                </div>
            </div>
            <p v-if="marketText" data-stock-market class="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-zinc-400">
                <i class="inline-block w-[7px] h-[7px] rounded-full" :class="market.state === 'open' ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-zinc-500'"></i>{{ marketText }}
            </p>
            <p v-if="price.priceSource" data-stock-source class="mt-1.5 text-[10px] font-semibold text-slate-400 dark:text-zinc-500">{{ $t('stockDetail.priceSource', { source: sourceLabel(price.priceSource) }) }}</p>

            <!-- 3. Grafik. Yukleniyor ve yok IKI AYRI durum (Token.vue ilkesi). -->
            <div class="mt-3.5 mb-2 -mx-1 min-h-[118px]">
                <CryptoChart v-if="chartState === 'chart'" :id="entry.coingeckoId" :days="days" :divisor="price.chartDivisor" />
                <div v-else-if="chartState === 'loading'" class="w-full h-[118px] flex items-center justify-center text-slate-400 dark:text-zinc-600 text-xs animate-pulse">{{ $t('stockDetail.chartLoading') }}</div>
                <div v-else class="w-full h-[118px] flex items-center justify-center text-slate-400 dark:text-zinc-600 text-xs">{{ $t('stockDetail.chartEmpty') }}</div>
            </div>

            <!-- 4. Aralik secici (TK8) -->
            <div class="flex gap-1.5 mb-4">
                <button
                    v-for="r in RANGES"
                    :key="r.key"
                    type="button"
                    :data-range="r.days"
                    @click="setRange(r.key)"
                    class="flex-1 py-1.5 rounded-[10px] text-[11px] font-extrabold transition-colors cursor-pointer"
                    :class="range === r.key ? 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-zinc-400'"
                >{{ $t(RANGE_LABEL_KEYS[r.days]) }}</button>
            </div>

            <!-- 5. Pozisyon karti (TK7): ihracci kirilimi yok -->
            <div data-stock-position class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-2xl p-3.5 shadow-sm dark:shadow-none mb-3">
                <div class="text-[10px] font-extrabold uppercase tracking-[0.06em] text-slate-400 dark:text-zinc-500">{{ $t('stockDetail.positionTitle') }}</div>
                <div class="flex items-end justify-between gap-3 mt-1.5">
                    <div class="min-w-0">
                        <div v-if="position.held" class="text-xl font-extrabold font-mono truncate">{{ $t('stockDetail.positionAmount', { amount: position.units.toFixed(4) }) }}</div>
                        <div v-else-if="position.unknown || balancesLoading" class="text-xl font-extrabold font-mono text-slate-400 dark:text-zinc-500">{{ UNKNOWN_TEXT }}</div>
                        <div v-else class="text-sm font-bold text-slate-500 dark:text-zinc-400">{{ $t('stockDetail.noPosition') }}</div>
                    </div>
                    <div v-if="position.held" data-stock-position-usd class="text-xl font-extrabold font-mono text-indigo-600 dark:text-indigo-400 shrink-0">{{ position.usd === null ? UNKNOWN_TEXT : '$' + formatUsd(position.usd) }}</div>
                </div>
                <div class="flex gap-2 mt-3">
                    <button type="button" data-stock-send @click="selectSend" class="flex-1 py-2 rounded-[10px] bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-xs font-extrabold transition-colors cursor-pointer">{{ $t('stockDetail.send') }}</button>
                    <button type="button" data-stock-deposit @click="selectDeposit" class="flex-1 py-2 rounded-[10px] bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-xs font-extrabold transition-colors cursor-pointer">{{ $t('stockDetail.deposit') }}</button>
                </div>
            </div>

            <!-- 6. Hisse bilgileri: ihracci adi YALNIZ burada (TK7/K1). Tutulan her ihracci icin bir blok. -->
            <div data-stock-info class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-2xl p-3.5 shadow-sm dark:shadow-none">
                <div class="text-[10px] font-extrabold uppercase tracking-[0.06em] text-slate-400 dark:text-zinc-500 mb-1">{{ $t('stockDetail.infoTitle') }}</div>
                <div v-for="(block, i) in infoShown" :key="block.chainId + block.address" :class="i > 0 ? 'mt-2 pt-2 border-t border-slate-200 dark:border-white/10' : ''">
                    <div v-if="block.issuerKey" class="flex justify-between items-center gap-3 py-2 text-xs border-b border-slate-100 dark:border-white/5">
                        <b class="font-bold text-slate-500 dark:text-zinc-400">{{ $t('stockDetail.infoIssuer') }}</b>
                        <span class="font-extrabold text-right min-w-0 break-words">{{ $t(block.issuerKey) }}</span>
                    </div>
                    <p v-if="block.issuerKey" data-stock-issuer-note class="py-1.5 text-[11px] text-slate-500 dark:text-zinc-400 border-b border-slate-100 dark:border-white/5">{{ $t(block.issuerKey + 'Note') }}</p>
                    <div v-if="block.isin" class="flex justify-between items-center gap-3 py-2 text-xs border-b border-slate-100 dark:border-white/5">
                        <b class="font-bold text-slate-500 dark:text-zinc-400">{{ $t('stockDetail.infoIsin') }}</b>
                        <span class="font-extrabold font-mono text-right">{{ block.isin }}</span>
                    </div>
                    <div class="flex justify-between items-center gap-3 py-2 text-xs border-b border-slate-100 dark:border-white/5">
                        <b class="font-bold text-slate-500 dark:text-zinc-400">{{ $t('stockDetail.infoNetwork') }}</b>
                        <span class="font-extrabold text-right">{{ chainName(block.chainId) }}</span>
                    </div>
                    <div class="flex justify-between items-center gap-3 py-2 text-xs border-b border-slate-100 dark:border-white/5">
                        <b class="font-bold text-slate-500 dark:text-zinc-400">{{ $t('stockDetail.infoContract') }}</b>
                        <span class="flex items-center gap-1.5 min-w-0">
                            <span class="font-extrabold font-mono">{{ shortenAddress(block.address) }}</span>
                            <button type="button" data-stock-copy :aria-label="$t('stockDetail.copy')" @click="copyAddress(block.address)" class="shrink-0 text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400 cursor-pointer">{{ copiedAddress === block.address ? $t('stockDetail.copied') : $t('stockDetail.copy') }}</button>
                        </span>
                    </div>
                    <div class="flex justify-between items-center gap-3 py-2 text-xs">
                        <b class="font-bold text-slate-500 dark:text-zinc-400">{{ $t('stockDetail.infoDecimals') }}</b>
                        <span class="font-extrabold font-mono text-right">{{ block.decimals }}</span>
                    </div>
                </div>
                <!-- 7. Isimsiz sertifika uyarisi (TK14) -->
                <p data-stock-cert class="mt-2.5 text-[10px] leading-relaxed text-slate-400 dark:text-zinc-500">{{ $t('stockDetail.certNote') }}</p>
            </div>
        </div>

        <!-- 8. Sabit alt cubuk: yesil Al, kirmizi Sat (T8: selectTrade). Kopru/Takas YOK (K2). -->
        <div class="shrink-0 flex gap-2.5 px-4 pt-3 pb-3.5 border-t border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#09090b]">
            <button type="button" data-stock-buy @click="selectTrade('buy')" class="flex-1 py-3.5 rounded-[14px] bg-emerald-500 hover:bg-emerald-600 text-white text-[15px] font-extrabold transition-colors cursor-pointer">{{ $t('stockDetail.buy') }}</button>
            <button
                type="button"
                data-stock-sell
                :disabled="!sellEnabled"
                @click="selectTrade('sell')"
                class="flex-1 py-3.5 rounded-[14px] bg-rose-500 hover:bg-rose-600 text-white text-[15px] font-extrabold transition-colors"
                :class="sellEnabled ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'"
            >{{ $t('stockDetail.sell') }}</button>
        </div>

        <!-- Yatir (TK11): Receive popup'i yalniz Home.vue cizdiginden bu sayfada da cizilir. -->
        <Receive v-if="popups.receive"></Receive>
    </div>
</template>

<script setup>
import { computed, onMounted, ref, shallowRef } from 'vue'
import axios from 'axios'
import { cryptoStore } from '../../store/crypto'
import { popupStore } from '../../store/popup'
import { networkStore } from '../../store/network'
import { pageStore } from '../../store/pageStore'
import { configStore } from '../../store/config'
import CryptoChart from '../CryptoChart.vue'
import Receive from '../popups/Receive.vue'
import { useStockDetail } from '../../composables/useStockDetail'
import { stockEntryForRef } from '../../utils/stocks/stockRoute'
import { sendAssetFor } from '../../utils/stocks/stockActions'
import { applyNetworkChange } from '../../utils/applyNetworkChange'
import { isResolvableChainId } from '../../utils/chainIdentity'
import { RANGES, DEFAULT_RANGE, rangeDays, headerModel, sameChainOptions, infoBlocks, canSell } from '../../utils/stocks/stockDetailModel'
import { UNKNOWN_TEXT } from '../../utils/stocksTab'
import { tokenLogo } from '../../utils/tokenLogo'
import { chainName } from '../../utils/chainLogo'
import { ALL_CHAINS } from '../../data/chains'
import { isSameChainId, rpcUrlsOf } from '../../utils/vm'
import { shortenAddress } from '../../utils/shortenAddress'
import { copy } from '../../utils/copy'
import { useI18n } from 'vue-i18n'

// Aralik dugme etiketleri: i18n anahtari birlestirilmez (locales.test.js statik tarayicisi 'stockDetail.range' onekini
// anahtar sanir); gun -> tam anahtar tablosu.
// Sunucu kaynak kodunu kucuk harfle yazar ('atlas' | 'coingecko'); ekranda ozel ad olarak gosterilir.
const SOURCE_LABELS = { atlas: 'Atlas', coingecko: 'CoinGecko' }
const sourceLabel = (source) => SOURCE_LABELS[source] ?? source

const RANGE_LABEL_KEYS = { 7: 'stockDetail.range7', 30: 'stockDetail.range30', 90: 'stockDetail.range90', 365: 'stockDetail.range365' }

const { t } = useI18n()
const crypto = cryptoStore()
const page = pageStore()
const config = configStore()
const popups = popupStore()
const network = networkStore()

// Kimlik: Home/Varliklar `selected_token_ref` yazar; katalog tek yetkili (TK1/TK2).
const entry = computed(() => stockEntryForRef(crypto.selected_token_ref))

// Veri katmani hesap adresi bilindikten sonra kurulur (bakiye okumasi sahibe baglidir).
// O ana kadar baslik katalogdan cizilir; diger bolumler "yukleniyor/tire" halindedir.
const detail = shallowRef(null)
const localRange = ref(DEFAULT_RANGE)

const rpcFor = (chainId) => rpcUrlsOf(ALL_CHAINS.find((c) => isSameChainId(c.chainId, chainId)))[0] || null
const fetchRecords = async (ids) => {
    const resp = await axios.post(config.api + '/getTokensDataById', { ids }, { timeout: 10000 })
    return resp?.data?.tokens ?? []
}

onMounted(async () => {
    if (!entry.value) return
    let owner = null
    try {
        const { active_account } = await chrome.storage.local.get('active_account')
        owner = active_account?.address ?? null
    } catch {
        owner = null
    }
    const d = useStockDetail({ entry: entry.value, owner, rpcFor, fetchRecords })
    d.range.value = localRange.value
    detail.value = d
    await d.load()
})

const range = computed(() => (detail.value ? detail.value.range.value : localRange.value))
const days = computed(() => rangeDays(range.value))
function setRange(key) {
    localRange.value = key
    if (detail.value) detail.value.range.value = key
}

const EMPTY_PRICE = { priceUsd: null, change24h: null, priceSource: null, chartDivisor: null }
const EMPTY_POSITION = { held: false, unknown: true, units: 0, usd: null }
const header = computed(() => detail.value?.header.value ?? headerModel(entry.value, sameChainOptions(entry.value)))
const price = computed(() => detail.value?.price.value ?? EMPTY_PRICE)
const position = computed(() => detail.value?.position.value ?? EMPTY_POSITION)
// Veri katmani gelmeden de bilgi karti katalogdan cizilir.
const infoShown = computed(() => detail.value?.info.value ?? infoBlocks({ entry: entry.value, options: [], balances: {} }))
const market = computed(() => detail.value?.market.value ?? null)
const recordsLoading = computed(() => (detail.value ? detail.value.recordsLoading.value : true))
const balancesLoading = computed(() => (detail.value ? detail.value.balancesLoading.value : true))

const sellEnabled = computed(() => canSell(position.value))

// Fiyat yoksa tire, ASLA $0.00. Bicim Token.vue formatPrice ile ayni.
const formatUsd = (val) => (val < 0.01 ? val.toFixed(6) : val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
const priceText = computed(() => (price.value.priceUsd === null ? UNKNOWN_TEXT : '$' + formatUsd(price.value.priceUsd)))

// Piyasa durumu yalniz kaynak yanit verdiginde (TK9).
const marketText = computed(() => {
    const state = market.value?.state
    if (state === 'open') return t('stockDetail.marketOpen')
    if (state === 'closed') return t('stockDetail.marketClosed')
    return ''
})

// Grafik: bilinmeyen xStock carpani yanlis seri cizdirmez (null -> "fiyat gecmisi yok").
const chartState = computed(() => {
    if (!entry.value?.coingeckoId) return recordsLoading.value ? 'loading' : 'empty'
    if (price.value.chartDivisor === null) return balancesLoading.value ? 'loading' : 'empty'
    return 'chart'
})

// Logo: katalog (bStocks) ya da sunucu kaydi (xStocks).
const logoFailed = ref(false)
const logoUrl = computed(() => {
    if (logoFailed.value || !header.value) return null
    const row = header.value.logoRow
    const rec = detail.value?.records.value?.[row.coingeckoId]
    return tokenLogo({ image: row.image ?? rec?.image ?? null }, null)
})

const copiedAddress = ref('')
async function copyAddress(address) {
    try {
        await copy(address)
        copiedAddress.value = address
        setTimeout(() => { if (copiedAddress.value === address) copiedAddress.value = '' }, 1500)
    } catch {
        copiedAddress.value = ''
    }
}

// ---- Eylemler (T8) ----
//
// GONDER / YATIR icin: kaydin zinciri aktif zincirden farkliysa GITMEDEN ONCE ag degisir (Token.vue
// ensureChain ile AYNI olcut: isSameChainId). AL / SAT bunu KULLANMAZ (kullanici karari 2026-10-23):
// hisseye basmak da Al/Sat da cuzdanin aktif agini degistirmez, islem hissenin zincirinde yapilir.
//  `applyNetworkChange` swap/bridge secimlerini sifirladigi icin ag degisimi ONCE,
// yazimlar SONRA. `false` = zincir bilinmiyor ya da RPC'ye ulasilamadi: akis SURDURULMEZ (uyari
// kullaniciya zaten gosterildi) ve hicbir store alani yazilmaz.
const ensureChain = async (asset) => {
    const target = asset?.chainId
    if (!isResolvableChainId(target) || isSameChainId(target, network.currentNetwork?.chainId)) return true

    const chain = ALL_CHAINS.find((c) => isSameChainId(c.chainId, target))
    if (!chain) return false

    return await applyNetworkChange(chain, t)
}

// Ust uste dokunus korumasi: ag gecisi saniyeler surebilir; ikinci dokunus ikinci gecis baslatmasin.
const acting = ref(false)

// Al / Sat: ag + yon -> Al/Sat ekrani. Yon pageStore.tradeSide ile tasinir (StockTrade okur ve temizler).
// Sat pozisyon yokken calismaz (dugme zaten soluk; burasi ikinci kapi).
const selectTrade = async (side) => {
    if (side !== 'buy' && side !== 'sell') return
    if (side === 'sell' && !sellEnabled.value) return
    if (!entry.value) return
    if (acting.value) return
    acting.value = true
    try {
        page.tradeSide = side
        popups.token_data = false
        page.currentPage = 'stock_trade'
    } finally {
        acting.value = false
    }
}

// Gonder: kayit Token.vue selectSend ile AYNI kimligi tasir (satir kimligi + market, bkz. sendAssetFor).
const selectSend = async () => {
    if (!entry.value) return
    if (acting.value) return
    acting.value = true
    try {
        if (!await ensureChain(entry.value)) return
        crypto.sendAsset = sendAssetFor({
            entry: entry.value,
            ref: crypto.selected_token_ref,
            record: detail.value?.records.value?.[entry.value.coingeckoId] ?? null,
            priceUsd: price.value.priceUsd,
        })
        popups.token_data = false
        page.currentPage = 'send'
    } finally {
        acting.value = false
    }
}

// Yatir: adres gosteren Receive popup'i (MoonPay DEGIL, TK11).
// NIHAI INCELEME B1: Receive adresi AKTIF AGDAN turetir (Solana/TON aktifken yalniz o agin adresi
// gelir) ve bayrak kapaliyken Home.openStock bStock icin ag degistirmez. Bu yuzden Al/Sat/Gonder gibi
// ONCE ensureChain: BSC bStock'unu Solana/TON adresine gondermek parayi kaybettirirdi. Zincir
// gecisi basarisizsa popup ACILMAZ.
const selectDeposit = async () => {
    if (!entry.value) return
    if (acting.value) return
    acting.value = true
    try {
        if (!await ensureChain(entry.value)) return
        popups.receive = true
    } finally {
        acting.value = false
    }
}
</script>
