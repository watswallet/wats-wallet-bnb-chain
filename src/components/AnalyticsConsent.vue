<template>
  <!-- Gizlilik onayi popup'i. Yalniz derleme bayragi aciksa VE analytics_enabled kayitsizsa
       (karar yok) cizilir; kabul/ret sonrasi, ya da baska yuzeyde karar verilince kapanir.
       Kapatma dugmesi yok: kapatmak karar degildir, bir sonraki acilista yine gorunur. -->
  <div
    v-if="ANALYTICS_ENABLED && gorunur"
    class="fixed inset-0 z-100 flex items-center justify-center p-5 bg-slate-900/50 dark:bg-black/70 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
  >
    <div class="w-full max-w-[320px] rounded-2xl p-5 bg-white dark:bg-[#0c0c0e] border border-slate-200 dark:border-white/10 shadow-2xl transition-colors duration-300">
      <h3 class="text-[15px] font-bold leading-snug text-slate-900 dark:text-white mb-2">
        {{ $t('analyticsConsent.title') }}
      </h3>
      <p class="text-xs leading-relaxed text-slate-500 dark:text-zinc-400 mb-1">
        {{ $t('analyticsConsent.body') }}
      </p>
      <a
        :href="PRIVACY_POLICY_URL"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-block text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline mb-4"
      >{{ $t('analyticsConsent.readPolicy') }}</a>

      <div class="flex items-center justify-end gap-2">
        <button
          @click="reddet"
          class="px-3 py-2 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
        >{{ $t('analyticsConsent.decline') }}</button>
        <button
          @click="kabulEt"
          class="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-indigo-500 hover:bg-indigo-600 transition-colors cursor-pointer"
        >{{ $t('analyticsConsent.accept') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ANALYTICS_ENABLED } from '../utils/featureFlags'
import {
  readAnalyticsDecided, setAnalyticsEnabled, ANALYTICS_ENABLED_KEY, PRIVACY_POLICY_URL,
} from '../utils/analyticsPing'

// Baslangicta GIZLI: depo okunana kadar cizilmez (karar vermis kullanici bir an popup gormesin).
const okundu = ref(false)
const karar = ref(false)
const gorunur = computed(() => okundu.value && !karar.value)

// Baska yuzeyde (Tercihler, baska popup/panel) verilen karar buraya canli yansir.
// Kayit silinirse (newValue boolean degil) karar yok sayilir -> popup yeniden cikar.
const depoDegisti = (degisiklikler, alan) => {
  if (alan !== 'local' || !(ANALYTICS_ENABLED_KEY in degisiklikler)) return
  karar.value = typeof degisiklikler[ANALYTICS_ENABLED_KEY].newValue === 'boolean'
}

onMounted(async () => {
  // Bayrak kapaliyken depoya hic dokunulmaz ve dinleyici kurulmaz.
  if (!ANALYTICS_ENABLED) return
  chrome.storage.onChanged?.addListener?.(depoDegisti)
  try {
    karar.value = await readAnalyticsDecided(chrome.storage.local)
    okundu.value = true
  } catch (e) {
    // Okunamazsa gosterme: karar yok = zaten KAPALI, bir sonraki acilista yine denenir.
    console.error('Analitik onayi okunamadi:', e)
  }
})

onUnmounted(() => {
  chrome.storage.onChanged?.removeListener?.(depoDegisti)
})

// Ekran depoya YAZILDIKTAN sonra guncellenir; yazma patlarsa popup acik kalir.
const karariKaydet = async (kabul) => {
  try {
    await setAnalyticsEnabled(chrome.storage.local, kabul)
    karar.value = true
  } catch (e) {
    console.error('Analitik tercihi kaydedilemedi:', e)
  }
}
const kabulEt = () => karariKaydet(true)
const reddet = () => karariKaydet(false)
</script>
