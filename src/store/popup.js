import { defineStore } from "pinia"
import { ref } from "vue"

export const popupStore = defineStore('popupStore', () => {
    const network_popup = ref(false)
    const bridge_to = ref(false)
    const bridge_from = ref(false)
    const bridge_to_network = ref(false)
    const bridge_from_network = ref(false)
    const bridge_settings = ref(false)
    const swap_to = ref(false)
    const swap_from = ref(false)
    const swap_from_network = ref(false)
    const swap_to_network = ref(false)
    const swap_settings = ref(false)
    const receive = ref(false)
    const token_data = ref(false)
    const addressBook = ref(false)

    return { network_popup, bridge_to, bridge_from, bridge_to_network, bridge_from_network, bridge_settings, swap_to, swap_from, swap_from_network, swap_to_network, swap_settings, receive, token_data, addressBook }
})