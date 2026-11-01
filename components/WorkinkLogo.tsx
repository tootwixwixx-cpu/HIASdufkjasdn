import React from "react";

interface WorkinkLogoProps {
  className?: string;
  size?: number;
  colored?: boolean;
}

/**
 * Official Work.ink stylized insignia SVG.
 * Renders the authentic Work.ink 'W' emblem on a modern purple-indigo gradient rounded background.
 */
export function WorkinkLogo({ className = "w-4 h-4", size, colored = true }: WorkinkLogoProps) {
  const style = size ? { width: size, height: size } : undefined;

  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
    >
      {colored ? (
        <rect width="100" height="100" rx="24" fill="url(#workink-gradient)" />
      ) : (
        <rect width="100" height="100" rx="24" fill="currentColor" />
      )}
      <path
        d="M23 30.5h8.2c1.6 0 2.9 1 3.4 2.5l6.1 22 5.3-17c.5-1.5 1.8-2.5 3.4-2.5h4.9c1.6 0 2.9 1 3.4 2.5l5.3 17 6.1-22c.5-1.5 1.8-2.5 3.4-2.5H77c2 0 3.6 1.8 3.1 3.8L69.8 71.9c-.4 1.7-1.9 2.9-3.7 2.9h-8.5c-1.7 0-3.1-1.1-3.6-2.8L48.2 49.8 42.4 72c-.5 1.7-1.9 2.8-3.6 2.8h-8.5c-1.8 0-3.3-1.2-3.7-2.9L19.9 34.3c-.5-2 1.1-3.8 3.1-3.8z"
        fill="#FFFFFF"
      />
      {colored && (
        <defs>
          <linearGradient id="workink-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#8B5CF6" />
            <stop offset="50%" stopColor="#7C3AED" />
            <stop offset="100%" stopColor="#4F46E5" />
          </linearGradient>
        </defs>
      )}
    </svg>
  );
}

export default WorkinkLogo;
