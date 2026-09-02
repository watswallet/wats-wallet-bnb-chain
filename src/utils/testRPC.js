// VAR OLMAYAN bir islemin hash'i. Saglikli her dugum bunun icin `result: null` doner:
// zincir verisi gerekmez, onbellek etkilemez, hicbir hesaba bagli degildir.
//
// SIFIR HASH KULLANILMAZ: Nethermind (Gnosis) 0x000... icin -32603 "Internal error"
// dondurur ve calisir durumdaki bir ucu bozuk gosterirdi. Sifir olmayan bu sabit
// 2026-08-05'te on zincirin tum uclarinda dogrulandi.
export const RECEIPT_PROBE_HASH =
    '0x7a1c9f3e5d2b84760ae1cf03b95d6247e803fa1b6cd2947e5081b3fa6c2d9e14'

// eth_blockNumber/net_version/eth_chainId cevaplayan bir uc MAKBUZ veremiyor olabilir:
// publicnode uclari 2026-08-05'te Arbitrum/Base/BSC'de eth_getTransactionReceipt'i
// ucretli token arkasina aldi (-32602). Boyle bir uc secilirse ethers waitForTransaction
// hatayi yutup her blokta yeniden dener ve TX_WAIT_TIMEOUT_MS sonunda TIMEOUT verir:
// zincirde BASARILI islem kullaniciya "islem sonucu dogrulanamadi" olarak gosterilir
// (ATS akisinda transfer op'u hic gonderilmez). Bu yuzden canlilik TEK BASINA yeterli
// bir saglik olcutu degildir.
const probeReceiptSupport = async (rpcUrl, timeout) => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_getTransactionReceipt',
                params: [RECEIPT_PROBE_HASH],
                id: Math.floor(Math.random() * 10000)
            }),
            signal: controller.signal,
            cache: 'no-cache'
        })

        if (!response.ok) return { ok: false, rpcError: `HTTP_${response.status}` }

        const data = await response.json()
        if (data?.error) return { ok: false, rpcError: data.error.message }

        // Bulunmayan islem icin DOGRU cevap `result: null`. Alan hic yoksa uc bu
        // methodu tanimiyor demektir - makbuz beklemek yine sonsuza kadar surerdi.
        if (!data || !('result' in data)) return { ok: false, rpcError: 'NO_RESULT' }

        return { ok: true }
    } catch (error) {
        return { ok: false, rpcError: error.name === 'AbortError' ? 'TIMEOUT' : error.message }
    } finally {
        clearTimeout(timeoutId)
    }
}

export const testRPC = async (rpcUrl, timeout = 3000) => {
    const start = performance.now() // More precise timing
    
    try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeout)
        
        // Use multiple quick methods to test RPC reliability
        const testMethods = [
            {
                method: 'eth_blockNumber',
                params: [],
                validator: (result) => result && typeof result === 'string' && result.startsWith('0x')
            },
            {
                method: 'net_version', 
                params: [],
                validator: (result) => result && (typeof result === 'string' || typeof result === 'number')
            },
            {
                method: 'eth_chainId',
                params: [],
                validator: (result) => result && typeof result === 'string' && result.startsWith('0x')
            }
        ]
        
        // Pick a random method for variety and to avoid caching
        const testMethod = testMethods[Math.floor(Math.random() * testMethods.length)]
        
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: testMethod.method,
                params: testMethod.params,
                id: Math.floor(Math.random() * 10000) // Random ID to avoid caching
            }),
            signal: controller.signal,
            cache: 'no-cache'
        })
        
        clearTimeout(timeoutId)
        const responseTime = performance.now() - start
        
        if (!response.ok) {
            return { 
                ok: false, 
                ms: Math.round(responseTime), 
                error: `HTTP_${response.status}`,
                status: response.status
            }
        }
        
        const data = await response.json()
        const totalTime = performance.now() - start
        
        // Validate response structure
        if (!data || data.jsonrpc !== '2.0') {
            return { 
                ok: false, 
                ms: Math.round(totalTime), 
                error: 'INVALID_JSONRPC' 
            }
        }
        
        if (data.error) {
            return { 
                ok: false, 
                ms: Math.round(totalTime), 
                error: `RPC_${data.error.code || 'ERROR'}`,
                rpcError: data.error.message
            }
        }
        
        // Validate result using the method's validator
        if (!testMethod.validator(data.result)) {
            return { ok: false,  ms: Math.round(totalTime), error: 'INVALID_RESULT' }
        }

        // Canli olmak yetmez: uc makbuz da verebilmeli. Sure OLCUMUNE katilmaz;
        // yalnizca gecerlilik kapisidir (yukaridaki probeReceiptSupport notu).
        const receipts = await probeReceiptSupport(rpcUrl, timeout)
        if (!receipts.ok) {
            return {
                ok: false,
                ms: Math.round(totalTime),
                error: 'NO_RECEIPTS',
                rpcError: receipts.rpcError
            }
        }

        // Calculate quality score based on response time
        const getQualityScore = (ms) => {
            if (ms < 100) return 'excellent'
            if (ms < 300) return 'good'
            if (ms < 800) return 'fair'
            if (ms < 2000) return 'poor'
            return 'very_poor'
        }
        
        return { 
            ok: true, 
            ms: Math.round(totalTime),
            quality: getQualityScore(totalTime),
            method: testMethod.method,
            // Keep backward compatibility
            block: testMethod.method === 'eth_blockNumber' ? parseInt(data.result, 16) : undefined,
            chainId: testMethod.method === 'eth_chainId' ? parseInt(data.result, 16) : undefined,
            result: data.result
        }
        
    } catch (error) {
        const totalTime = performance.now() - start
        
        let errorType = 'NETWORK_ERROR'
        if (error.name === 'AbortError') errorType = 'TIMEOUT'
        else if (error.name === 'TypeError') errorType = 'CONNECTION_ERROR'
        else if (error.message.includes('JSON')) errorType = 'PARSE_ERROR'
        
        return { 
            ok: false, 
            ms: Math.round(totalTime), 
            error: errorType,
            message: error.message
        }
    }
}

export const testMultipleRPCs = async (rpcUrls, timeout = 3000, options = {}) => {
    if (!rpcUrls || rpcUrls.length === 0) return []
    
    const {
        stopOnGoodRPC = true,
        excellentThreshold = 150, // ms - anything under this is considered excellent
        goodThreshold = 400,      // ms - anything under this is considered good
        minTestsBeforeEarlyStop = 3 // test at least 3 RPCs before potentially stopping
    } = options
        
    // Process in batches to avoid overwhelming the browser
    const batchSize = 5
    const allResults = []
    let foundExcellentRPC = false
    
    for (let i = 0; i < rpcUrls.length && !foundExcellentRPC; i += batchSize) {
        const batch = rpcUrls.slice(i, i + batchSize)
        
        const batchPromises = batch.map(async (url, index) => {
            const results = []
            
            // Run 2 tests for better reliability
            for (let testRun = 0; testRun < 2; testRun++) {
                const result = await testRPC(url, timeout)
                results.push(result)
                
                if (testRun === 0 && !result.ok && ['TIMEOUT', 'CONNECTION_ERROR'].includes(result.error)) break
                if (testRun === 0) await new Promise(resolve => setTimeout(resolve, 50))
            }
            
            // Calculate average metrics from successful tests
            const successful = results.filter(r => r.ok)
            const successRate = successful.length / results.length
            
            if (successful.length === 0) {
                return {
                    url,
                    ok: false,
                    ms: results[0].ms,
                    error: results[0].error,
                    successRate: 0,
                    quality: 'failed'
                }
            }
            
            const avgMs = Math.round(successful.reduce((sum, r) => sum + r.ms, 0) / successful.length)
            const bestResult = successful.reduce((best, current) => 
                current.ms < best.ms ? current : best
            )
            
            return {
                url,
                ok: successRate >= 0.5, // At least 50% success rate
                ms: avgMs,
                bestMs: bestResult.ms,
                successRate,
                quality: bestResult.quality,
                block: bestResult.block,
                chainId: bestResult.chainId,
                method: bestResult.method,
                error: results.find(r => !r.ok)?.error,
                isExcellent: avgMs <= excellentThreshold && successRate >= 0.9,
                isGood: avgMs <= goodThreshold && successRate >= 0.8
            }
        })
        
        const batchResults = await Promise.allSettled(batchPromises)
        const processedResults = batchResults.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value
            } else {
                return {
                    url: batch[index],
                    ok: false,
                    ms: timeout,
                    error: 'PROMISE_REJECTED',
                    successRate: 0,
                    quality: 'failed',
                    isExcellent: false,
                    isGood: false
                }
            }
        })
        
        allResults.push(...processedResults)
        
        // Check for excellent RPCs after we have minimum tests
        if (stopOnGoodRPC && allResults.length >= minTestsBeforeEarlyStop) {
            const excellentRPC = processedResults.find(r => r.isExcellent)
            
            if (excellentRPC) {
                foundExcellentRPC = true
                break
            }
            
            // If we haven't found excellent but found good ones, consider stopping after more tests
            const goodRPCs = allResults.filter(r => r.isGood)
            if (goodRPCs.length > 0 && allResults.length >= Math.min(10, rpcUrls.length * 0.3)) {
                foundExcellentRPC = true // Use same flag to stop the loop
                break
            }
        }
    }
    
    const sortedResults = allResults.sort((a, b) => {
        if (a.isExcellent !== b.isExcellent) return b.isExcellent - a.isExcellent
        if (a.isGood !== b.isGood) return b.isGood - a.isGood
        if (a.ok !== b.ok) return b.ok - a.ok
        if (a.ok && b.ok && a.successRate !== b.successRate) return b.successRate - a.successRate
        
        return a.ms - b.ms
    })
    
    return sortedResults
}

export const findFastestRPC = async (rpcUrls, timeout = 3000, options = {}) => {
    if (!rpcUrls || rpcUrls.length === 0) return null
    
    const {
        stopOnGoodRPC = true,
        excellentThreshold = 150,
        goodThreshold = 400,
        minTestsBeforeEarlyStop = 3
    } = options
    
    const results = await testMultipleRPCs(rpcUrls, timeout, {
        stopOnGoodRPC,
        excellentThreshold,
        goodThreshold,
        minTestsBeforeEarlyStop
    })
    
    const fastestWorking = results.find(r => r.ok)
    
    if (!fastestWorking) return null
    
    // Determine what type of RPC we found
    let performanceCategory = 'working'
    if (fastestWorking.isExcellent) performanceCategory = 'excellent'
    else if (fastestWorking.isGood) performanceCategory = 'good'
    
    // Return enhanced result with additional info
    return {
        ...fastestWorking,
        performanceCategory,
        alternatives: results.filter(r => r.ok).slice(1, 4), // Top 3 alternatives
        totalTested: results.length, // Now shows actual tested count
        totalProvided: rpcUrls.length,
        totalWorking: results.filter(r => r.ok).length,
        earlyStopped: stopOnGoodRPC && results.length < rpcUrls.length,
        timeSaved: stopOnGoodRPC && results.length < rpcUrls.length ? rpcUrls.length - results.length : 0
    }
}