<template>
    <div class="min-h-screen w-full flex flex-col items-center justify-center bg-[#050505] text-white font-sans selection:bg-pink-500/30 selection:text-white relative overflow-hidden px-4 md:px-6">
        
        <div class="absolute top-0 md:top-1/3 left-1/2 -translate-x-1/2 w-64 h-64 md:w-150 md:h-150 bg-indigo-500/10 rounded-full blur-[80px] md:blur-[120px] animate-pulse-slow pointer-events-none"></div>
        <div class="absolute bottom-0 right-0 w-48 h-48 md:w-125 md:h-125 bg-pink-600/10 rounded-full blur-[60px] md:blur-[100px] animate-pulse-slow delay-1000 pointer-events-none"></div>

        <div class="relative w-full max-w-sm md:max-w-md flex flex-col items-center">
            
            <div class="relative group mb-6 md:mb-10">
                <div class="absolute inset-0 rounded-full blur-xl md:blur-2xl opacity-50 transition-all duration-700" :style="{ background: avatarGlow }"></div>
                
                <div class="relative w-24 h-24 md:w-32 md:h-32 rounded-full border-4 border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] overflow-hidden transition-all duration-500">
                    <img :src="`https://api.dicebear.com/7.x/identicon/svg?seed=${user.address}`" class="w-full h-full object-cover" />
                    <div class="absolute inset-0 bg-linear-to-tr from-white/20 to-transparent opacity-50"></div>
                </div>
            </div>

            <div class="text-center mb-6 md:mb-8 space-y-2">
                <h1 class="text-2xl md:text-3xl font-bold text-white tracking-tight">{{ $t('onboarding.createUsername.title') }}</h1>
                <p class="text-zinc-400 text-sm md:text-base font-medium">{{ $t('onboarding.createUsername.desc') }}</p>
            </div>

            <div class="w-full space-y-4 md:space-y-6">
                
                <div class="relative">
                    <input 
                        v-model="username" 
                        @input="handleInput"
                        type="text" 
                        class="peer w-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl py-4 md:py-5 pl-5 md:pl-6 pr-20 md:pr-24 text-lg md:text-xl font-bold text-white placeholder-zinc-600 focus:outline-none focus:bg-white/10 focus:border-white/20 focus:ring-4 focus:ring-white/5 transition-all duration-300 shadow-[0_4px_30px_rgba(0,0,0,0.2)]"
                        :placeholder="$t('onboarding.createUsername.placeholder')"
                        maxlength="15"
                    />
                </div>

                <div class="h-5 md:h-6 flex items-center justify-center text-xs md:text-sm font-medium transition-all duration-300">
                    <div v-if="isChecking" class="flex items-center gap-2 text-zinc-400">
                        <svg class="animate-spin h-3.5 w-3.5 md:h-4 md:w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        {{ $t('onboarding.createUsername.status_checking') }}
                    </div>
                    
                    <div v-else-if="isValid && isAvailable && username" class="flex items-center gap-2 text-emerald-400 animate-fade-in-up">
                        <div class="w-3.5 h-3.5 md:w-4 md:h-4 rounded-full bg-emerald-500/20 flex items-center justify-center border border-emerald-500/50">
                            <svg class="w-2 h-2 md:w-2.5 md:h-2.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
                        </div>
                        {{ $t('onboarding.createUsername.status_available') }}
                    </div>

                    <div v-else-if="username && (!isValid || !isAvailable)" class="flex items-center gap-2 text-red-400 animate-fade-in-up">
                        <svg class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        {{ errorMessage }}
                    </div>
                </div>

                <div class="pt-2 md:pt-4">
                    <button 
                        @click="confirm"
                        :disabled="!canProceed"
                        class="relative w-full py-4 md:py-5 rounded-2xl font-bold text-base md:text-lg tracking-wide transition-all duration-500 overflow-hidden group"
                        :class="canProceed 
                            ? 'cursor-pointer hover:-translate-y-1 shadow-[0_0_40px_rgba(236,72,153,0.3)] hover:shadow-[0_0_60px_rgba(236,72,153,0.3)]' 
                            : 'cursor-not-allowed opacity-50 grayscale'"
                    >
                        <div class="absolute inset-0 transition-all duration-500"
                            :class="canProceed ? 'bg-linear-to-r from-pink-600 via-purple-600 to-indigo-600 bg-size-[200%_auto] animate-gradient' : 'bg-white/10 backdrop-blur-md'">
                        </div>
                        
                        <span class="relative text-white flex items-center justify-center gap-2">{{ $t('onboarding.createUsername.btn_complete') }}</span>

                        <div v-if="canProceed" class="absolute top-0 -inset-full h-full w-1/2 z-20 block transform -skew-x-12 bg-linear-to-r from-transparent to-white opacity-20 group-hover:animate-shine" />
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import axios from 'axios'
import { networkStore } from '../../store/network'
import { userStore } from '../../store/user'
import { configStore } from '../../store/config'
import { generateUsername } from '../../utils/usernameSuggest'

const { t } = useI18n()

const emit = defineEmits(['confirmed'])

const network = networkStore()
const user = userStore()
const config = configStore()

const username = ref('');
const isChecking = ref(false);
const isAvailable = ref(true); // Mock availability
const isValid = ref(false);
const errorMessage = ref('');

let timeout = null;

// Arkadaki Glow rengi de avatara uysun
const avatarGlow = computed(() => {
    if (!username.value) return 'none';
    const str = username.value;
    let hash = str.charCodeAt(0) + str.length;
    const hue = Math.abs(hash * 10 % 360);
    return `radial-gradient(circle, hsla(${hue}, 80%, 60%, 0.4) 0%, transparent 70%)`;
});

onMounted(() => {
    username.value = generateUsername({ address: user.address });
    handleInput();
})

const handleInput = () => {
    username.value = username.value.replace(/[^a-zA-Z0-9]/g, '');
    
    isValid.value = false;
    isAvailable.value = false;
    errorMessage.value = '';
    
    if (username.value.length < 3) {
        errorMessage.value = t('onboarding.createUsername.error_min_length');
        return;
    }

    isChecking.value = true;
    clearTimeout(timeout);
    
    timeout = setTimeout(async() => {
        isChecking.value = false;

        try {
            // Kaydedilecek DEĞERİN kendisi sorulur. Önce toLowerCase() gönderiliyordu:
            // kontrol edilen ad ile kaydedilen ad farklı olabiliyordu.
            const response = await axios.post(config.api + '/checkUsername', {
                username: username.value
            })

            // Sunucu HER İKİ durumda da 200 döner; müsaitlik GÖVDEDEKİ `found`
            // alanında. Yalnızca status'e bakıldığı için alınmış adlar "müsait"
            // görünüyor, yeşil onay çıkıyor ve kayıt sessizce başarısız oluyordu.
            if (response.data?.found) {
                isAvailable.value = false;
                isValid.value = false;
                errorMessage.value = t('onboarding.createUsername.error_taken');
            } else {
                isAvailable.value = true;
                isValid.value = true;
            }
        } catch (error) {
            isAvailable.value = false;
            isValid.value = false;
            errorMessage.value = t('onboarding.createUsername.error_server');
        }

    }, 800);
};

const canProceed = computed(() => {
    return username.value.length >= 3 && isValid.value && isAvailable.value && !isChecking.value;
});

const confirm = async () => {
    try {
        if(!canProceed.value) return

        const { data } = await axios.post(config.api + '/profile', {
            username: username.value,
            addresses: {
                [`eip155:${network.currentNetwork.chainId}`]: user.address
            }
        })

        if(!data?.user) throw new Error('profil olusturulamadi')

        await chrome.storage.local.set({ user: data.user })

        emit('confirmed', 'ready')
    } catch (error) {
        console.error('confirm error', error.message)

        // Eskiden yalnızca console'a yazılıyordu: kayıt başarısız olduğunda düğme
        // hiçbir şey yapmıyormuş gibi görünüyor ve onboarding tamamlanamıyordu.
        // Ad araya girip alındıysa (unique index) kullanıcı bunu görmeli.
        if (error.response?.status === 400 || error.response?.status === 409) {
            isAvailable.value = false
            isValid.value = false
            errorMessage.value = t('onboarding.createUsername.error_taken')
            return
        }

        errorMessage.value = t('onboarding.createUsername.error_server')
    }
}
</script>

<style scoped>
@keyframes spin-slow {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
.animate-spin-slow {
    animation: spin-slow 10s linear infinite;
}

@keyframes fade-in-up {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in-up {
    animation: fade-in-up 0.3s ease-out;
}

/* Diğer animasyonlar (gradient, shine, pulse) önceki dosyalardan */
@keyframes gradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.animate-gradient {
  animation: gradient 3s ease infinite;
}

@keyframes shine {
    100% { left: 125%; }
}
.animate-shine {
    animation: shine 0.75s;
}
</style>