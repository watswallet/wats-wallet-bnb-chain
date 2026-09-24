<template>
    <div class="w-full h-full max-w-[420px] mx-auto flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-rose-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-48 bg-linear-to-b from-rose-500/5 dark:from-rose-900/20 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings_security" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.security.phrasesDisclaimer.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 py-6 flex flex-col gap-6 relative z-10">
            <div class="flex justify-center py-2">
                <div class="relative">
                    <div class="absolute inset-0 bg-rose-500/20 rounded-full blur-xl animate-pulse"></div>
                    <div class="relative w-20 h-20 bg-white dark:bg-linear-to-br dark:from-zinc-800 dark:to-black rounded-full border-2 border-rose-200 dark:border-rose-500/30 flex items-center justify-center shadow-lg dark:shadow-2xl transition-colors duration-300">
                        <svg class="w-9 h-9 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    </div>
                </div>
            </div>

            <div class="text-center space-y-2">
                <h2 class="text-xl font-bold text-slate-900 dark:text-white tracking-tight transition-colors duration-300">{{ $t('settings.security.phrasesDisclaimer.subtitle') }}</h2>
                
                <i18n-t keypath="settings.security.phrasesDisclaimer.desc" tag="p" class="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed transition-colors duration-300">
                    <template #key>
                        <span class="text-rose-600 dark:text-rose-400 font-bold">{{ $t('settings.security.phrasesDisclaimer.desc_key') }}</span>
                    </template>
                </i18n-t>
            </div>

            <div class="bg-rose-50 dark:bg-rose-500/5 border border-rose-100 dark:border-rose-500/20 rounded-2xl p-4 flex flex-col gap-4 shadow-sm dark:shadow-none transition-colors duration-300">
                <div class="flex items-start gap-3">
                    <div class="p-1 rounded bg-rose-100 dark:bg-rose-500/10 shrink-0 mt-0.5 transition-colors duration-300">
                        <svg class="w-4 h-4 text-rose-600 dark:text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                    </div>

                    <i18n-t keypath="settings.security.phrasesDisclaimer.warning_theft" tag="p" class="text-xs text-rose-700 dark:text-rose-100/80 leading-relaxed transition-colors duration-300">
                        <template #action>
                            <b class="text-rose-800 dark:text-rose-400 font-bold">{{ $t('settings.security.phrasesDisclaimer.warning_theft_action') }}</b>
                        </template>
                    </i18n-t>
                </div>
                
                <div class="w-full h-px bg-rose-200 dark:bg-rose-500/10 transition-colors duration-300"></div>
                
                <div class="flex items-start gap-3">
                    <div class="p-1 rounded bg-rose-100 dark:bg-rose-500/10 shrink-0 mt-0.5 transition-colors duration-300">
                        <svg class="w-4 h-4 text-rose-600 dark:text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                    </div>

                    <p class="text-xs text-rose-700 dark:text-rose-100/80 leading-relaxed transition-colors duration-300">{{ $t('settings.security.phrasesDisclaimer.warning_share') }}</p>
                </div>
            </div>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#09090b] relative z-20 flex flex-col gap-4 transition-colors duration-300">
            <label class="flex items-start gap-3 cursor-pointer group select-none">
                <div class="relative flex items-center justify-center min-w-5 h-5 mt-0.5 border-2 rounded transition-all duration-300"
                    :class="checked ? 'bg-rose-600 border-rose-600' : 'border-slate-300 dark:border-zinc-600 group-hover:border-rose-400 dark:group-hover:border-zinc-400 bg-transparent'">
                    <input v-model="checked" type="checkbox" class="absolute opacity-0 w-full h-full cursor-pointer">
                    <svg v-if="checked" class="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
                </div>

                <i18n-t keypath="settings.security.phrasesDisclaimer.checkbox" tag="p" class="text-xs text-slate-500 dark:text-zinc-400 leading-tight group-hover:text-slate-700 dark:group-hover:text-zinc-300 transition-colors">
                    <template #risk>
                        <b class="text-slate-900 dark:text-white font-bold">{{ $t('settings.security.phrasesDisclaimer.checkbox_risk') }}</b>
                    </template>
                </i18n-t>
            </label>

            <button 
                @click="page.currentPage = 'settings_security_show_phrase'"
                class="w-full py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                :class="checked 
                    ? 'bg-rose-600 text-white hover:bg-rose-700 dark:hover:bg-rose-500 hover:scale-[1.01] shadow-rose-600/10 dark:shadow-rose-900/20' 
                    : 'bg-slate-100 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed border border-slate-200 dark:border-white/5'"
                :disabled="!checked"
            >
                <svg v-if="checked" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                <span v-else>{{ $t('settings.security.phrasesDisclaimer.btn_required') }}</span>
                <span v-if="checked">{{ $t('settings.security.phrasesDisclaimer.btn_continue') }}</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue'
import { pageStore } from '../../../store/pageStore'
import Back from '../../Back.vue'

const page = pageStore()
const checked = ref(false)
</script>