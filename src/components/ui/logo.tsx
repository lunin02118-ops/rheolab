import React from 'react';
import rheolabLogoUrl from '@/assets/brand/rheolab-logo.svg';
import { cn } from '@/lib/utils';

interface LogoProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    className?: string;
}

export function Logo({ className, ...props }: LogoProps) {
    return (
        <img
            src={rheolabLogoUrl}
            alt="RheoLab"
            className={cn('object-contain scale-125 origin-center', className)}
            draggable={false}
            {...props}
        />
    );
}
