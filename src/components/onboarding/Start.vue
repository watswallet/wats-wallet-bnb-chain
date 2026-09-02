<template>
    <div class="min-h-screen w-full flex items-center justify-center bg-[#050505] text-white font-sans selection:bg-white/20 selection:text-white relative overflow-hidden">
        
        <div class="absolute top-10 left-0 md:top-1/4 md:left-1/4 w-64 h-64 md:w-96 md:h-96 lg:w-125 lg:h-125 bg-indigo-600/20 rounded-full blur-[80px] md:blur-[120px] animate-pulse-slow pointer-events-none"></div>
        <div class="absolute bottom-10 right-0 md:bottom-1/4 md:right-1/4 w-48 h-48 md:w-80 md:h-80 lg:w-100 lg:h-100 bg-purple-600/20 rounded-full blur-[60px] md:blur-[100px] animate-pulse-slow delay-1000 pointer-events-none"></div>

        <div class="relative w-full max-w-sm md:max-w-md p-6 md:p-8 mx-4 transition-all duration-500 transform">
            <div class="absolute inset-0 bg-white/5 backdrop-blur-sm rounded-2xl md:rounded-3xl border border-white/10"></div>
            
            <div class="relative z-20 flex flex-col items-center text-center space-y-6 md:space-y-8 py-2 md:py-4">
                <img src="/logo.png" class="w-20 md:w-24">

                <div class="space-y-2 md:space-y-3">
                    <h1 class="text-3xl md:text-4xl font-extrabold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-white via-white to-gray-400">
                        {{ $t('onboarding.start.title') }}
                    </h1>
                    <p class="text-slate-400 text-xs md:text-sm font-medium px-2" v-html="$t('onboarding.start.description')"></p>
                </div>

                <div class="w-full space-y-3 md:space-y-4 pt-2 md:pt-4">
                    <button 
                        @click="newWallet('password')"
                        class="group relative w-full flex items-center justify-center py-3.5 md:py-4 px-6 cursor-pointer text-white font-bold rounded-xl overflow-hidden transition-all duration-300 transform hover:-translate-y-1 hover:shadow-lg hover:shadow-purple-500/20 active:scale-95"
                    >
                        <div class="absolute inset-0 w-full h-full bg-linear-to-r from-indigo-600 via-purple-600 to-pink-600 opacity-90 group-hover:opacity-100 transition-opacity"></div>
                        <div class="absolute top-0 -inset-full h-full w-1/2 z-5 block transform -skew-x-12 bg-linear-to-r from-transparent to-white opacity-20 group-hover:animate-shine"></div>
                        
                        <span class="relative flex items-center gap-3 text-sm md:text-base">
                            {{ $t('onboarding.start.btn_create') }}
                            <svg class="w-4 h-4 md:w-5 md:h-5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                            </svg>
                        </span>
                    </button>

                    <button 
                        @click="newWallet('import_wallet')"
                        class="appearance-none w-full py-3.5 md:py-4 px-6 text-slate-300 font-semibold bg-[rgba(255,255,255,0.05)] border cursor-pointer border-white/10 rounded-xl hover:bg-[rgba(255,255,255,0.1)] hover:text-white hover:border-white/20 transition-all duration-300 active:scale-95 flex items-center justify-center gap-2 text-sm md:text-base"
                    >
                        <svg class="w-4 h-4 md:w-5 md:h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        {{ $t('onboarding.start.btn_import') }}
                    </button>
                </div>
                
                <div class="pt-4 md:pt-6 border-t border-white/5 w-full">
                    <p class="text-[10px] md:text-xs text-slate-500 flex items-center justify-center gap-1">
                        <svg class="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>
                        {{ $t('onboarding.start.footer_secure') }}
                    </p>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
const emit = defineEmits(['newwallet'])

function newWallet(data) {
    emit('newwallet', data)
}
</script>