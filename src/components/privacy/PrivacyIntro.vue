<template>
    <div
        ref="root"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-intro-title"
        tabindex="-1"
        @keydown.esc="dismiss"
        class="pi-root fixed inset-0 z-120 flex items-end justify-center outline-none font-sans"
    >
        <div class="pi-backdrop absolute inset-0 bg-slate-900/50 dark:bg-black/70 backdrop-blur-sm" @click="dismiss"></div>

        <!-- Grafit tasarim dili (sahip karari 2026-10-31): sayfa NORMAL modda acilir, style.css'teki gizli mod eslemeleri
             ona uygulanmaz; bu yuzden grafit yuzeyler ve murekkep dugme KENDI siniflariyla verilir (gizli modun onizlemesi). -->
        <div class="pi-panel relative flex flex-col w-full max-w-105 max-h-[94%] overflow-hidden rounded-t-3xl border-t border-x border-slate-200 dark:border-white/10 bg-white dark:bg-[#0b0e13] text-slate-900 dark:text-zinc-100">
            <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 pt-3 pb-4">
                <div class="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-white/15"></div>

                <div class="flex flex-col items-center text-center">
                    <!-- Hayalet: PrivacyToggle'daki gizli mod simgesiyle AYNI yol (dolu = gizli mod acik), gozler ters renkte. -->
                    <div class="pi-hero mb-3 flex w-14 h-14 items-center justify-center rounded-2xl bg-slate-100 dark:bg-[#1d2127] border border-slate-200 dark:border-white/5">
                        <svg data-icon="ghost" class="pi-ghost w-8 h-8 text-zinc-900 dark:text-zinc-100" viewBox="0 0 24 24" aria-hidden="true">
                            <path
                                d="M12 2.75a7.25 7.25 0 0 0-7.25 7.25v10.6c0 .5.57.78.96.47l1.62-1.27 1.9 1.5a.75.75 0 0 0 .93 0L12 19.8l1.84 1.5a.75.75 0 0 0 .93 0l1.9-1.5 1.62 1.27c.4.31.96.03.96-.47V10A7.25 7.25 0 0 0 12 2.75z"
                                fill="currentColor"
                                stroke="currentColor"
                                stroke-width="1.6"
                                stroke-linejoin="round"
                            />
                            <g class="pi-ghost-eyes">
                                <ellipse cx="9.4" cy="10.4" rx="1.25" ry="1.6" class="fill-white dark:fill-zinc-950" />
                                <ellipse cx="14.6" cy="10.4" rx="1.25" ry="1.6" class="fill-white dark:fill-zinc-950" />
                            </g>
                        </svg>
                    </div>

                    <h2 id="privacy-intro-title" class="text-xl font-bold tracking-tight">{{ $t('privacy.intro.title') }}</h2>
                    <p class="mt-2 text-[13px] leading-relaxed text-slate-600 dark:text-zinc-400">{{ $t('privacy.intro.lead') }}</p>
                </div>

                <div class="mt-4">
                    <p class="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:text-zinc-500">{{ $t('privacy.intro.limitsTitle') }}</p>
                    <ul class="flex flex-col gap-1.5">
                        <li
                            v-for="(limit, i) in limits"
                            :key="limit.key"
                            class="pi-limit flex items-start gap-3 rounded-2xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-[#11141a] px-3 py-2"
                            :style="{ animationDelay: `${120 + i * 50}ms` }"
                        >
                            <span class="pi-icon-tile mt-px flex w-7 h-7 shrink-0 items-center justify-center rounded-xl bg-white dark:bg-[#1d2127] border border-slate-200 dark:border-white/5 text-slate-600 dark:text-zinc-300">
                                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" :d="limit.icon" /></svg>
                            </span>
                            <span class="text-xs leading-snug text-slate-700 dark:text-zinc-300">{{ $t(`privacy.intro.${limit.key}`) }}</span>
                        </li>
                    </ul>
                </div>

                <p v-if="error" role="alert" class="mt-4 text-xs font-medium text-red-600 dark:text-red-400">{{ error }}</p>
            </div>

            <!-- Dugmeler sabit: 600px popup'ta liste kaydirilsa da CTA hep gorunur. -->
            <div class="pi-footer shrink-0 px-6 pt-3 pb-4 border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#0b0e13]">
                <button
                    type="button"
                    @click="enable"
                    :disabled="busy"
                    class="pi-cta w-full py-3.5 rounded-2xl font-bold text-sm bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-200 dark:text-zinc-950 dark:hover:bg-zinc-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 dark:focus-visible:outline-zinc-200 transition-colors cursor-pointer disabled:opacity-60"
                >
                    <span class="inline-flex items-center justify-center gap-2">
                        <svg v-if="busy" class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-opacity="0.3" stroke-width="3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>
                        {{ $t('privacy.intro.cta') }}
                    </span>
                </button>
                <button
                    type="button"
                    @click="dismiss"
                    :disabled="busy"
                    class="mt-1 w-full py-1.5 text-xs font-semibold text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-100 transition-colors cursor-pointer disabled:opacity-60"
                >{{ $t('privacy.intro.dismiss') }}</button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { pageStore } from '../../store/pageStore'
import { privacyStore } from '../../store/privacy'
import { switchPrivacyMode } from '../../utils/privacy/privacySwitch'
import { PRIVATE_ATS_SALE } from '../../utils/featureFlags'

// Gizli mod bilgi paneli (spec 4.3). Ayri bir sayfa degil: header hayalet dugmesi
// (PrivacyToggle) mevcut ekranin uzerinde alttan acar. Bes sinir metni ACIKCA
// gosterilir (ucret sunucusu siniri dahil: liste artik alti satir); urun "tam anonim" vaat etmez.
const emit = defineEmits(['close'])
const { t } = useI18n()
const page = pageStore()
const privacy = privacyStore()
const busy = ref(false)
const error = ref('')
const root = ref(null)

const LIMITS = [
    { key: 'limitAmounts', icon: 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5' },
    { key: 'limitNetwork', icon: 'M12 21a9 9 0 100-18 9 9 0 000 18zm0 0c2.5-2.5 3.75-5.5 3.75-9S14.5 5.5 12 3m0 18c-2.5-2.5-3.75-5.5-3.75-9S9.5 5.5 12 3M3.5 9h17M3.5 15h17' },
    // sT18 (K7 bedeli): Para yuklerken ag ucreti icin Wats odeme sunucusu iki adresi ayni IP'den gorebilir. Bayraga BAGLI DEGIL.
    { key: 'limitFeeServer', icon: 'M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.337 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z' },
    { key: 'limitExchange', icon: 'M3 21h18M4.5 21V10.5M19.5 21V10.5M9 21v-6.75h6V21M12 3l9 6H3l9-6z' },
    { key: 'limitOperator', icon: 'M9 12.75L11.25 15 15 9.75M12 2.71a11.96 11.96 0 01-8.25 3.29c0 6.19 3.51 11.15 8.25 13.29 4.74-2.14 8.25-7.1 8.25-13.29A11.96 11.96 0 0112 2.71z' },
    { key: 'limitDevice', icon: 'M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3' },
]
// K13 (cok-ag spec 4.8): ATS satin alma yolu (PRIVATE_ATS_SALE) acikken Wats satis sunucusunun Gizli adresi IP ile gordugu
// yedinci "Gizlemedigi seyler" satiri olarak eklenir. Bayrak kapaliyken liste alti satirdir.
const limits = PRIVATE_ATS_SALE
    ? [...LIMITS, { key: 'limitSale', icon: 'M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z' }]
    : LIMITS

onMounted(() => {
    root.value?.focus?.()
})

function dismiss() {
    if (busy.value) return
    emit('close')
}

async function enable() {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
        // Panel ayni gecisin icinde kapanir: eski goruntu (panel acik) yeni ekrana erir.
        const res = await switchPrivacyMode(true, {
            privacy,
            onApplied: () => {
                page.currentPage = 'home'
                emit('close')
            },
        })
        if (!res.ok) error.value = t(res.errorKey)
    } finally {
        busy.value = false
    }
}
</script>

<style>
/* Scoped DEGIL: PrivacyToggle'daki <Transition name="pi-sheet"> siniflari kok
   ogeye eklenir, ic ogeler (arka plan + panel) buradan hedeflenir. */
.pi-sheet-enter-active .pi-backdrop,
.pi-sheet-leave-active .pi-backdrop { transition: opacity 240ms ease; }
.pi-sheet-enter-active .pi-panel { transition: transform 380ms cubic-bezier(0.22, 1, 0.36, 1); }
.pi-sheet-leave-active .pi-panel { transition: transform 240ms ease-in; }
.pi-sheet-enter-from .pi-backdrop,
.pi-sheet-leave-to .pi-backdrop { opacity: 0; }
.pi-sheet-enter-from .pi-panel,
.pi-sheet-leave-to .pi-panel { transform: translateY(100%); }

/* Grafit karari: hayalet yuzmez, golge ve parlama yok; yalniz gozler seyrek kirpar. */
.pi-ghost-eyes { transform-origin: 12px 10.4px; animation: pi-blink 4.5s ease-in-out infinite; }
.pi-limit { opacity: 0; animation: pi-in 360ms ease-out forwards; }

@keyframes pi-blink {
    0%, 92%, 100% { transform: scaleY(1); }
    95% { transform: scaleY(0.1); }
}
@keyframes pi-in {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
    .pi-ghost-eyes { animation: none; }
    .pi-limit { animation: none; opacity: 1; }
    .pi-sheet-enter-active .pi-panel, .pi-sheet-leave-active .pi-panel { transition: none; }
}
</style>
