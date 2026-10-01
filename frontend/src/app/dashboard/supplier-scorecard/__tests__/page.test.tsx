/** @jest-environment jsdom */
/**
 * Supplier scorecard page against the backend contract
 * (backend/src/routes/api/supplierScorecard.route.js, mounted
 * /api/v1/supplier-scorecard; controllers/supplierScorecard.controller.js):
 *  - GET  /?vendorId&status → scorecard rows in `data`, pagination in a
 *    top-level `meta`;
 *  - POST / → 201 (404 "Vendor not found") · PUT /:id · DELETE /:id (404
 *    "Scorecard not found").
 *  - vendor names come from GET /api/v1/vendors (rows in `data`).
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
import SupplierScorecardPage from '../page';
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

const scorecard = (
  id: string,
  vendorId: string,
  q: number,
  d: number,
  s: number,
  status: string,
  extra: Record<string, unknown> = {}
) => ({
  id,
  tenantId: 't-1',
  vendorId,
  evaluationDate: '2026-06-30T00:00:00.000Z',
  qualityScore: q,
  deliveryScore: d,
  serviceScore: s,
  overallScore: Math.round((q + d + s) / 3),
  status,
  comments: null,
  evaluatedBy: 'u-1',
  nextEvaluationDate: null,
  createdAt: '2026-06-30T00:00:00.000Z',
  updatedAt: '2026-06-30T00:00:00.000Z',
  ...extra,
});

let scorecards: ReturnType<typeof scorecard>[];

const backend = () => {
  mockedGet.mockImplementation(
    async (
      url: string,
      config?: { params?: { vendorId?: string; status?: string; page?: number; limit?: number } }
    ) => {
      if (url === '/api/v1/vendors') {
        return ok(
          [
            { id: 'v-1', name: 'PT Medika' },
            { id: 'v-2', name: 'CV Kalibra' },
          ],
          'ok',
          { total: 2, page: 1, limit: 100, totalPages: 1 }
        );
      }
      if (url === '/api/v1/supplier-scorecard') {
        const matching = scorecards.filter(
          (s) =>
            (!config?.params?.vendorId || s.vendorId === config.params.vendorId) &&
            (!config?.params?.status || s.status === config.params.status)
        );
        // supplierScorecard.service: `limit` defaults to 10, `page` to 1.
        const page = config?.params?.page ?? 1;
        const limit = config?.params?.limit ?? 10;
        const rows = matching.slice((page - 1) * limit, page * limit);
        return ok(rows, 'Scorecards retrieved successfully', {
          total: matching.length,
          page,
          limit,
          totalPages: Math.ceil(matching.length / limit),
        });
      }
      throw httpError(404, 'Not found');
    }
  );
};

const toasts = () =>
  useToastStore
    .getState()
    .toasts.map((t) => ({ type: t.type, title: t.title, description: t.description }));
const rowOf = (vendor: string) =>
  screen.getByText(vendor, { selector: 'span' }).closest('tr') as HTMLElement;

beforeEach(() => {
  // ADR-102: write controls follow the effective permissions.
  grantPermissions({ "supplier-scorecard": "write" });
  jest.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  scorecards = [
    scorecard('sc-1', 'v-1', 90, 85, 80, 'APPROVED'),
    scorecard('sc-2', 'v-2', 50, 60, 55, 'PROBATION', {
      comments: 'Late twice',
      nextEvaluationDate: '2026-12-31T00:00:00.000Z',
    }),
  ];
  backend();
});

const renderLoaded = async () => {
  const view = render(<SupplierScorecardPage />);
  await screen.findByText('PT Medika', { selector: 'span' });
  return view;
};

describe('supplier scorecards — paging (F-19)', () => {
  it('F-19: past 10 evaluations the page says how many there are and pages to the rest', async () => {
    scorecards = Array.from({ length: 12 }, (_, i) =>
      scorecard(`sc-${i + 1}`, 'v-1', 90, 85, 80, 'APPROVED', { comments: `Evaluation ${i + 1}` })
    );
    render(<SupplierScorecardPage />);
    await waitFor(() =>
      expect(screen.getByText(/Showing/).parentElement).toHaveTextContent(/1\s*to\s*10\s*of\s*12/)
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(mockedGet).toHaveBeenLastCalledWith('/api/v1/supplier-scorecard', {
        params: { vendorId: undefined, status: undefined, page: 2, limit: 10 },
      })
    );
    await waitFor(() =>
      expect(screen.getByText(/Showing/).parentElement).toHaveTextContent(/11\s*to\s*12\s*of\s*12/)
    );
  });
});

describe('supplier scorecards — reading', () => {
  it('lists evaluations by vendor name with the three scores, overall and status', async () => {
    const { container } = await renderLoaded();

    const medika = rowOf('PT Medika');
    expect(within(medika).getByText('90')).toBeInTheDocument();
    // Overall = round((90 + 85 + 80) / 3) = 85, badged as good.
    expect(within(medika).getByText('85', { selector: 'span' })).toHaveClass('text-success');
    expect(within(medika).getByText('APPROVED')).toBeInTheDocument();
    expect(
      within(medika).getByText(new Date('2026-06-30T00:00:00.000Z').toLocaleDateString())
    ).toBeInTheDocument();

    const kalibra = rowOf('CV Kalibra');
    expect(within(kalibra).getByText('55', { selector: 'span' })).toHaveClass('text-destructive');
    expect(within(kalibra).getByText('PROBATION')).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('no evaluations is the empty state', async () => {
    scorecards = [];
    render(<SupplierScorecardPage />);

    expect(await screen.findByText('No supplier evaluations recorded yet.')).toBeInTheDocument();
  });

  it('a failed read shows the error, not the empty state', async () => {
    mockedGet.mockImplementation(async (url: string) => {
      if (url === '/api/v1/supplier-scorecard')
        throw httpError(403, 'You do not have permission to read supplier scorecards');
      return ok([]);
    });
    const { container } = render(<SupplierScorecardPage />);

    expect(
      await screen.findByText('You do not have permission to read supplier scorecards')
    ).toBeInTheDocument();
    expect(screen.getByText('Supplier evaluations could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No supplier evaluations recorded yet.')).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('filters by vendor and by status', async () => {
    await renderLoaded();

    fireEvent.click(screen.getByRole('button', { name: 'All Vendors' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'CV Kalibra' }));
    });
    await waitFor(() =>
      expect(mockedGet).toHaveBeenLastCalledWith('/api/v1/supplier-scorecard', {
        params: { vendorId: 'v-2', status: undefined, page: 1, limit: 10 },
      })
    );
    await waitFor(() =>
      expect(screen.queryByText('PT Medika', { selector: 'span' })).not.toBeInTheDocument()
    );

    fireEvent.click(screen.getByRole('button', { name: 'All Statuses' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('option', { name: 'Disqualified' }));
    });
    await waitFor(() =>
      expect(mockedGet).toHaveBeenLastCalledWith('/api/v1/supplier-scorecard', {
        params: { vendorId: 'v-2', status: 'DISQUALIFIED', page: 1, limit: 10 },
      })
    );
    expect(await screen.findByText('No supplier evaluations recorded yet.')).toBeInTheDocument();
  });
});

describe('supplier scorecards — evaluating', () => {
  it('needs a vendor', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'New Evaluation' }));
    const dialog = screen.getByRole('dialog', { name: 'New Evaluation' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create Evaluation' }));

    expect(toasts()).toContainEqual({
      type: 'error',
      title: 'Vendor is required',
      description: undefined,
    });
    expect(mockedPost).not.toHaveBeenCalled();
  });

  it('creates an evaluation, showing the live overall score, and POSTs it', async () => {
    mockedPost.mockResolvedValue({
      ...ok(scorecard('sc-3', 'v-1', 70, 80, 90, 'APPROVED'), 'Scorecard created successfully'),
      status: 201,
    });
    const { container } = await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'New Evaluation' }));
    const dialog = screen.getByRole('dialog', { name: 'New Evaluation' });
    expect(await axeViolations(container)).toEqual([]);

    fireEvent.click(within(dialog).getByRole('button', { name: /^Vendor/ }));
    fireEvent.click(within(dialog).getByRole('option', { name: 'PT Medika' }));
    fireEvent.change(within(dialog).getByLabelText('Quality (0-100)'), { target: { value: '70' } });
    fireEvent.change(within(dialog).getByLabelText('Delivery (0-100)'), {
      target: { value: '80' },
    });
    fireEvent.change(within(dialog).getByLabelText('Service (0-100)'), { target: { value: '90' } });
    expect(within(dialog).getByText('80')).toHaveClass('text-success');
    fireEvent.change(within(dialog).getByLabelText(/Evaluation Date/), {
      target: { value: '2026-09-01' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Status/ }));
    fireEvent.click(within(dialog).getByRole('option', { name: 'Probation' }));
    fireEvent.change(within(dialog).getByLabelText('Comments'), {
      target: { value: 'Good service' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create Evaluation' }));
    });

    expect(mockedPost).toHaveBeenCalledWith('/api/v1/supplier-scorecard', {
      vendorId: 'v-1',
      evaluationDate: '2026-09-01',
      qualityScore: 70,
      deliveryScore: 80,
      serviceScore: 90,
      status: 'PROBATION',
      comments: 'Good service',
      nextEvaluationDate: undefined,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(toasts()).toContainEqual({
      type: 'success',
      title: 'Scorecard created',
      description: undefined,
    });
  });

  it('edits an evaluation with its saved values and PUTs the change', async () => {
    mockedPut.mockResolvedValue(ok(scorecard('sc-2', 'v-2', 50, 60, 70, 'PROBATION')));
    await renderLoaded();

    fireEvent.click(within(rowOf('CV Kalibra')).getByRole('button', { name: 'Edit scorecard' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Evaluation' });
    expect(within(dialog).getByLabelText('Service (0-100)')).toHaveValue(55);
    expect(within(dialog).getByLabelText(/Evaluation Date/)).toHaveValue('2026-06-30');
    expect(within(dialog).getByLabelText('Next Evaluation')).toHaveValue('2026-12-31');
    expect(within(dialog).getByLabelText('Comments')).toHaveValue('Late twice');

    fireEvent.change(within(dialog).getByLabelText('Service (0-100)'), { target: { value: '70' } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save Changes' }));
    });

    expect(mockedPut).toHaveBeenCalledWith('/api/v1/supplier-scorecard/sc-2', {
      vendorId: 'v-2',
      evaluationDate: '2026-06-30',
      qualityScore: 50,
      deliveryScore: 60,
      serviceScore: 70,
      status: 'PROBATION',
      comments: 'Late twice',
      nextEvaluationDate: '2026-12-31',
    });
    expect(toasts()).toContainEqual({
      type: 'success',
      title: 'Scorecard updated',
      description: undefined,
    });
  });

  it('a save the server refuses (404 vendor) keeps the form open with the reason', async () => {
    mockedPost.mockRejectedValue(httpError(404, 'Vendor not found'));
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'New Evaluation' }));
    const dialog = screen.getByRole('dialog', { name: 'New Evaluation' });

    fireEvent.click(within(dialog).getByRole('button', { name: /^Vendor/ }));
    fireEvent.click(within(dialog).getByRole('option', { name: 'CV Kalibra' }));
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create Evaluation' }));
    });

    expect(toasts()).toContainEqual({
      type: 'error',
      title: 'Save failed',
      description: 'Vendor not found',
    });
    expect(screen.getByRole('dialog', { name: 'New Evaluation' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('supplier scorecards — deleting (confirmed)', () => {
  it('asks first, then DELETEs and reloads', async () => {
    mockedDelete.mockImplementation(async () => {
      scorecards = scorecards.slice(1);
      return ok(null, 'Scorecard deleted successfully');
    });
    await renderLoaded();

    fireEvent.click(within(rowOf('PT Medika')).getByRole('button', { name: 'Delete scorecard' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Evaluation' });
    expect(within(dialog).getByText(/This cannot be undone/)).toBeInTheDocument();
    expect(mockedDelete).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    });

    expect(mockedDelete).toHaveBeenCalledWith('/api/v1/supplier-scorecard/sc-1');
    await waitFor(() =>
      expect(screen.queryByText('PT Medika', { selector: 'span' })).not.toBeInTheDocument()
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Cancel sends nothing; a refused delete (404) keeps the confirmation', async () => {
    mockedDelete.mockRejectedValue(httpError(404, 'Scorecard not found'));
    await renderLoaded();

    fireEvent.click(within(rowOf('PT Medika')).getByRole('button', { name: 'Delete scorecard' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockedDelete).not.toHaveBeenCalled();

    fireEvent.click(within(rowOf('PT Medika')).getByRole('button', { name: 'Delete scorecard' }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    });

    expect(toasts()).toContainEqual({
      type: 'error',
      title: 'Delete failed',
      description: 'Scorecard not found',
    });
    expect(screen.getByRole('dialog', { name: 'Delete Evaluation' })).toBeInTheDocument();
  });
});

/**
 * ADR-102 — supplier scorecard writes are gated on `supplier-scorecard` write. CALIBRATOR ADMIN and ENGINEERING MANAGER hold it read.
 * Before the permissions load nothing is writable; the super admin writes.
 * Fail-before: New Evaluation, Edit and Delete rendered for every role.
 */
describe("ADR-102 — supplier scorecard write controls follow the effective permission", () => {
  const writeControls = [
      /New Evaluation/,
      "Edit scorecard",
      "Delete scorecard",
  ];

  it("a reader gets none of the write controls", async () => {
    grantPermissions({ "supplier-scorecard": "read" });
    render(<SupplierScorecardPage />);
    await screen.findByText('PT Medika', { selector: 'span' });
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("nothing is writable before the permissions load", async () => {
    clearPermissions();
    render(<SupplierScorecardPage />);
    await screen.findByText('PT Medika', { selector: 'span' });
    for (const name of writeControls) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("the super admin gets them", async () => {
    grantSuperAdmin();
    render(<SupplierScorecardPage />);
    await screen.findByText('PT Medika', { selector: 'span' });
    expect(screen.getAllByRole("button", { name: /New Evaluation/ }).length).toBeGreaterThan(0);
  });
});
