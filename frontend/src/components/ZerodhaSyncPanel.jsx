import React from 'react';
import ZerodhaAuth from './ZerodhaAuth';

const ZerodhaSyncPanel = ({ onSyncComplete }) => {
  return (
    <div className="zerodha-sync-panel">
      <ZerodhaAuth 
        onAuthSuccess={(token) => console.log('Zerodha connected:', token)}
        onSyncComplete={onSyncComplete}
        compact={false}
      />
    </div>
  );
};

export default ZerodhaSyncPanel;


