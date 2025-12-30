/**
 * Calculate XIRR (Extended Internal Rate of Return)
 * 
 * XIRR calculates the annualized return for a series of cash flows
 * that occur at irregular intervals.
 * 
 * @param {Array} cashFlows - Array of cash flow amounts (negative for investments, positive for returns)
 * @param {Array} dates - Array of dates corresponding to each cash flow (Date objects or ISO strings)
 * @param {number} guess - Initial guess for the rate (default: 0.1 = 10%)
 * @returns {number} - Annualized return rate as a decimal (e.g., 0.15 = 15%)
 */
export function calculateXIRR(cashFlows, dates, guess = 0.1) {
  if (!cashFlows || !dates || cashFlows.length !== dates.length) {
    return null;
  }

  if (cashFlows.length < 2) {
    return null; // Need at least 2 cash flows
  }

  // Convert dates to Date objects if they're strings
  const dateObjects = dates.map(date => {
    if (typeof date === 'string') {
      return new Date(date);
    }
    return date;
  });

  // Get the first date (reference date)
  const firstDate = new Date(Math.min(...dateObjects.map(d => d.getTime())));

  // Helper function to calculate days between two dates
  const daysBetween = (date1, date2) => {
    return (date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24);
  };

  // Calculate the present value of cash flows for a given rate
  const presentValue = (rate) => {
    let pv = 0;
    for (let i = 0; i < cashFlows.length; i++) {
      const days = daysBetween(firstDate, dateObjects[i]);
      const years = days / 365.0;
      pv += cashFlows[i] / Math.pow(1 + rate, years);
    }
    return pv;
  };

  // Calculate the derivative of present value (for Newton-Raphson)
  const presentValueDerivative = (rate) => {
    let pvd = 0;
    for (let i = 0; i < cashFlows.length; i++) {
      const days = daysBetween(firstDate, dateObjects[i]);
      const years = days / 365.0;
      pvd -= (years * cashFlows[i]) / Math.pow(1 + rate, years + 1);
    }
    return pvd;
  };

  // Newton-Raphson method to find the root
  let rate = guess;
  const maxIterations = 100;
  const tolerance = 1e-6;

  for (let i = 0; i < maxIterations; i++) {
    const pv = presentValue(rate);
    const pvd = presentValueDerivative(rate);

    if (Math.abs(pv) < tolerance) {
      return rate; // Found the solution
    }

    if (Math.abs(pvd) < tolerance) {
      // Derivative is too small, try a different approach
      break;
    }

    const newRate = rate - pv / pvd;

    // Prevent negative rates or rates that are too large
    if (newRate < -0.99 || newRate > 10) {
      break;
    }

    // Check for convergence
    if (Math.abs(newRate - rate) < tolerance) {
      return newRate;
    }

    rate = newRate;
  }

  // If Newton-Raphson didn't converge, try bisection method
  let low = -0.99;
  let high = 10;
  let mid;

  for (let i = 0; i < maxIterations; i++) {
    mid = (low + high) / 2;
    const pv = presentValue(mid);

    if (Math.abs(pv) < tolerance) {
      return mid;
    }

    if (pv > 0) {
      low = mid;
    } else {
      high = mid;
    }

    if (high - low < tolerance) {
      return mid;
    }
  }

  return null; // Could not find a solution
}

/**
 * Calculate XIRR for a portfolio given payins and current portfolio value
 * 
 * @param {Array} payins - Array of payin objects with {payin_date, amount}
 * @param {number} currentValue - Current portfolio value (total portfolio)
 * @param {Date} currentDate - Current date (defaults to today)
 * @returns {number|null} - XIRR as a percentage (e.g., 15.5 for 15.5%), or null if calculation fails
 */
export function calculatePortfolioXIRR(payins, currentValue, currentDate = new Date()) {
  if (!payins || payins.length === 0) {
    return null;
  }

  // Create cash flows array
  // Payins are negative (money going out)
  const cashFlows = payins.map(payin => -(payin.amount || 0));
  
  // Current portfolio value is positive (money coming in)
  cashFlows.push(currentValue);

  // Create dates array
  const dates = payins.map(payin => {
    if (payin.payin_date) {
      return typeof payin.payin_date === 'string' ? new Date(payin.payin_date) : payin.payin_date;
    }
    return null;
  }).filter(date => date !== null);

  // Add current date
  dates.push(new Date(currentDate));

  // Filter out any invalid cash flows or dates
  const validIndices = [];
  for (let i = 0; i < cashFlows.length; i++) {
    if (dates[i] && !isNaN(dates[i].getTime()) && !isNaN(cashFlows[i])) {
      validIndices.push(i);
    }
  }

  if (validIndices.length < 2) {
    return null; // Need at least 2 valid cash flows
  }

  const validCashFlows = validIndices.map(i => cashFlows[i]);
  const validDates = validIndices.map(i => dates[i]);

  // Calculate XIRR
  const xirrRate = calculateXIRR(validCashFlows, validDates);

  if (xirrRate === null || isNaN(xirrRate) || !isFinite(xirrRate)) {
    return null;
  }

  // Convert to percentage
  return xirrRate * 100;
}

