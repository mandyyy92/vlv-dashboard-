import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ProductionDashboard from './ProductionDashboard.jsx'

const isProductionPage = typeof window !== 'undefined' && window.location.search.includes('page=production')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isProductionPage ? <ProductionDashboard /> : <App />}
  </React.StrictMode>,
)
