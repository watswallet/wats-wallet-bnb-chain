<template>
  <Transition name="fade-slide">
    <div
      v-if="gorunur"
      class="absolute left-0 right-0 top-0 z-50 p-3"
    >
      <div class="bg-white dark:bg-[#18181b] border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-lg transition-colors duration-300">
        <p class="text-sm font-medium text-slate-900 dark:text-zinc-100 mb-1">
          {{ $t('sidePanelNotice.title') }}
        </p>
        <p class="text-xs text-slate-500 dark:text-zinc-400 mb-3">
          {{ $t('sidePanelNotice.body') }}
        </p>

        <div class="flex items-center gap-2">
          <button
            @click="popupaGec"
            class="flex-1 py-2 rounded-lg text-xs font-bold bg-slate-900 dark:bg-zinc-100 text-white dark:text-black hover:bg-slate-800 dark:hover:bg-white transition-colors cursor-pointer"
          >
            {{ $t('sidePanelNotice.usePopup') }}
          </button>
          <button
            @click="kapat"
            class="flex-1 py-2 rounded-lg text-xs font-bold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
          >
            {{ $t('sidePanelNotice.ok') }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
/**
 * "Cuzdan artik yan panelde aciliyor" -- BIR KEZ gosterilen kart.
 *
 * Sistem bildirimi KULLANILMAZ. chrome.notifications izni eklemek, guncellemede
 * uzantiyi kullanici ONAYLAYANA KADAR devre disi birakir; bir cuzdanda kabul
 * edilemez. Kart bu yuzden arayuzun ICINDE yasar.
 *
 * GORUNME KOSULU UC SARTTIR, UCU DE GEREKLI:
 *   1. yuzey yan panel      -- onay penceresinde ve onboarding sekmesinde cikmaz
 *   2. bayrak yazilmamis    -- KATI `=== true` karsilastirmasi (depo eksik
 *                              anahtar icin undefined doner; `!x` yazilsaydi
 *                              varsayilan davranis tersine donerdi)
 *   3. kilit/karsilama degil -- kilitli cuzdanin uzerine bir sey koymayiz
 *
 * Kart App.vue'de `.page-wrapper`in DISINDA render edilir: icine konursa
 * `:key="page.currentPage"` her sayfa degisiminde onu soker ve yeniden sokar.
 */
import { ref, computed, onMounted } from 'vue'
import { pageStore } from '../store/pageStore'
import { isPanel } from '../utils/uiSurface'
import { UI_MODE_POPUP } from '../utils/uiMode'

const NOTICE_KEY = 'sidePanelNoticeSeen'

// `onboarding_pending` de buraya girer: cuzdani HENUZ OLMAYAN kullaniciya
// "cuzdan artik yan panelde aciliyor" ipucu vermek anlamsiz -- ortada acilacak
// bir cuzdan yok ve kart kurulum yonergesinin ustunu orter.
const KILIT_EKRANLARI = ['', 'welcome', 'forgot_password', 'onboarding_pending']

const page = pageStore()
const gosterilebilir = ref(false)

const gorunur = computed(() =>
  gosterilebilir.value
  && isPanel()
  && !KILIT_EKRANLARI.includes(page.currentPage),
)

onMounted(async () => {
  try {
    const { [NOTICE_KEY]: gorulmus } = await chrome.storage.local.get(NOTICE_KEY)
    gosterilebilir.value = gorulmus !== true
  } catch {
    // Depo okunamadiysa karti GOSTERME: kart bir uyari degil bir ipucu, yani
    // burada temkinli varsayilan "gosterme" yonundedir.
    gosterilebilir.value = false
  }
})

// Bayrak ONCE depoya, SONRA ekrana. Ters sirada yazilsa ve depo yazimi sessizce
// dusse kart bir sonraki acilista geri gelirdi -- kullanici kapatmanin
// calismadigini ancak o zaman anlardi.
async function bayragiYaz() {
  try {
    await chrome.storage.local.set({ [NOTICE_KEY]: true })
  } catch (e) {
    console.error('Bildirim bayragi yazilamadi:', e)
  }
}

// `gorunur` (v-if'in bagli oldugu computed) `gosterilebilir`den turer ve
// READONLY'dir -- dogrudan atama yapilamaz (Vue'da sessizce yoksayilir), bu
// yuzden ekrani gizlemek icin `gosterilebilir.value` degistirilir.
async function kapat() {
  await bayragiYaz()
  gosterilebilir.value = false
}

async function popupaGec() {
  try {
    const yanit = await chrome.runtime.sendMessage({ type: 'SET_UI_MODE', mode: UI_MODE_POPUP })
    if (!yanit?.success) {
      // BASARISIZ gecis: bayrak YAZILMAZ, kart ACIK kalir. Aksi halde
      // kullanici sessizce popup'a GECEMEZ VE bir daha bu karti hic
      // GORMEZ -- yeniden deneme sansi SONSUZA dek kaybolurdu.
      console.error('Popup moduna gecilemedi:', yanit?.error)
      return
    }
    await bayragiYaz()
    gosterilebilir.value = false
    // Gecisi BASLATAN panel kendini kapatir. Yayin (broadcast) ile kapatma
    // YAPILMAZ: ayni kod TUM pencerelerdeki panelleri kapatirdi.
    window.close()
  } catch (e) {
    console.error('Popup moduna gecilemedi:', e)
  }
}
</script>
