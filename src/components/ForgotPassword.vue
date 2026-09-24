<template>
  <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden transition-colors duration-300">
    
    <div class="absolute top-0 left-0 right-0 h-64 bg-linear-to-b from-rose-500/10 dark:from-rose-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

    <Back page="welcome"></Back>

    <div class="flex-1 flex flex-col items-center px-6 pt-4 pb-8 relative overflow-y-auto custom-scrollbar mt-10">
      
      <div class="relative mb-6">
        <div class="absolute inset-0 bg-rose-500/20 rounded-full blur-2xl animate-pulse"></div>
        <div class="w-20 h-20 rounded-full bg-white dark:bg-linear-to-br dark:from-[#131315] dark:to-black border border-slate-200 dark:border-rose-500/30 flex items-center justify-center relative shadow-md dark:shadow-2xl dark:shadow-rose-900/20 transition-colors duration-300">
          <svg class="w-8 h-8 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
        </div>
      </div>

      <h2 class="text-2xl font-bold text-slate-900 dark:text-white mb-2 tracking-tight text-center transition-colors duration-300">{{ $t('forgotPassword.title') }}</h2>

      <p class="text-sm text-slate-600 dark:text-zinc-400 text-center leading-relaxed mb-8 transition-colors duration-300">
        <span v-html="$t('forgotPassword.intro')"></span>
      </p>

      <div class="w-full bg-rose-50 dark:bg-rose-500/5 border border-rose-200 dark:border-rose-500/20 rounded-2xl p-4 mb-6 transition-colors duration-300 shadow-sm dark:shadow-none">
        <div class="flex items-start gap-3">
          <svg class="w-5 h-5 text-rose-600 dark:text-rose-500 shrink-0 mt-0.5 transition-colors duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
          <div class="flex flex-col gap-1">
            <h3 class="text-sm font-bold text-rose-700 dark:text-rose-400 transition-colors duration-300">{{ $t('forgotPassword.onlySolutionTitle') }}</h3>
            <p class="text-xs text-rose-600/80 dark:text-rose-200/70 leading-relaxed transition-colors duration-300">
              <span v-html="$t('forgotPassword.onlySolutionDesc')"></span>
            </p>
          </div>
        </div>
      </div>

      <div class="w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-4 mb-auto shadow-sm dark:shadow-none transition-colors duration-300">
        <p class="text-xs text-slate-500 dark:text-zinc-500 font-medium mb-2 uppercase tracking-wider transition-colors duration-300">{{ $t('forgotPassword.warningTitle') }}</p>
        <ul class="space-y-2">
          <li class="text-xs text-slate-600 dark:text-zinc-300 flex items-start gap-2 transition-colors duration-300">
            <span class="w-1 h-1 rounded-full bg-slate-400 dark:bg-zinc-500 mt-1.5 shrink-0 transition-colors duration-300"></span>
            {{ $t('forgotPassword.warningNoSeed') }}
          </li>
          <li class="text-xs text-slate-600 dark:text-zinc-300 flex items-start gap-2 transition-colors duration-300">
            <span class="w-1 h-1 rounded-full bg-slate-400 dark:bg-zinc-500 mt-1.5 shrink-0 transition-colors duration-300"></span>
            {{ $t('forgotPassword.warningResetClears') }}
          </li>
        </ul>
      </div>
    </div>

    <div class="p-6 border-t border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-[#09090b] relative z-20 transition-colors duration-300">
      <button 
        @click="showConfirmation = true"
        class="w-full py-3.5 rounded-xl font-bold text-sm bg-rose-600 hover:bg-rose-700 dark:hover:bg-rose-500 text-white transition-all shadow-md dark:shadow-lg shadow-rose-600/20 dark:shadow-rose-900/20 flex items-center justify-center gap-2 cursor-pointer"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
        {{ $t('forgotPassword.resetButton') }}
      </button>
    </div>

    <Transition name="fade">
      <div v-if="showConfirmation" class="absolute inset-0 z-50 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 transition-colors duration-300">
        <div class="w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-rose-500/30 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl animate-scale-in transition-colors duration-300">
          <h3 class="text-lg font-bold text-slate-900 dark:text-white text-center transition-colors duration-300">{{ $t('forgotPassword.confirmTitle') }}</h3>
          <p class="text-sm text-slate-600 dark:text-zinc-400 text-center transition-colors duration-300">{{ $t('forgotPassword.confirmDesc') }}</p>
          
          <div class="flex flex-col gap-3 mt-2">
            <button 
              @click="resetWallet" 
              class="w-full py-3 rounded-xl font-bold text-sm bg-rose-600 text-white hover:bg-rose-700 dark:hover:bg-rose-500 transition-colors cursor-pointer"
            >
              {{ $t('forgotPassword.confirmYes') }}
            </button>
            
            <button 
              @click="showConfirmation = false" 
              class="w-full py-3 rounded-xl font-bold text-sm bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 dark:hover:text-white transition-colors cursor-pointer"
            >
              {{ $t('forgotPassword.confirmCancel') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Back from './Back.vue'
import { pageStore } from '../store/pageStore'
import { closeOrNavigate } from '../utils/uiSurface'

const page = pageStore()
const showConfirmation = ref(false)

const resetWallet = async () => {
  try {
    await chrome.storage.local.clear()

    // 'LOCK_WALLET' diye bir mesaj yok; background yalnızca 'LOCK' işliyor
    // (background.js switch). Yanlış isim yüzünden ESKİ master key session'da
    // kalıyordu: sıfırlama sonrası yeni cüzdanda o bayat anahtarla kasa
    // şifrelenirse kasa hiçbir şifreyle açılamaz.
    await chrome.runtime.sendMessage({ type: 'LOCK' }).catch(() => {})

    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") })
    // Panelde kapanma yok: kullanici onboarding sekmesine gecerken panel bos
    // kalmasin diye karsilama ekranina duser.
    closeOrNavigate('welcome', { page })

  } catch (error) {
    console.error('Reset error:', error)
  }
}
</script>

<style scoped>
/* Modal Animation */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@keyframes scale-in {
  0% { transform: scale(0.95); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
.animate-scale-in { animation: scale-in 0.2s ease-out; }
</style>