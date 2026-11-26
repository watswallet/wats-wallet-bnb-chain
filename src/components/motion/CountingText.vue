<template>
  <span>{{ shown }}</span>
</template>

<script setup>
// KAYMAK G7: sayarak kayan metin (spec 7.6, K6, K7, D8).
//
// Yaprak bilesen: ara deger YALNIZ burada tutulur ve yalniz bu span yeniden cizilir
// (Home her karede cizilmez). Kok tek span; kendi sinifi, ozniteligi, stili yok:
// ebeveynin sinifi fallthrough ile birebir gecer, SSR kaliplari aynen eslesir.
// Emit, expose ve v-model yok: sayilan deger disari verilmez (K7).
//
// Ilk cizimde ve SSR'da metin birebir `text` (`****`, `—` dahil); 0'dan sayma yok.
import { ref, watch, onBeforeUnmount } from 'vue'
import { createCounter, getSharedTicker } from '../../utils/motion/tween'
import { motionAllowed } from '../../utils/motion/motionAllowed'

const props = defineProps({
  // Bugunku ifadenin kendisi: son karede birebir bu yazilir.
  text: { type: String, required: true },
  // Sayilabilir hedef; sayilamiyorsa null (gizli, tire, bilinmeyen deger).
  value: { type: Number, default: null },
  // Ara kare bicimi. Kararli bir fonksiyon verilmeli (satir ici ok fonksiyonu her cizimde yeni prop olur).
  format: { type: Function, required: true },
  // Kimlik degisirse sayma yok, deger aninda atlar.
  identity: { type: String, default: '' },
})

const shown = ref(props.text)

const counter = createCounter({
  initial: { text: props.text, value: props.value, identity: props.identity },
  format: (n) => props.format(n),
  onText: (s) => { shown.value = s },
  ticker: getSharedTicker(),
  motionAllowed: () => motionAllowed(),
})

watch(() => [props.text, props.value, props.identity], ([text, value, identity]) => {
  counter.update({ text, value, identity })
})

onBeforeUnmount(() => {
  counter.dispose()
})
</script>
