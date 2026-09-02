<template>
    <div v-if="address" class="relative" ref="root">
        <!-- ATS = cuzdanin yakiti. Bakiye HER ZAMAN BSC'dendir; kullanicinin bulundugu ag
             pill'i degistirmez. -->
        <button
            @click="open = !open"
            class="flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full border transition-all duration-300 cursor-pointer shadow-sm dark:shadow-none"
            :class="pillClass"
            :title="$t('header.fuel.title')"
        >
            <img src="/ats.png" alt="ATS" class="w-4 h-4 rounded-full shrink-0" @error="e => e.target.style.display='none'" />
            <span class="text-[11px] font-bold tabular-nums leading-none">{{ fuel.display.value }}</span>
            <span class="text-[9px] font-bold leading-none opacity-60">{{ fuel.symbol.value }}</span>
            <span v-if="fuel.stale.value" class="w-1 h-1 rounded-full bg-current opacity-40 shrink-0"></span>
        </button>

        <Transition
            enter-active-class="transition-all duration-200 ease-out"
            leave-active-class="transition-all duration-150 ease-in"
            enter-from-class="opacity-0 scale-95 -translate-y-1"
            enter-to-class="opacity-100 scale-100 translate-y-0"
            leave-from-class="opacity-100 scale-100 translate-y-0"
            leave-to-class="opacity-0 scale-95 -translate-y-1"
        >
            <div
                v-if="open"
                class="absolute right-0 top-full mt-2 w-64 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl dark:shadow-2xl z-50 p-3"
            >
                <div class="flex items-center justify-between mb-1">
                    <h3 class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                        {{ $t('header.fuel.title') }}
                    </h3>
                    <button
                        @click="reload"
                        :disabled="fuel.loading.value"
                        class="p-1 rounded-lg text-slate-400 dark:text-zinc-500 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        :title="$t('header.fuel.refresh')"
                    >
                        <svg class="w-3.5 h-3.5" :class="fuel.loading.value ? 'animate-spin' : ''" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                </div>

                <div class="flex items-baseline gap-1.5 mb-1">
                    <span class="text-xl font-bold text-slate-900 dark:text-white tabular-nums truncate">{{ fuel.exact.value }}</span>
                    <span class="text-xs font-bold text-slate-500 dark:text-zinc-400 shrink-0">{{ fuel.symbol.value }}</span>
                </div>

                <!-- Ipucu yoksa bu satir HIC render edilmez: uydurulmus bir tahmin yaniltir.
                     $t'nin UCUNCU argumani COGUL SAYISIDIR: "1 transaction" / "2 transactions".
                     Tekil tam da uyari durumudur (opsLeft 1-2 -> amber), yani bozuk ingilizce
                     en cok orada gorunurdu. i18n `legacy: false` kurulu oldugu icin `$tc`
                     ENJEKTE EDILMEZ (yalniz t/rt/d/n/tm/te); cogul-farkindali cagri budur.
                     Turkce'de tekil form yok; tek parcali metin bu cagriyla da aynen doner. -->
                <p v-if="fuel.opsLeft.value !== null" class="text-[11px] font-semibold mb-1" :class="opsTextClass">
                    {{ $t('header.fuel.opsLeft', { count: fuel.opsLeft.value }, fuel.opsLeft.value) }}
                    <span class="font-normal text-slate-400 dark:text-zinc-500">({{ $t('header.fuel.opsHint') }})</span>
                </p>

                <p v-if="reasonKey" class="text-[11px] font-semibold text-red-500 dark:text-red-400 mb-1">
                    {{ $t(reasonKey) }}
                </p>

                <p v-if="fuel.stale.value" class="text-[10px] text-amber-600 dark:text-amber-400 mb-1">
                    {{ fuel.balance.value === null ? $t('header.fuel.unread') : $t('header.fuel.stale') }}
                </p>

                <p class="text-[10px] text-slate-500 dark:text-zinc-500 leading-snug mb-3">
                    {{ $t('header.fuel.desc') }}
                </p>

                <button
                    @click="buyAts"
                    class="w-full py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold transition-colors duration-200 cursor-pointer"
                >
                    {{ $t('header.fuel.buy') }}
                </button>
            </div>
        </Transition>
    </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAtsFuel } from '../composables/useAtsFuel'
import { ATS_BUY_URL } from '../utils/atsFuel'
import { networkStore } from '../store/network'

const props = defineProps({
    address: { type: String, default: null },
})

const network = networkStore()
const fuel = useAtsFuel()
const open = ref(false)
const root = ref(null)

// Renk: `ok` ve `unknown` NOTR. Surekli ekranda duran bir oge yesil yanip durmamali;
// yesil "bir sey oldu" sinyalini tuketir.
const pillClass = computed(() => ({
    empty: 'bg-red-50/80 dark:bg-red-950/40 border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-400 hover:border-red-300 dark:hover:border-red-700',
    low: 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50 text-amber-700 dark:text-amber-400 hover:border-amber-300 dark:hover:border-amber-700',
}[fuel.level.value] || 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-zinc-300 hover:border-slate-300 dark:hover:border-white/20'))

// Ops satiri sebep satiriyla AYNI dili konusur: `empty` iken hemen altinda kirmizi
// "tek isleme yetmiyor" dururken bu satirin notr gri kalmasi tutarsizdi.
const opsTextClass = computed(() => ({
    empty: 'text-red-600 dark:text-red-400',
    low: 'text-amber-600 dark:text-amber-400',
}[fuel.level.value] || 'text-slate-600 dark:text-zinc-300'))

// `empty` IKI ayri gercegi kapsar; metin ikisini ayirir, renk ikisinde de kirmizidir.
const reasonKey = computed(() => {
    if (fuel.level.value !== 'empty') return null
    return Number(fuel.balance.value) > 0 ? 'header.fuel.notEnoughForOne' : 'header.fuel.none'
})

const chainId = computed(() => {
    const c = network.currentNetwork?.chainId
    if (!c) return null
    return typeof c === 'string' && c.startsWith('0x') ? parseInt(c, 16) : Number(c)
})

function reload() {
    fuel.load(props.address, chainId.value)
}

// BuyToken.vue KULLANILMAZ: MoonPay ATS'yi listelemiyor (bkz. utils/atsFuel ATS_BUY_URL).
function buyAts() {
    open.value = false
    window.open(ATS_BUY_URL, '_blank')
}

function handleOutsideClick(e) {
    if (root.value && !root.value.contains(e.target)) open.value = false
}

onMounted(() => {
    reload()
    document.addEventListener('click', handleOutsideClick)
})

onUnmounted(() => {
    document.removeEventListener('click', handleOutsideClick)
})

// Hesap degisince bakiye BASKA bir cuzdanindir; eski deger ekranda kalmamali.
watch(() => props.address, () => reload())
// Ag degisimi bakiyeyi degistirmez (her zaman BSC) ama DOGRU ucret ipucunu degistirir.
// Bu yuzden `reload()` DEGIL `setChain()`: reload her ag anahtarlamasinda BSC'de gereksiz
// bir balanceOf kosturuyordu -- yorumun soyledigi is bu degildi.
watch(chainId, () => fuel.setChain(chainId.value))
</script>
