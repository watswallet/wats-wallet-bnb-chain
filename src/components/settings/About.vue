<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-64 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/20 to-transparent pointer-events-none transition-colors duration-300"></div>
        
        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative z-10 border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md transition-colors duration-300">
            <Back page="settings" class="hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors absolute left-5 text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.about.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-8 pb-6 flex flex-col gap-8 relative z-10">
            
            <div class="flex flex-col items-center text-center gap-4">
                <div class="relative group cursor-default">
                    <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-2xl blur-xl group-hover:blur-2xl transition-all duration-500"></div>
                    
                    <div class="relative w-20 h-20 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-2xl flex items-center justify-center shadow-lg dark:shadow-2xl transition-colors duration-300">
                        <svg class="w-10 h-10 text-indigo-600 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    </div>
                </div>

                <div class="space-y-2">
                    <h2 class="text-xl font-bold text-slate-900 dark:text-white tracking-tight transition-colors duration-300">{{ $t('settings.about.app_name') }}</h2>
                    
                    <div class="flex items-center justify-center gap-2">
                        <span class="text-[10px] font-mono font-bold text-slate-500 dark:text-zinc-500 bg-slate-100 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 px-2 py-0.5 rounded-md transition-colors duration-300">
                            {{ $t('settings.about.version', { v: pkg.version }) }}
                        </span>
                        
                        <div class="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 shadow-sm dark:shadow-none transition-colors duration-300">
                            <span class="relative flex h-1.5 w-1.5">
                                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                            </span>
                            <span class="text-[9px] font-bold text-emerald-600 dark:text-emerald-500 uppercase tracking-wider">{{ $t('settings.about.status_uptodate') }}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="flex flex-col gap-3">
                <p class="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider px-2 transition-colors duration-300">{{ $t('settings.about.section_legal') }}</p>
                
                <div class="bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-2xl overflow-hidden divide-y divide-slate-100 dark:divide-white/5 shadow-sm dark:shadow-none transition-colors duration-300">
                    <a 
                        v-for="(link, index) in links" 
                        :key="index"
                        :href="link.url"
                        target="_blank"
                        class="flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors group cursor-pointer text-decoration-none"
                    >
                        <div class="flex items-center gap-3">
                            <div class="p-2 rounded-lg bg-slate-100 dark:bg-zinc-800/50 text-slate-500 dark:text-zinc-400 group-hover:bg-indigo-100 dark:group-hover:bg-indigo-500/20 group-hover:text-indigo-600 dark:group-hover:text-white transition-colors duration-300" v-html="link.icon"></div>
                            
                            <span class="text-sm font-medium text-slate-700 dark:text-zinc-200 group-hover:text-slate-900 dark:group-hover:text-white transition-colors duration-300">{{ $t(link.labelKey) }}</span>
                        </div>
                        <svg class="w-4 h-4 text-slate-400 dark:text-zinc-600 group-hover:text-indigo-500 dark:group-hover:text-zinc-400 group-hover:translate-x-0.5 transition-all duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                        </svg>
                    </a>
                </div>
            </div>

            <div class="mt-auto flex flex-col items-center gap-6 pb-2">
                <div class="flex items-center gap-4">
                    <a href="https://x.com/watswallet" target="_blank" class="w-10 h-10 rounded-full bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 flex items-center justify-center text-slate-600 dark:text-zinc-400 hover:text-indigo-600 dark:hover:text-white hover:border-indigo-200 dark:hover:border-zinc-700 hover:bg-indigo-50 dark:hover:bg-zinc-800 transition-all hover:scale-110 shadow-sm dark:shadow-none cursor-pointer">
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                    </a>
                </div>

                <p class="text-[10px] font-medium text-slate-400 dark:text-zinc-600 transition-colors duration-300">{{ $t('settings.about.copyright') }}</p>
            </div>
        </div>
    </div>
</template>

<script setup>
import Back from '../Back.vue'
import pkg from '../../../package.json'

const links = [
    { 
        labelKey: 'settings.about.link_website', 
        url: 'https://watswallet.com', 
        icon: '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>' 
    },
    { 
        labelKey: 'settings.about.link_privacy', 
        url: 'https://alltoscan.github.io/extension-privacy-policy/extension-privacy-policy.txt', 
        icon: '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>' 
    },
    { 
        labelKey: 'settings.about.link_terms', 
        url: 'https://alltoscan.github.io/extension-terms-of-service/extension-terms-of-service.txt', 
        icon: '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>' 
    }
]
</script>