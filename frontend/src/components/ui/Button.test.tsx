import React from 'react';
import { render, screen } from '@testing-library/react';
import { Button } from './Button';
import { Loader2 } from 'lucide-react';

describe('Button', () => {
  it('should render button with children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText('Click me')).toBeInTheDocument();
  });

  it('should apply primary variant by default', () => {
    const { container } = render(<Button>Primary</Button>);
    const button = container.querySelector('button');
    expect(button).toHaveClass('bg-primary');
  });

  it('should apply secondary variant', () => {
    const { container } = render(
      <Button variant="secondary">Secondary</Button>,
    );
    const button = container.querySelector('button');
    expect(button).toHaveClass('bg-secondary');
  });

  it('should apply outline variant', () => {
    const { container } = render(<Button variant="outline">Outline</Button>);
    const button = container.querySelector('button');
    expect(button).toHaveClass('border-primary/40');
  });

  it('should apply danger variant', () => {
    const { container } = render(<Button variant="danger">Danger</Button>);
    const button = container.querySelector('button');
    expect(button).toHaveClass('bg-destructive');
  });

  it('should apply different sizes', () => {
    const { container: sm } = render(<Button size="sm">Small</Button>);
    const { container: md } = render(<Button size="md">Medium</Button>);
    const { container: lg } = render(<Button size="lg">Large</Button>);

    expect(sm.querySelector('button')).toHaveClass('px-3.5 py-1.5 text-xs');
    expect(md.querySelector('button')).toHaveClass('px-5 py-2.5 text-sm');
    expect(lg.querySelector('button')).toHaveClass('px-7 py-3.5 text-base');
  });

  it('should show loading spinner when isLoading is true', () => {
    const { container } = render(<Button isLoading>Loading</Button>);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('should be disabled when isLoading is true', () => {
    const { container } = render(<Button isLoading>Disabled</Button>);
    expect(container.querySelector('button')).toBeDisabled();
  });

  it('should be disabled when disabled prop is true', () => {
    const { container } = render(<Button disabled>Disabled</Button>);
    expect(container.querySelector('button')).toBeDisabled();
  });

  it('should render left icon', () => {
    const { container } = render(
      <Button leftIcon={<span data-testid="left-icon">Left</span>}>
        With Icon
      </Button>,
    );
    expect(screen.getByTestId('left-icon')).toBeInTheDocument();
  });

  it('should render right icon', () => {
    const { container } = render(
      <Button rightIcon={<span data-testid="right-icon">Right</span>}>
        With Icon
      </Button>,
    );
    expect(screen.getByTestId('right-icon')).toBeInTheDocument();
  });

  it('should apply custom className', () => {
    const { container } = render(
      <Button className="custom-class">Custom</Button>,
    );
    expect(container.querySelector('button')).toHaveClass('custom-class');
  });

  it('should call onClick handler', () => {
    const handleClick = jest.fn();
    render(<Button onClick={handleClick}>Click</Button>);
    screen.getByText('Click').click();
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('should not call onClick when disabled', () => {
    const handleClick = jest.fn();
    render(
      <Button disabled onClick={handleClick}>
        Click
      </Button>,
    );
    screen.getByText('Click').click();
    expect(handleClick).not.toHaveBeenCalled();
  });
});
