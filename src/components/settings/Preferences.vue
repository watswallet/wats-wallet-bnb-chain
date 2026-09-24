<template>
  <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden transition-colors duration-500 ease-in-out">
    
    <div class="flex items-center justify-center gap-4 p-4 border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-[#09090b]/80 backdrop-blur-md top-0 z-10 transition-colors duration-500 ease-in-out">
      <Back page="settings" class="hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
      <h1 class="text-lg font-bold tracking-tight">{{ $t('settings.preferences.title') }}</h1>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
      <section>
        <h3 class="text-xs font-bold text-slate-500 dark:text-zinc-500 uppercase tracking-wider mb-3 ml-1 transition-colors duration-500">
          {{ $t('settings.preferences.general') }}
        </h3>
        
        <div class="bg-white dark:bg-[#18181b] border border-slate-200 dark:border-white/5 rounded-xl overflow-hidden shadow-sm dark:shadow-none transition-colors duration-500">
          
          <button @click="showLangModal = true" class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors duration-300 group text-left cursor-pointer">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400 transition-colors duration-500">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" /></svg>
              </div>

              <div>
                <div class="text-sm font-medium text-slate-900 dark:text-zinc-200 transition-colors duration-500">{{ $t('settings.preferences.language') }}</div>
                <div class="text-xs text-slate-500 dark:text-zinc-500 group-hover:text-slate-700 dark:group-hover:text-zinc-400 transition-colors duration-300">{{ currentLangLabel }}</div>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-slate-600 dark:group-hover:text-zinc-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" /></svg>
            </div>
          </button>

          <div class="h-px bg-slate-100 dark:bg-white/5 mx-4 transition-colors duration-500"></div>

          <button @click="handleThemeToggle" class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors duration-300 group text-left cursor-pointer">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full flex items-center justify-center transition-colors duration-500 ease-in-out"
                   :class="isDark ? 'bg-indigo-500/10 text-indigo-400' : 'bg-amber-100 text-amber-600'">
                <svg v-if="!isDark" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                <svg v-else class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
              </div>

              <div>
                <div class="text-sm font-medium text-slate-900 dark:text-zinc-200 transition-colors duration-500">{{ $t('settings.preferences.theme') }}</div>
                <div class="text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-500">{{ isDark ? $t('settings.preferences.themeDark') : $t('settings.preferences.themeLight') }}</div>
              </div>
            </div>

            <div 
              class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-500 ease-in-out focus:outline-none"
              :class="isDark ? 'bg-indigo-500' : 'bg-slate-300'"
            >
              <span 
                class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-500 ease-in-out"
                :class="isDark ? 'translate-x-5' : 'translate-x-0'"
              ></span>
            </div>
          </button>

          <div class="h-px bg-slate-100 dark:bg-white/5 mx-4 transition-colors duration-500"></div>

          <button @click="arayuzModunuDegistir" class="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors duration-300 group text-left cursor-pointer">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400 transition-colors duration-500">
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" /></svg>
              </div>

              <div>
                <div class="text-sm font-medium text-slate-900 dark:text-zinc-200 transition-colors duration-500">{{ $t('settings.preferences.uiMode') }}</div>
                <div class="text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-500">
                  {{ panelModu ? $t('settings.preferences.uiModePanel') : $t('settings.preferences.uiModePopup') }}
                </div>
              </div>
            </div>

            <div
              class="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-500 ease-in-out focus:outline-none"
              :class="panelModu ? 'bg-emerald-500' : 'bg-slate-300'"
            >
              <span
                class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-500 ease-in-out"
                :class="panelModu ? 'translate-x-5' : 'translate-x-0'"
              ></span>
            </div>
          </button>

        </div>
      </section>
    </div>

    <Transition name="slide-up">
      <div v-if="showLangModal" class="absolute inset-0 z-50 flex items-end justify-center">
        <div @click="showLangModal = false" class="absolute inset-0 bg-slate-900/60 dark:bg-black/60 backdrop-blur-sm transition-colors duration-300"></div>
        
        <div class="w-full bg-white dark:bg-[#18181b] rounded-t-2xl border-t border-slate-200 dark:border-white/10 p-2 pb-6 relative max-h-[70%] flex flex-col shadow-2xl transition-colors duration-300">
          
          <div class="w-full flex justify-center pt-2 pb-4">
            <div class="w-10 h-1 rounded-full bg-slate-300 dark:bg-zinc-700 transition-colors duration-300"></div>
          </div>

          <h3 class="text-center text-sm font-bold text-slate-900 dark:text-white mb-4 transition-colors duration-300">
            {{ $t('settings.preferences.selectLanguage') }}
          </h3>

          <div class="flex-1 overflow-y-auto custom-scrollbar px-2 space-y-1">
            <button 
              v-for="lang in languages" 
              :key="lang.code"
              @click="setLanguage(lang)"
              class="w-full p-3 rounded-lg flex items-center justify-between transition-all cursor-pointer"
              :class="locale === lang.code 
                ? 'bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20' 
                : 'hover:bg-slate-50 dark:hover:bg-white/5 border border-transparent'"
            >
              <div class="flex items-center gap-3">
                <span class="text-lg">{{ lang.flag }}</span>
                <span class="text-sm font-medium transition-colors" :class="locale === lang.code ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-700 dark:text-zinc-300'">
                  {{ lang.name }}
                </span>
              </div>
              
              <svg v-if="locale === lang.code" class="w-5 h-5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDark, useToggle } from '@vueuse/core'
import Back from '../Back.vue'
import { readUiMode, UI_MODE_PANEL, UI_MODE_POPUP, panelSupported } from '../../utils/uiMode'
import { isPanel } from '../../utils/uiSurface'

const { locale } = useI18n()
const showLangModal = ref(false)

// Kalici tercih. Bildirim karti BIR KEZ gosterilir; bunu kacirilan kullanici
// ayari buradan bulur.
const panelModu = ref(true)

onMounted(async () => {
  panelModu.value = (await readUiMode()) === UI_MODE_PANEL
})

const arayuzModunuDegistir = async () => {
  // Tarayici paneli desteklemiyorsa (Chrome 115 oncesi yol) anahtar anlamsiz.
  if (!panelSupported()) return

  const yeni = panelModu.value ? UI_MODE_POPUP : UI_MODE_PANEL
  try {
    const yanit = await chrome.runtime.sendMessage({ type: 'SET_UI_MODE', mode: yeni })
    if (!yanit?.success) {
      // BASARISIZ gecis: anahtar GERCEK durumda kalir (dokunulmaz) -- aksi
      // halde ekran GERCEKTE gitmedigi bir yuzeyi gosteriyormus gibi YALAN
      // soylerdi.
      console.error('Arayuz modu degistirilemedi:', yanit?.error)
      return
    }
    panelModu.value = yeni === UI_MODE_PANEL
    // Panelden popup'a gecildiyse ACIK panel kendini kapatir. Yayin YAPILMAZ:
    // ayni kod tum pencerelerdeki panelleri kapatirdi.
    if (yeni === UI_MODE_POPUP && isPanel()) window.close()
  } catch (e) {
    console.error('Arayuz modu degistirilemedi:', e)
  }
}

const languages = [
  { code: 'tr', name: 'Türkçe', flag: '🇹🇷' },
  { code: 'en', name: 'English', flag: '🇺🇸' },
]

const currentLangLabel = computed(() => {
  return languages.find(l => l.code === locale.value)?.name || 'English'
})

const setLanguage = async (lang) => {
  locale.value = lang.code
  await chrome.storage.local.set({ language: lang.code })
  setTimeout(() => { showLangModal.value = false }, 200)
}

const isDark = useDark({
  selector: 'html',
  attribute: 'class',
  valueDark: 'dark',
  valueLight: 'light',
})
const toggleDark = useToggle(isDark)

const handleThemeToggle = async () => {
  const newTheme = !isDark.value ? 'dark' : 'light'
  
  if (document.startViewTransition) {
    document.startViewTransition(() => {
      toggleDark()
    })
  } else {
    toggleDark()
  }

  await chrome.storage.local.set({ userTheme: newTheme })
}

onMounted(async () => {
  const { language } = await chrome.storage.local.get('language')
  if (language) locale.value = language

  const { userTheme } = await chrome.storage.local.get('userTheme')
  
  if (userTheme) {
    isDark.value = (userTheme === 'dark')
  } else {
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    isDark.value = systemPrefersDark
  }
})
</script>

<style scoped>
.slide-up-enter-active, .slide-up-leave-active { transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
.slide-up-enter-from, .slide-up-leave-to { transform: translateY(100%); opacity: 0; }

::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 0.5s;
}
</style>