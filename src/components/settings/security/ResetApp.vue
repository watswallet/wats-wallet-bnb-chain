<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-rose-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-64 bg-linear-to-b from-rose-500/5 dark:from-rose-900/30 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings_security" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.security.resetApp.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-6 flex flex-col gap-6 relative z-10">
            <div class="flex justify-center py-2">
                <div class="relative">
                    <div class="absolute inset-0 bg-rose-500/20 rounded-full blur-2xl animate-pulse"></div>
                    <div class="relative w-24 h-24 bg-white dark:bg-linear-to-br dark:from-zinc-900 dark:to-black rounded-full border-2 border-rose-200 dark:border-rose-500 flex items-center justify-center shadow-lg dark:shadow-[0_0_30px_rgba(225,29,72,0.3)] transition-colors duration-300">
                        <svg class="w-10 h-10 text-rose-600 dark:text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </div>
                </div>
            </div>

            <div class="text-center space-y-2">
                <h2 class="text-2xl font-bold text-slate-900 dark:text-white tracking-tight transition-colors duration-300">{{ $t('settings.security.resetApp.subtitle') }}</h2>
                
                <i18n-t keypath="settings.security.resetApp.desc" tag="p" class="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed transition-colors duration-300">
                    <template #highlight>
                        <span class="text-rose-600 dark:text-rose-500 font-bold">{{ $t('settings.security.resetApp.desc_highlight') }}</span>
                    </template>
                </i18n-t>
            </div>

            <div class="bg-rose-50 dark:bg-rose-500/5 border border-rose-100 dark:border-rose-500/20 rounded-2xl p-4 flex flex-col gap-3 shadow-sm dark:shadow-none transition-colors duration-300">
                <div class="flex items-center gap-3">
                    <svg class="w-5 h-5 text-rose-600 dark:text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span class="text-sm font-medium text-rose-800 dark:text-rose-100/90 transition-colors duration-300">{{ $t('settings.security.resetApp.item_keys') }}</span>
                </div>

                <div class="w-full h-px bg-rose-200 dark:bg-rose-500/10 transition-colors duration-300"></div>
                
                <div class="flex items-center gap-3">
                    <svg class="w-5 h-5 text-rose-600 dark:text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span class="text-sm font-medium text-rose-800 dark:text-rose-100/90 transition-colors duration-300">{{ $t('settings.security.resetApp.item_history') }}</span>
                </div>
            </div>

            <div class="flex flex-col gap-2 pt-2">
                <i18n-t keypath="settings.security.resetApp.input_label" tag="label" class="text-xs text-slate-500 dark:text-zinc-400 text-center transition-colors duration-300">
                    <template #keyword>
                        <span class="text-slate-900 dark:text-white font-bold select-none">{{ $t('settings.security.resetApp.confirm_keyword') }}</span>
                    </template>
                </i18n-t>

                <input 
                    v-model="confirmationText" 
                    type="text" 
                    :placeholder="$t('settings.security.resetApp.confirm_keyword')" 
                    class="w-full bg-white dark:bg-[#131315] border border-rose-300 dark:border-rose-500/30 rounded-xl py-3.5 text-center text-rose-600 dark:text-rose-500 font-bold tracking-widest placeholder-rose-200 dark:placeholder-rose-900/50 focus:outline-none focus:border-rose-500 focus:bg-rose-50 dark:focus:bg-rose-500/10 transition-all duration-300 uppercase shadow-sm dark:shadow-none"
                    maxlength="10"
                >
            </div>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#09090b] relative transition-colors duration-300">
            <button 
                @click="reset"
                class="w-full py-4 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg"
                :class="isConfirmed 
                    ? 'bg-rose-600 text-white hover:bg-rose-700 hover:scale-[1.01] shadow-rose-200 dark:shadow-rose-900/30 cursor-pointer' 
                    : 'bg-slate-100 dark:bg-zinc-800 text-slate-400 dark:text-zinc-600 cursor-not-allowed border border-slate-200 dark:border-white/5'"
                :disabled="!isConfirmed"
            >
                <svg v-if="isConfirmed" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                <svg v-else class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                
                {{ isConfirmed ? $t('settings.security.resetApp.btn_delete') : $t('settings.security.resetApp.btn_waiting') }}
            </button>
        </div>
    </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import Back from '../../Back.vue'
import { useI18n } from 'vue-i18n'
import { pageStore } from '../../../store/pageStore'
import { closeOrNavigate } from '../../../utils/uiSurface'

const { t } = useI18n()
const page = pageStore()

const confirmationText = ref('')

const requiredKeyword = computed(() => t('settings.security.resetApp.confirm_keyword'))

// Büyük/küçük harf duyarlılığını kaldırdık ama input zaten uppercase class'a sahip
const isConfirmed = computed(() => {
    return confirmationText.value.toUpperCase() === requiredKeyword.value
})

const reset = async() => {
    if (!isConfirmed.value) return

    try {
        await chrome.storage.local.clear()
        // İsteğe bağlı: Kullanıcıya silindiğine dair son bir mesaj veya animasyon gösterilebilir.
        // Ancak genellikle direkt kapanması veya reload olması beklenir.
        
        // Extension'ı yeniden başlatmak veya bu ekrandan çıkmak:
        // panelde kapanma yok, kullanici sifirlanmis cuzdanin ESKI ekraninda
        // asili kalmasin diye karsilama ekranina duser.
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.reload) chrome.runtime.reload()
        else closeOrNavigate('welcome', { page })

    } catch (e) {
        console.error("Reset failed", e)
    }
}
</script>