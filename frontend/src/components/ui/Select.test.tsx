import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Select } from './Select';

// Mock ThemeContext to avoid "useTheme must be used within a ThemeProvider"
jest.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

const options = [
  { value: '1', label: 'Option 1' },
  { value: '2', label: 'Option 2' },
  { value: '3', label: 'Option 3' },
];

describe('Select', () => {
  it('should render select with options', () => {
    render(
      <Select
        value="1"
        onChange={() => {}}
        options={options}
        placeholder="Select an option"
      />
    );
    // The select is a button with aria-haspopup
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.getByText('Option 1')).toBeInTheDocument();
  });

  it('should display placeholder', () => {
    render(
      <Select
        value=""
        onChange={() => {}}
        options={options}
        placeholder="Choose..."
      />
    );
    expect(screen.getByText('Choose...')).toBeInTheDocument();
  });

  it('should use default placeholder', () => {
    render(
      <Select
        value=""
        onChange={() => {}}
        options={options}
      />
    );
    expect(screen.getByText('Select an option...')).toBeInTheDocument();
  });

  it('should call onChange on selection', async () => {
    const onChange = jest.fn();
    render(
      <Select
        value=""
        onChange={onChange}
        options={options}
      />
    );
    const button = screen.getByRole('button');
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Option 2'));
    expect(onChange).toHaveBeenCalledWith('2');
  });

  it('should apply custom className', () => {
    const { container } = render(
      <Select
        value=""
        onChange={() => {}}
        options={options}
        className="custom-class"
      />
    );
    const selectWrapper = container.querySelector('div.relative');
    expect(selectWrapper).toHaveClass('custom-class');
  });

  it('should render the selected option as button text', () => {
    render(
      <Select
        value="2"
        onChange={() => {}}
        options={options}
      />
    );
    expect(screen.getByText('Option 2')).toBeInTheDocument();
  });

  it('should render the dropdown when the button is clicked', () => {
    render(
      <Select
        value=""
        onChange={() => {}}
        options={options}
      />
    );
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('should highlight the selected option in dropdown', () => {
    render(
      <Select
        value="2"
        onChange={() => {}}
        options={options}
      />
    );
    const button = screen.getByRole('button');
    fireEvent.click(button);
    // Option 2 is selected, should have aria-selected=true
    const selectedOption = screen.getByRole('option', { name: 'Option 2' });
    expect(selectedOption).toHaveAttribute('aria-selected', 'true');
  });

  it('should call onChange with correct value when option is clicked', async () => {
    const onChange = jest.fn();
    render(
      <Select
        value=""
        onChange={onChange}
        options={options}
      />
    );
    const button = screen.getByRole('button');
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Option 3'));
    expect(onChange).toHaveBeenCalledWith('3');
  });

  it('should render empty options gracefully', () => {
    render(
      <Select
        value=""
        onChange={() => {}}
        options={[]}
      />
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
    expect(screen.getByText('Select an option...')).toBeInTheDocument();
  });

  it('should have correct aria attributes', () => {
    render(
      <Select
        value="1"
        onChange={() => {}}
        options={options}
      />
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('should toggle dropdown open/closed', () => {
    render(
      <Select
        value=""
        onChange={() => {}}
        options={options}
      />
    );
    const button = screen.getByRole('button');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});
