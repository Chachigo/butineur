import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { load } from './store'
import './styles.css'

// Render after loading: no intermediate blank screen to deal with.
void load().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
