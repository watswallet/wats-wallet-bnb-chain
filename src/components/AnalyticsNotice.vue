<template>
  <!-- Bir kerelik bilgilendirme: ping varsayilan ACIK, kullanici bunu burada ogrenir ve
       tek tikla kapatabilir. Derleme bayragi kapaliyken, kart gorulduyse ya da istatistik
       zaten kapatilmissa (kart 'gonderiyoruz' dememeli) HIC cizilmez, yani ana ekran duzenine bosluk eklemez. `shrink-0`: Home'un
       `flex flex-col` sutununda sikismasin (bkz. NewsStrip.vue). Gorunum, kardes
       "Gelismeler" kartlariyla ayni dili kullanir (kenarlik, koyu tema, yumusak isik). -->
  <section v-if="ANALYTICS_ENABLED && gorunur" class="shrink-0 px-6 pb-4">
    <article
      class="relative overflow-hidden rounded-2xl p-3.5 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 shadow-sm dark:shadow-none transition-colors duration-300"
    >
      <div class="absolute -top-10 -left-8 w-28 h-28 rounded-full blur-2xl pointer-events-none bg-violet-500/15 dark:bg-violet-500/20"></div>

      <div class="relative">
        <div class="flex items-center gap-1.5 mb-1">
          <span class="w-1.5 h-1.5 rounded-full shrink-0 bg-violet-500"></span>
          <h4 class="text-[13px] font-bold leading-snug text-slate-900 dark:text-white transition-colors duration-300">
            {{ $t('analyticsNotice.title') }}
          </h4>
        </div>

        <p class="text-[11px] leading-snug text-slate-500 dark:text-zinc-400 mb-3 transition-colors duration-300">
          {{ $t('analyticsNotice.body') }}
        </p>

        <div class="flex items-center justify-end gap-2">
          <button
            @click="kapat"
            class="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-slate-500 hover:text-slate-800 dark:text-zinc-400 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
          >{{ $t('analyticsNotice.turnOff') }}</button>

          <button
            @click="tamam"
            class="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-indigo-500 hover:bg-indigo-600 transition-colors cursor-pointer"
          >{{ $t('analyticsNotice.ok') }}</button>
        </div>
      </div>
    </article>
  </section>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { ANALYTICS_ENABLED } from '../utils/featureFlags'
import {
  readAnalyticsNoticeSeen, markAnalyticsNoticeSeen, readAnalyticsEnabled, setAnalyticsEnabled,
  ANALYTICS_NOTICE_KEY, ANALYTICS_ENABLED_KEY,
} from '../utils/analyticsPing'

// Baslangicta GIZLI: depo okunana kadar kart cizilmez; aksi halde goruldu isaretli
// kullanici her acilista kartin bir an yanip sonmesini gorurdu.
const okundu = ref(false)
const goruldu = ref(false)
// Tercih zaten KAPALIYSA kart gosterilmez: 'gonderiyoruz' demek yanlis olurdu (kullanici
// kartin kendi ipucuyla Ayarlar > Tercihler'den kapatip Home'a donmus olabilir).
const istatistikAcik = ref(true)
const gorunur = computed(() => okundu.value && !goruldu.value && istatistikAcik.value)

// Baska yuzeyde (Tercihler, baska popup/panel) yazilan degisiklikler karta canli yansir.
// Kayit silinirse (newValue yok) isaret 'gorulmedi', tercih varsayilan ACIK sayilir.
const depoDegisti = (degisiklikler, alan) => {
  if (alan !== 'local') return
  if (ANALYTICS_NOTICE_KEY in degisiklikler) {
    goruldu.value = degisiklikler[ANALYTICS_NOTICE_KEY].newValue === true
  }
  if (ANALYTICS_ENABLED_KEY in degisiklikler) {
    istatistikAcik.value = degisiklikler[ANALYTICS_ENABLED_KEY].newValue !== false
  }
}

onMounted(async () => {
  // Bayrak kapaliyken depoya hic dokunulmaz ve dinleyici kurulmaz.
  if (!ANALYTICS_ENABLED) return
  // Dinleyici okumadan ONCE kurulur: okuma sirasinda gelen bir degisiklik kacmasin.
  chrome.storage.onChanged?.addListener?.(depoDegisti)
  try {
    goruldu.value = await readAnalyticsNoticeSeen(chrome.storage.local)
    istatistikAcik.value = await readAnalyticsEnabled(chrome.storage.local)
    okundu.value = true
  } catch (e) {
    // Okunamazsa gosterme: karti her acilista yeniden gostermek, hic gostermemekten kotu.
    console.error('Analitik bildirimi okunamadi:', e)
  }
})

onUnmounted(() => {
  chrome.storage.onChanged?.removeListener?.(depoDegisti)
})

// 'Tamam': tercih degismez (varsayilan acik kalir), yalniz kart bir daha cikmaz.
// Ekran depoya YAZILDIKTAN sonra guncellenir; yazma patlarsa kart acik kalir.
const tamam = async () => {
  try {
    await markAnalyticsNoticeSeen(chrome.storage.local)
    goruldu.value = true
  } catch (e) {
    console.error('Analitik bildirimi kaydedilemedi:', e)
  }
}

// 'Kapat': once tercih (kimlik de silinir), sonra goruldu isareti. NEDEN bu sira:
// isaret yazimi patlarsa tercih yine de kapali kalir (kullanicinin istedigi sonuc);
// ters sirada kart kapanir ama ping surerdi.
const kapat = async () => {
  try {
    await setAnalyticsEnabled(chrome.storage.local, false)
    await markAnalyticsNoticeSeen(chrome.storage.local)
    istatistikAcik.value = false
    goruldu.value = true
  } catch (e) {
    console.error('Analitik tercihi kaydedilemedi:', e)
  }
}
</script>
