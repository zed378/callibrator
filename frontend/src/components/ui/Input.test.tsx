import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './Input';

// Mock ThemeContext to avoid "useTheme must be used within a ThemeProvider"
jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

describe('Input', () => {
  it('should render input with label', () => {
    render(<Input label="Username" name="username" id="username-input" />);
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(screen.getByText('Username')).toBeInTheDocument();
  });

  it('should apply error styling when error is provided', () => {
    const { container } = render(<Input error="This field is required" />);
    const input = container.querySelector('input');
    expect(input).toHaveClass('border-destructive');
  });

  it('should display error message', () => {
    render(<Input error="This field is required" />);
    expect(screen.getByText('This field is required')).toBeInTheDocument();
  });

  it('should display helper text when no error', () => {
    render(<Input helperText="Enter your email" />);
    expect(screen.getByText('Enter your email')).toBeInTheDocument();
  });

  it('should not display helper text when error exists', () => {
    const { container } = render(
      <Input error="Required" helperText="This should not appear" />,
    );
    expect(
      screen.queryByText('This should not appear'),
    ).not.toBeInTheDocument();
  });

  it('should handle password type with show/hide toggle', () => {
    const { container } = render(<Input type="password" />);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.type).toBe('password');

    // Find the eye icon button
    const eyeButton = container.querySelectorAll('button')[0];
    fireEvent.click(eyeButton);

    expect(input.type).toBe('text');
  });

  it('should apply left icon styling', () => {
    const { container } = render(<Input leftIcon={<span>🔍</span>} />);
    const input = container.querySelector('input');
    expect(input).toHaveClass('pl-11');
  });

  it('should apply right icon styling', () => {
    const { container } = render(<Input rightIcon={<span>✕</span>} />);
    const input = container.querySelector('input');
    expect(input).toHaveClass('pr-11');
  });

  it('should call onRightIconClick when right icon is clicked', () => {
    const handleClick = jest.fn();
    render(<Input onRightIconClick={handleClick} />);
    // The password toggle button is the right icon button
    const buttons = document.querySelectorAll('button');
    buttons[0]?.click();
    expect(handleClick).toHaveBeenCalled();
  });

  it('should be disabled when disabled prop is true', () => {
    const { container } = render(<Input disabled />);
    expect(container.querySelector('input')).toBeDisabled();
  });

  it('should apply custom className', () => {
    const { container } = render(<Input className="custom-input" />);
    expect(container.querySelector('input')).toHaveClass('custom-input');
  });

  it('should handle input changes', () => {
    const handleChange = jest.fn();
    render(<Input onChange={handleChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'test value' } });
    expect(handleChange).toHaveBeenCalled();
  });

  it('should render with placeholder', () => {
    render(<Input placeholder="Enter text..." />);
    expect(screen.getByPlaceholderText('Enter text...')).toBeInTheDocument();
  });
});
