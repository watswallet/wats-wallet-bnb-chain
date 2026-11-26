<template>
    <!-- Ihracci karsilastirma penceresi: bu sirketin seceneklerindeki ihraccilarin (bStocks, xStocks, LCX ihraccilari) sutunlari. Yalniz sunum;
         hicbir secenek one cikarilmaz. -->
    <div data-issuer-info class="fixed inset-0 z-50 flex items-end bg-black/50 backdrop-blur-sm" @click.self="$emit('close')">
        <div
            id="issuer-info-sheet"
            role="dialog"
            aria-modal="true"
            :aria-label="$t(titleKey)"
            class="issuer-sheet-panel w-full max-w-[420px] mx-auto max-h-full overflow-y-auto custom-scrollbar rounded-t-3xl bg-white dark:bg-[#131315] border-t border-slate-200 dark:border-white/10 p-5 flex flex-col gap-4 text-slate-900 dark:text-white"
        >
            <div class="flex flex-col gap-1">
                <h2 class="text-base font-bold">{{ $t(titleKey) }}</h2>
                <p class="text-xs text-slate-500 dark:text-zinc-400">{{ $t(introKey) }}</p>
            </div>
            <div data-issuer-cards class="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2">
                <div
                    v-for="i in issuers"
                    :key="i"
                    :data-issuer-card="i"
                    :data-selected="selected === i ? 'true' : 'false'"
                    class="rounded-2xl p-3 flex flex-col gap-2.5 transition-colors"
                    :class="selected === i ? 'ring-2 ring-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'ring-1 ring-slate-200 dark:ring-white/10'"
                >
                    <div class="flex items-center gap-2">
                        <IssuerLogo :issuer="i" size="w-7 h-7" :data-issuer-badge="i" />
                        <div class="min-w-0">
                            <p class="text-sm font-bold leading-tight">{{ issuerName(i) }}</p>
                            <p class="text-[11px] leading-snug text-slate-500 dark:text-zinc-400 break-words">{{ issuerSub(i) }}</p>
                        </div>
                    </div>
                    <div v-for="k in ROWS" :key="k" :data-issuer-info-row="k" class="flex flex-col gap-0.5">
                        <p class="text-[10px] font-semibold text-slate-500 dark:text-zinc-400">{{ $t('stockIssuer.diff.row.' + k) }}</p>
                        <p class="text-xs leading-snug break-words">{{ cell(i, k) }}</p>
                    </div>
                </div>
            </div>
            <p class="text-[11px] text-slate-500 dark:text-zinc-400">{{ $t(footnoteKey) }}</p>
            <button
                ref="closeBtn"
                data-issuer-info-close
                type="button"
                class="py-3 rounded-2xl text-sm font-bold border border-slate-200 dark:border-white/10 text-slate-700 dark:text-zinc-300 cursor-pointer"
                @click="$emit('close')"
            >{{ $t('stockTrade.status.close') }}</button>
        </div>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IssuerLogo from './IssuerLogo.vue'
import { isLcxIssuer, issuerDisplayName } from '../../utils/stocks/issuerNames'

const props = defineProps({
    // Sutunu cizilecek ihraccilar (sirket seceneklerinin ihracci kimlikleri, siralari korunur). Verilmezse bugunku iki sutun: bStocks + xStocks.
    issuers: { type: Array, default: () => ['bstocks', 'xstocks'] },
    // Bu sirketin xStocks aglari, virgulle ("Ethereum, BNB Smart Chain")
    networks: { type: String, default: '' },
    // LCX ihraccisi -> bu sirketin o ihraccideki aglari, virgulle (katalog satirlarindan; { ondo: 'BNB Smart Chain' })
    lcxNetworks: { type: Object, default: () => ({}) },
    // Su an secili ihracci ('bstocks' | 'xstocks' | LCX ihraccisi | null): mini karti vurgulanir
    selected: { type: String, default: null },
})
// Baslik, giris, dipnot ve dialog aria-label: bStocks ve xStocks'a ozel metinler ("bStocks ve xStocks", "ikisi de", "hicbiri ... ikisi de") yalniz
// saf iki sutunda (bugunku cikti, BAYTI BAYTINA ayni) dogrudur. Sutunlardan biri LCX ihraccisiysa genel metinler (kume 3-4 sutun olabilir, bStocks
// ya da xStocks hic olmayabilir). Dort metin AYNI kosuldan okunur.
const generic = computed(() => props.issuers.some(isLcxIssuer))
const titleKey = computed(() => (generic.value ? 'stockIssuer.diff.titleGeneric' : 'stockIssuer.diff.title'))
const introKey = computed(() => (generic.value ? 'stockIssuer.diff.introGeneric' : 'stockIssuer.diff.intro'))
const footnoteKey = computed(() => (generic.value ? 'stockIssuer.diff.footnoteGeneric' : 'stockIssuer.diff.footnote'))
// Tek ag: liste virgul icermez (birden fazlaysa "A, B"; bos/yedek metin tek ag sayilmaz).
const isSingle = (list) => list.trim() !== '' && !list.includes(',')
const emit = defineEmits(['close'])

const ROWS = ['network', 'how', 'closed']
// LCX sutununun "how" / "closed" hucreleri (tek metin: butun LCX ihraccilari ayni yoldan islem gorur). Satir anahtari ROWS'tan gelir.
const LCX_CELL_KEYS = { how: 'stockIssuer.diff.cell.how.lcx', closed: 'stockIssuer.diff.cell.closed.lcx' }
const NO_NETWORK = '—'
const { t } = useI18n()

const issuerName = (issuer) => issuerDisplayName(issuer, t)
// Kart basligi alt satiri: bStocks / xStocks kendi "kim cikarir" metni, LCX ihraccilari LCX alt metni. Ihracci adi dis kaynaktan gelir:
// anahtar yalniz statik ihraccilar icin kurulur (miras adlar -- 'constructor' -- ceviri anahtarina girmez).
const issuerSub = (issuer) => (isLcxIssuer(issuer) ? t('stockIssuer.sub.lcx') : t('stockIssuer.diff.cell.issuer.' + issuer))

// Ag hucresi: xStocks sutunu bu sirketin xStocks aglari; LCX sutunu katalogdaki o ihraccinin aglari (Object.hasOwn: miras adlar okunmaz).
function networkCell(list) {
    return isSingle(list)
        ? t('stockIssuer.diff.cell.network.xstocksOne', { network: list })
        : t('stockIssuer.diff.cell.network.xstocks', { networks: list })
}
function cell(issuer, k) {
    if (isLcxIssuer(issuer)) {
        if (k !== 'network') return t(LCX_CELL_KEYS[k])
        const list = Object.hasOwn(props.lcxNetworks, issuer) ? String(props.lcxNetworks[issuer] ?? '') : ''
        return list.trim() === '' ? NO_NETWORK : networkCell(list)
    }
    if (issuer === 'xstocks' && k === 'network') return networkCell(props.networks)
    return t('stockIssuer.diff.cell.' + k + '.' + issuer)
}
const closeBtn = ref(null)

function onKey(e) {
    if (e.key === 'Escape') emit('close')
}
onMounted(() => {
    if (typeof document === 'undefined') return
    document.addEventListener('keydown', onKey)
    closeBtn.value?.focus()
})
onBeforeUnmount(() => typeof document !== 'undefined' && document.removeEventListener('keydown', onKey))
</script>

<style scoped>
/* Acilis/kapanis: arka plan solar, panel asagidan kayar (Vue <Transition name="issuer-sheet">) */
.issuer-sheet-enter-active {
    transition: opacity 220ms ease;
}
.issuer-sheet-leave-active {
    transition: opacity 200ms ease;
}
.issuer-sheet-enter-active .issuer-sheet-panel {
    transition: transform 220ms ease, opacity 220ms ease;
}
.issuer-sheet-leave-active .issuer-sheet-panel {
    transition: transform 200ms ease, opacity 200ms ease;
}
.issuer-sheet-enter-from,
.issuer-sheet-leave-to {
    opacity: 0;
}
.issuer-sheet-enter-from .issuer-sheet-panel,
.issuer-sheet-leave-to .issuer-sheet-panel {
    opacity: 0;
    transform: translateY(16px);
}
@media (prefers-reduced-motion: reduce) {
    .issuer-sheet-enter-active,
    .issuer-sheet-leave-active,
    .issuer-sheet-enter-active .issuer-sheet-panel,
    .issuer-sheet-leave-active .issuer-sheet-panel {
        transition: none;
    }
}
</style>
