<template>
  <div>
    <button
      type="button"
      @click="open = true"
      class="w-full shrink-0 min-h-11 flex items-center justify-between gap-3 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl px-3 py-2.5 text-left shadow-sm dark:shadow-none hover:bg-slate-50 dark:hover:bg-white/3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 transition-colors duration-300 cursor-pointer"
    >
      <div class="flex flex-col min-w-0">
        <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">{{ $t('send.confirmTransaction.payGasWith') }}</span>
        <div class="flex items-baseline gap-2 mt-0.5 min-w-0">
          <TokenLogo :src="selectedLogo" :symbol="selectedSymbol" :is-native="modelValue === null" size-class="w-5 h-5 mt-2" text-class="text-[9px]" />
          <span class="text-sm font-bold text-slate-800 dark:text-zinc-100 truncate">{{ selectedSymbol.toUpperCase() }}</span>
          <span v-if="modelValue === null" class="text-[10px] font-medium text-slate-400 dark:text-zinc-600 shrink-0">native</span>
          <span v-else class="text-xs font-semibold tabular-nums text-slate-400 dark:text-zinc-500 truncate max-w-27.5" :title="String(selectedBalance)">{{ formatBalance(selectedBalance) }}</span>
        </div>
      </div>
      <svg class="shrink-0 w-4 h-4 text-slate-400 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
    </button>

    <GasTokenModal
      :open="open"
      :model-value="modelValue"
      :options="options"
      :native-symbol="nativeSymbol"
      :native-logo="nativeLogo"
      :sent-asset-address="sentAssetAddress"
      :send-amount="sendAmount"
      @update:model-value="(v) => emit('update:modelValue', v)"
      @close="open = false"
    />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import GasTokenModal from './GasTokenModal.vue'
import TokenLogo from './TokenLogo.vue'
import { formatBalance } from '../utils/tokenMark'

const props = defineProps({
  modelValue: { type: String, default: null },          // null = native
  options: { type: Array, default: () => [] },
  nativeSymbol: { type: String, default: 'ETH' },
  nativeLogo: { type: String, default: '' },
  sentAssetAddress: { type: String, default: null },
  sendAmount: { type: [String, Number], default: 0 },
})
const emit = defineEmits(['update:modelValue'])

const open = ref(false)
const selectedOption = computed(() => props.options.find((t) => t.token === props.modelValue) || null)
const selectedSymbol = computed(() => (props.modelValue === null ? props.nativeSymbol : (selectedOption.value?.symbol || '?')))
const selectedBalance = computed(() => selectedOption.value?.balance ?? 0)
const selectedLogo = computed(() => (props.modelValue === null ? props.nativeLogo : (selectedOption.value?.logoURI || '')))
</script>
