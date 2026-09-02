<template>
  <div class="min-h-screen w-full flex flex-col items-center justify-center bg-[#050505] text-white font-sans relative overflow-hidden py-6 px-4 md:py-10 md:px-6 transition-colors duration-700"
    :class="activeTab === 'import_phrases' ? 'selection:bg-purple-500/30' : 'selection:bg-cyan-500/30'">
    
    <div class="absolute inset-0 pointer-events-none transition-opacity duration-700" :class="activeTab === 'import_phrases' ? 'opacity-100' : 'opacity-0'">
      <div class="absolute top-0 left-0 md:left-1/4 w-64 h-64 md:w-96 md:h-96 lg:w-150 lg:h-150 bg-purple-600/20 rounded-full blur-[80px] md:blur-[150px] animate-pulse-slow"></div>
    </div>

    <div class="absolute inset-0 pointer-events-none transition-opacity duration-700" :class="activeTab === 'import_private' ? 'opacity-100' : 'opacity-0'">
      <div class="absolute bottom-0 right-0 md:right-1/4 w-64 h-64 md:w-96 md:h-96 lg:w-150 lg:h-150 bg-cyan-600/20 rounded-full blur-[80px] md:blur-[150px] animate-pulse-slow"></div>
    </div>

    <button 
      @click="emit('confirmed', 'start')"
      class="appearance-none bg-transparent absolute top-6 left-4 md:top-8 md:left-8 flex items-center gap-2 text-zinc-400 hover:text-white transition-colors group z-20 cursor-pointer"
    >
      <div class="w-8 h-8 md:w-10 md:h-10 rounded-full bg-[rgba(255,255,255,0.05)] backdrop-blur-md border border-white/10 flex items-center justify-center group-hover:bg-[rgba(255,255,255,0.1)] transition-all">
        <svg class="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
      </div>
      <span class="text-xs md:text-sm font-medium">{{ $t('onboarding.importWallet.btn_back') }}</span>
    </button>

    <div class="relative w-full max-w-sm md:max-w-lg lg:max-w-xl bg-white/5 backdrop-blur-2xl border border-white/10 rounded-3xl md:rounded-[2.5rem] p-6 md:p-10 shadow-[0_0_30px_rgba(0,0,0,0.2)] md:shadow-[0_0_50px_rgba(0,0,0,0.3)] overflow-hidden transition-all duration-500">
      
      <div class="text-center mb-6 md:mb-10">
        <h1 class="text-2xl md:text-3xl font-bold tracking-tight text-white mb-2 md:mb-3 drop-shadow-md">{{ $t('onboarding.importWallet.title') }}</h1>
        <p class="text-zinc-400 text-sm md:text-base leading-relaxed">{{ $t('onboarding.importWallet.subtitle') }}</p>
      </div>

      <div class="relative w-full p-1 md:p-1.5 bg-[rgba(0,0,0,0.4)] backdrop-blur-xl rounded-xl md:rounded-2xl flex items-center mb-8 md:mb-12 border border-[rgba(255,255,255,0.05)]">
        <div class="absolute top-1 bottom-1 md:top-1.5 md:bottom-1.5 transition-all duration-500 ease-in-out rounded-lg md:rounded-xl shadow-lg"
          :class="activeTab === 'import_phrases' 
            ? 'left-1 md:left-1.5 w-[calc(50%-4px)] md:w-[calc(50%-6px)] bg-linear-to-r from-purple-600 to-indigo-600 shadow-purple-500/20' 
            : 'left-[50%] w-[calc(50%-4px)] md:w-[calc(50%-6px)] bg-linear-to-r from-cyan-600 to-blue-600 shadow-cyan-500/20'">
          
          <div class="absolute inset-0 bg-[rgba(255,255,255,0.2)] rounded-lg md:rounded-xl mix-blend-overlay"></div>
        </div>

        <button @click="activeTab = 'import_phrases'" class="appearance-none bg-transparent relative flex-1 py-2 md:py-3 text-xs md:text-sm font-bold tracking-wide transition-colors duration-300 flex items-center justify-center gap-1.5 md:gap-2 cursor-pointer"
          :class="activeTab === 'import_phrases' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'">

          <svg class="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
          {{ $t('onboarding.importWallet.tab_phrase') }}
        </button>

        <button @click="activeTab = 'import_private'" class="appearance-none bg-transparent relative flex-1 py-2 md:py-3 text-xs md:text-sm font-bold tracking-wide transition-colors duration-300 flex items-center justify-center gap-1.5 md:gap-2 cursor-pointer"
          :class="activeTab === 'import_private' ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'">

          <svg class="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
          {{ $t('onboarding.importWallet.tab_private') }}
        </button>
      </div>

      <Transition name="fade" mode="out-in">
        <div v-if="activeTab === 'import_phrases'" key="import_phrases" class="space-y-4 md:space-y-6 text-center">
          <div class="w-20 h-20 md:w-24 md:h-24 mx-auto bg-purple-500/10 rounded-2xl md:rounded-3xl border border-purple-500/20 flex items-center justify-center relative">
            <div class="absolute inset-0 bg-purple-500/20 blur-xl rounded-full animate-pulse-slow"></div>
            <svg class="w-10 h-10 md:w-12 md:h-12 text-purple-400 relative" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
          </div>

          <div>
            <h3 class="text-lg md:text-xl font-bold text-white mb-1.5 md:mb-2">{{ $t('onboarding.importWallet.phrase_title') }}</h3>
            <p class="text-zinc-400 text-xs md:text-sm leading-relaxed max-w-xs mx-auto md:max-w-none">{{ $t('onboarding.importWallet.phrase_desc') }}</p>
          </div>

          <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-300 text-[10px] md:text-xs font-bold uppercase tracking-wider">
            <svg class="w-3 h-3 md:w-3.5 md:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {{ $t('onboarding.importWallet.badge_recommended') }}
          </div>
        </div>

        <div v-else key="import_private" class="space-y-4 md:space-y-6 text-center">
          <div class="w-20 h-20 md:w-24 md:h-24 mx-auto bg-cyan-500/10 rounded-2xl md:rounded-3xl border border-cyan-500/20 flex items-center justify-center relative">
            <div class="absolute inset-0 bg-cyan-500/20 blur-xl rounded-full animate-pulse-slow"></div>
            <svg class="w-10 h-10 md:w-12 md:h-12 text-cyan-400 relative" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
          </div>

          <div>
            <h3 class="text-lg md:text-xl font-bold text-white mb-1.5 md:mb-2">{{ $t('onboarding.importWallet.private_title') }}</h3>
            <p class="text-zinc-400 text-xs md:text-sm leading-relaxed max-w-xs mx-auto md:max-w-none">{{ $t('onboarding.importWallet.private_desc') }}</p>
          </div>

          <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-[10px] md:text-xs font-bold uppercase tracking-wider">
            <svg class="w-3 h-3 md:w-3.5 md:h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            {{ $t('onboarding.importWallet.badge_advanced') }}
          </div>
        </div>
      </Transition>

      <div class="mt-8 md:mt-12">
        <button 
          @click="handleContinue"
          class="relative w-full py-4 md:py-5 rounded-2xl font-bold text-base md:text-lg tracking-wide transition-all duration-500 overflow-hidden group hover:-translate-y-1 cursor-pointer"
          :class="activeTab === 'import_phrases' 
            ? 'shadow-[0_0_40px_rgba(147,51,234,0.3)] hover:shadow-[0_0_60px_rgba(147,51,234,0.5)]' 
            : 'shadow-[0_0_40px_rgba(6,182,212,0.3)] hover:shadow-[0_0_60px_rgba(6,182,212,0.5)]'"
        >
          <div class="absolute inset-0 transition-all duration-700 bg-size-[200%_auto] animate-gradient"
            :class="activeTab === 'import_phrases' 
              ? 'bg-linear-to-r from-purple-600 via-indigo-600 to-purple-600' 
              : 'bg-linear-to-r from-cyan-600 via-blue-600 to-cyan-600'">
          </div>
          
          <span class="relative text-white flex items-center justify-center gap-2 md:gap-3">
            <Transition name="fade" mode="out-in">
              <span :key="activeTab">{{ activeTab === 'import_phrases' ? $t('onboarding.importWallet.btn_enter_phrase') : $t('onboarding.importWallet.btn_enter_private') }}</span>
            </Transition>

            <svg class="w-4 h-4 md:w-5 md:h-5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, defineEmits } from 'vue';

const emit = defineEmits(['back', 'confirmed']);
const activeTab = ref('import_phrases'); // Varsayılan olarak 'import_phrases' seçili

const handleContinue = () => {
  emit('confirmed', activeTab.value);
};
</script>

<style scoped>
/* İçerik Geçiş Animasyonu (Fade Out-In) */
.fade-enter-active,
.fade-leave-active {
  transition: all 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98); /* Hafifçe aşağıdan ve küçük gel */
}

/* Arkaplan ve Buton Gradient Animasyonu */
@keyframes gradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.animate-gradient {
  animation: gradient 3s ease infinite;
}
</style>