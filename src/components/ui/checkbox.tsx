import type { ComponentProps } from 'react'
import { Check } from 'lucide-react'
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { cn } from '../../lib/utils'

type CheckboxProps = ComponentProps<typeof CheckboxPrimitive.Root>

export function Checkbox({ className, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--button-foreground)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--focus)] data-[checked]:border-[var(--button)] data-[checked]:bg-[var(--button)] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="inline-flex items-center justify-center">
        <Check size={12} strokeWidth={2.5} aria-hidden="true" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
