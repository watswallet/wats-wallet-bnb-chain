<template>
    <div class="w-90 h-150 flex flex-col bg-slate-50 dark:bg-[#09090b] text-slate-900 dark:text-white font-sans relative overflow-hidden selection:bg-indigo-500/30 transition-colors duration-300">
        
        <div class="absolute top-0 left-0 right-0 h-32 bg-linear-to-b from-indigo-500/5 dark:from-indigo-900/10 to-transparent pointer-events-none transition-colors duration-300"></div>

        <div class="flex items-center justify-center px-5 pt-5 pb-3 relative border-b border-slate-200 dark:border-white/5 bg-white/80 dark:bg-transparent backdrop-blur-md z-10 transition-colors duration-300">
            <Back page="settings_saved_addresses" class="absolute left-5 hover:bg-slate-100 dark:hover:bg-white/5 p-2 -ml-2 rounded-full transition-colors text-slate-600 dark:text-white" />
            <h1 class="text-lg font-bold tracking-tight text-slate-900 dark:text-white transition-colors duration-300">{{ $t('settings.addresses.editAddress.title') }}</h1>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pt-8 flex flex-col gap-8 relative z-10">
            <div class="flex flex-col items-center gap-4">
                <div class="relative group">
                    <div class="absolute inset-0 bg-indigo-500/10 dark:bg-indigo-500/20 rounded-full blur-xl group-hover:blur-2xl transition-all duration-500"></div>
                    <div class="relative w-20 h-20 bg-white dark:bg-linear-to-br dark:from-zinc-800 dark:to-[#09090b] border-2 border-slate-200 dark:border-white/10 rounded-full flex items-center justify-center shadow-lg dark:shadow-2xl transition-colors duration-300">
                        <svg class="w-8 h-8 text-indigo-600 dark:text-indigo-400 group-hover:scale-110 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                    </div>

                    <div class="absolute -bottom-1 -right-1 bg-white dark:bg-zinc-800 border border-slate-200 dark:border-zinc-600 rounded-full p-1.5 text-slate-600 dark:text-white shadow-md transition-colors duration-300">
                        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                    </div>
                </div>

                <p class="text-sm font-medium text-slate-500 dark:text-zinc-500 text-center transition-colors duration-300">{{ $t('settings.addresses.editAddress.desc') }}</p>
            </div>

            <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                    <label class="text-xs font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-wider ml-1 transition-colors duration-300">{{ $t('settings.addresses.editAddress.label_name') }}</label>
                    <input 
                        v-model="label" 
                        type="text" 
                        :placeholder="$t('settings.addresses.editAddress.placeholder_name')" 
                        class="w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-white/10 rounded-xl py-3.5 px-4 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-all duration-300 shadow-sm dark:shadow-none"
                    >
                </div>

                <div class="flex flex-col gap-2">
                    <label class="text-xs font-bold text-slate-400 dark:text-zinc-400 uppercase tracking-wider ml-1 transition-colors duration-300">{{ $t('settings.addresses.editAddress.label_address') }}</label>
                    <div class="relative group">
                        <textarea
                            v-model="address"
                            :placeholder="vm === 'solana' ? 'Base58 address...' : '0x...'"
                            rows="2"
                            class="w-full bg-white dark:bg-[#131315] border rounded-xl py-3 pl-4 pr-12 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-600 focus:outline-none transition-all duration-300 font-mono resize-none leading-relaxed shadow-sm dark:shadow-none"
                            :class="[
                                address && !isValid ? 'border-rose-400 dark:border-rose-500/50 focus:border-rose-500' : 
                                (address && isValid ? 'border-emerald-400 dark:border-emerald-500/50 focus:border-emerald-500' : 'border-slate-200 dark:border-white/10 focus:border-indigo-500')
                            ]"
                        ></textarea>
                        
                        <div class="absolute right-3 top-3 flex items-center">
                            <button 
                                v-if="!address" 
                                @click="handlePaste"
                                class="p-1.5 rounded-lg bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition-colors text-[10px] font-bold cursor-pointer"
                            >
                                {{ $t('settings.addresses.editAddress.btn_paste') }}
                            </button>
                            
                            <template v-else>
                                <svg v-if="isValid" class="w-5 h-5 text-emerald-500 animate-fade-in" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>
                                <svg v-else class="w-5 h-5 text-rose-500 animate-fade-in" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </template>
                        </div>
                    </div>

                    <p v-if="address && !isValid" class="text-[10px] font-bold text-rose-600 dark:text-rose-500 ml-1 animate-fade-in transition-colors duration-300">
                        {{ reason === 'RECIPIENT_NOT_WALLET' ? $t('send.recipientNotWallet')
                            : reason === 'INVALID_SOLANA_ADDRESS' ? $t('send.errors.invalidSolanaAddress')
                            : $t('settings.addresses.editAddress.error_invalid') }}
                    </p>
                </div>

                <button
                    @click="showDeleteConfirm = true"
                    class="mt-2 w-full py-3 rounded-xl border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/5 text-rose-600 dark:text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/10 hover:border-rose-300 dark:hover:border-rose-500/30 font-bold text-sm transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer shadow-sm dark:shadow-none"
                >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    {{ $t('settings.addresses.editAddress.btn_delete') }}
                </button>
            </div>
        </div>

        <div class="p-5 border-t border-slate-200 dark:border-white/5 bg-white dark:bg-[#09090b] relative transition-colors duration-300">
            <button 
                @click="edit"
                class="w-full py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer"
                :class="canSave 
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700 hover:scale-[1.01] shadow-indigo-500/20' 
                    : 'bg-slate-100 dark:bg-zinc-800 text-slate-400 dark:text-zinc-500 cursor-not-allowed border border-slate-200 dark:border-white/5'"
                :disabled="!canSave"
            >
                {{ $t('settings.addresses.editAddress.btn_save') }}
            </button>
        </div>

        <Transition name="fade">
            <div v-if="showDeleteConfirm" class="absolute inset-0 z-50 bg-slate-900/50 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 transition-colors duration-300">
                <div class="w-full bg-white dark:bg-[#131315] border border-slate-200 dark:border-rose-500/30 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl animate-scale-in transition-colors duration-300">
                    <h3 class="text-lg font-bold text-slate-900 dark:text-white text-center transition-colors duration-300">{{ $t('settings.addresses.editAddress.confirm_delete_title') }}</h3>
                    <p class="text-sm text-slate-600 dark:text-zinc-400 text-center transition-colors duration-300">{{ $t('settings.addresses.editAddress.confirm_delete_desc') }}</p>

                    <div class="flex flex-col gap-3 mt-2">
                        <button
                            @click="remove"
                            class="w-full py-3 rounded-xl font-bold text-sm bg-rose-600 text-white hover:bg-rose-700 dark:hover:bg-rose-500 transition-colors cursor-pointer"
                        >
                            {{ $t('settings.addresses.editAddress.confirm_delete_yes') }}
                        </button>

                        <button
                            @click="showDeleteConfirm = false"
                            class="w-full py-3 rounded-xl font-bold text-sm bg-slate-100 hover:bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 dark:hover:text-white transition-colors cursor-pointer"
                        >
                            {{ $t('settings.addresses.editAddress.confirm_delete_cancel') }}
                        </button>
                    </div>
                </div>
            </div>
        </Transition>
    </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { pageStore } from '../../../store/pageStore'
import { validateRecipient } from '../../../utils/solana/sendGuards'
import { normalizeSolanaAddress } from '../../../utils/solana/address'
import { isSameChainId } from '../../../utils/vm'
import { SOLANA_CHAIN_ID } from '../../../utils/solana/constants'
import Back from '../../Back.vue'

const props = defineProps(['savedAddress', 'savedAddressIndex'])
const page = pageStore()

const label = ref(props.savedAddress.label)
const address = ref(props.savedAddress.address)
const showDeleteConfirm = ref(false)

// Bu KAYITLI bir adres: aktif ag AddAddress.vue'deki gibi kaynak OLAMAZ, cunku
// kullanici bu ekrana kaydin ait oldugu agdan FARKLI bir agdayken de girebilir
// (Adres Defteri agdan bagimsiz, TUM kayitlari listeler). Dogru soru "bu KAYIT
// hangi zincire ait" -- cevap KAYDIN KENDI chainId'sinde durur, aktif agda degil.
// Eski kayitlarda (Solana henuz yokken kaydedilmis) bu alan hep EVM'e (1)
// isaret eder -- vm de dogal olarak 'evm' kalir, davranis DEGISMEZ.
const vm = computed(() => (isSameChainId(props.savedAddress.chainId, SOLANA_CHAIN_ID) ? 'solana' : 'evm'))

// `watch` yerine `computed` (bkz. AddAddress.vue'deki AYNI not): kayitli adres
// zaten kaydedilirken bir kez dogrulanmisti, yani mount aninda da GECERLI cikar
// -- eskiden `isValid = ref(true)` ile bu VARSAYILIYORDU, simdi GERCEKTEN
// dogrulaniyor (davranis, HALIHAZIRDA kaydedilmis adresler icin AYNI).
const validation = computed(() => (address.value ? validateRecipient(address.value, vm.value) : { valid: false, reason: null }))
const isValid = computed(() => validation.value.valid)
const reason = computed(() => validation.value.reason)

const canSave = computed(() => label.value.length > 0 && isValid.value && address.value.length > 0)

// Depodaki kaydi BUL -- INDISLE, bir yuklemle DEGIL (inceleme, Bulgu A).
//
// Once `label` ile araniyordu; F4 bunu `address`e cevirdi. IKISI DE YANLISTI,
// cunku HICBIRI BENZERSIZ DEGIL:
//   - `label`: ayni kisi icin biri EVM biri Solana IKI kayit (Task 16b bunu
//     YAYGIN hale getirdi) -- Solana "Ali"yi duzenlemek EVM "Ali"nin UZERINE
//     yazardi, `remove()` de IKISINI BIRDEN silerdi.
//   - `address`: AddAddress.vue (satir 147) yinelenen kontrolu YAPMADAN push
//     eder, yani AYNI adres "Ev" ve "Is" olarak IKI KEZ kaydedilebilir --
//     `remove('Is')` IKISINI BIRDEN siler, `edit('Is')` ILK eslesen ("Ev")
//     kaydin uzerine yazar. Bu, etiketle anahtarlamaya gore bir GERILEMEYDI.
// Listedeki KONUM tanim geregi TEKTIR; SavedAddresses.vue onu zaten
// (`v-for="(savedAddress, index)"`) elinde tutuyor ve artik yayinliyor.
//
// KIMLIK DOGRULAMASI: indis ancak bu ekran acildiktan SONRA dizi degismediyse
// dogru kaydi gosterir. Kullanicinin GORDUGU kayitla (`props.savedAddress`)
// o konumdaki kayit ayni degilse HICBIR YAZMA yapilmaz -- kullanicinin hic
// gormedigi bir kaydi duzenlemek/silmek, cozdugumuz hatanin ta kendisidir.
const locateRecord = (list) => {
    const index = props.savedAddressIndex
    if (!Array.isArray(list) || !Number.isInteger(index)) return null

    const record = list[index]
    if (!record) return null
    if (record.address !== props.savedAddress.address) return null
    if (record.label !== props.savedAddress.label) return null

    return record
}

const handlePaste = async () => {
    try {
        const text = await navigator.clipboard.readText()
        if (text) address.value = text
    } catch (err) {
        console.error('Paste error:', err)
    }
}

const edit = async() => {
    if (!canSave.value) return

    // Harf kasasi KORUNUR (bkz. AddAddress.vue'deki AYNI not).
    const finalAddress = vm.value === 'solana' ? normalizeSolanaAddress(address.value) : address.value

    const { saved_addresses } = await chrome.storage.local.get('saved_addresses')
    const found = locateRecord(saved_addresses)
    if (!found) return

    found.label = label.value
    found.address = finalAddress
    await chrome.storage.local.set({ saved_addresses })
    page.currentPage = 'settings_saved_addresses'
}

const remove = async() => {
    const { saved_addresses } = await chrome.storage.local.get('saved_addresses')
    const target = locateRecord(saved_addresses)

    // Kayit bulunamadi: SILME YAPILMAZ. Eski kod bir `filter` idi ve hicbir sey
    // eslesmese bile depoyu YENIDEN YAZIYORDU; burada hic dokunmuyoruz. Listeye
    // donmek eski davranisla AYNI (eski `filter` yolu da her durumda donerdi).
    if (target) {
        // TAM OLARAK BIR kayit: `splice` indisi kullanir, bir yuklem DEGIL --
        // ayni adresi/etiketi paylasan kardes kayitlar ETKILENMEZ.
        saved_addresses.splice(props.savedAddressIndex, 1)
        await chrome.storage.local.set({ saved_addresses })
    }

    page.currentPage = 'settings_saved_addresses'
}
</script>

<style scoped>
@keyframes fade-in {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
}
.animate-fade-in {
    animation: fade-in 0.2s ease-out;
}

/* Modal Animation */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

@keyframes scale-in {
    0% { transform: scale(0.95); opacity: 0; }
    100% { transform: scale(1); opacity: 1; }
}
.animate-scale-in { animation: scale-in 0.2s ease-out; }
</style>