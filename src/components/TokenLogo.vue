<template>
  <!-- Logo varsa goster; yoksa veya yuklenemezse deterministik monogram rozetine dus. -->
  <span
    class="shrink-0 rounded-full overflow-hidden flex items-center justify-center ring-1 ring-inset ring-black/[0.04] dark:ring-white/10"
    :class="[sizeClass, showImg ? 'bg-white dark:bg-zinc-800' : markClass(symbol, isNative)]"
  >
    <img v-if="showImg" :src="src" :alt="symbol" class="w-full h-full object-cover" @error="failed = true">
    <span v-else class="font-bold leading-none" :class="textClass">{{ markInitials(symbol) }}</span>
  </span>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { markInitials, markClass } from '../utils/tokenMark'

const props = defineProps({
  src: { type: String, default: '' },
  symbol: { type: String, default: '' },
  isNative: { type: Boolean, default: false },
  sizeClass: { type: String, default: 'w-9 h-9' },   // dis boyut (Tailwind literal)
  textClass: { type: String, default: 'text-xs' },   // monogram yazi boyutu
})

const failed = ref(false)
// src degisince ( or. tetikleyicide secim degisince) hata durumunu sifirla.
watch(() => props.src, () => { failed.value = false })

const showImg = computed(() => !!props.src && !failed.value)
</script>
