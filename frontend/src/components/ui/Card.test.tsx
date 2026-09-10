import React from 'react';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardContent, CardFooter } from './Card';

// Mock ThemeContext to avoid "useTheme must be used within a ThemeProvider"
jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

describe('Card', () => {
  it('should render card with children', () => {
    render(<Card>Card Content</Card>);
    expect(screen.getByText('Card Content')).toBeInTheDocument();
  });

  it('should apply hover effect when hover prop is true', () => {
    const { container } = render(<Card hover>Hover Card</Card>);
    const card = container.firstChild as HTMLElement;
    expect(card).toHaveClass('hover:-translate-y-1');
  });

  it('should apply custom className', () => {
    const { container } = render(<Card className="custom-card">Custom</Card>);
    expect(container.firstChild).toHaveClass('custom-card');
  });

  it('should render CardHeader with title', () => {
    render(
      <Card>
        <CardHeader title="Card Title" />
      </Card>,
    );
    expect(screen.getByText('Card Title')).toBeInTheDocument();
  });

  it('should render CardHeader with subtitle', () => {
    render(
      <Card>
        <CardHeader title="Title" subtitle="Subtitle" />
      </Card>,
    );
    expect(screen.getByText('Subtitle')).toBeInTheDocument();
  });

  it('should render CardHeader with action', () => {
    render(
      <Card>
        <CardHeader title="Title" action={<button>Action Button</button>} />
      </Card>,
    );
    expect(screen.getByText('Action Button')).toBeInTheDocument();
  });

  it('should render CardContent', () => {
    render(
      <Card>
        <CardContent>Content Here</CardContent>
      </Card>,
    );
    expect(screen.getByText('Content Here')).toBeInTheDocument();
  });

  it('should render CardFooter', () => {
    render(
      <Card>
        <CardFooter>Footer Content</CardFooter>
      </Card>,
    );
    expect(screen.getByText('Footer Content')).toBeInTheDocument();
  });

  it('should render complex title as React node', () => {
    render(
      <Card>
        <CardHeader
          title={<span data-testid="complex-title">Complex Title</span>}
        />
      </Card>,
    );
    expect(screen.getByTestId('complex-title')).toBeInTheDocument();
  });
});
