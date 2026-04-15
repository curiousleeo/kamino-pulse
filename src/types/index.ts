export type RiskTier = 'green' | 'yellow' | 'orange' | 'red' | 'loading' | 'error'

export interface RiskSignal {
  label: string
  value: string
  status: 'green' | 'yellow' | 'orange' | 'red'
  detail?: string
}

export interface RiskLayer {
  id: string
  name: string
  description: string
  tier: RiskTier
  signals: RiskSignal[]
}
