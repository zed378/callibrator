import React from "react";

const SparklineChart: React.FC<{
  color: string;
  darkColor?: string;
  data: number[];
}> = ({ color, darkColor, data }) => {
  const effectiveColor = darkColor || color;
  // Stable gradient id (color may be a CSS variable like var(--primary)).
  const gradId = `grad-${React.useId().replace(/[:]/g, "")}`;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const width = 200;
  const height = 60;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x},${y}`;
    })
    .join(" ");
  const areaPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg viewBox={`0 -10 ${width} ${height + 20}`} className="w-full h-16">
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={effectiveColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={effectiveColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={effectiveColor}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default SparklineChart;
