/**
 * P22-01 — synthetic catalogue rows for the catalogue page's suites, shaped as the P21-01 API
 * answers them (`schema.d.ts`), and a router over the mocked `api` client. No upstream value: every
 * name here is invented ("Test Pump A", "Synthetic scale").
 */
import type {
  DeviceType,
  InspectionTemplate,
  ItemDefinition,
  Proposal,
  ProposalQueueRow,
  PublishedCatalogue,
  TemplateItem,
  TemplateVersion,
  TemplateVersionSummary,
} from "@/api/services/ipmCatalogue.service";

export const IDS = {
  typeA: "0b4c4a51-0000-4000-8000-00000000000a",
  typeB: "0b4c4a51-0000-4000-8000-00000000000b",
  baseTemplate: "1c4c4a51-0000-4000-8000-000000000001",
  typeTemplate: "1c4c4a51-0000-4000-8000-000000000002",
  baseV3: "2d4c4a51-0000-4000-8000-000000000003",
  typeV2: "2d4c4a51-0000-4000-8000-000000000012",
  draft: "2d4c4a51-0000-4000-8000-0000000000d1",
  defTemp: "3e4c4a51-0000-4000-8000-000000000001",
  defAlarm: "3e4c4a51-0000-4000-8000-000000000002",
  defLeak: "3e4c4a51-0000-4000-8000-000000000003",
  proposal: "4f4c4a51-0000-4000-8000-000000000001",
  tenant: "5a4c4a51-0000-4000-8000-000000000001",
} as const;

export const ok = <T>(data: T, meta?: unknown) => ({ success: true, status: 200, message: "ok", data, ...(meta ? { meta } : {}) });
export const meta = (total: number, page = 1, limit = 25) => ({ total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });

export const templateItem = (over: Partial<TemplateItem> = {}): TemplateItem => ({
  id: "6b4c4a51-0000-4000-8000-000000000001",
  itemDefinitionId: IDS.defAlarm,
  origin: "type",
  section: "function",
  label: "Alarm sounds",
  inputKind: "tri_state",
  unit: null,
  symbol: null,
  settingText: null,
  settingValue: null,
  limitOp: null,
  limitValue: null,
  limitLow: null,
  limitHigh: null,
  limitNominal: null,
  limitTolerance: null,
  limitText: null,
  validMin: null,
  validMax: null,
  warnMin: null,
  warnMax: null,
  allowedOutcomes: ["pass", "fail", "not_applicable"],
  required: true,
  sortOrder: 1,
  ...over,
});

export const baseItem = templateItem({
  id: "6b4c4a51-0000-4000-8000-0000000000b1",
  itemDefinitionId: IDS.defTemp,
  origin: "base",
  section: "environment",
  label: "Room temperature",
  inputKind: "measured",
  unit: "°C",
  allowedOutcomes: [],
});

export const leakItem = templateItem({
  id: "6b4c4a51-0000-4000-8000-000000000002",
  itemDefinitionId: IDS.defLeak,
  section: "electrical_safety",
  label: "Earth leakage",
  inputKind: "measured_with_limit",
  unit: "µA",
  limitOp: "lte",
  limitValue: "100",
  limitText: "≤ 100 µA",
  sortOrder: 2,
});

export const catalogue = (): PublishedCatalogue => ({
  schema: "inspection-catalogue-v1",
  deviceTypes: [
    { id: IDS.typeA, name: "Test Pump A" },
    { id: IDS.typeB, name: "Synthetic scale" },
  ],
  versions: [
    { id: IDS.baseV3, templateId: IDS.baseTemplate, deviceTypeId: null, versionNumber: 3, baseVersionId: null, contentHash: "a".repeat(64), publishedAt: "2026-10-01T08:00:00.000Z", items: [baseItem] },
    {
      id: IDS.typeV2,
      templateId: IDS.typeTemplate,
      deviceTypeId: IDS.typeA,
      versionNumber: 2,
      baseVersionId: IDS.baseV3,
      contentHash: "b".repeat(64),
      publishedAt: "2026-10-02T08:00:00.000Z",
      items: [templateItem(), baseItem, leakItem],
    },
  ],
});

export const deviceType = (over: Partial<DeviceType> = {}): DeviceType => ({ id: IDS.typeA, name: "Test Pump A", status: "active", ...over });

export const definition = (over: Partial<ItemDefinition> = {}): ItemDefinition => ({
  ...templateItem({ itemDefinitionId: IDS.defAlarm }),
  id: IDS.defAlarm,
  defaultRequired: true,
  notes: null,
  status: "active",
  ...over,
} as ItemDefinition);

export const template = (over: Partial<InspectionTemplate> = {}): InspectionTemplate => ({
  id: IDS.typeTemplate,
  deviceTypeId: IDS.typeA,
  deviceTypeName: "Test Pump A",
  status: "active",
  publishedVersion: { id: IDS.typeV2, versionNumber: 2, publishedAt: "2026-10-02T08:00:00.000Z" },
  openDraft: { id: IDS.draft, revision: 2, createdAt: "2026-10-05T08:00:00.000Z" },
  createdAt: "2026-09-01T08:00:00.000Z",
  ...over,
});

export const baseTemplate = (): InspectionTemplate =>
  template({ id: IDS.baseTemplate, deviceTypeId: null, deviceTypeName: null, publishedVersion: { id: IDS.baseV3, versionNumber: 3, publishedAt: "2026-10-01T08:00:00.000Z" }, openDraft: null });

export const version = (over: Partial<TemplateVersion> = {}): TemplateVersion => ({
  id: IDS.draft,
  templateId: IDS.typeTemplate,
  deviceTypeId: IDS.typeA,
  status: "draft",
  versionNumber: null,
  baseVersionId: null,
  rebasedFromVersionId: null,
  contentHash: null,
  changeNote: null,
  revision: 2,
  publishedAt: null,
  retiredAt: null,
  discardedAt: null,
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-06T08:00:00.000Z",
  items: [templateItem()],
  ...over,
});

export const summary = (over: Partial<TemplateVersionSummary> = {}): TemplateVersionSummary => {
  const { items: _items, ...rest } = version({ id: IDS.typeV2, status: "published", versionNumber: 2, changeNote: "Adds leakage", publishedAt: "2026-10-02T08:00:00.000Z", ...over });
  void _items;
  return rest;
};

export const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: IDS.proposal,
  kind: "add_items",
  deviceTypeId: IDS.typeA,
  proposedDeviceTypeName: null,
  basedOnVersionId: IDS.typeV2,
  proposedItems: [{ section: "function", label: "Occlusion alarm", inputKind: "tri_state", note: "Seen on site" }],
  reason: "Missing check",
  status: "submitted",
  submittedBy: "7c4c4a51-0000-4000-8000-000000000001",
  decidedAt: null,
  decisionNote: null,
  resultingVersionId: null,
  withdrawnAt: null,
  createdAt: "2026-10-07T08:00:00.000Z",
  updatedAt: "2026-10-07T08:00:00.000Z",
  ...over,
});

export const queueRow = (over: Partial<ProposalQueueRow> = {}): ProposalQueueRow => ({ ...proposal(), tenantId: IDS.tenant, ...over });

type Handler = (path: string, config?: { params?: Record<string, unknown> }) => unknown;

/** A `api.get` implementation answering by path; an unknown path rejects (a test never hits a fabricated route silently). */
export const routeGets = (routes: Record<string, Handler | unknown>) => async (path: string, config?: { params?: Record<string, unknown> }) => {
  const route = routes[path];
  if (route === undefined) throw new Error(`unexpected GET ${path}`);
  return typeof route === "function" ? (route as Handler)(path, config) : route;
};
