import { defineStore } from 'pinia'
import { ref } from 'vue'

// Arayuzun gizlilik durumu. KAYNAK depodur (installPrivacySync doldurur); bu
// store'a bilesenlerden YAZILMAZ.
export const privacyStore = defineStore('privacyStore', () => {
    const active = ref(false)
    const privateAddress = ref(null)
    const privateAccountKey = ref(null)
    const introSeen = ref(false)
    return { active, privateAddress, privateAccountKey, introSeen }
})
