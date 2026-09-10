import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Table } from './Table';

// Mock ThemeContext to avoid "useTheme must be used within a ThemeProvider"
jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

describe('Table', () => {
  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'email', header: 'Email' },
  ];

  const data = [
    { name: 'John Doe', email: 'john@example.com' },
    { name: 'Jane Smith', email: 'jane@example.com' },
  ];

  it('should render table with columns and data', () => {
    render(<Table columns={columns} data={data} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('john@example.com')).toBeInTheDocument();
  });

  it('should render loading state', () => {
    render(<Table columns={columns} data={data} isLoading />);
    expect(screen.getByText('Loading data...')).toBeInTheDocument();
  });

  it('should render empty message when no data', () => {
    render(<Table columns={columns} data={[]} />);
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('should render custom empty message', () => {
    render(<Table columns={columns} data={[]} emptyMessage="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('should call onRowClick when row is clicked', () => {
    const handleRowClick = jest.fn();
    render(<Table columns={columns} data={data} onRowClick={handleRowClick} />);

    const rows = document.querySelectorAll('tbody tr');
    fireEvent.click(rows[0]);
    expect(handleRowClick).toHaveBeenCalledWith(data[0]);
  });

  it('should render custom column renderer', () => {
    const columnsWithRender = [
      {
        key: 'name',
        header: 'Name',
        render: (value: unknown, row?: unknown) => {
          if (typeof value === 'string' && row) {
            return <span data-testid="custom-render">{String(value)}</span>;
          }
          return String(value);
        },
      },
      { key: 'email', header: 'Email' },
    ];

    render(<Table columns={columnsWithRender} data={data} />);
    const customElements = screen.getAllByTestId('custom-render');
    expect(customElements.length).toBeGreaterThan(0);
    expect(screen.getByText('John Doe')).toBeInTheDocument();
  });

  it('should apply cell className from column definition', () => {
    const columnsWithClassName = [
      { key: 'name', header: 'Name', className: 'custom-col-class' },
    ];

    const { container } = render(
      <Table columns={columnsWithClassName} data={data} />,
    );
    const th = container.querySelector('th');
    expect(th).toHaveClass('custom-col-class');
  });
});
