/** @jest-environment jsdom */
/**
 * Risk register page against the backend contract
 * (backend/src/routes/api/risk.route.js, mounted /api/v1/risk;
 * controllers/risk.controller.js):
 *  - GET  /?status&category → risk rows in `data`, pagination in a top-level `meta`;
 *  - POST / → 201 · PUT /:id · DELETE /:id (404 "Risk not found").
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { axeViolations } from '@/tests/a11y/axe';
import { httpError } from '@/tests/support/httpError';

jest.mock('@/components/layouts/DashboardLayout', () => {
  return function DashboardLayout({ children }: { children: React.ReactNode }) {
    return <main>{children}</main>;
  };
});

jest.mock('@/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from '@/api/client';
import { useToastStore } from '@/stores/toastStore';
import RiskPage from '../page';
import { grantPermissions, grantSuperAdmin, clearPermissions } from "@/tests/support/permissions";

const mockedGet = api.get as jest.Mock;
const mockedPost = api.post as jest.Mock;
const mockedPut = api.put as jest.Mock;
const mockedDelete = api.delete as jest.Mock;

const ok = (data: unknown, message = 'ok', meta?: unknown) => ({
  success: true,
  status: 200,
  message,
  data,
  ...(meta ? { meta } : {}),
});

const risk = (
  id: string,
  title: string,
  severity: number,
  likelihood: number,
  status: string,
  category: string,
  extra: Record<string, unknown> = {}
) => ({
  id,
  tenantId: 't-1',
  title,
  description: null,
  category,
  severity,
  likelihood,
  rpn: severity * likelihood,
  status,
  mitigationPlan: null,
  identifiedBy: 'u-1',
  assignedTo: null,
  dueDate: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...extra,
});

let risks: ReturnType<typeof risk>[];

const backend = () => {
  mockedGet.mockImplementation(
    async (
      url: string,
      config?: { params?: { status?: string; category?: string; page?: number; limit?: number } }
    ) => {
      if (url !== '/api/v1/risk') throw httpError(404, 'Not found');
      const matching = risks.filter(
        (r) =>
          (!config?.params?.status || r.status === config.params.status) &&
          (!config?.params?.category || r.category === config.params.category)
      );
      // risk.service getRisks: `limit` defaults to 10, `page` to 1; meta beside data.
      const page = config?.params?.page ?? 1;
      const limit = config?.params?.limit ?? 10;
      const rows = matching.slice((page - 1) * limit, page * limit);
      return ok(rows, 'Risks retrieved successfully', {
        total: matching.length,
        page,
        limit,
        totalPages: Math.ceil(matching.length / limit),
      });
    }
  );
};

const toasts = () =>
  useToastStore
    .getState()
    .toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));
const rowOf = (title: string) => screen.getByText(title).closest('tr') as HTMLElement;

beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantPermissions({ risk: "write" });
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  risks = [
    risk('r-1', 'Ventilator calibration drift', 5, 4, 'OPEN', 'SAFETY', {
      description: 'Pressure sensor drifts',
      dueDate: '2026-10-15T00:00:00.000Z',
      mitigationPlan: 'Monthly check',
    }),
    risk('r-2', 'Supplier lead time', 2, 3, 'MITIGATED', 'OPERATIONAL'),
    risk('r-3', 'Budget overrun', 3, 3, 'CLOSED', 'FINANCIAL'),
  ];
  backend();
});

const renderLoaded = async () => {
  const view = render(<RiskPage />);
  await screen.findByText('Ventilator calibration drift');
  return view;
};

describe('risk register — paging (F-19)', () => {
  it('F-19: past 10 risks the page says how many there are and pages to the rest', async () => {
    risks = Array.from({ length: 12 }, (_, i) =>
      risk(`r-${i + 1}`, `Risk number ${i + 1}`, 1, 1, 'OPEN', 'SAFETY')
    );
    render(<RiskPage />);
    await screen.findByText('Risk number 1');

    expect(screen.queryByText('Risk number 11')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing/).parentElement).toHaveTextContent(
      /Showing\s*1\s*to\s*10\s*of\s*12\s*results/
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Risk number 11')).toBeInTheDocument();
    expect(mockedGet).toHaveBeenLastCalledWith('/api/v1/risk', {
      params: { status: undefined, category: undefined, page: 2, limit: 10 },
    });

    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), {
      target: { value: '25' },
    });
    await waitFor(() =>
      expect(mockedGet).toHaveBeenLastCalledWith('/api/v1/risk', {
        params: { status: undefined, category: undefined, page: 1, limit: 25 },
      })
    );
  });

  it('F-19: a changed filter goes back to the first page', async () => {
    risks = Array.from({ length: 12 }, (_, i) =>
      risk(`r-${i + 1}`, `Risk number ${i + 1}`, 1, 1, 'OPEN', 'SAFETY')
    );
    render(<RiskPage />);
    await screen.findByText('Risk number 1');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await screen.findByText('Risk number 11');

    fireEvent.click(screen.getByRole('button', { name: 'All Categories' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Safety' }));
    });
    await waitFor(() =>
      expect(mockedGet).toHaveBeenLastCalledWith('/api/v1/risk', {
        params: { status: undefined, category: 'SAFETY', page: 1, limit: 10 },
      })
    );
  });

  it('F-19: no pager on a failed read', async () => {
    mockedGet.mockRejectedValue(httpError(500, 'Boom'));
    render(<RiskPage />);
    await screen.findByText('Boom');
    expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();
  });
});

describe('risk register — reading', () => {
  it('lists risks with their RPN banded by severity × likelihood', async () => {
    const { container } = await renderLoaded();

    const vent = rowOf('Ventilator calibration drift');
    expect(within(vent).getByText('20')).toHaveClass('text-destructive');
    expect(within(vent).getByText('safety')).toBeInTheDocument();
    expect(within(vent).getByText('OPEN')).toBeInTheDocument();
    expect(
      within(vent).getByText(new Date('2026-10-15T00:00:00.000Z').toLocaleDateString())
    ).toBeInTheDocument();
    expect(within(rowOf('Supplier lead time')).getByText('6')).toHaveClass('text-success');
    expect(within(rowOf('Budget overrun')).getByText('9')).toHaveClass('text-warning');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('no risks is the empty state', async () => {
    risks = [];
    render(<RiskPage />);

    expect(await screen.findByText('No risks recorded yet.')).toBeInTheDocument();
  });

  it('a failed read shows the error, not the empty state', async () => {
    mockedGet.mockRejectedValue(httpError(403, 'You do not have permission to read risks'));
    const { container } = render(<RiskPage />);

    expect(await screen.findByText('You do not have permission to read risks')).toBeInTheDocument();
    expect(screen.getByText('Risks could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No risks recorded yet.')).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('searches title and description on the page', async () => {
    await renderLoaded();

    fireEvent.change(screen.getByPlaceholderText('Search this page...'), {
      target: { value: '  PRESSURE ' },
    });

    expect(screen.getByText('Ventilator calibration drift')).toBeInTheDocument();
    expect(screen.queryByText('Supplier lead time')).not.toBeInTheDocument();
  });

  it('filters by status and category on the server', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'All Statuses' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Mitigated' }));
    });
    await waitFor(() =>
      expect(mockedGet).toHaveBeenLastCalledWith('/api/v1/risk', {
        params: { status: 'MITIGATED', category: undefined, page: 1, limit: 10 },
      })
    );
    await waitFor(() =>
      expect(screen.queryByText('Ventilator calibration drift')).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'All Categories' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Financial' }));
    });
    await waitFor(() =>
      expect(mockedGet).toHaveBeenLastCalledWith('/api/v1/risk', {
        params: { status: 'MITIGATED', category: 'FINANCIAL', page: 1, limit: 10 },
      })
    );
    expect(await screen.findByText('No risks recorded yet.')).toBeInTheDocument();
  });
});

describe('risk register — recording', () => {
  it('needs a title', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Add Risk' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Risk' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Risk' }));

    expect(toasts()).toContainEqual({
      type: 'error',
      title: 'Title is required',
      description: undefined,
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('creates a risk, showing the live RPN, and POSTs it', async () => {
    mockedPost.mockResolvedValue({
      ...ok(risk('r-4', 'Power outage', 4, 4, 'OPEN', 'SAFETY'), 'Risk created successfully'),
      status: 201,
    });
    const { container } = await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Add Risk' }));
    const dialog = screen.getByRole('dialog', { name: 'Add Risk' });
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText(/Title/), { target: { value: 'Power outage' } });
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Grid failure' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Category/ }));
    fireEvent.click(within(dialog).getByRole('option', { name: 'Safety' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Severity/ }));
    fireEvent.click(within(dialog).getByRole('option', { name: '4' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /^Likelihood/ }));
    fireEvent.click(within(dialog).getByRole('option', { name: '4' }));
    expect(within(dialog).getByText('16')).toHaveClass('text-destructive');
    fireEvent.change(within(dialog).getByLabelText('Mitigation Plan'), {
      target: { value: 'UPS' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create Risk' }));
    });

    expect(mockedPost).toHaveBeenCalledWith('/api/v1/risk', {
      title: 'Power outage',
      description: 'Grid failure',
      category: 'SAFETY',
      severity: 4,
      likelihood: 4,
      status: 'OPEN',
      mitigationPlan: 'UPS',
      dueDate: undefined,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toasts()).toContainEqual({
      type: 'success',
      title: 'Risk created',
      description: undefined,
    });
  });

  it('edits a risk from its saved values and PUTs the change', async () => {
    mockedPut.mockResolvedValue(ok(risks[0], 'Risk updated successfully'));
    await renderLoaded();

    fireEvent.click(
      within(rowOf('Ventilator calibration drift')).getByRole('button', { name: 'Edit risk' })
    );
    const dialog = screen.getByRole('dialog', { name: 'Edit Risk' });
    expect(within(dialog).getByLabelText(/Title/)).toHaveValue('Ventilator calibration drift');
    expect(within(dialog).getByLabelText('Due Date')).toHaveValue('2026-10-15');

    fireEvent.click(within(dialog).getByRole('button', { name: /^Status/ }));
    fireEvent.click(within(dialog).getByRole('option', { name: 'Mitigated' }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    });

    expect(mockedPut).toHaveBeenCalledWith('/api/v1/risk/r-1', {
      title: 'Ventilator calibration drift',
      description: 'Pressure sensor drifts',
      category: 'SAFETY',
      severity: 5,
      likelihood: 4,
      status: 'MITIGATED',
      mitigationPlan: 'Monthly check',
      dueDate: '2026-10-15',
    });
    expect(toasts()).toContainEqual({
      type: 'success',
      title: 'Risk updated',
      description: undefined,
    });
  });

  it('a refused save keeps the form and gives the reason', async () => {
    mockedPut.mockRejectedValue(httpError(404, 'Risk not found'));
    await renderLoaded();

    fireEvent.click(within(rowOf('Supplier lead time')).getByRole('button', { name: 'Edit risk' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Risk' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    });

    expect(toasts()).toContainEqual({
      type: 'error',
      title: 'Save failed',
      description: 'Risk not found',
    });
    expect(screen.getByRole('dialog', { name: 'Edit Risk' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('risk register — deleting (confirmed)', () => {
  it('names the risk, asks first, then DELETEs', async () => {
    mockedDelete.mockImplementation(async () => {
      risks = risks.slice(1);
      return ok(null, 'Risk deleted successfully');
    });
    await renderLoaded();

    fireEvent.click(
      within(rowOf('Ventilator calibration drift')).getByRole('button', { name: 'Delete risk' })
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete Risk' });
    expect(within(dialog).getByText('Ventilator calibration drift')).toBeInTheDocument();
    expect(mockedDelete).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });

    expect(mockedDelete).toHaveBeenCalledWith('/api/v1/risk/r-1');
    await waitFor(() =>
      expect(screen.queryByText('Ventilator calibration drift')).not.toBeInTheDocument()
    );
  });

  it('Cancel sends nothing; a refused delete keeps the confirmation', async () => {
    mockedDelete.mockRejectedValue(httpError(404, 'Risk not found'));
    await renderLoaded();

    fireEvent.click(within(rowOf('Budget overrun')).getByRole('button', { name: 'Delete risk' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(mockedDelete).not.toHaveBeenCalled();

    fireEvent.click(within(rowOf('Budget overrun')).getByRole('button', { name: 'Delete risk' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    });

    expect(toasts()).toContainEqual({
      type: 'error',
      title: 'Delete failed',
      description: 'Risk not found',
    });
    expect(screen.getByRole('dialog', { name: 'Delete Risk' })).toBeInTheDocument();
  });
});

/**
 * ADR-102 — risk register writes are gated on `risk` write. ENGINEERING MANAGER holds `risk` read.
 * Before the permissions load nothing is writable; the super admin writes.
 * Fail-before: Add Risk, Edit and Delete rendered for every role.
 */
describe("ADR-102 — risk register write controls follow the effective permission", () => {
  const writeControls = [
      /Add Risk/,
      "Edit risk",
      "Delete risk",
  ];

  it("a reader gets none of the write controls", async () => {
    grantPermissions({ "risk": "read" });
    render(<RiskPage />);
    await screen.findByText('Ventilator calibration drift');
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    render(<RiskPage />);
    await screen.findByText('Ventilator calibration drift');
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("the super admin gets them", async () => {
    grantSuperAdmin();
    render(<RiskPage />);
    await screen.findByText('Ventilator calibration drift');
    expect(screen.getAllByRole("button", { name: /Add Risk/ }).length).toBeGreaterThan(0);
  });
});
