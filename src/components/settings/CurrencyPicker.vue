<template>
  <!-- Alttan acilan secici (dil seciciyle ayni kabuk). Arka plana basmak close yayar. -->
  <div class="absolute inset-0 z-50 flex items-end justify-center">
    <div @click="dismiss" class="absolute inset-0 bg-slate-900/60 dark:bg-black/60 backdrop-blur-sm transition-colors duration-300"></div>

    <div
      role="dialog"
      aria-modal="true"
      :aria-label="$t('settings.preferences.selectCurrency')"
      class="w-full bg-white dark:bg-[#18181b] rounded-t-2xl border-t border-slate-200 dark:border-white/10 p-2 pb-6 relative max-h-[85%] flex flex-col shadow-2xl transition-colors duration-300"
    >
      <div class="w-full flex justify-center pt-2 pb-4">
        <div class="w-10 h-1 rounded-full bg-slate-300 dark:bg-zinc-700 transition-colors duration-300"></div>
      </div>

      <h3 class="text-center text-sm font-bold text-slate-900 dark:text-white mb-4 transition-colors duration-300">
        {{ $t('settings.preferences.selectCurrency') }}
      </h3>

      <!-- Liste yoksa (ag yok, sunucu bos dondu) arama kutusu anlamsiz: yalniz aciklama. -->
      <p v-if="!entries.length" class="px-6 py-8 text-center text-sm text-slate-500 dark:text-zinc-400 transition-colors duration-300">
        {{ $t('settings.preferences.currencyListUnavailable') }}
      </p>

      <template v-else>
        <div class="px-2 pb-3">
          <input
            v-model="query"
            type="text"
            autocomplete="off"
            spellcheck="false"
            :placeholder="$t('settings.preferences.searchCurrency')"
            :aria-label="$t('settings.preferences.searchCurrency')"
            class="w-full px-3 py-2.5 rounded-lg text-sm bg-slate-100 dark:bg-white/5 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-zinc-500 border border-transparent focus:border-emerald-500/50 focus:outline-none transition-colors duration-300"
          />
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-2" role="listbox">
          <p v-if="!sections.length" class="px-4 py-8 text-center text-sm text-slate-500 dark:text-zinc-400 transition-colors duration-300">
            {{ $t('settings.preferences.currencyNoMatch') }}
          </p>

          <div v-for="section in sections" :key="section.key" class="mb-2">
            <h4 v-if="section.title" class="text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider mt-2 mb-2 ml-1 transition-colors duration-300">
              {{ section.title }}
            </h4>

            <div class="space-y-1">
              <button
                v-for="row in section.rows"
                :key="row.code"
                type="button"
                role="option"
                :aria-selected="row.selected"
                :data-currency="row.code"
                @click="choose(row.code)"
                class="w-full p-3 rounded-lg flex items-center justify-between gap-3 transition-all cursor-pointer text-left"
                :class="row.selected
                  ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20'
                  : 'hover:bg-slate-50 dark:hover:bg-white/5 border border-transparent'"
              >
                <div class="flex items-center gap-3 min-w-0">
                  <span class="w-10 shrink-0 text-sm font-bold transition-colors" :class="row.selected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'">{{ row.label }}</span>
                  <span class="min-w-[1.75rem] shrink-0 text-sm text-slate-500 dark:text-zinc-400 transition-colors">{{ row.symbol }}</span>
                  <span class="truncate text-sm font-medium transition-colors" :class="row.selected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-zinc-300'">{{ row.name }}</span>
                </div>

                <svg v-if="row.selected" class="w-5 h-5 shrink-0 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { currencyDisplayName, groupCurrencies, normalizeCurrencyCode, searchCurrencies } from '../../utils/currencyCatalog'

// Liste ve secili kod disaridan gelir (Preferences, currencyStore'dan); bu bilesen depoya
// dokunmaz. Secim `select(kucuk harfli kod)` ile bildirilir, kapatma `close` ile.
const props = defineProps({
  currencies: { type: Array, default: () => [] },
  selected: { type: String, default: '' },
})
const emit = defineEmits(['select', 'close'])

const { t, locale } = useI18n()
const query = ref('')

// Savunma: kodu gecersiz ya da haric tutulan (vef/xdr) kayit, kaynak liste ne verirse versin
// secicide GORUNMEZ; ayni kod iki kez gelirse ilki kalir (satir anahtari tekil olsun).
// Asil suzme depoda (selectableCurrencies); bu ikinci kapi.
const entries = computed(() => {
  const seen = new Set()
  return (Array.isArray(props.currencies) ? props.currencies : []).filter((entry) => {
    const code = normalizeCurrencyCode(entry?.code)
    if (!code || seen.has(code)) return false
    seen.add(code)
    return true
  })
})

const selectedCode = computed(() => normalizeCurrencyCode(props.selected))

// Ad uygulama dilinde (Intl.DisplayNames); olmazsa sunucunun Ingilizce adi. Dil degisince
// locale.value degisir ve bu fonksiyonu okuyan computed'lar yeniden hesaplanir.
const nameOf = (entry) => currencyDisplayName(entry.code, locale.value, entry.name)

const toRow = (entry) => {
  const code = normalizeCurrencyCode(entry.code)
  return {
    code,
    label: code.toUpperCase(),
    symbol: typeof entry.symbol === 'string' ? entry.symbol : '',
    name: nameOf(entry),
    selected: code === selectedCode.value,
  }
}

const searching = computed(() => query.value.trim() !== '')

// Sorgu bosken "Populer" + "Tum para birimleri"; doluyken tek, basliksiz sonuc listesi.
// Eslesen yoksa dizi bos (sablon currencyNoMatch yazar).
const sections = computed(() => {
  if (searching.value) {
    const found = searchCurrencies(entries.value, query.value, nameOf)
    return found.length ? [{ key: 'results', title: '', rows: found.map(toRow) }] : []
  }
  const { popular, rest } = groupCurrencies(entries.value)
  const out = []
  if (popular.length) out.push({ key: 'popular', title: t('settings.preferences.currencyPopular'), rows: popular.map(toRow) })
  if (rest.length) out.push({ key: 'all', title: t('settings.preferences.currencyAll'), rows: rest.map(toRow) })
  return out
})

const choose = (code) => {
  const normalized = normalizeCurrencyCode(code)
  if (normalized) emit('select', normalized)
}

const dismiss = () => emit('close')
</script>
