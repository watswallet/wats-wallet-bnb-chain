<template>
    <!-- bStocks / xStocks karsilastirma penceresi. Yalniz sunum; hicbir secenek one cikarilmaz. -->
    <div data-issuer-info class="fixed inset-0 z-50 flex items-end bg-black/50 backdrop-blur-sm" @click.self="$emit('close')">
        <div
            id="issuer-info-sheet"
            role="dialog"
            aria-modal="true"
            :aria-label="$t('stockIssuer.diff.title')"
            class="issuer-sheet-panel w-full max-w-[420px] mx-auto max-h-full overflow-y-auto custom-scrollbar rounded-t-3xl bg-white dark:bg-[#131315] border-t border-slate-200 dark:border-white/10 p-5 flex flex-col gap-4 text-slate-900 dark:text-white"
        >
            <div class="flex flex-col gap-1">
                <h2 class="text-base font-bold">{{ $t('stockIssuer.diff.title') }}</h2>
                <p class="text-xs text-slate-500 dark:text-zinc-400">{{ $t('stockIssuer.diff.intro') }}</p>
            </div>
            <div data-issuer-cards class="grid grid-cols-1 min-[380px]:grid-cols-2 gap-2">
                <div
                    v-for="i in ISSUERS"
                    :key="i"
                    :data-issuer-card="i"
                    :data-selected="selected === i ? 'true' : 'false'"
                    class="rounded-2xl p-3 flex flex-col gap-2.5 transition-colors"
                    :class="selected === i ? 'ring-2 ring-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'ring-1 ring-slate-200 dark:ring-white/10'"
                >
                    <div class="flex items-center gap-2">
                        <IssuerLogo :issuer="i" size="w-7 h-7" :data-issuer-badge="i" />
                        <div class="min-w-0">
                            <p class="text-sm font-bold leading-tight">{{ $t('stockIssuer.' + i) }}</p>
                            <p class="text-[11px] leading-snug text-slate-500 dark:text-zinc-400 break-words">{{ $t('stockIssuer.diff.cell.issuer.' + i) }}</p>
                        </div>
                    </div>
                    <div v-for="k in ROWS" :key="k" :data-issuer-info-row="k" class="flex flex-col gap-0.5">
                        <p class="text-[10px] font-semibold text-slate-500 dark:text-zinc-400">{{ $t('stockIssuer.diff.row.' + k) }}</p>
                        <p class="text-xs leading-snug break-words">{{ cell(i, k) }}</p>
                    </div>
                </div>
            </div>
            <p class="text-[11px] text-slate-500 dark:text-zinc-400">{{ $t('stockIssuer.diff.footnote') }}</p>
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

const props = defineProps({
    // Bu sirketin xStocks aglari, virgulle ("Ethereum, BNB Smart Chain")
    networks: { type: String, default: '' },
    // Su an secili ihracci ('bstocks' | 'xstocks' | null): mini karti vurgulanir
    selected: { type: String, default: null },
})
// Tek ag: liste virgul icermez (birden fazlaysa "A, B"; bos/yedek metin tek ag sayilmaz).
const singleNetwork = computed(() => props.networks.trim() !== '' && !props.networks.includes(','))
const emit = defineEmits(['close'])

const ISSUERS = ['bstocks', 'xstocks']
const ROWS = ['network', 'how', 'closed']
const { t } = useI18n()
function cell(issuer, k) {
    if (issuer === 'xstocks' && k === 'network') {
        return singleNetwork.value ? t('stockIssuer.diff.cell.network.xstocksOne', { network: props.networks }) : t('stockIssuer.diff.cell.network.xstocks', { networks: props.networks })
    }
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
