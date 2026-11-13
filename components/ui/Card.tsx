import * as React from "react";
import { cn } from "@/lib/utils";

type DivProps = React.HTMLAttributes<HTMLDivElement>;

export interface CardProps extends DivProps {
  /** raised = default card on canvas; inset = a well nested inside a card. */
  variant?: "raised" | "inset";
}

export function Card({ variant = "raised", className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border",
        variant === "raised" ? "border-line bg-surface-raised shadow-hairline" : "border-line-subtle bg-surface",
        className,
      )}
      {...props}
    />
  );
}

export interface CardHeaderProps extends Omit<DivProps, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned controls (buttons, filters). */
  actions?: React.ReactNode;
  /** Draw a divider under the header (use when the body is a table or list). */
  divided?: boolean;
}

export function CardHeader({ title, description, actions, divided = false, className, children, ...props }: CardHeaderProps) {
  return (
    <div
      className={cn("flex items-start gap-3 px-4 py-3", divided && "border-b border-line", className)}
      {...props}
    >
      <div className="min-w-0 flex-1">
        {title ? <CardTitle>{title}</CardTitle> : null}
        {description ? <CardDescription>{description}</CardDescription> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-title font-semibold text-fg", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-0.5 text-body-sm text-fg-muted", className)} {...props} />;
}

export function CardBody({ className, ...props }: DivProps) {
  return <div className={cn("px-4 py-3", className)} {...props} />;
}

export function CardFooter({ className, ...props }: DivProps) {
  return (
    <div
      className={cn("flex items-center justify-end gap-2 border-t border-line px-4 py-2.5", className)}
      {...props}
    />
  );
}
