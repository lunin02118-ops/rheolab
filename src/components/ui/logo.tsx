import React from 'react';
import rheolabLogoUrl from '@/assets/brand/rheolab-logo.svg';

interface LogoProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    className?: string;
}

export function Logo({ className, ...props }: LogoProps) {
    return (
        <img
            src={rheolabLogoUrl}
            alt="RheoLab"
            className={className}
            draggable={false}
            {...props}
        />
    );
}
