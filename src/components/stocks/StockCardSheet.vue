<template>
    <!-- SALT OKUNUR "NE SAHIP OLUYORSUN" KARTI (K38, spec 6.2): onay / kayit / riza adimi OLMAYAN, yalniz okunan kart.
         Yerel `open` ile acilan alt sayfadir: sayfa kaydi, returnPage, depo, mesaj YOKTUR; kapaninca ust ekran
         (teklif, tutar, sekme) oldugu gibi kalir. Gecersiz ihracci ya da open false iken HICBIR sey cizilmez.

         Veri kancalari (testler): data-stock-card="<ihracci>", data-stock-card-close, data-stock-card-location,
         data-gate-attribution. Giris kancasi (baska bilesenlerde): data-stock-card-open. -->
    <div v-if="visible" :data-stock-card="issuer" class="fixed inset-0 z-50 flex items-end bg-black/50 backdrop-blur-sm" @click.self="emit('close')">
        <div
            role="dialog"
            aria-modal="true"
            :aria-label="$t(`stockGate.card.${issuer}.title`)"
            class="w-full max-w-[420px] mx-auto max-h-full overflow-y-auto custom-scrollbar rounded-t-3xl bg-white dark:bg-[#131315] border-t border-slate-200 dark:border-white/10 p-5 flex flex-col gap-3 text-slate-900 dark:text-white"
        >
            <div class="flex items-start justify-between gap-3">
                <div class="flex flex-col gap-1.5 min-w-0">
                    <h2 class="text-base font-bold leading-snug">{{ $t(`stockGate.card.${issuer}.title`) }}</h2>
                    <span :data-stock-card-badge="issuer" class="self-start px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-500/10 text-[10px] font-semibold text-indigo-600 dark:text-indigo-300">{{ issuer === 'xstocks' ? $t('home.stockBadgeXstocks') : $t('home.stockBadgeBstocks') }}</span>
                </div>
                <button ref="closeBtn" type="button" data-stock-card-close :aria-label="$t('stockTrade.status.close')" class="shrink-0 p-1.5 -mr-1.5 rounded-full text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer" @click="emit('close')">
                    <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>

            <ul class="flex flex-col gap-2.5">
                <li v-for="n in 8" :key="n" class="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed">{{ $t(`stockGate.card.${issuer}.s${n}`) }}</li>
            </ul>
            <p class="text-[11px] text-slate-500 dark:text-zinc-500 leading-relaxed">{{ $t('stockGate.card.scope') }}</p>
            <p class="text-[11px] text-slate-500 dark:text-zinc-500 leading-relaxed">{{ $t('stockGate.card.notIssuer') }}</p>
            <p data-stock-card-location class="text-[11px] text-slate-500 dark:text-zinc-500 leading-relaxed">{{ $t('stockGate.card.locationNote') }}</p>

            <!-- K18: DB-IP atfi. Baglanti ulkesi bilgisi kartla birlikte gosterildigi icin kartin altinda. -->
            <p class="text-[10px] text-center text-slate-400 dark:text-zinc-600">
                <a data-gate-attribution href="https://db-ip.com" target="_blank" rel="noopener noreferrer" class="underline hover:text-indigo-600 dark:hover:text-zinc-300">{{ $t('stockGate.attribution') }}</a>
            </p>
        </div>
    </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { isValidIssuer } from '../../utils/stockGate/rules'

const props = defineProps({
    // 'bstocks' | 'xstocks' | null (gecersiz deger bos cikti verir; tur denetimi yok: dizi / 'dogecoin' de sessizce cizilmez)
    issuer: { default: null },
    open: { type: Boolean, default: false },
})
const emit = defineEmits(['close'])

// Yalniz gecerli ihracci VE acik iken cizilir; baska her durumda bos cikti.
const visible = computed(() => props.open === true && isValidIssuer(props.issuer))

const closeBtn = ref(null)
const onKey = (e) => {
    if (e.key === 'Escape') emit('close')
}
onMounted(() => {
    if (typeof document === 'undefined') return
    document.addEventListener('keydown', onKey)
    closeBtn.value?.focus()
})
onBeforeUnmount(() => typeof document !== 'undefined' && document.removeEventListener('keydown', onKey))
</script>
