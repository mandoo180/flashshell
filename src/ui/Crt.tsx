import type { ReactNode } from 'react'
import './theme.css'

export function Crt({ children }: { children: ReactNode }) {
  return <div className="crt">{children}</div>
}
