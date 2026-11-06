<template>
    <div
        ref="root"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        @keydown.esc="close"
        class="fixed inset-0 z-120 flex items-end justify-center outline-none font-sans"
    >
        <div class="pi-backdrop absolute inset-0 bg-slate-900/50 dark:bg-black/70 backdrop-blur-sm" @click="close"></div>
        <!-- Yukseklik icerige gore, en cok %80 (PrivateOptionSheet ile ayni kalip). -->
        <div class="pi-panel relative flex flex-col w-full max-w-105 max-h-[80%] rounded-t-3xl border-t border-x border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d0b14] text-slate-900 dark:text-white">
            <div class="flex items-center justify-between px-5 pt-4 pb-2">
                <h2 :id="titleId" class="text-base font-bold">{{ $t('privacy.transfer.howTitle') }}</h2>
                <button type="button" @click="close" :aria-label="$t('privacy.transfer.pickTokenClose')" class="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 pb-5">
                <ol v-if="mode === 'fund'" class="space-y-3">
                    <li v-for="(k, i) in FUND_STEPS" :key="k" :data-testid="'info-step-' + (i + 1)" class="flex gap-3 text-sm text-slate-700 dark:text-zinc-200">
                        <span class="w-5 h-5 shrink-0 mt-0.5 rounded-full bg-slate-100 dark:bg-white/10 text-[11px] font-bold flex items-center justify-center" aria-hidden="true">{{ i + 1 }}</span>
                        <span class="flex-1 min-w-0">{{ k === 'fundStep2' ? $t('privacy.transfer.fundStep2', { chain: chainName }) : $t('privacy.transfer.' + k) }}</span>
                    </li>
                </ol>
                <p v-else data-testid="info-body" class="text-sm text-slate-700 dark:text-zinc-200">{{ $t(mode === 'send' ? 'privacy.transfer.sendHowBody' : 'privacy.transfer.selfHowBody') }}</p>
                <p data-testid="info-fee" class="mt-3 text-sm text-slate-700 dark:text-zinc-200">{{ $t(mode === 'fund' ? 'privacy.transfer.fundHowFee' : 'privacy.transfer.sendHowFee') }}</p>
                <p data-testid="info-refund" class="mt-3 text-sm text-slate-700 dark:text-zinc-200">{{ $t('privacy.transfer.howRefund') }}</p>
            </div>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'

// Gizli aktarma ekraninin "?" bilgi sayfasi (K4). Yalniz okunur metin: fund'da uc adim + ag ucreti + iade, send'de kisa aciklama + ag ucreti + iade,
// swap/bridge (Takas/Kopru) kendi Gizli Hesabina odeme govdesi (selfHowBody) + ag ucreti + iade; kendine teslimde zincirde baglanti yok iddiasi YOKTUR. Gorunum ve davranis PrivateOptionSheet ile ayni kalip
// (iletisim kutusu, Escape, zemin tiklamasi, pi-sheet gecisi); odagi geri verme ebeveynin isidir.
// Fiyat / dolar metni yok (gizli modda fiyat istegi yok).
defineProps({
    mode: { type: String, required: true, validator: (v) => ['fund', 'send', 'swap', 'bridge'].includes(v) },
    chainName: { type: String, default: '' },
})
const emit = defineEmits(['close'])

const FUND_STEPS = ['fundStep1', 'fundStep2', 'fundStep3']
const titleId = 'private-info-title'
const root = ref(null)

onMounted(() => {
    // Odak panele gider: Escape hemen calissin.
    root.value?.focus?.()
})

function close() {
    emit('close')
}
</script>
