<template>
    <div
        ref="root"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        @keydown.esc="close"
        @keydown="onKeydown"
        class="fixed inset-0 z-120 flex items-end justify-center outline-none font-sans"
    >
        <div class="pi-backdrop absolute inset-0 bg-slate-900/50 dark:bg-black/70 backdrop-blur-sm" @click="close"></div>
        <!-- Yukseklik icerige gore, en cok %80: secici (PrivateDeliveryTokenPicker) arama ve uzun liste icin sabit h-[80%] ister,
             burada birkac satir var. -->
        <div class="pi-panel relative flex flex-col w-full max-w-105 max-h-[80%] rounded-t-3xl border-t border-x border-slate-200 dark:border-white/10 bg-white dark:bg-[#0d0b14] text-slate-900 dark:text-white">
            <div class="flex items-center justify-between px-5 pt-4 pb-2">
                <h2 :id="titleId" class="text-base font-bold">{{ title }}</h2>
                <button type="button" @click="close" :aria-label="$t('privacy.transfer.pickTokenClose')" class="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-white/5 cursor-pointer">
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            <ul role="listbox" :aria-labelledby="titleId" class="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 pb-4">
                <li
                    v-for="o in options"
                    :key="String(o.value)"
                    role="option"
                    :aria-selected="isSelected(o) ? 'true' : 'false'"
                    tabindex="0"
                    @click="choose(o)"
                    @keydown.enter.prevent="choose(o)"
                    @keydown.space.prevent="choose(o)"
                    class="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-slate-50 dark:hover:bg-white/5 focus-visible:bg-slate-50 dark:focus-visible:bg-white/5 cursor-pointer text-left outline-none"
                >
                    <img :src="o.logo" alt="" decoding="async" referrerpolicy="no-referrer" @error="(e) => onLogoError(e, o)" class="w-8 h-8 rounded-full shrink-0" />
                    <span class="flex-1 min-w-0">
                        <span class="block text-sm font-bold truncate">{{ o.title }}</span>
                        <span v-if="o.subtitle" class="block text-[11px] truncate" :class="o.subtitleMono ? 'font-mono text-slate-500 dark:text-zinc-400' : 'text-slate-600 dark:text-zinc-300'">{{ o.subtitle }}</span>
                    </span>
                    <svg v-if="isSelected(o)" data-selected="true" class="w-4 h-4 shrink-0 text-violet-600 dark:text-violet-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>
                </li>
            </ul>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'

// Gizli aktarma ekraninin kucuk secim paneli (kaynak hesap, kaynak ag, odeme varligi). Gorunum ve davranis
// PrivateDeliveryTokenPicker ile ayni (iletisim kutusu, Escape, pi-sheet gecisi); arama ve uzak liste yok.
// Satir: { value, title, subtitle?, subtitleMono?, logo, fallback? }. Secim yalniz `select` ile deger olarak yayilir.
const props = defineProps({
    title: { type: String, required: true },
    titleId: { type: String, required: true },
    options: { type: Array, required: true },
    selected: { type: [String, Number], default: null },
})
const emit = defineEmits(['select', 'close'])

const root = ref(null)
const DEFAULT_LOGO = '/default-token.png'
const isSelected = (o) => props.selected !== null && String(o.value) === String(props.selected)

// Logo yuklenemezse yedek simge (onerror once temizlenir, dongu olmasin).
function onLogoError(e, o) {
    e.target.onerror = null
    e.target.src = o.fallback || DEFAULT_LOGO
}

// Ok tuslari satirlar arasinda gezer (satirlar tabindex=0; odak panelde ya da bir satirda olabilir).
function onKeydown(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = Array.from(root.value?.querySelectorAll?.('[role="option"]') || [])
    if (!rows.length) return
    e.preventDefault()
    const at = rows.indexOf(document.activeElement)
    const next = e.key === 'ArrowDown' ? Math.min(rows.length - 1, at + 1) : Math.max(0, at < 0 ? 0 : at - 1)
    rows[next]?.focus?.()
}

onMounted(() => {
    // Odak secili satira (yoksa panele) gider: klavye kullanicisi dogrudan secimden baslar.
    const el = root.value
    const picked = el?.querySelector?.('[aria-selected="true"]')
    ;(picked || el)?.focus?.()
})

function choose(o) {
    emit('select', o.value)
}

function close() {
    emit('close')
}
</script>
