export function formatDisplayValue(value: number) {
  return Math.abs(value) >= 100 ? Math.round(value).toString() : value.toFixed(1)
}

export function formatRoundedInteger(value: number) {
  return Math.round(value).toString()
}

export function formatPathwayPValue(value: number) {
  if (!Number.isFinite(value)) {
    return 'n/a'
  }
  return value < 0.001 ? value.toExponential(2) : value.toFixed(3)
}
