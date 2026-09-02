export function shortenAddress(address, start = 6, end = 4) {
  if (!address || address.length < start + end) return address
  return `${address.slice(0, start)}...${address.slice(-end)}`
}