<template>
    <div class="min-h-screen w-full flex flex-col items-center justify-center bg-[#050505] text-white font-sans selection:bg-indigo-500/30 selection:text-white relative overflow-hidden py-6 px-4 md:px-6">
        
        <div class="absolute top-0 left-0 md:left-1/4 w-64 h-64 md:w-150 md:h-150 bg-indigo-600/15 rounded-full blur-[80px] md:blur-[120px] animate-pulse-slow pointer-events-none"></div>
        <div class="absolute bottom-0 right-0 md:right-1/4 w-48 h-48 md:w-125 md:h-125 bg-purple-600/15 rounded-full blur-[60px] md:blur-[100px] animate-pulse-slow delay-1000 pointer-events-none"></div>

        <div class="relative w-full max-w-2xl space-y-6 md:space-y-8">
            
            <div class="flex flex-col space-y-4 md:space-y-6">
                <button 
                    @click="emit('confirmed', 'import_wallet')" 
                    class="w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full bg-white/5 backdrop-blur-xl border border-white/10 hover:bg-white/10 hover:border-white/20 hover:scale-105 transition-all duration-300 shadow-[0_4px_20px_rgba(0,0,0,0.2)] cursor-pointer"
                >
                    <svg class="w-4 h-4 md:w-5 md:h-5 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
                </button>

                <div class="space-y-2">
                    <h1 class="text-2xl md:text-4xl font-bold tracking-tight text-white drop-shadow-lg">{{ $t('onboarding.importPhrases.title') }}</h1>
                    <p class="text-zinc-400 text-sm md:text-base font-medium max-w-md">{{ $t('onboarding.importPhrases.desc') }}</p>
                </div>
            </div>

            <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 md:gap-4 w-full">
                <div class="relative p-1 bg-white/5 backdrop-blur-lg border border-white/10 rounded-xl flex items-center h-12 md:h-auto">
                    <div class="absolute top-1 bottom-1 transition-all duration-300 bg-white/10 rounded-lg shadow-inner border border-white/5"
                        :class="wordCount === 12 ? 'left-1 w-[calc(50%-4px)]' : 'left-[50%] w-[calc(50%-4px)]'"></div>
                    
                    <button @click="setWordCount(12)" class="relative flex-1 px-4 md:px-6 py-2 text-xs md:text-sm font-semibold transition-colors duration-300 cursor-pointer text-center" :class="wordCount === 12 ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'">
                        {{ $t('onboarding.importPhrases.option_12') }}
                    </button>
                    <button @click="setWordCount(24)" class="relative flex-1 px-4 md:px-6 py-2 text-xs md:text-sm font-semibold transition-colors duration-300 cursor-pointer text-center" :class="wordCount === 24 ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'">
                        {{ $t('onboarding.importPhrases.option_24') }}
                    </button>
                </div>

                <button 
                    @click="pasteFromClipboard"
                    class="flex items-center justify-center gap-2 px-4 py-3 md:py-3 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 hover:border-indigo-500/40 text-indigo-300 text-sm font-medium transition-all duration-300 group cursor-pointer active:scale-95"
                >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                    {{ $t('onboarding.importPhrases.btn_paste') }}
                </button>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-4 transition-all duration-500">
                <div 
                    v-for="(word, index) in words" 
                    :key="index"
                    class="relative group"
                >
                    <span class="absolute left-2.5 md:left-3 top-1/2 -translate-y-1/2 text-[10px] md:text-xs font-mono text-zinc-600 group-focus-within:text-indigo-400 transition-colors pointer-events-none select-none">{{ index + 1 }}.</span>
                    
                    <input 
                        v-model="words[index]"
                        type="text"
                        autocomplete="off"
                        class="w-full bg-white/5 backdrop-blur-md border border-white/10 rounded-xl py-2.5 md:py-3 pl-7 md:pl-8 pr-2 md:pr-3 text-sm md:text-base text-white placeholder-zinc-700 focus:outline-none focus:bg-white/10 focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all duration-200 shadow-sm"
                        :class="{'border-red-500/30 focus:border-red-500/50 text-red-200': isWordInvalid(index)}"
                        @paste.prevent="handlePaste($event)"
                    />
                </div>
            </div>

            <div class="pt-4 md:pt-6 pb-6 md:pb-10 space-y-4 md:space-y-6">
                <button
                    @click="confirm"
                    :disabled="!isComplete || importing"
                    class="relative w-full md:max-w-md mx-auto py-4 md:py-5 rounded-2xl font-bold text-base md:text-lg tracking-wide transition-all duration-500 overflow-hidden group flex items-center justify-center gap-3"
                    :class="isComplete && !importing
                        ? 'cursor-pointer hover:-translate-y-1 shadow-[0_0_40px_rgba(99,102,241,0.3)] hover:shadow-[0_0_60px_rgba(99,102,241,0.5)]'
                        : 'cursor-not-allowed opacity-50 grayscale'"
                >
                    <div class="absolute inset-0 transition-all duration-500"
                        :class="isComplete && !importing ? 'bg-linear-to-r from-indigo-600 via-purple-600 to-indigo-600 bg-size-[200%_auto] animate-gradient' : 'bg-white/10 backdrop-blur-md'">
                    </div>

                    <span class="relative text-white flex items-center gap-2">
                        {{ importing ? $t('onboarding.importPhrases.btn_submitting') : $t('onboarding.importPhrases.btn_submit') }}
                        <svg v-if="isComplete" class="w-4 h-4 md:w-5 md:h-5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    </span>

                    <div v-if="isComplete && !importing" class="absolute top-0 -inset-full h-full w-1/2 z-20 block transform -skew-x-12 bg-linear-to-r from-transparent to-white opacity-20 group-hover:animate-shine" />
                </button>

                <p class="text-center text-[10px] md:text-xs text-zinc-600 px-4 leading-tight">{{ $t('onboarding.importPhrases.security_note') }}</p>
            </div>
        </div>
    </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n'
import BIP39_WORDLIST from '../../data/bip39_list.json'
import { HDNodeWallet, Mnemonic, Wallet } from 'ethers'
import { userStore } from '../../store/user'
import { createVault, sha256, toHex } from '../../utils/crypto-utils'
import { isLockError, requireSessionMasterKey } from '../../utils/masterKey'
import { uniqueKey } from '../../utils/uniqueKey'
import { isTonMnemonic } from '../../utils/ton/tonMnemonic'
import { probeTonMnemonic } from '../../utils/ton/tonWalletProbe'
import { decideImport, decideAfterChoice } from '../../utils/ton/tonImportDecision'
import { buildHybridTonAccount } from '../../utils/ton/hybridTonAccount'
import { getTonClient } from '../../utils/ton/tonClient'
import { configStore } from '../../store/config'

const { t } = useI18n()

const emit = defineEmits(['confirmed', 'mnemonic', 'ton_mnemonic'])
const props = defineProps(['password'])

const user = userStore()
const config = configStore()

const importing = ref(false)

const wordCount = ref(12);
// Başlangıçta boş stringlerden oluşan dizi
const words = ref(new Array(12).fill(''));

// Kelime sayısı değiştiğinde diziyi güncelle
const setWordCount = (count) => {
    wordCount.value = count;
    // Mevcut kelimeleri koru, eğer azalıyorsa kes, artıyorsa boş ekle
    const currentWords = words.value.slice(0, count);
    while (currentWords.length < count) {
        currentWords.push('');
    }
    words.value = currentWords;
};

// Basit doğrulama (dolu mu kontrolü)
// Gerçek projede BIP39 wordlist kontrolü burada yapılabilir
const isWordInvalid = (index) => {
    // Sadece focus kaybedildiğinde veya işlem yapıldığında kontrol edilebilir
    // Şimdilik görsel demo için logic boş bırakıldı
    return false; 
};

// Tüm alanlar dolu mu?
const isComplete = computed(() => {
    return words.value.every(w => w.trim().length > 0);
});

const handlePaste = (event) => {
    const pasteData = (event.clipboardData || window.clipboardData).getData('text');
    if (!pasteData) return;

    // Kelimeleri boşluklara veya yeni satırlara göre ayır
    const pastedWords = pasteData.trim().split(/[\s\n]+/);
    
    // Eğer birden fazla kelime varsa dağıt
    if (pastedWords.length > 1) {
        pastedWords.slice(0, wordCount.value).forEach((word, i) => {
            words.value[i] = word;
        });
        // Blur effect (inputlardan çıkış yap)
        event.target.blur(); 
    } else {
        // Tek kelimeyse normal yapıştır (Vue v-model halleder ama prevent default yaptığımız için manuel set edebiliriz)
        // Ancak v-model ile çakışmaması için burada tek kelime mantığını basit bırakıyoruz.
        // Çoklu kelime için paste'i durdurduk:
    }
};

// Panodan Yapıştır Butonu için
const pasteFromClipboard = async () => {
    try {
        const text = await navigator.clipboard.readText();
        if (text) {
            // Mock event objesi oluşturup handlePaste'i çağırabiliriz veya direkt mantığı işleriz
            const pastedWords = text.trim().split(/[\s\n]+/);
            pastedWords.slice(0, wordCount.value).forEach((word, i) => {
                words.value[i] = word;
            });
        }
    } catch (err) {
        console.error('Pano erişim hatası:', err);
    }
};

const isValidWord = (word) => {
    return BIP39_WORDLIST.includes(word.toLowerCase().trim())
}

// Engel kararini, `detail`ini KAYBETMEDEN catch dalina tasir.
// Duz bir Error yalnizca `message` tasir; surum/adres/bakiye orada yok olurdu.
const blockedError = (decision) =>
    Object.assign(new Error(decision.reason), { detail: decision.detail })

// Eski surum uyarisi. Spec §12: kullanici SURUMU, ADRESI ve BAKIYEYI gormeli -
// "eski bir surumde paraniz var" tek basina kullaniciyi Tonkeeper'da nereye
// bakacagi konusunda yalniz birakir. Detay YOKSA (ileride baska bir yoldan
// gelinirse) genel metin tek basina gosterilir, bos alanli bir cumle degil.
const alertOldWalletVersion = (detail) => {
    let message = t('onboarding.importPhrases.alert_old_wallet_version')

    if (detail?.version) {
        message += '\n\n' + t('onboarding.importPhrases.alert_old_wallet_detail', {
            version: detail.version,
            address: detail.address,
            balance: detail.balance,
        })
    }

    return alert(message)
}

const importTonWallet = async (mnemonic) => {
    let { vaults = [] } = await chrome.storage.local.get('vaults')

    // Ilk cuzdan: sifre adimina devredilir, kasa orada kurulur (CreatePassword2).
    if (!vaults.length) {
        emit('confirmed', 'password')
        emit('ton_mnemonic', mnemonic)
        return
    }

    const masterKey = await requireSessionMasterKey()

    let totalIndex = 1
    for (const vault of vaults) totalIndex += vault?.accounts?.length

    // TEK HESAP, IKI ZINCIR. Hesap siradan bir HD hesabidir - EVM adresi var,
    // kopru ve dapp acik - ve TON tarafi ice aktarilan kasadan gelir. Kural
    // yardimcida: iki kurulum yolu (bu dosya ve CreatePassword2) AYNI kurali
    // okumali, yoksa kullanici hangi kapidan girdigine gore farkli bir cuzdan alir.
    let built
    try {
        built = await buildHybridTonAccount(masterKey, mnemonic, {
            name: 'Wats ' + totalIndex,
            existingVaults: vaults,
        })
    } catch (err) {
        if (err?.message === 'TON_VAULT_ALREADY_IMPORTED') {
            return alert(t('onboarding.importPhrases.alert_already_imported'))
        }
        throw err
    }

    const { tonVault, evmVault, account } = built

    vaults.push(tonVault)
    // 'linked' dalinda EVM kasasi YOKTUR: kullanici turetilmis ifadeyi ayrica elle
    // ice aktarmis ve yardimci var olan hesabi damgalamis. Kosulsuz push,
    // `vaults`a undefined sokar.
    if (evmVault) vaults.push(evmVault)

    // TEK YAZIM: ikinci bir `set` patlasaydi kullanici yarim kurulumla kalirdi.
    await chrome.storage.local.set({ vaults, active_account: account })
    user.vault = evmVault ?? tonVault

    emit('confirmed', 'ready')
}

const confirm = async() => {
    if (!isComplete.value || importing.value) return

    importing.value = true

    try {
        const mnemonicWords = words.value.slice(0, wordCount.value)

        const hasEmptyWords = mnemonicWords.some(word => !word.trim())
        if (hasEmptyWords) throw new Error('Tüm kelimeleri doldurun')

        const hasInvalidWords = mnemonicWords.some(word => !isValidWord(word))
        if (hasInvalidWords) throw new Error('Geçersiz kelimeler mevcut')

        const mnemonic = mnemonicWords.join(' ')

        // IKI dogrulama da calisir - biri tuttugunda DURULMAZ.
        //
        // Durulsaydi cakisma hic fark edilmez ve karar sabit siraya duserdi.
        // Olculdu: bir TON ifadesinin ayrica BIP39-gecerli cikma olasiligi
        // ~500'de bir; sabit sirayla her 500 Tonkeeper ice aktarmasindan biri
        // sessizce yanlis adres uretirdi (spec §8).
        const bip39Valid = Mnemonic.isValidMnemonic(mnemonic)
        const tonValid = await isTonMnemonic(mnemonicWords)

        // Zincire YALNIZCA gerektiginde sorulur: TON ihtimali varsa. Sıradan bir
        // BIP39 ice aktarmasi (vakalarin cok buyuk cogunlugu) ag beklemez.
        let probe = { candidates: [], failed: false }
        if (tonValid) {
            const kinds = bip39Valid ? ['tonMnemonic', 'bip39'] : ['tonMnemonic']
            probe = await probeTonMnemonic({ mnemonic, kinds, client: getTonClient(config.api) })
        }

        const decision = decideImport({ bip39Valid, tonValid, probe })

        // Engel SEBEBIYLE tasinir: `detail` (surum, adres, bakiye) catch dalinda
        // kullaniciya gosteriliyor (spec §12). Duz `new Error(reason)` onu
        // dusuruyordu ve kullanici hangi surumde ne kadar parasi kaldigini
        // goremiyordu.
        if (decision.action === 'blocked') throw blockedError(decision)

        let kind = decision.kind

        // 'ask' BIR SORUDUR (spec §8 ve §12), cikmaz sokak degil.
        //
        // Eskiden burada MNEMONIC_AMBIGUOUS firlatiliyor ve kullanici "ag ayirt
        // edemedi, lutfen tekrar deneyin" uyarisi aliyordu. Iki ulasilabilir
        // durumda da yanlisti:
        //
        //  1) Ifade iki turetmede de VARLIKLI. Ag gayet ayirt etti - iki cevap da
        //     dolu geldi. Mesaj FAKTUEL OLARAK YANLIS, ve karar deterministik
        //     oldugu icin "tekrar dene" ayni yere cikiyor: o cuzdan HIC
        //     aktarilamiyordu.
        //  2) Cift-gecerli ifade + RPC kesintisi (probe.failed). Mesaj dogru ama
        //     yine bir cikis yok.
        //
        // Karar katmani zaten dogru modelliyor (tonImportDecision.js: 'ask'); eksik
        // olan tek sey ekranin soruyu SORMASIYDI. Tamam -> TON, Iptal -> BIP39.
        if (decision.action === 'ask') {
            // `confirm` bu dosyada YEREL FONKSIYON ADI (bu fonksiyonun kendisi),
            // yani ciplak `confirm(...)` kendini cagirirdi. `window` KULLANILMAZ
            // (bkz. tonMnemonic.js: MV3'te window yok) - globalThis her iki
            // baglamda da dogru nesneyi verir.
            const picked = globalThis.confirm(t('onboarding.importPhrases.confirm_ambiguous_choice'))
                ? 'tonMnemonic'
                : 'bip39'

            // CEVAP DA AYNI KAPIDAN GECER (spec §7).
            //
            // Bu satir olmadan yeni bir delik aciliyordu: cift-gecerli bir ifadede
            // TON parasi v4R2'de, BIP39 tarafi da doluysa `has(candidates,
            // 'tonMnemonic')` v4R2 adayiyla TRUE olur, karar 'ask'e gider ve
            // kullanici TON'u secince BOS bir W5 cuzdani UYARISIZ aktarilirdi -
            // oysa engeli tetikleyecek kanit `probe.candidates` icinde ZATEN
            // duruyor. Onceden bu yol vakumda guvenliydi cunku 'ask' firlatiyordu;
            // soruyu sormak yolu ULASILABILIR yapti.
            const resolved = decideAfterChoice({ kind: picked, probe })
            if (resolved.action === 'blocked') throw blockedError(resolved)

            kind = resolved.kind
        } else if (decision.reason === 'MNEMONIC_AMBIGUOUS') {
            // Cakisma vardi ama zincir ayirt etti / ikisi de bostu: sessiz kalinmaz.
            alert(t('onboarding.importPhrases.alert_ambiguous_resolved'))
        }

        if (kind === 'tonMnemonic') {
            await importTonWallet(mnemonic)
            return
        }

        const wallet = Wallet.fromPhrase(mnemonic)
        const hdNode = HDNodeWallet.fromPhrase(mnemonic)
        const seed = hdNode.privateKey

        const hash = await sha256(new TextEncoder().encode(seed))
        const fingerprint = toHex(hash)

        let { vaults = [] } = await chrome.storage.local.get('vaults')

        if(!vaults.length) {
            emit('confirmed', 'password')
            emit('mnemonic', mnemonic)
            return
        }

        const exists = vaults.some(v => v.fingerprint === fingerprint)
        if(exists) return alert(t('onboarding.importPhrases.alert_already_imported'))

        user.address = wallet.address

        let index = 0
        let totalIndex = 1

        const path = `m/44'/60'/0'/0/${index}`

        for (const vault of vaults) {
            totalIndex += vault?.accounts?.length
        }

        const account = {
            name: 'Wats ' + totalIndex,
            type: 'hd',
            derivationPath: path,
            index,
            address: wallet.address,
            createdAt: new Date().toISOString(),
            key: uniqueKey()
        }

        // Buraya yalnızca mevcut bir cüzdana kasa eklenirken gelinir (kasa yoksa
        // yukarıda erken çıkılıp şifre adımına devredilir). O yüzden master key
        // diskten değil, açık oturumun belleğinden alınır.
        const masterKey = await requireSessionMasterKey()

        const vault = await createVault(masterKey, mnemonic, account)

        vaults.push(vault)

        await chrome.storage.local.set({ vaults })
        await chrome.storage.local.set({ active_account: account })

        user.vault = vault

        emit('confirmed', 'ready')

    } catch (error) {
        console.error(error.message)

        // Master key alınamadığında kullanıcı eskiden hiçbir şey görmüyordu: buton
        // çalışmıyor gibi görünüyordu. Kilit durumu normal bir durum, sessiz kalmamalı.
        if (isLockError(error)) {
            return alert(t('onboarding.importPhrases.alert_wallet_locked'))
        }

        if (error.message === 'TON_OLD_WALLET_VERSION') {
            return alertOldWalletVersion(error.detail)
        }

        if (error.message === 'TON_MNEMONIC_INVALID') {
            return alert(t('onboarding.importPhrases.alert_invalid_checksum'))
        }

        alert(t('onboarding.importPhrases.alert_import_failed'))
    } finally {
        importing.value = false
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

@keyframes shine {
    100% { left: 125%; }
}
.animate-shine {
    animation: shine 0.75s;
}
</style>