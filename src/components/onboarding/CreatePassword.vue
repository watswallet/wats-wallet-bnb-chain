<template>
    <div class="min-h-screen w-full flex flex-col items-center justify-center bg-[#050505] text-white font-sans selection:bg-indigo-500/30 selection:text-white relative overflow-hidden px-4 md:px-6">
        
        <div class="absolute top-10 left-0 md:top-1/4 md:left-1/4 w-64 h-64 md:w-96 md:h-96 lg:w-125 lg:h-125 bg-indigo-600/20 rounded-full blur-[80px] md:blur-[120px] animate-pulse-slow pointer-events-none"></div>
        <div class="absolute bottom-10 right-0 md:bottom-1/4 md:right-1/4 w-48 h-48 md:w-80 md:h-80 lg:w-100 lg:h-100 bg-purple-600/20 rounded-full blur-[60px] md:blur-[100px] animate-pulse-slow delay-1000 pointer-events-none"></div>

        <div class="relative w-full max-w-sm md:max-w-md space-y-6 md:space-y-8">
            
            <div class="space-y-4 md:space-y-6">
                <button 
                    @click="emit('confirmed', 'start')" 
                    class="appearance-none w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full bg-[rgba(255,255,255,0.05)] backdrop-blur-xl border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.2)] hover:scale-105 transition-all duration-300 group shadow-[0_4px_20px_rgba(0,0,0,0.2)] cursor-pointer"
                >
                    <svg class="w-4 h-4 md:w-5 md:h-5 text-zinc-400 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
                </button>

                <div class="space-y-2">
                    <h1 class="text-3xl md:text-4xl font-bold tracking-tight text-white drop-shadow-lg">{{ $t('onboarding.createPassword.title') }}</h1>
                    <p class="text-zinc-400 text-sm md:text-base font-medium leading-relaxed">{{ $t('onboarding.createPassword.desc') }}</p>
                </div>
            </div>

            <div class="space-y-4 md:space-y-5"> 
                <div class="space-y-3">
                    
                    <div class="relative group">
                        <input 
                            v-model="password" 
                            :type="showPassword ? 'text' : 'password'"
                            class="w-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl py-4 md:py-5 px-5 text-base md:text-lg text-white placeholder-zinc-500 focus:outline-none focus:bg-white/10 focus:border-white/25 focus:ring-4 focus:ring-white/5 transition-all duration-300 shadow-[0_4px_30px_rgba(0,0,0,0.1)]"
                            :placeholder="$t('onboarding.createPassword.placeholder_pass')"
                        />
                        
                        <button 
                            @click="showPassword = !showPassword"
                            class="appearance-none bg-transparent absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors p-2 rounded-lg hover:bg-[rgba(255,255,255,0.05)] cursor-pointer"
                        >
                            <svg v-if="!showPassword" class="w-5 h-5 md:w-6 md:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            <svg v-else class="w-5 h-5 md:w-6 md:h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a10.05 10.05 0 011.577-2.735m0 0A3.001 3.001 0 004 12c0 1.268.63 2.39 1.576 3.005m0-6.01L3 3m0 0l18 18M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29" /></svg>
                        </button>
                    </div>

                    <div class="flex gap-1.5 md:gap-2 h-1.5 w-full px-1">
                        <div class="flex-1 rounded-full bg-white/5 overflow-hidden backdrop-blur-sm">
                            <div class="h-full w-full transition-all duration-500 shadow-[0_0_10px_currentColor]" :class="strengthScore >= 1 ? 'bg-red-500 text-red-500 translate-x-0' : '-translate-x-full'"></div>
                        </div>
                        <div class="flex-1 rounded-full bg-white/5 overflow-hidden backdrop-blur-sm">
                            <div class="h-full w-full transition-all duration-500 shadow-[0_0_10px_currentColor]" :class="strengthScore >= 2 ? 'bg-orange-500 text-orange-500 translate-x-0' : '-translate-x-full'"></div>
                        </div>
                        <div class="flex-1 rounded-full bg-white/5 overflow-hidden backdrop-blur-sm">
                            <div class="h-full w-full transition-all duration-500 shadow-[0_0_10px_currentColor]" :class="strengthScore >= 3 ? 'bg-yellow-400 text-yellow-400 translate-x-0' : '-translate-x-full'"></div>
                        </div>
                        <div class="flex-1 rounded-full bg-white/5 overflow-hidden backdrop-blur-sm">
                            <div class="h-full w-full transition-all duration-500 shadow-[0_0_15px_currentColor]" :class="strengthScore >= 4 ? 'bg-emerald-400 text-emerald-400 translate-x-0' : '-translate-x-full'"></div>
                        </div>
                    </div>
                </div>

                <div class="relative group">
                    <input 
                        v-model="confirmPassword" 
                        type="password"
                        class="w-full bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl py-4 md:py-5 px-5 text-base md:text-lg text-white placeholder-zinc-500 focus:outline-none focus:bg-white/10 focus:ring-4 focus:ring-white/5 transition-all duration-300 shadow-[0_4px_30px_rgba(0,0,0,0.1)]"
                        :class="confirmInputClass"
                        :placeholder="$t('onboarding.createPassword.placeholder_confirm')"
                    />
                    
                    <div class="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-500"
                        :class="passwordsMatch && confirmPassword ? 'opacity-100 scale-100' : 'opacity-0 scale-50 blur-sm'"
                    >
                        <div class="w-5 h-5 md:w-6 md:h-6 rounded-full bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.5)] flex items-center justify-center">
                            <svg class="w-3 h-3 md:w-3.5 md:h-3.5 text-black font-bold" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="4" d="M5 13l4 4L19 7" /></svg>
                        </div>
                    </div>
                </div>

                <label class="flex items-center gap-3 md:gap-4 cursor-pointer group pl-1 py-2">
                    <div class="relative mt-0.5">
                        <input type="checkbox" v-model="termsAccepted" class="peer sr-only">
                        <div class="w-5 h-5 md:w-6 md:h-6 border border-white/20 rounded-lg bg-white/5 backdrop-blur-md peer-checked:bg-indigo-500 peer-checked:border-indigo-400 peer-checked:shadow-[0_0_15px_rgba(99,102,241,0.5)] transition-all duration-300"></div>
                        <svg class="absolute top-1 left-1 md:top-1.5 md:left-1.5 w-3 h-3 text-white opacity-0 peer-checked:opacity-100 transition-all duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
                    </div>

                    <i18n-t keypath="onboarding.createPassword.terms_text" tag="span" class="text-xs md:text-sm text-zinc-400 group-hover:text-zinc-200 transition-colors font-medium leading-tight">
                        <template #terms>
                            <a href="https://alltoscan.github.io/extension-terms-of-service/extension-terms-of-service.txt" target="blank" class="text-indigo-400 hover:text-indigo-300 underline underline-offset-2">{{ $t('onboarding.createPassword.terms_link') }}</a>
                        </template>
                    </i18n-t>
                </label>
            </div>

            <div class="pt-2 md:pt-4">
                <p v-if="errorMessage" class="mb-3 text-sm text-red-400">{{ errorMessage }}</p>
                <button
                    @click="create"
                    :disabled="!isValid || isCreating"
                    class="appearance-none bg-transparent border-none relative w-full py-4 md:py-5 rounded-2xl font-bold text-base md:text-lg tracking-wide transition-all duration-500 overflow-hidden group"
                    :class="isValid && !isCreating
                        ? 'cursor-pointer hover:-translate-y-1 shadow-[0_0_40px_rgba(99,102,241,0.3)] hover:shadow-[0_0_60px_rgba(99,102,241,0.5)]'
                        : 'cursor-not-allowed opacity-50 grayscale'"
                >
                    <div class="absolute inset-0 transition-all duration-500"
                        :class="isValid ? 'bg-linear-to-r from-indigo-600 via-purple-600 to-indigo-600 bg-size-[200%_auto] animate-gradient' : 'bg-[rgba(255,255,255,0.1)] backdrop-blur-md'">
                    </div>

                    <span v-if="isCreating" class="relative flex items-center justify-center gap-3 text-white">
                        <svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                        {{ $t('onboarding.createPassword.btn_creating') }}
                    </span>
                    <span v-else class="relative flex items-center justify-center gap-3 text-white">
                        {{ $t('onboarding.createPassword.btn_continue') }}
                        <svg class="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                    </span>

                    <div v-if="isValid" class="absolute top-0 -inset-full h-full w-1/2 z-20 block transform -skew-x-12 bg-linear-to-r from-transparent to-white opacity-20 group-hover:animate-shine"></div>
                </button>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { createWallets } from '../../utils/createWallets'
import { userStore } from '../../store/user';
import { hexlify } from 'ethers';
import { createVault, deriveMasterKey, randBytes } from '../../utils/crypto-utils';
import { uniqueKey } from '../../utils/uniqueKey';

import { passwordStrength, MIN_PASSWORD_SCORE } from '../../utils/passwordStrength'

const emit = defineEmits(['create_wallet', 'wallet_created', 'password_created', 'confirmed'])

const user = userStore()
const { t } = useI18n()

const password = ref('');
const confirmPassword = ref('');
const showPassword = ref(false);
const termsAccepted = ref(false);
const isCreating = ref(false)
const errorMessage = ref('')

// Kural utils/passwordStrength.js'te: ayni endeks sifre DEGISTIRME ekraninda da
// kullaniliyor ve iki kopya kacinilmaz olarak birbirinden ayrilirdi.
const strengthScore = computed(() => passwordStrength(password.value));

const passwordsMatch = computed(() => {
    return password.value && confirmPassword.value && password.value === confirmPassword.value;
});

const confirmInputClass = computed(() => {
    if (!confirmPassword.value) return 'border-white/10 focus:border-white/25';
    if (passwordsMatch.value) return 'border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.1)] focus:border-emerald-500/50';
    return 'border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.1)] text-red-200 focus:border-red-500/50';
});

const isValid = computed(() => {
    return strengthScore.value >= MIN_PASSWORD_SCORE && passwordsMatch.value && termsAccepted.value;
});

const create = async () => {
    if (!isValid.value || isCreating.value) return
    errorMessage.value = ''

    try {
        isCreating.value = true

        // EMNİYET: bu ekran yalnızca İLK cüzdan için. Mevcut kasalar varken
        // aşağıdaki walletSalt yazımı onların anahtarını kalıcı olarak yok eder.
        // index.vue bu ekrana gelinmesini de engelliyor; bu son savunma hattı.
        const { vaults: existingVaults } = await chrome.storage.local.get('vaults')
        if (Array.isArray(existingVaults) && existingVaults.length > 0) {
            throw new Error('Cüzdan zaten var: yeni kasa ekleme akışı kullanılmalı')
        }

        const wallet = await createWallets()
        user.address = wallet.address

        const globalSalt = randBytes(32)

        await chrome.storage.local.set({ walletSalt: hexlify(globalSalt) })
        const masterKey = await deriveMasterKey(password.value, globalSalt)

        // Master key DİSKE YAZILMAZ. Yalnızca bellekte tutulur; şifre doğrulaması
        // diskteki bir kopyayla değil, kasa çözerek yapılır (utils/masterKey.js).

        let { vaults = [] } = await chrome.storage.local.get('vaults')
        let account = {}

        account = {
            name: 'Wats 1',
            type: 'hd',
            derivationPath: "m/44'/60'/0'/0/0",
            index: 0,
            address: wallet.address,
            createdAt: new Date().toISOString(),
            key: uniqueKey()
        }

        const vault = await createVault(masterKey, wallet.mnemonic, account)
        user.vault = vault

        vaults.push(vault)

        await chrome.storage.local.set({ vaults })
        await chrome.storage.local.set({ active_account: account })

        emit('create_wallet', 'create_wallet')
        emit('wallet_created', wallet)
        emit('password_created', password.value)
        
    } catch (error) {
        console.error('Wallet creation failed:', error)
        errorMessage.value = t('onboarding.createPassword.error_generic')
    } finally {
        isCreating.value = false
    }
}
</script>

<style scoped>
@keyframes gradient {
    0% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
    100% { background-position: 0% 50%; }
}
.animate-gradient {
    animation: gradient 3s ease infinite;
}

/* Shine */
@keyframes shine {
    100% { left: 125%; }
}
.animate-shine {
    animation: shine 0.75s;
}
</style>