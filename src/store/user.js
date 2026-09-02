import { defineStore } from "pinia"
import { ref } from "vue"

export const userStore = defineStore('userStore', () => {
    const address = ref(null)
    const usd = ref(0)
    const tokenBalances = ref({})
    const vault = ref(null)
    const percentageUSD = ref(0)
    const percentage = ref(0)
    const firstUpdate = ref(true)

    return { address, usd, tokenBalances, vault, percentage, percentageUSD, firstUpdate }
})