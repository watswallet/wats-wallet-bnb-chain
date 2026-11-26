<template>
  <span v-if="!gorunum.cells" ref="kok">{{ gorunum.text }}</span>
  <span v-else ref="kok" class="kaymak-odometre" :class="{ 'kaymak-odometre-baslangic': gorunum.start }">
    <span class="sr-only">{{ gorunum.text }}</span>
    <template v-for="(h, i) in gorunum.cells" :key="i">
      <span v-if="h.char === undefined" class="kaymak-odometre-hucre" aria-hidden="true">
        <span class="kaymak-odometre-serit" :style="seritStili(h)">
          <span v-for="n in 10" :key="n">{{ n - 1 }}</span>
        </span>
      </span>
      <span v-else class="kaymak-odometre-sabit" aria-hidden="true">{{ h.char }}</span>
    </template>
  </span>
</template>

<script setup>
// KAYMAK G8: toplam bakiyede sayac rakamlar (spec 7.7, K6, D9).
//
// Yaprak bilesen: SSR'da, ilk cizimde ve donus disinda kok ozniteliksiz tek span, metin
// birebir `text`. Yalniz ekranda degisen deger (ayni kimlik, ayni rakam yapisi, hareket
// izni) donus suresince sutun kurar: her ASCII rakam 0-9 seridi, ayiraclar sabit hucre;
// gercek son deger gorunmez metin olarak durur (ekran okuyucu ve kopyalama). Donus bitince
// duz metne donulur (D9). Kural ve zamanlama utils/motion/odometerPlan.js'te; burada yalniz
// cizim ve yerlesim okumasi var. Emit, expose ve v-model yok: donen deger disari verilmez (K7).
import { ref, shallowRef, watch, nextTick, onBeforeUnmount } from 'vue'
import { createOdometer } from '../../utils/motion/odometerPlan'
import { motionAllowed } from '../../utils/motion/motionAllowed'

const props = defineProps({
  // Baslik sayi bolumu (headlineParts.number): son durumda birebir bu yazilir.
  text: { type: String, required: true },
  // headlineSize sinifi: degisirse donus yok (rebuild).
  size: { type: String, default: '' },
  // Kimlik degisirse donus yok, deger aninda yazilir (7.6).
  identity: { type: String, default: '' },
  // Sagdan sola dillerde sayac yok (plain).
  locale: { type: String, default: '' },
})

const kok = ref(null)
const gorunum = shallowRef({ text: props.text, cells: null, start: false })

// Serit yalniz transform ile doner (spec 7.7 Performans); gecikme sagdan sola hane basina.
const seritStili = (h) => ({ transform: `translateY(-${h.digit * 10}%)`, transitionDelay: `${h.delay}ms` })

const sayac = createOdometer({
  initial: { text: props.text, size: props.size, identity: props.identity, locale: props.locale },
  onState: (s) => { gorunum.value = s },
  motionAllowed: () => motionAllowed(),
  // Kok cizilmemisse (SSR, kaldirilmis) sutun kurulmaz, deger aninda yazilir.
  canRoll: () => kok.value != null,
  // Sutunlar onceki rakamlarda gecissiz cizildikten sonra yerlesim okunur (baslangic konumu
  // islenir), sonra yeni rakamlara gecilir; aksi halde tarayici gecisi baslatmaz.
  afterRender: (fn) => {
    nextTick(() => {
      const el = kok.value
      if (el) void el.offsetWidth
      fn()
    })
  },
})

watch(() => [props.text, props.size, props.identity, props.locale], ([text, size, identity, locale]) => {
  sayac.update({ text, size, identity, locale })
})

onBeforeUnmount(() => {
  sayac.dispose()
})
</script>
