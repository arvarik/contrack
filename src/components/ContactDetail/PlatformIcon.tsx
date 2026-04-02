import React from 'react';
import { Linkedin, Facebook, Github, Twitter, Instagram, Globe } from 'lucide-react';

export const PlatformIcon = ({ platform, className }: { platform: string; className?: string }) => {
  switch (platform.toLowerCase()) {
    case 'linkedin': return <Linkedin className={className} />;
    case 'facebook': return <Facebook className={className} />;
    case 'github': return <Github className={className} />;
    case 'twitter': return <Twitter className={className} />;
    case 'instagram': return <Instagram className={className} />;
    default: return <Globe className={className} />;
  }
};
