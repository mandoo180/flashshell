import { useGame } from './store'
import { Crt } from './Crt'
import { Play } from './Play'
import { LevelSelect } from './LevelSelect'

export function App() {
  const screen = useGame((s) => s.screen)
  return <Crt>{screen === 'levels' ? <LevelSelect /> : <Play />}</Crt>
}
