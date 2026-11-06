<template>
  <span
    class="shrink-0 rounded-full overflow-hidden flex items-center justify-center ring-1 ring-inset ring-black/[0.04] dark:ring-white/10"
    :class="[sizeClass, 'bg-white dark:bg-zinc-800']"
  >
    <TokenAvatar :sources="src ? [src] : []" :symbol="symbol" class="w-full h-full object-cover" />
  </span>
</template>

<script setup>
// Logo varsa goster; yoksa veya yuklenemezse tokenin NOTR monogramina (TokenAvatar: grafit zemin, tek harf) dus. Eskiden 8 renkli pastel palet
// ciziyordu (sahip karari 2026-11-03: gri yer tutucu da renkli rozet de yok). Props ayni kaldi: GasTokenModal, GasTokenSelector, TxIdentityLine.
// `isNative` ve `textClass` artik etkisiz (monogram SVG kutuyu kendisi olcekler); cagiranlar degismesin diye kabul edilir.
import TokenAvatar from './TokenAvatar.vue'

defineProps({
  src: { type: String, default: '' },
  symbol: { type: String, default: '' },
  isNative: { type: Boolean, default: false },
  sizeClass: { type: String, default: 'w-9 h-9' },   // dis boyut (Tailwind literal)
  textClass: { type: String, default: 'text-xs' },
})
</script>
