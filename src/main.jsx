import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ProductionDashboard from './ProductionDashboard.jsx'

const isOldPage = typeof window !== 'undefined' && window.location.search.includes('page=old')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isOldPage ? <App /> : <ProductionDashboard />}
  </React.StrictMode>,
)
