import React from 'react';
import './SplitLayout.css';

interface SplitLayoutProps {
  left: React.ReactNode;
  right: React.ReactNode;
  leftWidth?: string;
}

export const SplitLayout: React.FC<SplitLayoutProps> = ({ left, right, leftWidth = '300px' }) => {
  return (
    <div className="split-layout">
      <div className="split-layout-left" style={{ width: leftWidth }}>
        {left}
      </div>
      <div className="split-layout-divider" />
      <div className="split-layout-right">
        {right}
      </div>
    </div>
  );
};
