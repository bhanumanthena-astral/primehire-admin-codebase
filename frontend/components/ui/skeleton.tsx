import { cn } from "@/lib/utils"

type SkeletonStyle = React.CSSProperties & { '--skeleton-delay'?: string };

function Skeleton({ className, index = 0, style, ...props }: React.ComponentProps<"div"> & { index?: number }) {
  return (
    <div
      data-slot="skeleton"
      className={cn("shadcn-shimmer rounded-md", className)}
      style={{'--skeleton-delay': `${Math.max(0, index) * 85}ms`, ...style} as SkeletonStyle}
      {...props}
    />
  )
}

export { Skeleton }

