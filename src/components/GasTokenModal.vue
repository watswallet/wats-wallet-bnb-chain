<template>
  <!-- Fee-token secici — alt-sheet modal. Scrim ile panel AYRI katmanda:
       scrim aninda gorunur (transition yok), yalnizca panel asagidan kayar. -->

  <!-- Scrim: arka plan blur'u aninda gelir, gecis efekti YOK -->
  <div
    v-if="open"
    @click="emit('close')"
    class="absolute inset-0 z-50 bg-slate-900/60 dark:bg-black/60 backdrop-blur-sm"
  ></div>

  <!-- Panel katmani: sadece sheet kayar; disina tiklama scrim'e gecer (pointer-events-none) -->
  <Transition name="slide-up">
    <div v-if="open" class="absolute inset-0 z-50 flex items-end justify-center pointer-events-none" role="dialog" aria-modal="true">

      <div class="pointer-events-auto w-full bg-white dark:bg-[#18181b] rounded-t-2xl border-t border-slate-200 dark:border-white/10 p-2 pb-6 relative max-h-[70%] flex flex-col shadow-2xl transition-colors duration-300">
        <div class="w-full flex justify-center pt-2 pb-4">
          <div class="w-10 h-1 rounded-full bg-slate-300 dark:bg-zinc-700 transition-colors duration-300"></div>
        </div>

        <h3 class="text-center text-sm font-bold text-slate-900 dark:text-white mb-4 transition-colors duration-300">
          {{ $t('send.confirmTransaction.payGasWith') }}
        </h3>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-2 pb-1 space-y-1" role="listbox" :aria-label="$t('send.confirmTransaction.payGasWith')">

          <!-- NATIVE — en ustte sabit -->
          <button
            type="button" role="option" :aria-selected="modelValue === null"
            @click="select(null)"
            class="w-full min-h-13 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
            :class="modelValue === null
              ? 'bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-inset ring-emerald-300 dark:ring-emerald-500/30'
              : 'hover:bg-slate-50 dark:hover:bg-white/3 ring-1 ring-inset ring-transparent'"
          >
            <TokenLogo :src="nativeLogo" :symbol="nativeSymbol" is-native size-class="w-9 h-9" text-class="text-xs" />
            <div class="flex items-center gap-1.5 flex-1 min-w-0">
              <span class="text-sm font-bold truncate" :class="modelValue === null ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-800 dark:text-zinc-100'">{{ nativeSymbol }}</span>
              <span class="text-[10px] font-medium text-slate-400 dark:text-zinc-600 shrink-0">native</span>
            </div>
            <svg v-if="modelValue === null" class="shrink-0 w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" /></svg>
          </button>

          <div v-if="options.length" class="h-px bg-slate-100 dark:bg-white/5 mx-3 my-1.5 transition-colors duration-300"></div>

          <!-- ERC-20 fee tokenlari — gas'i karsilamayanlar pasif ("yetersiz") -->
          <button
            v-for="t in options" :key="t.token"
            type="button" role="option" :aria-selected="modelValue === t.token"
            :disabled="isInsufficient(t)"
            @click="select(t.token)"
            class="w-full min-h-13 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
            :class="isInsufficient(t)
              ? 'opacity-50 cursor-not-allowed ring-1 ring-inset ring-transparent'
              : (modelValue === t.token
                ? 'cursor-pointer bg-emerald-50 dark:bg-emerald-500/10 ring-1 ring-inset ring-emerald-300 dark:ring-emerald-500/30'
                : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-white/3 ring-1 ring-inset ring-transparent')"
          >
            <TokenLogo :src="t.logoURI" :symbol="t.symbol" size-class="w-9 h-9" text-class="text-xs" />
            <div class="flex-1 min-w-0">
              <span class="block text-sm font-bold truncate" :class="modelValue === t.token ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-800 dark:text-zinc-100'">{{ t.symbol.toUpperCase() }}</span>
            </div>
            <div class="flex items-center gap-2 shrink-0 max-w-[46%]">
              <div class="flex flex-col items-end min-w-0">
                <span class="text-sm font-semibold tabular-nums truncate max-w-full text-slate-700 dark:text-zinc-200" :title="String(t.balance)">{{ formatBalance(t.balance) }}</span>
                <span v-if="isInsufficient(t)" class="text-[9px] font-bold uppercase tracking-wide leading-none text-red-500 dark:text-red-400">{{ $t('send.confirmTransaction.feeInsufficient') }}</span>
                <span v-else class="text-[9px] font-medium uppercase tracking-wide leading-none text-slate-400 dark:text-zinc-600">{{ $t('send.confirmTransaction.feeBalance') }}</span>
              </div>
              <svg v-if="modelValue === t.token" class="shrink-0 w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7" /></svg>
            </div>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { formatBalance } from '../utils/tokenMark'
import { isOptionInsufficient } from '../utils/gasToken'
import TokenLogo from './TokenLogo.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  modelValue: { type: String, default: null },
  options: { type: Array, default: () => [] },
  nativeSymbol: { type: String, default: 'ETH' },
  nativeLogo: { type: String, default: '' },
  sentAssetAddress: { type: String, default: null }, // gonderilen ERC-20 (ayni-token gas durumu icin)
  sendAmount: { type: [String, Number], default: 0 },
})

const emit = defineEmits(['update:modelValue', 'close'])

// Bir fee-token gas'i (+ ayni token gonderiliyorsa transfer miktarini) karsilamiyor mu?
const isInsufficient = (t) =>
  isOptionInsufficient(t, { sentAssetAddress: props.sentAssetAddress, sendAmount: props.sendAmount })

const select = (val) => {
  emit('update:modelValue', val)
  emit('close')
}
</script>

<style scoped>
.slide-up-enter-active, .slide-up-leave-active { transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
.slide-up-enter-from, .slide-up-leave-to { transform: translateY(100%); opacity: 0; }
</style>
