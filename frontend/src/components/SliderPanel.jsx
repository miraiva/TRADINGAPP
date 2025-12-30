import React, { useEffect } from 'react';
import './SliderPanel.css';

const SliderPanel = ({ isOpen, onClose, title, children, width = '500px' }) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <>
      <div className="slider-overlay" onClick={onClose}></div>
      <div className="slider-panel" style={{ width }}>
        {title && (
          <div className="slider-header">
            <h2 className="slider-title">{title}</h2>
            <button className="slider-close-btn" onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
        )}
        <div className={`slider-content ${!title ? 'no-header' : ''}`}>
          {children}
        </div>
      </div>
    </>
  );
};

export default SliderPanel;


