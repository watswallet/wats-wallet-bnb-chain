import { defineStore } from "pinia"
import { ref } from "vue"

export const cryptoStore = defineStore('cryptoStore', () => {
    const sendAsset = ref(null)
    const transactionData = ref({
        from: '',
        to: '',
        amount: '',
        // Islemle birlikte gonderilen native coin miktari (ether cinsinden string).
        // `amount` token miktariyla eziliyor (TRANSFER/APPROVE/NFT), o yuzden dapp'in
        // istedigi ETH degeri ayri tutulur - aksi halde sessizce 0'a dusuyordu.
        nativeValue: '0',
        asset: null,
        network: '',
        data: '0x'
    })
    const bridge = ref({
        inToken: null,
        outToken: null,
        toChain: null,
        amount: 0
    })
    const swap = ref({
        inToken: null,
        outToken: null
    })

    const onramp_token = ref(null)
    const user_message = ref(null)
    const selected_token_id = ref(null)
    // Home satirinin KIMLIGI: { id, chainId, address }.
    // `selected_token_id` tek basina yetmiyor — Token.vue kanonik kaydi
    // `/getTokenDataById`'den cekiyor ve o kayit chainId TASIMIYOR, `address` alani da
    // tokenin ANA zincirindeki adres (olculdu: tether -> 0xdac17f95…, Ethereum).
    // Kimlik kapida atilirsa Polygon USDT satiri Ethereum adresiyle acilir.
    const selected_token_ref = ref(null)

    // Onizlemeye gecerken saklanan gonder ekrani girdileri. App.vue ekranlari
    // `v-if` ile kurdugu icin Send.vue onizlemede sokuluyor; geri donuste form
    // bos aciliyordu. Taslak yazildigi varlik+zincire kilitlidir (utils/sendDraft.js).
    const sendDraft = ref(null)

    // TON'a ozel opsiyonel memo. Borsalar yatirimda memo ister; memosuz gonderim
    // borsada kaybolur ve geri alinamaz.
    const tonComment = ref('')

    return { sendAsset, transactionData, bridge, swap, onramp_token, user_message, selected_token_id, selected_token_ref, tonComment, sendDraft }
})