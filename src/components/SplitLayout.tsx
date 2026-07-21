import React, { useState, useRef, useCallback, useEffect } from 'react';
import './SplitLayout.css';

interface SplitLayoutProps {
  left: React.ReactNode;
  right: React.ReactNode;
  leftWidth?: string;
  minLeftWidth?: number;
  maxLeftWidth?: number;
}

const parsePx = (value: string, fallback: number): number => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const SplitLayout: React.FC<SplitLayoutProps> = ({
  left,
  right,
  leftWidth = '300px',
  minLeftWidth = 200,
  maxLeftWidth = 700,
}) => {
  const [width, setWidth] = useState<number>(() => parsePx(leftWidth, 300));
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  useEffect(() => {
    if (!dragging) return;

    const onMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const left = container.getBoundingClientRect().left;
      const next = Math.min(maxLeftWidth, Math.max(minLeftWidth, e.clientX - left));
      setWidth(next);
    };
    const onMouseUp = () => setDragging(false);

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    // Avoid text selection / wrong cursor while dragging
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging, minLeftWidth, maxLeftWidth]);

  return (
    <div className="split-layout" ref={containerRef}>
      <div className="split-layout-left" style={{ width: `${width}px` }}>
        {left}
      </div>
      <div
        className={`split-layout-divider ${dragging ? 'dragging' : ''}`}
        onMouseDown={onMouseDown}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
      />
      <div className="split-layout-right">
        {right}
      </div>
    </div>
  );
};
