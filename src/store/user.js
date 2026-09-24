import { defineStore } from "pinia"
import { ref } from "vue"

export const userStore = defineStore('userStore', () => {
    const address = ref(null)
    // AKTIF HESABIN KENDISI, yalnizca adresi degil.
    //
    // Paneller arasi koprü (utils/uiSync.js) bugune kadar SADECE `address`i
    // tasiyordu; Header'in gosterdigi ad/avatar/profil ise adresten TUREMEZ,
    // hesap NESNESINDEN gelir. Sonuc: B panelinde Home YENI hesabin
    // bakiyelerini gosterirken baslik ONCEKI hesabin adinda kaliyordu --
    // bir cuzdanda "hangi hesaptan harciyorum" sorusunu yanlis cevaplatan
    // gercek bir yanlis okuma riski.
    const activeAccount = ref(null)
    const usd = ref(0)
    const tokenBalances = ref({})
    const vault = ref(null)
    const percentageUSD = ref(0)
    const percentage = ref(0)
    const firstUpdate = ref(true)

    // `tokenBalances` HANGI HESABA AIT. Sozlugun silinip silinmeyecegine bu
    // karar verir (bkz. Home.vue loadCurrentTokens): bayat bakiye AYNI hesapta
    // zararsizdir -- RPC gecici olarak dustugunde elde duran tek dogru veridir --
    // ama BASKA bir hesabin bakiyesi ekranda kalirsa kullaniciya baskasinin
    // parasi gosterilir.
    //
    // Bilesen icinde DEGIL burada: Home, home -> token -> home dolasiminda
    // sokulup yeniden kuruluyor. Hafiza bilesende yasasaydi her yeniden kurulum
    // "hesap degisti" sayilir ve sozluk -- dolayisiyla ag filtresi secili
    // ekrandaki toplam -- her gezinmede sifirlanirdi.
    const balancesAccountKey = ref(null)

    return { address, activeAccount, usd, tokenBalances, vault, percentage, percentageUSD, firstUpdate, balancesAccountKey }
})