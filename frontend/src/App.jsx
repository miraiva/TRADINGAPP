import React, { useState, useEffect } from 'react'
import BuyModal from './components/BuyModal'
import Dashboard from './components/Dashboard'
import ZerodhaAuth from './components/ZerodhaAuth'
import Settings from './components/Settings'
import PayinModal from './components/PayinModal'
import PayinsTable from './components/PayinsTable'
import SnapshotsTable from './components/SnapshotsTable'
import Charts from './components/Charts'
import ZerodhaSyncPanel from './components/ZerodhaSyncPanel'
import ActionSidePanel from './components/ActionSidePanel'
import SliderPanel from './components/SliderPanel'
import DecisionAssistant from './components/DecisionAssistant'
import GoogleAuth from './components/GoogleAuth'
import { getDemoMode } from './utils/displayUtils'
import { getAccountDetails, syncAccountDetailsFromDatabase } from './utils/accountUtils'
import './App.css'

function App() {
  // Check authentication synchronously on initial render
  const checkAuthSync = () => {
    const token = localStorage.getItem('auth_token')
    const userStr = localStorage.getItem('user')
    
    if (token && userStr) {
      try {
        const userData = JSON.parse(userStr)
        return { authenticated: true, user: userData }
      } catch (err) {
        // Invalid user data, clear it
        localStorage.removeItem('auth_token')
        localStorage.removeItem('user')
        return { authenticated: false, user: null }
      }
    }
    return { authenticated: false, user: null }
  }

  const initialAuth = checkAuthSync()
  const [refreshKey, setRefreshKey] = useState(0)
  const [sliderOpen, setSliderOpen] = useState(false)
  const [sliderContent, setSliderContent] = useState(null)
  const [sliderTitle, setSliderTitle] = useState('')
  const [headerSubtitle, setHeaderSubtitle] = useState('')
  const [isAuthenticated, setIsAuthenticated] = useState(initialAuth.authenticated)
  const [user, setUser] = useState(initialAuth.user)

  // Get header subtitle based on demo mode and user name
  const updateHeaderSubtitle = () => {
    const isDemoMode = getDemoMode()
    
    if (isDemoMode) {
      setHeaderSubtitle('Demo Account')
    } else {
      // Get user name from account details
      const accountDetails = getAccountDetails()
      const defaultTradingAccount = localStorage.getItem('default_trading_account')
      
      let userName = null
      if (defaultTradingAccount && accountDetails[defaultTradingAccount]) {
        userName = accountDetails[defaultTradingAccount].user_name
      } else {
        // Try to get from any account
        const accountIds = Object.keys(accountDetails)
        if (accountIds.length > 0) {
          userName = accountDetails[accountIds[0]].user_name
        }
      }
      
      // Also check tokens for user name
      if (!userName) {
        try {
          const tokensJson = localStorage.getItem('zerodha_account_tokens')
          const tokens = tokensJson ? JSON.parse(tokensJson) : {}
          if (defaultTradingAccount && tokens[defaultTradingAccount]) {
            userName = tokens[defaultTradingAccount].user_name
          } else if (Object.keys(tokens).length > 0) {
            const firstTokenKey = Object.keys(tokens)[0]
            userName = tokens[firstTokenKey].user_name
          }
        } catch {
          // Ignore errors
        }
      }
      
      setHeaderSubtitle(userName || '')
    }
  }

  // Verify authentication token is still valid (optional - can check with backend)
  useEffect(() => {
    // If we have a token, we could verify it with the backend here
    // For now, we'll just rely on the token being present
    // The API interceptor will handle 401 errors and clear the token
  }, [])

  // Sync account details from database on mount (only if authenticated)
  useEffect(() => {
    if (!isAuthenticated) return
    
    // Sync account details from database to localStorage
    syncAccountDetailsFromDatabase().then(synced => {
      if (synced) {
        // Force update of header subtitle after sync
        updateHeaderSubtitle()
        // Dispatch storage event to notify other components
        window.dispatchEvent(new Event('storage'))
      }
    }).catch(err => {
      console.warn('Failed to sync account details on mount:', err)
    })
  }, [isAuthenticated])

  // Update header subtitle on mount and when demo mode/account details change
  useEffect(() => {
    updateHeaderSubtitle()
    
    const handleDisplayModeChange = () => {
      updateHeaderSubtitle()
    }
    
    const handleStorageChange = (e) => {
      if (e.key === 'demo_mode' || e.key === 'account_details' || e.key === 'default_trading_account' || e.key === 'zerodha_account_tokens') {
        updateHeaderSubtitle()
      }
    }
    
    window.addEventListener('displayModeChanged', handleDisplayModeChange)
    window.addEventListener('storage', handleStorageChange)
    
    // Also check periodically for same-tab changes
    const interval = setInterval(updateHeaderSubtitle, 1000)
    
    return () => {
      window.removeEventListener('displayModeChanged', handleDisplayModeChange)
      window.removeEventListener('storage', handleStorageChange)
      clearInterval(interval)
    }
  }, [])

  const handleTradeAdded = () => {
    // Trigger refresh of dashboard
    setRefreshKey(prev => prev + 1)
  }

  const handleBuyComplete = () => {
    handleTradeAdded()
    closeSlider()
  }

  const handlePayinComplete = () => {
    handleTradeAdded()
    closeSlider()
  }

  const handleSyncComplete = () => {
    // Refresh dashboard after sync
    handleTradeAdded()
  }

  const handleSettingsClose = () => {
    closeSlider()
  }

  const openSlider = (action) => {
    switch (action) {
      case 'payin':
        setSliderTitle('Add Payin')
        setSliderContent('payin')
        setSliderOpen(true)
        break
      case 'buy':
        setSliderTitle('Buy Trade')
        setSliderContent('buy')
        setSliderOpen(true)
        break
      case 'decision-assistant':
        setSliderTitle('Decision Assistant')
        setSliderContent('decision-assistant')
        setSliderOpen(true)
        break
      case 'payin-history':
        setSliderTitle('Payin History')
        setSliderContent('payin-history')
        setSliderOpen(true)
        break
      case 'snapshots':
        setSliderTitle('')
        setSliderContent('snapshots')
        setSliderOpen(true)
        break
      case 'charts':
        setSliderTitle('')
        setSliderContent('charts')
        setSliderOpen(true)
        break
      case 'settings':
        setSliderTitle('Settings')
        setSliderContent('settings')
        setSliderOpen(true)
        break
      case 'zerodha-sync':
        setSliderTitle('Zerodha Sync')
        setSliderContent('zerodha-sync')
        setSliderOpen(true)
        break
      default:
        break
    }
  }

  const closeSlider = () => {
    setSliderOpen(false)
    setSliderContent(null)
  }

  const renderSliderContent = () => {
    switch (sliderContent) {
      case 'payin':
        return (
          <PayinModal
            onClose={closeSlider}
            onPayinComplete={handlePayinComplete}
            inSlider={true}
          />
        )
      case 'buy':
        return (
          <BuyModal
            onClose={closeSlider}
            onBuyComplete={handleBuyComplete}
            inSlider={true}
          />
        )
      case 'decision-assistant':
        return (
          <DecisionAssistant
            onClose={closeSlider}
            inSlider={true}
          />
        )
      case 'payin-history':
        const defaultTradingAccount = localStorage.getItem('default_trading_account');
        return (
          <PayinsTable 
            showHeader={false}
            zerodhaUserId={defaultTradingAccount}
            searchTerm={''}
            onClose={closeSlider}
          />
        )
      case 'snapshots':
        return (
          <SnapshotsTable 
            showHeader={false}
            onClose={closeSlider}
          />
        )
      case 'charts':
        return (
          <Charts 
            showHeader={false}
            onClose={closeSlider}
          />
        )
      case 'settings':
        return (
          <Settings
            onClose={handleSettingsClose}
            onImportComplete={handleTradeAdded}
            inSlider={true}
          />
        )
      case 'zerodha-sync':
        return <ZerodhaSyncPanel onSyncComplete={handleSyncComplete} />
      default:
        return null
    }
  }

  const handleLoginSuccess = (userData) => {
    setUser(userData)
    setIsAuthenticated(true)
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <GoogleAuth onLoginSuccess={handleLoginSuccess} />
  }

  return (
    <div className="App">
      <ActionSidePanel onActionClick={openSlider} />
      
      <header className="App-header">
        <div className="header-content">
          <div className="header-logo-title">
            <img 
              src="/logo.png" 
              alt="Swing Edge" 
              className="header-logo"
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
            <div>
              <h1>
                Swing Edge{headerSubtitle ? ` - ${headerSubtitle}` : ''}
              </h1>
              <p className="header-tagline">Every trade stands alone</p>
            </div>
          </div>
        </div>
        <div className="header-actions">
          {/* Zerodha connection moved to Settings/ActionSidePanel */}
        </div>
      </header>
      <main className="main-content">
        <div className="content-wrapper">
          <Dashboard 
            key={refreshKey} 
            onBuyClick={() => openSlider('buy')}
          />
        </div>
      </main>

      <SliderPanel
        isOpen={sliderOpen}
        onClose={closeSlider}
        title={sliderContent === 'payin-history' || sliderContent === 'snapshots' || sliderContent === 'charts' ? '' : sliderTitle}
        width={sliderContent === 'charts' ? '40%' : sliderContent === 'payin-history' || sliderContent === 'snapshots' ? '900px' : sliderContent === 'decision-assistant' ? '850px' : '600px'}
      >
        {renderSliderContent()}
      </SliderPanel>
    </div>
  )
}

export default App





