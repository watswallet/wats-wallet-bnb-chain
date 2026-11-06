<template>
    <div class="relative w-full max-w-2xl space-y-6">

        <div class="space-y-2">
            <h1 class="text-2xl md:text-4xl font-bold tracking-tight text-white drop-shadow-lg">{{ title }}</h1>
            <p class="text-zinc-400 text-sm md:text-base font-medium max-w-md">{{ lead }}</p>
        </div>

        <div v-if="!isResult" class="flex justify-center py-2" aria-hidden="true">
            <svg class="w-8 h-8 md:w-10 md:h-10 text-indigo-400 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
        </div>

        <ul class="space-y-2 md:space-y-3">
            <li
                v-for="row in rows"
                :key="row.index"
                class="flex items-center justify-between gap-3 px-4 py-3 md:py-4 bg-white/5 border border-white/10 rounded-xl"
            >
                <div class="min-w-0 flex items-baseline gap-3">
                    <span class="text-sm md:text-base font-medium text-white">{{ row.name }}</span>
                    <span class="text-xs md:text-sm font-mono text-zinc-500">{{ shortenAddress(row.address, 6, 4) }}</span>
                </div>

                <span v-if="isResult && row.index === 0" class="shrink-0 px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/20 text-indigo-300 text-[11px] md:text-xs font-semibold">{{ $t('onboarding.accountScan.badge_active') }}</span>
                <svg v-else-if="!isResult && row.used" class="shrink-0 w-4 h-4 md:w-5 md:h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
            </li>

            <li
                v-if="showChecking"
                class="flex items-center justify-between gap-3 px-4 py-3 md:py-4 bg-white/5 border border-white/10 rounded-xl"
            >
                <div class="min-w-0 flex items-baseline gap-3">
                    <span class="text-sm md:text-base font-medium text-white">{{ checking.name }}</span>
                    <span class="text-xs md:text-sm font-mono text-zinc-500">{{ shortenAddress(checking.address, 6, 4) }}</span>
                </div>
                <span class="shrink-0 text-xs md:text-sm text-zinc-400">{{ $t('onboarding.accountScan.checking') }}</span>
            </li>
        </ul>

        <div v-if="phase === 'scanning'" class="flex justify-center pt-2">
            <button
                type="button"
                @click="emit('skip')"
                class="text-sm text-zinc-400 hover:text-white underline underline-offset-4 decoration-zinc-600 transition-colors cursor-pointer"
            >
                {{ $t('onboarding.accountScan.btn_skip', { name: firstName }) }}
            </button>
        </div>

        <div v-if="isResult" class="pt-2 md:pt-4 pb-6 md:pb-10">
            <button
                type="button"
                @click="emit('continue')"
                class="relative w-full md:max-w-md mx-auto py-4 md:py-5 rounded-2xl font-bold text-base md:text-lg tracking-wide transition-all duration-500 overflow-hidden group flex items-center justify-center gap-3 cursor-pointer hover:-translate-y-1 shadow-[0_0_40px_rgba(99,102,241,0.3)] hover:shadow-[0_0_60px_rgba(99,102,241,0.5)]"
            >
                <div class="absolute inset-0 transition-all duration-500 bg-linear-to-r from-indigo-600 via-purple-600 to-indigo-600 bg-size-[200%_auto] animate-gradient"></div>

                <span class="relative text-white">{{ primaryLabel }}</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { shortenAddress } from '../../utils/shortenAddress'

// Sunumsal bilesen: tarama mantigini ve yazimi bilmez, gelen durumu cizer (durum useAccountScan'dedir,
// asamayi ImportPhrases yonetir).
//   scanning -> tarama suruyor: satirlar, "kontrol ediliyor" satiri ve Atla baglantisi
//   saving   -> tarama bitti, hesaplar kuruluyor/yaziliyor: ayni duzen ama kontrol satiri ve Atla YOK
//               (Atla bu asamada hicbir seyi durduramaz, gorunmesi kullaniciyi yaniltir)
//   result   -> "N hesap bulundu" ekrani; donen gosterge yok
// Genel donen gosterge scanning ve saving'de TEK basina ustte durur; satirlarin kendi gostergesi yoktur.
// Yarim tarama sonuc ekranina hic gelmez (Global Constraints), bu yuzden "partial" gibi bir prop yok.
const props = defineProps({
    phase: { type: String, required: true, validator: (value) => ['scanning', 'saving', 'result'].includes(value) },
    // Eklenecek hesaplar: {index, name, address, used}. used=false aradaki bos hesaptir (isaret almaz).
    rows: { type: Array, default: () => [] },
    // Su an yoklanan indeks: {index, name, address} ya da null.
    checking: { type: Object, default: null },
    // Atla metnindeki ad (yalniz bu hesapla devam edilir).
    firstName: { type: String, default: '' },
    // Hesaplar cuzdana yazildi mi: sonuc notu ve dugme etiketi buna gore degisir.
    afterWrite: { type: Boolean, default: false },
})
const emit = defineEmits(['skip', 'continue'])

const { t } = useI18n()

const isResult = computed(() => props.phase === 'result')
// Tarama bitince (saving, result) kontrol edilen indeks kalmaz; satiri yalniz tarama suruyorken ciz.
const showChecking = computed(() => props.phase === 'scanning' && !!props.checking)

const title = computed(() => isResult.value
    ? t('onboarding.accountScan.title_found', { count: props.rows.length })
    : t('onboarding.accountScan.title_scanning'))
// Sonucta aciklamanin yerini not alir (taslakta not satirlarin USTUNDEDIR).
const lead = computed(() => {
    if (!isResult.value) return t('onboarding.accountScan.desc_scanning')
    return t(props.afterWrite ? 'onboarding.accountScan.note_added' : 'onboarding.accountScan.note_will_add')
})
const primaryLabel = computed(() =>
    t(props.afterWrite ? 'onboarding.accountScan.btn_go_wallet' : 'onboarding.accountScan.btn_continue'))
</script>

<style scoped>
/* Kardes onboarding ekranlariyla (ImportPhrases vb.) ayni dugme animasyonu; scoped oldugu icin her bilesen kendi kopyasini tasir. */
@keyframes gradient {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
}
.animate-gradient {
    animation: gradient 3s ease infinite;
}
</style>
