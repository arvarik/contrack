import React from 'react';
import { motion, HTMLMotionProps } from 'motion/react';
import { cn } from '../../lib/utils';

export interface AnimatedSkeletonProps extends HTMLMotionProps<"div"> {
  className?: string;
  delay?: number;
}

export const AnimatedSkeleton = ({ className, delay = 0, ...props }: AnimatedSkeletonProps) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, delay }}
      className={cn(
        "relative overflow-hidden bg-surface-container-high/50",
        className
      )}
      {...props}
    >
      <motion.div
        initial={{ x: "-100%" }}
        animate={{ x: "200%" }}
        transition={{
          repeat: Infinity,
          repeatType: "loop",
          duration: 1.5,
          ease: "linear",
          delay
        }}
        className="absolute inset-0 z-10"
        style={{
          backgroundImage: "linear-gradient(90deg, transparent 0%, var(--color-surface-container-lowest) 50%, transparent 100%)",
        }}
      />
    </motion.div>
  );
};

export const SkeletonBlock = ({ className, ...props }: AnimatedSkeletonProps) => (
  <AnimatedSkeleton className={cn("rounded-2xl h-24", className)} {...props} />
);

export const SkeletonText = ({ className, lines = 1, ...props }: AnimatedSkeletonProps & { lines?: number }) => (
  <div className="space-y-3 w-full">
    {Array.from({ length: lines }).map((_, i) => (
      <AnimatedSkeleton 
        key={i} 
        className={cn(
          "h-4 rounded-md", 
          i === lines - 1 && lines > 1 ? "w-3/4" : "w-full",
          className
        )} 
        delay={i * 0.1}
        {...props} 
      />
    ))}
  </div>
);

export const SkeletonAvatar = ({ className, ...props }: AnimatedSkeletonProps) => (
  <AnimatedSkeleton className={cn("rounded-[2rem] h-24 w-24 md:w-32 md:h-32 shrink-0", className)} {...props} />
);
