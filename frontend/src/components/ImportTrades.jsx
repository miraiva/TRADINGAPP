import React, { useState } from 'react';
import { tradesAPI } from '../services/api';
import './ImportTrades.css';

const ImportTrades = ({ onClose, onImportComplete }) => {
  const [file, setFile] = useState(null);
  const [zerodhaUserId, setZerodhaUserId] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [preview, setPreview] = useState(null);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [showAllDuplicates, setShowAllDuplicates] = useState(false);

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
      const importResult = await tradesAPI.importTrades(file, zerodhaUserId, skipDuplicates);
      setResult(importResult);
      
      if (importResult.imported > 0 && onImportComplete) {
        // Delay callback to show results first
        setTimeout(() => {
          onImportComplete();
        }, 2000);
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
          : errorDetail?.message || 'Failed to import trades. Please try again.';
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

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content import-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Import Trades</h2>
          <button className="modal-close" onClick={handleClose}>×</button>
        </div>

        {!result ? (
          <form onSubmit={handleSubmit} className="import-form">
            <div className="form-group">
              <label htmlFor="file">Select File *</label>
              <input
                type="file"
                id="file"
                accept=".json,.xlsx,.xls"
                onChange={handleFileChange}
                className="form-input file-input"
                required
              />
              <p className="form-hint">
                Supported formats: JSON (.json), Excel (.xlsx, .xls)
              </p>
            </div>

            {preview && preview.length > 0 && (
              <div className="preview-section">
                <h4>Preview (first {preview.length} rows):</h4>
                <div className="preview-table">
                  <table>
                    <thead>
                      <tr>
                        {Object.keys(preview[0]).slice(0, 6).map(key => (
                          <th key={key}>{key}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.map((row, idx) => (
                        <tr key={idx}>
                          {Object.values(row).slice(0, 6).map((value, i) => (
                            <td key={i}>{String(value).substring(0, 20)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="zerodha-user-id">Zerodha User ID *</label>
              <input
                type="text"
                id="zerodha-user-id"
                value={zerodhaUserId}
                onChange={(e) => setZerodhaUserId(e.target.value)}
                placeholder="e.g., UU6974, UUXXXX"
                className="form-input"
                required
              />
              <p className="form-hint">
                Enter the User ID for the account these trades belong to
              </p>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                />
                <span>Skip duplicate trades</span>
              </label>
              <p className="form-hint">
                If checked, existing trades will be skipped. If unchecked, import will fail on duplicates.
              </p>
            </div>

            {error && (
              <div className="error-message">
                {error}
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={handleClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-confirm"
                disabled={loading || !file || !zerodhaUserId.trim()}
              >
                {loading ? 'Importing...' : 'Import Trades'}
              </button>
            </div>
          </form>
        ) : (
          <div className="import-results">
            {result.error_message && (
              <div className="error-message" style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: '#ffebee', border: '1px solid #f44336', borderRadius: '4px' }}>
                <strong style={{ color: '#c62828' }}>{result.error_message}</strong>
                <p style={{ marginTop: '0.5rem', marginBottom: 0, fontSize: '0.9rem', color: '#666' }}>
                  Please fix the errors below and upload again.
                </p>
              </div>
            )}
            <div className={`result-summary ${result.success ? 'success' : 'error'}`}>
              <h3>Import {result.success ? 'Completed' : 'Failed'}</h3>
              <div className="result-stats">
                <div className="stat-item">
                  <span className="stat-label">Total Rows:</span>
                  <span className="stat-value">{result.total_rows}</span>
                </div>
                <div className="stat-item success">
                  <span className="stat-label">Imported:</span>
                  <span className="stat-value">{result.imported}</span>
                </div>
                {result.failed > 0 && (
                  <div className="stat-item error">
                    <span className="stat-label">Failed:</span>
                    <span className="stat-value">{result.failed}</span>
                  </div>
                )}
                {result.skipped > 0 && (
                  <div className="stat-item warning">
                    <span className="stat-label">Skipped:</span>
                    <span className="stat-value">{result.skipped}</span>
                  </div>
                )}
              </div>
            </div>

            {result.errors && result.errors.length > 0 && (
              <div className="errors-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h4>Errors ({result.errors.length}):</h4>
                  <button
                    type="button"
                    onClick={() => setShowAllErrors(!showAllErrors)}
                    className="btn-link"
                    style={{ fontSize: '0.85rem', padding: '0.25rem 0.5rem' }}
                  >
                    {showAllErrors ? 'Show Less' : `Show All (${result.errors.length})`}
                  </button>
                </div>
                <div className="errors-list">
                  {(showAllErrors ? result.errors : result.errors.slice(0, 10)).map((error, idx) => (
                    <div key={idx} className="error-item">
                      <strong>Row {error.row}</strong> ({error.symbol}): {error.error}
                    </div>
                  ))}
                  {!showAllErrors && result.errors.length > 10 && (
                    <div className="more-errors">
                      ... and {result.errors.length - 10} more errors (click "Show All" to see them)
                    </div>
                  )}
                </div>
              </div>
            )}

            {result.duplicates && result.duplicates.length > 0 && (
              <div className="duplicates-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h4>Duplicates Skipped ({result.duplicates.length}):</h4>
                  <button
                    type="button"
                    onClick={() => setShowAllDuplicates(!showAllDuplicates)}
                    className="btn-link"
                    style={{ fontSize: '0.85rem', padding: '0.25rem 0.5rem' }}
                  >
                    {showAllDuplicates ? 'Show Less' : `Show All (${result.duplicates.length})`}
                  </button>
                </div>
                <div className="duplicates-list">
                  {(showAllDuplicates ? result.duplicates : result.duplicates.slice(0, 10)).map((dup, idx) => (
                    <div key={idx} className="duplicate-item">
                      Row {dup.row}: {dup.symbol} ({dup.buy_date}) - {dup.reason}
                    </div>
                  ))}
                  {!showAllDuplicates && result.duplicates.length > 10 && (
                    <div className="more-duplicates">
                      ... and {result.duplicates.length - 10} more duplicates (click "Show All" to see them)
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => {
                  setResult(null);
                  setError(null);
                  setFile(null);
                  setPreview(null);
                }}
              >
                Upload New File
              </button>
              <button
                type="button"
                className="btn-confirm"
                onClick={handleClose}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportTrades;

