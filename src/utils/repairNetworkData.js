export async function repairRpcFormat() {
    try {
        const { currentNetwork } = await chrome.storage.local.get('currentNetwork')
        if (!currentNetwork) return

        if (currentNetwork.rpc && typeof currentNetwork.rpc === 'object' && !Array.isArray(currentNetwork.rpc)) {            
            currentNetwork.rpc = Object.values(currentNetwork.rpc)
            await chrome.storage.local.set({ currentNetwork })
        }
        
    } catch (error) {
        console.error("repairRpcFormat error", error.message)
    }
}