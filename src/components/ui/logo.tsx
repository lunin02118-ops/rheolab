import React from 'react';

interface LogoProps extends React.SVGProps<SVGSVGElement> {
    className?: string;
}

export function Logo({ className, ...props }: LogoProps) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 32 32"
            fill="none"
            className={className}
            {...props}
        >
            <defs>
                <linearGradient id="appLogoGrad" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#14b8a6" />
                    <stop offset="100%" stopColor="#0ea5e9" />
                </linearGradient>
            </defs>
            <path
                d="M16 2 C16 2 6 12 6 19 C6 24.523 10.477 29 16 29 C21.523 29 26 24.523 26 19 C26 12 16 2 16 2 Z"
                stroke="url(#appLogoGrad)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M10 20 L14 16 L18 19 L24 11"
                stroke="url(#appLogoGrad)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <circle cx="14" cy="16" r="1.5" fill="#0ea5e9" />
            <circle cx="18" cy="19" r="1.5" fill="#0ea5e9" />
            <circle cx="24" cy="11" r="1.5" fill="#0ea5e9" />
        </svg>
    );
}
