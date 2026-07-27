import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { load } from './store'
import './styles.css'

// On rend après le chargement : pas d'écran vide intermédiaire à gérer.
void load().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
