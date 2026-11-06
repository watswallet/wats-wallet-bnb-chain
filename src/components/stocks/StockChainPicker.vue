<template>
    <!-- Hisse sayfasi ag secici. Yalniz sunum: secim mantigi useIssuerSwitch.pickChain'de
         (cuzdanin aktif agi DEGISMEZ). Cok agda cipler (Hisseler ag cipleri stili), tek agda sade etiket. -->
    <div v-if="rows.length > 1" data-stock-chain-chips role="group" :aria-label="$t('stockChain.label')" class="flex gap-2 overflow-x-auto">
        <button
            v-for="r in rows"
            :key="r.chainId"
            type="button"
            :data-stock-chain-chip="r.chainId"
            :aria-pressed="Number(selected) === Number(r.chainId) ? 'true' : 'false'"
            class="shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
            :class="Number(selected) === Number(r.chainId) ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' : 'text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-300'"
            @click="$emit('pick', r.chainId)"
        >
            <img :src="chainLogo(r.chainId)" :alt="chainName(r.chainId)" class="w-4 h-4 rounded-full object-contain">
            <span>{{ chainName(r.chainId) }}</span>
        </button>
    </div>
    <div v-else-if="rows.length === 1" data-stock-chain-label class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-zinc-400">
        <img :src="chainLogo(rows[0].chainId)" :alt="chainName(rows[0].chainId)" class="w-4 h-4 rounded-full object-contain">
        <span>{{ $t('stockChain.single', { network: chainName(rows[0].chainId) }) }}</span>
    </div>
</template>

<script setup>
import { ALL_CHAINS } from '../../data/chains'
import { isSameChainId } from '../../utils/vm'
import { chainLogo } from '../../utils/chainLogo'

defineProps({
    // useIssuerSwitch.chainRows: secili ihraccinin katalog satirlari
    rows: { type: Array, default: () => [] },
    // Secili zincir (selected_token_ref.chainId)
    selected: { type: [Number, String], default: null },
})
defineEmits(['pick'])

function chainName(chainId) {
    return ALL_CHAINS.find((c) => isSameChainId(c.chainId, chainId))?.name ?? String(chainId)
}
</script>
