import React from "react";

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

interface CardHeaderProps {
  title: string | React.ReactNode;
  subtitle?: string | React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
}

interface CardContentProps {
  children: React.ReactNode;
  className?: string;
}

interface CardFooterProps {
  children: React.ReactNode;
  className?: string;
}

export const Card: React.FC<CardProps> = ({
  children,
  className = "",
  hover = false,
}) => {
  return (
    <div
      className={`rounded-2xl transition-all duration-300 bg-card text-card-foreground border border-border ${
        hover
          ? "hover:-translate-y-1 hover:shadow-xl hover:border-primary/25 shadow-sm"
          : "shadow-xs"
      } ${className}`}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<CardHeaderProps> = ({
  title,
  subtitle,
  action,
  children,
}) => {
  return (
    <div className="p-6 border-b border-border">
      <div className="flex items-center justify-between gap-4">
        <div>
          {typeof title === "string" ? (
            <h3 className="text-lg font-bold tracking-tight text-foreground">
              {title}
            </h3>
          ) : (
            <span className="font-bold text-foreground">
              {title}
            </span>
          )}
          {subtitle && (
            <p className="text-sm mt-1 text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
};

export const CardContent: React.FC<CardContentProps> = ({
  children,
  className = "",
}) => {
  return <div className={`p-6 ${className}`}>{children}</div>;
};

export const CardFooter: React.FC<CardFooterProps> = ({
  children,
  className = "",
}) => {
  return (
    <div
      className={`p-6 border-t border-border ${className}`}
    >
      {children}
    </div>
  );
};
