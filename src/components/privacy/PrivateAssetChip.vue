<template>
    <component
        :is="interactive ? 'button' : 'div'"
        :type="interactive ? 'button' : undefined"
        :role="interactive ? undefined : 'group'"
        :aria-label="interactive ? undefined : `${symbol} ${network}`"
        :aria-haspopup="interactive ? 'dialog' : undefined"
        :data-testid="testid"
        :class="compact
            ? (interactive
                ? 'inline-flex items-center gap-2 max-w-full rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-[#202022] dark:hover:bg-[#2a2a2c] pl-1.5 pr-2.5 py-1 text-left text-slate-800 dark:text-white border border-transparent transition-colors cursor-pointer'
                : 'inline-flex items-center gap-2 max-w-full rounded-full bg-slate-100 dark:bg-[#202022] pl-1.5 pr-2.5 py-1 text-left text-slate-800 dark:text-white border border-transparent')
            : (interactive
                ? 'flex items-center gap-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#202022] dark:hover:bg-[#2a2a2c] px-3 py-2 rounded-xl shrink-0 text-left text-slate-800 dark:text-white transition-all border border-transparent hover:border-slate-300 dark:hover:border-white/10 cursor-pointer'
                : 'flex items-center gap-2 bg-slate-100 dark:bg-[#202022] px-3 py-2 rounded-xl shrink-0 text-left text-slate-800 dark:text-white border border-transparent')"
        @click="onClick"
    >
        <PrivateTokenLogo :logo="logo" :badge="badge" :small="compact" />
        <span :class="compact ? 'flex items-baseline gap-2 min-w-0' : 'flex flex-col min-w-0 leading-tight'">
            <span :class="compact ? 'font-semibold text-xs' : 'font-bold text-sm'">{{ symbol }}</span>
            <span :class="compact ? 'text-[11px] text-slate-500 dark:text-zinc-400 truncate' : 'text-[10px] text-slate-500 dark:text-zinc-400 truncate'">{{ network }}</span>
        </span>
        <svg v-if="interactive" :class="compact ? 'w-3.5 h-3.5 shrink-0 text-slate-500 dark:text-zinc-400' : 'w-4 h-4 shrink-0 text-slate-500 dark:text-zinc-400'" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m12 15.4l-6-6L7.4 8l4.6 4.6L16.6 8L18 9.4z" /></svg>
    </component>
</template>

<script setup>
// Gizli aktarma ekraninin token cipi (sade ekran plani T8): logo + zincir rozeti + sembol + ag adi (+ ok).
// Gorunum Takas cipinin (Swap.vue) sinif kumesidir. Etkilesimliyse <button> (tiklama ebeveyne `click` olarak gecer);
// degilse <div role="group"> (tek secenek: ok ve dugme yok, sT20). Gorseller yalnizca yerel yollardir.
// `compact`: Gonder ekraninin buyuk tutar duzeninde tutarin altindaki kucuk hap (logo 20 px, sembol ve ag adi tek satirda); islev ayni.
import PrivateTokenLogo from './PrivateTokenLogo.vue'

const props = defineProps({
    logo: { type: String, required: true },
    badge: { type: String, default: null },
    symbol: { type: String, required: true },
    network: { type: String, required: true },
    interactive: { type: Boolean, default: true },
    compact: { type: Boolean, default: false },
    testid: { type: String, default: undefined },
})
const emit = defineEmits(['click'])

function onClick(e) {
    if (props.interactive) emit('click', e)
}
</script>
