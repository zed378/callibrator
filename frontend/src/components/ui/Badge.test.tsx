import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Badge } from './Badge';

describe('Badge', () => {
  it('should render badge with children', () => {
    render(<Badge>Badge Text</Badge>);
    expect(screen.getByText('Badge Text')).toBeInTheDocument();
  });

  it('should apply default variant styles', () => {
    const { container } = render(<Badge>Default</Badge>);
    expect(container.firstChild).toHaveClass('bg-muted');
  });

  it('should apply primary variant styles', () => {
    const { container } = render(<Badge variant="primary">Primary</Badge>);
    expect(container.firstChild).toHaveClass('bg-primary/10');
  });

  // ADR-122 Amendment 1 (2026-10-07): the success / warning / danger variants
  // are gone — a status chip is `tone` from lib/statusTone.ts (shape + icon +
  // colour). These three cases asserted the colour-only variants; they now
  // assert the type refuses them (`npm run typecheck` fails if it does not).
  it('refuses the colour-only status variants at the type level', () => {
    // @ts-expect-error -- "success" is a status: use tone (ADR-122 Am. 1)
    const success = <Badge variant="success">Success</Badge>;
    // @ts-expect-error -- "warning" is a status: use tone (ADR-122 Am. 1)
    const warning = <Badge variant="warning">Warning</Badge>;
    // @ts-expect-error -- "danger" is a status: use tone (ADR-122 Am. 1)
    const danger = <Badge variant="danger">Danger</Badge>;
    for (const el of [success, warning, danger]) {
      const { container } = render(el);
      // An unknown variant renders no colour class at all.
      expect(container.firstChild).not.toHaveClass('bg-success/10');
      expect(container.firstChild).not.toHaveClass('bg-warning/10');
      expect(container.firstChild).not.toHaveClass('bg-destructive/10');
    }
  });

  it('should apply info variant styles', () => {
    const { container } = render(<Badge variant="info">Info</Badge>);
    expect(container.firstChild).toHaveClass('bg-info/10');
  });

  it('should apply secondary variant styles', () => {
    const { container } = render(<Badge variant="secondary">Secondary</Badge>);
    expect(container.firstChild).toHaveClass('bg-secondary');
  });

  it('should apply small size', () => {
    const { container } = render(<Badge size="sm">Small</Badge>);
    expect(container.firstChild).toHaveClass('px-2 py-0.5 text-xs font-semibold tracking-wide');
  });

  it('should apply medium size by default', () => {
    const { container } = render(<Badge>Medium</Badge>);
    expect(container.firstChild).toHaveClass('px-2.5 py-0.5 text-sm font-semibold');
  });

  it('should render removable badge', () => {
    const handleRemove = jest.fn();
    render(
      <Badge removable onRemove={handleRemove}>
        Removable
      </Badge>,
    );

    expect(screen.getByText('Removable')).toBeInTheDocument();
    const removeButton = screen.getByRole('button');
    expect(removeButton).toBeInTheDocument();

    fireEvent.click(removeButton);
    expect(handleRemove).toHaveBeenCalled();
  });

  it('should apply custom className', () => {
    const { container } = render(
      <Badge className="custom-badge">Custom</Badge>,
    );
    expect(container.firstChild).toHaveClass('custom-badge');
  });
});
