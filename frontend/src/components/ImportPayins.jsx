import React, { useState } from 'react';
import { payinAPI } from '../services/api';
import './ImportTrades.css';

const ImportPayins = ({ onClose, onImportComplete }) => {
  const [file, setFile] = useState(null);
  const [zerodhaUserId, setZerodhaUserId] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [showAllDuplicates, setShowAllDuplicates] = useState(false);

  // Get default user ID from localStorage
  React.useEffect(() => {
    const defaultTradingAccount = localStorage.getItem('default_trading_account');
    if (defaultTradingAccount) {
      setZerodhaUserId(defaultTradingAccount);
    }
  }, []);

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setResult(null);
      
      // Preview JSON files
      if (selectedFile.name.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const content = JSON.parse(event.target.result);
            const previewData = Array.isArray(content) ? content.slice(0, 5) : [content];
            setPreview(previewData);
          } catch (err) {
            setPreview(null);
          }
        };
        reader.readAsText(selectedFile);
      } else {
        setPreview(null);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!file) {
      setError('Please select a file');
      return;
    }
    
    if (!zerodhaUserId.trim()) {
      setError('Please enter a User ID');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      const importResult = await payinAPI.importPayins(file, zerodhaUserId, skipDuplicates);
      setResult(importResult);
      
      if (importResult.imported > 0) {
        // Dispatch event to notify other components (like PayinsTable) to refresh
        window.dispatchEvent(new CustomEvent('payinAdded'));
        // Also trigger storage event for cross-tab updates
        localStorage.setItem('payin_refresh', Date.now().toString());
        
        if (onImportComplete) {
          // Delay callback to show results first
          setTimeout(() => {
            onImportComplete();
          }, 2000);
        }
      }
    } catch (err) {
      // Handle validation errors - they come as structured data
      const errorDetail = err.response?.data?.detail;
      
      if (errorDetail && typeof errorDetail === 'object' && errorDetail.errors) {
        // This is a validation error with structured data
        // Convert it to a result format so user can see the errors
        setResult({
          success: false,
          total_rows: errorDetail.total_rows || 0,
          imported: 0,
          failed: errorDetail.errors?.length || 0,
          skipped: errorDetail.duplicates?.length || 0,
          errors: errorDetail.errors || [],
          duplicates: errorDetail.duplicates || [],
          error_message: errorDetail.message || `Import failed: ${errorDetail.errors?.length || 0} record(s) have errors. All records must be valid to import.`
        });
      } else {
        // Regular error - show error message
        const errorMessage = typeof errorDetail === 'string' 
          ? errorDetail 
          : errorDetail?.message || 'Failed to import payins. Please try again.';
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (result && result.imported > 0 && onImportComplete) {
      onImportComplete();
    }
    onClose();
  };

  const handleUploadNew = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setPreview(null);
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content import-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Import Payins</h2>
          <button className="modal-close" onClick={handleClose}>×</button>
        </div>

        <p className="import-description" style={{ padding: '0 1.5rem', marginBottom: '1rem', color: '#666' }}>
          Upload a JSON or Excel file (.xlsx, .xls) containing payin data.
          <br />
          <strong>Required columns:</strong> Date, Payin (Amount)
          <br />
          <strong>Optional columns:</strong> Paid By, NAV, Number of Shares, Description/Comments
          <br />
          <details style={{ marginTop: '0.5rem' }}>
            <summary style={{ cursor: 'pointer', color: '#3b82f6', textDecoration: 'underline' }}>
              View JSON Format & Sample
            </summary>
            <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f9fafb', borderRadius: '4px', fontSize: '0.75rem' }}>
              <strong>JSON Format:</strong>
              <pre style={{ marginTop: '0.5rem', padding: '0.5rem', background: 'white', borderRadius: '4px', overflow: 'auto' }}>
{`[
  {
    "payin_date": "2022-09-09",
    "amount": 69149.93,
    "paid_by": "Ivan M",
    "nav": 10.0,
    "number_of_shares": 6914.99,
    "description": "Initial investment"
  },
  {
    "payin_date": "2022-10-15",
    "amount": 50000.0,
    "paid_by": "Shilpa",
    "nav": 9.0303364,
    "number_of_shares": 5539.81
  }
]`}
              </pre>
              <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                <strong>Note:</strong> Negative amounts represent payouts. Date format: YYYY-MM-DD
              </p>
            </div>
          </details>
        </p>

        {!result && (
          <form onSubmit={handleSubmit} className="import-form">
          <div className="form-group">
            <label htmlFor="payin-file">Select File *</label>
            <input
              type="file"
              id="payin-file"
              accept=".json,.xlsx,.xls"
              onChange={handleFileChange}
              className="form-input file-input"
              required
            />
            {file && (
              <div className="file-info" style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#666' }}>
                <span>Selected: {file.name}</span>
                <span className="file-size"> ({(file.size / 1024).toFixed(2)} KB)</span>
              </div>
            )}
            <p className="form-hint" style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#666' }}>
              Supported formats: JSON (.json), Excel (.xlsx, .xls)
            </p>
          </div>

          {preview && (
            <div className="preview-section">
              <h4>Preview (first 5 records):</h4>
              <pre className="preview-content">{JSON.stringify(preview, null, 2)}</pre>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="payin-user-id">User ID *</label>
            <input
              type="text"
              id="payin-user-id"
              value={zerodhaUserId}
              onChange={(e) => setZerodhaUserId(e.target.value)}
              placeholder="e.g., UU6974"
              className="form-input"
              required
            />
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={(e) => setSkipDuplicates(e.target.checked)}
              />
              <span>Skip duplicate payins (same date and amount)</span>
            </label>
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <div className="modal-actions" style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <button type="button" onClick={handleClose} className="btn-cancel" disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn-confirm" disabled={loading || !file}>
              {loading ? 'Importing...' : 'Import Payins'}
            </button>
          </div>
        </form>
      )}

      {result && (
        <div className="import-results">
          <div className={`result-header ${result.imported > 0 ? 'success' : 'error'}`}>
            <h4>
              {result.imported > 0 
                ? `✓ Successfully imported ${result.imported} payin(s)` 
                : '✗ Import failed'}
            </h4>
            {result.error_message && (
              <p className="error-message">{result.error_message}</p>
            )}
          </div>

          <div className="result-stats">
            <div className="stat-item">
              <span className="stat-label">Total Rows:</span>
              <span className="stat-value">{result.total_rows}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Imported:</span>
              <span className="stat-value success">{result.imported}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Failed:</span>
              <span className="stat-value error">{result.failed}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Skipped:</span>
              <span className="stat-value warning">{result.skipped}</span>
            </div>
          </div>

          {result.errors && result.errors.length > 0 && (
            <div className="errors-section">
              <h5>
                Errors ({result.errors.length})
                {result.errors.length > 10 && (
                  <button 
                    className="toggle-button"
                    onClick={() => setShowAllErrors(!showAllErrors)}
                  >
                    {showAllErrors ? 'Show Less' : 'Show All'}
                  </button>
                )}
              </h5>
              <div className="errors-list">
                {(showAllErrors ? result.errors : result.errors.slice(0, 10)).map((error, idx) => (
                  <div key={idx} className="error-item">
                    <span className="error-row">Row {error.row}:</span>
                    <span className="error-text">{error.error}</span>
                    {error.data && (
                      <details className="error-details">
                        <summary>Data</summary>
                        <pre>{JSON.stringify(error.data, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {result.duplicates && result.duplicates.length > 0 && (
            <div className="duplicates-section">
              <h5>
                Duplicates ({result.duplicates.length})
                {result.duplicates.length > 10 && (
                  <button 
                    className="toggle-button"
                    onClick={() => setShowAllDuplicates(!showAllDuplicates)}
                  >
                    {showAllDuplicates ? 'Show Less' : 'Show All'}
                  </button>
                )}
              </h5>
              <div className="duplicates-list">
                {(showAllDuplicates ? result.duplicates : result.duplicates.slice(0, 10)).map((dup, idx) => (
                  <div key={idx} className="duplicate-item">
                    <span className="duplicate-row">Row {dup.row}:</span>
                    <span className="duplicate-text">
                      {dup.payin_date} - ₹{dup.amount?.toLocaleString() || dup.amount}
                    </span>
                    <span className="duplicate-reason">({dup.reason})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="modal-actions" style={{ padding: '1rem 1.5rem', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <button onClick={handleUploadNew} className="btn-secondary">
              Upload New File
            </button>
            <button onClick={handleClose} className="btn-confirm">
              Close
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

export default ImportPayins;

