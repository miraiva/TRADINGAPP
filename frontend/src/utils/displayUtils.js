/**
 * Utility functions for display mode (Privacy/Demo)
 */

// Get privacy mode status
export const getPrivacyMode = () => {
  return localStorage.getItem('privacy_mode') === 'true';
};

// Get demo mode status
export const getDemoMode = () => {
  return localStorage.getItem('demo_mode') === 'true';
};

// Format value based on display mode
export const formatDisplayValue = (value, options = {}) => {
  const { hide = false, showAsDemo = false } = options;
  
  if (hide || getPrivacyMode()) {
    return '••••••';
  }
  
  if (showAsDemo || getDemoMode()) {
    return value * 0.2; // 20% of actual value
  }
  
  return value;
};

// Format currency with display mode
export const formatCurrencyWithMode = (value, options = {}) => {
  const { hide = false, showAsDemo = false, minimumFractionDigits = 0, maximumFractionDigits = 0 } = options;
  
  if (hide || getPrivacyMode()) {
    return '••••••';
  }
  
  const displayValue = (showAsDemo || getDemoMode()) ? value * 0.2 : value;
  
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: minimumFractionDigits,
    maximumFractionDigits: maximumFractionDigits || 0,
  }).format(displayValue);
};

// Format number with display mode
export const formatNumberWithMode = (value, options = {}) => {
  const { hide = false, showAsDemo = false, minimumFractionDigits, maximumFractionDigits = 2 } = options;
  
  if (hide || getPrivacyMode()) {
    return '••••';
  }
  
  const displayValue = (showAsDemo || getDemoMode()) ? value * 0.2 : value;
  
  const formatOptions = {
    maximumFractionDigits: maximumFractionDigits,
  };
  
  // Only set minimumFractionDigits if explicitly provided
  if (minimumFractionDigits !== undefined) {
    formatOptions.minimumFractionDigits = minimumFractionDigits;
  }
  
  return new Intl.NumberFormat('en-IN', formatOptions).format(displayValue);
};

