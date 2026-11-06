<template>
    <div
        ref="root"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-picker-title"
        tabindex="-1"
        @keydown.esc="close"
        class="fixed inset-0 z-120 flex items-end justify-center outline-none font-sans"
    >
        <div class="pi-backdrop absolute inset-0 bg-slate-900/50 dark:bg-black/70 backdrop-blur-sm" @click="close"></div>
        <div class="pi-panel relative flex flex-col w-full max-w-105 h-[80%] rounded-t-3xl border-t border-x border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d0b14] text-slate-900 dark:text-white">
            <div class="flex items-center justify-between px-5 pt-4 pb-2">
                <h2 id="asset-picker-title" class="text-base font-bold">{{ $t('privacy.transfer.pickSourceTitle') }}</h2>
                <button type="button" @click="close" :aria-label="$t('privacy.transfer.pickTokenClose')" class="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            <div class="px-5 pb-3">
                <input v-model="search" type="text" spellcheck="false" :aria-label="$t('privacy.transfer.pickTokenSearch')" :placeholder="$t('privacy.transfer.pickTokenSearch')" class="w-full px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-sm" />
            </div>
            <ul class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pb-4">
                <li v-for="o in shown" :key="o.key">
                    <button type="button" data-testid="asset-row" @click="choose(o)" :aria-current="isSelected(o) ? 'true' : undefined" class="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer text-left">
                        <span class="relative shrink-0">
                            <img :src="o.logo" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="onLogoError" class="w-8 h-8 rounded-full" />
                            <img v-if="o.badge" :src="o.badge" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" @error="onLogoError" class="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white dark:bg-zinc-900 p-[1.5px] border border-slate-200 dark:border-white/10" />
                        </span>
                        <span class="flex-1 min-w-0">
                            <span class="block text-sm font-bold truncate">{{ o.asset }}</span>
                            <span class="block text-[11px] text-slate-600 dark:text-zinc-300 truncate">{{ o.chainName }}</span>
                        </span>
                        <svg v-if="isSelected(o)" data-selected="true" class="w-4 h-4 shrink-0 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                    </button>
                </li>
                <li v-if="!shown.length" class="px-2 py-3 text-xs text-slate-500 dark:text-zinc-500">{{ $t('privacy.transfer.pickTokenEmpty') }}</li>
            </ul>
        </div>
    </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { filterSourcePairs } from '../../utils/privacy/sourceAssets'

// Gizli aktarimin birlesik kaynak secicisi (sade ekran plani T9; K2, sT19): (zincir, varlik) ciftleri tek listede, arama
// varlik sembolu ve ag adi uzerinden yerelde suzer. Satirda bakiye YOK (sT13). Secenekler ebeveynden gelir
// ({ key, chainId, asset, chainName, logo, badge }; logo ve rozet yalniz yerel yollar); secim yalniz `key` yayar.
// Panel her acilista yeni ornektir (ebeveyn v-if ile acar; pi-sheet gecisini ebeveyn sarar).
const props = defineProps({
    options: { type: Array, default: () => [] },
    selectedKey: { type: String, default: null },
})
const emit = defineEmits(['select', 'close'])

const DEFAULT_LOGO = '/default-token.png'
const root = ref(null)
const search = ref('')

const shown = computed(() => filterSourcePairs(props.options, search.value))
const isSelected = (o) => props.selectedKey !== null && o.key === props.selectedKey

// Logo yuklenemezse yedek simge (onerror once temizlenir, dongu olmasin).
function onLogoError(e) {
    e.target.onerror = null
    e.target.src = DEFAULT_LOGO
}

onMounted(() => root.value?.focus?.())

function choose(o) {
    emit('select', o.key)
}

function close() {
    emit('close')
}
</script>
