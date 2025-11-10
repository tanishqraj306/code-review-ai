// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { ThemeProvider } from './components/ThemeProvider.tsx'
import { BrowserRouter } from 'react-router-dom' // <-- Import

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <BrowserRouter> {/* <-- Add this wrapper */}
        <App />
      </BrowserRouter> {/* <-- And this closing tag */}
    </ThemeProvider>
  </React.StrictMode>,
)
