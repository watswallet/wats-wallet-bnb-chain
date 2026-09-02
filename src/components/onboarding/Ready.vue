<template>
    <div class="min-h-screen w-full flex flex-col items-center justify-center bg-[#050505] text-white font-sans relative overflow-hidden px-4 md:px-6">
        
        <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 md:w-200 md:h-200 bg-linear-to-tr from-indigo-500/20 via-purple-500/20 to-cyan-500/20 rounded-full blur-[80px] md:blur-[120px] animate-pulse-slow pointer-events-none"></div>
        
        <div class="absolute inset-0 pointer-events-none overflow-hidden">
            <div v-for="n in 20" :key="n" class="particle absolute bg-white/40 rounded-full" :style="getParticleStyle(n)"></div>
        </div>

        <div class="relative flex flex-col items-center text-center space-y-8 md:space-y-12 max-w-sm md:max-w-lg">
            
            <div class="relative group cursor-default">
                <div class="absolute inset-0 rounded-full border border-white/10 border-t-purple-500/50 w-28 h-28 -ml-2 -mt-2 md:w-40 md:h-40 md:-ml-4 md:-mt-4 animate-spin-slow"></div>
                <div class="absolute inset-0 rounded-full border border-white/5 border-b-cyan-500/50 w-36 h-36 -ml-6 -mt-6 md:w-48 md:h-48 md:-ml-8 md:-mt-8 animate-reverse-spin"></div>
                
                <div class="relative w-24 h-24 md:w-32 md:h-32 rounded-full bg-linear-to-br from-white/10 to-white/5 backdrop-blur-2xl border border-white/20 shadow-[0_0_40px_rgba(139,92,246,0.3)] md:shadow-[0_0_60px_rgba(139,92,246,0.3)] flex items-center justify-center overflow-hidden">
                    <div class="absolute inset-0 bg-linear-to-tr from-indigo-500/20 to-purple-500/20 animate-pulse-slow"></div>
                    
                    <svg class="w-12 h-12 md:w-16 md:h-16 text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path class="checkmark-path" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                    </svg>
                </div>
            </div>

            <div class="space-y-3 md:space-y-4 animate-fade-in-up px-2">
                <h1 class="text-4xl md:text-6xl font-black tracking-tighter text-transparent bg-clip-text bg-linear-to-r from-white via-white to-zinc-400 drop-shadow-sm">
                    {{ $t('onboarding.ready.title') }}
                </h1>
                
                <p class="text-sm md:text-lg text-zinc-400 font-medium max-w-xs md:max-w-md mx-auto leading-relaxed">
                    {{ $t('onboarding.ready.desc_part1') }} <br class="hidden md:block"/>
                    <i18n-t keypath="onboarding.ready.desc_part2" tag="span">
                        <template #web3>
                            <span class="text-indigo-400">{{ $t('onboarding.ready.desc_web3') }}</span>
                        </template>
                    </i18n-t>
                </p>
            </div>

            <div class="w-full pt-2 md:pt-4 animate-fade-in-up delay-200">
                <button 
                    @click="start"
                    class="relative w-full py-5 md:py-6 rounded-2xl font-bold text-lg md:text-xl tracking-widest uppercase transition-all duration-500 overflow-hidden cursor-pointer group hover:scale-[1.02] hover:shadow-[0_0_60px_rgba(99,102,241,0.4)] md:hover:shadow-[0_0_80px_rgba(99,102,241,0.4)]"
                >
                    <div class="absolute inset-0 bg-linear-to-r from-indigo-600 via-purple-600 to-cyan-600 bg-size-[300%_300%] animate-aurora"></div>
                    
                    <span class="relative text-white flex items-center justify-center gap-3 md:gap-4">
                        {{ $t('onboarding.ready.btn_start') }}
                        <svg class="w-5 h-5 md:w-6 md:h-6 transition-transform group-hover:translate-x-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                    </span>

                    <div class="absolute top-0 -inset-full h-full w-1/2 z-20 block transform -skew-x-12 bg-linear-to-r from-transparent to-white opacity-30 group-hover:animate-shine" />
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
const start = async() => {
    window.close()
    chrome.action.openPopup()
}

const getParticleStyle = (n) => {
    const top = Math.random() * 100 + '%';
    const left = Math.random() * 100 + '%';
    const duration = 3 + Math.random() * 5 + 's';
    const delay = Math.random() * 2 + 's';
    const size = Math.random() * 4 + 2 + 'px';
    
    return {
        top: top,
        left: left,
        width: size,
        height: size,
        animation: `float-particle ${duration} ease-in-out infinite ${delay}, fade-particle ${duration} ease-in-out infinite ${delay}`
    };
};
</script>

<style scoped>
/* Aurora Gradient: Butonun arkasında akan renkler */
@keyframes aurora {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
}
.animate-aurora {
    animation: aurora 4s ease infinite;
}

/* Çekirdek Dönüşü */
@keyframes spin-slow {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
.animate-spin-slow {
    animation: spin-slow 12s linear infinite;
}

@keyframes reverse-spin {
    from { transform: rotate(360deg); }
    to { transform: rotate(0deg); }
}
.animate-reverse-spin {
    animation: reverse-spin 15s linear infinite;
}

/* Checkmark Çizim Animasyonu */
.checkmark-path {
  stroke-dasharray: 100;
  stroke-dashoffset: 100;
  animation: draw 1.5s cubic-bezier(0.4, 0, 0.2, 1) forwards 0.3s;
}
@keyframes draw {
  to { stroke-dashoffset: 0; }
}

/* Giriş Animasyonları */
@keyframes fade-in-up {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-up {
    animation: fade-in-up 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}

.delay-200 { animation-delay: 200ms; opacity: 0; /* Başlangıçta gizli */ animation-fill-mode: forwards; }

@keyframes shine {
    100% { left: 125%; }
}
.animate-shine {
    animation: shine 1s;
}

/* Parçacık Animasyonları */
@keyframes float-particle {
    0%, 100% { transform: translateY(0) translateX(0); }
    50% { transform: translateY(-20px) translateX(10px); }
}
@keyframes fade-particle {
    0%, 100% { opacity: 0; }
    50% { opacity: 0.6; }
}
</style>