import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { takeSignInReturn } from './lib/parley'

// The Parley sign-in popup comes back to this page: it hands the answer to the Studio that opened it and closes.
if (takeSignInReturn()) document.getElementById('root')!.textContent = 'Signed in. You can close this window.'
else createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
