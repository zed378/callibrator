import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Alert } from './Alert';

describe('Alert', () => {
  it('should render alert with children', () => {
    render(<Alert>Alert message</Alert>);
    expect(screen.getByText('Alert message')).toBeInTheDocument();
  });

  it('should render with title', () => {
    render(<Alert title="Alert Title">Content</Alert>);
    expect(screen.getByText('Alert Title')).toBeInTheDocument();
  });

  it('should apply default variant styles', () => {
    const { container } = render(<Alert>Default</Alert>);
    expect(container.firstChild).toHaveClass('bg-muted');
  });

  it('should apply success variant styles', () => {
    const { container } = render(<Alert variant="success">Success</Alert>);
    expect(container.firstChild).toHaveClass('bg-success/10');
  });

  it('should apply warning variant styles', () => {
    const { container } = render(<Alert variant="warning">Warning</Alert>);
    expect(container.firstChild).toHaveClass('bg-warning/10');
  });

  it('should apply error variant styles', () => {
    const { container } = render(<Alert variant="error">Error</Alert>);
    expect(container.firstChild).toHaveClass('bg-destructive/10');
  });

  it('should apply info variant styles', () => {
    const { container } = render(<Alert variant="info">Info</Alert>);
    expect(container.firstChild).toHaveClass('bg-info/10');
  });

  it('should render close button when onClose is provided', () => {
    const handleClose = jest.fn();
    const { container } = render(
      <Alert onClose={handleClose}>With Close</Alert>,
    );
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(1);

    fireEvent.click(buttons[0]);
    expect(handleClose).toHaveBeenCalled();
  });

  it('should not render close button when onClose is not provided', () => {
    const { container } = render(<Alert>No Close</Alert>);
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(0);
  });

  it('should apply custom className', () => {
    const { container } = render(
      <Alert className="custom-alert">Custom</Alert>,
    );
    expect(container.firstChild).toHaveClass('custom-alert');
  });
});
