<template>
  <div class="min-h-screen w-full flex flex-col items-center justify-center bg-[#050505] text-white font-sans selection:bg-cyan-500/30 selection:text-white relative overflow-hidden py-6 px-4 md:py-10 md:px-6">
    
    <div class="absolute top-0 left-0 md:left-1/4 w-64 h-64 md:w-150 md:h-150 bg-cyan-600/10 rounded-full blur-[80px] md:blur-[120px] animate-pulse-slow pointer-events-none"></div>
    <div class="absolute bottom-0 right-0 md:right-1/4 w-48 h-48 md:w-125 md:h-125 bg-blue-600/10 rounded-full blur-[60px] md:blur-[100px] animate-pulse-slow delay-1000 pointer-events-none"></div>

    <div class="relative w-full max-w-lg md:max-w-xl space-y-6 md:space-y-8">
      
      <div class="flex flex-col space-y-4 md:space-y-6">
        <button 
          @click="emit('confirmed', 'import_wallet')" 
          class="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full bg-white/5 backdrop-blur-xl border border-white/10 hover:bg-white/10 hover:border-white/20 hover:scale-105 transition-all duration-300 shadow-[0_4px_20px_rgba(0,0,0,0.2)] group cursor-pointer"
        >
          <svg class="w-4 h-4 md:w-5 md:h-5 text-zinc-400 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
        </button>

        <div class="space-y-2">
          <h1 class="text-2xl md:text-3xl font-bold tracking-tight text-white drop-shadow-lg">{{ $t('onboarding.importPrivate.title') }}</h1>
          <p class="text-zinc-400 text-sm md:text-base font-medium">{{ $t('onboarding.importPrivate.desc') }}</p>
        </div>
      </div>

      <div class="relative group">
        <div class="absolute -inset-0.5 bg-linear-to-r from-cyan-500/60 to-blue-600/60 rounded-2xl opacity-0 transition duration-1000 blur-lg"
          :class="isValid ? 'opacity-40' : 'group-focus-within:opacity-20'"></div>

        <div class="relative bg-black/40 backdrop-blur-xl border rounded-2xl p-1 transition-all duration-300"
          :class="isValid ? 'border-cyan-500/50' : 'border-white/10 group-focus-within:border-white/20'">
            
          <div class="flex justify-between items-center px-3 py-2 md:px-4 md:py-3 border-b border-white/5">
            <div class="flex items-center gap-2">
              <div class="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full" :class="isValid ? 'bg-cyan-500' : 'bg-zinc-600'"></div>
              <span class="text-[10px] md:text-xs font-mono font-bold uppercase tracking-wider text-zinc-400">
                {{ isValid ? $t('onboarding.importPrivate.status_secure') : $t('onboarding.importPrivate.status_awaiting') }}
              </span>
            </div>
              
            <button 
              @click="handlePaste"
              class="flex items-center gap-1.5 px-2.5 py-1 md:px-3 md:py-1 rounded-lg cursor-pointer bg-white/5 hover:bg-white/10 text-cyan-400 text-[10px] md:text-xs font-medium transition-colors border border-white/5 hover:border-white/10"
            >
              <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
              {{ $t('onboarding.importPrivate.btn_paste') }}
            </button>
          </div>

          <textarea 
            v-model="privateKey"
            rows="4"
            spellcheck="false"
            class="w-full bg-transparent p-3 md:p-4 text-sm md:text-base font-mono text-cyan-500 placeholder-zinc-700 focus:outline-none resize-none break-all"
            :class="!showKey ? 'text-security-disc' : ''"
            :placeholder="$t('onboarding.importPrivate.placeholder_key')"
          ></textarea>

          <div class="flex justify-between items-center px-3 py-2 md:px-4 md:py-3">
            <button @click="showKey = !showKey" class="text-zinc-500 hover:text-white text-[10px] md:text-xs flex items-center gap-2 transition-colors cursor-pointer">
              <svg v-if="!showKey" class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
              <svg v-else class="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.542-7a10.05 10.05 0 011.577-2.735m0 0A3.001 3.001 0 004 12c0 1.268.63 2.39 1.576 3.005m0-6.01L3 3m0 0l18 18M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29" /></svg>
              {{ showKey ? $t('onboarding.importPrivate.btn_hide') : $t('onboarding.importPrivate.btn_show') }}
            </button>
          </div>
        </div>
      </div>

      <div class="pt-4">
        <button 
          @click="importWallet"
          :disabled="!isValid || loading"
          class="relative w-full py-4 md:py-5 rounded-2xl font-bold text-base md:text-lg tracking-wide transition-all duration-500 overflow-hidden group"
          :class="isValid && !loading
            ? 'cursor-pointer hover:-translate-y-1 shadow-[0_0_40px_rgba(6,182,212,0.3)] hover:shadow-[0_0_60px_rgba(6,182,212,0.4)]'
            : 'cursor-not-allowed opacity-50 grayscale'"
        >
          <div class="absolute inset-0 transition-all duration-500"
            :class="isValid && !loading ? 'bg-linear-to-r from-cyan-600 via-blue-600 to-cyan-600 bg-size-[200%_auto] animate-gradient' : 'bg-white/10 backdrop-blur-md'">
          </div>
          
          <span class="relative text-white flex items-center justify-center gap-3">
            {{ loading ? $t('onboarding.importPrivate.btn_submitting') : $t('onboarding.importPrivate.btn_submit') }}
            <svg v-if="isValid" class="w-4 h-4 md:w-5 md:h-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
          </span>

          <div v-if="isValid" class="absolute top-0 -inset-full h-full w-1/2 z-20 block transform -skew-x-12 bg-linear-to-r from-transparent to-white opacity-20 group-hover:animate-shine" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { Wallet } from 'ethers'
import { userStore } from '../../store/user'
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { createVaultWithPrivateKey, sha256, toHex } from '../../utils/crypto-utils'
import { isLockError, requireSessionMasterKey } from '../../utils/masterKey'
import { uniqueKey } from '../../utils/uniqueKey'

const { t } = useI18n()

const emit = defineEmits(['confirmed', 'private_key'])
const props = defineProps(['user_password'])

const user = userStore()

const loading = ref(false)

const privateKey = ref('');
const showKey = ref(false);

const isValid = computed(() => {
  const key = privateKey.value.trim();
  if (!key) return false;
  const cleanKey = key.startsWith('0x') ? key.slice(2) : key;
  const isHex = /^[0-9a-fA-F]+$/.test(cleanKey);
  return cleanKey.length === 64 && isHex;
});

const handlePaste = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) privateKey.value = text.trim()
  } catch (err) {
    console.error("Paste error:", err);
  }
};

const importWallet = async () => {
  if (!isValid.value || loading.value) return

  loading.value = true
  
  try {
    const wallet = new Wallet(privateKey.value)
    const seed = wallet.privateKey

    const hash = await sha256(new TextEncoder().encode(seed))
    const fingerprint = toHex(hash)

    let { vaults = [] } = await chrome.storage.local.get('vaults')

    if(!vaults.length) {
      emit('private_key', privateKey.value)
      emit('confirmed', 'password')
      return
    }

    const exists = vaults.some(v => v.fingerprint === fingerprint)
    if(exists) return alert(t('onboarding.importPrivate.alert_already_imported'))

    user.address = wallet.address

    let index = 0
    let totalIndex = 1

    for (const vault of vaults) {
      totalIndex += vault?.accounts?.length
    }

    const account = {
      name: 'Wats ' + totalIndex,
      type: 'imported',
      index,
      address: wallet.address,
      createdAt: new Date().toISOString(),
      key: uniqueKey()
    }

    // Buraya yalnızca mevcut bir cüzdana kasa eklenirken gelinir (kasa yoksa yukarıda
    // erken çıkılıp şifre adımına devredilir). Master key diskten değil, açık oturumun
    // belleğinden alınır.
    const masterKey = await requireSessionMasterKey()

    const vault = await createVaultWithPrivateKey(masterKey, privateKey.value, account)

    vaults.push(vault)

    await chrome.storage.local.set({ vaults })
    await chrome.storage.local.set({ active_account: account })
    
    user.vault = vault

    emit('confirmed', 'ready')
      
  } catch (error) {
    console.error('Import error:', error)

    // Master key alınamadığında kullanıcı eskiden hiçbir şey görmüyordu.
    if (isLockError(error)) {
      alert(t('onboarding.importPrivate.alert_wallet_locked'))
    } else {
      alert(t('onboarding.importPrivate.alert_import_failed'))
    }
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
/* Gradient Animasyonu */
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

/* Textarea Gizleme */
.text-security-disc {
  -webkit-text-security: disc;
}
</style>