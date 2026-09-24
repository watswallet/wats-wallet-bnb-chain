<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-emerald-500/30 transition-colors duration-300">
        <div class="absolute top-0 left-0 right-0 h-48 to-transparent pointer-events-none transition-colors duration-300" :class="tintClass"></div>

        <div class="flex-1 min-h-0 relative overflow-y-auto custom-scrollbar z-10 px-6 py-4">
            <div class="min-h-full flex flex-col justify-center gap-5">
                <header class="flex flex-col items-center gap-2 text-center">
                    <slot name="badge">
                        <div class="w-14 h-14 rounded-2xl bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 flex items-center justify-center shadow-md dark:shadow-xl transition-colors duration-300">
                            <img :src="resolvedBadgeSrc" alt="" class="w-8 h-8 object-contain">
                        </div>
                    </slot>

                    <p class="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">{{ title }}</p>

                    <!-- K5: origin HER ZAMAN istekten gelir, ekran bunu ASLA
                         DEGISTIRMEZ -- kabuk yalniz DIZGEYI cizer, kaynagini
                         SORGULAMAZ. Baskin eleman budur: buyuk, break-all. -->
                    <h2 class="text-xl font-bold tracking-tight break-all">{{ origin }}</h2>

                    <!-- Sayfanin/manifest'in KENDI iddiasi -- dogrulanmamis,
                         bu yuzden ikincil ve soluk. Metin ekrandan gelir,
                         kabuk CEVIRI YAPMAZ. -->
                    <div
                        v-if="claimedName"
                        class="flex items-center gap-2 mt-1 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-zinc-800/50 border border-slate-200 dark:border-white/5 max-w-full transition-colors duration-300"
                    >
                        <!-- K5: iddia edilen ikon 16px'i ASMAZ -- ikincil kalir. -->
                        <img v-if="claimedIcon" :src="claimedIcon" alt="" class="w-4 h-4 rounded-full object-contain shrink-0">
                        <span class="text-xs font-medium text-slate-500 dark:text-zinc-400 truncate transition-colors duration-300">{{ claimedName }}</span>
                    </div>

                    <slot name="header-extra" />
                </header>

                <slot />
            </div>
        </div>

        <footer class="px-5 py-4 border-t border-slate-200/80 dark:border-white/5 bg-white/95 dark:bg-[#09090b]/95 backdrop-blur relative z-20 flex gap-3 transition-colors duration-300">
            <slot name="footer" />
        </footer>
    </div>
</template>

<script setup>
import { computed } from 'vue'
import { LISTED_CHAINS } from '../../data/chains'
import { TON_MAINNET_ID } from '../../utils/chainKind'

const props = defineProps({
    chain: { type: String, required: true },
    title: { type: String, default: '' },
    origin: { type: String, default: '' },
    claimedName: { type: String, default: '' },
    claimedIcon: { type: String, default: '' },
    badgeSrc: { type: String, default: '' },
})

// Tint HARITASI STATIK: her deger TAM bir Tailwind sinif dizgesidir. Calisma
// zamaninda `from-${chain}` gibi bir sinif adi KURMAK Tailwind'in derleme
// zamani tarayicisinda (JIT) hicbir zaman eslesmez ve CSS'e HIC girmez --
// bu yuzden uc zincirin uc TAM dizgesi burada, degismeden, birer sabit olarak
// durur (bugunku ekranlardan birebir).
const TINT_CLASSES = {
    evm: 'bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/20',
    solana: 'bg-linear-to-b from-violet-500/5 dark:from-violet-900/10',
    ton: 'bg-linear-to-b from-sky-500/5 dark:from-sky-900/10',
}
const tintClass = computed(() => TINT_CLASSES[props.chain] || TINT_CLASSES.evm)

// TON'un rozet logosu ag listesinden okunur -- Header.vue:609'daki AYNI desen
// (`chains.find(c => Number(c.chainId) === TON_MAINNET_ID)?.logoURI`). EVM ve
// Solana icin depoda zaten var olan SABIT varliklar kullanilir, ikinci bir
// arama yapilmaz.
const tonLogoURI = computed(() => LISTED_CHAINS.find((c) => Number(c.chainId) === TON_MAINNET_ID)?.logoURI || '')
const DEFAULT_BADGE_SRC = {
    evm: '/chains/1.png',
    solana: '/chains/solana.svg',
}
const resolvedBadgeSrc = computed(() => {
    if (props.badgeSrc) return props.badgeSrc
    if (props.chain === 'ton') return tonLogoURI.value
    return DEFAULT_BADGE_SRC[props.chain] || ''
})
</script>
