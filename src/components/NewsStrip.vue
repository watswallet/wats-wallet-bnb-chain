<template>
  <!-- Hic gorunur kayit yoksa bolum TAMAMEN cizilmez: bos bir baslik + bos bir serit,
       kullaniciya "burada bir sey vardi, bozuldu" hissi verir. -->
  <!-- `shrink-0`: bu bolum, ana ekranin `flex flex-col` sutununda bir kardestir ve
       icerik 600px'i astiginda flex kutulari SIKISTIRIR. Sikismasi halinde kartlar
       ezilir; dogru davranis kabin KAYDIRILMASIDIR (kok zaten overflow-y-auto). -->
  <section v-if="items.length" class="shrink-0 pb-6">
    <div class="flex items-center justify-between px-6 mb-2.5">
      <h3 class="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 transition-colors duration-300">
        {{ $t('news.title') }}
      </h3>

      <!-- KONTROLLER TEK kartta gizli: hepsi "kaydirilacak baska bir sey VAR" der;
           tek kartta yalan soylerlerdi.

           NEDEN TIKLANABILIR KONTROL SART: bu serit YALNIZCA yatay kayar ve kaydirma
           cubugu gizli. Chrome'da siradan bir farenin DIKEY tekerlegi boyle bir kutuyu
           kaydirmaz -- olay ustteki kaba gider ve POPUP dikey kayar (gercek Chrome'da
           olculdu: tekerlek sonrasi stripScrollLeft 0, popup scrollTop 141). Yani
           trackpad'i ya da Shift+tekerlegi olmayan kullanicinin seride dokunmanin
           HICBIR yolu YOKTU. Seridi kaydiran TEK arayuz bu dugmelerdir.

           TEKERLEK BILEREK BAGLANMADI (kullanici karari, 2026-09-02): bir donem dikey
           tekerlegi yatay kaydirmaya ceviren bir isleyici vardi ve kaldirildi. Yani
           serit uzerinde tekerlek HER ZAMAN popup'i dikey kaydirir -- kullanicinin
           bekledigi davranis bu. Geri eklenirse ayni sikayet geri gelir. -->
      <div v-if="items.length > 1" class="flex items-center gap-0.5">
        <button
          @click="step(-1)"
          :disabled="activeIndex === 0"
          :aria-label="$t('news.prev')"
          :title="$t('news.prev')"
          class="p-0.5 rounded-md text-slate-400 hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-default transition-colors"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>

        <!-- Noktalar da DUGME: gosterge olmalarinin yaninda dogrudan o karta goturur.
             Gorsel cubuk 1px yuksekliginde ama dugmenin dolgusu tiklama alanini
             parmakla/imlecle isabet edilebilir kiliyor. -->
        <button
          v-for="(item, index) in items"
          :key="item.id"
          @click="scrollToIndex(index)"
          :aria-label="item.title"
          :aria-current="index === activeIndex"
          class="px-0.5 py-1.5 group"
        >
          <span
            class="block h-1 rounded-full transition-all duration-300"
            :class="index === activeIndex ? 'w-3.5 bg-indigo-500' : 'w-1 bg-slate-300 dark:bg-zinc-700 group-hover:bg-slate-400 dark:group-hover:bg-zinc-500'"
          ></span>
        </button>

        <button
          @click="step(1)"
          :disabled="activeIndex >= items.length - 1"
          :aria-label="$t('news.next')"
          :title="$t('news.next')"
          class="p-0.5 rounded-md text-slate-400 hover:text-slate-700 dark:text-zinc-500 dark:hover:text-zinc-200 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-default transition-colors"
        >
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
    </div>

    <!-- `px-6` ICERIDE, kaydiricinin KENDISINDE: disarida olsaydi kartlar ekranin
         kenarinda kesilirdi ve "daha var" ipucu (bir sonraki kartin gorunen ucu)
         kaybolurdu.

         `scroll-pl-6` bunun tamamlayicisi: onsuz yalnizca ILK kartin sol boslugu olur,
         yerine oturan sonraki kartlar ekranin tam kenarina yapisirdi.

         `relative`: kartlarin `offsetLeft`i BU kutuya gore olculsun (offsetParent).
         Konumlandirilmamis olsaydi olcum ustteki bir kaba gore cikardi ve kaydirma
         hedefleri kayardi -- bkz. cardTargets().

         `snap-mandatory`: seridi kaydiran her yol (ok/nokta dugmeleri, trackpad'in
         yatay hareketi) kartlarin TAM basina oturur, arada yarim kart kalmaz. Bir
         donem yakinlik (proximity) modundaydi; sebebi kucuk adimlarla scrollLeft yazan
         tekerlek isleyicisiydi ve o isleyici kaldirildi -- sebep kalmayinca kural da
         eski haline dondu. (Yorumda o yardimci sinifin ADI GECMIYOR: Tailwind kaynagi
         DUZ METIN olarak tarar ve bir yorumda gecen sinif adi icin bile kullanilmayan
         bir kural uretir.) -->
    <div
      ref="scroller"
      @scroll.passive="syncActiveIndex"
      class="relative flex gap-3 px-6 pb-1 overflow-x-auto snap-x snap-mandatory scroll-pl-6 news-scroller"
    >
      <article
        v-for="item in items"
        :key="item.id"
        class="relative shrink-0 w-[268px] snap-start overflow-hidden rounded-2xl p-3.5 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 shadow-sm dark:shadow-none transition-colors duration-300"
      >
        <!-- Vurgu: kartin arkasinda tek bir yumusak isik. Kenarlik rengini degistirmek
             kartlari uyari/hata kartlarina benzetiyordu; haber bir uyari degil. -->
        <div
          class="absolute -top-10 -left-8 w-28 h-28 rounded-full blur-2xl pointer-events-none"
          :class="accentOf(item).glow"
        ></div>

        <div class="relative">
          <div class="flex items-start justify-between gap-2 mb-2">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="w-1.5 h-1.5 rounded-full shrink-0" :class="accentOf(item).dot"></span>

              <span
                v-if="isRecent(item.date, now)"
                class="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide shrink-0"
                :class="accentOf(item).badge"
              >{{ $t('news.new') }}</span>

              <span v-if="item.date" class="text-[10px] font-medium text-slate-400 dark:text-zinc-500 truncate">
                {{ formatDate(item.date) }}
              </span>
            </div>

            <button
              @click="dismiss(item.id)"
              :title="$t('news.dismiss')"
              :aria-label="$t('news.dismiss')"
              class="shrink-0 -mt-1 -mr-1 p-1 rounded-lg text-slate-300 hover:text-slate-600 dark:text-zinc-600 dark:hover:text-zinc-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
            >
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <h4 class="text-[13px] font-bold leading-snug text-slate-900 dark:text-white mb-1 transition-colors duration-300">
            {{ item.title }}
          </h4>

          <p v-if="item.body" class="text-[11px] leading-snug text-slate-500 dark:text-zinc-400 line-clamp-2 transition-colors duration-300">
            {{ item.body }}
          </p>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNews } from '../composables/useNews'
import { isRecent } from '../utils/news'

const { locale } = useI18n()
const { items, dismiss, load } = useNews()

// Rozet esigi mount ANINDA sabitlenir. Her render'da `Date.now()` cagirmak, saf bir
// hesaplamayi zamana bagimli hale getirir ve testlerde tekrarlanabilirligi bozar.
const now = ref(Date.now())

const scroller = ref(null)

// Aktif kart IKI parcali: ham niyet + LISTEYE gore sinirlanmis deger.
//
// Sinirlama bir `watch` degil, TURETILMIS bir deger. Kart kapatilinca liste kisalir ve
// ham indeks disarida kalabilir ("sonraki" oku kalici pasif gorunurdu); watch ile
// yazilsaydi durum iki kaynaktan guncellenirdi ve SSR'da (testlerin kostugu ortam)
// watch callback'leri HIC calismadigi icin o dal test edilemez kalirdi.
const rawIndex = ref(0)
const activeIndex = computed(() =>
  Math.min(Math.max(0, rawIndex.value), Math.max(0, items.value.length - 1)))

// Vurgu siniflari TAM METIN olarak burada duruyor. Tailwind sinif adlarini KAYNAK
// TARAYARAK toplar: `bg-${accent}-500` gibi bir sablon derlenmis CSS'te KARSILIKSIZ
// kalir ve renk hic gorunmez. Bilinmeyen bir accent zaten normalizeNews'te
// varsayilana duser (bkz. utils/news.js), yani buradaki arama HER ZAMAN isabet eder.
const ACCENTS = {
  indigo: {
    dot: 'bg-indigo-500',
    glow: 'bg-indigo-500/15 dark:bg-indigo-500/20',
    badge: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300',
  },
  blue: {
    dot: 'bg-blue-500',
    glow: 'bg-blue-500/15 dark:bg-blue-500/20',
    badge: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  },
  purple: {
    dot: 'bg-purple-500',
    glow: 'bg-purple-500/15 dark:bg-purple-500/20',
    badge: 'bg-purple-50 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300',
  },
  amber: {
    dot: 'bg-amber-500',
    glow: 'bg-amber-500/15 dark:bg-amber-500/20',
    badge: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  },
  emerald: {
    dot: 'bg-emerald-500',
    glow: 'bg-emerald-500/15 dark:bg-emerald-500/20',
    badge: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
}

const accentOf = (item) => ACCENTS[item.accent] || ACCENTS.indigo

// Tarih UTC olarak ayristirilir VE UTC olarak bicimlenir. 'YYYY-MM-DD' yerel saat
// diliminde ayristirilirsa UTC'nin batisindaki kullanicilar BIR ONCEKI gunu gorur --
// duyurunun yayin gunu kullanicinin saat dilimine gore kaymamali.
function formatDate(date) {
  try {
    return new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', timeZone: 'UTC' })
      .format(new Date(date + 'T00:00:00Z'))
  } catch {
    return date
  }
}

// Sol bosluk (`px-6` / `scroll-pl-6`) tek bir sayidan turer; ucu birden ayrisirsa
// kart hep 24px kayik durur.
const GUTTER = 24

/**
 * Her kart icin HEDEF `scrollLeft`.
 *
 * Kart genisligi ve aradaki bosluk ELLE hesaplanMAZ, DOM'dan okunur: `w-[268px]` ya da
 * `gap-3` degisirse bu fonksiyon kendiliginden dogru kalir. Son kart, kaydirilabilir
 * azami degerle sinirlanir -- aksi halde "sonraki" son karta ULASAMAZ gorunurdu.
 */
function cardTargets() {
  const el = scroller.value
  if (!el) return []
  const max = Math.max(0, el.scrollWidth - el.clientWidth)
  return Array.from(el.querySelectorAll('article'))
    .map((card) => Math.min(max, Math.max(0, card.offsetLeft - GUTTER)))
}

/** Belirli bir karta goturur (nokta dugmeleri ve oklar buradan gecer). */
function scrollToIndex(index) {
  const el = scroller.value
  const targets = cardTargets()
  if (!el || !targets.length) return

  const clamped = Math.min(targets.length - 1, Math.max(0, index))
  rawIndex.value = clamped
  el.scrollTo({ left: targets[clamped], behavior: 'smooth' })
}

/** Ok dugmeleri: bir kart ileri/geri. */
function step(delta) {
  scrollToIndex(activeIndex.value + delta)
}

// TEKERLEK ISLEYICISI YOK -- ve bu bir eksiklik DEGIL, kullanici karari (2026-09-02).
// Serit uzerinde tekerlek popup'i dikey kaydirir; seridi yalnizca ok/nokta dugmeleri
// (ve trackpad'in kendi yatay hareketi) kaydirir. Bir donem dikey tekerlegi yatay
// kaydirmaya ceviren bir isleyici vardi, KALDIRILDI: serit uzerinden gecerken sayfanin
// kaymamasi kullaniciyi rahatsiz ediyordu.

// Aktif nokta, kaydirma konumundan TURETILIR; ayri bir "secili kart" durumu tutulmaz.
// Kullanici seridi tekerlekle/trackpad'le de kaydirabiliyor ve iki durum ayrisirdi.
//
// Hedef listesindeki EN YAKIN karta bakar. Onceki surum `scrollWidth / kartSayisi` ile
// tahmin ediyordu; o bolum yan bosluklari ve aralari da paya katti ve adim gercek kart
// araligindan (268+12) buyuk cikti -- gosterge orta kartlarda yanlis noktayi yakiyordu.
function syncActiveIndex() {
  const el = scroller.value
  const targets = cardTargets()
  if (!el || !targets.length) return

  let best = 0
  for (let i = 1; i < targets.length; i++) {
    if (Math.abs(targets[i] - el.scrollLeft) < Math.abs(targets[best] - el.scrollLeft)) best = i
  }
  rawIndex.value = best
}

onMounted(load)
</script>

<style scoped>
/* Serit YATAY kaydirilir ama cubugu gizli: 360px'lik bir popup'ta kalici bir yatay
   cubuk kartlarin altinda ciddi yer kaplar ve kaydirma zaten "yarim gorunen kart"
   ipucuyla anlatiliyor. */
.news-scroller {
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.news-scroller::-webkit-scrollbar {
  display: none;
}
</style>
