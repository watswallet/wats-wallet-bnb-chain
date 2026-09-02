<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings_add_wallet" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">
                {{ creationStep === 'backup' ? $t('settings.backup.title') : $t('settings.createAccount.title') }}
            </h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-8 flex flex-col gap-8 relative z-10">
            
            <div v-if="creationStep === 'warning'" class="flex flex-col items-center justify-center h-full gap-6 animate-fade-in">
                <div class="w-20 h-20 rounded-full bg-orange-50 dark:bg-orange-500/10 flex items-center justify-center mb-2 border border-orange-200 dark:border-orange-500/20 shadow-lg dark:shadow-[0_0_30px_-10px_rgba(249,115,22,0.3)] transition-colors duration-300">
                    <svg class="w-10 h-10 text-orange-500 dark:text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                
                <div class="text-center space-y-3 px-2">
                    <h2 class="text-xl font-bold text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.upgrade.title') }}</h2>
                    <p class="text-sm text-slate-500 dark:text-zinc-400 leading-relaxed transition-colors duration-300">
                        <i18n-t keypath="settings.upgrade.desc_p1" tag="span" class="text-slate-600 dark:text-zinc-400">
                            <strong>{{ $t('settings.upgrade.desc_p1_bold') }}</strong>
                        </i18n-t>
                        <br><br>
                        <i18n-t keypath="settings.upgrade.desc_p2" tag="span" class="text-slate-600 dark:text-zinc-400">
                            <strong>{{ $t('settings.upgrade.desc_p2_bold') }}</strong>
                        </i18n-t>
                    </p>
                </div>

                <div class="w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/5 rounded-xl p-4 mt-2 shadow-sm dark:shadow-none transition-colors duration-300">
                    <div class="flex items-start gap-3">
                        <svg class="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <div class="flex flex-col gap-1">
                            <span class="text-xs font-bold text-slate-800 dark:text-zinc-300 transition-colors duration-300">{{ $t('settings.upgrade.info_title') }}</span>
                            <p class="text-[10px] text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('settings.upgrade.info_desc') }}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div v-else-if="creationStep === 'backup'" class="flex flex-col gap-6 animate-fade-in">
                <div class="text-center space-y-2">
                    <h2 class="text-lg font-bold text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.backup.root_title') }}</h2>
                    <p class="text-xs text-slate-500 dark:text-zinc-500 transition-colors duration-300">{{ $t('settings.backup.root_desc') }}</p>
                </div>

                <button type="button" class="relative group cursor-pointer w-full text-left" :aria-pressed="revealMnemonic" @click="revealMnemonic = !revealMnemonic">
                    <div 
                        class="grid grid-cols-3 gap-2 p-4 bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-xl transition-all duration-500 shadow-sm dark:shadow-none"
                        :class="revealMnemonic ? 'filter-none' : 'blur-md opacity-50 group-hover:opacity-70'"
                    >
                        <div v-for="(word, idx) in tempMnemonic.split(' ')" :key="idx" class="flex items-center gap-2 bg-slate-50 dark:bg-black/20 p-2 rounded border border-slate-100 dark:border-white/5 transition-colors duration-300">
                            <span class="text-[10px] text-slate-400 dark:text-zinc-600 font-mono w-4">{{ idx + 1 }}.</span>
                            <span class="text-xs text-slate-800 dark:text-zinc-200 font-bold transition-colors duration-300">{{ word }}</span>
                        </div>
                    </div>

                    <div v-if="!revealMnemonic" class="absolute inset-0 flex items-center justify-center z-10">
                        <div class="bg-white/90 dark:bg-zinc-900/80 backdrop-blur-sm px-4 py-2 rounded-full border border-slate-200 dark:border-white/10 flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-white shadow-xl transition-colors duration-300">
                            <svg class="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                            {{ $t('settings.backup.reveal') }}
                        </div>
                    </div>
                </button>

                <div class="flex items-center gap-3 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 rounded-lg transition-colors duration-300">
                    <svg class="w-5 h-5 text-rose-600 dark:text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                    <p class="text-[10px] text-rose-700 dark:text-rose-200 font-bold leading-relaxed transition-colors duration-300">{{ $t('settings.backup.warning') }}</p>
                </div>
            </div>

            <div v-else class="flex flex-col gap-8 animate-fade-in">
                <div class="flex flex-col items-center gap-4">
                    <div class="relative group">
                        <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-xl group-hover:blur-2xl transition-all duration-500"></div>
                        <div class="relative w-24 h-24 rounded-full bg-white dark:bg-linear-to-br dark:from-zinc-800 dark:to-[#09090b] border-2 border-slate-200 dark:border-white/10 flex items-center justify-center shadow-lg dark:shadow-2xl transition-colors duration-300">
                            <span class="text-4xl font-bold text-indigo-600 dark:text-white transition-colors duration-300">{{ account_name ? account_name.charAt(0).toUpperCase() : '?' }}</span>
                        </div>
                    </div>
                    <p class="text-sm font-medium text-slate-500 dark:text-zinc-500 text-center transition-colors duration-300">{{ $t('settings.createAccount.desc') }}</p>
                </div>

                <div class="flex flex-col gap-6">
                    <div class="flex flex-col gap-2">
                        <label class="text-xs font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-wider ml-1 transition-colors duration-300">{{ $t('settings.createAccount.label_name') }}</label>
                        <input 
                            v-model="account_name" 
                            type="text" 
                            :placeholder="$t('settings.createAccount.placeholder_name')" 
                            class="w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-xl py-3.5 px-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-all duration-300 shadow-sm dark:shadow-none"
                        >
                    </div>

                    <div class="flex flex-col gap-2">
                        <label class="text-xs font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-wider ml-1 transition-colors duration-300">{{ $t('settings.createAccount.label_source') }}</label>
                        <div class="flex flex-col gap-3">
                            <button 
                                v-for="(vault, index) in user_vaults" 
                                :key="vault.id"
                                @click="activeVault = vault; user.vault = vault"
                                class="group w-full relative border rounded-xl p-3 flex items-center justify-between transition-all duration-300 cursor-pointer"
                                :class="activeVault?.id === vault.id 
                                    ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-400 dark:border-indigo-500 shadow-md dark:shadow-[0_0_15px_-5px_rgba(99,102,241,0.2)]' 
                                    : 'bg-white dark:bg-[#131315] border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10 hover:bg-slate-50 dark:hover:bg-[#18181b] shadow-sm dark:shadow-none'"
                            >
                                <div class="flex items-center gap-3">
                                    <div 
                                        class="w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-300"
                                        :class="activeVault?.id === vault.id ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 dark:bg-zinc-800/50 text-indigo-600 dark:text-indigo-400 group-hover:bg-slate-200'"
                                    >
                                        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" /></svg>
                                    </div>
                                    
                                    <div class="flex flex-col items-start">
                                        <span class="text-sm font-bold transition-colors duration-300" :class="activeVault?.id === vault.id ? 'text-indigo-700 dark:text-white' : 'text-slate-800 dark:text-zinc-200'">
                                            {{ $t('settings.createAccount.vault_group', { index: index + 1 }) }}
                                        </span>
                                        <span class="text-[10px] font-bold transition-colors duration-300" :class="activeVault?.id === vault.id ? 'text-indigo-500/80 dark:text-indigo-200' : 'text-slate-400 dark:text-zinc-500'">
                                            {{ vault.type === 'hd' ? $t('settings.createAccount.hd_wallet') : $t('settings.createAccount.private_key') }}
                                        </span>
                                    </div>
                                </div>

                                <div class="flex flex-col items-end gap-1 text-right max-w-[45%]">
                                    <div v-if="activeVault?.id === vault.id" class="flex items-center gap-1 text-[9px] font-bold text-indigo-700 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-500/20 mb-0.5 transition-colors duration-300">
                                        <svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
                                        {{ $t('settings.createAccount.active') }}
                                    </div>

                                    <div class="flex flex-col items-end">
                                        <span class="text-[9px] text-slate-400 dark:text-zinc-500 uppercase tracking-wider font-bold mb-0.5 transition-colors duration-300">{{ $t('settings.createAccount.connectedAccounts') }}</span>
                                        <span class="text-[10px] text-slate-600 dark:text-zinc-400 truncate w-full text-right leading-tight transition-colors duration-300">
                                            {{ getAccountSummary(vault) }}
                                        </span>
                                    </div>
                                </div>
                            </button>

                            <!-- SECILEBILIR KASA YOKSA sebebi SOYLENIR.
                                 Liste `user_vaults` bos oldugunda eskiden hicbir sey
                                 gorunmuyordu ama alttaki "Olustur" dugmesi CANLI
                                 kaliyordu: kullanici isim yazip basiyor ve
                                 `unlockVault(masterKey, null)` patliyordu. Bos bir
                                 liste + canli bir dugme, kullaniciya "bir sey ters
                                 gitti" dedirtir; asil cevap "bu kasa TON kasasi ve
                                 ikinci hesap ayni adresi uretirdi". -->
                            <div
                                v-if="!user_vaults.length"
                                class="rounded-xl border border-amber-200 dark:border-amber-800/50 bg-amber-50/80 dark:bg-amber-950/30 p-3"
                            >
                                <p class="text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
                                    {{ onlyTonVaults
                                        ? $t('settings.createAccount.ton_single_account')
                                        : $t('settings.createAccount.no_eligible_vault') }}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white/90 dark:bg-[#09090b] relative z-20 transition-colors duration-300">
            <button 
                v-if="creationStep === 'warning'"
                @click="generateAndShowMnemonic"
                class="w-full py-3.5 rounded-xl font-bold text-sm bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 dark:shadow-indigo-500/20 cursor-pointer"
            >
                {{ $t('settings.upgrade.btn_continue') }}
            </button>

            <button 
                v-else-if="creationStep === 'backup'"
                @click="confirmBackupAndContinue"
                class="w-full py-3.5 rounded-xl font-bold text-sm bg-emerald-600 text-white hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200 dark:shadow-emerald-500/20 flex items-center justify-center gap-2 cursor-pointer"
            >
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                {{ $t('settings.backup.btn_confirm') }}
            </button>

            <button 
                v-else
                @click="create"
                class="w-full py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                :class="!loading && account_name && activeVault
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-[1.01] shadow-indigo-200 dark:shadow-indigo-500/20'
                    : 'bg-slate-100 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed border border-slate-200 dark:border-white/5'"
                :disabled="loading || !account_name || !activeVault"
            >
                <span v-if="loading" class="flex items-center gap-2">
                    <svg class="w-4 h-4 animate-spin text-white/70" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    {{ $t('settings.createAccount.btn_creating') }}
                </span>
                <span v-else>{{ $t('settings.createAccount.btn_create') }}</span>
            </button>
        </div>
    </div>
</template>

<script setup>
import { onMounted, ref, toRaw } from 'vue'
import { pageStore } from '../../store/pageStore'
import { userStore } from '../../store/user'
import { HDNodeWallet, Wallet } from 'ethers'
import { unlockVault, encryptMnemonicWithMaster } from '../../utils/crypto-utils'
import { isLockError, requireSessionMasterKey } from '../../utils/masterKey'
import { uniqueKey } from '../../utils/uniqueKey'
import axios from 'axios'
import Back from '../Back.vue'
import { useI18n } from 'vue-i18n'
import { configStore } from '../../store/config'

const { t } = useI18n()
const page = pageStore()
const user = userStore()
const config = configStore()

const account_name = ref('')
const user_vaults = ref([])
const loading = ref(false)
const creationStep = ref('form')
const tempMnemonic = ref('')
const revealMnemonic = ref(false)
const masterKeyRef = ref(null)
const activeVault = ref(null)

// Secilebilir kasa kalmamasinin SEBEBI. `user_vaults.length === 0` tek basina
// "neden" demiyor ve iki farkli sebep var: (a) tek kasa TON kasasi - bu ekranin
// ozellikle acikladigi durum, (b) baska bir eleme (or. yalnizca privateKey kasasi
// var ve parmak izi eslesmiyor). Ikisine ayni metni yazmak, birine yalan soylemek
// olurdu.
const onlyTonVaults = ref(false)

onMounted(async() => {
    const { vaults, active_account } = await chrome.storage.local.get(['vaults', 'active_account'])

    // TON kasalari da elenir: TON'da turetme yolu YOKTUR ve o kasaya eklenen
    // "Hesap 2" BIREBIR AYNI adresi uretirdi (spec §11) - kullanici iki hesap
    // gorur, ikisi tek cuzdandir, birinden harcayinca digeri de bosalir.
    user_vaults.value = vaults.filter(v => v.type !== 'privateKey' && v.type !== 'tonMnemonic')

    // SECIM de elenir, yalnizca LISTE degil.
    //
    // Eskiden aday kume filtrelenmemis `vaults` idi: ice aktarilmis bir TON hesabi
    // aktifken `activeVault` TON kasasi oluyor ve "Olustur" dugmesi ONUN uzerinde
    // canli kaliyordu. Cift-gecerli bir ifadede (~1/500, bu ozelligin ozellikle ele
    // aldigi durum) `unlockVault` ifadeyi doner, `includes(' ')` gecer,
    // `HDNodeWallet.fromPhrase` BASARILI olur ve TON kasasina bir `hd` hesabi
    // yazilir: kasada iki hesap olur (spec §5 "tam olarak bir" diyor), ikisi de
    // ayni TON adresine cozulur ve yeni hesap createWalletInstance'a girip TON
    // kasasindan bir EVM imzalayici uretir.
    //
    // `privateKey` kasalari BURADA elenmez: donusturme akisi (checkVaultStatus ->
    // creationStep 'warning' -> confirmBackupAndContinue) tam olarak o kasanin
    // secili olmasini gerektiriyor. Elenen yalnizca `tonMnemonic`.
    // En az bir kasa var ve HEPSI TON kasasi: ekranin acikladigi durum tam olarak bu.
    onlyTonVaults.value = vaults.length > 0 && vaults.every(v => v.type === 'tonMnemonic')

    const selectableVaults = vaults.filter(v => v.type !== 'tonMnemonic')
    activeVault.value = selectableVaults.find(v => v.fingerprint === active_account?.fingerprint)
        || user_vaults.value[0]
        || null

    if (activeVault.value) {
        await checkVaultStatus(activeVault.value)
    }

    let totalAccounts = 0
    if (vaults) {
        for (const vault of vaults) {
            totalAccounts += vault.accounts ? vault.accounts.length : 0
        }
    }
    // Varsayılan hesap ismini dil dosyasından al
    account_name.value = `${t('settings.createAccount.account_default')} ${totalAccounts + 1}`
})

const checkVaultStatus = async (vault) => {
    try {
        // Bu ekrana yalnızca cüzdan açıkken gelinir: master key diskten değil,
        // oturumun belleğinden alınır.
        masterKeyRef.value = await requireSessionMasterKey()

        if (vault.type === 'privateKey') creationStep.value = 'warning'
        else creationStep.value = 'form'

    } catch (e) {
        console.warn("Vault kontrol edilemedi:", e)

        // Kilitli/bayat anahtar sessiz kalmamalı: eskiden diskteki jwk her zaman
        // vardı, artık yoksa ekran hiç ilerlemiyor ve kullanıcı nedenini göremiyor.
        alert(isLockError(e) ? t('settings.createAccount.wallet_locked') : t('settings.createAccount.create_failed'))
    }
}

const getAccountSummary = (vault) => {
    if (!vault.accounts || vault.accounts.length === 0) return t('settings.createAccount.no_accounts');

    // İlk 2 hesabın ismini al
    const names = vault.accounts.slice(0, 2).map(a => a.name).join(', ');

    // Geriye kalan sayı
    const remaining = vault.accounts.length - 2;

    if (remaining > 0) {
        return `${names}${t('settings.createAccount.more_others', { count: remaining })}`;
    }

    return names;
}

const generateAndShowMnemonic = () => {
    const wallet = Wallet.createRandom()
    tempMnemonic.value = wallet.mnemonic.phrase
    creationStep.value = 'backup'
}

const confirmBackupAndContinue = async () => {
    if(!tempMnemonic.value || !masterKeyRef.value) return
    loading.value = true

    try {
        const { ciphertext, iv } = await encryptMnemonicWithMaster(
            tempMnemonic.value, 
            masterKeyRef.value, 
            activeVault.value.id
        )
        
        if (activeVault.value.accounts.length > 0) {
            activeVault.value.accounts[0].importedSecret = {
                ciphertext: activeVault.value.mnemonic,
                iv: activeVault.value.iv,
                salt: activeVault.value.vaultSalt 
            }
        }

        activeVault.value.mnemonic = ciphertext 
        activeVault.value.iv = iv                
        activeVault.value.data = ciphertext      
        activeVault.value.type = 'hd'

        const { vaults } = await chrome.storage.local.get('vaults')
        const vaultIndex = vaults.findIndex(v => v.id === activeVault.value.id)
        
        if (vaultIndex !== -1) {
            const cleanVault = toRaw(activeVault.value)
            vaults[vaultIndex] = cleanVault
            await chrome.storage.local.set({ vaults })
        }

        const { vaults: newVaults } = await chrome.storage.local.get('vaults')
        // TON kasalari da elenir: TON'da turetme yolu YOKTUR ve o kasaya eklenen
        // "Hesap 2" BIREBIR AYNI adresi uretirdi (spec §11) - kullanici iki hesap
        // gorur, ikisi tek cuzdandir, birinden harcayinca digeri de bosalir.
        user_vaults.value = newVaults.filter(v => v.type !== 'privateKey' && v.type !== 'tonMnemonic')

        creationStep.value = 'form'
    } catch (error) {
        console.error("Yedekleme hatası:", error)
        alert(t('settings.createAccount.backup_error', { msg: error.message }))
    } finally {
        loading.value = false
    }
}

const getImportedTokens = async() => {
    try {
        const { data } = await axios.get(config.api + '/getImportedTokens')
        if(!data) return []
        return data.importedTokens
    } catch (error) {
        return []
    }
}

const create = async() => {
    if (loading.value) return
    loading.value = true

    try {
        // SERT DURDURMA (spec §11). Yukaridaki secim kapisi bu ekranda TON kasasinin
        // secilmesini zaten engelliyor; bu satir o kapinin ATLANDIGI her yolu kapatir
        // (aktif kasa baska bir ekrandan degistirilir, kapi ileride sadelestirilir...).
        // Gorunum kosulu karar DEGILDIR - karar burada, yazmadan hemen once verilir.
        //
        // TON'da turetme yolu YOKTUR: bu kasaya eklenen "Hesap 2" ayni adresi
        // uretirdi; cift-gecerli bir ifadede ise TON kasasindan bir EVM hesabi
        // dogar. Ikisi de sessiz veri bozulmasi.
        if (activeVault.value?.type === 'tonMnemonic') {
            throw new Error('TON_VAULT_SINGLE_ACCOUNT')
        }

        // KASA YOKSA da SERT DURDURMA - ve bu satir yukaridakinin BOSLUGUNU kapatiyor.
        //
        // `activeVault` null oldugunda `?.type` undefined doner, yani ustteki TON
        // kapisi SESSIZCE GECILIR. Tek kasasi TON kasasi olan bir kullanicida
        // `activeVault` tam olarak null kaliyordu: dugme canliydi, TON kapisi
        // atlaniyordu ve akis `unlockVault(masterKey, null)` icinde patliyordu -
        // kullaniciya sebebini soylemeyen bir hata.
        //
        // Optional chaining'i kaldirmak COZUM DEGIL: o zaman null kasa "TON degil"
        // sayilip yine asagi akardi. Eksik olan ayri bir kontroldu.
        if (!activeVault.value) {
            throw new Error('NO_ELIGIBLE_VAULT')
        }

        // masterKeyRef checkVaultStatus'ta doldurulur; boşsa oturumdan alınır.
        // Cüzdan kilitlenmişse WALLET_LOCKED atar ve aşağıdaki catch'e düşer.
        const masterKey = masterKeyRef.value || await requireSessionMasterKey()

        const {vaults, imported_tokens } = await chrome.storage.local.get(['vaults', 'imported_tokens'])

        const decrypted_data = await unlockVault(masterKey, activeVault.value)

        // Daha güvenli kontrol (Mnemonic'ler boşluk içerir)
        if (!decrypted_data.includes(' ')) {
            throw new Error("Geçerli bir HD Cüzdan bulunamadı. Lütfen dönüştürme işlemini kontrol edin.")
        }

        // Storage'dan çektiğimiz asıl vault objesini bulalım ki güncellemeyi ona yapıp kaydedelim
        const vaultToUpdate = vaults.find(v => v.id === activeVault.value.id)
        if (!vaultToUpdate) throw new Error("Vault storage içinde bulunamadı.")

        const index = vaultToUpdate.accounts.length
        const path = `m/44'/60'/0'/0/${index}`
        
        // Ethers v6 için en güvenli türetme yöntemi (Directly with path)
        const wallet = HDNodeWallet.fromPhrase(decrypted_data.trim(), "", path)
        
        const account = {
            address: wallet.address,
            createdAt: new Date().toISOString(),
            derivationPath: path,
            index,
            fingerprint: activeVault.value.fingerprint,
            name: account_name.value,
            type: 'hd',
            key: uniqueKey()
        }

        await chrome.storage.local.set({ active_account: account })
        
        // Sadece tek sefer ekleme yapıyoruz
        const cleanAccount = toRaw(account)
        vaultToUpdate.accounts.push(cleanAccount) // Storage için eklendi
        activeVault.value.accounts.push(cleanAccount) // UI referansı için eklendi
        
        user.address = wallet.address
        user.vault = vaultToUpdate

        const importedTokens = await getImportedTokens()
        const new_imported_tokens = {
            ...imported_tokens,
            [account.key]: importedTokens
        }

        // Artık "vaults" dizisi vaultToUpdate referansı üzerinden güncellendiği için doğru şekilde kaydedilecektir.
        await chrome.storage.local.set({ vaults })
        await chrome.storage.local.set({ imported_tokens: new_imported_tokens })
        
        page.currentPage = 'home'

    } catch (error) {
        console.error('Account creation failed:', error)

        if (error.message === 'TON_VAULT_SINGLE_ACCOUNT') {
            return alert(t('settings.createAccount.ton_single_account'))
        }

        // Sebep TON kasasiysa TON metnini goster: kullanicinin tek kasasi TON
        // kasasiyken `activeVault` null kalir ve genel "olusturulamadi" metni
        // NEDENINI soylemezdi - oysa sebep tam olarak biliniyor.
        if (error.message === 'NO_ELIGIBLE_VAULT') {
            return alert(t(onlyTonVaults.value
                ? 'settings.createAccount.ton_single_account'
                : 'settings.createAccount.no_eligible_vault'))
        }

        alert(isLockError(error) ? t('settings.createAccount.wallet_locked') : t('settings.createAccount.create_failed'))
    } finally {
        loading.value = false
    }
}
</script>