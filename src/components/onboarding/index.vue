<template>
    <div class="relative min-h-screen w-full bg-[#050505] overflow-hidden">
        
        <Transition :name="transitionName">
            <Start 
                v-if="status === 'start'" 
                @newwallet="changeStatus" 
            />
            
            <ImportWallet 
                v-else-if="status === 'import_wallet'" 
                @confirmed="changeStatus" 
            />

            <CreatePassword2
                v-else-if="status === 'password' && (private_key || mnemonic || ton_mnemonic)"
                :private_key="private_key"
                :mnemonic="mnemonic"
                :ton_mnemonic="ton_mnemonic"
                @confirmed="changeStatus"
            />
            
            <CreatePassword 
                v-else-if="status === 'password'" 
                @create_wallet="changeStatus" 
                @wallet_created="setMnemonic" 
                @password_created="setPassword" 
                @confirmed="changeStatus" 
            />

            <Phrases 
                v-else-if="status === 'create_wallet' && mnemonic" 
                :mnemonic="mnemonic" 
                @phrases_saved="changeStatus" 
            />
            
            <ImportPhrases
                v-else-if="status === 'import_phrases'"
                @confirmed="changeStatus"
                @mnemonic="setMnemonic"
                @ton_mnemonic="setTonMnemonic"
            />
            
            <ImportPrivate 
                v-else-if="status === 'import_private'" 
                :user_password="password" 
                @confirmed="changeStatus" 
                @private_key="setPrivateKey" 
            />

            <CreateUsername 
                v-else-if="status === 'create_username'" 
                @confirmed="changeStatus" 
            />

            <Ready 
                v-else-if="status === 'ready'" 
            />
        </Transition>
    </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import CreatePassword from './CreatePassword.vue'
import Start from './Start.vue'
import Phrases from './Phrases.vue'
import CreateUsername from './CreateUsername.vue'
import ImportWallet from './ImportWallet.vue'
import ImportPhrases from './ImportPhrases.vue'
import Ready from './Ready.vue'
import CreatePassword2 from './CreatePassword2.vue'
import ImportPrivate from './ImportPrivate.vue'

const status = ref('start')
const mnemonic = ref(null)
const password = ref(null)
const private_key = ref(null)
const ton_mnemonic = ref(null)
const transitionName = ref('slide-right') // Varsayılan animasyon yönü

// 1. Ekran Sıralaması (Hangi ekranın nerede olduğunu bilmek için)
// Bu harita, ileri mi yoksa geri mi gidildiğini anlamamızı sağlar.
const screenOrder = {
    'start': 1,
    'import_wallet': 2,    // İçe aktarma yolu
    'password': 2,         // Yeni cüzdan yolu (Paralel seviye)
    'create_wallet': 3,    // Mnemonic gösterme
    'import_phrases': 3,   // Mnemonic girme
    'import_private': 3,   // Key girme
    'create_username': 4,
    'ready': 5
}

// Cüzdan zaten varsa 'start' ve 'password' adımları YASAK.
// Aksi halde: Ayarlar > Cüzdan Ekle onboarding'i açar (import_wallet), oradaki geri
// tuşu 'start'a düşer, "yeni cüzdan oluştur" CreatePassword'ü çalıştırır ve o da
// walletSalt'ı koşulsuz ezer — mevcut TÜM kasalar kalıcı olarak açılamaz hale gelir.
// Bu iki ekran yalnızca ilk cüzdan içindir.
const walletExists = ref(false)
const FIRST_WALLET_ONLY = ['start', 'password']

// Yarım kalan bir içe aktarmanın sırrı bir sonraki akışa TAŞINMAMALI.
// Aksi halde: "Cüzdanı içe aktar > Gizli ifade" > ifadeyi yaz > Geri > "Yeni cüzdan
// oluştur" — status 'password' olur ama mnemonic hâlâ dolu olduğu için CreatePassword2
// render edilir; kullanıcı yepyeni bir cüzdan ürettiğini sanırken vazgeçtiği ifade
// içe aktarılır ve seed yedekleme ekranını hiç görmez.
const clearImportSecrets = (...refs) => refs.forEach(r => { r.value = null })

// 2. Status Değiştirme Fonksiyonu (Animasyon Yönü Burada Belirlenir)
const changeStatus = (newStatus) => {
    if (walletExists.value && FIRST_WALLET_ONLY.includes(newStatus)) {
        // Kullanıcı buraya popup'tan geldi; sekmeyi kapatmak onu cüzdana geri götürür.
        window.close()
        return
    }

    // Akışın başına dönmek her şeyi sıfırlar; bir içe aktarma türüne girmek de
    // diğerinin yarım kalan sırrını siler (ikisi birden doluysa yanlışı kazanıyordu).
    if (newStatus === 'start' || newStatus === 'import_wallet') clearImportSecrets(mnemonic, private_key, ton_mnemonic, password)
    else if (newStatus === 'import_phrases') clearImportSecrets(private_key)
    else if (newStatus === 'import_private') clearImportSecrets(mnemonic, ton_mnemonic)

    const currentOrder = screenOrder[status.value] || 0
    const newOrder = screenOrder[newStatus] || 0

    if (newStatus === 'ready') transitionName.value = 'zoom-fade'
    else if (newOrder < currentOrder) transitionName.value = 'slide-left' 
    else transitionName.value = 'slide-right'

    // Durumu güncelle
    status.value = newStatus
}

const setMnemonic = data => {
    mnemonic.value = data
}

const setTonMnemonic = data => {
    ton_mnemonic.value = data
}

const setPassword = data => {
    password.value = data
}

const setPrivateKey = data => {
    private_key.value = data
}

onMounted(async() => {
    try {
        const { vaults } = await chrome.storage.local.get('vaults')

        // popup/App.vue:287 ile aynı ölçüt: boş dizi "cüzdan yok" demek.
        walletExists.value = Array.isArray(vaults) && vaults.length > 0
        status.value = walletExists.value ? 'import_wallet' : 'start'
    } catch (e) {
        console.log("Storage error or dev mode", e)
    }
})
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Roboto:ital,wght@0,100..900;1,100..900&display=swap');

* {
    font-family: "Inter", sans-serif;
}

.slide-right-enter-active,
.slide-right-leave-active {
    transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    position: absolute; /* ÖNEMLİ: Üst üste binmeleri için */
    width: 100%;
    top: 0;
    left: 0;
}

.slide-right-enter-from {
    opacity: 0;
    transform: translateX(50px) scale(0.95); /* Sağdan gelir */
    filter: blur(5px);
}

.slide-right-leave-to {
    opacity: 0;
    transform: translateX(-50px) scale(1.05); /* Sola gider */
    filter: blur(5px);
}

/* --- GERİ (Back - Slide Left) --- */
.slide-left-enter-active,
.slide-left-leave-active {
    transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    position: absolute;
    width: 100%;
    top: 0;
    left: 0;
}

.slide-left-enter-from {
    opacity: 0;
    transform: translateX(-50px) scale(0.95); /* Soldan gelir */
    filter: blur(5px);
}

.slide-left-leave-to {
    opacity: 0;
    transform: translateX(50px) scale(1.05); /* Sağa gider */
    filter: blur(5px);
}

/* --- FINAL EKRANI (Zoom Fade) --- */
.zoom-fade-enter-active {
    transition: all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1);
    position: absolute;
    width: 100%;
    top: 0;
    left: 0;
    z-index: 50;
}
.zoom-fade-leave-active {
    transition: all 0.5s ease-in;
    position: absolute;
    width: 100%;
    top: 0;
    left: 0;
}

.zoom-fade-enter-from {
    opacity: 0;
    transform: scale(0.5);
    filter: blur(20px);
}

.zoom-fade-leave-to {
    opacity: 0;
    transform: scale(1.5);
    filter: blur(20px);
}

/* --- Diğer Animasyonlar --- */
@keyframes pulse-slow {
    0%, 100% { opacity: 0.6; transform: scale(1); }
    50% { opacity: 0.2; transform: scale(2); }
}

.animate-pulse-slow {
    animation: pulse-slow 8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>