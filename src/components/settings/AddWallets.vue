<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="home" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.addWallets.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-6 flex flex-col gap-4 relative z-10">
            
            <button 
                @click="page.currentPage = 'settings_create_account'"
                class="group w-full p-4 bg-white dark:bg-[#131315] hover:bg-slate-50 dark:hover:bg-[#18181b] border border-slate-200 dark:border-white/5 hover:border-indigo-400 dark:hover:border-indigo-500/30 rounded-2xl flex items-center gap-4 transition-all duration-300 shadow-sm dark:shadow-none hover:shadow-indigo-500/10 cursor-pointer"
            >
                <div class="w-12 h-12 rounded-xl bg-linear-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md dark:shadow-inner shrink-0 group-hover:scale-105 transition-transform duration-300">
                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                </div>
                
                <div class="flex flex-col items-start text-left">
                    <span class="text-sm font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors duration-300">{{ $t('settings.addWallets.create_title') }}</span>
                    <span class="text-[11px] text-slate-500 dark:text-zinc-500 font-medium leading-tight mt-0.5">{{ $t('settings.addWallets.create_desc') }}</span>
                </div>
            </button>

            <div class="w-full h-px bg-slate-200 dark:bg-white/5 my-2 transition-colors duration-300"></div>

            <button 
                @click="redirect"
                class="group w-full p-4 bg-white dark:bg-[#131315] hover:bg-slate-50 dark:hover:bg-[#18181b] border border-slate-200 dark:border-white/5 hover:border-emerald-400 dark:hover:border-emerald-500/30 rounded-2xl flex items-center gap-4 transition-all duration-300 shadow-sm dark:shadow-none hover:shadow-emerald-500/10 cursor-pointer"
            >
                <div class="w-12 h-12 rounded-xl bg-linear-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-md dark:shadow-inner shrink-0 group-hover:scale-105 transition-transform duration-300">
                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                </div>
                
                <div class="flex flex-col items-start text-left">
                    <span class="text-sm font-bold text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-300 transition-colors duration-300">{{ $t('settings.addWallets.import_phrase_title') }}</span>
                    <span class="text-[11px] text-slate-500 dark:text-zinc-500 font-medium leading-tight mt-0.5">{{ $t('settings.addWallets.import_phrase_desc') }}</span>
                </div>
                
                <svg class="w-4 h-4 text-slate-300 dark:text-zinc-600 group-hover:text-emerald-500 ml-auto transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            </button>

            <button 
                @click="redirect"
                class="group w-full p-4 bg-white dark:bg-[#131315] hover:bg-slate-50 dark:hover:bg-[#18181b] border border-slate-200 dark:border-white/5 hover:border-amber-400 dark:hover:border-amber-500/30 rounded-2xl flex items-center gap-4 transition-all duration-300 shadow-sm dark:shadow-none hover:shadow-amber-500/10 cursor-pointer"
            >
                <div class="w-12 h-12 rounded-xl bg-linear-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white shadow-md dark:shadow-inner shrink-0 group-hover:scale-105 transition-transform duration-300">
                    <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
                </div>
                
                <div class="flex flex-col items-start text-left">
                    <span class="text-sm font-bold text-slate-900 dark:text-white group-hover:text-amber-600 dark:group-hover:text-amber-300 transition-colors duration-300">{{ $t('settings.addWallets.import_pk_title') }}</span>
                    <span class="text-[11px] text-slate-500 dark:text-zinc-500 font-medium leading-tight mt-0.5">{{ $t('settings.addWallets.import_pk_desc') }}</span>
                </div>

                <svg class="w-4 h-4 text-slate-300 dark:text-zinc-600 group-hover:text-amber-500 ml-auto transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
            </button>

            <div class="mt-4 px-2 flex items-start gap-2 transition-opacity duration-300 opacity-60 dark:opacity-50">
                <svg class="w-4 h-4 text-slate-400 dark:text-zinc-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p class="text-[10px] text-slate-500 dark:text-zinc-400 font-medium leading-relaxed transition-colors duration-300">{{ $t('settings.addWallets.security_note') }}</p>
            </div>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#09090b] relative transition-colors duration-300">
            <button 
                @click="page.currentPage = 'home'"
                class="w-full py-3.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-zinc-800 text-slate-600 dark:text-zinc-300 hover:bg-slate-200 dark:hover:bg-zinc-700 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer"
            >
                {{ $t('settings.addWallets.btn_close') }}
            </button>
        </div>
    </div>
</template>

<script setup>
import { pageStore } from '../../store/pageStore'
import Back from '../Back.vue'

const page = pageStore()

const redirect = async() => {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") })
    window.close()
}
</script>