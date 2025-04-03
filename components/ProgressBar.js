// components/ProgressBar.js
import React from 'react';

const ProgressBar = ({ progress }) => {
  const { current = 0, total = 100, message = 'Idle' } = progress || {};
  const percentage = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

  return (
    <div style={{ marginTop: '20px', border: '1px solid #ccc', padding: '10px' }}>
      <p>Status: {message}</p>
      <div style={{ backgroundColor: '#eee', height: '20px', borderRadius: '5px', overflow: 'hidden' }}>
        <div
          style={{
            width: `${percentage}%`,
            backgroundColor: '#4caf50',
            height: '100%',
            transition: 'width 0.2s ease-in-out', // Smooth transition
            textAlign: 'center',
            color: 'white',
            lineHeight: '20px'
          }}
        >
          {percentage}%
        </div>
      </div>
       <p>{current} / {total} blocks processed</p>
    </div>
  );
};

export default ProgressBar;