import React, { useState, useEffect } from 'react';
import api from '../services/api';
import './GoogleAuth.css';

const GoogleAuth = ({ onLoginSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Check if we're returning from Google OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    
    if (code) {
      handleGoogleCallback(code);
    }
  }, []);

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Get Google OAuth login URL from backend
      const response = await api.get('/api/auth/google/login-url');
      const { auth_url } = response.data;
      
      // Redirect to Google OAuth
      window.location.href = auth_url;
    } catch (err) {
      console.error('Error initiating Google login:', err);
      setError(err.response?.data?.detail || 'Failed to initiate Google login');
      setLoading(false);
    }
  };

  const handleGoogleCallback = async (code) => {
    try {
      setLoading(true);
      setError(null);
      
      // Get current redirect URI
      const redirectUri = window.location.origin + '/auth/google/callback';
      
      // Exchange code for token
      const response = await api.post('/api/auth/google/callback', {
        code,
        redirect_uri: redirectUri
      });
      
      const { access_token, user } = response.data;
      
      // Store token and user info
      localStorage.setItem('auth_token', access_token);
      localStorage.setItem('user', JSON.stringify(user));
      
      // Clear URL parameters
      window.history.replaceState({}, document.title, window.location.pathname);
      
      // Notify parent component
      if (onLoginSuccess) {
        onLoginSuccess(user);
      }
      
      setLoading(false);
    } catch (err) {
      console.error('Error handling Google callback:', err);
      setError(err.response?.data?.detail || 'Authentication failed');
      setLoading(false);
      
      // Clear URL parameters on error
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    window.location.reload();
  };

  // Check if user is already logged in
  const authToken = localStorage.getItem('auth_token');
  const userStr = localStorage.getItem('user');
  const user = userStr ? JSON.parse(userStr) : null;

  if (authToken && user) {
    return (
      <div className="google-auth-container">
        <div className="user-info">
          {user.picture && (
            <img src={user.picture} alt={user.name} className="user-avatar" />
          )}
          <div className="user-details">
            <div className="user-name">{user.name || user.email}</div>
            <div className="user-email">{user.email}</div>
          </div>
          <button onClick={handleLogout} className="btn-logout">
            Logout
          </button>
        </div>
      </div>
    );
  }

  const handleSignUp = () => {
    alert('For access and registration, please contact the administrator at ivan.e.miranda@gmail.com');
  };

  return (
    <div className="google-auth-container">
      {/* Left Panel - Promotional Section */}
      <div className="login-left-panel">
        <div className="left-panel-content">
          {/* Elevator Pitch */}
          <div className="elevator-pitch">
            <h1 className="pitch-heading">
              <span className="pitch-heading-light">We Are</span>
              <span className="pitch-heading-bold">Swing Edge</span>
            </h1>
            <p className="pitch-text">
              Your personal trading companion designed for serious investors. Track your portfolio, 
              analyze performance, and make informed decisions with institutional-grade tools. 
              Every trade stands alone—manage your positions with precision and clarity.
            </p>
          </div>
          
          {/* Learn More / Sign Up Button */}
          <button 
            onClick={handleSignUp}
            className="btn-learn-more"
          >
            Sign Up
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="login-right-panel">
        <div className="login-form-card">
          {/* Greeting */}
          <div className="login-greeting">
            <h2 className="greeting-text">Hello!</h2>
            <p className="greeting-subtext">Sign in to access your trading dashboard</p>
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {/* Sign in with Google Button */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="btn-google-login-new"
          >
            {loading ? (
              <>Loading...</>
            ) : (
              <>
                <div className="google-logo-container">
                  <svg className="google-icon" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                </div>
                <span>Sign in with Google</span>
              </>
            )}
          </button>

          {/* Sign Up Link */}
          <div className="signup-link">
            <p>Don't have an account? <button onClick={handleSignUp} className="link-signup">Sign up</button></p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GoogleAuth;

